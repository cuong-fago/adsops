import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ConnectPublic, InstallAndProbeResult, PullKpisResult } from "./connect.types.ts";

export type { ConnectPublic, InstallAndProbeResult, InstallMeta, PullKpisResult } from "./connect.types.ts";

const CLIENT_ID_RE = /^[a-z0-9_]+$/;
const MCC_ID = "5321450531";
const MCC_DASHED = "532-145-0531";
const MCC_NAME = "Fago Agency";
const API_VERSIONS = ["v22", "v21", "v20", "v19", "v18", "v23", "v24", "v25", "v17"];
const SECRET_DIR = "/workspace/.secrets";
const SECRET_FILE = join(SECRET_DIR, "adsops-google-ads.json");
const PUBLIC_DIR = "/workspace/public/adsops";

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

type MccAccount = {
  client_id: string;
  display_name: string;
  account_name: string;
  customer_id: string;
  customer_id_dashed: string;
  status: string;
  is_manager: boolean;
  currency?: string;
  time_zone?: string;
  in_system: boolean;
};

function redact(text: string): string {
  if (!text) return "";
  if (/ya29\.|1\/\/|client_secret|developer.token|refresh_token|Bearer |ENOENT|spawn python/i.test(text)) {
    if (/ENOENT|spawn python/i.test(text)) {
      return "Không gọi được bộ Python cũ. Đã chuyển sang gọi Google Ads trực tiếp — bấm lại Lưu trên máy rồi thử gọi.";
    }
    return "(đã ẩn nội dung nhạy cảm)";
  }
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function digits(raw: string | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

function dashed(id: string): string {
  const d = digits(id);
  if (d.length !== 10) return d;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
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

function parseYamlPieces(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text.trim()) return out;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadSecrets(): Secrets {
  try {
    if (!existsSync(SECRET_FILE)) return {};
    const raw = JSON.parse(readFileSync(SECRET_FILE, "utf8")) as Secrets;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveSecrets(next: Secrets) {
  mkdirSync(SECRET_DIR, { recursive: true });
  writeFileSync(SECRET_FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(SECRET_FILE, 0o600);
  } catch {
    /* ignore */
  }
}

function mergeSecrets(prev: Secrets, yamlText: string, pieces: Record<string, string>): Secrets {
  const fromYaml = parseYamlPieces(yamlText);
  const next: Secrets = { ...prev };
  const oauthId = pieces.oauth_client_id || fromYaml.client_id || fromYaml.oauth_client_id;
  const oauthSecret = pieces.oauth_client_secret || fromYaml.client_secret || fromYaml.oauth_client_secret;
  const refresh = pieces.refresh_token || fromYaml.refresh_token;
  const login = pieces.login_customer_id || fromYaml.login_customer_id || next.login_customer_id || MCC_ID;
  const dev = pieces.developer_token || fromYaml.developer_token;
  if (oauthId) next.client_id = oauthId.trim();
  if (oauthSecret) next.client_secret = oauthSecret.trim();
  if (refresh) next.refresh_token = refresh.trim();
  next.login_customer_id = digits(login) || MCC_ID;
  if (dev) next.developer_token = dev.trim();
  return next;
}

function missingKeys(s: Secrets): string[] {
  const miss: string[] = [];
  if (!s.client_id) miss.push("oauth_client_id");
  if (!s.client_secret) miss.push("oauth_client_secret");
  if (!s.refresh_token) miss.push("refresh_token");
  return miss;
}

function item(
  id: string,
  label: string,
  present: boolean,
  required: boolean,
  source = "",
): ConnectPublic["checklist"][number] {
  return {
    id,
    label_vi: label,
    present,
    required,
    source,
    state_vi: present ? "Có" : required ? "Thiếu" : "Không bắt buộc",
  };
}

async function accessToken(secrets: Secrets): Promise<{ token?: string; error?: string; status?: string }> {
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
    error_description?: string;
  };
  if (json.access_token) return { token: json.access_token };
  if (json.error === "invalid_grant") {
    return {
      status: "TOKEN_EXPIRED",
      error:
        "Refresh token hết hạn hoặc bị thu hồi. Lấy token mới (OAuth consent In production thì token mới bền). Không dán token vào chat.",
    };
  }
  if (json.error === "invalid_client") {
    return { status: "PERMISSION_DENIED", error: "OAuth Client ID / Secret không đúng với Google Cloud project." };
  }
  return { status: "PERMISSION_DENIED", error: "Không lấy được quyền Google. Kiểm tra 3 ô OAuth trên tab Kết nối." };
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
): Promise<{ version: string; resourceNames: string[] } | { error: string; status: string; version: string }> {
  let lastStatus = 0;
  let lastErr = "";
  for (const version of API_VERSIONS) {
    const hit = await adsFetch(version, "/customers:listAccessibleCustomers", token, loginId, { method: "GET" }, developerToken);
    lastStatus = hit.status;
    if (hit.status === 404) continue;
    const names = Array.isArray(hit.json.resourceNames) ? (hit.json.resourceNames as string[]) : [];
    if (hit.ok) return { version, resourceNames: names };
    const err = JSON.stringify(hit.json);
    lastErr = err;
    if (hit.status === 401 || hit.status === 403) {
      if (/PERMISSION_DENIED|not.*approved|access.*level/i.test(err)) {
        return {
          version,
          status: "PERMISSION_DENIED",
          error:
            "Google Cloud project chưa được cấp quyền Google Ads API (Basic/Standard). Bật API trên Cloud Console, đăng nhập đúng Google có quyền MCC.",
        };
      }
    }
    if (hit.ok === false && hit.status >= 500) continue;
    if (names.length || hit.status === 200) return { version, resourceNames: names };
  }
  if (lastStatus === 401) {
    return { version: "v22", status: "PERMISSION_DENIED", error: "Google từ chối quyền. Kiểm tra OAuth và Google có quyền MCC." };
  }
  return {
    version: "v22",
    status: "ACCOUNT_NOT_FOUND",
    error: redact(lastErr) || "Không gọi được Google Ads API. Không đoán danh sách tài khoản.",
  };
}

async function searchRows(
  version: string,
  customerId: string,
  token: string,
  loginId: string,
  query: string,
  developerToken?: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let pageToken = "";
  for (let i = 0; i < 20; i += 1) {
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
    if (!hit.ok) break;
    const results = Array.isArray(hit.json.results) ? (hit.json.results as Record<string, unknown>[]) : [];
    rows.push(...results);
    const next = String(hit.json.nextPageToken || "");
    if (!next) break;
    pageToken = next;
  }
  return rows;
}

function slugFor(customerId: string, apiName = ""): { client_id: string; display_name: string } {
  const known = KNOWN[customerId];
  return {
    client_id: known?.client_id || `tkqc_${customerId}`,
    display_name: apiName || known?.display_name || "",
  };
}

function publicConnect(
  clientId: string,
  opts: {
    status: string;
    title: string;
    detail: string;
    next: string;
    secrets: Secrets;
    account?: Partial<MccAccount>;
    accessibleCount: number | null;
    version: string;
    rosterComplete: boolean;
    accounts: MccAccount[];
    errorHint?: string;
  },
): ConnectPublic {
  const cid = opts.account?.customer_id || (clientId === "fago_group" ? "2204136068" : digits(clientId.replace(/^tkqc_/, "")) || "");
  const display =
    opts.account?.display_name ||
    KNOWN[cid]?.display_name ||
    (clientId === "fago_group" ? KNOWN["2204136068"].display_name : "GrowVi");
  return {
    client_id: clientId,
    display_name: display,
    customer_id: cid,
    customer_id_dashed: dashed(cid),
    mcc_id: opts.secrets.login_customer_id || MCC_ID,
    mcc_id_dashed: dashed(opts.secrets.login_customer_id || MCC_ID) || MCC_DASHED,
    mcc_display_name: MCC_NAME,
    adapter: "live",
    status: opts.status,
    title_vi: opts.title,
    detail_vi: opts.detail,
    next_step_vi: opts.next,
    checklist: [
      item("oauth_client_id", "OAuth Client ID", Boolean(opts.secrets.client_id), true, opts.secrets.client_id ? "máy này" : ""),
      item("oauth_client_secret", "OAuth Client Secret", Boolean(opts.secrets.client_secret), true, opts.secrets.client_secret ? "máy này" : ""),
      item("refresh_token", "Refresh token (đăng nhập Google)", Boolean(opts.secrets.refresh_token), true, opts.secrets.refresh_token ? "máy này" : ""),
      item("login_customer_id", "MCC (tài khoản quản lý)", true, true, "client_config"),
      item("customer_id", "Customer ID tài khoản khách", Boolean(cid), true, "client_config"),
      item("developer_token", "Token nhà phát triển (Google đã bỏ — không bắt buộc)", Boolean(opts.secrets.developer_token), false, ""),
    ],
    account_name: opts.account?.account_name || display,
    currency: opts.account?.currency || "VND",
    account_timezone: opts.account?.time_zone || "Asia/Saigon",
    is_manager: Boolean(opts.account?.is_manager),
    account_status: opts.account?.status || null,
    accessible_count: opts.accessibleCount,
    target_in_accessible: opts.accounts.some((a) => a.customer_id === cid),
    yaml_file_present: Boolean(opts.secrets.client_id && opts.secrets.client_secret && opts.secrets.refresh_token),
    api_version: opts.version,
    probed_at: nowIso(),
    propose_only: true,
    pulled_search_terms: false,
    pulled_kpis: false,
    never_apply_google_ads: true,
    error_hint: opts.errorHint || "",
    module: "ads_connect",
    rule: "CHỈ ĐỀ XUẤT — không tự apply lên Google Ads.",
    isolation: "Chọn khách A không thấy số B.",
    mcc_accounts: opts.accounts,
    roster_complete: opts.rosterComplete,
  };
}

function persistRoster(accounts: MccAccount[], accessibleCount: number, complete: boolean) {
  const clients = accounts
    .filter((a) => !a.is_manager)
    .map((a) => ({
      client_id: a.client_id,
      display_name: a.display_name,
      status: a.status === "ENABLED" ? "active" : "paused",
      adapter: "live" as const,
      customer_id_dashed: a.customer_id_dashed,
      mcc_display_name: MCC_NAME,
    }));
  const mcc = {
    product: "AdsOps",
    module: "mcc_roster",
    rule: "Danh sách tài khoản lấy từ MCC — không đoán tên, không nhét fixture.",
    never_apply_google_ads: true,
    isolation: "Chọn khách A không thấy số khách B.",
    mcc_id: MCC_ID,
    mcc_id_dashed: MCC_DASHED,
    mcc_display_name: MCC_NAME,
    timezone: "Asia/Saigon",
    currency: "VND",
    last_probe_accessible_count: accessibleCount,
    roster_complete: complete,
    pulled_at: nowIso(),
    note_vi: complete
      ? `Đã kéo ${clients.length} tài khoản quảng cáo từ MCC ${MCC_DASHED}.`
      : "Chưa kéo đủ danh sách MCC.",
    accounts,
  };
  const patchClients = (file: string, extra?: Record<string, unknown>) => {
    const path = join(PUBLIC_DIR, file);
    let cur: Record<string, unknown> = {};
    try {
      cur = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      cur = {};
    }
    cur.clients = clients;
    if (extra) Object.assign(cur, extra);
    writeFileSync(path, `${JSON.stringify(cur, null, 2)}\n`);
  };
  try {
    mkdirSync(join(PUBLIC_DIR, "connect"), { recursive: true });
    writeFileSync(join(PUBLIC_DIR, "mcc.json"), `${JSON.stringify(mcc, null, 2)}\n`);
    patchClients("registry.json");
    patchClients("connect-registry.json");
    patchClients("switcher-registry.json", { active_client_id: clients[0]?.client_id });
    for (const acc of accounts.filter((a) => !a.is_manager)) {
      const path = join(PUBLIC_DIR, "connect", `${acc.client_id}.json`);
      let prev: Record<string, unknown> = {};
      try {
        prev = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      } catch {
        prev = {};
      }
      const stub = publicConnect(acc.client_id, {
        status: "CONNECTED",
        title: "Engine gọi được Google Ads API",
        detail: `Đã đọc MCC ${MCC_DASHED} — ${acc.display_name} (${acc.customer_id_dashed}). Chưa kéo search term, chưa sinh FINAL, không apply.`,
        next: "Chọn tài khoản trên đầu trang. Phân tích / FINAL chỉ có khi đã kéo kho — không đoán số.",
        secrets: loadSecrets(),
        account: acc,
        accessibleCount,
        version: String(prev.api_version || "v22"),
        rosterComplete: complete,
        accounts,
      });
      writeFileSync(path, `${JSON.stringify({ ...prev, ...stub }, null, 2)}\n`);
    }
  } catch {
    /* preview/Vercel may not persist public writes */
  }
}

export async function installAndProbe(input: {
  clientId: string;
  yamlText: string;
  pieces: Record<string, string>;
  save: boolean;
}): Promise<InstallAndProbeResult> {
  const clientId = input.clientId.trim();
  if (!CLIENT_ID_RE.test(clientId)) {
    return { install: null, connect: null, error_vi: "Khách không hợp lệ." };
  }
  try {
    let secrets = loadSecrets();
    let saved = false;
    if (input.save) {
      secrets = mergeSecrets(secrets, input.yamlText, input.pieces);
      const miss = missingKeys(secrets);
      if (miss.length) {
        return {
          install: { ok: false, yaml_file_present: false, missing: miss, error_vi: "Thiếu OAuth Client ID, Client Secret hoặc Refresh token." },
          connect: publicConnect(clientId, {
            status: "MISSING_CREDENTIALS",
            title: "CHƯA CÓ QUYỀN",
            detail: "Điền đủ 3 ô OAuth hoặc kéo file yaml. Không dán token vào chat.",
            next: "Lưu trên máy rồi thử gọi.",
            secrets,
            accessibleCount: null,
            version: "",
            rosterComplete: false,
            accounts: [],
          }),
          error_vi: "Thiếu OAuth Client ID, Client Secret hoặc Refresh token.",
        };
      }
      saveSecrets(secrets);
      saved = true;
    }
    const miss = missingKeys(secrets);
    if (miss.length) {
      return {
        install: saved ? { ok: true, yaml_file_present: true } : { ok: false, yaml_file_present: false, missing: miss },
        connect: publicConnect(clientId, {
          status: "MISSING_CREDENTIALS",
          title: "CHƯA CÓ QUYỀN",
          detail: "Chưa có 3 mảnh OAuth trên máy này.",
          next: "Điền 3 ô hoặc kéo yaml, rồi Lưu trên máy rồi thử gọi.",
          secrets,
          accessibleCount: null,
          version: "",
          rosterComplete: false,
          accounts: [],
        }),
        error_vi: "Chưa có quyền trên máy này. Điền 3 ô OAuth rồi lưu.",
      };
    }

    const tokenHit = await accessToken(secrets);
    if (!tokenHit.token) {
      const connect = publicConnect(clientId, {
        status: tokenHit.status || "TOKEN_EXPIRED",
        title: tokenHit.status === "TOKEN_EXPIRED" ? "TOKEN HẾT HẠN" : "BỊ TỪ CHỐI QUYỀN",
        detail: tokenHit.error || "Không lấy được quyền.",
        next: "Lấy refresh token mới. Không dán vào chat.",
        secrets,
        accessibleCount: null,
        version: "",
        rosterComplete: false,
        accounts: [],
        errorHint: tokenHit.error,
      });
      return {
        install: saved ? { ok: true, yaml_file_present: true } : { ok: true, yaml_file_present: true },
        connect,
        error_vi: tokenHit.error,
      };
    }

    const loginId = digits(secrets.login_customer_id) || MCC_ID;
    const picked = await pickVersion(tokenHit.token, loginId, secrets.developer_token);
    if ("error" in picked) {
      const connect = publicConnect(clientId, {
        status: picked.status,
        title: "CHƯA ĐỌC ĐƯỢC MCC",
        detail: picked.error,
        next: "Kiểm tra Google Cloud đã bật Google Ads API và Google đăng nhập có quyền MCC 532-145-0531.",
        secrets,
        accessibleCount: null,
        version: picked.version,
        rosterComplete: false,
        accounts: [],
        errorHint: picked.error,
      });
      return { install: { ok: true, yaml_file_present: true }, connect, error_vi: picked.error };
    }

    const accessibleIds = picked.resourceNames
      .map((n) => digits(n.split("/").pop()))
      .filter(Boolean);
    const rows = await searchRows(
      picked.version,
      loginId,
      tokenHit.token,
      loginId,
      [
        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager,",
        "customer_client.status, customer_client.currency_code, customer_client.time_zone, customer_client.level",
        "FROM customer_client",
      ].join(" "),
      secrets.developer_token,
    );

    const accounts: MccAccount[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const cc = (row.customerClient || row.customer_client || {}) as Record<string, unknown>;
      const id = digits(String(cc.id || ""));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const manager = Boolean(cc.manager);
      const apiName = String(cc.descriptiveName || cc.descriptive_name || "").trim();
      const slug = slugFor(id, apiName);
      accounts.push({
        client_id: slug.client_id,
        display_name: slug.display_name || dashed(id),
        account_name: apiName || slug.display_name || dashed(id),
        customer_id: id,
        customer_id_dashed: dashed(id),
        status: String(cc.status || ""),
        is_manager: manager,
        currency: cc.currencyCode ? String(cc.currencyCode) : undefined,
        time_zone: cc.timeZone ? String(cc.timeZone) : undefined,
        in_system: !manager,
      });
    }
    for (const id of accessibleIds) {
      if (seen.has(id) || rows.length) continue;
      seen.add(id);
      const slug = slugFor(id);
      accounts.push({
        client_id: slug.client_id,
        display_name: slug.display_name || dashed(id),
        account_name: slug.display_name || dashed(id),
        customer_id: id,
        customer_id_dashed: dashed(id),
        status: "UNKNOWN",
        is_manager: id === loginId,
        in_system: id !== loginId,
      });
    }
    accounts.sort((a, b) => Number(a.is_manager) - Number(b.is_manager) || a.display_name.localeCompare(b.display_name, "vi"));

    const clients = accounts.filter((a) => !a.is_manager);
    persistRoster(accounts, clients.length, clients.length > 0);

    const current =
      accounts.find((a) => a.client_id === clientId) ||
      accounts.find((a) => a.customer_id === (clientId === "fago_group" ? "2204136068" : digits(clientId.replace(/^tkqc_/, ""))));

    const connect = publicConnect(clientId, {
      status: "CONNECTED",
      title: "Engine gọi được Google Ads API",
      detail: clients.length
        ? `Đã đọc MCC ${MCC_DASHED} — ${clients.length} tài khoản quảng cáo. Không apply. Chưa kéo search term / FINAL.`
        : `Gọi API được nhưng chưa liệt kê được tài khoản con của MCC ${MCC_DASHED}. Không đoán tên.`,
      next: clients.length
        ? "Chọn tài khoản trên đầu trang. Kéo kho Phân tích từng khách — không đoán số."
        : "Thử gọi lại. Nếu vẫn trống: Google đăng nhập chưa thấy MCC.",
      secrets,
      account: current,
      accessibleCount: accessibleIds.length || clients.length,
      version: picked.version,
      rosterComplete: clients.length > 0,
      accounts,
    });
    return { install: { ok: true, yaml_file_present: true }, connect };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi gọi probe.";
    return { install: null, connect: null, error_vi: redact(message) };
  }
}

export async function pullKpis(clientId: string): Promise<PullKpisResult> {
  const id = clientId.trim();
  if (!CLIENT_ID_RE.test(id)) {
    return { ok: false, error_vi: "Khách không hợp lệ." };
  }
  return {
    ok: false,
    client_id: id,
    error_vi: "Đã nối MCC thì kéo danh sách tài khoản trên tab Kết nối. Kéo 5 KPI từng khách — phiên này chưa kéo search term, không apply.",
  };
}
