import { createFileRoute } from "@tanstack/react-router";

/**
 * Deployment smoke check: reports only whether the server-side AdsOps data
 * bundle is readable. Returns no client data, names or numbers.
 */
async function handle(): Promise<Response> {
  let data = false;
  try {
    const { resolveDataDir } = await import("@/lib/adsops/access.server");
    const dir = resolveDataDir();
    if (dir) {
      const { existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      data = existsSync(join(dir, "registry.json"));
    }
  } catch {
    data = false;
  }
  return Response.json({ ok: true, data }, { headers: { "cache-control": "no-store" } });
}

export const Route = createFileRoute("/api/adsops-health")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
