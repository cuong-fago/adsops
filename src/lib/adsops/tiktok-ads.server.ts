/**
 * TikTok Ads (TikTok API for Business v1.3) — server only. OAuth tokens, advertisers, structure, daily insights.
 * All network access goes through tiktok-http.server.ts (read-only enforced).
 * AdsOps id for a TikTok advertiser: `tt_<advertiser_id>`; platform 'tiktok'.
 * Env: TIKTOK_APP_ID, TIKTOK_APP_SECRET, encryption key TIKTOK_ENC_KEY (falls back to OPENAI_ADS_ENC_KEY).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { addDaysYmd, ymdInTz } from "./warehouse.server.ts";
import { TikTokError, ttExchangeCode, ttGet } from "./tiktok-http.server.ts";

export const TT_PREFIX = "tt_";
export const TT_META_VERSION = 1;
export const isTikTokId = (id: string) => id.startsWith(TT_PREFIX);
export const ttClientId = (advertiserId: string) => `${TT_PREFIX}${String(advertiserId).replace(/[^0-9]/g, "")}`;
const DEFAULT_TZ = "Asia/Ho_Chi_Minh";
const INITIAL_DAYS = 90;
const REFRESH_DAYS = 35;
/** stat_time_day reports accept at most 30 days per request. */
const CHUNK_DAYS = 30;

export function appConfig(): { appId: string; secret: string } | null {
  const appId = (process.env.TIKTOK_APP_ID || "").trim();
  const secret = (process.env.TIKTOK_APP_SECRET || "").trim();
  return appId && secret ? { appId, secret } : null;
}

// ── encryption ────────────────────────────────────────────────────────────────

function encKey(): Buffer | null {
  const raw = (process.env.TIKTOK_ENC_KEY || process.env.OPENAI_ADS_ENC_KEY || "").trim();
  if (!raw) return null;
  const b64 = Buffer.from(raw, "base64");
  if (b64.length === 32) return b64;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}
export const encReady = () => Boolean(encKey());

