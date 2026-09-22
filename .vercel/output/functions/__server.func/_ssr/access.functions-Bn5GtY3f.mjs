import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { t as authMiddleware } from "./middleware-BhhEMaGH.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/access.functions-Bn5GtY3f.js
function asClientId(data) {
	const clientId = data && typeof data === "object" && typeof data.clientId === "string" ? String(data.clientId).trim() : "";
	if (!clientId) throw new Error("Thiếu khách");
	return { clientId };
}
var getMyAccess_createServerFn_handler = createServerRpc({
	id: "9a728b47921fcc6bb8848e4fe90985f5fd999668ed5937a983d31608f35d31c8",
	name: "getMyAccess",
	filename: "src/lib/adsops/access.functions.ts"
}, (opts) => getMyAccess.__executeServer(opts));
var getMyAccess = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(getMyAccess_createServerFn_handler, async ({ context }) => {
	const { loadAccess } = await import("./access.server-DeIfyP1k.mjs");
	return loadAccess(context.userId);
});
var getWorkspaceDirectory_createServerFn_handler = createServerRpc({
	id: "c8a76893968b61d693fe7e15fb43cf2711f0415babedd37b662af64e2ae33924",
	name: "getWorkspaceDirectory",
	filename: "src/lib/adsops/access.functions.ts"
}, (opts) => getWorkspaceDirectory.__executeServer(opts));
var getWorkspaceDirectory = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(getWorkspaceDirectory_createServerFn_handler, async ({ context }) => {
	const { loadWorkspaceDirectory } = await import("./access.server-DeIfyP1k.mjs");
	return loadWorkspaceDirectory(context.userId);
});
var getWorkspacePack_createServerFn_handler = createServerRpc({
	id: "37c08a47b418e0e0534e36a959b58eca11f821e4bf8b1d48b5d1652726748f1f",
	name: "getWorkspacePack",
	filename: "src/lib/adsops/access.functions.ts"
}, (opts) => getWorkspacePack.__executeServer(opts));
var getWorkspacePack = createServerFn({ method: "POST" }).validator(asClientId).middleware([authMiddleware]).handler(getWorkspacePack_createServerFn_handler, async ({ context, data }) => {
	const { loadWorkspacePack } = await import("./access.server-DeIfyP1k.mjs");
	return loadWorkspacePack(context.userId, data.clientId);
});
var getWorkspaceScene_createServerFn_handler = createServerRpc({
	id: "2d48a262387df2adc436cfdd9d62461574818c8b805eb32469c849c510d98007",
	name: "getWorkspaceScene",
	filename: "src/lib/adsops/access.functions.ts"
}, (opts) => getWorkspaceScene.__executeServer(opts));
var getWorkspaceScene = createServerFn({ method: "POST" }).validator((data) => {
	if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
	const d = data;
	const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
	const scenario = typeof d.scenario === "string" ? d.scenario.trim() : "";
	if (!clientId) throw new Error("Thiếu khách");
	return {
		clientId,
		scenario
	};
}).middleware([authMiddleware]).handler(getWorkspaceScene_createServerFn_handler, async ({ context, data }) => {
	const { loadWorkspaceScene } = await import("./access.server-DeIfyP1k.mjs");
	return loadWorkspaceScene(context.userId, data.clientId, data.scenario);
});
var listAccessMembers_createServerFn_handler = createServerRpc({
	id: "db22aa728e8b47e79af549d301d9dd59a55dfe86e9f65003aa339a3a2b0ba383",
	name: "listAccessMembers",
	filename: "src/lib/adsops/access.functions.ts"
}, (opts) => listAccessMembers.__executeServer(opts));
var listAccessMembers = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listAccessMembers_createServerFn_handler, async ({ context }) => {
	const { listMembers } = await import("./access.server-DeIfyP1k.mjs");
	return listMembers(context.userId);
});
var grantAccessMember_createServerFn_handler = createServerRpc({
	id: "1b76e200cee5f3016ad7fc596501b77b241052f99c8a22f317c52a22b9e56d79",
	name: "grantAccessMember",
	filename: "src/lib/adsops/access.functions.ts"
}, (opts) => grantAccessMember.__executeServer(opts));
var grantAccessMember = createServerFn({ method: "POST" }).validator((data) => {
	if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
	const d = data;
	const email = typeof d.email === "string" ? d.email.trim() : "";
	const role = d.role === "ops" || d.role === "sale" || d.role === "client" ? d.role : "";
	const clientIds = Array.isArray(d.clientIds) ? d.clientIds.filter((id) => typeof id === "string") : [];
	if (!email || !role) throw new Error("Thiếu email hoặc vai trò.");
	return {
		email,
		role,
		clientIds
	};
}).middleware([authMiddleware]).handler(grantAccessMember_createServerFn_handler, async ({ context, data }) => {
	const { grantAccess } = await import("./access.server-DeIfyP1k.mjs");
	return grantAccess(context.userId, data);
});
var revokeAccessMember_createServerFn_handler = createServerRpc({
	id: "735e3a754296bbfa124244595a7f29dad9ac733aec66f7365b47d7a02e665bb5",
	name: "revokeAccessMember",
	filename: "src/lib/adsops/access.functions.ts"
}, (opts) => revokeAccessMember.__executeServer(opts));
var revokeAccessMember = createServerFn({ method: "POST" }).validator((data) => {
	const id = data && typeof data === "object" && typeof data.id === "string" ? String(data.id).trim() : "";
	if (!id) throw new Error("Thiếu quyền.");
	return { id };
}).middleware([authMiddleware]).handler(revokeAccessMember_createServerFn_handler, async ({ context, data }) => {
	const { revokeAccess } = await import("./access.server-DeIfyP1k.mjs");
	return revokeAccess(context.userId, data.id);
});
//#endregion
export { getMyAccess_createServerFn_handler, getWorkspaceDirectory_createServerFn_handler, getWorkspacePack_createServerFn_handler, getWorkspaceScene_createServerFn_handler, grantAccessMember_createServerFn_handler, listAccessMembers_createServerFn_handler, revokeAccessMember_createServerFn_handler };
