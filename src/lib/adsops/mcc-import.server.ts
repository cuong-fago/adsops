/**
 * Store Google Ads customers discovered under an MCC.
 * Local Neon only. Does not call Google Ads and does not change alias.
 */
import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import { audit } from "./permissions.server.ts";
import type { WorkspaceDirectory } from "./access.types.ts";

export type DiscoveredMccAccount = {
  customer_id: string;
  display_name: string;
  status?: string;
  manager_customer_id: string;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

let managerColumnReady: Promise<void> | null = null;

async function ensureManagerColumn(): Promise<void> {
  if (!managerColumnReady) {
    managerColumnReady = (async () => {
      const sql = await getSql();
      await sql`alter table ad_accounts add column if not exists manager_customer_id text`;
    })().catch((err) => {
      managerColumnReady = null;
      throw err;
    });
  }
  return managerColumnReady;
}

export async function importMccAccounts(
  rows: DiscoveredMccAccount[],
): Promise<{ inserted: string[]; touched: string[] }> {
  await ensureManagerColumn();
  const sql = await getSql();
  const existing = await sql<{ id: string; external_id: string | null }>`
    select id, external_id from ad_accounts
  `;
  const byExternal = new Map<string, string>();
  const ids = new Set<string>();
  for (const r of existing) {
    ids.add(r.id);
    const ext = String(r.external_id || "").replace(/\D/g, "");
    if (ext) byExternal.set(ext, r.id);
  }
  const inserted: string[] = [];
  const touched: string[] = [];
  for (const r of rows) {
    const ext = String(r.customer_id || "").replace(/\D/g, "");
    const mcc = String(r.manager_customer_id || "").replace(/\D/g, "");
    if (ext.length !== 10 || mcc.length !== 10 || ext === mcc) continue;
    const dashed = `${ext.slice(0, 3)}-${ext.slice(3, 6)}-${ext.slice(6)}`;
    const name = String(r.display_name || "").trim() || dashed;
    let id = byExternal.get(ext);
    if (!id) {
      id = `tkqc_${ext}`;
      if (!/^[a-z0-9_]+$/.test(id) || ids.has(id)) continue;
      const customerName = name.replace(/\s*-\s*\d{3}\s*$/, "").trim() || dashed;
      const customerId = `cus_${sha256Hex(customerName.toLowerCase()).slice(0, 16)}`;
      await sql`insert into customers (id, name) values (${customerId}, ${customerName}) on conflict (id) do nothing`;
      await sql`
        insert into ad_accounts (id, platform, external_id, display_name, customer_id, status, manager_customer_id)
        values (${id}, ${"google"}, ${ext}, ${name}, ${customerId}, ${r.status || null}, ${mcc})
        on conflict (id) do nothing
      `;
      ids.add(id);
      byExternal.set(ext, id);
      inserted.push(id);
      touched.push(id);
    } else {
      await sql`
        update ad_accounts
        set manager_customer_id = ${mcc},
            display_name = case when ${name} <> '' then ${name} else display_name end,
            updated_at = now()
        where id = ${id}
          and (
            manager_customer_id is distinct from ${mcc}
            or (${name} <> '' and display_name is distinct from ${name})
          )
      `;
      touched.push(id);
    }
    // Google status on every pull (migration 0015; ignored if the column is not there yet).
    const gs = String(r.status || "").trim().toUpperCase();
    if (gs) {
      await sql`update ad_accounts set google_status = ${gs}, google_status_at = now() where id = ${id}`.catch(() => null);
    }
  }
  if (inserted.length) {
    await audit("system:mcc", "ad_accounts.discovered", "ad_account", null, {
      ids: inserted,
      note: "New accounts are visible to admin only until granted. Alias is not set.",
    });
  }
  return { inserted, touched };
}


function dashedTen(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : "";
}

/** Add pulled MCC accounts to the admin picker and label every known row with its MCC. */
export async function withPulledMccClients(
  dir: WorkspaceDirectory,
  allowed: "all" | Set<string>,
): Promise<WorkspaceDirectory> {
  const sql = await getSql();
  let rows: { id: string; display_name: string; external_id: string | null; status: string | null; manager_customer_id: string | null; alias: string | null }[] = [];
  try {
    rows = await sql<{ id: string; display_name: string; external_id: string | null; status: string | null; manager_customer_id: string | null; alias: string | null }>`
      select id, display_name, external_id, status, manager_customer_id, alias
      from ad_accounts
      where manager_customer_id is not null and btrim(manager_customer_id) <> ''
    `;
  } catch {
    return dir;
  }
  const clients = dir.clients.map((c) => ({ ...c }));
  const by = new Map(clients.map((c) => [c.client_id, c]));
  for (const r of rows) {
    if (!/^[a-z0-9_]+$/.test(r.id)) continue;
    const mcc = dashedTen(String(r.manager_customer_id || ""));
    const ext = dashedTen(String(r.external_id || ""));
    if (!mcc) continue;
    const labeledId = ext ? `${ext} · MCC ${mcc}` : `MCC ${mcc}`;
    const prev = by.get(r.id);
    if (prev) {
      prev.customer_id_dashed = labeledId;
      prev.mcc_id_dashed = mcc;
      if (!prev.display_name && r.display_name) prev.display_name = r.display_name;
      continue;
    }
    if (allowed !== "all" && !allowed.has(r.id)) continue;
    const row = {
      client_id: r.id,
      display_name: r.display_name || r.id,
      customer_id_dashed: labeledId,
      mcc_id_dashed: mcc,
      status: r.status || undefined,
      adapter: "live",
      alias: (r.alias || "").trim() || undefined,
    };
    by.set(r.id, row);
    clients.push(row);
  }
  // Facebook (Meta) ad accounts synced by meta-ads.server.ts (platform 'facebook', id fb_<id>).
  // No Facebook account stored yet (before the first cron): pull the list once, now.
  if (allowed === "all") {
    const { ensureMetaAccounts } = await import("./meta-ads.server.ts");
    await ensureMetaAccounts().catch(() => null);
  }
  try {
    const fb = await sql<{ id: string; display_name: string; external_id: string | null; status: string | null; alias: string | null }>`
      select id, display_name, external_id, status, alias from ad_accounts where platform = 'facebook'
    `;
    for (const r of fb) {
      if (!/^fb_\d+$/.test(r.id)) continue;
      if (allowed !== "all" && !allowed.has(r.id)) continue;
      const prev = by.get(r.id);
      const row = {
        ...(prev || {}),
        client_id: r.id,
        display_name: r.display_name || prev?.display_name || r.id,
        customer_id_dashed: `act_${r.external_id || r.id.slice(3)} · Facebook`,
        status: r.status || undefined,
        adapter: "live",
        alias: (r.alias || "").trim() || prev?.alias || undefined,
        platform: "facebook" as const,
      };
      by.set(r.id, row);
    }
  } catch {
    /* alias column / table missing: skip Facebook */
  }
  // ChatGPT Ads (OpenAI) accounts synced by openai-ads.server.ts (platform 'openai', id oa_<hex>). Same grant model.
  if (allowed === "all") {
    const { seedFromEnv } = await import("./openai-ads.server.ts");
    await seedFromEnv().catch(() => null);
  }
  try {
    const oa = await sql<{ id: string; display_name: string; external_id: string | null; status: string | null; alias: string | null }>`
      select id, display_name, external_id, status, alias from ad_accounts where platform = 'openai'
    `;
    for (const r of oa) {
      if (!/^oa_[a-z0-9]+$/.test(r.id)) continue;
      if (allowed !== "all" && !allowed.has(r.id)) continue;
      const prev = by.get(r.id);
      by.set(r.id, {
        ...(prev || {}),
        client_id: r.id,
        display_name: r.display_name || prev?.display_name || r.id,
        customer_id_dashed: `${r.external_id || r.id} · ChatGPT`,
        status: r.status || undefined,
        adapter: "live",
        alias: (r.alias || "").trim() || prev?.alias || undefined,
        platform: "openai" as const,
      });
    }
  } catch {
    /* migration 0028 not applied yet: skip ChatGPT Ads */
  }
  return { ...dir, clients: [...by.values()] };
}
