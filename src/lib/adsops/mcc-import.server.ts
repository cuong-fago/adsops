/**
 * Store Google Ads customers discovered under an MCC.
 * Local Neon only. Does not call Google Ads and does not change alias.
 */
import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import { audit } from "./permissions.server.ts";

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
  }
  if (inserted.length) {
    await audit("system:mcc", "ad_accounts.discovered", "ad_account", null, {
      ids: inserted,
      note: "New accounts are visible to admin only until granted. Alias is not set.",
    });
  }
  return { inserted, touched };
}
