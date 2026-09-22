/**
 * Self-hosted Better Auth for THIS app (server-only).
 *
 * Direct Google OAuth via Better Auth `socialProviders.google`. The Grok auth
 * broker (`genericOAuth`, `GROK_AUTH_*`, preview broker client) has been removed.
 *
 * Tri-mode:
 *   - Deployed: inject GOOGLE_CLIENT_ID/SECRET, BETTER_AUTH_URL, BETTER_AUTH_SECRET, DATABASE_URL.
 *   - Local / preview without fixed URL: dynamic baseURL from request host allowlist.
 *   - Off (`VITE_AUTH_ENABLED=false`): no social providers; see `verify.server.ts`.
 *
 * NEVER import this from client code — it pulls in `pg` + server-only Better Auth.
 * The client uses `@/lib/auth/client`; components read the user via
 * `@/lib/auth/use-current-user`; server functions get a verified id via
 * `@/lib/auth/middleware`.
 */
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import { emailAndPasswordEnabled } from "./email-password";
import { GATE_PROVIDER_ID, gateIdentitySessions } from "./gate-session.server";
import { AUTH_PROVIDERS } from "./providers";
import { pgliteDialect } from "./pglite-dialect";

// Kick (and share) PGLite bootstrap as soon as the auth server module loads.
void ensureDbReady();

/**
 * Preview secret must outlive module reloads: PGLite (and its session rows) is
 * stored on `globalThis`, so an HMR re-eval of this file must NOT mint a new
 * signing secret or every existing session becomes invalid mid-dev. Process
 * restart clears both the secret and PGLite together.
 */
const globalAuthRef = globalThis as typeof globalThis & {
  __adsopsAuthPreviewSecret__?: string;
};
function previewAuthSecret(): string {
  globalAuthRef.__adsopsAuthPreviewSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__adsopsAuthPreviewSecret__;
}

/**
 * Read an env var at RUNTIME.
 *
 * Use bracket access (`process.env[key]`) so Vite/Nitro cannot statically
 * replace the name with an empty string at build time (Sensitive Vercel secrets
 * are unavailable during `vite build`, which would otherwise bake auth off).
 */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

/** Snapshot of which auth-related env keys are present (never values). */
export function getAuthEnvProbe() {
  const googleClientId = env("GOOGLE_CLIENT_ID");
  const googleClientSecret = env("GOOGLE_CLIENT_SECRET");
  const authDisabled = env("VITE_AUTH_ENABLED") === "false";
  const authConfigured =
    !authDisabled && Boolean(googleClientId && googleClientSecret);
  return {
    authDisabled,
    authConfigured,
    hasGoogleClientId: Boolean(googleClientId),
    hasGoogleClientSecret: Boolean(googleClientSecret),
    googleClientIdSuffix: googleClientId ? googleClientId.slice(-12) : null,
    hasBetterAuthSecret: Boolean(env("BETTER_AUTH_SECRET")),
    betterAuthUrl: env("BETTER_AUTH_URL") ?? null,
    hasDatabaseUrl: Boolean(env("DATABASE_URL")),
    viteAuthEnabled: env("VITE_AUTH_ENABLED") ?? null,
    providers: AUTH_PROVIDERS.map((p) => p.providerId),
  };
}

// Explicit off-switch. Set `VITE_AUTH_ENABLED=true` when provisioning auth;
// set it to "false" to force auth off everywhere (dev user).
const authDisabled = env("VITE_AUTH_ENABLED") === "false";

const googleClientId = env("GOOGLE_CLIENT_ID");
const googleClientSecret = env("GOOGLE_CLIENT_SECRET");

/** True when Google social sign-in is active (real auth is enforced). */
export const authConfigured =
  !authDisabled && Boolean(googleClientId && googleClientSecret);

if (!authDisabled && !authConfigured) {
  console.warn(
    "[adsops-auth] Google social provider OFF: missing GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET in this runtime (Preview needs both on the Preview environment).",
  );
}

// This app's own Better Auth origin. When deployed, set BETTER_AUTH_URL to the
// public URL. Without it, Better Auth derives the origin per-request from the
// host, validated against the allowlist (local loopback + Vercel previews).
const explicitBaseURL = env("BETTER_AUTH_URL");
const PRODUCTION_ORIGIN = "https://ad.fagogroup.vn";

