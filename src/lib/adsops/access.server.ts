import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSql } from "@/lib/db";
import type {
  AccessClient,
  AccessRole,
  AccessSnap,
  Json,
  MemberRow,
  MccRosterSnap,
  WorkspaceDirectory,
  WorkspacePack,
  WorkspaceScene,
} from "./access.types.ts";

const PUBLIC_DIR = "/workspace/public/adsops";
const CLIENT_ID_RE = /^[a-z0-9_]+$/;
const PINNED_CLIENTS = ["tkqc_6810292395", "fago_group"];
const SCENE_IDS = new Set(["stale", "coverage", "fake_cpa", "source_conflict", "conv_zero"]);

type MembershipRow = {
  id: string;
  user_id: string | null;
  email: string;
  role: AccessRole;
  client_id: string | null;
};

function readJsonFile(path: string): Json | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Json;
  } catch {
    return null;
  }
}

function asRec(value: Json | null): { [key: string]: Json } | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return null;
}

function readFolder(folder: string, clientId: string): Json | null {
  return readJsonFile(join(PUBLIC_DIR, folder, `${clientId}.json`));
}

function rosterClients(): AccessClient[] {
  const raw = asRec(readJsonFile(join(PUBLIC_DIR, "mcc.json")));
  const accounts = Array.isArray(raw?.accounts) ? raw.accounts : [];
  return accounts
    .filter((a): a is { [key: string]: Json } => Boolean(a && typeof a === "object" && !Array.isArray(a) && a.client_id && !a.is_manager))
    .map((a) => ({
      client_id: String(a.client_id),
      display_name: String(a.display_name || a.client_id),
      customer_id_dashed: String(a.customer_id_dashed || ""),
      status: a.status ? String(a.status) : undefined,
      adapter: "live",
    }));
}

function mergeOpsClients(): AccessClient[] {
  const registry = asRec(readJsonFile(join(PUBLIC_DIR, "registry.json")));
  const connect = asRec(readJsonFile(join(PUBLIC_DIR, "connect-registry.json")));
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
  if (!by.size) {
    for (const row of rosterClients()) by.set(row.client_id, row);
  }
  return [...by.values()].sort((a, b) => {
    const ia = PINNED_CLIENTS.indexOf(a.client_id);
    const ib = PINNED_CLIENTS.indexOf(b.client_id);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return (a.display_name || "").localeCompare(b.display_name || "", "vi");
  });
}

function readMcc(): MccRosterSnap | null {
  const raw = asRec(readJsonFile(join(PUBLIC_DIR, "mcc.json")));
  if (!raw) return null;
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  return {
    mcc_id_dashed: String(raw.mcc_id_dashed || "532-145-0531"),
    mcc_display_name: String(raw.mcc_display_name || "Fago Agency"),
    last_probe_accessible_count: Number(raw.last_probe_accessible_count || accounts.length),
    roster_complete: Boolean(raw.roster_complete),
    note_vi: String(raw.note_vi || ""),
    accounts: accounts
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
      .filter((a) => a.client_id),
  };
}

async function userEmail(userId: string): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql<{ email: string }>`select email from "user" where id = ${userId} limit 1`;
  const email = rows[0]?.email?.trim().toLowerCase();
  return email || null;
}

async function bindInvites(userId: string, email: string | null) {
  if (!email) return;
  const sql = await getSql();
  await sql`
    update memberships
    set user_id = ${userId}
    where lower(email) = ${email}
      and (user_id is null or user_id = '')
  `;
}

async function userIdByEmail(email: string): Promise<string | null> {
  const sql = await getSql();
  const rows = await sql<{ id: string }>`select id from "user" where lower(email) = ${email} limit 1`;
  return rows[0]?.id || null;
}

