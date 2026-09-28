import { createMiddleware } from "@tanstack/react-start";

/**
 * Server-function middleware that resolves the caller as an AdsOps principal:
 * internal staff (Better Auth Google session) OR a customer user (username +
 * password session cookie). Puts `context.access` (role, capabilities, allowed
 * ad accounts, view-as state) on every call. Throws 401 when signed out.
 *
 * Grants / roles / client sessions are re-read from Neon on every request, so
 * revocation is immediate.
 */
export const principalMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("@/lib/auth/client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
    assertSameSiteRequest();
    const { ensureRosterSeeded } = await import("./access.server");
    await ensureRosterSeeded();
    const { resolveAccess } = await import("./permissions.server");
    const access = await resolveAccess(context.bearerToken);
    return next({ context: { access } });
  });