function encrypt(plain: string): string {
  const key = encKey();
  if (!key) throw new Error("Thiếu TIKTOK_ENC_KEY (hoặc OPENAI_ADS_ENC_KEY) để mã hoá token.");
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

export const errVi = (e: unknown) => (e instanceof Error ? e.message : String(e));
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── OAuth ─────────────────────────────────────────────────────────────────────

export async function newState(by: string): Promise<string> {
  const sql = await getSql();
  const s = randomBytes(24).toString("hex");
  await sql.query(`delete from tiktok_oauth_states where created_at < now() - interval '1 day'`).catch(() => null);
  await sql.query(`insert into tiktok_oauth_states (state, created_by) values ($1, $2)`, [s, by]);
  return s;
}
/** One-time: valid for 15 minutes, deleted on use. */
export async function takeState(state: string): Promise<boolean> {
  if (!/^[0-9a-f]{48}$/.test(state)) return false;
  const sql = await getSql();
  const r = await sql.query<{ state: string }>(`delete from tiktok_oauth_states where state = $1 and created_at > now() - interval '15 minutes' returning state`, [state]);
  return r.length > 0;
}
export function authUrl(appId: string, state: string, redirectUri: string): string {
  const u = new URL("https://business-api.tiktok.com/portal/auth");
  u.searchParams.set("app_id", appId);
  u.searchParams.set("state", state);
  u.searchParams.set("redirect_uri", redirectUri);
  return u.toString();
}

type AdvInfo = { advertiser_id?: string | number; name?: string; currency?: string; timezone?: string; display_timezone?: string; status?: string };

async function upsertAdvertiser(a: AdvInfo, tokenId: number | null): Promise<string> {
  const sql = await getSql();
  const adv = String(a.advertiser_id);
  const id = ttClientId(adv);
  const name = a.name || adv;
  const tz = a.display_timezone || a.timezone || null;
  await sql.query(
    `insert into ad_accounts (id, platform, external_id, display_name, status) values ($1, 'tiktok', $2, $3, $4)
     on conflict (id) do update set display_name = excluded.display_name, status = excluded.status, updated_at = now()`,
    [id, adv, name, a.status === "STATUS_ENABLE" ? "active" : a.status || null],
  );
  await sql.query(
    `insert into tiktok_account_state (client_id, advertiser_id, token_id, name, currency, timezone, status, checked_at, error)
     values ($1,$2,$3,$4,$5,$6,$7, now(), null)
     on conflict (client_id) do update set advertiser_id = excluded.advertiser_id, token_id = coalesce(excluded.token_id, tiktok_account_state.token_id),
       name = excluded.name, currency = excluded.currency, timezone = excluded.timezone, status = excluded.status, checked_at = now(), error = null`,
    [id, adv, tokenId, name, a.currency || null, tz, a.status || null],
  );
  return id;
}

async function advertiserInfo(token: string, ids: string[]): Promise<AdvInfo[]> {
  const out: AdvInfo[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await ttGet<{ list?: AdvInfo[] }>(token, "/advertiser/info/", {
      advertiser_ids: ids.slice(i, i + 100),
      fields: ["advertiser_id", "name", "currency", "timezone", "display_timezone", "status"],
    });
    out.push(...(r.list || []));
  }
  return out;
}

/** OAuth callback: exchange auth_code, store the token encrypted, upsert every authorized advertiser. Never returns the token. */
export async function connectFromCode(authCode: string, by: string): Promise<{ advertisers: Array<{ client_id: string; name: string }> }> {
  const cfg = appConfig();
  if (!cfg) throw new Error("Chưa cấu hình ứng dụng TikTok (TIKTOK_APP_ID / TIKTOK_APP_SECRET).");
  if (!encKey()) throw new Error("Thiếu TIKTOK_ENC_KEY (hoặc OPENAI_ADS_ENC_KEY) để mã hoá token.");
  const ex = await ttExchangeCode(cfg.appId, cfg.secret, authCode);
  const token = String(ex.access_token || "");
  if (!token) throw new Error("TikTok không trả về access token.");
  const sql = await getSql();
  const fp = createHash("sha256").update(token).digest("hex").slice(0, 32);
  const row = await sql.query<{ id: string }>(
    `insert into tiktok_tokens (token_enc, token_fp, scope, created_by, last_ok_at) values ($1,$2,$3::jsonb,$4, now())
     on conflict (token_fp) do update set token_enc = excluded.token_enc, scope = excluded.scope, created_by = excluded.created_by, updated_at = now(), last_ok_at = now(), last_error = null
     returning id`,
    [encrypt(token), fp, JSON.stringify(ex.scope ?? null), by],
  );
  const tokenId = Number(row[0].id);
  let ids = (ex.advertiser_ids || []).map(String);
  try {
    const r = await ttGet<{ list?: Array<{ advertiser_id?: string | number }> }>(token, "/oauth2/advertiser/get/", { app_id: cfg.appId, secret: cfg.secret });
    const more = (r.list || []).map((x) => String(x.advertiser_id || "")).filter(Boolean);
    ids = [...new Set([...ids, ...more])];
  } catch { /* token response list is enough */ }
  const infos: AdvInfo[] = ids.length ? await advertiserInfo(token, ids).catch(() => ids.map((id): AdvInfo => ({ advertiser_id: id }))) : [];
  const advertisers: Array<{ client_id: string; name: string }> = [];
  for (const a of infos) {
    if (!a.advertiser_id) continue;
    advertisers.push({ client_id: await upsertAdvertiser(a, tokenId), name: a.name || String(a.advertiser_id) });
  }
  return { advertisers };
}

async function tokenFor(clientId: string): Promise<{ token: string; tokenId: number; advertiserId: string; tz: string } | null> {
  const sql = await getSql();
  const r = await sql.query<{ advertiser_id: string; token_id: string | null; token_enc: string | null; timezone: string | null }>(
    `select s.advertiser_id, s.token_id, t.token_enc, s.timezone from tiktok_account_state s left join tiktok_tokens t on t.id = s.token_id where s.client_id = $1`,
    [clientId],
  );
  const token = r[0]?.token_enc ? decrypt(r[0].token_enc) : null;
  return token ? { token, tokenId: Number(r[0].token_id), advertiserId: r[0].advertiser_id, tz: r[0].timezone || DEFAULT_TZ } : null;
}

export type TTConnection = { client_id: string; advertiser_id: string; name: string | null; currency: string | null; created_by: string | null; last_ok_at: string | null; error: string | null; insights_through: string | null };
export async function listConnections(): Promise<TTConnection[]> {
  const sql = await getSql();
  const r = await sql.query<Record<string, unknown>>(
    `select s.client_id, s.advertiser_id, s.name, s.currency, t.created_by, t.last_ok_at, coalesce(s.error, t.last_error) as error, s.insights_through
       from tiktok_account_state s left join tiktok_tokens t on t.id = s.token_id order by s.name`,
  ).catch(() => []);
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
  return r.map((x) => ({
    client_id: String(x.client_id), advertiser_id: String(x.advertiser_id), name: (x.name as string) ?? null, currency: (x.currency as string) ?? null,
    created_by: (x.created_by as string) ?? null, last_ok_at: iso(x.last_ok_at), error: (x.error as string) ?? null,
    insights_through: x.insights_through instanceof Date ? x.insights_through.toISOString().slice(0, 10) : (x.insights_through as string) ?? null,
  }));
}

// ── structure ─────────────────────────────────────────────────────────────────

type Paged<T> = { list?: T[]; page_info?: { page?: number; total_page?: number } };
async function listAll<T>(token: string, path: string, advertiserId: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await ttGet<Paged<T>>(token, path, { advertiser_id: advertiserId, page, page_size: 1000 });
    out.push(...(r.list || []));
    if (!r.page_info?.total_page || page >= r.page_info.total_page) break;
  }
  return out;
}

