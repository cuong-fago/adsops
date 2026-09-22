/**
 * Production: JSON under /adsops is not a public report. Sale/client load
 * numbers only through authenticated server functions (granted accounts).
 */
export default function adsopsJsonGuard(
  event: { url: URL; req: { method: string } },
  next: () => unknown | Promise<unknown>,
): unknown | Promise<unknown> {
  const method = (event.req.method ?? "GET").toUpperCase();
  if (method !== "GET") return next();
  const path = event.url.pathname;
  if (path.startsWith("/adsops/") && path.endsWith(".json")) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return next();
}
