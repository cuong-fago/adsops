import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { adaptAuthRequest } from "@/lib/adsops/auth-origin.server";

/** Better Auth handler (Google OAuth, sessions). No debug / env probes. */
async function handleAuth(ctx: { request: Request }) {
  return auth.handler(await adaptAuthRequest(ctx.request));
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: handleAuth,
      POST: handleAuth,
    },
  },
});
