/**
 * ChatGPT Ads (OpenAI Advertiser API) — server only. Keys, account sync, structure, daily insights.
 * All network access goes through openai-ads-http.server.ts (read-only enforced).
 * AdsOps id for an OpenAI ad account: `oa_<hex>` (from adacct_<hex>); platform 'openai'.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { addDaysYmd, ymdInTz } from "./warehouse.server.ts";
import { oaConversionsReport, oaGet, OpenAIAdsError } from "./openai-ads-http.server.ts";

export const OA_PREFIX = "oa_";
export const isOpenAIId = (id: string) => id.startsWith(OA_PREFIX);
export const oaClientId = (adAccountId: string) => `${OA_PREFIX}${adAccountId.replace(/^adacct_/, "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
const INITIAL_DAYS = 90;
const REFRESH_DAYS = 35;

// ── encryption (OPENAI_ADS_ENC_KEY) ───────────────────────────────────────────

function encKey(): Buffer | null {
  const raw = (process.env.OPENAI_ADS_ENC_KEY || "").trim();
  if (!raw) return null;
  const b64 = Buffer.from(raw, "base64");
  if (b64.length === 32) return b64;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

function encrypt(plain: string): string {
  const key = encKey();
  if (!key) throw new Error("Thiếu OPENAI_ADS_ENC_KEY để mã hoá API key.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

function decrypt(blob: string): string | null {
  const key = encKey();
  if (!key) return null;
  const [v, iv, tag, ct] = String(blob || "").split(":");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── account ───────────────────────────────────────────────────────────────────

export type OAAccount = { id: string; name: string | null; account_name?: string | null; currency_code: string | null; timezone: string | null; status: string | null; url?: string | null };

export function errVi(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function upsertAccount(a: OAAccount): Promise<string> {
  const sql = await getSql();
  const id = oaClientId(a.id);
  const name = a.name || a.account_name || a.id;
  await sql.query(
    `insert into ad_accounts (id, platform, external_id, display_name, status)
     values ($1, 'openai', $2, $3, $4)
     on conflict (id) do update set display_name = excluded.display_name, status = excluded.status, updated_at = now()`,
    [id, a.id, name, a.status === "active" ? "active" : a.status || null],
  );
  await sql.query(
    `insert into openai_account_state (client_id, ad_account_id, name, currency, timezone, status, checked_at, error)
     values ($1,$2,$3,$4,$5,$6, now(), null)
     on conflict (client_id) do update set ad_account_id = excluded.ad_account_id, name = excluded.name, currency = excluded.currency,
       timezone = excluded.timezone, status = excluded.status, checked_at = now(), error = null`,
    [id, a.id, name, a.currency_code, a.timezone, a.status],
  );
  return id;
}

async function storeKey(adAccountId: string, key: string, source: "form" | "env", by: string | null): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `insert into openai_ads_keys (ad_account_id, key_enc, source, created_by, last_ok_at)
     values ($1,$2,$3,$4, now())
     on conflict (ad_account_id) do update set key_enc = excluded.key_enc, source = excluded.source,
       created_by = excluded.created_by, updated_at = now(), last_ok_at = now(), last_error = null`,
    [adAccountId, encrypt(key), source, by],
  );
}

/** Validate a key with GET /ad_account, store it encrypted, sync the account. Returns account facts only (never the key). */
export async function connectKey(key: string, by: string): Promise<{ client_id: string; ad_account_id: string; name: string; currency: string | null; timezone: string | null }> {
  const k = key.trim();
  if (k.length < 20 || /\s/.test(k)) throw new Error("API key không đúng định dạng.");
  const a = await oaGet<OAAccount>(k, "/v1/ad_account");
  if (!a?.id) throw new Error("OpenAI không trả về tài khoản quảng cáo cho key này.");
  await storeKey(a.id, k, "form", by);
  const id = await upsertAccount(a);
  return { client_id: id, ad_account_id: a.id, name: a.name || a.id, currency: a.currency_code, timezone: a.timezone };
}

let seeded = false;
/** Seed from env OPENAI_ADS_API_KEY once per instance. A key pasted in the form is never overwritten by the env. */
export async function seedFromEnv(): Promise<void> {
  if (seeded) return;
  seeded = true;
  const k = (process.env.OPENAI_ADS_API_KEY || "").trim();
  if (!k || !encKey()) return;
  try {
    const a = await oaGet<OAAccount>(k, "/v1/ad_account", undefined, 8000);
    if (!a?.id) return;
    const sql = await getSql();
    const cur = await sql.query<{ source: string }>(`select source from openai_ads_keys where ad_account_id = $1`, [a.id]);
    if (!cur.length || cur[0].source === "env") await storeKey(a.id, k, "env", "env");
    await upsertAccount(a);
  } catch {
    seeded = false;
  }
}

