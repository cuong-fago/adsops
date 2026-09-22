import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
//#region node_modules/.nitro/vite/services/ssr/assets/classify.server-1RkFng1e.js
var ADSOPS_ROOT = "/workspace/artifacts/AdsOps-handoff-2026-09-21/AdsOps";
var CLIENT_ID_RE = /^[a-z0-9_]+$/;
var LABELS = /* @__PURE__ */ new Set([
	"keep",
	"add_exact",
	"negative",
	"routing",
	"hold"
]);
var TIERS = /* @__PURE__ */ new Set([
	"account",
	"campaign",
	"ad_group"
]);
function runPython(args, timeoutMs) {
	return new Promise((resolve, reject) => {
		const child = spawn("python3", args, {
			cwd: ADSOPS_ROOT,
			env: {
				...process.env,
				PYTHONPATH: "src"
			},
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(/* @__PURE__ */ new Error("Hết thời gian chờ phân loại."));
		}, timeoutMs);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({
				stdout,
				stderr,
				code: code ?? 1
			});
		});
	});
}
async function saveClassifyEdits(input) {
	const clientId = input.clientId.trim();
	if (!CLIENT_ID_RE.test(clientId)) return {
		ok: false,
		error_vi: "Khách không hợp lệ."
	};
	const edits = (input.edits || []).filter((e) => e && LABELS.has(e.label) && e.query);
	if (!edits.length) return {
		ok: false,
		error_vi: "Không có nhãn hợp lệ để lưu."
	};
	for (const edit of edits) if (edit.negative_tier && !TIERS.has(edit.negative_tier)) return {
		ok: false,
		error_vi: "Tầng phủ định phải là tài khoản / chiến dịch / nhóm."
	};
	const dir = mkdtempSync(join(tmpdir(), "adsops-classify-"));
	const file = join(dir, "edits.json");
	try {
		writeFileSync(file, JSON.stringify(edits), "utf8");
		const ran = await runPython([
			"scripts/classify_search_terms.py",
			"--client",
			clientId,
			"--edits-json",
			file,
			"--export"
		], 9e4);
		if (ran.code !== 0) return {
			ok: false,
			error_vi: (ran.stderr || ran.stdout || "Không lưu được nhãn.").slice(0, 400)
		};
		const snapPath = join(ADSOPS_ROOT, "outputs", "app-snapshot", "classify", `${clientId}.json`);
		let snapshot;
		try {
			snapshot = JSON.parse(readFileSync(snapPath, "utf8"));
		} catch {
			snapshot = void 0;
		}
		const lines = ran.stdout.trim().split("\n");
		let summary;
		try {
			summary = JSON.parse(lines[lines.length - 1] || "{}");
		} catch {
			summary = void 0;
		}
		return {
			ok: true,
			summary,
			snapshot
		};
	} catch (err) {
		return {
			ok: false,
			error_vi: err instanceof Error ? err.message : "Không lưu được nhãn."
		};
	} finally {
		rmSync(dir, {
			recursive: true,
			force: true
		});
	}
}
//#endregion
export { saveClassifyEdits };
