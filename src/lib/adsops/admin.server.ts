/**
 * Permission administration (server-only). Every mutation writes
 * `permission_audit_log`. Admin actions check the REAL signed-in person
 * (`assertRealAdmin`) so they keep working during "Xem như người dùng này".
 */
import { getSql } from "@/lib/db";
import {
  actorLabel,
  assertCap,
  assertRealAdmin,
  assertWritable,
  audit,
  canSeeAccount,
  deleteAllClientSessions,
  ForbiddenError,
  hashPassword,
  newId,
  validatePassword,
  type AccessContext,
} from "./permissions.server.ts";
import {
  ASSIGNABLE_STAFF_ROLES,
  SUPER_ADMIN_EMAIL,
  isClientRole,
  type AdAccountRow,
  type AdminDirectory,
  type AuditRow,
  type ClientRole,
  type ClientUserRow,
  type CustomerRow,
  type GrantRequestRow,
  type PrincipalKind,
  type RequestDirectory,
  type StaffRole,
  type StaffUserRow,
  type UnassignedLogin,
} from "./permissions.types.ts";

const iso = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const USERNAME_RE = /^[a-z0-9][a-z0-9._@-]{2,59}$/;

function adminActor(ctx: AccessContext): string {
  return actorLabel(ctx.real);
}

function uniq(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && /^[a-z0-9_]+$/.test(x)))];
}

async function existingAccountIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(`select id from ad_accounts where id = any($1::text[])`, [ids]);
  return rows.map((r) => r.id);
}

async function grantsMap(kind: PrincipalKind): Promise<Map<string, string[]>> {
  const sql = await getSql();
  const rows = await sql<{ principal_id: string; ad_account_id: string }>`
    select principal_id, ad_account_id from account_grants where principal_kind = ${kind} order by ad_account_id
  `;
  const by = new Map<string, string[]>();
  for (const r of rows) {
    const cur = by.get(r.principal_id) || [];
    cur.push(r.ad_account_id);
    by.set(r.principal_id, cur);
  }
  return by;
}

async function listRequests(where: string, params: unknown[]): Promise<GrantRequestRow[]> {
  const sql = await getSql();
  const rows = await sql.query<Omit<GrantRequestRow, "target_label"> & { target_label: string | null }>(
    `select r.id, r.requested_by, r.requester_role, r.target_kind, r.target_id,
            coalesce(cu.username, su.email, r.target_id) as target_label,
            r.ad_account_ids, r.note, r.status, r.decided_by, ${iso("r.decided_at")} as decided_at,
            r.decision_note, ${iso("r.created_at")} as created_at
     from grant_requests r
     left join client_users cu on r.target_kind = 'client' and cu.id = r.target_id
     left join staff_users su on r.target_kind = 'staff' and su.id = r.target_id
     ${where}
     order by (r.status = 'pending') desc, r.created_at desc
     limit 200`,
    params,
  );
  return rows.map((r) => ({
    ...r,
    target_label: r.target_label || r.target_id,
    ad_account_ids: Array.isArray(r.ad_account_ids) ? (r.ad_account_ids as unknown[]).map(String) : [],
  }));
}

// ── directory ───────────────────────────────────────────────────────────────────────