async function keyFor(clientId: string): Promise<{ key: string; adAccountId: string } | null> {
  const sql = await getSql();
  const r = await sql.query<{ ad_account_id: string; key_enc: string }>(
    `select k.ad_account_id, k.key_enc from openai_ads_keys k
       join ad_accounts a on a.external_id = k.ad_account_id and a.platform = 'openai'
      where a.id = $1`,
    [clientId],
  );
  const key = r[0] ? decrypt(r[0].key_enc) : null;
  return key ? { key, adAccountId: r[0].ad_account_id } : null;
}

export type OAKeyRow = { client_id: string; ad_account_id: string; name: string | null; source: string; created_by: string | null; updated_at: string; last_ok_at: string | null; last_error: string | null; insights_through: string | null };

/** Admin listing — no key material. */
export async function listConnections(): Promise<OAKeyRow[]> {
  const sql = await getSql();
  const r = await sql.query<Record<string, unknown>>(
    `select a.id as client_id, k.ad_account_id, coalesce(s.name, a.display_name) as name, k.source, k.created_by,
            k.updated_at, k.last_ok_at, k.last_error, s.insights_through
       from openai_ads_keys k
       left join ad_accounts a on a.external_id = k.ad_account_id and a.platform = 'openai'
       left join openai_account_state s on s.client_id = a.id
      order by k.updated_at desc`,
  );
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
  return r.map((x) => ({
    client_id: String(x.client_id || ""),
    ad_account_id: String(x.ad_account_id),
    name: (x.name as string) ?? null,
    source: String(x.source),
    created_by: (x.created_by as string) ?? null,
    updated_at: iso(x.updated_at) || "",
    last_ok_at: iso(x.last_ok_at),
    last_error: (x.last_error as string) ?? null,
    insights_through: x.insights_through instanceof Date ? x.insights_through.toISOString().slice(0, 10) : (x.insights_through as string) ?? null,
  }));
}

// ── structure ─────────────────────────────────────────────────────────────────

type ListResp<T> = { data?: T[]; has_more?: boolean; last_id?: string | null };
type Entity = { id: string; name?: string | null; status?: string | null; title?: string | null; creative?: { title?: string | null; body?: string | null; target_url?: string | null; image_url?: string | null } | null } & Record<string, unknown>;

/** Full object for the detail panel, minus short-lived signed URLs (the image is served via /api/openai-ad-image). */
function sanitize(e: Entity): Record<string, unknown> {
  const o: Record<string, unknown> = { ...e };
  if (e.creative) {
    const c = { ...e.creative } as Record<string, unknown>;
    delete c.image_url;
    o.creative = c;
  }
  return o;
}

async function listAll<T extends { id: string }>(key: string, path: string): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let i = 0; i < 50; i++) {
    const r = await oaGet<ListResp<T>>(key, path, { limit: 100, after });
    out.push(...(r.data || []));
    if (!r.has_more || !r.last_id) break;
    after = r.last_id;
  }
  return out;
}

type ZeroRow = { ad_group_id?: string; ad_id?: string; campaign_id?: string; ad_title?: string | null; ad_link?: string | null };

/**
 * Parent ids for EVERY ad group / ad (list endpoints don't carry them, and entities without delivery have
 * no daily rows). Insights with includes[]=zero_impression_items returns one row per entity, delivered or not.
 */
async function zeroRows(key: string, level: "ad_group" | "ad", tz: string): Promise<ZeroRow[]> {
  const until = ymdInTz(tz);
  const since = addDaysYmd(until, -364);
  const fields = level === "ad" ? ["ad.id", "ad_group.id", "campaign.id", "ad.title", "ad.link"] : ["ad_group.id", "campaign.id"];
  const out: ZeroRow[] = [];
  let after: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await oaGet<{ data?: ZeroRow[]; has_more?: boolean; last_id?: string | null }>(key, "/v1/ad_account/insights", {
      time_granularity: "none",
      aggregation_level: level,
      "includes[]": "zero_impression_items",
      "fields[]": fields,
      "time_ranges[]": JSON.stringify({ type: "date_range", since, until }),
      limit: 2000,
      after,
    });
    out.push(...(r.data || []));
    if (!r.has_more || !r.last_id) break;
    after = r.last_id;
  }
  return out;
}

