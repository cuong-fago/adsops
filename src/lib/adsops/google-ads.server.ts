/**
 * Google Ads API client for AdsOps — STRICTLY READ-ONLY.
 *
 * Only these endpoints are ever called:
 *   GET  /{version}/customers:listAccessibleCustomers
 *   POST /{version}/customers/{id}/googleAds:searchStream   (GAQL SELECT only)
 * There is no mutate code path in this module (or anywhere in AdsOps).
 *
 * Credentials:
 *   GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET   (fallback: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
 *   GOOGLE_ADS_REFRESH_TOKEN                          (override; else the token saved by
 *                                                      the admin "Kết nối Google Ads" button, encrypted in Neon)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID                      (MCC, digits; default 5321450531)
 *   GOOGLE_ADS_DEVELOPER_TOKEN                        (optional; sent when set)
 * Secrets are never returned to the browser and never logged.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql } from "@/lib/db";

// Static references so Vercel/Nitro keep these env names in the function bundle.
const ENV = {
  GOOGLE_ADS_CLIENT_ID: process.env.GOOGLE_ADS_CLIENT_ID,
  GOOGLE_ADS_CLIENT_SECRET: process.env.GOOGLE_ADS_CLIENT_SECRET,
  GOOGLE_ADS_REFRESH_TOKEN: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  GOOGLE_ADS_DEVELOPER_TOKEN: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
} as const;

function env(key: keyof typeof ENV): string {
  return String(ENV[key] ?? process.env[key] ?? "").trim();
}

/** Newest first. v25 is the current stable major (Sep 2026); older kept as fallback. */
export const ADS_API_VERSIONS = ["v25", "v24", "v23"] as const;
export const DEFAULT_MCC_ID = "5321450531";
export const ADWORDS_SCOPE = "https://www.googleapis.com/auth/adwords";
export const OAUTH_CALLBACK_PATH = "/api/google-ads/oauth/callback";
const CREDENTIAL_ROW_ID = "default";

