import { createFileRoute } from "@tanstack/react-router";
import { auth, getAuthEnvProbe } from "@/lib/auth/server";
import { adaptAuthRequest } from "@/lib/adsops/auth-origin.server";

type AuthHandlerArgs = {
  request: Request;
  params?: Record<string, string | undefined>;
};

function isProbePath(path: string, splat: string, rawUrl: string): boolean {
  if (path.endsWith("/ok") || path.endsWith("/config-probe")) return true;
  if (splat === "ok" || splat === "config-probe" || splat.endsWith("/ok")) return true;
  if (rawUrl.includes("/api/auth/ok") || rawUrl.includes("config-probe")) return true;
  return false;
}

async function handleAuth({ request, params }: AuthHandlerArgs) {
  const rawUrl = request.url;
  let path = rawUrl;
  try {
    path = new URL(rawUrl).pathname.replace(/\/+$/, "") || "/";
  } catch {
    /* keep raw */
  }
  const splat = String(params?._splat ?? params?.["$"] ?? "");

  if (isProbePath(path, splat, rawUrl)) {
    const envKeys = Object.keys(process.env)
      .filter((k) => /GOOGLE|BETTER_AUTH|VITE_AUTH|DATABASE|VERCEL/i.test(k))
      .sort();
    return Response.json({
      ...getAuthEnvProbe(),
      ok: true,
      debug: { path, splat, rawUrl, envKeys },
      commitHint: "auth-env-probe-v5",
    });
  }

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
