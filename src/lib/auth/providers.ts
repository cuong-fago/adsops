/**
 * Social identity providers this app offers for sign-in.
 *
 * Source of truth for BOTH the server (`server.ts` → `socialProviders`) and the
 * client (`client.ts` / sign-in buttons). Kept dependency-free so the client can
 * import it without pulling server-only Better Auth / `pg` into the browser bundle.
 *
 * Direct Google OAuth via Better Auth `socialProviders` (no Grok auth broker).
 */
export type AuthProvider = {
  /** Better Auth social provider id (also the OAuth callback path segment). */
  providerId: string;
  /** Human label for the sign-in button. */
  label: string;
};

export const AUTH_PROVIDERS: readonly AuthProvider[] = [
  { providerId: "google", label: "Google" },
];

/** @deprecated Prefer AUTH_PROVIDERS — kept so older imports keep compiling. */
export type GrokProvider = AuthProvider;
/** @deprecated Prefer AUTH_PROVIDERS. */
export const GROK_PROVIDERS = AUTH_PROVIDERS;
