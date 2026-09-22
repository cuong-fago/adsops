/**
 * Self-hosted Better Auth for THIS app (server-only).
 *
 * Direct Google OAuth via Better Auth `socialProviders.google`.
 *
 * IMPORTANT (Vercel): register Google whenever auth is not explicitly off.
 * Do not gate `socialProviders` on a build-time snapshot of secrets — Sensitive
 * Preview env vars are sometimes missing during `vite build` / cold analysis,
 * which previously baked PROVIDER_NOT_FOUND into the deploy even when the
 * dashboard showed GOOGLE_CLIENT_ID/SECRET on Preview.
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

void ensureDbReady();

const globalAuthRef = globalThis as typeof globalThis & {
  __adsopsAuthPreviewSecret__?: string;
};
function previewAuthSecret(): string {
  globalAuthRef.__adsopsAuthPreviewSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__adsopsAuthPreviewSecret__;
}

/** Runtime env read via dynamic key — avoids Vite static empty replacement. */
const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

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
    vercelEnv: env("VERCEL_ENV") ?? null,
    providers: AUTH_PROVIDERS.map((p) => p.providerId),
    commitHint: "auth-env-probe-v4",
  };
}

const authDisabled = env("VITE_AUTH_ENABLED") === "false";

const googleClientId = env("GOOGLE_CLIENT_ID");
const googleClientSecret = env("GOOGLE_CLIENT_SECRET");

/** True when Google social sign-in has both secrets in this runtime. */
export const authConfigured =
  !authDisabled && Boolean(googleClientId && googleClientSecret);

if (!authDisabled && !authConfigured) {
  console.warn(
    "[adsops-auth] GOOGLE_CLIENT_ID/SECRET missing at cold start. If Vercel UI shows them on Preview, recreate as non-Sensitive Encrypted and Clear-cache Redeploy.",
  );
}

const explicitBaseURL = env("BETTER_AUTH_URL");
const PRODUCTION_ORIGIN = "https://ad.fagogroup.vn";

const LOCAL_DEV_ORIGINS: string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];

const VERCEL_PREVIEW_HOSTS: string[] = ["*.vercel.app"];

const baseURL = explicitBaseURL ?? {
  allowedHosts: [...VERCEL_PREVIEW_HOSTS, "localhost", "127.0.0.1", "[::1]"],
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

const trustedOrigins: string[] = [
  ...(explicitBaseURL ? [explicitBaseURL] : []),
  PRODUCTION_ORIGIN,
  ...VERCEL_PREVIEW_HOSTS,
  ...VERCEL_PREVIEW_HOSTS.flatMap((host) => [`https://${host}`, `http://${host}`]),
  ...LOCAL_DEV_ORIGINS,
];

const databaseUrl = env("DATABASE_URL");

const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

export const SESSION_TOKEN_COOKIE = "__Host-adsops.session_token";

/**
 * Always register the Google provider when auth is on. Prefer live secrets;
 * fall back to empty strings so Better Auth still exposes the provider id
 * (avoids PROVIDER_NOT_FOUND when secrets arrive only at runtime after a
 * Sensitive-env injection quirk). Empty credentials fail later at Google.
 */
const socialProviders = authDisabled
  ? undefined
  : {
      google: {
        clientId: googleClientId ?? env("GOOGLE_CLIENT_ID") ?? "",
        clientSecret: googleClientSecret ?? env("GOOGLE_CLIENT_SECRET") ?? "",
        prompt: "select_account" as const,
      },
    };

export const auth = betterAuth({
  baseURL,
  secret: env("BETTER_AUTH_SECRET") ?? previewAuthSecret(),
  database,
  trustedOrigins,
  ...(socialProviders ? { socialProviders } : {}),

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

  session: { cookieCache: { enabled: true, maxAge: 300 } },

  ...(emailAndPasswordEnabled ? { emailAndPassword: { enabled: true } } : {}),

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

  plugins: [gateIdentitySessions(), bearer(), tanstackStartCookies()],
});

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}

export { AUTH_PROVIDERS, GROK_PROVIDERS } from "./providers";
