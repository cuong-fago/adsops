import { createFileRoute } from "@tanstack/react-router";

/**
 * Authenticated file download (FINAL workbooks etc.). Replaces the old public
 * `/adsops/final/files/*.xlsx` CDN links. Requires the `download` capability
 * (internal + sale; never clients) and a grant on the requested ad account.
 */
const CONTENT_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};

async function handle({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const clientId = (url.searchParams.get("client") || "").trim();
  const relPath = (url.searchParams.get("path") || "").trim();
  const noStore = { "cache-control": "private, no-store" };
  if (!clientId || !relPath) return new Response("Bad request", { status: 400, headers: noStore });
  const p = await import("@/lib/adsops/permissions.server");
  const acc = await import("@/lib/adsops/access.server");
  let ctx: Awaited<ReturnType<typeof p.resolveAccessFromHeaders>>;
  try {
    await acc.ensureRosterSeeded();
    ctx = await p.resolveAccessFromHeaders(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401, headers: noStore });
  }
  if (!ctx.caps.download || ctx.principal.role === "pending" || !p.canSeeAccount(ctx, clientId)) {
    return new Response("Forbidden", { status: 403, headers: noStore });
  }
  const absPath = acc.resolveClientFile(clientId, relPath);
  if (!absPath) return new Response("Not found", { status: 404, headers: noStore });
  const { readFile } = await import("node:fs/promises");
  const body = await readFile(absPath);
  const fileName = (absPath.split(/[\\/]/).pop() || "file").replace(/[^A-Za-z0-9._-]/g, "_");
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      ...noStore,
      "content-type": CONTENT_TYPES[ext] || "application/octet-stream",
      "content-disposition": `attachment; filename="${fileName}"`,
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