type Ent = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

async function syncStructure(clientId: string, token: string, advertiserId: string): Promise<void> {
  const [camps, groups, ads] = await Promise.all([
    listAll<Ent>(token, "/campaign/get/", advertiserId),
    listAll<Ent>(token, "/adgroup/get/", advertiserId),
    listAll<Ent>(token, "/ad/get/", advertiserId),
  ]);
  const sql = await getSql();
  const rows: Array<[string, string, string | null, string | null, string | null, string | null, unknown]> = [];
  for (const c of camps) rows.push(["campaign", String(c.campaign_id), null, null, s(c.campaign_name), s(c.secondary_status) || s(c.operation_status), c]);
  for (const g of groups) rows.push(["ad_group", String(g.adgroup_id), s(g.campaign_id), null, s(g.adgroup_name), s(g.secondary_status) || s(g.operation_status), g]);
  for (const a of ads) rows.push(["ad", String(a.ad_id), s(a.campaign_id), s(a.adgroup_id), s(a.ad_name), s(a.secondary_status) || s(a.operation_status), a]);
  await sql.query(`delete from tiktok_entities where client_id = $1`, [clientId]);
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300).map(([level, entity_id, campaign_id, ad_group_id, name, status, raw]) => ({ level, entity_id, campaign_id, ad_group_id, name, status, raw: { v: TT_META_VERSION, obj: raw } }));
    await sql.query(
      `insert into tiktok_entities (client_id, level, entity_id, campaign_id, ad_group_id, name, status, raw)
       select $1, x.level, x.entity_id, x.campaign_id, x.ad_group_id, x.name, x.status, x.raw
         from jsonb_to_recordset($2::jsonb) as x(level text, entity_id text, campaign_id text, ad_group_id text, name text, status text, raw jsonb)
       on conflict (client_id, level, entity_id) do update set campaign_id = excluded.campaign_id, ad_group_id = excluded.ad_group_id,
         name = excluded.name, status = excluded.status, raw = excluded.raw, updated_at = now()`,
      [clientId, JSON.stringify(chunk)],
    );
  }
}

