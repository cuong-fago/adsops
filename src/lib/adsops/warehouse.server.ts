/**
 * Pull Google Ads daily analytics warehouse (default 180d) and persist to Neon.
 * Read-only GAQL only — never mutates Google Ads.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getSql } from "@/lib/db";
import type { AnalyticsSnap, BudgetPace, DailyRow } from "./analytics.ts";
import type { Json } from "./connect.types.ts";

export const ANALYTICS_LOOKBACK_DAYS_DEFAULT = 180;
export const ANALYTICS_LOOKBACK_DAYS_MAX = 365;
/** Search-term layer is heavy; pull a shorter window best-effort. */
const SEARCH_TERM_LOOKBACK_CAP = 90;

const CLIENT_ID_RE = /^[a-z0-9_]+$/;
const MCC_ID = "5321450531";
const API_VERSIONS = ["v22", "v21", "v20", "v19", "v18", "v23", "v24", "v25", "v17"];
const SECRET_DIR = "/workspace/.secrets";
const SECRET_FILE = join(SECRET_DIR, "adsops-google-ads.json");

const KNOWN: Record<string, { client_id: string; display_name: string }> = {
  "6810292395": { client_id: "tkqc_6810292395", display_name: "GrowVi" },
  "2204136068": {
    client_id: "fago_group",
    display_name: "Cty TNHH Giải Pháp Thương Mại Fago Group (006)",
  },
};

type Secrets = {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  login_customer_id?: string;
  developer_token?: string;
};

export type PullAnalyticsWarehouseResult = {
  ok: boolean;
  client_id?: string;
  analytics?: AnalyticsSnap | null;
  lookback_days?: number;
  warehouse_start?: string | null;
  warehouse_end?: string | null;
  day_count?: number;
  layers?: {
    account: number;
    campaign: number;
    ad_group: number;
    keyword: number;
    search_term: number;
  };
  persisted_neon?: boolean;
  persisted_fs?: boolean;
  error_vi?: string | null;
  note_vi?: string | null;
};

function redact(text: string): string {
  if (!text) return "";
  if (/ya29\.|1\/\/|client_secret|developer.token|refresh_token|Bearer |ENOENT|spawn python/i.test(text)) {
    return "(đã ẩn nội dung nhạy cảm)";
  }
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function digits(raw: string | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

function nowIso() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const mm = String(Math.abs(off) % 60).padStart(2, "0");
  const local = new Date(d.getTime() + off * 60000);
  return `${local.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}

function saigonYmd(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Saigon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDaysYmd(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00+07:00`);
  d.setTime(d.getTime() + days * 86400000);
  return saigonYmd(d);
}

function loadSecrets(): Secrets {
  let fromFile: Secrets = {};
  try {
    if (existsSync(SECRET_FILE)) {
      const raw = JSON.parse(readFileSync(SECRET_FILE, "utf8")) as Secrets;
      if (raw && typeof raw === "object") fromFile = raw;
    }
  } catch {
    /* ignore */
  }
  const fromEnv: Secrets = {
    client_id:
      process.env.GOOGLE_ADS_CLIENT_ID?.trim() ||
      process.env.GOOGLE_ADS_OAUTH_CLIENT_ID?.trim() ||
      undefined,
    client_secret:
      process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() ||
      process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET?.trim() ||
      undefined,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim() || undefined,
    login_customer_id:
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() ||
      process.env.GOOGLE_ADS_MCC_ID?.trim() ||
      undefined,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || undefined,
  };
  // File wins over env when present (local installAndProbe saves here).
  return {
    client_id: fromFile.client_id || fromEnv.client_id,
    client_secret: fromFile.client_secret || fromEnv.client_secret,
    refresh_token: fromFile.refresh_token || fromEnv.refresh_token,
    login_customer_id: fromFile.login_customer_id || fromEnv.login_customer_id || MCC_ID,
    developer_token: fromFile.developer_token || fromEnv.developer_token,
  };
}

