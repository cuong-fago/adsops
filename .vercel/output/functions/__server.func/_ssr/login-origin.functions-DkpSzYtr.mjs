import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/login-origin.functions-DkpSzYtr.js
/** Public AdsOps origin used for Google/X (BETTER_AUTH_URL). Empty in live preview. */
var getAuthPublicOrigin_createServerFn_handler = createServerRpc({
	id: "8fa9776d9d84df5511f1c7a3cea99c5bd55cd00f2b66e84aff1fc46ba9899d49",
	name: "getAuthPublicOrigin",
	filename: "src/lib/adsops/login-origin.functions.ts"
}, (opts) => getAuthPublicOrigin.__executeServer(opts));
var getAuthPublicOrigin = createServerFn({ method: "GET" }).handler(getAuthPublicOrigin_createServerFn_handler, async () => {
	const { authBaseUrl } = await import("./auth-origin.server-DrR7Sigu.mjs").then((n) => n.n);
	return authBaseUrl();
});
//#endregion
export { getAuthPublicOrigin_createServerFn_handler };