export async function adminDirectory(ctx: AccessContext): Promise<AdminDirectory> {
  assertRealAdmin(ctx);
  const sql = await getSql();
  const [staffRows, clientRows, customers, accounts, staffGrants, clientGrants, loginRows] = await Promise.all([
    sql<{ id: string; email: string; role: StaffRole; display_name: string | null; logged_in: boolean }>`
      select s.id, s.email, s.role, s.display_name,
             exists (select 1 from "user" u where lower(u.email) = lower(s.email)) as logged_in
      from staff_users s
      order by s.role, s.email
    `,
    sql.query<Omit<ClientUserRow, "account_ids">>(
      `select u.id, u.username, u.email, u.display_name, u.role, u.customer_id,
              ${iso("u.created_at")} as created_at, ${iso("u.last_login_at")} as last_login_at,
              (select count(*)::int from client_sessions s where s.client_user_id = u.id) as active_sessions
       from client_users u
       order by u.username`,
    ),
    sql<CustomerRow>`select id, name, note from customers order by name`,
    sql.query<AdAccountRow>(
      `select a.id, a.platform, a.external_id, a.display_name, a.customer_id, a.sale_staff_id, a.status,
              ${iso("a.first_seen_at")} as first_seen_at,
              (select count(*)::int from account_grants g where g.ad_account_id = a.id) as grant_count
       from ad_accounts a
       order by a.display_name`,
    ),
    grantsMap("staff"),
    grantsMap("client"),
    sql<UnassignedLogin>`
      select u.id as user_id, lower(u.email) as email, u.name
      from "user" u
      where lower(u.email) <> ${SUPER_ADMIN_EMAIL}
        and not exists (select 1 from staff_users s where lower(s.email) = lower(u.email))
      order by u.email
      limit 200
    `,
  ]);
  const staff: StaffUserRow[] = [
    {
      id: `admin:${SUPER_ADMIN_EMAIL}`,
      email: SUPER_ADMIN_EMAIL,
      role: "admin",
      display_name: "Super admin",
      hard_coded: true,
      has_logged_in: true,
      account_ids: [],
    },
    ...staffRows
      .filter((s) => s.email.toLowerCase() !== SUPER_ADMIN_EMAIL)
      .map((s) => ({
        id: s.id,
        email: s.email,
        role: s.role,
        display_name: s.display_name,
        hard_coded: false,
        has_logged_in: Boolean(s.logged_in),
        account_ids: staffGrants.get(s.id) || [],
      })),
  ];
  const clients: ClientUserRow[] = clientRows.map((c) => ({
    ...c,
    role: isClientRole(c.role) ? c.role : "client_staff",
    active_sessions: Number(c.active_sessions || 0),
    account_ids: clientGrants.get(c.id) || [],
  }));
  return {
    staff,
    clients,
    customers,
    accounts: accounts.map((a) => ({ ...a, grant_count: Number(a.grant_count || 0) })),
    requests: await listRequests("", []),
    unassigned_logins: loginRows,
  };
}

// ── staff ─────────────────────────────────────────────────────────────────────────

export async function upsertStaff(
  ctx: AccessContext,
  input: { email: string; role: string; display_name?: string | null },
): Promise<void> {
  assertRealAdmin(ctx);
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email không hợp lệ.");
  if (email === SUPER_ADMIN_EMAIL) throw new Error("Admin là cố định, không đổi vai trò.");
  if (!(ASSIGNABLE_STAFF_ROLES as string[]).includes(input.role)) throw new Error("Vai trò không hợp lệ.");
  const sql = await getSql();
  const prev = (await sql<{ id: string; role: string }>`select id, role from staff_users where lower(email) = ${email} limit 1`)[0];
  const name = input.display_name?.trim() || null;
  if (prev) {
    await sql`update staff_users set role = ${input.role}, display_name = coalesce(${name}, display_name), updated_at = now() where id = ${prev.id}`;
    await audit(adminActor(ctx), "staff.role_set", "staff", prev.id, { email, from: prev.role, to: input.role });
  } else {
    const id = newId("stf");
    await sql`insert into staff_users (id, email, role, display_name, created_by) values (${id}, ${email}, ${input.role}, ${name}, ${adminActor(ctx)})`;
    await audit(adminActor(ctx), "staff.create", "staff", id, { email, role: input.role });
  }
}

export async function removeStaff(ctx: AccessContext, id: string): Promise<void> {
  assertRealAdmin(ctx);
  const sql = await getSql();
  const row = (await sql<{ id: string; email: string; role: string }>`select id, email, role from staff_users where id = ${id} limit 1`)[0];
  if (!row) return;
  const grants = await sql<{ ad_account_id: string }>`
    delete from account_grants where principal_kind = 'staff' and principal_id = ${id} returning ad_account_id
  `;
  await sql`delete from staff_users where id = ${id}`;
  await audit(adminActor(ctx), "staff.remove", "staff", id, {
    email: row.email,
    role: row.role,
    revoked_accounts: grants.map((g) => g.ad_account_id),
  });
}

// ── client users ───────────────────────────────────────────────────────────────────