function missingKeys(s: Secrets): string[] {
  const miss: string[] = [];
  if (!s.client_id) miss.push("oauth_client_id");
  if (!s.client_secret) miss.push("oauth_client_secret");
  if (!s.refresh_token) miss.push("refresh_token");
  return miss;
}

async function accessToken(secrets: Secrets): Promise<{ token?: string; error?: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: secrets.client_id || "",
    client_secret: secrets.client_secret || "",
    refresh_token: secrets.refresh_token || "",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
  };
  if (json.access_token) return { token: json.access_token };
  if (json.error === "invalid_grant") {
    return {
      error:
        "Refresh token hết hạn hoặc bị thu hồi. Lấy token mới trên tab Kết nối. Không dán token vào chat.",
    };
  }
  return { error: "Không lấy được quyền Google. Kiểm tra 3 ô OAuth trên tab Kết nối." };
}

function adsHeaders(token: string, loginId: string, developerToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "login-customer-id": loginId,
  };
  if (developerToken) headers["developer-token"] = developerToken;
  return headers;
}

async function adsFetch(
  version: string,
  path: string,
  token: string,
  loginId: string,
  init?: RequestInit,
  developerToken?: string,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`https://googleads.googleapis.com/${version}${path}`, {
    ...init,
    headers: { ...adsHeaders(token, loginId, developerToken), ...(init?.headers || {}) },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

async function pickVersion(
  token: string,
  loginId: string,
  developerToken?: string,
): Promise<{ version: string } | { error: string }> {
  for (const version of API_VERSIONS) {
    const hit = await adsFetch(
      version,
      "/customers:listAccessibleCustomers",
      token,
      loginId,
      { method: "GET" },
      developerToken,
    );
    if (hit.status === 404) continue;
    if (hit.ok) return { version };
    if (hit.status === 401 || hit.status === 403) {
      return { error: "Google từ chối quyền. Kiểm tra OAuth và quyền MCC trên tab Kết nối." };
    }
  }
  return { error: "Không gọi được Google Ads API." };
}

async function searchRows(
  version: string,
  customerId: string,
  token: string,
  loginId: string,
  query: string,
  developerToken?: string,
  maxPages = 50,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let pageToken = "";
  for (let i = 0; i < maxPages; i += 1) {
    const hit = await adsFetch(
      version,
      `/customers/${customerId}/googleAds:search`,
      token,
      loginId,
      {
        method: "POST",
        body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
      },
      developerToken,
    );
    if (!hit.ok) {
      const msg = JSON.stringify(hit.json);
      throw new Error(redact(msg) || `GAQL lỗi HTTP ${hit.status}`);
    }
    const results = Array.isArray(hit.json.results) ? (hit.json.results as Record<string, unknown>[]) : [];
    rows.push(...results);
    const next = String(hit.json.nextPageToken || "");
    if (!next) break;
    pageToken = next;
  }
  return rows;
}

function customerIdFor(clientId: string): string {
  if (clientId === "fago_group") return "2204136068";
  const known = Object.entries(KNOWN).find(([, v]) => v.client_id === clientId);
  if (known) return known[0];
  return digits(clientId.replace(/^tkqc_/, ""));
}

function asRec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function numField(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function microsToCurrency(micros: unknown): number {
  return numField(micros) / 1_000_000;
}

type ConvBucket = "conv_call" | "conv_zalo" | "conv_facebook_chat" | "conv_form" | "conv_other";

function classifyAction(name: string): ConvBucket | null {
  const n = name.toLowerCase();
  if (!name.trim()) return null;
  if (/^all conversions$/i.test(name.trim())) return null;
  if (/page\s*view|lượt xem trang|website visit/i.test(n)) return null;
  if (/gọi|goi điện|call|phone|điện thoại|dien thoai/i.test(n)) return "conv_call";
  if (/zalo/i.test(n)) return "conv_zalo";
  if (/facebook|messenger|fb\s*chat/i.test(n)) return "conv_facebook_chat";
  if (/form|đăng ký|dang ky|submit|lead form/i.test(n)) return "conv_form";
  return "conv_other";
}

const METRIC_DEFS = [
  { id: "cost", label: "Chi tiêu" },
  { id: "impressions", label: "Hiển thị" },
  { id: "clicks", label: "Click" },
  { id: "invalid_clicks", label: "Click không hợp lệ" },
  { id: "invalid_click_rate", label: "Tỷ lệ click không hợp lệ" },
  { id: "cpc", label: "CPC" },
  { id: "conversions", label: "Chuyển đổi" },
  { id: "conv_other", label: "Chuyển đổi Google" },
  { id: "cost_per_conversion", label: "Chi phí/chuyển đổi" },
  { id: "ctr", label: "CTR" },
  { id: "cr", label: "CR" },
];

function emptyConv(): Record<ConvBucket, number> {
  return {
    conv_call: 0,
    conv_zalo: 0,
    conv_facebook_chat: 0,
    conv_form: 0,
    conv_other: 0,
  };
}

function channelType(raw: string): string {
  const t = String(raw || "").toUpperCase();
  if (t.includes("PERFORMANCE_MAX") || t === "PERFORMANCE_MAX") return "PERFORMANCE_MAX";
  if (t.includes("SEARCH")) return "SEARCH";
  if (t.includes("DISPLAY")) return "DISPLAY";
  if (t.includes("VIDEO")) return "VIDEO";
  if (t.includes("SHOPPING")) return "SHOPPING";
  if (t.includes("DEMAND_GEN")) return "DEMAND_GEN";
  return t || "UNKNOWN";
}

function statusCode(raw: string): string {
  const s = String(raw || "").toUpperCase();
  if (s.includes("ENABLED")) return "ENABLED";
  if (s.includes("PAUSED")) return "PAUSED";
  if (s.includes("REMOVED")) return "REMOVED";
  return s || "UNKNOWN";
}

function publicDirs(): string[] {
  return [
    "/workspace/public/adsops",
    join(process.cwd(), "public/adsops"),
    join(process.cwd(), "src/lib/adsops/snapshots"),
  ];
}

async function persistNeon(snap: AnalyticsSnap, lookback: number): Promise<boolean> {
  try {
    const sql = await getSql();
    await sql.query(
      `insert into adsops_analytics_warehouse
         (client_id, payload, pulled_at, warehouse_start, warehouse_end, lookback_days)
       values ($1, $2::jsonb, now(), $3::date, $4::date, $5)
       on conflict (client_id) do update set
         payload = excluded.payload,
         pulled_at = excluded.pulled_at,
         warehouse_start = excluded.warehouse_start,
         warehouse_end = excluded.warehouse_end,
         lookback_days = excluded.lookback_days`,
      [
        snap.client_id,
        JSON.stringify(snap),
        snap.warehouse_start,
        snap.warehouse_end,
        lookback,
      ],
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/adsops_analytics_warehouse|does not exist|relation/i.test(msg)) {
      throw new Error(
        "Thiếu bảng adsops_analytics_warehouse trên Neon. Chạy npm run db:migrate (hoặc để Vercel build chạy migrate).",
      );
    }
    throw err;
  }
}

function persistFs(snap: AnalyticsSnap): boolean {
  let wrote = false;
  for (const base of publicDirs()) {
    try {
      const dir = join(base, "analytics");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${snap.client_id}.json`), `${JSON.stringify(snap, null, 2)}\n`);
      // Best-effort registry summary
      try {
        const regPath = join(base, "analytics-registry.json");
        let reg: Record<string, unknown> = {
          product: "AdsOps",
          module: "analytics",
          rule: "Chọn A không thấy số B. Không đoán kho cho tài khoản chưa kéo.",
          clients: [],
        };
        if (existsSync(regPath)) {
          reg = JSON.parse(readFileSync(regPath, "utf8")) as Record<string, unknown>;
        }
        const clients = Array.isArray(reg.clients) ? [...reg.clients] : [];
        const row = {
          client_id: snap.client_id,
          display_name: snap.display_name,
          data_through: snap.data_through,
          warehouse_start: snap.warehouse_start,
          warehouse_end: snap.warehouse_end,
          day_count: snap.day_count,
          analytics_lookback_days: snap.analytics_lookback_days,
        };
        const idx = clients.findIndex(
          (c) => c && typeof c === "object" && (c as { client_id?: string }).client_id === snap.client_id,
        );
        if (idx >= 0) clients[idx] = row;
        else clients.push(row);
        reg.clients = clients;
        writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`);
      } catch {
        /* ignore registry */
      }
      wrote = true;
    } catch {
      /* Vercel FS may be read-only */
    }
  }
  return wrote;
}

export async function readAnalyticsWarehouseFromNeon(clientId: string): Promise<Json | null> {
  if (!CLIENT_ID_RE.test(clientId)) return null;
  try {
    const sql = await getSql();
    const rows = await sql.query<{ payload: Json }>(
      `select payload from adsops_analytics_warehouse where client_id = $1 limit 1`,
      [clientId],
    );
    return rows[0]?.payload ?? null;
  } catch {
    return null;
  }
}

function stubBudgetPace(clientId: string, timezone: string, currency: string): BudgetPace {
  return {
    module: "budget_pace",
    client_id: clientId,
    separate_from_guard: true,
    blocks_propose: true,
    status: "missing",
    missing_label: "Chưa kéo ngân sách 1 ngày",
    firing: false,
    today: saigonYmd(),
    timezone,
    currency,
    hours_elapsed: 0,
    tickets: [],
    ok: [],
    email: {
      channel: "email",
      to: [],
      subject: "",
      body: "",
      status: "skipped",
      not_merged_with_guard: true,
      sent: false,
      note: "Budget pace tách Guard — chưa kéo trong phiên kho phân tích.",
    },
    formula: "remaining / hours_remaining",
  };
}

export async function pullAnalyticsWarehouse(
  clientId: string,
  lookbackDays = ANALYTICS_LOOKBACK_DAYS_DEFAULT,
): Promise<PullAnalyticsWarehouseResult> {
  const id = clientId.trim();
  if (!CLIENT_ID_RE.test(id)) {
    return { ok: false, error_vi: "Khách không hợp lệ." };
  }
  const lookback = Math.min(
    ANALYTICS_LOOKBACK_DAYS_MAX,
    Math.max(1, Math.floor(Number(lookbackDays) || ANALYTICS_LOOKBACK_DAYS_DEFAULT)),
  );

  try {
    const secrets = loadSecrets();
    const miss = missingKeys(secrets);
    if (miss.length) {
      return {
        ok: false,
        client_id: id,
        error_vi:
          "Chưa có OAuth trên máy/Vercel. Vào tab Kết nối → điền 3 ô → Lưu trên máy rồi thử gọi. Trên Production cần env GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_REFRESH_TOKEN.",
      };
    }

    const tokenHit = await accessToken(secrets);
    if (!tokenHit.token) {
      return { ok: false, client_id: id, error_vi: tokenHit.error || "Không lấy được quyền Google." };
    }

    const loginId = digits(secrets.login_customer_id) || MCC_ID;
    const picked = await pickVersion(tokenHit.token, loginId, secrets.developer_token);
    if ("error" in picked) {
      return { ok: false, client_id: id, error_vi: picked.error };
    }
    const version = picked.version;
    const customerId = customerIdFor(id);
    if (customerId.length !== 10) {
      return { ok: false, client_id: id, error_vi: "Không suy ra Customer ID từ khách." };
    }

    const end = addDaysYmd(saigonYmd(), -1);
    const start = addDaysYmd(end, -(lookback - 1));
    const stStart = addDaysYmd(end, -(Math.min(lookback, SEARCH_TERM_LOOKBACK_CAP) - 1));

    // Customer meta
    const metaRows = await searchRows(
      version,
      customerId,
      tokenHit.token,
      loginId,
      `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1`,
      secrets.developer_token,
      1,
    );
    const cust = asRec(metaRows[0]?.customer);
    const displayName =
      String(cust.descriptiveName || "") ||
      KNOWN[customerId]?.display_name ||
      id;
    const currency = String(cust.currencyCode || "VND");
    const timezone = String(cust.timeZone || "Asia/Saigon");

    // Conversion actions catalog
    const actionRows = await searchRows(
      version,
      customerId,
      tokenHit.token,
      loginId,
      `SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type
       FROM conversion_action
       WHERE conversion_action.status != 'REMOVED'`,
      secrets.developer_token,
      5,
    );
    const actionNameByResource = new Map<string, string>();
    const actionsByBucket: Record<ConvBucket, string[]> = {
      conv_call: [],
      conv_zalo: [],
      conv_facebook_chat: [],
      conv_form: [],
      conv_other: [],
    };
    for (const row of actionRows) {
      const ca = asRec(row.conversionAction);
      const name = String(ca.name || "");
      const caId = String(ca.id || "");
      if (caId) actionNameByResource.set(`customers/${customerId}/conversionActions/${caId}`, name);
      const bucket = classifyAction(name);
      if (bucket && name && !actionsByBucket[bucket].includes(name)) {
        actionsByBucket[bucket].push(name);
      }
    }

    // Campaigns catalog
    const campRows = await searchRows(
      version,
      customerId,
      tokenHit.token,
      loginId,
      `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type
       FROM campaign
       WHERE campaign.status != 'REMOVED'`,
      secrets.developer_token,
      10,
    );
    const campaigns = campRows.map((row) => {
      const c = asRec(row.campaign);
      const type = channelType(String(c.advertisingChannelType || ""));
      return {
        id: String(c.id || ""),
        name: String(c.name || ""),
        type,
        status: statusCode(String(c.status || "")),
        pmax: type === "PERFORMANCE_MAX",
      };
    }).filter((c) => c.id);

    // Account daily
    const accountDailyRows = await searchRows(
      version,
      customerId,
      tokenHit.token,
      loginId,
      `SELECT segments.date, metrics.impressions, metrics.clicks, metrics.invalid_clicks,
              metrics.cost_micros, metrics.conversions
       FROM customer
       WHERE segments.date BETWEEN '${start}' AND '${end}'
       ORDER BY segments.date`,
      secrets.developer_token,
    );

    // Account conversion split by action
    const accountConvRows = await searchRows(
      version,
      customerId,
      tokenHit.token,
      loginId,
      `SELECT segments.date, segments.conversion_action, metrics.conversions
       FROM customer
       WHERE segments.date BETWEEN '${start}' AND '${end}'
         AND metrics.conversions > 0`,
      secrets.developer_token,
    );
    const accountConvByDate = new Map<string, Record<ConvBucket, number>>();
    for (const row of accountConvRows) {
      const seg = asRec(row.segments);
      const date = String(seg.date || "");
      const resource = String(seg.conversionAction || "");
      const name = actionNameByResource.get(resource) || resource.split("/").pop() || "";
      const bucket = classifyAction(name);
      if (!date || !bucket) continue;
      const slot = accountConvByDate.get(date) || emptyConv();
      slot[bucket] += numField(asRec(row.metrics).conversions);
      accountConvByDate.set(date, slot);
    }

    const dailyAccount: DailyRow[] = accountDailyRows.map((row) => {
      const seg = asRec(row.segments);
      const m = asRec(row.metrics);
      const date = String(seg.date || "");
      const conv = accountConvByDate.get(date) || emptyConv();
      return {
        date,
        impressions: numField(m.impressions),
        clicks: numField(m.clicks),
        invalid_clicks: numField(m.invalidClicks),
        cost: microsToCurrency(m.costMicros),
        conversions: numField(m.conversions),
        ...conv,
      };
    });

    // Campaign daily
    const campaignDailyRows = await searchRows(
      version,
      customerId,
      tokenHit.token,
      loginId,
      `SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
              metrics.impressions, metrics.clicks, metrics.invalid_clicks, metrics.cost_micros, metrics.conversions
       FROM campaign
       WHERE segments.date BETWEEN '${start}' AND '${end}'
         AND campaign.status != 'REMOVED'
       ORDER BY segments.date`,
      secrets.developer_token,
    );

    let campaignConvRows: Record<string, unknown>[] = [];
    try {
      campaignConvRows = await searchRows(
        version,
        customerId,
        tokenHit.token,
        loginId,
        `SELECT segments.date, campaign.id, segments.conversion_action, metrics.conversions
         FROM campaign
         WHERE segments.date BETWEEN '${start}' AND '${end}'
           AND metrics.conversions > 0
           AND campaign.status != 'REMOVED'`,
        secrets.developer_token,
      );
    } catch {
      campaignConvRows = [];
    }
    const campConvKey = new Map<string, Record<ConvBucket, number>>();
    for (const row of campaignConvRows) {
      const seg = asRec(row.segments);
      const camp = asRec(row.campaign);
      const date = String(seg.date || "");
      const cid = String(camp.id || "");
      const resource = String(seg.conversionAction || "");
      const name = actionNameByResource.get(resource) || "";
      const bucket = classifyAction(name);
      if (!date || !cid || !bucket) continue;
      const key = `${date}|${cid}`;
      const slot = campConvKey.get(key) || emptyConv();
      slot[bucket] += numField(asRec(row.metrics).conversions);
      campConvKey.set(key, slot);
    }

    const dailyCampaign: DailyRow[] = campaignDailyRows.map((row) => {
      const seg = asRec(row.segments);
      const c = asRec(row.campaign);
      const m = asRec(row.metrics);
      const date = String(seg.date || "");
      const cid = String(c.id || "");
      const conv = campConvKey.get(`${date}|${cid}`) || emptyConv();
      const type = channelType(String(c.advertisingChannelType || ""));
      return {
        date,
        campaign_id: cid,
        campaign_name: String(c.name || ""),
        campaign_type: type,
        status: statusCode(String(c.status || "")),
        impressions: numField(m.impressions),
        clicks: numField(m.clicks),
        invalid_clicks: numField(m.invalidClicks),
        cost: microsToCurrency(m.costMicros),
        conversions: numField(m.conversions),
        ...conv,
      };
    });

    // Ad groups — full window best-effort
    let dailyAdGroup: DailyRow[] = [];
    let adGroups: AnalyticsSnap["ad_groups"] = [];
    try {
      const agMeta = await searchRows(
        version,
        customerId,
        tokenHit.token,
        loginId,
        `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id
         FROM ad_group
         WHERE ad_group.status != 'REMOVED'`,
        secrets.developer_token,
        10,
      );
      adGroups = agMeta.map((row) => {
        const ag = asRec(row.adGroup);
        const c = asRec(row.campaign);
        return {
          id: String(ag.id || ""),
          name: String(ag.name || ""),
          campaign_id: String(c.id || ""),
          status: statusCode(String(ag.status || "")),
        };
      }).filter((g) => g.id);

      const agDaily = await searchRows(
        version,
        customerId,
        tokenHit.token,
        loginId,
        `SELECT segments.date, campaign.id, ad_group.id, ad_group.name, ad_group.status,
                metrics.impressions, metrics.clicks, metrics.invalid_clicks, metrics.cost_micros, metrics.conversions
         FROM ad_group
         WHERE segments.date BETWEEN '${start}' AND '${end}'
           AND ad_group.status != 'REMOVED'`,
        secrets.developer_token,
      );
      dailyAdGroup = agDaily.map((row) => {
        const seg = asRec(row.segments);
        const c = asRec(row.campaign);
        const ag = asRec(row.adGroup);
        const m = asRec(row.metrics);
        return {
          date: String(seg.date || ""),
          campaign_id: String(c.id || ""),
          ad_group_id: String(ag.id || ""),
          ad_group_name: String(ag.name || ""),
          status: statusCode(String(ag.status || "")),
          impressions: numField(m.impressions),
          clicks: numField(m.clicks),
          invalid_clicks: numField(m.invalidClicks),
          cost: microsToCurrency(m.costMicros),
          conversions: numField(m.conversions),
          ...emptyConv(),
        };
      });
    } catch {
      dailyAdGroup = [];
      adGroups = [];
    }

    // Keyword — full window best-effort
    let dailyKeyword: DailyRow[] = [];
    try {
      const kwDaily = await searchRows(
        version,
        customerId,
        tokenHit.token,
        loginId,
        `SELECT segments.date, campaign.id, ad_group.id, ad_group_criterion.criterion_id,
                ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                ad_group_criterion.status,
                metrics.impressions, metrics.clicks, metrics.invalid_clicks, metrics.cost_micros, metrics.conversions
         FROM keyword_view
         WHERE segments.date BETWEEN '${start}' AND '${end}'
           AND ad_group_criterion.status != 'REMOVED'`,
        secrets.developer_token,
        40,
      );
      dailyKeyword = kwDaily.map((row) => {
        const seg = asRec(row.segments);
        const c = asRec(row.campaign);
        const ag = asRec(row.adGroup);
        const crit = asRec(row.adGroupCriterion);
        const kw = asRec(crit.keyword);
        const m = asRec(row.metrics);
        return {
          date: String(seg.date || ""),
          campaign_id: String(c.id || ""),
          ad_group_id: String(ag.id || ""),
          keyword_id: String(crit.criterionId || ""),
          keyword_text: String(kw.text || ""),
          match_type: String(kw.matchType || "").replace(/^KEYWORD_MATCH_TYPE_/, ""),
          status: statusCode(String(crit.status || "")),
          impressions: numField(m.impressions),
          clicks: numField(m.clicks),
          invalid_clicks: numField(m.invalidClicks),
          cost: microsToCurrency(m.costMicros),
          conversions: numField(m.conversions),
          ...emptyConv(),
        };
      });
    } catch {
      dailyKeyword = [];
    }

    // Search terms — capped window best-effort
    let dailySearchTerm: DailyRow[] = [];
    let stNote = "";
    try {
      const stDaily = await searchRows(
        version,
        customerId,
        tokenHit.token,
        loginId,
        `SELECT segments.date, campaign.id, campaign.name, ad_group.id,
                search_term_view.search_term, segments.search_term_match_type,
                metrics.impressions, metrics.clicks, metrics.invalid_clicks, metrics.cost_micros, metrics.conversions
         FROM search_term_view
         WHERE segments.date BETWEEN '${stStart}' AND '${end}'`,
        secrets.developer_token,
        40,
      );
      dailySearchTerm = stDaily.map((row) => {
        const seg = asRec(row.segments);
        const c = asRec(row.campaign);
        const ag = asRec(row.adGroup);
        const st = asRec(row.searchTermView);
        const m = asRec(row.metrics);
        return {
          date: String(seg.date || ""),
          campaign_id: String(c.id || ""),
          campaign_name: String(c.name || ""),
          ad_group_id: String(ag.id || ""),
          query: String(st.searchTerm || ""),
          match_type: String(seg.searchTermMatchType || "").replace(/^SEARCH_TERM_MATCH_TYPE_/, ""),
          impressions: numField(m.impressions),
          clicks: numField(m.clicks),
          invalid_clicks: numField(m.invalidClicks),
          cost: microsToCurrency(m.costMicros),
          conversions: numField(m.conversions),
          ...emptyConv(),
        };
      });
      if (stStart !== start) {
        stNote = ` Search term chỉ kéo ${SEARCH_TERM_LOOKBACK_CAP} ngày gần nhất (${stStart}→${end}).`;
      }
    } catch {
      dailySearchTerm = [];
      stNote = " Chưa kéo được search term trong phiên này.";
    }

    const conversion_groups = {
      attribution: "DATA_DRIVEN",
      rule:
        "Nhóm Gọi / Zalo / Facebook chat / Form / Khác theo tên hành động Google Ads — không hard-code khách. All conversions không lên màn. CPA Google ≠ Qualified Lead.",
      groups: [
        { id: "call", label: "Gọi", metric: "conv_call", actions: actionsByBucket.conv_call },
        { id: "zalo", label: "Zalo", metric: "conv_zalo", actions: actionsByBucket.conv_zalo },
        {
          id: "facebook_chat",
          label: "Facebook chat",
          metric: "conv_facebook_chat",
          actions: actionsByBucket.conv_facebook_chat,
        },
        { id: "form", label: "Form", metric: "conv_form", actions: actionsByBucket.conv_form },
        { id: "other", label: "Khác", metric: "conv_other", actions: actionsByBucket.conv_other },
      ],
      skipped: [
        { action: "All conversions", reason: "không lên màn Phân tích" },
        { action: "page view / secondary", reason: "không lên màn Phân tích" },
      ],
    };

    const day_count = dailyAccount.length;
    const hasPmax = campaigns.some((c) => c.pmax);
    const snap: AnalyticsSnap = {
      client_id: id,
      display_name: displayName,
      customer_id: customerId,
      timezone,
      currency,
      adapter: "live",
      data_through: end,
      warehouse_start: start,
      warehouse_end: end,
      pmax_note: hasPmax
        ? "PMax không có search term / keyword chuẩn"
        : "không có search term / keyword chuẩn",
      metrics: METRIC_DEFS,
      conversion_groups: {
        groups: conversion_groups.groups,
        skipped: conversion_groups.skipped,
      },
      campaigns,
      ad_groups: adGroups,
      daily: {
        account: dailyAccount,
        campaign: dailyCampaign,
        ad_group: dailyAdGroup,
        keyword: dailyKeyword,
        search_term: dailySearchTerm,
      },
      week_choices: [3, 5, 7],
      month_choices: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      rules: {
        primary_conversions_only: true,
        missing_label: "Thiếu dữ liệu",
        never_fill_missing_with_zero: true,
        sort: "cost_desc",
        week: "monday_sunday",
        source_note: `${lookback} ngày hoàn chỉnh từ Google Ads API (đến hôm qua).${stNote} Không apply.`,
        st_truncated: dailySearchTerm.length === 0 || stStart !== start,
        budget_pace_separate_from_guard: true,
      },
      budget_pace: stubBudgetPace(id, timezone, currency),
      analytics_lookback_days: lookback,
      lookback_days: lookback,
      day_count,
    };
    // Keep extra fields used by existing Strip JSON consumers
    (snap as AnalyticsSnap & { module?: string; consecutive?: boolean }).module = "analytics";
    (snap as AnalyticsSnap & { consecutive?: boolean }).consecutive = day_count === lookback;

    const persisted_neon = await persistNeon(snap, lookback);
    const persisted_fs = persistFs(snap);

    return {
      ok: true,
      client_id: id,
      analytics: snap,
      lookback_days: lookback,
      warehouse_start: start,
      warehouse_end: end,
      day_count,
      layers: {
        account: dailyAccount.length,
        campaign: dailyCampaign.length,
        ad_group: dailyAdGroup.length,
        keyword: dailyKeyword.length,
        search_term: dailySearchTerm.length,
      },
      persisted_neon,
      persisted_fs,
      note_vi: `Đã kéo kho ${lookback} ngày (${start} → ${end}): account ${dailyAccount.length} ngày, campaign ${dailyCampaign.length} dòng.${stNote} Lưu Neon${persisted_neon ? "" : " (lỗi)"}${persisted_fs ? " + file local" : ""}. Không apply.`,
      error_vi: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi kéo kho phân tích.";
    return { ok: false, client_id: id, error_vi: redact(message) };
  }
}
