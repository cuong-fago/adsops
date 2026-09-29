/**
 * Read-only child list for more than one Google Ads manager.
 * Does not mutate Google Ads. A refresh token is the Google user:
 * that user must already have access to each MCC.
 */
import { getSql } from "@/lib/db";
import {
  ADS_API_VERSIONS,
  AdsApiError,
  DEFAULT_MCC_ID,
  type AdsConfig,
  accessToken,
  currentApiVersion,
  dashedId,
  digits,
  resolveAdsConfig,
  type GaqlRow,
} from "./google-ads.server.ts";

export const EXTRA_MCC_ID = "8776919182";

export function managerCustomerIds(cfg: { loginCustomerId: string }): string[] {
  const out: string[] = [];
  for (const raw of [cfg.loginCustomerId, DEFAULT_MCC_ID, EXTRA_MCC_ID]) {
    const id = digits(raw);
    if (id.length === 10 && !out.includes(id)) out.push(id);
  }
  return out;
}

const CUSTOMER_CLIENT_QUERY = `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status,
            customer_client.test_account, customer_client.level, customer_client.currency_code, customer_client.time_zone
     FROM customer_client`;

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
  mcc_customer_id: string;
  mcc_customer_id_dashed: string;
};

export type MccListResult = {
  children: MccChild[];
  errors: { mcc_customer_id: string; message_vi: string }[];
};

async function searchAs(
  cfg: AdsConfig,
  customerId: string,
  loginCustomerId: string,
  query: string,
): Promise<GaqlRow[]> {
  const cid = digits(customerId);
  const login = digits(loginCustomerId);
  if (cid.length !== 10 || login.length !== 10) throw new AdsApiError("BAD_QUERY", "Customer ID không hợp lệ.");
  if (!/^\s*select\s/i.test(query)) throw new AdsApiError("BAD_QUERY", "Chỉ cho phép truy vấn SELECT (đọc).");
  const token = await accessToken(cfg);
  const preferred = currentApiVersion();
  const versions = preferred ? [preferred, ...ADS_API_VERSIONS.filter((v) => v !== preferred)] : [...ADS_API_VERSIONS];
  let last: AdsApiError | null = null;
  for (const version of versions) {
    const res = await fetch(`https://googleads.googleapis.com/${version}/customers/${cid}/googleAds:searchStream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "login-customer-id": login,
        ...(cfg.developerToken ? { "developer-token": cfg.developerToken } : {}),
      },
      body: JSON.stringify({ query: query.replace(/\s+/g, " ").trim() }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.status === 404 && (json === null || !(json as { error?: { details?: unknown } })?.error?.details)) {
      last = new AdsApiError("UNKNOWN", `Phiên bản Google Ads API ${version} không còn phục vụ.`, 404);
      continue;
    }
    const errBody = Array.isArray(json)
      ? (json as { error?: unknown }[]).find((b) => b && b.error)
      : json && (json as { error?: unknown }).error
        ? json
        : null;
    if (!res.ok || errBody) {
      const err = new AdsApiError(
        "PERMISSION_DENIED",
        `Không đọc được MCC ${dashedId(login)}. User Google của refresh token phải đã có quyền trên manager này.`,
        res.status,
      );
      console.error(`[google-ads] list mcc ${dashedId(login)} http=${res.status} ${text.slice(0, 300)}`);
      throw err;
    }
    const batches = Array.isArray(json) ? (json as Array<{ results?: GaqlRow[] }>) : [json as { results?: GaqlRow[] }];
    const rows: GaqlRow[] = [];
    for (const b of batches) if (b && Array.isArray(b.results)) rows.push(...b.results);
    return rows;
  }
  throw last || new AdsApiError("UNKNOWN", "Không tìm được phiên bản Google Ads API còn hoạt động.");
}

/** customer_client for 532-145-0531 and 877-691-9182. One failure does not drop the other. */
export async function listAllMccChildren(cfg: AdsConfig): Promise<MccListResult> {
  const children: MccChild[] = [];
  const errors: MccListResult["errors"] = [];
  const seen = new Set<string>();
  for (const mcc of managerCustomerIds(cfg)) {
    try {
      const rows = await searchAs(cfg, mcc, mcc, CUSTOMER_CLIENT_QUERY);
      for (const r of rows) {
        const cc = (r.customerClient || {}) as Record<string, unknown>;
        const id = digits(cc.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        children.push({
          customer_id: id,
          customer_id_dashed: dashedId(id),
          name: String(cc.descriptiveName || "").trim(),
          status: String(cc.status || ""),
          manager: Boolean(cc.manager),
          test_account: Boolean(cc.testAccount),
          level: Number(cc.level || 0),
          currency: cc.currencyCode ? String(cc.currencyCode) : null,
          time_zone: cc.timeZone ? String(cc.timeZone) : null,
          mcc_customer_id: mcc,
          mcc_customer_id_dashed: dashedId(mcc),
        });
      }
    } catch (err) {
      const message_vi =
        err instanceof AdsApiError
          ? err.adminMessage
          : "Không đọc được MCC này. User Google của refresh token phải đã có quyền trên manager đó.";
      errors.push({ mcc_customer_id: mcc, message_vi });
    }
  }
  return { children, errors };
}

export async function configReady(): Promise<AdsConfig> {
  return resolveAdsConfig();
}

const loginCache = new Map<string, string>();

export function rememberLoginCustomer(customerId: string, managerCustomerId: string): void {
  const cid = digits(customerId);
  const mcc = digits(managerCustomerId);
  if (cid.length === 10 && mcc.length === 10) loginCache.set(cid, mcc);
}

/** login-customer-id for a later read of this customer. Falls back to the default MCC. */
export async function loginCustomerFor(cfg: AdsConfig, customerId: string): Promise<string> {
  const cid = digits(customerId);
  if (managerCustomerIds(cfg).includes(cid)) return cid;
  const cached = loginCache.get(cid);
  if (cached) return cached;
  try {
    const sql = await getSql();
    const rows = await sql<{ manager_customer_id: string | null }>`
      select manager_customer_id from ad_accounts
      where regexp_replace(coalesce(external_id, ''), '\\D', '', 'g') = ${cid}
        and manager_customer_id is not null
      limit 1
    `;
    const mcc = digits(rows[0]?.manager_customer_id || "");
    if (mcc.length === 10) {
      loginCache.set(cid, mcc);
      return mcc;
    }
  } catch {
    /* column appears on the first pull */
  }
  return cfg.loginCustomerId;
}
