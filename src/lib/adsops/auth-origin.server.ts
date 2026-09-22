/** Map custom-domain auth requests onto BETTER_AUTH_URL so Origin/callback checks pass. */

const CALLBACK_KEYS = ["callbackURL", "errorCallbackURL", "newUserCallbackURL", "redirectTo"] as const;

function headerHost(request: Request): { proto: string; host: string } {
  const url = new URL(request.url);
  const proto = (
    request.headers.get("x-forwarded-proto") ||
    url.protocol.replace(":", "") ||
    "https"
  )
    .split(",")[0]
    .trim();
  const host = (
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    url.host
  )
    .split(",")[0]
    .trim();
  return { proto, host };
}

export function authBaseUrl(): string {
  return (process.env.BETTER_AUTH_URL || "").trim().replace(/\/$/, "");
}

export async function adaptAuthRequest(request: Request): Promise<Request> {
  const authBase = authBaseUrl();
  if (!authBase) return request;
  const { proto, host } = headerHost(request);
  if (!host) return request;
  const here = `${proto}://${host}`;
  if (here === authBase) return request;

  const headers = new Headers(request.headers);
  if (headers.get("origin") === here) headers.set("origin", authBase);
  const referer = headers.get("referer");
  if (referer && referer.startsWith(here)) {
    headers.set("referer", authBase + referer.slice(here.length));
  }

  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return new Request(request.url, { method, headers });
  }

  const raw = await request.text();
  let body = raw;
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json") && raw) {
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      let changed = false;
      for (const key of CALLBACK_KEYS) {
        const val = json[key];
        if (typeof val === "string" && val.startsWith(here)) {
          json[key] = val.slice(here.length) || "/";
          changed = true;
        }
      }
      if (changed) body = JSON.stringify(json);
    } catch {
      body = raw;
    }
  }
  headers.delete("content-length");
  return new Request(request.url, { method, headers, body });
}
