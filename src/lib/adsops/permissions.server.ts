/**
 * Central authorization for AdsOps (server-only).
 *
 * Every server function / route that returns client data goes through
 * `resolveAccess()` and then filters by `ctx.allowed` + `ctx.caps`:
 *   - principal: internal staff (Better Auth Google session) or customer user
 *     (username/password, own `client_users` + `client_sessions` tables);
 *   - role + capabilities from the approved matrix (permissions.types.ts);
 *   - allowed ad accounts: admin = all, everyone else = explicit grants only.
 *
 * Nothing is cached across requests: roles, grants and client sessions are read
 * from Neon on every call, so revoking a grant, deleting a client user or
 * logging out takes effect on the very next request.
 */
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";
import { UnauthorizedError } from "@/lib/auth/verify.server";
import {
  SUPER_ADMIN_EMAIL,
  capabilitiesFor,
  isClientRole,
  isStaffRole,
  type Capabilities,
  type PrincipalKind,
  type Role,
  type ViewAsInfo,
} from "./permissions.types.ts";

export const CLIENT_SESSION_COOKIE = "__Host-adsops.client_session";
export const VIEW_AS_COOKIE = "__Host-adsops.view_as";
const CLIENT_SESSION_MAX_AGE_S = 400 * 24 * 60 * 60; // "until logout" (browser max)
const VIEW_AS_MAX_AGE_S = 8 * 60 * 60;
const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

export type Principal = {
  kind: PrincipalKind;
  /** staff_users.id (or `admin:<email>` for the hard-coded super admin) / client_users.id */
  id: string;
  /** Better Auth user id (staff only). */
  userId: string | null;
  email: string | null;
  username: string | null;
  displayName: string | null;
  role: Role | "pending";
  isSuperAdmin: boolean;
};

export type AccessContext = {
  /** Effective principal (the view-as target while impersonating). */
  principal: Principal;
  /** The person actually signed in. */
  real: Principal;
  caps: Capabilities;
  /** "all" only for the super admin; everyone else: explicit grants. */
  allowed: "all" | Set<string>;
  /** True while admin is viewing as someone else: no mutations. */
  readOnly: boolean;
  viewAs: ViewAsInfo | null;
};

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "Không có quyền.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// ── small helpers ───────────────────────────────────────────────────────────────────

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseCookies(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function cookieHeader(name: string, value: string, maxAgeS: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeS}`;
}

export function setCookieHeader(name: string, value: string, maxAgeS: number): string {
  return cookieHeader(name, value, maxAgeS);
}

export function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ── passwords (scrypt, node:crypto) ──────────────────────────────────────────────────

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  const got = await scryptAsync(password, salt, n, r, p);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function validatePassword(password: string): void {
  if (password.length < 10) throw new Error("Mật khẩu tối thiểu 10 ký tự.");
  if (password.length > 200) throw new Error("Mật khẩu quá dài.");
}

// ── audit ─────────────────────────────────────────────────────────────────────────

export function actorLabel(p: Principal): string {
  return p.kind === "staff" ? p.email || p.id : `client:${p.username || p.id}`;
}

export async function audit(
  actor: string,
  action: string,
  targetKind: string | null,
  targetId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into permission_audit_log (actor, action, target_kind, target_id, detail)
    values (${actor}, ${action}, ${targetKind}, ${targetId}, ${JSON.stringify(detail)}::jsonb)
  `;
}

// ── principals ────────────────────────────────────────────────────────────────────

type StaffRowDb = { id: string; email: string; role: string; display_name: string | null };
type ClientRowDb = {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  role: string;
};

