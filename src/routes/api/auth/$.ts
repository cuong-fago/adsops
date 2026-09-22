import { createFileRoute } from "@tanstack/react-router";
import { auth, getAuthEnvProbe } from "@/lib/auth/server";
import { adaptAuthRequest } from "@/lib/adsops/auth-origin.server";

async function handleAuth({ request }: { request: Request }) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Short-circuit probes BEFORE Better Auth so we can see runtime env even when
  // social providers failed to register (PROVIDER_NOT_FOUND).
  if (path.endsWith("/config-probe") || path.endsWith("/ok")) {
    return Response.json({
      ...getAuthEnvProbe(),
      ok: true,
      path,
      commitHint: "auth-env-probe-v3",
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
