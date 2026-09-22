import { createFileRoute } from "@tanstack/react-router";
import { auth, getAuthEnvProbe } from "@/lib/auth/server";
import { adaptAuthRequest } from "@/lib/adsops/auth-origin.server";

async function handleAuth({ request }: { request: Request }) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  // Deploy probe under the existing splat so we do not depend on routeTree.gen.ts.
  if (path === "/api/auth/config-probe") {
    return Response.json({ ...getAuthEnvProbe(), ok: true });
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