async function staffPrincipal(userId: string, emailRaw: string | null, name: string | null): Promise<Principal> {
  const email = (emailRaw || "").trim().toLowerCase() || null;
  if (email === SUPER_ADMIN_EMAIL) {
    return {
      kind: "staff",
      id: `admin:${SUPER_ADMIN_EMAIL}`,
      userId,
      email,
      username: null,
      displayName: name,
      role: "admin",
      isSuperAdmin: true,
    };
  }
  let row: StaffRowDb | undefined;
  if (email) {
    const sql = await getSql();
    row = (
      await sql<StaffRowDb>`
        select id, email, role, display_name from staff_users where lower(email) = ${email} limit 1
      `
    )[0];
  }
  // Only the hard-coded address is admin; a stray 'admin' row is not honoured.
  const role: Role | "pending" = row && isStaffRole(row.role) && row.role !== "admin" ? row.role : "pending";
  return {
    kind: "staff",
    id: row?.id || `user:${userId}`,
    userId,
    email,
    username: null,
    displayName: row?.display_name || name,
    role,
    isSuperAdmin: false,
  };
}

function clientPrincipalFromRow(row: ClientRowDb): Principal {
  return {
    kind: "client",
    id: row.id,
    userId: null,
    email: row.email,
    username: row.username,
    displayName: row.display_name || row.username,
    role: isClientRole(row.role) ? row.role : "client_staff",
    isSuperAdmin: false,
  };
}

