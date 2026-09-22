/**
 * Nitro route (bypasses TanStack) — proves which auth env keys reach the
 * Vercel serverless runtime. No secrets are returned, only booleans / suffixes.
 */
export default defineEventHandler(() => {
  const read = (key: string) => {
    const v = process.env[key]?.trim();
    return v ? v : undefined;
  };

  const googleClientId = read("GOOGLE_CLIENT_ID") ?? process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret =
    read("GOOGLE_CLIENT_SECRET") ?? process.env.GOOGLE_CLIENT_SECRET;

  const envKeys = Object.keys(process.env)
    .filter((k) => /GOOGLE|BETTER_AUTH|VITE_AUTH|DATABASE|VERCEL|POSTGRES|PG/i.test(k))
    .sort();

  return {
    ok: true,
    via: "nitro-server-routes",
    commitHint: "nitro-env-probe-v1",
    hasGoogleClientId: Boolean(googleClientId?.trim?.() || googleClientId),
    hasGoogleClientSecret: Boolean(
      (typeof googleClientSecret === "string" && googleClientSecret.trim()) ||
        googleClientSecret,
    ),
    googleClientIdSuffix:
      typeof googleClientId === "string" && googleClientId.length > 12
        ? googleClientId.slice(-12)
        : null,
    hasBetterAuthSecret: Boolean(read("BETTER_AUTH_SECRET")),
    betterAuthUrl: read("BETTER_AUTH_URL") ?? null,
    hasDatabaseUrl: Boolean(read("DATABASE_URL")),
    viteAuthEnabled: read("VITE_AUTH_ENABLED") ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    envKeys,
  };
});