export async function loadAccess(userId: string): Promise<AccessSnap> {
  const sql = await getSql();
  const email = await userEmail(userId);
  await bindInvites(userId, email);

  let rows = email
    ? await sql<MembershipRow>`
        select id, user_id, email, role, client_id
        from memberships
        where user_id = ${userId} or lower(email) = ${email}
      `
    : await sql<MembershipRow>`
        select id, user_id, email, role, client_id
        from memberships
        where user_id = ${userId}
      `;

  if (!rows.length) {
    const any = await sql<{ n: number }>`select count(*)::int as n from memberships`;
    if (!Number(any[0]?.n || 0)) {
      const id = crypto.randomUUID();
      await sql`
        insert into memberships (id, user_id, email, role, client_id, created_by)
        values (${id}, ${userId}, ${email || "ops@local"}, ${"ops"}, ${null}, ${userId})
      `;
      rows = [
        {
          id,
          user_id: userId,
          email: email || "ops@local",
          role: "ops",
          client_id: null,
        },
      ];
    }
  }

  const isOps = rows.some((r) => r.role === "ops");
  const roster = rosterClients();
  if (isOps) {
    return {
      role: "ops",
      email,
      all_clients: true,
      client_ids: roster.map((c) => c.client_id),
      clients: roster,
    };
  }

  const granted = new Set(
    rows
      .map((r) => r.client_id)
      .filter((id): id is string => Boolean(id && CLIENT_ID_RE.test(id))),
  );
  const role: AccessRole = rows.some((r) => r.role === "sale") ? "sale" : "client";
  const clients = roster.filter((c) => granted.has(c.client_id));
  if (!clients.length) {
    return { role: "pending", email, all_clients: false, client_ids: [], clients: [] };
  }
  return {
    role,
    email,
    all_clients: false,
    client_ids: clients.map((c) => c.client_id),
    clients,
  };
}

export async function assertOps(userId: string): Promise<AccessSnap> {
  const access = await loadAccess(userId);
  if (access.role !== "ops") {
    throw new Error("Chỉ vận hành AdsOps mới làm được việc này.");
  }
  return access;
}

export async function assertClientAccess(userId: string, clientId: string): Promise<AccessSnap> {
  const id = clientId.trim();
  if (!CLIENT_ID_RE.test(id)) throw new Error("Khách không hợp lệ.");
  const access = await loadAccess(userId);
  if (access.role === "pending") throw new Error("Chưa được cấp quyền.");
  if (access.role === "ops" || access.client_ids.includes(id)) return access;
  throw new Error("Không được xem khách này.");
}

export async function listMembers(userId: string): Promise<MemberRow[]> {
  await assertOps(userId);
  const sql = await getSql();
  const roster = new Map(rosterClients().map((c) => [c.client_id, c.display_name]));
  const rows = await sql<MembershipRow>`
    select id, user_id, email, role, client_id
    from memberships
    order by email, role, client_id
  `;
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    client_id: r.client_id,
    display_name: r.client_id ? roster.get(r.client_id) || r.client_id : "Tất cả tài khoản",
    user_id: r.user_id,
  }));
}

export async function grantAccess(
  actorId: string,
  input: { email: string; role: AccessRole; clientIds: string[] },
): Promise<MemberRow[]> {
  await assertOps(actorId);
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Email không hợp lệ.");
  if (input.role !== "ops" && input.role !== "sale" && input.role !== "client") {
    throw new Error("Vai trò không hợp lệ.");
  }
  const sql = await getSql();
  const boundId = await userIdByEmail(email);
  if (input.role === "ops") {
    const exists = await sql<{ id: string }>`
      select id from memberships where lower(email) = ${email} and role = ${"ops"} limit 1
    `;
    if (!exists.length) {
      await sql`
        insert into memberships (id, user_id, email, role, client_id, created_by)
        values (${crypto.randomUUID()}, ${boundId}, ${email}, ${"ops"}, ${null}, ${actorId})
      `;
    } else if (boundId) {
      await sql`
        update memberships set user_id = ${boundId}
        where id = ${exists[0].id} and (user_id is null or user_id = '')
      `;
    }
    return listMembers(actorId);
  }
  const wanted = [...new Set(input.clientIds.filter((id) => CLIENT_ID_RE.test(id)))];
  if (!wanted.length) throw new Error("Chọn ít nhất một tài khoản quảng cáo.");
  const allowed = new Set(rosterClients().map((c) => c.client_id));
  for (const clientId of wanted) {
    if (!allowed.has(clientId)) throw new Error("Tài khoản không thuộc MCC.");
    const exists = await sql<{ id: string }>`
      select id from memberships
      where lower(email) = ${email} and role = ${input.role} and client_id = ${clientId}
      limit 1
    `;
    if (exists.length) {
      if (boundId) {
        await sql`
          update memberships set user_id = ${boundId}
          where id = ${exists[0].id} and (user_id is null or user_id = '')
        `;
      }
      continue;
    }
    await sql`
      insert into memberships (id, user_id, email, role, client_id, created_by)
      values (${crypto.randomUUID()}, ${boundId}, ${email}, ${input.role}, ${clientId}, ${actorId})
    `;
  }
  return listMembers(actorId);
}

