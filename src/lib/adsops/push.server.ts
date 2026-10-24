/**
 * Web push (opt-in). Subscriptions + per-user prefs; alerts are re-checked against the
 * recipient's CURRENT role/grants at send time (allowedPushKinds + grantsFor), so a revoked
 * grant or role change silently stops alerts. Payloads carry no private numbers beyond
 * what that user can already see on the matching screen. Never emails anyone.
 * Google Ads access here is read-only GAQL SELECT.
 */
import webpush from "web-push";
import { getSql } from "@/lib/db";
import { grantsFor, principalForRef, type Principal } from "./permissions.server";
import { allowedPushKinds, isSharpDrop, PUSH_KINDS, type PushKind, type PushPrefs } from "./push.types.ts";
import type { PrincipalKind } from "./permissions.types.ts";

export function vapid(): { pub: string; priv: string; subject: string } | null {
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return null;
  return { pub, priv, subject: process.env.VAPID_SUBJECT?.trim() || "mailto:cuong@fagogroup.vn" };
}

type Ref = { kind: PrincipalKind; id: string };
const EMPTY: PushPrefs = { budget: false, conv_drop: false, invoices: false };

export async function getPrefs(ref: Ref): Promise<{ prefs: PushPrefs; devices: number }> {
  const sql = await getSql();
  const p = (await sql.query<PushPrefs>(`select budget, conv_drop, invoices from push_prefs where principal_kind = $1 and principal_id = $2`, [ref.kind, ref.id]))[0];
  const d = (await sql.query<{ n: number | string }>(`select count(*) as n from push_subscriptions where principal_kind = $1 and principal_id = $2`, [ref.kind, ref.id]))[0];
  return { prefs: p ? { budget: !!p.budget, conv_drop: !!p.conv_drop, invoices: !!p.invoices } : { ...EMPTY }, devices: Number(d?.n || 0) };
}

export async function setPrefs(ref: Ref, allowed: PushKind[], prefs: Partial<PushPrefs>): Promise<PushPrefs> {
  const cur = (await getPrefs(ref)).prefs;
  const next = { ...cur };
  for (const k of PUSH_KINDS) if (typeof prefs[k] === "boolean") next[k] = allowed.includes(k) ? prefs[k]! : false;
  const sql = await getSql();
  await sql.query(
    `insert into push_prefs (principal_kind, principal_id, budget, conv_drop, invoices, updated_at) values ($1,$2,$3,$4,$5,now())
     on conflict (principal_kind, principal_id) do update set budget = excluded.budget, conv_drop = excluded.conv_drop, invoices = excluded.invoices, updated_at = now()`,
    [ref.kind, ref.id, next.budget, next.conv_drop, next.invoices],
  );
  return next;
}

