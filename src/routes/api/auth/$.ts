import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { adaptAuthRequest } from "@/lib/adsops/auth-origin.server";

async function handleAuth({ request }: { request: Request }) {
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