export async function revokeAccess(actorId: string, membershipId: string): Promise<MemberRow[]> {
  await assertOps(actorId);
  const id = membershipId.trim();
  if (!id) throw new Error("Thiếu quyền.");
  const sql = await getSql();
  const target = await sql<MembershipRow>`
    select id, user_id, email, role, client_id from memberships where id = ${id} limit 1
  `;
  if (!target.length) return listMembers(actorId);
  if (target[0].role === "ops") {
    const remaining = await sql<{ n: number }>`
      select count(*)::int as n from memberships where role = ${"ops"}
    `;
    if (Number(remaining[0]?.n || 0) <= 1) {
      throw new Error("Không gỡ vận hành cuối cùng.");
    }
  }
  await sql`delete from memberships where id = ${id}`;
  return listMembers(actorId);
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
  };
}

export async function loadWorkspaceDirectory(userId: string): Promise<WorkspaceDirectory> {
  const access = await loadAccess(userId);
  if (access.role === "pending") {
    return { access, clients: [], mcc: null };
  }
  if (access.role === "ops") {
    return { access, clients: mergeOpsClients(), mcc: readMcc() };
  }
  return { access, clients: access.clients, mcc: null };
}

export async function loadWorkspacePack(userId: string, clientId: string): Promise<WorkspacePack> {
  const access = await assertClientAccess(userId, clientId);
  const viewer = access.role === "sale" || access.role === "client";
  const report = asRec(readFolder("report", clientId));
  const compare = asRec(readFolder("compare", clientId));
  if (viewer) {
    const pack = emptyPack();
    pack.report = report ? { ...report, ...(compare ? { compare } : {}) } : null;
    return pack;
  }
  return {
    report: report ? { ...report, ...(compare ? { compare } : {}) } : null,
    alerts: readFolder("alerts", clientId),
    guard: readFolder("guard", clientId),
    hub: readFolder("hub", clientId),
    proposals: readFolder("proposals", clientId),
    classify: readFolder("classify", clientId),
    final: readFolder("final", clientId),
    connect: readFolder("connect", clientId),
    sop: readJsonFile(join(PUBLIC_DIR, "sop.json")),
    analytics: readFolder("analytics", clientId),
    pace: readFolder("budget-email", clientId),
  };
}

export async function loadWorkspaceScene(
  userId: string,
  clientId: string,
  scenario: string,
): Promise<WorkspaceScene> {
  await assertOps(userId);
  await assertClientAccess(userId, clientId);
  if (!SCENE_IDS.has(scenario)) {
    return { final: null, guard: null, proposals: null, alerts: null };
  }
  const alertId = scenario === "fake_cpa" || scenario === "source_conflict" ? "" : scenario;
  const sceneFile = (folder: string, suffix: string) =>
    readJsonFile(join(PUBLIC_DIR, folder, "scenarios", `${clientId}__${suffix}.json`));
  return {
    final: sceneFile("final", scenario),
    guard: sceneFile("guard", scenario),
    proposals: sceneFile("proposals", scenario),
    alerts: alertId ? sceneFile("alerts", alertId) : null,
  };
}
