import { createFileRoute } from "@tanstack/react-router";
import { getAuthEnvProbe } from "@/lib/auth/server";

/**
 * Temporary deploy probe: which auth env keys are present (never secret values).
 * Safe to hit from a browser while debugging PROVIDER_NOT_FOUND.
 */
export const Route = createFileRoute("/api/auth-config")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ...getAuthEnvProbe(),
          ok: true,
        }),
    },
  },
});
