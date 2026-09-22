import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/auth-origin.server-DrR7Sigu.js
var auth_origin_server_exports = /* @__PURE__ */ __exportAll({
	adaptAuthRequest: () => adaptAuthRequest,
	authBaseUrl: () => authBaseUrl
});
/** Map custom-domain auth requests onto BETTER_AUTH_URL so Origin/callback checks pass. */
var CALLBACK_KEYS = [
	"callbackURL",
	"errorCallbackURL",
	"newUserCallbackURL",
	"redirectTo"
];
function headerHost(request) {
	const url = new URL(request.url);
	return {
		proto: (request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "https").split(",")[0].trim(),
		host: (request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host).split(",")[0].trim()
	};
}
function authBaseUrl() {
	return (process.env.BETTER_AUTH_URL || "").trim().replace(/\/$/, "");
}
async function adaptAuthRequest(request) {
	const authBase = authBaseUrl();
	if (!authBase) return request;
	const { proto, host } = headerHost(request);
	if (!host) return request;
	const here = `${proto}://${host}`;
	if (here === authBase) return request;
	const headers = new Headers(request.headers);
	if (headers.get("origin") === here) headers.set("origin", authBase);
	const referer = headers.get("referer");
	if (referer && referer.startsWith(here)) headers.set("referer", authBase + referer.slice(here.length));
	const method = request.method.toUpperCase();
	if (method === "GET" || method === "HEAD") return new Request(request.url, {
		method,
		headers
	});
	const raw = await request.text();
	let body = raw;
	if ((request.headers.get("content-type") || "").includes("application/json") && raw) try {
		const json = JSON.parse(raw);
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
	headers.delete("content-length");
	return new Request(request.url, {
		method,
		headers,
		body
	});
}
//#endregion
export { auth_origin_server_exports as n, adaptAuthRequest as t };