export async function createClientUser(
  ctx: AccessContext,
  input: {
    username: string;
    password: string;
    display_name?: string | null;
    email?: string | null;
    role?: string;
    customer_id?: string | null;
  },
): Promise<{ id: string }> {
  assertRealAdmin(ctx);
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new Error("Tên đăng nhập 3–60 ký tự: chữ thường, số, . _ - @");
  }
  validatePassword(input.password);
  const role: ClientRole = isClientRole(input.role) ? input.role : "client_staff";
  const email = input.email?.trim().toLowerCase() || null;
  const sql = await getSql();
  const dup = await sql<{ id: string }>`
    select id from client_users where lower(username) = ${username} or (${email}::text is not null and lower(email) = ${email}) limit 1
  `;
  if (dup.length) throw new Error("Tên đăng nhập hoặc email đã tồn tại.");
  const customerId = input.customer_id?.trim() || null;
  if (customerId) {
    const c = await sql`select 1 from customers where id = ${customerId}`;
    if (!c.length) throw new Error("Không tìm thấy khách hàng (công ty).");
  }
  const id = newId("cli");
  const hash = await hashPassword(input.password);
  await sql`
    insert into client_users (id, username, email, display_name, customer_id, role, password_hash, created_by)
    values (${id}, ${username}, ${email}, ${input.display_name?.trim() || null}, ${customerId}, ${role}, ${hash}, ${adminActor(ctx)})
  `;
  await audit(adminActor(ctx), "client.create", "client", id, { username, role, customer_id: customerId });
  return { id };
}

export async function updateClientUser(
  ctx: AccessContext,
  input: { id: string; role?: string; display_name?: string | null; email?: string | null; customer_id?: string | null },
): Promise<void> {
  assertRealAdmin(ctx);
  const sql = await getSql();
  const prev = (
    await sql<{ id: string; username: string; role: string; display_name: string | null; email: string | null; customer_id: string | null }>`
      select id, username, role, display_name, email, customer_id from client_users where id = ${input.id} limit 1
    `
  )[0];
  if (!prev) throw new Error("Không tìm thấy người dùng.");
  const role = isClientRole(input.role) ? input.role : prev.role;
  const display = input.display_name === undefined ? prev.display_name : input.display_name?.trim() || null;
  const email = input.email === undefined ? prev.email : input.email?.trim().toLowerCase() || null;
  const customerId = input.customer_id === undefined ? prev.customer_id : input.customer_id?.trim() || null;
  await sql`
    update client_users
    set role = ${role}, display_name = ${display}, email = ${email}, customer_id = ${customerId}, updated_at = now()
    where id = ${input.id}
  `;
  await audit(adminActor(ctx), "client.update", "client", input.id, {
    username: prev.username,
    from: { role: prev.role, display_name: prev.display_name, email: prev.email, customer_id: prev.customer_id },
    to: { role, display_name: display, email, customer_id: customerId },
  });
}

export async function resetClientPassword(ctx: AccessContext, id: string, password: string): Promise<void> {
  assertRealAdmin(ctx);
  validatePassword(password);
  const sql = await getSql();
  const row = (await sql<{ username: string }>`select username from client_users where id = ${id} limit 1`)[0];
  if (!row) throw new Error("Không tìm thấy người dùng.");
  const hash = await hashPassword(password);
  await sql`update client_users set password_hash = ${hash}, failed_logins = 0, locked_until = null, updated_at = now() where id = ${id}`;
  const ended = await deleteAllClientSessions(id);
  await audit(adminActor(ctx), "client.password_reset", "client", id, { username: row.username, sessions_ended: ended });
}

export async function revokeClientSessions(ctx: AccessContext, id: string): Promise<number> {
  assertRealAdmin(ctx);
  const sql = await getSql();
  const row = (await sql<{ username: string }>`select username from client_users where id = ${id} limit 1`)[0];
  if (!row) throw new Error("Không tìm thấy người dùng.");
  const ended = await deleteAllClientSessions(id);
  await audit(adminActor(ctx), "client.sessions_revoked", "client", id, { username: row.username, sessions_ended: ended });
  return ended;
}

