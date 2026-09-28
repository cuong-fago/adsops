import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSql } from "@/lib/db";
import type {
  AccessClient,
  AccessSnap,
  Json,
  MccRosterSnap,
  WorkspaceDirectory,
  WorkspacePack,
  WorkspaceScene,
} from "./access.types.ts";
import {
  assertAccount,
  assertCap,
  canSeeAccount,
  ensureAccountsSeeded,
  type AccessContext,
} from "./permissions.server.ts";
import { MODULE_CAPABILITY } from "./permissions.types.ts";

/**
 * AdsOps data loaders (server-only).
 *
 * Snapshot JSON lives in `server-data/adsops/` (NOT `public/`, so the CDN never
 * serves it). At build time `scripts/bundle-adsops-data.mjs` copies it into the
 * Vercel function as `adsops-data/`. There is deliberately NO HTTP fallback:
 * data only leaves the server through authenticated, grant-filtered functions.
 */

const CLIENT_ID_RE = /^[a-z0-9_]+$/;
const PINNED_CLIENTS = ["tkqc_6810292395", "fago_group"];
const SCENE_IDS = new Set(["stale", "coverage", "fake_cpa", "source_conflict", "conv_zero"]);
/** Keep parsed snapshots warm across warm serverless invocations. */
const JSON_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = { at: number; value: Json | null };

const jsonCache = new Map<string, CacheEntry>();
const jsonInflight = new Map<string, Promise<Json | null>>();

function moduleDir(): string | null {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
}

export function candidateDataDirs(): string[] {
  const here = moduleDir();
  const dirs = [
    process.env.ADSOPS_DATA_DIR?.trim(),
    join(process.cwd(), "adsops-data"),
    join(process.cwd(), "server-data/adsops"),
    "/var/task/adsops-data",
    "/workspace/server-data/adsops",
    ...(here
      ? [join(here, "adsops-data"), join(here, "../adsops-data"), join(here, "../../adsops-data"), join(here, "../../../adsops-data")]
      : []),
  ].filter((d): d is string => Boolean(d));
  return [...new Set(dirs)];
}

let resolvedDataDir: string | null | undefined;

export function resolveDataDir(): string | null {
  if (resolvedDataDir) return resolvedDataDir;
  for (const dir of candidateDataDirs()) {
    if (existsSync(join(dir, "mcc.json"))) {
      resolvedDataDir = dir;
      return dir;
    }
  }
  return null;
}

function normalizeRel(relativePath: string): string {
  return relativePath.replace(/^\/+/, "").replace(/\\/g, "/");
}

async function readJsonUncached(rel: string): Promise<Json | null> {
  if (rel.includes("..")) return null;
  const dir = resolveDataDir();
  if (!dir) {
    console.error("[adsops] data dir not found; tried:", candidateDataDirs().join(", "));
    return null;
  }
  const full = join(dir, rel);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, "utf8")) as Json;
  } catch {
    return null;
  }
}

async function readJsonRelative(relativePath: string): Promise<Json | null> {
  const rel = normalizeRel(relativePath);
  const hit = jsonCache.get(rel);
  if (hit && Date.now() - hit.at < JSON_CACHE_TTL_MS) return hit.value;

  const pending = jsonInflight.get(rel);
  if (pending) return pending;

  const task = (async () => {
    try {
      const value = await readJsonUncached(rel);
      jsonCache.set(rel, { at: Date.now(), value });
      return value;
    } finally {
      jsonInflight.delete(rel);
    }
  })();
  jsonInflight.set(rel, task);
  return task;
}

function asRec(value: Json | null | undefined): { [key: string]: Json } | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return null;
}

async function readFolder(folder: string, clientId: string): Promise<Json | null> {
  if (!CLIENT_ID_RE.test(clientId)) return null;
  return readJsonRelative(`${folder}/${clientId}.json`);
}