// ── insights ──────────────────────────────────────────────────────────────────

const LEVELS = [
  { lv: "account", data_level: "AUCTION_ADVERTISER", dim: "advertiser_id" },
  { lv: "campaign", data_level: "AUCTION_CAMPAIGN", dim: "campaign_id" },
  { lv: "ad_group", data_level: "AUCTION_ADGROUP", dim: "adgroup_id" },
  { lv: "ad", data_level: "AUCTION_AD", dim: "ad_id" },
] as const;
const METRICS = ["spend", "impressions", "reach", "clicks", "conversion", "video_play_actions", "video_watched_2s", "video_watched_6s", "video_views_p100"];
type RepRow = { dimensions?: Record<string, unknown>; metrics?: Record<string, unknown> };

async function report(token: string, advertiserId: string, dataLevel: string, dims: string[], metrics: string[], start: string, end: string): Promise<RepRow[]> {
  const out: RepRow[] = [];
  for (let page = 1; page <= 100; page++) {
    const r = await ttGet<Paged<RepRow>>(token, "/report/integrated/get/", {
      advertiser_id: advertiserId, report_type: "BASIC", data_level: dataLevel, dimensions: dims, metrics,
      start_date: start, end_date: end, page, page_size: 1000,
    }, 60_000);
    out.push(...(r.list || []));
    if (!r.page_info?.total_page || page >= r.page_info.total_page) break;
  }
  return out;
}

async function syncInsights(clientId: string, token: string, advertiserId: string, since: string, until: string): Promise<number> {
  const sql = await getSql();
  const ents = await sql.query<{ level: string; entity_id: string; campaign_id: string | null; ad_group_id: string | null }>(
    `select level, entity_id, campaign_id, ad_group_id from tiktok_entities where client_id = $1`, [clientId]);
  const parent = new Map(ents.map((e) => [`${e.level}|${e.entity_id}`, e]));
  let n = 0;
  for (let from = since; from <= until; from = addDaysYmd(from, CHUNK_DAYS)) {
    const to = addDaysYmd(from, CHUNK_DAYS - 1) < until ? addDaysYmd(from, CHUNK_DAYS - 1) : until;
    for (const L of LEVELS) {
      const rows = await report(token, advertiserId, L.data_level, [L.dim, "stat_time_day"], METRICS, from, to);
      // Leads (instant form) are optional: an unsupported metric never blocks the core numbers.
      const leads = new Map<string, number | null>();
      try {
        for (const r of await report(token, advertiserId, L.data_level, [L.dim, "stat_time_day"], ["onsite_form"], from, to)) {
          leads.set(`${r.dimensions?.[L.dim]}|${String(r.dimensions?.stat_time_day || "").slice(0, 10)}`, num(r.metrics?.onsite_form));
        }
      } catch { /* leave null */ }
      const put = rows.map((r) => {
        const id = String(r.dimensions?.[L.dim] ?? "");
        const date = String(r.dimensions?.stat_time_day || "").slice(0, 10);
        const m = r.metrics || {};
        const p = parent.get(`${L.lv}|${id}`);
        return {
          level: L.lv, entity_id: id, date, campaign_id: p?.campaign_id ?? (L.lv === "campaign" ? id : null), ad_group_id: p?.ad_group_id ?? (L.lv === "ad_group" ? id : null),
          spend: num(m.spend), impressions: num(m.impressions), reach: num(m.reach), clicks: num(m.clicks), conversions: num(m.conversion),
          video_play_actions: num(m.video_play_actions), video_watched_2s: num(m.video_watched_2s), video_watched_6s: num(m.video_watched_6s), video_views_p100: num(m.video_views_p100),
          leads: leads.has(`${id}|${date}`) ? leads.get(`${id}|${date}`) : null,
        };
      }).filter((x) => x.entity_id && /^\d{4}-\d{2}-\d{2}$/.test(x.date));
      await sql.query(`delete from tiktok_insights_daily where client_id = $1 and level = $2 and date between $3 and $4`, [clientId, L.lv, from, to]);
      for (let i = 0; i < put.length; i += 500) {
        await sql.query(
          `insert into tiktok_insights_daily (client_id, level, entity_id, date, campaign_id, ad_group_id, spend, impressions, reach, clicks, conversions,
             video_play_actions, video_watched_2s, video_watched_6s, video_views_p100, leads)
           select $1, x.level, x.entity_id, x.date::date, x.campaign_id, x.ad_group_id, x.spend, x.impressions, x.reach, x.clicks, x.conversions,
             x.video_play_actions, x.video_watched_2s, x.video_watched_6s, x.video_views_p100, x.leads
             from jsonb_to_recordset($2::jsonb) as x(level text, entity_id text, date text, campaign_id text, ad_group_id text, spend numeric, impressions numeric,
               reach numeric, clicks numeric, conversions numeric, video_play_actions numeric, video_watched_2s numeric, video_watched_6s numeric, video_views_p100 numeric, leads numeric)
           on conflict (client_id, level, entity_id, date) do nothing`,
          [clientId, JSON.stringify(put.slice(i, i + 500))],
        );
      }
      n += put.length;
    }
  }
  return n;
}

