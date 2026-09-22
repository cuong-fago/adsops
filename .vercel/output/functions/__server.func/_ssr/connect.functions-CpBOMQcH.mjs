import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { t as authMiddleware } from "./middleware-BhhEMaGH.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/connect.functions-CpBOMQcH.js
function asIntake(data) {
	if (!data || typeof data !== "object") throw new Error("Thiếu dữ liệu");
	const d = data;
	const clientId = typeof d.clientId === "string" ? d.clientId.trim() : "";
	if (!clientId) throw new Error("Thiếu khách");
	return {
		clientId,
		yamlText: typeof d.yamlText === "string" ? d.yamlText : "",
		developerToken: typeof d.developerToken === "string" ? d.developerToken : "",
		oauthClientId: typeof d.oauthClientId === "string" ? d.oauthClientId : "",
		oauthClientSecret: typeof d.oauthClientSecret === "string" ? d.oauthClientSecret : "",
		refreshToken: typeof d.refreshToken === "string" ? d.refreshToken : "",
		save: d.save === true
	};
}
function asClientId(data) {
	if (!data || typeof data !== "object") throw new Error("Thiếu khách");
	const clientId = typeof data.clientId === "string" ? String(data.clientId).trim() : "";
	if (!clientId) throw new Error("Thiếu khách");
	return { clientId };
}
var saveYamlAndProbe_createServerFn_handler = createServerRpc({
	id: "9187819b28feba101ac4ead5e32a9bf655b6954c5125a2904d1bf03fc3065f4e",
	name: "saveYamlAndProbe",
	filename: "src/lib/adsops/connect.functions.ts"
}, (opts) => saveYamlAndProbe.__executeServer(opts));
var saveYamlAndProbe = createServerFn({ method: "POST" }).validator(asIntake).middleware([authMiddleware]).handler(saveYamlAndProbe_createServerFn_handler, async ({ context, data }) => {
	const { assertOps } = await import("./access.server-DeIfyP1k.mjs");
	await assertOps(context.userId);
	const { installAndProbe } = await import("./connect.server-DHsZZPLo.mjs");
	return installAndProbe({
		clientId: data.clientId,
		yamlText: data.yamlText,
		pieces: {
			developer_token: data.developerToken,
			oauth_client_id: data.oauthClientId,
			oauth_client_secret: data.oauthClientSecret,
			refresh_token: data.refreshToken
		},
		save: data.save
	});
});
var pullClientKpis_createServerFn_handler = createServerRpc({
	id: "06c764460f146e053bd20fe5709f40349e907b45113d24667fcf762fea35a2c0",
	name: "pullClientKpis",
	filename: "src/lib/adsops/connect.functions.ts"
}, (opts) => pullClientKpis.__executeServer(opts));
var pullClientKpis = createServerFn({ method: "POST" }).validator(asClientId).middleware([authMiddleware]).handler(pullClientKpis_createServerFn_handler, async ({ context, data }) => {
	const { assertOps } = await import("./access.server-DeIfyP1k.mjs");
	await assertOps(context.userId);
	const { pullKpis } = await import("./connect.server-DHsZZPLo.mjs");
	return pullKpis(data.clientId);
});
//#endregion
export { pullClientKpis_createServerFn_handler, saveYamlAndProbe_createServerFn_handler };