async function rosterClients(): Promise<AccessClient[]> {
  const raw = asRec(await readJsonRelative("mcc.json"));
  const accounts = Array.isArray(raw?.accounts) ? raw.accounts : [];
  return accounts
    .filter((a): a is { [key: string]: Json } =>
      Boolean(a && typeof a === "object" && !Array.isArray(a) && a.client_id && !a.is_manager),
    )
    .map((a) => ({
      client_id: String(a.client_id),
      display_name: String(a.display_name || a.client_id),
      customer_id_dashed: String(a.customer_id_dashed || ""),
      status: a.status ? String(a.status) : undefined,
      adapter: "live",
    }));
}

/** Every ad account AdsOps knows about (registry + connect registry + MCC roster). */
async function mergeAllClients(): Promise<AccessClient[]> {
  const [registryRaw, connectRaw] = await Promise.all([
    readJsonRelative("registry.json"),
    readJsonRelative("connect-registry.json"),
  ]);
  const registry = asRec(registryRaw);
  const connect = asRec(connectRaw);
  const by = new Map<string, AccessClient>();
  const push = (row: { [key: string]: Json }) => {
    const id = String(row.client_id || "");
    if (!id || !CLIENT_ID_RE.test(id)) return;
    const prev = by.get(id);
    by.set(id, {
      client_id: id,
      display_name: String(row.display_name || prev?.display_name || id),
      customer_id_dashed: String(row.customer_id_dashed || prev?.customer_id_dashed || ""),
      status: row.status ? String(row.status) : prev?.status,
      adapter: String(row.adapter || prev?.adapter || "live"),
    });
  };
  const connectClients = Array.isArray(connect?.clients) ? connect.clients : [];
  const regClients = Array.isArray(registry?.clients) ? registry.clients : [];
  for (const row of connectClients) {
    if (row && typeof row === "object" && !Array.isArray(row)) push(row);
  }
  for (const row of regClients) {
    if (row && typeof row === "object" && !Array.isArray(row)) push(row);
  }
  for (const row of await rosterClients()) {
    if (!by.has(row.client_id)) by.set(row.client_id, row);
  }
  return [...by.values()].sort((a, b) => {
    const ia = PINNED_CLIENTS.indexOf(a.client_id);
    const ib = PINNED_CLIENTS.indexOf(b.client_id);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return (a.display_name || "").localeCompare(b.display_name || "", "vi");
  });
}

/** Seed `ad_accounts` from the roster (once per warm instance). */
export async function ensureRosterSeeded(): Promise<void> {
  const all = await mergeAllClients();
  if (!all.length) return;
  await ensureAccountsSeeded(
    all.map((c) => ({
      client_id: c.client_id,
      display_name: c.display_name,
      customer_id_dashed: c.customer_id_dashed,
      status: c.status,
    })),
  );
}

/** Accounts known to AdsOps, for the admin panel. */
export async function listRosterAccounts(): Promise<AccessClient[]> {
  return mergeAllClients();
}

async function readMcc(ctx: AccessContext): Promise<MccRosterSnap | null> {
  const raw = asRec(await readJsonRelative("mcc.json"));
  if (!raw) return null;
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const rows = accounts
    .map((row) => {
      const r = row && typeof row === "object" && !Array.isArray(row) ? row : {};
      return {
        client_id: String(r.client_id || ""),
        display_name: String(r.display_name || r.account_name || ""),
        customer_id_dashed: String(r.customer_id_dashed || ""),
        in_system: r.in_system !== false,
        is_manager: Boolean(r.is_manager),
        status: String(r.status || ""),
      };
    })
    .filter((a) => a.client_id)
    // Non-admin staff never learn other accounts in the MCC.
    .filter((a) => ctx.allowed === "all" || (!a.is_manager && canSeeAccount(ctx, a.client_id)));
  return {
    mcc_id_dashed: String(raw.mcc_id_dashed || "532-145-0531"),
    mcc_display_name: String(raw.mcc_display_name || "Fago Agency"),
    last_probe_accessible_count:
      ctx.allowed === "all" ? Number(raw.last_probe_accessible_count || accounts.length) : rows.length,
    roster_complete: ctx.allowed === "all" ? Boolean(raw.roster_complete) : true,
    note_vi: ctx.allowed === "all" ? String(raw.note_vi || "") : "",
    accounts: rows,
  };
}

