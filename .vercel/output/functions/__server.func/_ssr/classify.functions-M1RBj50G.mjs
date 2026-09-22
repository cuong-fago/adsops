import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { t as authMiddleware } from "./middleware-BhhEMaGH.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/classify.functions-M1RBj50G.js
function asPayload(data) {
	if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
	const d = data;
	const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
	if (!clientId) throw new Error("Thiếu khách");
	return {
		clientId,
		edits: Array.isArray(d.edits) ? d.edits : []
	};
}
var saveClassifyEdits_createServerFn_handler = createServerRpc({
	id: "f586239c6f20597a768549f5f030db83efe0abf606d3b27518dc8d4af4d47394",
	name: "saveClassifyEdits",
	filename: "src/lib/adsops/classify.functions.ts"
}, (opts) => saveClassifyEdits.__executeServer(opts));
var saveClassifyEdits = createServerFn({ method: "POST" }).validator(asPayload).middleware([authMiddleware]).handler(saveClassifyEdits_createServerFn_handler, async ({ context, data }) => {
	const { assertOps } = await import("./access.server-DeIfyP1k.mjs");
	await assertOps(context.userId);
	const { saveClassifyEdits: run } = await import("./classify.server-1RkFng1e.mjs");
	return run(data);
});
//#endregion
export { saveClassifyEdits_createServerFn_handler };