async function clientPrincipalFromToken(token: string): Promise<Principal | null> {
  if (!token || token.length < 32 || token.length > 200) return null;
  const sql = await getSql();
  const rows = await sql<ClientRowDb>`
    select u.id, u.username, u.email, u.display_name, u.role
    from client_sessions s
    join client_users u on u.id = s.client_user_id
    where s.token_hash = ${sha256Hex(token)}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  // Best-effort activity stamp (not awaited on the critical path).
  void sql`update client_sessions set last_seen_at = now() where token_hash = ${sha256Hex(token)} and last_seen_at < now() - interval '10 minutes'`.catch(
    () => undefined,
  );
  return clientPrincipalFromRow(row);
}

async function principalByRef(kind: PrincipalKind, id: string): Promise<Principal | null> {
  const sql = await getSql();
  if (kind === "client") {
    const row = (
      await sql<ClientRowDb>`select id, username, email, display_name, role from client_users where id = ${id} limit 1`
    )[0];
    return row ? clientPrincipalFromRow(row) : null;
  }
  const row = (await sql<StaffRowDb>`select id, email, role, display_name from staff_users where id = ${id} limit 1`)[0];
  if (!row) return null;
  return {
    kind: "staff",
    id: row.id,
    userId: null,
    email: row.email,
    username: null,
    displayName: row.display_name || row.email,
    role: isStaffRole(row.role) && row.role !== "admin" ? row.role : "pending",
    isSuperAdmin: false,
  };
}

export async function grantsFor(p: Principal): Promise<"all" | Set<string>> {
  if (p.isSuperAdmin) return "all";
  if (p.role === "pending") return new Set();
  const sql = await getSql();
  const rows = await sql<{ ad_account_id: string }>`
    select g.ad_account_id
    from account_grants g
    join ad_accounts a on a.id = g.ad_account_id
    where g.principal_kind = ${p.kind} and g.principal_id = ${p.id}
  `;
  return new Set(rows.map((r) => r.ad_account_id));
}

// ── view-as (admin impersonation, read-only) ─────────────────────────────────────────

const globalSecret = globalThis as typeof globalThis & { __adsopsViewAsSecret__?: string };

function signingKey(): string {
  const s = process.env.BETTER_AUTH_SECRET?.trim();
  if (s) return s;
  globalSecret.__adsopsViewAsSecret__ ??= randomBytes(32).toString("hex");
  return globalSecret.__adsopsViewAsSecret__;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signViewAs(adminUserId: string, kind: PrincipalKind, id: string): string {
  const payload = b64url(Buffer.from(JSON.stringify({ a: adminUserId, k: kind, i: id, t: Date.now() })));
  const mac = b64url(createHmac("sha256", signingKey()).update(`view-as.${payload}`).digest());
  return `${payload}.${mac}`;
}

function readViewAs(value: string | undefined): { a: string; k: PrincipalKind; i: string; t: number } | null {
  if (!value) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const want = b64url(createHmac("sha256", signingKey()).update(`view-as.${payload}`).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
      a?: unknown;
      k?: unknown;
      i?: unknown;
      t?: unknown;
    };
    if (typeof data.a !== "string" || typeof data.i !== "string" || typeof data.t !== "number") return null;
    if (data.k !== "staff" && data.k !== "client") return null;
    if (Date.now() - data.t > VIEW_AS_MAX_AGE_S * 1000) return null;
    return { a: data.a, k: data.k, i: data.i, t: data.t };
  } catch {
    return null;
  }
}

export const VIEW_AS_COOKIE_MAX_AGE_S = VIEW_AS_MAX_AGE_S;

// ── resolution ────────────────────────────────────────────────────────────────────

async function staffSessionUser(
  headers: Headers,
  bearerToken?: string,
): Promise<{ id: string; email: string | null; name: string | null } | "dev" | null> {
  const { auth, authConfigured } = await import("@/lib/auth/server");
  if (!authConfigured) {
    // Local dev without sign-in and without a real DB only.
    if (process.env.DATABASE_URL?.trim()) return null;
    return "dev";
  }
  let h = headers;
  if (bearerToken) {
    h = new Headers(headers);
    h.set("Authorization", `Bearer ${bearerToken}`);
  }
  const session = await auth.api.getSession({ headers: h });
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email ?? null, name: session.user.name ?? null };
}

/** Resolve who is calling. Returns null when nobody is signed in. */
export async function resolvePrincipal(
  headers: Headers,
  bearerToken?: string,
): Promise<Principal | null> {
  const staff = await staffSessionUser(headers, bearerToken);
  if (staff === "dev") {
    return {
      kind: "staff",
      id: `admin:${SUPER_ADMIN_EMAIL}`,
      userId: "dev-user",
      email: SUPER_ADMIN_EMAIL,
      username: null,
      displayName: "Dev admin",
      role: "admin",
      isSuperAdmin: true,
    };
  }
  if (staff) return staffPrincipal(staff.id, staff.email, staff.name);
  const token = parseCookies(headers)[CLIENT_SESSION_COOKIE];
  if (token) return clientPrincipalFromToken(token);
  return null;
}

export async function resolveAccessFromHeaders(headers: Headers, bearerToken?: string): Promise<AccessContext> {
  const real = await resolvePrincipal(headers, bearerToken);
  if (!real) throw new UnauthorizedError();

  let principal = real;
  let viewAs: ViewAsInfo | null = null;
  if (real.isSuperAdmin && real.userId) {
    const va = readViewAs(parseCookies(headers)[VIEW_AS_COOKIE]);
    if (va && va.a === real.userId) {
      const target = await principalByRef(va.k, va.i);
      if (target && !target.isSuperAdmin) {
        principal = target;
        viewAs = {
          kind: target.kind,
          id: target.id,
          label: target.kind === "client" ? target.username || target.id : target.email || target.id,
          role: target.role,
          admin_email: real.email,
        };
      }
    }
  }

  const allowed = await grantsFor(principal);
  return {
    principal,
    real,
    caps: capabilitiesFor(principal.role),
    allowed,
    readOnly: viewAs !== null,
    viewAs,
  };
}

/** For server functions: reads the current request. */
export async function resolveAccess(bearerToken?: string): Promise<AccessContext> {
  const request = getRequest();
  if (!request) throw new UnauthorizedError();
  return resolveAccessFromHeaders(request.headers, bearerToken);
}

// ── guards ────────────────────────────────────────────────────────────────────────

export function canSeeAccount(ctx: AccessContext, adAccountId: string): boolean {
  return ctx.allowed === "all" || ctx.allowed.has(adAccountId);
}

export function assertAccount(ctx: AccessContext, adAccountId: string): void {
  if (ctx.principal.role === "pending") throw new ForbiddenError("Chưa được cấp quyền.");
  if (!canSeeAccount(ctx, adAccountId)) throw new ForbiddenError("Không được xem tài khoản này.");
}

export function assertCap(ctx: AccessContext, cap: keyof Capabilities, message?: string): void {
  if (!ctx.caps[cap]) throw new ForbiddenError(message || "Vai trò này không được dùng chức năng này.");
}

/** Mutations: never while viewing-as. */
export function assertWritable(ctx: AccessContext): void {
  if (ctx.readOnly) throw new ForbiddenError("Đang ở chế độ Xem như người dùng (chỉ đọc).");
}

/** Admin actions use the REAL signed-in person (works while viewing-as). */
export function assertRealAdmin(ctx: AccessContext): void {
  if (!ctx.real.isSuperAdmin) throw new ForbiddenError("Chỉ admin làm được việc này.");
}

// ── client sessions ────────────────────────────────────────────────────────────────

export const CLIENT_SESSION_COOKIE_MAX_AGE_S = CLIENT_SESSION_MAX_AGE_S;

/** Verify username/password; returns a new session token or throws a generic error. */
export async function clientPasswordLogin(
  usernameRaw: string,
  password: string,
  userAgent: string | null,
): Promise<{ token: string; principal: Principal }> {
  const username = usernameRaw.trim().toLowerCase();
  const generic = "Tên đăng nhập hoặc mật khẩu không đúng.";
  if (!username || !password || username.length > 120 || password.length > 200) throw new Error(generic);
  const sql = await getSql();
  const rows = await sql<ClientRowDb & { password_hash: string; locked_until: string | null; failed_logins: number }>`
    select id, username, email, display_name, role, password_hash, locked_until::text as locked_until, failed_logins
    from client_users
    where lower(username) = ${username} or (email is not null and lower(email) = ${username})
    order by (lower(username) = ${username}) desc
    limit 1
  `;
  const row = rows[0];
  if (!row) {
    // Equalise timing with a dummy hash.
    await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA").catch(() => false);
    throw new Error(generic);
  }
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new Error(`Tài khoản tạm khoá ${LOCK_MINUTES} phút do nhập sai nhiều lần.`);
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    const fails = Number(row.failed_logins || 0) + 1;
    if (fails >= MAX_FAILED_LOGINS) {
      await sql`
        update client_users
        set failed_logins = 0, locked_until = now() + (${LOCK_MINUTES} || ' minutes')::interval
        where id = ${row.id}
      `;
    } else {
      await sql`update client_users set failed_logins = ${fails} where id = ${row.id}`;
    }
    throw new Error(generic);
  }
  const token = randomBytes(32).toString("base64url");
  await sql`
    insert into client_sessions (token_hash, client_user_id, user_agent)
    values (${sha256Hex(token)}, ${row.id}, ${userAgent ? userAgent.slice(0, 300) : null})
  `;
  await sql`update client_users set failed_logins = 0, locked_until = null, last_login_at = now() where id = ${row.id}`;
  return { token, principal: clientPrincipalFromRow(row) };
}

export async function deleteClientSessionByToken(token: string | undefined): Promise<void> {
  if (!token) return;
  const sql = await getSql();
  await sql`delete from client_sessions where token_hash = ${sha256Hex(token)}`;
}

export async function deleteAllClientSessions(clientUserId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql<{ n: number }>`
    with d as (delete from client_sessions where client_user_id = ${clientUserId} returning 1)
    select count(*)::int as n from d
  `;
  return Number(rows[0]?.n || 0);
}

// ── ad account seeding from the MCC roster ─────────────────────────────────────────────

export type RosterAccount = {
  client_id: string;
  display_name: string;
  customer_id_dashed?: string;
  status?: string;
};

function customerNameFor(a: RosterAccount): string {
  const base = a.display_name.replace(/\s*-\s*\d{3}\s*$/, "").trim();
  return base || a.customer_id_dashed || a.client_id;
}

const seedState = globalThis as typeof globalThis & { __adsopsSeedKey__?: string; __adsopsSeedRun__?: Promise<void> };

/**
 * Make sure every roster account exists in `ad_accounts` (new ones get their
 * own customer, no grants — i.e. admin-only until granted), and apply the
 * one-time legacy ops grant from migration 0005. Idempotent; runs once per
 * warm instance per roster.
 */
export async function ensureAccountsSeeded(roster: RosterAccount[]): Promise<void> {
  const key = roster
    .map((r) => r.client_id)
    .sort()
    .join(",");
  if (seedState.__adsopsSeedKey__ === key && seedState.__adsopsSeedRun__) return seedState.__adsopsSeedRun__;
  seedState.__adsopsSeedKey__ = key;
  seedState.__adsopsSeedRun__ = seedAccounts(roster).catch((err) => {
    seedState.__adsopsSeedKey__ = undefined;
    console.error("[adsops-rbac] seed failed:", err instanceof Error ? err.message : err);
  });
  return seedState.__adsopsSeedRun__;
}

async function seedAccounts(roster: RosterAccount[]): Promise<void> {
  const sql = await getSql();
  const rows = roster.filter((r) => /^[a-z0-9_]+$/.test(r.client_id));
  if (rows.length) {
    const existing = new Set(
      (await sql<{ id: string }>`select id from ad_accounts`).map((r) => r.id),
    );
    const fresh = rows.filter((r) => !existing.has(r.client_id));
    for (const r of fresh) {
      const name = customerNameFor(r);
      const customerId = `cus_${sha256Hex(name.toLowerCase()).slice(0, 16)}`;
      await sql`insert into customers (id, name) values (${customerId}, ${name}) on conflict (id) do nothing`;
      await sql`
        insert into ad_accounts (id, platform, external_id, display_name, customer_id, status)
        values (${r.client_id}, ${"google"}, ${(r.customer_id_dashed || "").replace(/\D/g, "") || null},
                ${r.display_name || r.client_id}, ${customerId}, ${r.status || null})
        on conflict (id) do nothing
      `;
    }
    if (fresh.length) {
      await audit("system:seed", "ad_accounts.discovered", "ad_account", null, {
        ids: fresh.map((r) => r.client_id),
        note: "New accounts are visible to admin only until granted.",
      });
    }
    for (const r of rows.filter((x) => existing.has(x.client_id))) {
      await sql`
        update ad_accounts
        set display_name = ${r.display_name || r.client_id}, status = ${r.status || null}, updated_at = now()
        where id = ${r.client_id} and (display_name is distinct from ${r.display_name || r.client_id} or status is distinct from ${r.status || null})
      `;
    }
  }

  const legacy = await sql<{ value: unknown }>`select value from adsops_kv where key = ${"legacy_ops_emails"} limit 1`;
  if (legacy.length) {
    const emails = Array.isArray(legacy[0].value) ? (legacy[0].value as unknown[]).map(String) : [];
    for (const email of emails) {
      const staff = (await sql<{ id: string }>`select id from staff_users where lower(email) = ${email.toLowerCase()} limit 1`)[0];
      if (!staff) continue;
      await sql`
        insert into account_grants (id, principal_kind, principal_id, ad_account_id, granted_by)
        select 'grt_' || md5('staff:' || ${staff.id} || ':' || a.id), 'staff', ${staff.id}, a.id, 'migration:legacy-ops'
        from ad_accounts a
        on conflict do nothing
      `;
      await audit("system:seed", "grant.legacy_ops_all_accounts", "staff", staff.id, { email });
    }
    await sql`delete from adsops_kv where key = ${"legacy_ops_emails"}`;
  }
}
