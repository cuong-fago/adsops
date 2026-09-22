import { createServerFn } from "@tanstack/react-start";

/** Public AdsOps origin used for Google/X (BETTER_AUTH_URL). Empty in live preview. */
export const getAuthPublicOrigin = createServerFn({ method: "GET" }).handler(async () => {
  const { authBaseUrl } = await import("./auth-origin.server.ts");
  return authBaseUrl();
});