async function visibleClients(ctx: AccessContext): Promise<AccessClient[]> {
  if (ctx.principal.role === "pending") return [];
  const all = await mergeAllClients();
  return all.filter((c) => canSeeAccount(ctx, c.client_id));
}

export async function loadAccess(ctx: AccessContext): Promise<AccessSnap> {
  const clients = await visibleClients(ctx);
  const p = ctx.principal;
  return {
    role: p.role,
    kind: p.kind,
    email: p.kind === "client" ? p.username : p.email,
    display_name: p.displayName,
    all_clients: ctx.allowed === "all",
    client_ids: clients.map((c) => c.client_id),
    clients,
    caps: ctx.caps,
    view_as: ctx.viewAs,
    read_only: ctx.readOnly,
    real_email: ctx.real.email,
    real_is_admin: ctx.real.isSuperAdmin,
  };
}

function emptyPack(): WorkspacePack {
  return {
    report: null,
    alerts: null,
    guard: null,
    hub: null,
    proposals: null,
    classify: null,
    final: null,
    connect: null,
    sop: null,
    analytics: null,
    pace: null,
    as_of: null,
    data_through: null,
    analytics_source: null,
  };
}

export async function loadWorkspaceDirectory(ctx: AccessContext): Promise<WorkspaceDirectory> {
  const access = await loadAccess(ctx);
  if (access.role === "pending") {
    return { access, clients: [], mcc: null };
  }
  // Customers never see the MCC; staff only see their granted part of it.
  const mcc = ctx.principal.kind === "staff" ? await readMcc(ctx) : null;
  return { access, clients: access.clients, mcc };
}

const WORKSPACE_MODULE_KEYS = [
  "report",
  "alerts",
  "guard",
  "hub",
  "proposals",
  "classify",
  "final",
  "connect",
  "sop",
  "analytics",
  "pace",
  "compare",
] as const;

type WorkspaceModuleKey = (typeof WORKSPACE_MODULE_KEYS)[number];

function normalizeModules(modules?: string[]): Set<WorkspaceModuleKey> | null {
  if (!modules || !modules.length) return null;
  const allowed = new Set<string>(WORKSPACE_MODULE_KEYS);
  const picked = new Set<WorkspaceModuleKey>();
  for (const raw of modules) {
    const key = String(raw || "").trim() as WorkspaceModuleKey;
    if (!allowed.has(key)) continue;
    picked.add(key);
  }
  return picked.size ? picked : null;
}

function wantsModule(ctx: AccessContext, filter: Set<WorkspaceModuleKey> | null, key: WorkspaceModuleKey): boolean {
  const cap = MODULE_CAPABILITY[key];
  if (cap && !ctx.caps[cap]) return false;
  if (!filter) return true;
  if (key === "report" || key === "compare") {
    return filter.has("report") || filter.has("compare");
  }
  return filter.has(key);
}

/** `/adsops/<folder>/files/<name>.xlsx` -> authenticated download route. */
function fileHref(clientId: string, raw: string): string {
  const rel = raw.replace(/^\/?adsops\//, "").replace(/^\/+/, "");
  if (!rel || rel.includes("..")) return "";
  return `/api/adsops-file?client=${encodeURIComponent(clientId)}&path=${encodeURIComponent(rel)}`;
}

/** Rewrite (download allowed) or strip (not allowed) every `xlsx_href`. */
function fixFileLinks(value: Json, clientId: string, allowDownload: boolean, depth = 0): Json {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    // Large row arrays never carry file links; skip deep walks for speed.
    if (value.length > 200) return value;
    return value.map((v) => fixFileLinks(v, clientId, allowDownload, depth + 1));
  }
  const out: { [key: string]: Json } = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "xlsx_href" && typeof v === "string") {
      out[k] = allowDownload && v ? fileHref(clientId, v) : "";
    } else {
      out[k] = fixFileLinks(v, clientId, allowDownload, depth + 1);
    }
  }
  return out;
}

const COMPARE_KEYS = new Set(["compare", "compare_label", "compare_howto", "previous", "delta", "prev", "window_ranges"]);