/** Contract end: removes the login, its sessions and every grant immediately. */
export async function deleteClientUser(ctx: AccessContext, id: string): Promise<void> {
  assertRealAdmin(ctx);
  const sql = await getSql();
  const row = (await sql<{ username: string; customer_id: string | null }>`select username, customer_id from client_users where id = ${id} limit 1`)[0];
  if (!row) return;
  const grants = await sql<{ ad_account_id: string }>`
    delete from account_grants where principal_kind = 'client' and principal_id = ${id} returning ad_account_id
  `;
  const ended = await deleteAllClientSessions(id);
  await sql`
    update grant_requests set status = 'cancelled', decided_by = ${adminActor(ctx)}, decided_at = now(),
           decision_note = 'client user deleted'
    where target_kind = 'client' and target_id = ${id} and status = 'pending'
  `;
  await sql`delete from client_users where id = ${id}`;
  await audit(adminActor(ctx), "client.delete", "client", id, {
    username: row.username,
    customer_id: row.customer_id,
    revoked_accounts: grants.map((g) => g.ad_account_id),
    sessions_ended: ended,
  });
}

// ── grants ─────────────────────────────────────────────────────────────────────────

async function targetLabel(kind: PrincipalKind, id: string): Promise<string> {
  const sql = await getSql();
  if (kind === "client") {
    const r = (await sql<{ username: string }>`select username from client_users where id = ${id} limit 1`)[0];
    if (!r) throw new Error("Không tìm thấy người dùng khách hàng.");
    return r.username;
  }
  if (id.startsWith("admin:")) throw new Error("Admin thấy mọi tài khoản, không cần cấp.");
  const r = (await sql<{ email: string }>`select email from staff_users where id = ${id} limit 1`)[0];
  if (!r) throw new Error("Không tìm thấy nhân sự.");
  return r.email;
}

async function addGrants(kind: PrincipalKind, id: string, accountIds: string[], by: string): Promise<string[]> {
  if (!accountIds.length) return [];
  const sql = await getSql();
  const rows = await sql.query<{ ad_account_id: string }>(
    `insert into account_grants (id, principal_kind, principal_id, ad_account_id, granted_by)
     select 'grt_' || md5($1 || ':' || $2 || ':' || a), $1, $2, a, $3
     from unnest($4::text[]) as a
     on conflict do nothing
     returning ad_account_id`,
    [kind, id, by, accountIds],
  );
  return rows.map((r) => r.ad_account_id);
}

/** "Chọn người → tick tài khoản": replace the full grant set of one principal. */
export async function setGrants(
  ctx: AccessContext,
  input: { kind: PrincipalKind; id: string; accountIds: string[] },
): Promise<{ added: string[]; removed: string[] }> {
  assertRealAdmin(ctx);
  const label = await targetLabel(input.kind, input.id);
  const wanted = await existingAccountIds(uniq(input.accountIds));
  const sql = await getSql();
  const removedRows = await sql.query<{ ad_account_id: string }>(
    `delete from account_grants
     where principal_kind = $1 and principal_id = $2 and not (ad_account_id = any($3::text[]))
     returning ad_account_id`,
    [input.kind, input.id, wanted],
  );
  const added = await addGrants(input.kind, input.id, wanted, adminActor(ctx));
  const removed = removedRows.map((r) => r.ad_account_id);
  if (added.length || removed.length) {
    await audit(adminActor(ctx), "grant.set", input.kind, input.id, { target: label, added, removed });
  }
  return { added, removed };
}

// ── customers & ad accounts ────────────────────────────────────────────────────────────

export async function upsertCustomer(
  ctx: AccessContext,
  input: { id?: string | null; name: string; note?: string | null },
): Promise<{ id: string }> {
  assertRealAdmin(ctx);
  const name = input.name.trim();
  if (!name) throw new Error("Thiếu tên khách hàng.");
  const sql = await getSql();
  if (input.id) {
    const prev = (await sql<{ name: string }>`select name from customers where id = ${input.id} limit 1`)[0];
    if (!prev) throw new Error("Không tìm thấy khách hàng.");
    await sql`update customers set name = ${name}, note = ${input.note?.trim() || null}, updated_at = now() where id = ${input.id}`;
    await audit(adminActor(ctx), "customer.update", "customer", input.id, { from: prev.name, to: name });
    return { id: input.id };
  }
  const id = newId("cus");
  await sql`insert into customers (id, name, note) values (${id}, ${name}, ${input.note?.trim() || null})`;
  await audit(adminActor(ctx), "customer.create", "customer", id, { name });
  return { id };
}

