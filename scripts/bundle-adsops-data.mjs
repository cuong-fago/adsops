#!/usr/bin/env node
/**
 * Copy the AdsOps snapshot data (server-data/adsops) INTO the Vercel serverless
 * function bundle(s) as `adsops-data/`, so access.server reads it from the
 * function filesystem. It is never placed under `.vercel/output/static`, so the
 * CDN cannot serve it: every byte goes through authenticated, grant-filtered
 * server functions.
 */
import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const src = join(root, "server-data", "adsops");
const functionsDir = join(root, ".vercel", "output", "functions");
const staticDir = join(root, ".vercel", "output", "static");

if (!existsSync(src)) {
  console.log("[bundle-adsops-data] no server-data/adsops — skipped");
  process.exit(0);
}

if (existsSync(join(staticDir, "adsops"))) {
  console.error("[bundle-adsops-data] .vercel/output/static/adsops exists — data would be public. Aborting.");
  process.exit(1);
}

function findFuncDirs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.endsWith(".func")) out.push(full);
    else out.push(...findFuncDirs(full));
  }
  return out;
}

const funcs = findFuncDirs(functionsDir);
if (!funcs.length) {
  console.log("[bundle-adsops-data] no .vercel/output/functions/*.func (local build?) — skipped");
  process.exit(0);
}
for (const f of funcs) {
  // Symlinked function dirs share the target; copying twice is harmless.
  cpSync(src, join(f, "adsops-data"), { recursive: true, dereference: true });
  console.log(`[bundle-adsops-data] copied -> ${f.replace(root + "/", "")}/adsops-data`);
}
