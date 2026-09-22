import { createFileRoute } from "@tanstack/react-router";
import { auth, getAuthEnvProbe } from "@/lib/auth/server";
import { adaptAuthRequest } from "@/lib/adsops/auth-origin.server";

/** Force Google provider registration using live process.env on each request. */
async function handleAuth(ctx: {
  request: Request;
  params?: Record<string, string | undefined>;
}) {
  const request = ctx.request;
  const rawUrl = String(request?.url ?? "");

  // Temporary: any GET whose URL mentions ok|debug|probe returns env probe.
  if (request.method.toUpperCase() === "GET" && /ok|debug|probe/i.test(rawUrl)) {
    return Response.json({
      ...getAuthEnvProbe(),
      ok: true,
      via: "tanstack-auth-splat",
      rawUrl,
      paramKeys: Object.keys(ctx.params ?? {}),
      commitHint: "auth-env-probe-v6",
    });
  }

  return auth.handler(await adaptAuthRequest(request));
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handleAuth,
      POST: handleAuth,
    },
  },
});