export async function deleteCustomer(ctx: AccessContext, id: string): Promise<void> {
  assertRealAdmin(ctx);
  const sql = await getSql();
  const prev = (await sql<{ name: string }>`select name from customers where id = ${id} limit 1`)[0];
  if (!prev) return;
  const n = (await sql<{ n: number }>`select count(*)::int as n from ad_accounts where customer_id = ${id}`)[0]?.n || 0;
  if (Number(n) > 0) throw new Error("Khách hàng còn tài khoản quảng cáo — chuyển tài khoản trước.");
  await sql`delete from customers where id = ${id}`;
  await audit(adminActor(ctx), "customer.delete", "customer", id, { name: prev.name });
}

/**
 * Assign customer and/or sale owner for ONE ad account. Changing the sale is a
 * per-account transfer: the new sale gets a grant on this account, the previous
 * sale's grant on it is removed.
 */
export async function updateAdAccount(
  ctx: AccessContext,
  input: { id: string; customer_id?: string | null; sale_staff_id?: string | null },
): Promise<void> {
  assertRealAdmin(ctx);
  const sql = await getSql();
  const prev = (
    await sql<{ id: string; customer_id: string | null; sale_staff_id: string | null; display_name: string }>`
      select id, customer_id, sale_staff_id, display_name from ad_accounts where id = ${input.id} limit 1
    `
  )[0];
  if (!prev) throw new Error("Không tìm thấy tài khoản quảng cáo.");
  if (input.customer_id !== undefined && input.customer_id !== prev.customer_id) {
    const next = input.customer_id || null;
    if (next) {
      const c = await sql`select 1 from customers where id = ${next}`;
      if (!c.length) throw new Error("Không tìm thấy khách hàng.");
    }
    await sql`update ad_accounts set customer_id = ${next}, updated_at = now() where id = ${input.id}`;
    await audit(adminActor(ctx), "account.customer_set", "ad_account", input.id, {
      account: prev.display_name,
      from: prev.customer_id,
      to: next,
    });
  }
  if (input.sale_staff_id !== undefined && input.sale_staff_id !== prev.sale_staff_id) {
    const next = input.sale_staff_id || null;
    if (next) {
      const s = await sql<{ role: string }>`select role from staff_users where id = ${next} limit 1`;
      if (!s.length || s[0].role !== "sale") throw new Error("Người nhận phải có vai trò Sale.");
    }
    await sql`update ad_accounts set sale_staff_id = ${next}, updated_at = now() where id = ${input.id}`;
    let revoked = false;
    if (prev.sale_staff_id) {
      const r = await sql`
        delete from account_grants
        where principal_kind = 'staff' and principal_id = ${prev.sale_staff_id} and ad_account_id = ${input.id}
        returning 1
      `;
      revoked = r.length > 0;
    }
    const granted = next ? (await addGrants("staff", next, [input.id], adminActor(ctx))).length > 0 : false;
    await audit(adminActor(ctx), "account.sale_transfer", "ad_account", input.id, {
      account: prev.display_name,
      from: prev.sale_staff_id,
      to: next,
      previous_sale_grant_revoked: revoked,
      new_sale_granted: granted,
    });
  }
}

// ── grant requests ─────────────────────────────────────────────────────────────────

export async function decideRequest(
  ctx: AccessContext,
  input: { id: string; approve: boolean; note?: string | null },
): Promise<void> {
  assertRealAdmin(ctx);
  const sql = await getSql();
  const req = (
    await sql<{ id: string; target_kind: PrincipalKind; target_id: string; ad_account_ids: unknown; status: string; requested_by: string }>`
      select id, target_kind, target_id, ad_account_ids, status, requested_by from grant_requests where id = ${input.id} limit 1
    `
  )[0];
  if (!req) throw new Error("Không tìm thấy yêu cầu.");
  if (req.status !== "pending") throw new Error("Yêu cầu đã được xử lý.");
  const note = input.note?.trim() || null;
  let added: string[] = [];
  if (input.approve) {
    const label = await targetLabel(req.target_kind, req.target_id);
    const ids = await existingAccountIds(uniq(req.ad_account_ids));
    added = await addGrants(req.target_kind, req.target_id, ids, adminActor(ctx));
    await audit(adminActor(ctx), "grant.request_approved", req.target_kind, req.target_id, {
      request_id: req.id,
      requested_by: req.requested_by,
      target: label,
      added,
    });
  } else {
    await audit(adminActor(ctx), "grant.request_rejected", req.target_kind, req.target_id, {
      request_id: req.id,
      requested_by: req.requested_by,
      note,
    });
  }
  await sql`
    update grant_requests
    set status = ${input.approve ? "approved" : "rejected"}, decided_by = ${adminActor(ctx)}, decided_at = now(), decision_note = ${note}
    where id = ${req.id}
  `;
}