/**
 * Remove every previous-period / comparison field (roles without `compare`,
 * i.e. customers). Walks objects; big row arrays are daily series for the
 * chosen account and carry no comparison fields, so they are kept as-is.
 */
export function stripCompare(value: Json, depth = 0): Json {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    if (value.length > 200) return value;
    return value.map((v) => stripCompare(v, depth + 1));
  }
  const out: { [key: string]: Json } = {};
  for (const [k, v] of Object.entries(value)) {
    if (COMPARE_KEYS.has(k) || /^prev(ious)?_/i.test(k) || /_(delta|prev|previous)$/i.test(k)) continue;
    out[k] = stripCompare(v, depth + 1);
  }
  return out;
}

/** Drop other accounts from roster-like arrays for anyone but admin. */
function scopeRosterArrays(value: Json | null, ctx: AccessContext): Json | null {
  if (ctx.allowed === "all") return value;
  const rec = asRec(value);
  if (!rec) return value;
  const out: { [key: string]: Json } = { ...rec };
  for (const key of ["accounts", "mcc_accounts", "clients"]) {
    const arr = rec[key];
    if (!Array.isArray(arr)) continue;
    out[key] = arr.filter((row) => {
      const r = asRec(row);
      if (!r || typeof r.client_id !== "string") return true;
      return canSeeAccount(ctx, r.client_id);
    });
  }
  return out;
}

function pickIso(...values: Array<Json | undefined>): string | null {
  for (const v of values) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))) return v;
  }
  return null;
}

async function readWarehouse(clientId: string): Promise<{ payload: Json; pulled_at: string | null } | null> {
  try {
    const sql = await getSql();
    const rows = await sql<{ payload: Json; pulled_at: string | null }>`
      select payload, to_char(pulled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as pulled_at
      from adsops_analytics_warehouse
      where client_id = ${clientId}
      limit 1
    `;
    const row = rows[0];
    if (!row || !row.payload) return null;
    const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as Json) : row.payload;
    return { payload, pulled_at: row.pulled_at };
  } catch {
    // Table missing on a fresh DB, or Neon unavailable: fall back to snapshot.
    return null;
  }
}