// Local `npm run dev` (port 8080 contract). Browsers may send Origin as any of
// these for the same server — trusting only `localhost` rejects `127.0.0.1` and
// breaks email/password with "Invalid origin".
const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];

const VERCEL_PREVIEW_HOSTS: string[] = ["*.vercel.app"];

const baseURL = explicitBaseURL ?? {
  allowedHosts: [...VERCEL_PREVIEW_HOSTS, "localhost", "127.0.0.1", "[::1]"],
  // `auto` → trust both http:// and https:// expansions of allowedHosts
  // (preview is https; local dev is http).
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

// Origins Better Auth accepts on credentialed POSTs (sign-up/sign-in, etc.).
// Missing entries here surface as FORBIDDEN "Invalid origin".
const trustedOrigins: string[] = [
  ...(explicitBaseURL ? [explicitBaseURL] : []),
  PRODUCTION_ORIGIN,
  ...VERCEL_PREVIEW_HOSTS,
  ...VERCEL_PREVIEW_HOSTS.flatMap((host) => [`https://${host}`, `http://${host}`]),
  ...LOCAL_DEV_ORIGINS,
];

const databaseUrl = env("DATABASE_URL");

// Real Postgres when `DATABASE_URL` is set (deployed apps), else the app's
// embedded PGLite (preview) via a Kysely dialect — so Better Auth persists to the
// SAME DB as app data, including email/password users.
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

/** Session token cookie name — also read by any popup completion page. */
export const SESSION_TOKEN_COOKIE = "__Host-adsops.session_token";

export const auth = betterAuth({
  baseURL,
  // Deployed apps inject BETTER_AUTH_SECRET. Preview: process-stable secret on
  // globalThis so HMR doesn't invalidate PGLite-backed sessions (see above).
  secret: env("BETTER_AUTH_SECRET") ?? previewAuthSecret(),
  database,

  // CSRF / origin check for credentialed auth POSTs (email sign-up/sign-in, …).
  trustedOrigins,

  ...(authConfigured
    ? {
        socialProviders: {
          google: {
            // Re-read via bracket access at config build (cold start) so Sensitive
            // Vercel secrets available only at runtime are not lost to build-time
            // empty replacement of `process.env.GOOGLE_*`.
            clientId: env("GOOGLE_CLIENT_ID") as string,
            clientSecret: env("GOOGLE_CLIENT_SECRET") as string,
            // Always show the account chooser so users can switch Google accounts.
            prompt: "select_account" as const,
          },
        },
      }
    : {}),

  // Encrypt OAuth tokens at rest; treat Google (+ gate) as trusted identities.
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: [
        ...AUTH_PROVIDERS.map((p) => p.providerId),
        GATE_PROVIDER_ID,
      ],
      requireLocalEmailVerified: false,
    },
  },

  // Cache the session in the short-lived signed `session_data` cookie so reads
  // (incl. the client's `/get-session`) skip the DB — shrinks the "loading"
  // window and reduces auth flicker.
  session: { cookieCache: { enabled: true, maxAge: 300 } },

  // Local email/password — toggled only via `./email-password` (not a plugin).
  ...(emailAndPasswordEnabled ? { emailAndPassword: { enabled: true } } : {}),

  // `__Host-` prefixed cookies: Secure + Path=/ + no Domain (fine on
  // https://ad.fagogroup.vn). Drop Better Auth's auto `__Secure-` prefix.
  advanced: {
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true, sameSite: "lax", path: "/" },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: "__Host-adsops.session_data" },
      account_data: { name: "__Host-adsops.account_data" },
      dont_remember: { name: "__Host-adsops.dont_remember" },
    },
  },

  plugins: [
    // Keep gate identity for app access control when gate headers are present;
    // it does not interfere with direct Google social login.
    gateIdentitySessions(),

    // Accept `Authorization: Bearer <session-token>` as an alternative to the
    // cookie (live-preview iframe / partitioned cookies). Cookie path unaffected.
    bearer(),

    // Bridges Better Auth's Set-Cookie into TanStack Start responses. MUST be
    // last so it runs after every other plugin's hooks.
    tanstackStartCookies(),
  ],
});

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}

// Re-exported for convenience; the array lives in the dependency-free
// `providers.ts` so the client can import it too.
export { AUTH_PROVIDERS, GROK_PROVIDERS } from "./providers";
