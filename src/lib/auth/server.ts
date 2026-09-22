/**
 * Self-hosted Better Auth for THIS app (server-only).
 *
 * Direct Google OAuth via Better Auth `socialProviders.google`.
 *
 * Vercel/Nitro note: keep STATIC `process.env.GOOGLE_*` references so the
 * platform/bundler includes those names in the serverless function env.
 * Dynamic-only access (`process.env[key]`) has been observed to leave Preview
 * runtimes without the secrets even when the dashboard shows them.
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

// Force static env name retention for Vercel function injection / Nitro analysis.
const STATIC_ENV_ANCHORS = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  VITE_AUTH_ENABLED: process.env.VITE_AUTH_ENABLED,
} as const;

const globalAuthRef = globalThis as typeof globalThis & {
  __adsopsAuthPreviewSecret__?: string;
  __adsopsAuthInstance__?: ReturnType<typeof betterAuth>;
};

function previewAuthSecret(): string {
  globalAuthRef.__adsopsAuthPreviewSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__adsopsAuthPreviewSecret__;
}

const env = (key: string): string | undefined => {
  const fromStatic = (STATIC_ENV_ANCHORS as Record<string, string | undefined>)[key];
  const value = (fromStatic ?? process.env[key])?.trim();
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
    vercelEnv: env("VERCEL_ENV") ?? process.env.VERCEL_ENV ?? null,
    providers: AUTH_PROVIDERS.map((p) => p.providerId),
    commitHint: "auth-env-probe-v5",
  };
}

function buildAuth() {
  const authDisabled = env("VITE_AUTH_ENABLED") === "false";
  const googleClientId = env("GOOGLE_CLIENT_ID");
  const googleClientSecret = env("GOOGLE_CLIENT_SECRET");
  const authConfigured =
    !authDisabled && Boolean(googleClientId && googleClientSecret);

  if (!authDisabled && !authConfigured) {
    console.warn(
      "[adsops-auth] GOOGLE_CLIENT_ID/SECRET missing at auth build. Check Vercel Preview env names exactly.",
    );
  }

  const explicitBaseURL = env("BETTER_AUTH_URL");
  const PRODUCTION_ORIGIN = "https://ad.fagogroup.vn";
  const LOCAL_DEV_ORIGINS = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
  ];
  const VERCEL_PREVIEW_HOSTS = ["*.vercel.app"];

  const baseURL = explicitBaseURL ?? {
    allowedHosts: [...VERCEL_PREVIEW_HOSTS, "localhost", "127.0.0.1", "[::1]"],
    protocol: "auto" as const,
    fallback: "http://localhost:8080",
  };

  const trustedOrigins = [
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

  const socialProviders = authDisabled
    ? undefined
    : {
        google: {
          clientId: googleClientId ?? "",
          clientSecret: googleClientSecret ?? "",
          prompt: "select_account" as const,
        },
      };

  return betterAuth({
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
}

export const SESSION_TOKEN_COOKIE = "__Host-adsops.session_token";

/** Lazy so the first request reads live Vercel runtime env, not a build snapshot. */
function getAuth() {
  globalAuthRef.__adsopsAuthInstance__ ??= buildAuth();
  return globalAuthRef.__adsopsAuthInstance__;
}

export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_target, prop, receiver) {
    const instance = getAuth() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export const authConfigured = (() => {
  const authDisabled = env("VITE_AUTH_ENABLED") === "false";
  return !authDisabled && Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));
})();

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}

export { AUTH_PROVIDERS, GROK_PROVIDERS } from "./providers";
