/**
 * Facebook staff alerts from stored data (meta_insights_daily, meta_objects, meta_reach_cache).
 * Read-only: the only Graph call is the cached 7-day reach query (GET, via metaReach).
 * Missing data → no alert (never a guessed one).
 */
import { getSql } from "@/lib/db";
import { addDaysYmd, ymdInTz } from "./warehouse.server.ts";
import { metaReach } from "./meta-ads.server.ts";
import { FATIGUE, FREQ_ALERT, LEARNING_TIP, type MetaAlert, type MetaAlertLevel } from "./meta-alerts.types.ts";

type Win = { impr: number; spend: number; link: number | null };
type Obj = { level: MetaAlertLevel; id: string; name: string | null; campaign_id: string | null; adset_id: string | null; effective_status: string | null; config: Record<string, unknown> | null };

const ymd = (d: unknown) => (d == null ? null : (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10));
const pct = (v: number) => `${(v * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
const n0 = (v: number) => Math.round(v).toLocaleString("vi-VN");
const f2 = (v: number) => v.toLocaleString("vi-VN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** 7-day reach window for an account: the same range the FB tab uses for "7 ngày". */
export function reachWindow(tz: string): { start: string; end: string } {
  const y = addDaysYmd(ymdInTz(tz), -1);
  return { start: addDaysYmd(y, -6), end: y };
}

export async function metaAlertsFor(clientId: string, accountLabel: string): Promise<MetaAlert[]> {
  const sql = await getSql();
  const st = (
    await sql.query<{ timezone_name: string | null; insights_through: unknown; fields_v2_from: unknown; currency: string | null }>(
      `select timezone_name, insights_through, fields_v2_from, currency from meta_account_state where client_id = $1`, [clientId],
    )
  )[0];
  if (!st) return [];
  const tz = st.timezone_name || "Asia/Ho_Chi_Minh";
  const y = addDaysYmd(ymdInTz(tz), -1);
  const recentStart = addDaysYmd(y, -(FATIGUE.recentDays - 1));
  const baseEnd = addDaysYmd(recentStart, -1);
  const baseStart = addDaysYmd(baseEnd, -(FATIGUE.baseDays - 1));
  const through = ymd(st.insights_through);
  const v2From = ymd(st.fields_v2_from);
  // Daily data must reach yesterday, and link clicks must be stored for both windows.
  const fatigueOk = Boolean(through && through >= y && v2From && v2From <= baseStart);

  const objs = await sql.query<{ level: MetaAlertLevel; object_id: string; name: string | null; campaign_id: string | null; adset_id: string | null; effective_status: string | null; config: unknown }>(
    `select level, object_id, name, campaign_id, adset_id, effective_status, config from meta_objects where client_id = $1`, [clientId],
  );
  const byKey = new Map<string, Obj>();
  const names = new Map<string, string>();
  for (const o of objs) {
    const cfg = (typeof o.config === "string" ? JSON.parse(o.config) : o.config) as Record<string, unknown> | null;
    if (o.name) names.set(`${o.level}:${o.object_id}`, o.name);
    if (o.level === "adset" || o.level === "ad") byKey.set(`${o.level}:${o.object_id}`, { level: o.level, id: o.object_id, name: o.name, campaign_id: o.campaign_id, adset_id: o.adset_id, effective_status: o.effective_status, config: cfg });
  }
  // Active = ACTIVE in the last structure sync. No structure → no alerts (we cannot tell what is running).
  const active = (level: MetaAlertLevel, id: string) => byKey.get(`${level}:${id}`)?.effective_status === "ACTIVE";
  const nameOf = (level: string, id: string | null) => (id ? names.get(`${level}:${id}`) || null : null);

  const out: MetaAlert[] = [];
  const base = (o: Obj, kind: MetaAlert["kind"], severity: MetaAlert["severity"], reason: string, detail: string, tip: string | null = null): MetaAlert => ({
    client_id: clientId, account_label: accountLabel, kind, severity, level: o.level, object_id: o.id,
    name: o.name || o.id, campaign_id: o.campaign_id, campaign_name: nameOf("campaign", o.campaign_id),
    adset_id: o.level === "ad" ? o.adset_id : o.id, adset_name: o.level === "ad" ? nameOf("adset", o.adset_id) : o.name,
    reason, detail, tip,
  });

  // ── Learning phase (adset config.learning_stage_info from the structure sync) ──
  for (const o of byKey.values()) {
    if (o.level !== "adset" || o.effective_status !== "ACTIVE") continue;
    const ls = o.config?.learning_stage_info as { status?: unknown; conversions?: unknown } | undefined;
    const s = String(ls?.status || "");
    const conv = ls?.conversions != null && Number.isFinite(Number(ls.conversions)) ? Number(ls.conversions) : null;
    const convTxt = conv != null ? `${n0(conv)} kết quả kể từ lần chỉnh sửa đáng kể gần nhất` : "Meta không trả số kết quả";
    if (s === "FAIL") out.push(base(o, "learning_limited", "warn", "Hạn chế học", convTxt, LEARNING_TIP));
    else if (s === "LEARNING") out.push(base(o, "learning", "info", "Đang học", convTxt));
  }

  // ── 7-day frequency (period aggregate, cached; reused by the FB tab's "7 ngày") ──
  const rw = reachWindow(tz);
  const freq = new Map<string, number>();
  const hasActive = [...byKey.values()].some((o) => o.effective_status === "ACTIVE");
  if (hasActive && through && through >= rw.end) {
    const reach = await metaReach(clientId, rw.start, rw.end, tz).catch(() => null);
    if (reach) {
      for (const [id, v] of Object.entries(reach.adset)) if (v.frequency != null) freq.set(`adset:${id}`, v.frequency);
      for (const [id, v] of Object.entries(reach.ad)) if (v.frequency != null) freq.set(`ad:${id}`, v.frequency);
    }
  }
  for (const [key, f] of freq) {
    const [level, id] = key.split(":") as [MetaAlertLevel, string];
    if (!active(level, id) || !(f > FREQ_ALERT.warn)) continue;
    const o = byKey.get(key)!;
    out.push(base(o, "frequency", f > FREQ_ALERT.bad ? "danger" : "warn", f > FREQ_ALERT.bad ? "Tần suất 7 ngày rất cao" : "Tần suất 7 ngày cao",
      `Tần suất 7 ngày ${f2(f)} (${rw.start.split("-").reverse().join("/")}–${rw.end.split("-").reverse().join("/")}) · ngưỡng vàng >${FREQ_ALERT.warn}, đỏ >${FREQ_ALERT.bad}`));
  }

  // ── Creative fatigue: last 3 days vs previous 7 days ──
  if (fatigueOk) {
    const rows = await sql.query<{ level: MetaAlertLevel; object_id: string; w: string; impr: unknown; spend: unknown; link: unknown; nlink: unknown; n: unknown }>(
      `select level, object_id, case when date >= $3 then 'r' else 'b' end as w,
              sum(impressions) as impr, sum(spend) as spend, sum(inline_link_clicks) as link,
              count(inline_link_clicks) as nlink, count(*) as n
         from meta_insights_daily
        where client_id = $1 and level in ('adset','ad') and date between $2 and $4
        group by 1, 2, 3`,
      [clientId, baseStart, recentStart, y],
    );
    const wins = new Map<string, { r?: Win; b?: Win }>();
    for (const r of rows) {
      const k = `${r.level}:${r.object_id}`;
      const w: Win = { impr: Number(r.impr || 0), spend: Number(r.spend || 0), link: Number(r.nlink) === Number(r.n) ? Number(r.link || 0) : null };
      const e = wins.get(k) || {};
      e[r.w === "r" ? "r" : "b"] = w;
      wins.set(k, e);
    }
    for (const [key, { r, b }] of wins) {
      const [level, id] = key.split(":") as [MetaAlertLevel, string];
      if (!r || !b || !active(level, id)) continue;
      if (r.impr < FATIGUE.minImpr || b.impr < FATIGUE.minImpr || r.link == null || b.link == null) continue;
      const ctrR = r.link / r.impr, ctrB = b.link / b.impr;
      if (!(ctrB > 0)) continue;
      const ctrChg = ctrR / ctrB - 1;
      if (ctrChg > -FATIGUE.ctrDrop) continue;
      const cpmR = (r.spend / r.impr) * 1000, cpmB = (b.spend / b.impr) * 1000;
      const cpmChg = cpmB > 0 ? cpmR / cpmB - 1 : null;
      const f = freq.get(key) ?? null;
      const cpmHit = cpmChg != null && cpmChg >= FATIGUE.cpmRise;
      const freqHit = f != null && f > FATIGUE.freq;
      if (!cpmHit && !freqHit) continue;
      const o = byKey.get(key)!;
      const parts = [
        `CTR liên kết ${pct(ctrB)} → ${pct(ctrR)} (${signed(ctrChg)})`,
        cpmChg != null ? `CPM ${n0(cpmB)} → ${n0(cpmR)} ${st.currency || ""} (${signed(cpmChg)})`.replace("  ", " ") : null,
        f != null ? `tần suất 7 ngày ${f2(f)}` : null,
        `hiển thị ${n0(b.impr)} / ${n0(r.impr)}`,
      ].filter(Boolean);
      out.push(base(o, "fatigue", "danger", `Mẫu quảng cáo mỏi (3 ngày gần nhất so với 7 ngày trước)${cpmHit && freqHit ? " · CPM tăng + tần suất cao" : cpmHit ? " · CPM tăng" : " · tần suất cao"}`,
        parts.join(" · "), "Thay / làm mới mẫu quảng cáo, mở rộng tệp hoặc giảm ngân sách nhóm."));
    }
  }
  const rank = { danger: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.name.localeCompare(b.name, "vi"));
}