async function syncStructure(clientId: string, key: string, tz = DEFAULT_TZ): Promise<{ campaigns: number; ad_groups: number; ads: number }> {
  const sql = await getSql();
  const [c, g, a] = await Promise.all([
    listAll<Entity>(key, "/v1/campaigns"),
    listAll<Entity>(key, "/v1/ad_groups"),
    listAll<Entity>(key, "/v1/ads"),
  ]);
  const put = async (level: string, rows: Entity[]) => {
    for (const e of rows) {
      const raw = { obj: sanitize(e), ...(e.creative ? { title: e.creative.title ?? null, body: e.creative.body ?? null, link: e.creative.target_url ?? null, has_image: Boolean(e.creative.image_url || (e.creative as Record<string, unknown>).file_id) } : {}) };
      await sql.query(
        `insert into openai_entities (client_id, level, entity_id, name, status, raw, updated_at)
         values ($1,$2,$3,$4,$5,$6::jsonb, now())
         on conflict (client_id, level, entity_id) do update set name = excluded.name, status = excluded.status,
           raw = coalesce(excluded.raw, openai_entities.raw), updated_at = now()`,
        [clientId, level, e.id, e.name || e.title || null, e.status || null, raw ? JSON.stringify(raw) : null],
      );
    }
  };
  await put("campaign", c);
  await put("ad_group", g);
  // Ad detail carries serving_issues / appeal / image_url that the list omits (one GET per ad, capped).
  const detailed: Entity[] = [];
  for (const ad of a.slice(0, 300)) detailed.push(await oaGet<Entity>(key, `/v1/ads/${encodeURIComponent(ad.id)}`, { "include[]": "serving_issues" }).catch(() => ad));
  await put("ad", [...detailed, ...a.slice(300)]);
  const [zg, za] = await Promise.all([zeroRows(key, "ad_group", tz).catch(() => []), zeroRows(key, "ad", tz).catch(() => [])]);
  for (const r of zg) {
    if (!r.ad_group_id) continue;
    await sql.query(`update openai_entities set campaign_id = coalesce($3, campaign_id) where client_id = $1 and level = 'ad_group' and entity_id = $2`, [clientId, r.ad_group_id, r.campaign_id || null]);
  }
  for (const r of za) {
    if (!r.ad_id) continue;
    await sql.query(
      `update openai_entities set campaign_id = coalesce($3, campaign_id), ad_group_id = coalesce($4, ad_group_id),
         raw = coalesce(raw, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('title', $5::text, 'link', $6::text))
       where client_id = $1 and level = 'ad' and entity_id = $2`,
      [clientId, r.ad_id, r.campaign_id || null, r.ad_group_id || null, r.ad_title ?? null, r.ad_link ?? null],
    );
  }
  return { campaigns: c.length, ad_groups: g.length, ads: a.length };
}

// ── insights ──────────────────────────────────────────────────────────────────

type InsRow = Record<string, unknown> & { readable_time?: string };
type InsResp = { data?: InsRow[]; has_more?: boolean; last_id?: string | null };
const LEVELS = ["ad_account", "campaign", "ad_group", "ad"] as const;
const METRICS = ["impressions", "clicks", "spend", "ctr", "cpc", "cpm", "conversions"];

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

async function pullLevel(key: string, level: (typeof LEVELS)[number], since: string, until: string): Promise<InsRow[]> {
  const parents = level === "ad" ? ["campaign.id", "ad_group.id"] : level === "ad_group" ? ["campaign.id"] : [];
  const fields = ["metadata.readable_time", `${level}.id`, ...parents, ...METRICS.map((m) => `${level}.${m}`)];
  const out: InsRow[] = [];
  let after: string | undefined;
  for (let i = 0; i < 50; i++) {
    const r = await oaGet<InsResp>(key, "/v1/ad_account/insights", {
      time_granularity: "daily",
      aggregation_level: level,
      "fields[]": fields,
      "time_ranges[]": JSON.stringify({ type: "date_range", since, until }),
      limit: 2000,
      after,
    });
    out.push(...(r.data || []));
    if (!r.has_more || !r.last_id) break;
    after = r.last_id;
  }
  return out;
}