export async function requestDirectory(ctx: AccessContext): Promise<RequestDirectory> {
  assertCap(ctx, "requestGrant");
  const sql = await getSql();
  const allowed = ctx.allowed === "all" ? null : [...ctx.allowed];
  const accounts = await sql.query<{ id: string; display_name: string; external_id: string | null }>(
    allowed
      ? `select id, display_name, external_id from ad_accounts where id = any($1::text[]) order by display_name`
      : `select id, display_name, external_id from ad_accounts order by display_name`,
    allowed ? [allowed] : [],
  );
  const accountIds = accounts.map((a) => a.id);
  const clients = await sql.query<{ id: string; username: string; display_name: string | null; customer_id: string | null }>(
    `select u.id, u.username, u.display_name, u.customer_id
     from client_users u
     where u.customer_id is null
        or u.customer_id in (select customer_id from ad_accounts where id = any($1::text[]) and customer_id is not null)
     order by u.username`,
    [accountIds],
  );
  const me = actorLabel(ctx.principal);
  return { clients, accounts, my_requests: await listRequests("where r.requested_by = $1", [me]) };
}

export async function submitGrantRequest(
  ctx: AccessContext,
  input: { clientUserId: string; accountIds: string[]; note?: string | null },
): Promise<{ id: string }> {
  assertCap(ctx, "requestGrant");
  assertWritable(ctx);
  const ids = uniq(input.accountIds);
  if (!ids.length) throw new Error("Chọn ít nhất một tài khoản quảng cáo.");
  for (const id of ids) {
    if (!canSeeAccount(ctx, id)) throw new ForbiddenError("Chỉ xin quyền trên tài khoản bạn được giao.");
  }
  const dir = await requestDirectory(ctx);
  if (!dir.clients.some((c) => c.id === input.clientUserId)) throw new Error("Không tìm thấy người dùng khách hàng.");
  const sql = await getSql();
  const id = newId("req");
  const me = actorLabel(ctx.principal);
  await sql`
    insert into grant_requests (id, requested_by, requester_role, target_kind, target_id, ad_account_ids, note)
    values (${id}, ${me}, ${String(ctx.principal.role)}, 'client', ${input.clientUserId}, ${JSON.stringify(ids)}::jsonb, ${input.note?.trim() || null})
  `;
  await audit(me, "grant.request_submitted", "client", input.clientUserId, { request_id: id, ad_account_ids: ids });
  return { id };
}

export async function cancelGrantRequest(ctx: AccessContext, id: string): Promise<void> {
  assertCap(ctx, "requestGrant");
  assertWritable(ctx);
  const sql = await getSql();
  const me = actorLabel(ctx.principal);
  const rows = await sql`
    update grant_requests set status = 'cancelled', decided_by = ${me}, decided_at = now()
    where id = ${id} and requested_by = ${me} and status = 'pending'
    returning 1
  `;
  if (rows.length) await audit(me, "grant.request_cancelled", "grant_request", id, {});
}

// ── audit view ────────────────────────────────────────────────────────────────────────

export async function auditLog(ctx: AccessContext, limit = 200, beforeId?: number): Promise<AuditRow[]> {
  assertRealAdmin(ctx);
  const sql = await getSql();
  const lim = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await sql.query<AuditRow>(
    beforeId
      ? `select id, ${iso("at")} as at, actor, action, target_kind, target_id, detail from permission_audit_log where id < $1 order by id desc limit ${lim}`
      : `select id, ${iso("at")} as at, actor, action, target_kind, target_id, detail from permission_audit_log order by id desc limit ${lim}`,
    beforeId ? [beforeId] : [],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id), detail: typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail ?? {}) }));
}
