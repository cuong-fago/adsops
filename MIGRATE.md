# Migrate: direct Google OAuth (no Grok broker)

## Required Vercel env (production + preview)

| Name | Notes |
|------|--------|
| `BETTER_AUTH_URL` | Public origin, e.g. `https://ad.fagogroup.vn` |
| `BETTER_AUTH_SECRET` | Random 32+ bytes hex (`openssl rand -hex 32`) |
| `VITE_AUTH_ENABLED` | `true` |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth client id |
| `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth client secret |
| `DATABASE_URL` | Neon Postgres connection string |

## Google Cloud Console

Authorized redirect URI (Better Auth social callback):

`https://ad.fagogroup.vn/api/auth/callback/google`

Also add each Vercel preview host you use:

`https://<deployment>.vercel.app/api/auth/callback/google`

## Auth code changes

- Dropped Grok broker (`genericOAuth`, `GROK_AUTH_*`, preview broker client).
- Better Auth `socialProviders.google` with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- Client `signIn` → `authClient.signIn.social({ provider: "google", ... })` (redirect).
- Providers: Google only (`providerId: "google"`).
- Kept gate-identity sessions plugin (no-op unless gate headers present).
