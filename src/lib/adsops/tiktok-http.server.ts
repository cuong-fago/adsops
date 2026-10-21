/**
 * The ONLY code path that talks to TikTok API for Business (https://business-api.tiktok.com/open_api/v1.3).
 * Read-only by construction: GET on an allow-list of read endpoints, plus exactly one POST (the OAuth
 * auth_code → access_token exchange). Anything else throws before any network call.
 * Never log URLs or headers here: some GETs carry the app secret (oauth2/advertiser/get) or the token.
 */
const BASE = "https://business-api.tiktok.com/open_api/v1.3";

const GET_PATHS = new Set([
  "/oauth2/advertiser/get/",
  "/advertiser/info/",
  "/campaign/get/",
  "/adgroup/get/",
  "/ad/get/",
  "/file/video/ad/info/",
  "/file/image/ad/info/",
  "/report/integrated/get/",
]);
const POST_PATHS = new Set(["/oauth2/access_token/"]);

export class TikTokError extends Error {
  constructor(message: string, public code: number | null = null) {
    super(message);
  }
}

export function assertReadOnly(method: string, path: string): void {
  const m = method.toUpperCase();
  if (m === "GET" && GET_PATHS.has(path)) return;
  if (m === "POST" && POST_PATHS.has(path)) return;
  throw new TikTokError(`Blocked: AdsOps only reads from TikTok Ads (${m} ${path} is not allowed).`);
}

type Query = Record<string, string | number | boolean | unknown[] | undefined>;
/** TikTok wants arrays / objects JSON-encoded in the query string. */
function qs(q: Query | undefined): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    p.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

type Envelope<T> = { code?: number; message?: string; request_id?: string; data?: T };

async function call<T>(method: "GET" | "POST", path: string, opts: { token?: string; query?: Query; body?: unknown; timeoutMs?: number }): Promise<T> {
  assertReadOnly(method, path);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${BASE}${path}${qs(opts.query)}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "AdsOps/1.0 (+https://ad.fagogroup.vn)",
        ...(opts.token ? { "Access-Token": opts.token } : {}),
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
    });
    const text = await res.text();
    let j: Envelope<T>;
    try { j = JSON.parse(text) as Envelope<T>; } catch { throw new TikTokError(`TikTok ${res.status}: phản hồi không phải JSON`); }
    // TikTok returns HTTP 200 with a non-zero code on errors.
    if (!res.ok || (j.code ?? 0) !== 0) {
      const code = j.code ?? res.status;
      let msg = String(j.message || "").slice(0, 300) || `HTTP ${res.status}`;
      if (code === 40001 || code === 40100 || code === 40104 || code === 40105) msg = `Token TikTok không hợp lệ hoặc đã bị thu hồi (${msg}).`;
      throw new TikTokError(`TikTok ${code}: ${msg}`, code);
    }
    return (j.data ?? ({} as T)) as T;
  } catch (e) {
    if (e instanceof TikTokError) throw e;
    throw new TikTokError(e instanceof Error && e.name === "AbortError" ? "TikTok: hết thời gian chờ." : `TikTok: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(t);
  }
}

export function ttGet<T>(token: string | undefined, path: string, query?: Query, timeoutMs?: number): Promise<T> {
  return call<T>("GET", path, { token, query, timeoutMs });
}

/** The single allowed POST: exchange an OAuth auth_code for a long-term advertiser access token. */
export function ttExchangeCode(appId: string, secret: string, authCode: string): Promise<{ access_token?: string; advertiser_ids?: string[]; scope?: unknown }> {
  return call("POST", "/oauth2/access_token/", { body: { app_id: appId, secret, auth_code: authCode } });
}
