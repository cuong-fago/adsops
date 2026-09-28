import { createFileRoute } from "@tanstack/react-router";

/**
 * Authenticated file download (FINAL workbooks etc.). Replaces the old public
 * `/adsops/final/files/*.xlsx` CDN links. Requires the `download` capability
 * (internal + sale; never clients) and a grant on the requested ad account.
 */
async function handle({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const clientId = (url.searchParams.get("client") || "").trim();
  const relPath = (url.searchParams.get("path") || "").trim();
  const noStore = { "cache-control": "private, no-store" };
  if (!clientId || !relPath) return new Response("Bad request", { status: 400, headers: noStore });
  const p = await import("@/lib/adsops/permissions.server");
  let ctx;
  try {
    const { ensureRosterSeeded } = await import("@/lib/adsops/access.server");
    await ensureRosterSeeded();
    ctx = await p.resolveAccessFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401, headers: noStore });
  }
  if (!ctx.caps.download || !p.canSeeAccount(ctx, clientId) || ctx.principal.role === "pending") {
    return new Response("Forbidden", { status: 403, headers: noStore });
  }
  const { resolveClientFile } = await import("@/lib/adsops/access.server");
  const file = await resolveClientFile(clientId, relPath);
  if (!file) return new Response("Not found", { status: 404, headers: noStore });
  const { readFile } = await import("node:fs/promises");
  const body = await readFile(file.absPath);
  const name = file.fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      ...noStore,
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${name}"`,
      "x-content-type-options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/adsops-file")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