export async function saveSubscription(ref: Ref, sub: { endpoint: string; p256dh: string; auth: string }, ua: string | null): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into push_subscriptions (endpoint, principal_kind, principal_id, p256dh, auth, user_agent) values ($1,$2,$3,$4,$5,$6)
     on conflict (endpoint) do update set principal_kind = excluded.principal_kind, principal_id = excluded.principal_id,
       p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, fail_count = 0`,
    [sub.endpoint, ref.kind, ref.id, sub.p256dh, sub.auth, ua ? ua.slice(0, 300) : null],
  );
}

export async function removeSubscription(ref: Ref, endpoint: string): Promise<void> {
  const sql = await getSql();
  await sql.query(`delete from push_subscriptions where endpoint = $1 and principal_kind = $2 and principal_id = $3`, [endpoint, ref.kind, ref.id]);
}

export type PushPayload = { title: string; body: string; tag: string; url: string };
type Recipient = { principal: Principal; grants: "all" | Set<string> };

/** Opted-in users for a kind, re-validated against current permissions. */
async function recipients(kind: PushKind): Promise<Recipient[]> {
  const sql = await getSql();
  const rows = await sql.query<{ principal_kind: PrincipalKind; principal_id: string }>(
    `select p.principal_kind, p.principal_id from push_prefs p
      where p.${kind} = true and exists (select 1 from push_subscriptions s where s.principal_kind = p.principal_kind and s.principal_id = p.principal_id)`,
  );
  const out: Recipient[] = [];
  for (const r of rows) {
    const p = await principalForRef(r.principal_kind, r.principal_id);
    if (!p || !allowedPushKinds(p.kind, p.role).includes(kind)) continue;
    out.push({ principal: p, grants: await grantsFor(p) });
  }
  return out;
}

const sees = (r: Recipient, clientId: string) => r.grants === "all" || r.grants.has(clientId);

/** Atomic dedupe claim; true = first time. */
async function claim(key: string): Promise<boolean> {
  const sql = await getSql();
  return (await sql.query(`insert into push_sent (key) values ($1) on conflict (key) do nothing returning key`, [key])).length > 0;
}

async function sendTo(p: Principal, payload: PushPayload): Promise<number> {
  const v = vapid();
  if (!v) return 0;
  webpush.setVapidDetails(v.subject, v.pub, v.priv);
  const sql = await getSql();
  const subs = await sql.query<{ endpoint: string; p256dh: string; auth: string }>(
    `select endpoint, p256dh, auth from push_subscriptions where principal_kind = $1 and principal_id = $2`,
    [p.kind, p.id],
  );
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 24 * 3600 });
      ok++;
      await sql.query(`update push_subscriptions set last_ok_at = now(), fail_count = 0 where endpoint = $1`, [s.endpoint]);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sql.query(`delete from push_subscriptions where endpoint = $1`, [s.endpoint]);
      else await sql.query(`update push_subscriptions set fail_count = fail_count + 1 where endpoint = $1`, [s.endpoint]);
    }
  }
  return ok;
}

/** Send one alert about one account to every opted-in user who can see it (deduped per user). */
async function fanOut(kind: PushKind, clientId: string | null, window: string, payload: PushPayload, list: Recipient[]): Promise<number> {
  let n = 0;
  for (const r of list) {
    if (clientId && !sees(r, clientId)) continue;
    if (!(await claim(`${kind}:${clientId ?? "-"}:${window}:${r.principal.kind}:${r.principal.id}`))) continue;
    n += await sendTo(r.principal, payload);
  }
  return n;
}

const ictDate = (d = new Date()) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const fmtDays = (d: number) => (d < 1 ? "dưới 1 ngày" : `khoảng ${d.toFixed(1).replace(".", ",")} ngày`);

/** Budget < 3 days: fresh (≤ 36h) runway rows. One alert per account per 3-day window. */
export async function runBudgetAlerts(): Promise<{ sent: number; accounts: number }> {
  if (!vapid()) return { sent: 0, accounts: 0 };
  const list = await recipients("budget");
  if (!list.length) return { sent: 0, accounts: 0 };
  const sql = await getSql();
  const rows = await sql.query<{ client_id: string; runway_days: number | string; name: string | null }>(
    `select r.client_id, r.runway_days, a.display_name as name from ads_budget_runway r left join ad_accounts a on a.id = r.client_id
      where r.ok = true and r.runway_days is not null and r.runway_days < 3 and r.checked_at > now() - interval '36 hours'`,
  );
  const win = String(Math.floor(Date.now() / (3 * 86400_000)));
  let sent = 0;
  for (const r of rows) {
    const days = Number(r.runway_days);
    sent += await fanOut("budget", r.client_id, win, {
      title: "Ngân sách sắp hết",
      body: `${r.name || r.client_id}: ngân sách còn ${fmtDays(days)} theo chi tiêu trung bình.`,
      tag: `budget-${r.client_id}`,
      url: `/?tab=alerts&account=${encodeURIComponent(r.client_id)}`,
    }, list);
  }
  return { sent, accounts: rows.length };
}

/** Sharp conversion drop (Google): read-only GAQL, last 14 complete days, accounts with recent spend. */
export async function runConvDropAlerts(deadline: number): Promise<{ sent: number; checked: number; drops: number }> {
  if (!vapid()) return { sent: 0, checked: 0, drops: 0 };
  const list = await recipients("conv_drop");
  if (!list.length) return { sent: 0, checked: 0, drops: 0 };
  const sql = await getSql();
  const accs = await sql.query<{ id: string; external_id: string | null; display_name: string }>(
    `select a.id, a.external_id, a.display_name from ad_accounts a
      left join push_conv_check c on c.client_id = a.id
      where a.platform = 'google' and coalesce(a.spend10_micros, 0) > 0
      order by c.checked_at asc nulls first`,
  );
  const wanted = accs.filter((a) => list.some((r) => sees(r, a.id)));
  const { resolveAdsConfig } = await import("./google-ads.server.ts");
  const { searchLeaf } = await import("./warehouse.server.ts");
  const cfg = await resolveAdsConfig();
  if (!cfg.ready) return { sent: 0, checked: 0, drops: 0 };
  let checked = 0, drops = 0, sent = 0;
  const queue = [...wanted];
  const worker = async () => {
    while (queue.length && Date.now() < deadline) {
      const a = queue.shift()!;
      const cid = (a.external_id || "").replace(/\D/g, "");
      if (!cid) continue;
      try {
        const rows = await searchLeaf(cfg, cid, "SELECT segments.date, metrics.conversions FROM customer WHERE segments.date DURING LAST_14_DAYS");
        const by = new Map<string, number>();
        for (const r of rows as Array<Record<string, any>>) {
          const d = String(r?.segments?.date || "");
          if (d) by.set(d, (by.get(d) || 0) + Number(r?.metrics?.conversions || 0));
        }
        const days = [...by.keys()].sort();
        // Need a full 14-day series; otherwise leave unknown rather than guess.
        let last7: number | null = null, prev7: number | null = null;
        if (days.length >= 14) {
          const s = days.slice(-14);
          prev7 = s.slice(0, 7).reduce((t, d) => t + by.get(d)!, 0);
          last7 = s.slice(7).reduce((t, d) => t + by.get(d)!, 0);
        }
        checked++;
        await sql.query(
          `insert into push_conv_check (client_id, checked_at, last7, prev7, error) values ($1, now(), $2, $3, null)
           on conflict (client_id) do update set checked_at = now(), last7 = excluded.last7, prev7 = excluded.prev7, error = null`,
          [a.id, last7, prev7],
        );
        if (isSharpDrop(prev7, last7)) {
          drops++;
          const pct = Math.round((1 - last7! / prev7!) * 100);
          sent += await fanOut("conv_drop", a.id, "w" + Math.floor(Date.now() / (7 * 86400_000)), {
            title: "Chuyển đổi giảm mạnh",
            body: `${a.display_name}: 7 ngày qua ${fmtN(last7!)} chuyển đổi, giảm ${pct}% so với 7 ngày trước (${fmtN(prev7!)}).`,
            tag: `conv-${a.id}`,
            url: `/?tab=analytics&account=${encodeURIComponent(a.id)}`,
          }, list);
        }
      } catch (e) {
        await sql.query(
          `insert into push_conv_check (client_id, checked_at, error) values ($1, now(), $2)
           on conflict (client_id) do update set checked_at = now(), error = excluded.error`,
          [a.id, String((e as Error)?.message || e).slice(0, 300)],
        );
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { sent, checked, drops };
}

const fmtN = (n: number) => (Math.round(n * 10) / 10).toLocaleString("vi-VN");

/** Google invoices uploaded (UI upload or ingest). Never throws into the caller. */
export async function notifyInvoicesUploaded(saved: number, issueDates: Array<string | null>): Promise<void> {
  try {
    if (!saved || !vapid()) return;
    const list = await recipients("invoices");
    if (!list.length) return;
    const months = [...new Set(issueDates.filter(Boolean).map((d) => String(d).slice(0, 7)))].sort();
    const label = months.length ? months.map((m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`).join(", ") : null;
    const stamp = String(Date.now());
    await fanOut("invoices", null, stamp, {
      title: "Hóa đơn Google đã tải lên",
      body: `Đã thêm ${saved} hóa đơn Google${label ? ` (tháng ${label})` : ""}.`,
      tag: `invoices-${months.join("_") || stamp}`,
      url: "/?tab=invoices",
    }, list);
  } catch (e) {
    console.error("[push] invoices notify failed", (e as Error)?.message);
  }
}

export async function sendTest(p: Principal): Promise<number> {
  return sendTo(p, { title: "AdsOps", body: "Thông báo thử: bạn đã bật thông báo thành công.", tag: "test", url: "/" });
}