/** Attributed order sales per day for the account (read-only conversion report). null when unavailable. */
async function pullSales(key: string, since: string, until: string): Promise<Map<string, number | null>> {
  const r = await oaConversionsReport<{ data?: Array<{ date?: string; order_created_attributed_sales?: string | null }> }>(key, {
    aggregation_level: "campaign",
    time_ranges: [JSON.stringify({ type: "date_range", since, until })],
    time_granularity: "daily",
    group_by_entity: false,
  }).catch(() => ({ data: [] as Array<{ date?: string; order_created_attributed_sales?: string | null }> }));
  const m = new Map<string, number | null>();
  for (const x of r.data || []) if (x.date) m.set(x.date, num(x.order_created_attributed_sales));
  return m;
}

async function syncInsights(clientId: string, key: string, tz: string, since: string, until: string): Promise<number> {
  const sql = await getSql();
  let n = 0;
  const parentsByAd = new Map<string, { c: string | null; g: string | null }>();
  const parentsByGroup = new Map<string, string | null>();
  for (const level of LEVELS) {
    const rows = await pullLevel(key, level, since, until);
    const lv = level === "ad_account" ? "account" : level;
    // Replace the window for this level so removed/zeroed days don't linger.
    await sql.query(`delete from openai_insights_daily where client_id = $1 and level = $2 and date between $3 and $4`, [clientId, lv, since, until]);
    for (const r of rows) {
      const date = String(r.readable_time || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const eid = String(r[`${level}_id`] || "");
      if (!eid) continue;
      const cid = (r.campaign_id as string) || null;
      const gid = (r.ad_group_id as string) || null;
      if (level === "ad") parentsByAd.set(eid, { c: cid, g: gid });
      if (level === "ad_group") parentsByGroup.set(eid, cid);
      await sql.query(
        `insert into openai_insights_daily (client_id, level, entity_id, date, campaign_id, ad_group_id, impressions, clicks, spend, ctr, cpc, cpm, conversions, pulled_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
         on conflict (client_id, level, entity_id, date) do update set campaign_id = excluded.campaign_id, ad_group_id = excluded.ad_group_id,
           impressions = excluded.impressions, clicks = excluded.clicks, spend = excluded.spend, ctr = excluded.ctr, cpc = excluded.cpc,
           cpm = excluded.cpm, conversions = excluded.conversions, pulled_at = now()`,
        [clientId, lv, eid, date, cid, gid, num(r.impressions), num(r.clicks), num(r.spend), num(r.ctr), num(r.cpc), num(r.cpm), num(r.conversions)],
      );
      n += 1;
    }
  }
  const sales = await pullSales(key, since, until);
  for (const [date, v] of sales) {
    if (v === null) continue;
    await sql.query(`update openai_insights_daily set sales = $3 where client_id = $1 and level = 'account' and date = $2`, [clientId, date, v]);
  }
  // List endpoints don't carry parent ids; insights rows do.
  for (const [ad, p] of parentsByAd) {
    await sql.query(`update openai_entities set campaign_id = coalesce($3, campaign_id), ad_group_id = coalesce($4, ad_group_id) where client_id = $1 and level = 'ad' and entity_id = $2`, [clientId, ad, p.c, p.g]);
    if (p.g && p.c && !parentsByGroup.has(p.g)) parentsByGroup.set(p.g, p.c);
  }
  for (const [g, c] of parentsByGroup) {
    await sql.query(`update openai_entities set campaign_id = coalesce($3, campaign_id) where client_id = $1 and level = 'ad_group' and entity_id = $2`, [clientId, g, c]);
  }
  return n;
}

/** Full read-only refresh of one account (account facts, structure, last ~35 days; 90 days on first pull). */
export async function refreshOpenAIAccount(clientId: string): Promise<{ ok: boolean; error_vi: string | null; rows?: number }> {
  const sql = await getSql();
  const k = await keyFor(clientId).catch(() => null);
  if (!k) return { ok: false, error_vi: "Chưa có API key ChatGPT Ads cho tài khoản này." };
  try {
    const a = await oaGet<OAAccount>(k.key, "/v1/ad_account");
    await upsertAccount(a);
    const tz = a.timezone || DEFAULT_TZ;
    const st = await sql.query<{ insights_through: unknown }>(`select insights_through from openai_account_state where client_id = $1`, [clientId]);
    const until = ymdInTz(tz);
    const since = addDaysYmd(until, -((st[0]?.insights_through ? REFRESH_DAYS : INITIAL_DAYS) - 1));
    await syncStructure(clientId, k.key, tz);
    const rows = await syncInsights(clientId, k.key, tz, since, until);
    await sql.query(
      `update openai_account_state set insights_through = $2, history_from = least(coalesce(history_from, $3::date), $3::date), checked_at = now(), error = null where client_id = $1`,
      [clientId, until, since],
    );
    await sql.query(`update openai_ads_keys set last_ok_at = now(), last_error = null where ad_account_id = $1`, [k.adAccountId]);
    return { ok: true, error_vi: null, rows };
  } catch (e) {
    const msg = errVi(e);
    await sql.query(`update openai_account_state set error = $2, checked_at = now() where client_id = $1`, [clientId, msg]).catch(() => null);
    await sql.query(`update openai_ads_keys set last_error = $2 where ad_account_id = $1`, [k.adAccountId, msg]).catch(() => null);
    return { ok: false, error_vi: msg };
  }
}

export async function openaiClientIds(): Promise<string[]> {
  const sql = await getSql();
  const r = await sql.query<{ id: string }>(`select id from ad_accounts where platform = 'openai' order by id`).catch(() => [] as { id: string }[]);
  return r.map((x) => x.id);
}

/** Nightly: every account with a stored key, within the cron deadline. */
export async function refreshAllOpenAI(deadline: number): Promise<{ accounts: number; done: number; errors: string[] }> {
  await seedFromEnv().catch(() => null);
  const ids = await openaiClientIds();
  const errors: string[] = [];
  let done = 0;
  for (const id of ids) {
    if (Date.now() > deadline) break;
    const r = await refreshOpenAIAccount(id);
    if (r.ok) done += 1;
    else errors.push(`${id}: ${r.error_vi}`);
  }
  return { accounts: ids.length, done, errors };
}

/**
 * Reach / frequency for a date range (not additive across days, so not stored daily). One GET per level,
 * read-only, best effort: any failure → empty map (shown blank).
 */
export async function liveReach(clientId: string, start: string, end: string): Promise<Map<string, { reach: number | null; frequency: number | null }>> {
  const out = new Map<string, { reach: number | null; frequency: number | null }>();
  const k = await keyFor(clientId).catch(() => null);
  if (!k) return out;
  const sql = await getSql();
  const st = await sql.query<{ timezone: string | null }>(`select timezone from openai_account_state where client_id = $1`, [clientId]).catch(() => []);
  const today = ymdInTz(st[0]?.timezone || DEFAULT_TZ);
  const until = end > today ? today : end;
  if (start > until) return out;
  await Promise.all(LEVELS.map(async (level) => {
    try {
      const r = await oaGet<InsResp>(k.key, "/v1/ad_account/insights", {
        time_granularity: "none",
        aggregation_level: level,
        "fields[]": [`${level}.id`, `${level}.reach`, `${level}.frequency`],
        "time_ranges[]": JSON.stringify({ type: "date_range", since: start, until }),
        limit: 2000,
      }, 8000);
      const lv = level === "ad_account" ? "account" : level;
      for (const x of r.data || []) {
        const id = String(x[`${level}_id`] || "");
        if (id) out.set(`${lv}|${id}`, { reach: num(x.reach), frequency: num(x.frequency) });
      }
    } catch {
      /* blank */
    }
  }));
  return out;
}

/**
 * Creative image for one ad: GET /v1/ads/{id} returns a short-lived signed creative.image_url
 * (OpenAI file storage). Fetched server-side (GET only) so the browser never needs the key. null if none.
 */
export async function adImage(clientId: string, adId: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  if (!/^ad_[A-Za-z0-9]+$/.test(adId)) return null;
  const k = await keyFor(clientId);
  if (!k) return null;
  const sql = await getSql();
  const own = await sql.query(`select 1 from openai_entities where client_id = $1 and level = 'ad' and entity_id = $2`, [clientId, adId]);
  if (!own.length) return null;
  const ad = await oaGet<Entity>(k.key, `/v1/ads/${adId}`);
  const u = ad.creative?.image_url;
  if (!u) return null;
  const url = new URL(u);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".oaiusercontent.com")) return null;
  const res = await fetch(url, { method: "GET", headers: { "User-Agent": "AdsOps/1.0 (+https://ad.fagogroup.vn)" } });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") || "image/png";
  if (!type.startsWith("image/")) return null;
  return { body: await res.arrayBuffer(), type };
}

export { OpenAIAdsError };