export function digits(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

export function dashedId(id: string): string {
  const d = digits(id);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;
}

// ── encryption (refresh token at rest) ────────────────────────────────────────

function encKey(): Buffer | null {
  const secret = env("BETTER_AUTH_SECRET");
  if (!secret) return null;
  return createHash("sha256").update(`adsops:google-ads-refresh-token:v1:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const key = encKey();
  if (!key) throw new Error("Thiếu BETTER_AUTH_SECRET để mã hoá token.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(blob: string): string | null {
  const key = encKey();
  if (!key) return null;
  const [v, iv, tag, ct] = String(blob || "").split(":");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── stored credential (Neon) ─────────────────────────────────────────────────

export type StoredCredentialMeta = {
  google_email: string | null;
  connected_by: string | null;
  connected_at: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  decryptable: boolean;
};

type CredRow = {
  google_email: string | null;
  refresh_token_enc: string;
  connected_by: string | null;
  connected_at: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
};

async function readCredentialRow(): Promise<CredRow | null> {
  try {
    const sql = await getSql();
    const rows = await sql<CredRow>`
      select google_email, refresh_token_enc, connected_by,
             to_char(connected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as connected_at,
             to_char(last_test_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_test_at,
             last_test_ok, last_test_message
      from adsops_google_ads_credential where id = ${CREDENTIAL_ROW_ID} limit 1
    `;
    return rows[0] || null;
  } catch {
    return null;
  }
}

export async function saveStoredCredential(input: {
  refreshToken: string;
  googleEmail: string | null;
  scope: string | null;
  connectedBy: string;
}): Promise<void> {
  const enc = encryptSecret(input.refreshToken);
  const sql = await getSql();
  await sql`
    insert into adsops_google_ads_credential (id, google_email, refresh_token_enc, scope, connected_by, connected_at,
                                              last_test_at, last_test_ok, last_test_message)
    values (${CREDENTIAL_ROW_ID}, ${input.googleEmail}, ${enc}, ${input.scope}, ${input.connectedBy}, now(), null, null, null)
    on conflict (id) do update set
      google_email = excluded.google_email,
      refresh_token_enc = excluded.refresh_token_enc,
      scope = excluded.scope,
      connected_by = excluded.connected_by,
      connected_at = now(),
      last_test_at = null, last_test_ok = null, last_test_message = null
  `;
  tokenCache().clear();
}

export async function deleteStoredCredential(): Promise<void> {
  const sql = await getSql();
  await sql`delete from adsops_google_ads_credential where id = ${CREDENTIAL_ROW_ID}`;
  tokenCache().clear();
}

export async function recordTestResult(ok: boolean, message: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql`
      update adsops_google_ads_credential
      set last_test_at = now(), last_test_ok = ${ok}, last_test_message = ${message.slice(0, 500)}
      where id = ${CREDENTIAL_ROW_ID}
    `;
  } catch {
    /* table may not exist yet */
  }
}

// ── config ───────────────────────────────────────────────────────────────────

export type MissingPiece = { id: string; label_vi: string };

export type AdsConfig = {
  ready: boolean;
  missing: MissingPiece[];
  notes: string[];
  clientId: string;
  clientSecret: string;
  clientSource: "GOOGLE_ADS_CLIENT_ID" | "GOOGLE_CLIENT_ID" | null;
  refreshToken: string;
  refreshSource: "env" | "neon" | null;
  loginCustomerId: string;
  loginSource: "env" | "default";
  developerToken: string;
  stored: StoredCredentialMeta | null;
};

export function oauthClient(): { clientId: string; clientSecret: string; source: AdsConfig["clientSource"] } {
  const adsId = env("GOOGLE_ADS_CLIENT_ID");
  const adsSecret = env("GOOGLE_ADS_CLIENT_SECRET");
  if (adsId && adsSecret) return { clientId: adsId, clientSecret: adsSecret, source: "GOOGLE_ADS_CLIENT_ID" };
  const loginId = env("GOOGLE_CLIENT_ID");
  const loginSecret = env("GOOGLE_CLIENT_SECRET");
  if (loginId && loginSecret) return { clientId: loginId, clientSecret: loginSecret, source: "GOOGLE_CLIENT_ID" };
  return { clientId: adsId || loginId, clientSecret: adsSecret || loginSecret, source: null };
}

export async function resolveAdsConfig(): Promise<AdsConfig> {
  const missing: MissingPiece[] = [];
  const notes: string[] = [];
  const client = oauthClient();
  if (!client.clientId) {
    missing.push({ id: "client_id", label_vi: "OAuth Client ID: chưa có GOOGLE_ADS_CLIENT_ID (và cũng không có GOOGLE_CLIENT_ID để dùng thay)." });
  }
  if (!client.clientSecret) {
    missing.push({ id: "client_secret", label_vi: "OAuth Client Secret: chưa có GOOGLE_ADS_CLIENT_SECRET (và cũng không có GOOGLE_CLIENT_SECRET để dùng thay)." });
  }
  if (client.source === "GOOGLE_CLIENT_ID") notes.push("Đang dùng OAuth client đăng nhập (GOOGLE_CLIENT_ID — \"AdsOps token\").");

  const row = await readCredentialRow();
  let stored: StoredCredentialMeta | null = null;
  let neonToken = "";
  if (row) {
    const plain = decryptSecret(row.refresh_token_enc);
    neonToken = plain || "";
    stored = {
      google_email: row.google_email,
      connected_by: row.connected_by,
      connected_at: row.connected_at,
      last_test_at: row.last_test_at,
      last_test_ok: row.last_test_ok,
      last_test_message: row.last_test_message,
      decryptable: Boolean(plain),
    };
  }
  const envToken = env("GOOGLE_ADS_REFRESH_TOKEN");
  const refreshToken = envToken || neonToken;
  const refreshSource: AdsConfig["refreshSource"] = envToken ? "env" : neonToken ? "neon" : null;
  if (!refreshToken) {
    if (row && !neonToken) {
      missing.push({
        id: "refresh_token",
        label_vi: env("BETTER_AUTH_SECRET")
          ? "Refresh token đã lưu nhưng không giải mã được (BETTER_AUTH_SECRET đã đổi?). Bấm lại \"Kết nối Google Ads\"."
          : "Thiếu BETTER_AUTH_SECRET nên không giải mã được refresh token đã lưu.",
      });
    } else {
      missing.push({
        id: "refresh_token",
        label_vi: "Refresh token: chưa bấm \"Kết nối Google Ads\" (hoặc đặt GOOGLE_ADS_REFRESH_TOKEN).",
      });
    }
  }
  if (!envToken && !env("BETTER_AUTH_SECRET")) {
    missing.push({ id: "better_auth_secret", label_vi: "BETTER_AUTH_SECRET: cần để mã hoá refresh token lưu trên Neon." });
  }
  if (envToken) notes.push("Đang dùng GOOGLE_ADS_REFRESH_TOKEN (env) — ghi đè token đã lưu từ nút Kết nối.");

  const loginEnv = digits(env("GOOGLE_ADS_LOGIN_CUSTOMER_ID"));
  const loginCustomerId = loginEnv.length === 10 ? loginEnv : DEFAULT_MCC_ID;
  if (env("GOOGLE_ADS_LOGIN_CUSTOMER_ID") && loginEnv.length !== 10) {
    notes.push("GOOGLE_ADS_LOGIN_CUSTOMER_ID không phải 10 chữ số — đang dùng MCC mặc định 532-145-0531.");
  } else if (!loginEnv) {
    notes.push("Chưa đặt GOOGLE_ADS_LOGIN_CUSTOMER_ID — đang dùng MCC mặc định 532-145-0531.");
  }
  const developerToken = env("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!developerToken) {
    notes.push(
      "Chưa đặt GOOGLE_ADS_DEVELOPER_TOKEN. Từ 10/09/2026 Google xét quyền theo Google Cloud project nên token có thể không bắt buộc; nếu Google báo thiếu token thì thêm biến này.",
    );
  }
  return {
    ready: missing.length === 0,
    missing,
    notes,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    clientSource: client.source,
    refreshToken,
    refreshSource,
    loginCustomerId,
    loginSource: loginEnv.length === 10 ? "env" : "default",
    developerToken,
    stored,
  };
}

// ── errors ───────────────────────────────────────────────────────────────────

export type AdsErrorKind =
  | "NOT_CONFIGURED"
  | "TOKEN_REVOKED"
  | "OAUTH_CLIENT"
  | "SCOPE"
  | "API_DISABLED"
  | "TEST_ACCESS_ONLY"
  | "DEVELOPER_TOKEN"
  | "PERMISSION_DENIED"
  | "CUSTOMER_NOT_ENABLED"
  | "NOT_ADS_USER"
  | "QUOTA"
  | "TIMEOUT"
  | "BAD_QUERY"
  | "UNKNOWN";

export class AdsApiError extends Error {
  readonly kind: AdsErrorKind;
  readonly httpStatus: number;
  readonly requestId: string | null;
  /** Readable Vietnamese message for admins / staff. Never shown to clients. */
  readonly adminMessage: string;
  constructor(kind: AdsErrorKind, adminMessage: string, httpStatus = 0, requestId: string | null = null) {
    super(adminMessage);
    this.name = "AdsApiError";
    this.kind = kind;
    this.adminMessage = adminMessage;
    this.httpStatus = httpStatus;
    this.requestId = requestId;
  }
}

function logAdsError(where: string, err: AdsApiError, raw?: string) {
  // Server log only. Raw Google messages never contain our secrets, but trim anyway.
  const safe = String(raw || "")
    .replace(/ya29\.[\w.-]+/g, "[token]")
    .replace(/1\/\/[\w.-]+/g, "[token]")
    .slice(0, 600);
  console.error(`[google-ads] ${where} kind=${err.kind} http=${err.httpStatus} requestId=${err.requestId || "-"} ${safe}`);
}

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      "@type"?: string;
      reason?: string;
      errors?: Array<{ errorCode?: Record<string, string>; message?: string }>;
      requestId?: string;
    }>;
  };
};

function classifyGoogleError(httpStatus: number, body: GoogleErrorBody, customerId?: string): AdsApiError {
  const e = body.error || {};
  const details = Array.isArray(e.details) ? e.details : [];
  const codes: string[] = [];
  let requestId: string | null = null;
  for (const d of details) {
    if (d.requestId) requestId = d.requestId;
    if (d.reason) codes.push(String(d.reason));
    for (const er of d.errors || []) {
      for (const v of Object.values(er.errorCode || {})) codes.push(String(v));
    }
  }
  const status = String(e.status || "");
  const has = (...names: string[]) => names.some((n) => codes.includes(n));
  const acct = customerId ? ` (tài khoản ${dashedId(customerId)})` : "";

  if (has("CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION", "ACTION_NOT_PERMITTED")) {
    return new AdsApiError(
      "TEST_ACCESS_ONLY",
      "Google Cloud project của OAuth client mới có quyền Test Account Access — không đọc được tài khoản thật. Vào Google Cloud Console → Google Ads API Overview của project đó và xin Explorer Access (tối thiểu) hoặc Basic Access.",
      httpStatus,
      requestId,
    );
  }
  if (has("DEVELOPER_TOKEN_NOT_APPROVED")) {
    return new AdsApiError(
      "TEST_ACCESS_ONLY",
      "Developer token / project chỉ được dùng với tài khoản test. Cần Explorer Access hoặc Basic Access để đọc tài khoản thật.",
      httpStatus,
      requestId,
    );
  }
  if (has("DEVELOPER_TOKEN_PARAMETER_MISSING", "DEVELOPER_TOKEN_INVALID", "DEVELOPER_TOKEN_PROHIBITED", "DEVELOPER_TOKEN_HEADER_INVALID")) {
    return new AdsApiError(
      "DEVELOPER_TOKEN",
      "Google Ads báo developer token thiếu hoặc không hợp lệ. Đặt GOOGLE_ADS_DEVELOPER_TOKEN đúng token của MCC trên Vercel rồi redeploy.",
      httpStatus,
      requestId,
    );
  }
  if (has("SERVICE_DISABLED", "GOOGLE_ADS_API_DISABLED") || /has not been used in project|is disabled/i.test(String(e.message || ""))) {
    return new AdsApiError(
      "API_DISABLED",
      "Google Ads API chưa được bật trong Google Cloud project của OAuth client. Vào Cloud Console → APIs & Services → bật \"Google Ads API\".",
      httpStatus,
      requestId,
    );
  }
  if (has("NOT_ADS_USER")) {
    return new AdsApiError(
      "NOT_ADS_USER",
      "Google đã kết nối không có quyền Google Ads nào. Bấm lại \"Kết nối Google Ads\" bằng Google có quyền trên MCC.",
      httpStatus,
      requestId,
    );
  }
  if (has("CUSTOMER_NOT_ENABLED")) {
    return new AdsApiError(
      "CUSTOMER_NOT_ENABLED",
      `Tài khoản quảng cáo chưa kích hoạt hoặc đã bị huỷ/tạm ngưng${acct}.`,
      httpStatus,
      requestId,
    );
  }
  if (has("USER_PERMISSION_DENIED", "CUSTOMER_NOT_FOUND", "INVALID_LOGIN_CUSTOMER_ID")) {
    return new AdsApiError(
      "PERMISSION_DENIED",
      `Google đã kết nối không có quyền đọc tài khoản này qua MCC${acct}. Kiểm tra tài khoản có nằm dưới MCC đang dùng (GOOGLE_ADS_LOGIN_CUSTOMER_ID) và Google đã kết nối có quyền trên MCC đó.`,
      httpStatus,
      requestId,
    );
  }
  if (has("ACCESS_TOKEN_SCOPE_INSUFFICIENT", "OAUTH_TOKEN_INVALID") || /insufficient authentication scopes/i.test(String(e.message || ""))) {
    return new AdsApiError(
      "SCOPE",
      "Token Google chưa có quyền Google Ads (scope adwords). Bấm lại \"Kết nối Google Ads\" và đồng ý quyền Google Ads.",
      httpStatus,
      requestId,
    );
  }
  if (httpStatus === 429 || status === "RESOURCE_EXHAUSTED" || has("RESOURCE_EXHAUSTED", "RESOURCE_TEMPORARILY_EXHAUSTED")) {
    return new AdsApiError(
      "QUOTA",
      "Google Ads API báo hết hạn mức (quota) — thử lại sau. Explorer Access chỉ 2.880 lượt/ngày với tài khoản thật; Basic Access 15.000 lượt/ngày.",
      httpStatus,
      requestId,
    );
  }
  if (status === "INVALID_ARGUMENT" || has("QUERY_ERROR", "UNRECOGNIZED_FIELD", "PROHIBITED_FIELD_COMBINATION_IN_SELECT_CLAUSE")) {
    return new AdsApiError("BAD_QUERY", "Truy vấn GAQL bị Google từ chối (lỗi phía AdsOps). Đã ghi log máy chủ.", httpStatus, requestId);
  }
  if (httpStatus === 401) {
    return new AdsApiError("TOKEN_REVOKED", "Google từ chối xác thực. Bấm lại \"Kết nối Google Ads\".", httpStatus, requestId);
  }
  if (httpStatus === 403) {
    return new AdsApiError("PERMISSION_DENIED", `Google từ chối quyền${acct}. Kiểm tra quyền MCC và quyền truy cập API của Cloud project.`, httpStatus, requestId);
  }
  return new AdsApiError("UNKNOWN", `Google Ads API lỗi HTTP ${httpStatus || "?"}${acct}. Đã ghi log máy chủ.`, httpStatus, requestId);
}

// ── access token ─────────────────────────────────────────────────────────────

type TokenEntry = { token: string; exp: number };

function tokenCache(): Map<string, TokenEntry> {
  const g = globalThis as typeof globalThis & { __adsopsAdsTokenCache__?: Map<string, TokenEntry> };
  g.__adsopsAdsTokenCache__ ??= new Map();
  return g.__adsopsAdsTokenCache__;
}

export async function accessToken(cfg: AdsConfig): Promise<string> {
  if (!cfg.ready) {
    throw new AdsApiError("NOT_CONFIGURED", `Chưa cấu hình Google Ads API: ${cfg.missing.map((m) => m.label_vi).join(" ")}`);
  }
  const key = createHash("sha256").update(`${cfg.clientId}|${cfg.refreshToken}`).digest("hex");
  const hit = tokenCache().get(key);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
      }),
    });
  } catch {
    const err = new AdsApiError("TIMEOUT", "Không kết nối được máy chủ OAuth của Google. Thử lại sau.");
    logAdsError("token", err);
    throw err;
  }
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (json.access_token) {
    tokenCache().set(key, { token: json.access_token, exp: Date.now() + (Number(json.expires_in) || 3000) * 1000 });
    return json.access_token;
  }
  let err: AdsApiError;
  if (json.error === "invalid_grant") {
    err = new AdsApiError(
      "TOKEN_REVOKED",
      "Refresh token hết hạn hoặc đã bị thu hồi (hoặc OAuth consent đang ở chế độ Testing — token chỉ sống 7 ngày). Bấm lại \"Kết nối Google Ads\".",
      res.status,
    );
  } else if (json.error === "invalid_client" || json.error === "unauthorized_client") {
    err = new AdsApiError(
      "OAUTH_CLIENT",
      "OAuth Client ID/Secret không khớp với refresh token (token phải được tạo bằng cùng OAuth client). Kiểm tra GOOGLE_ADS_CLIENT_ID/SECRET hoặc bấm lại \"Kết nối Google Ads\".",
      res.status,
    );
  } else {
    err = new AdsApiError("UNKNOWN", "Không lấy được access token từ Google.", res.status);
  }
  logAdsError("token", err, `${json.error || ""} ${json.error_description || ""}`);
  throw err;
}

// ── REST calls (read-only) ───────────────────────────────────────────────────

function versionRef(): { v: string | null } {
  const g = globalThis as typeof globalThis & { __adsopsAdsVersion__?: { v: string | null } };
  g.__adsopsAdsVersion__ ??= { v: null };
  return g.__adsopsAdsVersion__;
}

function headers(cfg: AdsConfig, token: string, withLogin = true): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (withLogin) h["login-customer-id"] = cfg.loginCustomerId;
  if (cfg.developerToken) h["developer-token"] = cfg.developerToken;
  return h;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Calls `path` on the newest API version that exists (404 = version not served). */
async function adsCall(
  cfg: AdsConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: string; withLogin?: boolean },
  where: string,
  customerId?: string,
  timeoutMs = 60_000,
): Promise<unknown> {
  const token = await accessToken(cfg);
  const ref = versionRef();
  const versions = ref.v ? [ref.v, ...ADS_API_VERSIONS.filter((v) => v !== ref.v)] : [...ADS_API_VERSIONS];
  let last: AdsApiError | null = null;
  for (const version of versions) {
    let res: Response;
    try {
      res = await fetchWithTimeout(
        `https://googleads.googleapis.com/${version}${path}`,
        { method: init.method, body: init.body, headers: headers(cfg, token, init.withLogin !== false) },
        timeoutMs,
      );
    } catch {
      const err = new AdsApiError("TIMEOUT", "Google Ads API không phản hồi kịp. Thử lại sau.");
      logAdsError(where, err);
      throw err;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.status === 404 && (json === null || !(json as GoogleErrorBody)?.error?.details)) {
      // This API version is not served (sunset or not yet released): try the next.
      last = new AdsApiError("UNKNOWN", `Phiên bản Google Ads API ${version} không còn phục vụ.`, 404);
      continue;
    }
    // searchStream returns an array of batches; an error may be the last element.
    const errBody: GoogleErrorBody | null = Array.isArray(json)
      ? ((json as GoogleErrorBody[]).find((b) => b && b.error) ?? null)
      : json && (json as GoogleErrorBody).error
        ? (json as GoogleErrorBody)
        : null;
    if (!res.ok || errBody) {
      const err = classifyGoogleError(res.status, errBody || {}, customerId);
      logAdsError(where, err, text);
      throw err;
    }
    ref.v = version;
    return json;
  }
  const err = last || new AdsApiError("UNKNOWN", "Không tìm được phiên bản Google Ads API còn hoạt động.");
  logAdsError(where, err);
  throw err;
}

export function currentApiVersion(): string | null {
  return versionRef().v;
}

export type GaqlRow = Record<string, unknown>;

/** GAQL via searchStream. Only SELECT statements are accepted. */
export async function searchStream(cfg: AdsConfig, customerId: string, query: string): Promise<GaqlRow[]> {
  const cid = digits(customerId);
  if (cid.length !== 10) throw new AdsApiError("BAD_QUERY", "Customer ID không hợp lệ.");
  if (!/^\s*select\s/i.test(query)) throw new AdsApiError("BAD_QUERY", "Chỉ cho phép truy vấn SELECT (đọc).");
  const json = await adsCall(
    cfg,
    `/customers/${cid}/googleAds:searchStream`,
    { method: "POST", body: JSON.stringify({ query: query.replace(/\s+/g, " ").trim() }) },
    "searchStream",
    cid,
    120_000,
  );
  const batches = Array.isArray(json) ? (json as Array<{ results?: GaqlRow[] }>) : [json as { results?: GaqlRow[] }];
  const rows: GaqlRow[] = [];
  for (const b of batches) if (b && Array.isArray(b.results)) rows.push(...b.results);
  return rows;
}

export async function listAccessibleCustomers(cfg: AdsConfig): Promise<string[]> {
  const json = (await adsCall(cfg, "/customers:listAccessibleCustomers", { method: "GET", withLogin: false }, "listAccessibleCustomers")) as {
    resourceNames?: string[];
  };
  return (json?.resourceNames || []).map((n) => digits(String(n).split("/").pop())).filter(Boolean);
}

export type MccChild = {
  customer_id: string;
  customer_id_dashed: string;
  name: string;
  status: string;
  manager: boolean;
  test_account: boolean;
  level: number;
  currency: string | null;
  time_zone: string | null;
};

/** Accounts under the MCC (customer_client), read-only. */
export async function listMccChildren(cfg: AdsConfig): Promise<MccChild[]> {
  const rows = await searchStream(
    cfg,
    cfg.loginCustomerId,
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status,
            customer_client.test_account, customer_client.level, customer_client.currency_code, customer_client.time_zone
     FROM customer_client`,
  );
  const out: MccChild[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const cc = (r.customerClient || {}) as Record<string, unknown>;
    const id = digits(cc.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      customer_id: id,
      customer_id_dashed: dashedId(id),
      name: String(cc.descriptiveName || "").trim(),
      status: String(cc.status || ""),
      manager: Boolean(cc.manager),
      test_account: Boolean(cc.testAccount),
      level: Number(cc.level || 0),
      currency: cc.currencyCode ? String(cc.currencyCode) : null,
      time_zone: cc.timeZone ? String(cc.timeZone) : null,
    });
  }
  return out;
}

/** Public, secret-free summary for the admin card. */
export type AdsStatusPublic = {
  ready: boolean;
  missing: MissingPiece[];
  notes: string[];
  client_source: AdsConfig["clientSource"];
  refresh_source: AdsConfig["refreshSource"];
  login_customer_id_dashed: string;
  login_source: AdsConfig["loginSource"];
  developer_token_set: boolean;
  google_email: string | null;
  connected_at: string | null;
  connected_by: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  redirect_uri: string;
  api_version: string | null;
  encryption_ready: boolean;
};

export function publicStatus(cfg: AdsConfig, redirectUri: string): AdsStatusPublic {
  return {
    ready: cfg.ready,
    missing: cfg.missing,
    notes: cfg.notes,
    client_source: cfg.clientSource,
    refresh_source: cfg.refreshSource,
    login_customer_id_dashed: dashedId(cfg.loginCustomerId),
    login_source: cfg.loginSource,
    developer_token_set: Boolean(cfg.developerToken),
    google_email: cfg.stored?.google_email ?? null,
    connected_at: cfg.stored?.connected_at ?? null,
    connected_by: cfg.stored?.connected_by ?? null,
    last_test_at: cfg.stored?.last_test_at ?? null,
    last_test_ok: cfg.stored?.last_test_ok ?? null,
    last_test_message: cfg.stored?.last_test_message ?? null,
    redirect_uri: redirectUri,
    api_version: currentApiVersion(),
    encryption_ready: Boolean(env("BETTER_AUTH_SECRET")),
  };
}

/** Public origin for OAuth redirects: BETTER_AUTH_URL when set, else the request origin. */
export function publicOrigin(request?: Request): string {
  const base = env("BETTER_AUTH_URL").replace(/\/$/, "");
  if (base) return base;
  if (!request) return "";
  const url = new URL(request.url);
  const proto = (request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")).split(",")[0].trim();
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host).split(",")[0].trim();
  return `${proto}://${host}`;
}

export function redirectUriFor(request?: Request): string {
  return `${publicOrigin(request)}${OAUTH_CALLBACK_PATH}`;
}

// ── OAuth state (signed, short-lived) ────────────────────────────────────────

export function signState(payload: Record<string, unknown>): string {
  const secret = env("BETTER_AUTH_SECRET") || "adsops-dev-only";
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(`gads-state|${body}`).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState(token: string): Record<string, unknown> | null {
  const secret = env("BETTER_AUTH_SECRET") || "adsops-dev-only";
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", secret).update(`gads-state|${body}`).digest("base64url");
  if (want.length !== mac.length || !timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}