/** Full read-only refresh of one advertiser (facts, structure, last ~35 days; 90 days on first pull). */
export async function refreshTikTokAccount(clientId: string): Promise<{ ok: boolean; error_vi: string | null; rows?: number }> {
  const sql = await getSql();
  const k = await tokenFor(clientId).catch(() => null);
  if (!k) return { ok: false, error_vi: "Chưa có token TikTok cho tài khoản này (kết nối lại trong Phân quyền)." };
  try {
    const [info] = await advertiserInfo(k.token, [k.advertiserId]);
    if (info) await upsertAdvertiser(info, k.tokenId);
    const tz = info?.display_timezone || info?.timezone || k.tz;
    const st = await sql.query<{ insights_through: unknown }>(`select insights_through from tiktok_account_state where client_id = $1`, [clientId]);
    let until: string;
    try { until = ymdInTz(tz); } catch { until = ymdInTz(DEFAULT_TZ); }
    const since = addDaysYmd(until, -((st[0]?.insights_through ? REFRESH_DAYS : INITIAL_DAYS) - 1));
    await syncStructure(clientId, k.token, k.advertiserId);
    const rows = await syncInsights(clientId, k.token, k.advertiserId, since, until);
    await sql.query(
      `update tiktok_account_state set insights_through = $2, history_from = least(coalesce(history_from, $3::date), $3::date), checked_at = now(), error = null where client_id = $1`,
      [clientId, until, since],
    );
    await sql.query(`update tiktok_tokens set last_ok_at = now(), last_error = null where id = $1`, [k.tokenId]);
    return { ok: true, error_vi: null, rows };
  } catch (e) {
    const msg = errVi(e);
    await sql.query(`update tiktok_account_state set error = $2, checked_at = now() where client_id = $1`, [clientId, msg]).catch(() => null);
    if (e instanceof TikTokError && (e.code === 40001 || e.code === 40100 || e.code === 40104 || e.code === 40105)) {
      await sql.query(`update tiktok_tokens set last_error = $2 where id = $1`, [k.tokenId, msg]).catch(() => null);
    }
    return { ok: false, error_vi: msg };
  }
}

export async function tiktokClientIds(): Promise<string[]> {
  const sql = await getSql();
  const r = await sql.query<{ client_id: string }>(`select client_id from tiktok_account_state order by checked_at nulls first`).catch(() => [] as { client_id: string }[]);
  return r.map((x) => x.client_id);
}

