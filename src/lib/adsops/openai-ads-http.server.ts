/**
 * The ONLY code path that talks to the OpenAI Advertiser API (https://api.ads.openai.com).
 *
 * The API key cannot be scoped read-only, so this wrapper hard-enforces read-only use:
 *  - GET on an allow-listed set of read endpoints, or
 *  - POST on exactly /v1/conversions/insights (a read-only report endpoint).
 * Every other method/path throws before any network call. Do not add write endpoints here.
 */
const BASE = "https://api.ads.openai.com";

const GET_PATHS: RegExp[] = [
  /^\/v1\/ad_account$/,
  /^\/v1\/ad_account\/insights$/,
  /^\/v1\/(campaigns|ad_groups|ads)$/,
  /^\/v1\/(campaigns|ad_groups|ads)\/[A-Za-z0-9_-]+$/,
  /^\/v1\/(campaigns|ad_groups|ads)\/[A-Za-z0-9_-]+\/insights$/,
];
const READ_POST_PATHS = new Set(["/v1/conversions/insights"]);

export class OpenAIAdsError extends Error {
  constructor(message: string, public status: number | null = null) {
    super(message);
  }
}

export function assertReadOnly(method: string, path: string): void {
  const m = method.toUpperCase();
  if (m === "GET" && GET_PATHS.some((re) => re.test(path))) return;
  if (m === "POST" && READ_POST_PATHS.has(path)) return;
  throw new OpenAIAdsError(`Blocked: AdsOps only reads from OpenAI Ads (${m} ${path} is not allowed).`);
}

type Query = Record<string, string | number | Array<string | number> | undefined>;

function qs(q: Query | undefined): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) p.append(k, String(x));
    else p.append(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function call<T>(key: string, method: "GET" | "POST", path: string, opts: { query?: Query; body?: unknown; timeoutMs?: number }): Promise<T> {
  assertReadOnly(method, path);
  if (!key || !key.trim()) throw new OpenAIAdsError("Thiếu API key ChatGPT Ads.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${BASE}${path}${qs(opts.query)}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        Accept: "application/json",
        // Cloudflare in front of the API rejects requests without a product User-Agent (error 1010).
        "User-Agent": "AdsOps/1.0 (+https://ad.fagogroup.vn)",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as { error?: { message?: string } };
        if (j?.error?.message) msg = j.error.message.slice(0, 300);
      } catch {
        /* not json */
      }
      if (res.status === 401) msg = "API key không hợp lệ hoặc đã bị thu hồi.";
      throw new OpenAIAdsError(`OpenAI Ads ${res.status}: ${msg}`, res.status);
    }
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof OpenAIAdsError) throw e;
    throw new OpenAIAdsError(e instanceof Error && e.name === "AbortError" ? "OpenAI Ads: hết thời gian chờ." : `OpenAI Ads: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(t);
  }
}

export function oaGet<T>(key: string, path: string, query?: Query, timeoutMs?: number): Promise<T> {
  return call<T>(key, "GET", path, { query, timeoutMs });
}

/** The single allowed POST: the read-only conversion insights report. */
export function oaConversionsReport<T>(key: string, body: Record<string, unknown>): Promise<T> {
  return call<T>(key, "POST", "/v1/conversions/insights", { body });
}