export async function loadWorkspacePack(
  ctx: AccessContext,
  clientId: string,
  modules?: string[],
): Promise<WorkspacePack> {
  if (!CLIENT_ID_RE.test(clientId)) throw new Error("Khách không hợp lệ.");
  assertAccount(ctx, clientId);
  const filter = normalizeModules(modules);
  const want = (key: WorkspaceModuleKey) => wantsModule(ctx, filter, key);

  const needReport = want("report");
  const needCompare = needReport && ctx.caps.compare;
  const needAnalytics = want("analytics");

  const [reportRaw, compareRaw, alerts, guard, hub, proposals, classify, final, connect, sop, analyticsFile, pace, warehouse] =
    await Promise.all([
      needReport ? readFolder("report", clientId) : Promise.resolve(null),
      needCompare ? readFolder("compare", clientId) : Promise.resolve(null),
      want("alerts") ? readFolder("alerts", clientId) : Promise.resolve(null),
      want("guard") ? readFolder("guard", clientId) : Promise.resolve(null),
      want("hub") ? readFolder("hub", clientId) : Promise.resolve(null),
      want("proposals") ? readFolder("proposals", clientId) : Promise.resolve(null),
      want("classify") ? readFolder("classify", clientId) : Promise.resolve(null),
      want("final") ? readFolder("final", clientId) : Promise.resolve(null),
      want("connect") ? readFolder("connect", clientId) : Promise.resolve(null),
      want("sop") ? readJsonRelative("sop.json") : Promise.resolve(null),
      needAnalytics ? readFolder("analytics", clientId) : Promise.resolve(null),
      want("pace") ? readFolder("budget-email", clientId) : Promise.resolve(null),
      needAnalytics ? readWarehouse(clientId) : Promise.resolve(null),
    ]);

  const pack = emptyPack();
  const dl = ctx.caps.download;
  if (needReport) {
    const report = asRec(reportRaw);
    const compare = asRec(compareRaw);
    if (report) {
      const merged: { [key: string]: Json } = { ...report };
      if (compare && ctx.caps.compare) merged.compare = compare;
      const scoped = ctx.caps.compare ? merged : (stripCompare(merged) as { [key: string]: Json });
      pack.report = fixFileLinks(scoped, clientId, dl);
      pack.data_through = typeof report.data_through === "string" ? report.data_through : null;
      pack.as_of = pickIso(report.pulled_at, report.generated_at, report.as_of, report.updated_at);
    }
  }
  pack.alerts = alerts;
  pack.guard = guard;
  pack.hub = scopeRosterArrays(hub, ctx);
  pack.proposals = proposals;
  pack.classify = classify;
  pack.final = final ? fixFileLinks(final, clientId, dl) : null;
  pack.connect = scopeRosterArrays(connect, ctx);
  pack.sop = sop;
  pack.pace = pace;
  if (needAnalytics) {
    const fromNeon = warehouse ? asRec(warehouse.payload) : null;
    const snap = fromNeon || asRec(analyticsFile);
    if (snap) {
      const out: { [key: string]: Json } = { ...snap };
      // Budget alerts are not for customers.
      if (!ctx.caps.optimize) delete out.budget_pace;
      if (!ctx.caps.compare) {
        // No previous-period data for customers: no week/month comparison
        // choices and no comparison fields anywhere in the payload.
        out.week_choices = [];
        out.month_choices = [];
        for (const k of Object.keys(out)) {
          if (k !== "daily") out[k] = stripCompare(out[k]);
        }
      }
      pack.analytics = out;
      pack.analytics_source = fromNeon ? "neon" : "snapshot";
      const through = typeof snap.data_through === "string" ? snap.data_through : null;
      if (through && (!pack.data_through || through > pack.data_through)) pack.data_through = through;
      const iso = (fromNeon && warehouse?.pulled_at) || pickIso(snap.pulled_at, snap.generated_at, snap.as_of);
      if (iso && (!pack.as_of || iso > pack.as_of)) pack.as_of = iso;
    }
  }
  return pack;
}

export async function loadWorkspaceScene(
  ctx: AccessContext,
  clientId: string,
  scenario: string,
): Promise<WorkspaceScene> {
  assertCap(ctx, "optimize");
  assertAccount(ctx, clientId);
  if (!SCENE_IDS.has(scenario) || !CLIENT_ID_RE.test(clientId)) {
    return { final: null, guard: null, proposals: null, alerts: null };
  }
  const alertId = scenario === "fake_cpa" || scenario === "source_conflict" ? "" : scenario;
  const sceneFile = (folder: string, suffix: string) =>
    readJsonRelative(`${folder}/scenarios/${clientId}__${suffix}.json`);
  const [final, guard, proposals, alerts] = await Promise.all([
    ctx.caps.opsTabs ? sceneFile("final", scenario) : Promise.resolve(null),
    sceneFile("guard", scenario),
    sceneFile("proposals", scenario),
    alertId ? sceneFile("alerts", alertId) : Promise.resolve(null),
  ]);
  return { final: final ? fixFileLinks(final, clientId, ctx.caps.download) : null, guard, proposals, alerts };
}

/** Absolute path of a downloadable file for a client, or null. */
export function resolveClientFile(clientId: string, relPath: string): string | null {
  if (!CLIENT_ID_RE.test(clientId)) return null;
  const rel = normalizeRel(relPath);
  if (rel.includes("..") || !/^[a-z0-9_-]+\/files\/[^/]+\.(xlsx|csv|pdf)$/i.test(rel)) return null;
  const name = rel.split("/").pop() || "";
  // A file belongs to exactly one account: its name starts with the account id.
  if (!name.startsWith(`${clientId}-`) && !name.startsWith(`${clientId} `) && !name.startsWith(`${clientId}.`)) {
    return null;
  }
  const dir = resolveDataDir();
  if (!dir) return null;
  const full = join(dir, rel);
  return existsSync(full) ? full : null;
}