/** Nightly: every connected advertiser, oldest check first, within the cron deadline. */
export async function refreshAllTikTok(deadline: number): Promise<{ accounts: number; done: number; errors: string[]; configured: boolean }> {
  const ids = await tiktokClientIds();
  const errors: string[] = [];
  let done = 0;
  for (const id of ids) {
    if (Date.now() > deadline) break;
    const r = await refreshTikTokAccount(id);
    if (r.ok) done += 1; else errors.push(`${id}: ${r.error_vi}`);
  }
  return { accounts: ids.length, done, errors, configured: Boolean(appConfig()) };
}

/** Reach for a date range (not additive across days): one report per level without the day dimension. Best effort. */
export async function liveReach(clientId: string, start: string, end: string): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const k = await tokenFor(clientId).catch(() => null);
  if (!k) return out;
  await Promise.all(LEVELS.map(async (L) => {
    try {
      for (const r of await report(k.token, k.advertiserId, L.data_level, [L.dim], ["reach"], start, end)) {
        const id = String(r.dimensions?.[L.dim] ?? "");
        if (id) out.set(`${L.lv}|${id}`, num(r.metrics?.reach));
      }
    } catch { /* blank */ }
  }));
  return out;
}

// ── creative thumbnail (read-only proxy) ────────────────────────────────────────

const OK_HOSTS = [".tiktokcdn.com", ".tiktokcdn-us.com", ".tiktokcdn-eu.com", ".ibyteimg.com", ".byteimg.com", ".tiktokv.com", ".ttwstatic.com", ".muscdn.com", ".bytedance.com"];
const imgCache = new Map<string, { at: number; body: ArrayBuffer; type: string }>();
const IMG_TTL_MS = 10 * 60 * 1000;

/** Video cover or first image of one ad. Always asks TikTok for a fresh (signed) URL. null when none. */
export async function adThumb(clientId: string, adId: string): Promise<{ body: ArrayBuffer; type: string } | null> {
  if (!/^\d{1,25}$/.test(adId)) return null;
  const ck = `${clientId}|${adId}`;
  const hit = imgCache.get(ck);
  if (hit && Date.now() - hit.at < IMG_TTL_MS) return hit;
  const k = await tokenFor(clientId);
  if (!k) return null;
  const sql = await getSql();
  const r = await sql.query<{ raw: { obj?: Record<string, unknown> } | null }>(`select raw from tiktok_entities where client_id = $1 and level = 'ad' and entity_id = $2`, [clientId, adId]);
  const o = r[0]?.raw?.obj;
  if (!o) return null;
  let url: string | null = null;
  if (o.video_id) {
    const v = await ttGet<{ list?: Array<{ video_cover_url?: string; poster_url?: string }> }>(k.token, "/file/video/ad/info/", { advertiser_id: k.advertiserId, video_ids: [String(o.video_id)] });
    url = v.list?.[0]?.video_cover_url || v.list?.[0]?.poster_url || null;
  } else if (Array.isArray(o.image_ids) && o.image_ids.length) {
    const im = await ttGet<{ list?: Array<{ image_url?: string }> }>(k.token, "/file/image/ad/info/", { advertiser_id: k.advertiserId, image_ids: [String(o.image_ids[0])] });
    url = im.list?.[0]?.image_url || null;
  }
  if (!url) return null;
  const u = new URL(url);
  if (u.protocol !== "https:" || !OK_HOSTS.some((h) => u.hostname.endsWith(h))) return null;
  const res = await fetch(u, { method: "GET", headers: { "User-Agent": "AdsOps/1.0 (+https://ad.fagogroup.vn)" } });
  if (!res.ok) return null;
  const type = res.headers.get("content-type") || "image/jpeg";
  if (!type.startsWith("image/")) return null;
  const got = { body: await res.arrayBuffer(), type };
  if (imgCache.size > 200) imgCache.clear();
  imgCache.set(ck, { at: Date.now(), ...got });
  return got;
}

export { TikTokError };
