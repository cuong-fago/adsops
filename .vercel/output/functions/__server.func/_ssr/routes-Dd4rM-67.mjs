import { o as __toESM } from "../_runtime.mjs";
import { _ as Navigate, y as require_jsx_runtime, z as require_react } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as createServerFn } from "./ssr.mjs";
import { t as authMiddleware } from "./middleware-BhhEMaGH.mjs";
import { i as signOut } from "./client-CVqXY6bk.mjs";
import { a as hasGateSessionMarker } from "./server-DRHzIFb5.mjs";
import { n as useCurrentUser, r as useCurrentUserState, t as createSsrRpc } from "./use-current-user-DWR5fiv3.mjs";
import { a as Info, c as ChevronRight, i as Mail, l as Check, n as TriangleAlert, o as Download, r as Search, s as Copy, t as Upload } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-Dd4rM-67.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function money(value, currency = "VND") {
	if (value == null || Number.isNaN(Number(value))) return "—";
	return `${Math.round(Number(value)).toLocaleString("vi-VN")} ${currency}`;
}
function moneyPlain(value) {
	if (value == null || Number.isNaN(Number(value))) return "—";
	return Math.round(Number(value)).toLocaleString("vi-VN");
}
function num(value, digits = 0) {
	if (value == null || Number.isNaN(Number(value))) return "—";
	return Number(value).toLocaleString("vi-VN", {
		maximumFractionDigits: digits,
		minimumFractionDigits: digits
	});
}
function pct(value) {
	if (value == null || Number.isNaN(Number(value))) return "—";
	return `${(Number(value) * 100).toLocaleString("vi-VN", {
		maximumFractionDigits: 1,
		minimumFractionDigits: 0
	})}%`;
}
function hoursLabel(value) {
	if (value == null) return "—";
	if (value <= 0) return "đã hết";
	return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} giờ`;
}
function isoDate(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(iso, days) {
	const d = /* @__PURE__ */ new Date(`${iso}T00:00:00`);
	d.setDate(d.getDate() + days);
	return isoDate(d);
}
function formatRange(start, end) {
	if (start === end) return start;
	return `${start} → ${end}`;
}
function formatRangeVi(start, end) {
	const a = start.split("-");
	const b = end.split("-");
	if (a.length !== 3 || b.length !== 3) return formatRange(start, end);
	const [ys, ms, ds] = a;
	const [ye, me, de] = b;
	if (start === end) return `${ds}/${ms}/${ys}`;
	if (ys === ye && ms === me) return `${ds}–${de}/${me}/${ye}`;
	if (ys === ye) return `${ds}/${ms}–${de}/${me}/${ye}`;
	return `${ds}/${ms}/${ys} → ${de}/${me}/${ye}`;
}
function statusVi(raw) {
	const code = String(raw || "").toUpperCase();
	if (code === "ENABLED" || code === "ACTIVE") return "Đang chạy";
	if (code === "PAUSED") return "Tạm dừng";
	if (code === "REMOVED") return "Đã gỡ";
	if (code === "ENDED") return "Kết thúc";
	return raw || "—";
}
var SUM_KEYS = [
	"impressions",
	"clicks",
	"invalid_clicks",
	"cost",
	"conversions",
	"conv_call",
	"conv_zalo",
	"conv_facebook_chat",
	"conv_form",
	"conv_other"
];
function derivedMetrics(raw) {
	const impressions = raw.impressions || 0;
	const clicks = raw.clicks || 0;
	const invalid = raw.invalid_clicks || 0;
	const cost = raw.cost || 0;
	const conversions = raw.conversions || 0;
	return {
		...raw,
		invalid_click_rate: clicks ? invalid / clicks : 0,
		cpc: clicks ? cost / clicks : 0,
		cost_per_conversion: conversions ? cost / conversions : 0,
		ctr: impressions ? clicks / impressions : 0,
		cr: clicks ? conversions / clicks : 0
	};
}
function windowCoverage(dates, start, end) {
	const have = new Set(dates);
	let missing = 0;
	let present = 0;
	let cur = start;
	while (cur <= end) {
		if (have.has(cur)) present += 1;
		else missing += 1;
		cur = addDays(cur, 1);
	}
	return {
		missing,
		present,
		complete: missing === 0 && present > 0
	};
}
function warehouseDates(snap) {
	return snap.daily.account.map((r) => r.date);
}
function inRange(row, start, end) {
	return row.date >= start && row.date <= end;
}
function sumChunk(rows) {
	const acc = {};
	for (const key of SUM_KEYS) acc[key] = 0;
	for (const row of rows) for (const key of SUM_KEYS) acc[key] += Number(row[key] || 0);
	return derivedMetrics(acc);
}
function hasNumbers(m) {
	return SUM_KEYS.some((k) => (m[k] || 0) !== 0);
}
var MATCH = {
	EXACT: "Chính xác",
	PHRASE: "Cụm từ",
	BROAD: "Rộng"
};
function layerRows(snap, opts) {
	const cov = windowCoverage(warehouseDates(snap), opts.start, opts.end);
	if (cov.present === 0) return {
		complete: false,
		missing_label: "Thiếu dữ liệu",
		rows: [],
		pmax_note: null
	};
	if (snap.campaigns.find((c) => c.id === opts.campaignId)?.pmax && (opts.layer === "ad_group" || opts.layer === "keyword" || opts.layer === "search_term")) return {
		complete: cov.complete,
		missing_label: cov.complete ? void 0 : "Thiếu dữ liệu",
		rows: [],
		pmax_note: snap.pmax_note
	};
	return {
		...computeLayer(snap, opts),
		complete: cov.complete,
		missing_label: cov.complete ? void 0 : "Thiếu dữ liệu"
	};
}
function computeLayer(snap, opts) {
	if (opts.layer === "account") {
		const part = snap.daily.account.filter((r) => inRange(r, opts.start, opts.end));
		return {
			complete: true,
			pmax_note: null,
			rows: [{
				id: snap.client_id,
				name: snap.display_name,
				pmax: false,
				metrics: sumChunk(part)
			}]
		};
	}
	if (opts.layer === "campaign") {
		const part = snap.daily.campaign.filter((r) => inRange(r, opts.start, opts.end));
		const by = /* @__PURE__ */ new Map();
		for (const row of part) {
			const id = String(row.campaign_id || "");
			const list = by.get(id) || [];
			list.push(row);
			by.set(id, list);
		}
		const meta = Object.fromEntries(snap.campaigns.map((c) => [c.id, c]));
		let rows = [];
		for (const [id, chunk] of by) {
			const m = meta[id];
			const metrics = sumChunk(chunk);
			if (!hasNumbers(metrics)) continue;
			rows.push({
				id,
				name: m?.name || String(chunk[0]?.campaign_name || id),
				status: m?.status || String(chunk[0]?.status || ""),
				type: m?.type || "",
				pmax: Boolean(m?.pmax),
				metrics
			});
		}
		if (opts.onlyWithConv) rows = rows.filter((r) => (r.metrics.conversions || 0) > 0);
		rows.sort((a, b) => (b.metrics.cost || 0) - (a.metrics.cost || 0));
		return {
			complete: true,
			rows,
			pmax_note: null
		};
	}
	if (opts.layer === "ad_group") {
		let part = snap.daily.ad_group.filter((r) => inRange(r, opts.start, opts.end));
		if (opts.campaignId) part = part.filter((r) => String(r.campaign_id) === opts.campaignId);
		const by = /* @__PURE__ */ new Map();
		for (const row of part) {
			const id = String(row.ad_group_id || "");
			const list = by.get(id) || [];
			list.push(row);
			by.set(id, list);
		}
		let rows = [];
		for (const [id, chunk] of by) {
			const metrics = sumChunk(chunk);
			if (!hasNumbers(metrics)) continue;
			rows.push({
				id,
				name: String(chunk[0]?.ad_group_name || id),
				status: String(chunk[0]?.status || ""),
				campaign_id: String(chunk[0]?.campaign_id || ""),
				pmax: false,
				metrics
			});
		}
		if (opts.onlyWithConv) rows = rows.filter((r) => (r.metrics.conversions || 0) > 0);
		rows.sort((a, b) => (b.metrics.cost || 0) - (a.metrics.cost || 0));
		return {
			complete: true,
			rows,
			pmax_note: null
		};
	}
	if (opts.layer === "keyword") {
		let part = snap.daily.keyword.filter((r) => inRange(r, opts.start, opts.end));
		if (opts.campaignId) part = part.filter((r) => String(r.campaign_id) === opts.campaignId);
		if (opts.adGroupId) part = part.filter((r) => String(r.ad_group_id) === opts.adGroupId);
		const by = /* @__PURE__ */ new Map();
		for (const row of part) {
			const id = String(row.keyword_id || "");
			const list = by.get(id) || [];
			list.push(row);
			by.set(id, list);
		}
		let rows = [];
		for (const [id, chunk] of by) {
			const metrics = sumChunk(chunk);
			if (!hasNumbers(metrics)) continue;
			const code = String(chunk[0]?.match_type || "");
			rows.push({
				id,
				name: String(chunk[0]?.keyword_text || id),
				match_type: code,
				match_type_label: MATCH[code] || code,
				status: String(chunk[0]?.status || ""),
				ad_group_id: String(chunk[0]?.ad_group_id || ""),
				campaign_id: String(chunk[0]?.campaign_id || ""),
				pmax: false,
				metrics
			});
		}
		if (opts.onlyWithConv) rows = rows.filter((r) => (r.metrics.conversions || 0) > 0);
		rows.sort((a, b) => (b.metrics.cost || 0) - (a.metrics.cost || 0));
		return {
			complete: true,
			rows,
			pmax_note: null
		};
	}
	if (opts.layer === "search_term") {
		let part = snap.daily.search_term.filter((r) => inRange(r, opts.start, opts.end));
		if (opts.campaignId) part = part.filter((r) => String(r.campaign_id) === opts.campaignId);
		if (opts.adGroupId) part = part.filter((r) => String(r.ad_group_id) === opts.adGroupId);
		const by = /* @__PURE__ */ new Map();
		for (const row of part) {
			const key = `${row.query}|${row.campaign_id}|${row.ad_group_id}`;
			const list = by.get(key) || [];
			list.push(row);
			by.set(key, list);
		}
		let rows = [];
		for (const chunk of by.values()) {
			const metrics = sumChunk(chunk);
			if (!hasNumbers(metrics)) continue;
			const rec = chunk[0];
			const code = String(rec?.match_type || "");
			const q = String(rec?.query || "");
			rows.push({
				id: `${rec?.campaign_id}:${rec?.ad_group_id}:${q}`,
				name: q,
				match_type: code,
				match_type_label: MATCH[code] || code,
				campaign_id: String(rec?.campaign_id || ""),
				campaign_name: String(rec?.campaign_name || ""),
				ad_group_id: String(rec?.ad_group_id || ""),
				pmax: false,
				metrics
			});
		}
		if (opts.onlyWithConv) rows = rows.filter((r) => (r.metrics.conversions || 0) > 0);
		rows.sort((a, b) => (b.metrics.cost || 0) - (a.metrics.cost || 0));
		return {
			complete: true,
			rows,
			pmax_note: null
		};
	}
	return {
		complete: true,
		rows: [],
		pmax_note: null
	};
}
function previousWeeks(before, n) {
	const d = /* @__PURE__ */ new Date(`${before}T00:00:00`);
	const weekday = d.getDay();
	const mondayOffset = weekday === 0 ? 6 : weekday - 1;
	const monday = new Date(d);
	monday.setDate(d.getDate() - mondayOffset);
	const weekEnd = new Date(monday);
	weekEnd.setDate(monday.getDate() - 1);
	const out = [];
	let end = weekEnd;
	for (let i = 0; i < n; i += 1) {
		const start = new Date(end);
		start.setDate(end.getDate() - 6);
		out.push({
			start: isoDate(start),
			end: isoDate(end)
		});
		const next = new Date(start);
		next.setDate(start.getDate() - 1);
		end = next;
	}
	return out.reverse();
}
function previousMonths(of, n) {
	const d = /* @__PURE__ */ new Date(`${of}T00:00:00`);
	const out = [];
	let y = d.getFullYear();
	let m = d.getMonth();
	for (let i = 0; i < n; i += 1) {
		m -= 1;
		if (m < 0) {
			m = 11;
			y -= 1;
		}
		const start = new Date(y, m, 1);
		const end = new Date(y, m + 1, 0);
		out.push({
			start: isoDate(start),
			end: isoDate(end),
			label: `T${m + 1}/${y}`
		});
	}
	return out.reverse();
}
function defaultRange(snap) {
	const end = snap.warehouse_end || snap.data_through;
	const firstSpend = (snap.daily.account || []).find((row) => (row.cost || 0) > 0)?.date;
	if (firstSpend) return {
		start: `${firstSpend.slice(0, 7)}-01`,
		end
	};
	if (snap.warehouse_start) return {
		start: snap.warehouse_start,
		end
	};
	return {
		start: addDays(end, -29),
		end
	};
}
function previousEqualRange(start, end) {
	const days = Math.round(((/* @__PURE__ */ new Date(`${end}T00:00:00`)).getTime() - (/* @__PURE__ */ new Date(`${start}T00:00:00`)).getTime()) / 864e5) + 1;
	const prevEnd = addDays(start, -1);
	return {
		start: addDays(prevEnd, -(days - 1)),
		end: prevEnd
	};
}
function monthsOverlapping(start, end) {
	const out = [];
	let y = Number(start.slice(0, 4));
	let m = Number(start.slice(5, 7)) - 1;
	const endY = Number(end.slice(0, 4));
	const endM = Number(end.slice(5, 7)) - 1;
	if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(endY) || !Number.isFinite(endM)) return out;
	while (y < endY || y === endY && m <= endM) {
		const monthStart = isoDate(new Date(y, m, 1));
		const monthEnd = isoDate(new Date(y, m + 1, 0));
		const clipStart = start > monthStart ? start : monthStart;
		const clipEnd = end < monthEnd ? end : monthEnd;
		if (clipStart <= clipEnd) out.push({
			start: clipStart,
			end: clipEnd,
			calendar_start: monthStart,
			calendar_end: monthEnd,
			label: `T${m + 1}/${y}`
		});
		m += 1;
		if (m > 11) {
			m = 0;
			y += 1;
		}
	}
	return out;
}
function cn(...parts) {
	return parts.filter(Boolean).join(" ");
}
function BudgetBanner({ pace, currency = "VND" }) {
	const [mailOpen, setMailOpen] = (0, import_react.useState)(false);
	if (!pace) return null;
	if (pace.status === "missing") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
		className: "rounded-xl bg-paper px-4 py-3 shadow-sheet md:px-5",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "flex items-center gap-2 text-sm text-ink",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Info, { className: "size-4 shrink-0 text-muted" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "font-medium",
				children: "01 · Ngân sách 1 ngày"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "text-muted",
				children: [
					" ",
					"— ",
					pace.missing_label || "Thiếu dữ liệu",
					". Không lấy chi ngày trước. Tách Guard."
				]
			})] })]
		})
	});
	if (pace.status === "ok") {
		const row = pace.ok[0];
		return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
			className: "rounded-xl bg-paper px-4 py-3 shadow-sheet md:px-5",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "text-sm text-ok",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-medium",
					children: "01 · Ngân sách 1 ngày"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					" ",
					"— không cảnh báo",
					row?.hours_remaining != null ? ` (còn khoảng ${hoursLabel(row.hours_remaining)})` : "",
					". Tách Guard — không gộp stale / conv = 0 / coverage."
				] })]
			})
		});
	}
	const ticket = pace.tickets[0];
	if (!ticket) return null;
	const names = ticket.campaigns.map((c) => c.name).join(", ");
	const email = pace.email;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 shadow-sheet md:px-5",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-center gap-x-3 gap-y-1",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "flex items-center gap-2 text-sm font-semibold tracking-tight text-danger",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TriangleAlert, { className: "size-4 shrink-0" }), "01 · Ngân sách 1 ngày sắp hết"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm text-ink",
						children: [
							ticket.label,
							" · ",
							names
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "rounded-full bg-paper px-3 py-1 text-xs font-medium text-muted md:ml-auto",
						children: "Tách Guard · không chặn đề xuất"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
				className: "mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "NS ngày",
						value: money(ticket.daily_budget, currency)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Chi hôm nay",
						value: money(ticket.cost_today, currency)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Còn lại",
						value: money(ticket.remaining, currency)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Còn khoảng",
						value: hoursLabel(ticket.hours_remaining),
						warn: true
					})
				]
			}),
			email && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => setMailOpen((v) => !v),
					className: "inline-flex h-10 items-center gap-2 rounded-full bg-paper px-3 text-sm font-medium",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mail, { className: "size-4 text-accent" }),
						"Email đã soạn — ",
						email.status === "queued" ? "chờ gửi" : email.status,
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-xs font-normal text-muted",
							children: (email.to || []).join(", ") || "không có người nhận"
						})
					]
				}), mailOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-2 rounded-md bg-paper px-3 py-3 text-sm",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-medium",
							children: email.subject
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
							className: "mt-2 whitespace-pre-wrap font-sans text-muted",
							children: email.body
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-2 text-xs text-subtle",
							children: email.note
						})
					]
				})]
			})
		]
	});
}
function Stat({ label, value, warn }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-baseline gap-1.5",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
			className: "text-xs text-muted",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
			className: cn("font-medium tabular-nums", warn && "text-danger"),
			children: value
		})]
	});
}
var LAYERS = [
	{
		id: "campaign",
		label: "Chiến dịch"
	},
	{
		id: "ad_group",
		label: "Nhóm"
	},
	{
		id: "keyword",
		label: "Từ khoá"
	},
	{
		id: "search_term",
		label: "Search terms"
	}
];
function convNum(value) {
	return num(value, Math.abs(value - Math.round(value)) < 1e-6 ? 0 : 2);
}
function dong(value) {
	return `${moneyPlain(value)}đ`;
}
function Field({ label, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "flex min-w-28 flex-col gap-1 text-xs font-medium text-muted",
		children: [label, children]
	});
}
var controlClass = "h-11 w-full rounded-md border border-line bg-bg px-3 text-sm text-ink";
function invalidLabel(metrics) {
	const n = metrics.invalid_clicks || 0;
	const pct1 = `${((metrics.invalid_click_rate || 0) * 100).toLocaleString("vi-VN", {
		maximumFractionDigits: 1,
		minimumFractionDigits: 1
	})}%`;
	return `${num(n, 0)} · ${pct1}`;
}
function formatRangeShort(start, end) {
	const a = start.split("-");
	const b = end.split("-");
	if (a.length !== 3 || b.length !== 3) return `${start} → ${end}`;
	return `${a[2]}/${a[1]}–${b[2]}/${b[1]}`;
}
function AnalyticsView({ snap }) {
	const range0 = defaultRange(snap);
	const warehouseEnd = snap.warehouse_end || snap.data_through;
	const [draftStart, setDraftStart] = (0, import_react.useState)(range0.start);
	const [draftEnd, setDraftEnd] = (0, import_react.useState)(range0.end);
	const [start, setStart] = (0, import_react.useState)(range0.start);
	const [end, setEnd] = (0, import_react.useState)(range0.end);
	const [layer, setLayer] = (0, import_react.useState)("campaign");
	const [periodLayer, setPeriodLayer] = (0, import_react.useState)("campaign");
	const [campaignId, setCampaignId] = (0, import_react.useState)(null);
	const [adGroupId, setAdGroupId] = (0, import_react.useState)(null);
	const [onlyConv, setOnlyConv] = (0, import_react.useState)(false);
	const [weekN, setWeekN] = (0, import_react.useState)(0);
	const [monthN, setMonthN] = (0, import_react.useState)(0);
	const [prevEqual, setPrevEqual] = (0, import_react.useState)(true);
	const groups = snap.conversion_groups.groups;
	function applyRange(nextStart, nextEnd) {
		setDraftStart(nextStart);
		setDraftEnd(nextEnd);
		setStart(nextStart);
		setEnd(nextEnd);
		setWeekN(0);
		setMonthN(0);
	}
	function presetDays(n) {
		applyRange(addDays(warehouseEnd, -(n - 1)), warehouseEnd);
		setWeekN(0);
		setMonthN(0);
	}
	const daySpan = Math.round(((/* @__PURE__ */ new Date(`${end}T00:00:00`)).getTime() - (/* @__PURE__ */ new Date(`${start}T00:00:00`)).getTime()) / 864e5) + 1;
	const presetDay = daySpan === 7 || daySpan === 14 || daySpan === 30 ? daySpan : 0;
	const account = (0, import_react.useMemo)(() => layerRows(snap, {
		layer: "account",
		start,
		end
	}), [
		snap,
		start,
		end
	]);
	const current = (0, import_react.useMemo)(() => layerRows(snap, {
		layer,
		start,
		end,
		campaignId,
		adGroupId,
		onlyWithConv: onlyConv
	}), [
		snap,
		layer,
		start,
		end,
		campaignId,
		adGroupId,
		onlyConv
	]);
	const prevRange = prevEqual ? previousEqualRange(start, end) : null;
	const prevAccount = (0, import_react.useMemo)(() => prevRange ? layerRows(snap, {
		layer: "account",
		start: prevRange.start,
		end: prevRange.end
	}) : null, [
		snap,
		prevRange?.start,
		prevRange?.end
	]);
	const weeks = weekN ? previousWeeks(end, weekN) : [];
	const prevMonths = monthN ? previousMonths(end, monthN) : [];
	const inMonths = monthsOverlapping(start, end);
	const dates = warehouseDates(snap);
	const sideBySide = weeks.length > 0 ? weeks.map((w, i) => ({
		id: `w${i}`,
		label: formatRangeShort(w.start, w.end),
		sub: "T2–CN",
		start: w.start,
		end: w.end,
		complete: windowCoverage(dates, w.start, w.end).complete
	})) : monthN > 0 ? prevMonths.map((m, i) => ({
		id: `pm${i}`,
		label: m.label,
		sub: formatRangeShort(m.start, m.end),
		start: m.start,
		end: m.end,
		complete: windowCoverage(dates, m.start, m.end).complete
	})) : inMonths.length >= 2 ? inMonths.map((m, i) => ({
		id: `im${i}`,
		label: m.label,
		sub: formatRangeShort(m.start, m.end),
		start: m.start,
		end: m.end,
		complete: windowCoverage(dates, m.calendar_start, m.calendar_end).complete
	})) : [];
	const sideBlocks = sideBySide.map((col) => {
		return {
			...layerRows(snap, {
				layer: periodLayer,
				start: col.start,
				end: col.end
			}),
			complete: col.complete
		};
	});
	const sideAccountBlocks = periodLayer === "account" ? sideBlocks : sideBySide.map((col) => {
		return {
			...layerRows(snap, {
				layer: "account",
				start: col.start,
				end: col.end
			}),
			complete: col.complete
		};
	});
	const metrics = account.rows[0]?.metrics || {};
	const prevMetrics = prevAccount?.rows[0]?.metrics;
	const campaignName = snap.campaigns.find((c) => c.id === campaignId)?.name;
	const adGroupName = snap.ad_groups?.find((g) => g.id === adGroupId)?.name;
	const canDrill = layer === "campaign" || layer === "ad_group";
	function drill(row) {
		if (layer === "campaign") {
			setCampaignId(row.id);
			setAdGroupId(null);
			setLayer(row.pmax ? "search_term" : "ad_group");
		} else if (layer === "ad_group") {
			setAdGroupId(row.id);
			setLayer("keyword");
		}
	}
	function goLayer(next) {
		setLayer(next);
		if (next === "campaign") {
			setCampaignId(null);
			setAdGroupId(null);
		}
	}
	const missing = !account.complete || sideBlocks.some((block) => !block.complete) || Boolean(prevAccount && !prevAccount.complete);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex min-w-0 flex-col gap-4",
		children: [
			snap.budget_pace && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BudgetBanner, {
				pace: snap.budget_pace,
				currency: snap.currency
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-4 shadow-sheet md:p-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs font-medium tracking-wide text-subtle",
						children: "Phân tích · máy tính trước · không apply"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "mt-1 font-display text-xl font-medium tracking-tight text-pretty",
						children: "Lọc ngày → tài khoản / chiến dịch / nhóm / từ khoá → loại conv → ST/KW"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 max-w-3xl text-pretty text-sm text-muted",
						children: "Cột Gọi / Zalo / Facebook chat / Form map từ action của khách đang xem — không hard-code tên khách. Secondary (page view) không lên màn. CPA Google ≠ Qualified Lead. Bìa 5 KPI Daily/Weekly giữ nguyên ở Báo cáo."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-4 flex flex-wrap gap-1.5",
						children: [
							[
								7,
								14,
								30
							].map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => presetDays(n),
								className: cn("h-11 rounded-full px-3.5 text-sm font-medium transition-colors duration-150", presetDay === n && weekN === 0 && monthN === 0 ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line"),
								children: [n, " ngày"]
							}, n)),
							snap.week_choices.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => {
									setWeekN(n);
									setMonthN(0);
								},
								className: cn("h-11 rounded-full px-3.5 text-sm font-medium transition-colors duration-150", weekN === n ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line"),
								children: [n, " tuần (T2–CN)"]
							}, `w${n}`)),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: cn("inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium", monthN > 0 ? "bg-accent text-accent-fg" : "bg-inset"),
								children: ["Tháng", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
									value: monthN,
									onChange: (e) => {
										setMonthN(Number(e.target.value));
										setWeekN(0);
									},
									className: "h-8 bg-transparent text-sm",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
										value: 0,
										children: "—"
									}), (snap.month_choices.length ? snap.month_choices : [
										1,
										2,
										3,
										4,
										5,
										6,
										7,
										8,
										9
									]).map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", {
										value: n,
										children: [n, " tháng trước"]
									}, n))]
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Từ",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "date",
									value: draftStart,
									onChange: (e) => setDraftStart(e.target.value),
									className: controlClass
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Đến",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "date",
									value: draftEnd,
									onChange: (e) => setDraftEnd(e.target.value),
									className: controlClass
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex h-11 items-center gap-2 text-sm",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: prevEqual,
									onChange: (e) => setPrevEqual(e.target.checked),
									className: "size-4 accent-accent"
								}), "So kỳ trước cùng độ dài"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => applyRange(draftStart, draftEnd),
								className: "h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg",
								children: "Kéo số phân tích"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-3 text-xs text-muted",
						children: [
							"Số ",
							start,
							" → ",
							end,
							" · timezone ",
							snap.timezone,
							" · kho tối đa",
							" ",
							snap.analytics_lookback_days || 270,
							" ngày",
							snap.warehouse_start ? ` (${snap.warehouse_start} → ${warehouseEnd})` : "",
							".",
							prevRange ? ` So ${prevRange.start} → ${prevRange.end}.` : "",
							" Không apply. CPA Google ≠ Qualified Lead."
						]
					})
				]
			}),
			missing ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn shadow-sheet",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "font-medium",
					children: "Thiếu dữ liệu"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-0.5",
					children: [account.missing_label || "Thiếu dữ liệu", " — mốc chưa đủ ngày; API không trả hết cửa sổ. Không đoán số."]
				})]
			}) : null,
			sideBySide.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeriodTable, {
				title: weeks.length ? "Từng tuần cạnh nhau" : "Từng tháng cạnh nhau",
				cols: sideBySide,
				blocks: sideBlocks,
				accountBlocks: sideAccountBlocks,
				groups,
				layer: periodLayer,
				onLayerChange: setPeriodLayer,
				onPickCampaign: (id) => {
					setCampaignId(id);
					setAdGroupId(null);
					setLayer("ad_group");
				}
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-4 shadow-sheet md:p-5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "font-display text-lg font-medium tracking-tight",
					children: "Tài khoản"
				}), account.rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 text-sm text-muted",
					children: "Thiếu dữ liệu — không đoán số."
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-3 grid grid-cols-2 gap-2 md:grid-cols-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Kpi, {
								label: "Chi tiêu",
								value: dong(metrics.cost || 0)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Kpi, {
								label: "Hiển thị",
								value: num(metrics.impressions || 0)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Kpi, {
								label: "Click",
								value: num(metrics.clicks || 0)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Kpi, {
								label: "Click không hợp lệ",
								value: invalidLabel(metrics)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Kpi, {
								label: "CTR",
								value: pct(metrics.ctr || 0)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Kpi, {
								label: "CPC (mọi click)",
								value: dong(metrics.cpc || 0)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Kpi, {
								label: "Chuyển đổi (primary)",
								value: convNum(metrics.conversions || 0)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Kpi, {
								label: "Platform CPL",
								value: dong(metrics.cost_per_conversion || 0)
							})
						]
					}),
					prevEqual && prevRange ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-3 text-xs text-muted",
						children: [
							"Vs kỳ trước (",
							formatRangeVi(prevRange.start, prevRange.end),
							prevAccount && !prevAccount.complete ? " · thiếu dữ liệu" : "",
							"):",
							" ",
							prevAccount && prevAccount.complete && prevMetrics ? `chi tiêu ${deltaWord(metrics.cost, prevMetrics.cost)} · click ${deltaWord(metrics.clicks, prevMetrics.clicks)} · conv ${deltaWord(metrics.conversions, prevMetrics.conversions)} · click lệch ${deltaWord(metrics.invalid_clicks, prevMetrics.invalid_clicks)}` : "chi tiêu — · click — · conv — · click lệch —"
						]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-3 flex flex-wrap gap-1.5",
						children: groups.map((g) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: "inline-flex h-10 items-center rounded-full bg-inset px-3 text-sm",
							children: [
								g.label,
								": ",
								convNum(Number(metrics[g.metric] || 0))
							]
						}, g.id))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-xs text-subtle",
						children: "Chuyển đổi Google ≠ Qualified Lead. All conversions không gộp vào đây. CPC / CTR / CR / chi phí/chuyển đổi trên mọi click. Conv = 0 → chi/conv = 0."
					})
				] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-4 shadow-sheet md:p-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-col gap-3 md:flex-row md:items-center md:justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "font-display text-lg font-medium tracking-tight",
							children: layer === "campaign" ? "Chiến dịch" : layer === "ad_group" ? "Nhóm quảng cáo" : layer === "keyword" ? "Từ khoá" : "Search terms"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap gap-1.5",
							children: [LAYERS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => goLayer(item.id),
								className: cn("h-11 rounded-full px-3.5 text-sm font-medium transition-colors duration-150", layer === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line"),
								children: item.label
							}, item.id)), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex h-11 items-center gap-2 rounded-full bg-inset px-3 text-sm",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: onlyConv,
									onChange: (e) => setOnlyConv(e.target.checked),
									className: "size-4 accent-accent"
								}), "Chỉ có conv"]
							})]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
						className: "mt-3 flex flex-wrap items-center gap-1.5 text-sm text-muted",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "hover:text-ink hover:underline",
								onClick: () => goLayer("campaign"),
								children: snap.display_name
							}),
							campaignName ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-3.5" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "hover:text-ink hover:underline",
								onClick: () => {
									setLayer("ad_group");
									setAdGroupId(null);
								},
								children: campaignName
							})] }) : null,
							adGroupName ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-3.5" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "text-ink",
								children: adGroupName
							})] }) : null
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-4",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WorkTable, {
							snap,
							layer,
							block: current,
							groups,
							canDrill,
							onDrill: drill
						})
					})
				]
			})
		]
	});
}
function deltaWord(now, prev) {
	if (prev == null || now == null) return "—";
	if (prev === 0 && now === 0) return "—";
	if (prev === 0) return "tăng";
	const d = (now - prev) / Math.abs(prev);
	if (Math.abs(d) < .005) return "—";
	return d > 0 ? "tăng" : "giảm";
}
function Kpi({ label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-md bg-inset px-3 py-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-xs font-medium tracking-wide text-subtle",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-1 font-display text-lg font-medium tracking-tight tabular-nums",
			children: value
		})]
	});
}
var PERIOD_KPIS = [
	{
		id: "cost",
		label: "Chi tiêu",
		fmt: (m) => dong(m.cost || 0)
	},
	{
		id: "clicks",
		label: "Click",
		fmt: (m) => num(m.clicks || 0)
	},
	{
		id: "conversions",
		label: "Conv",
		fmt: (m) => convNum(m.conversions || 0)
	},
	{
		id: "cost_per_conversion",
		label: "CPL",
		fmt: (m) => dong(m.cost_per_conversion || 0)
	}
];
function metricDefs(groups) {
	return [
		{
			label: "Chi tiêu",
			cell: (m) => dong(m.cost || 0),
			strong: true
		},
		{
			label: "Click",
			cell: (m) => num(m.clicks || 0)
		},
		{
			label: "Click lệch",
			cell: (m) => invalidLabel(m)
		},
		{
			label: "Conv",
			cell: (m) => convNum(m.conversions || 0)
		},
		{
			label: "CPC",
			cell: (m) => dong(m.cpc || 0)
		},
		{
			label: "CPL",
			cell: (m) => dong(m.cost_per_conversion || 0)
		},
		...groups.map((g) => ({
			label: g.label,
			cell: (m) => convNum(Number(m[g.metric] || 0)),
			strong: false
		}))
	];
}
function entityUnion(blocks) {
	const map = /* @__PURE__ */ new Map();
	for (const block of blocks) for (const row of block.rows) {
		const prev = map.get(row.id);
		map.set(row.id, {
			id: row.id,
			name: row.name,
			status: row.status,
			pmax: row.pmax,
			cost: (prev?.cost || 0) + (row.metrics.cost || 0)
		});
	}
	return [...map.values()].sort((a, b) => b.cost - a.cost);
}
function PeriodTable({ title, cols, blocks, accountBlocks, groups, layer, onLayerChange, onPickCampaign }) {
	const [kpi, setKpi] = (0, import_react.useState)("cost");
	const rows = metricDefs(groups);
	const campaigns = layer === "campaign" ? entityUnion(blocks) : [];
	const colCount = cols.length + 1;
	const kpiMeta = PERIOD_KPIS.find((item) => item.id === kpi) || PERIOD_KPIS[0];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		id: "analytics-period",
		className: "rounded-xl bg-paper p-4 shadow-sheet md:p-5",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-col gap-3 md:flex-row md:items-start md:justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "font-display text-lg font-medium tracking-tight",
					children: title
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 max-w-2xl text-sm text-muted",
					children: layer === "campaign" ? "Tầng chiến dịch — mỗi khối một chiến dịch, cột là tháng. Dòng cuối = tổng tài khoản. Bấm tên chiến dịch để xuống nhóm." : "Tầng tài khoản — tổng mọi chiến dịch. Đổi sang Chiến dịch để so từng chiến dịch cạnh nhau."
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "flex flex-wrap gap-1.5",
					children: [{
						id: "account",
						label: "Tài khoản"
					}, {
						id: "campaign",
						label: "Chiến dịch"
					}].map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => onLayerChange(item.id),
						className: cn("h-11 rounded-full px-3.5 text-sm font-medium transition-colors duration-150", layer === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line"),
						children: item.label
					}, item.id))
				})]
			}),
			layer === "campaign" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-3 flex flex-wrap items-center gap-1.5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "pr-1 text-xs font-medium text-muted",
					children: "Chỉ số"
				}), PERIOD_KPIS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => setKpi(item.id),
					className: cn("h-11 rounded-full px-3.5 text-sm font-medium transition-colors duration-150", kpi === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line"),
					children: item.label
				}, item.id))]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-3 -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0",
				children: [
					layer === "campaign" && campaigns.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
						id: "analytics-campaign-matrix",
						className: "mb-5 min-w-full border-separate border-spacing-0 text-left text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("th", {
							className: "sticky left-0 bg-paper pb-2 pr-4 text-xs font-medium text-muted",
							children: [kpiMeta.label, " theo chiến dịch"]
						}), cols.map((col, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("th", {
							className: "pb-2 pr-4 text-right text-xs font-medium",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "text-ink",
								children: col.label
							}), !blocks[i]?.complete ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "mt-0.5 block font-medium text-warn",
								children: "Thiếu dữ liệu"
							}) : null]
						}, `sum-${col.id}`))] }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tbody", { children: [campaigns.map((camp) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
							className: "border-t border-line",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "sticky left-0 bg-paper py-1 pr-4",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									onClick: () => onPickCampaign(camp.id),
									className: "flex min-h-11 w-full items-center text-left font-medium",
									children: camp.name
								})
							}), cols.map((col, i) => {
								const m = blocks[i]?.rows.find((r) => r.id === camp.id)?.metrics;
								return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
									className: "py-2.5 pr-4 text-right tabular-nums",
									children: m ? kpiMeta.fmt(m) : "—"
								}, col.id);
							})]
						}, `sum-${camp.id}`)), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
							className: "border-t border-line-strong",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "sticky left-0 bg-paper py-2.5 pr-4 font-medium",
								children: "Tài khoản"
							}), cols.map((col, i) => {
								const m = accountBlocks[i]?.rows[0]?.metrics;
								return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
									className: "py-2.5 pr-4 text-right font-medium tabular-nums",
									children: m ? kpiMeta.fmt(m) : "—"
								}, col.id);
							})]
						})] })]
					}) : null,
					layer === "campaign" && campaigns.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mb-2 text-xs font-medium tracking-wide text-subtle",
						children: "Đủ chỉ số từng chiến dịch"
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
						className: "min-w-full border-separate border-spacing-0 text-left text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
							className: "sticky left-0 bg-paper pb-2 pr-4 text-xs font-medium text-muted",
							children: layer === "campaign" ? "Chiến dịch / chỉ số" : "Chỉ số"
						}), cols.map((col, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("th", {
							className: "pb-2 pr-4 text-right text-xs font-medium",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-ink",
									children: col.label
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "mt-0.5 block font-normal text-subtle",
									children: col.sub
								}),
								!blocks[i]?.complete ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "mt-0.5 block font-medium text-warn",
									children: "Thiếu dữ liệu"
								}) : null
							]
						}, col.id))] }) }), layer === "account" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MetricRow, {
							row,
							cols,
							pick: (i) => blocks[i]?.rows[0]?.metrics
						}, row.label)) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [campaigns.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							colSpan: colCount,
							className: "py-6 text-sm text-muted",
							children: "Không có chiến dịch có số trong các kỳ này. Không đoán số."
						}) }) }) : campaigns.map((camp) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tbody", {
							className: "border-t border-line",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
								className: "border-t border-line",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
									className: "sticky left-0 bg-inset py-1 pr-4",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										type: "button",
										onClick: () => onPickCampaign(camp.id),
										className: "flex min-h-11 w-full items-center gap-2 text-left font-medium text-ink",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: camp.name }), camp.pmax ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-muted",
											children: "PMax"
										}) : null]
									})
								}), cols.map((col) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "bg-inset py-1 pr-4" }, col.id))]
							}), rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MetricRow, {
								row,
								cols,
								indent: true,
								pick: (i) => blocks[i]?.rows.find((r) => r.id === camp.id)?.metrics
							}, `${camp.id}-${row.label}`))]
						}, camp.id)), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tbody", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "sticky left-0 bg-paper pt-3 pr-4 font-medium",
							children: "Tài khoản (tổng)"
						}), cols.map((col) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { className: "pt-3 pr-4" }, col.id))] }), rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MetricRow, {
							row,
							cols,
							indent: true,
							pick: (i) => accountBlocks[i]?.rows[0]?.metrics
						}, `acct-${row.label}`))] })] })]
					})
				]
			})
		]
	});
}
function MetricRow({ row, cols, pick, indent }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
		className: "border-t border-line",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
			className: cn("sticky left-0 bg-paper py-2.5 pr-4", indent ? "pl-4 text-muted" : "text-muted", row.strong && "font-medium text-ink"),
			children: row.label
		}), cols.map((col, i) => {
			const m = pick(i);
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
				className: cn("py-2.5 pr-4 text-right tabular-nums", row.strong && "font-medium"),
				children: m ? row.cell(m) : "—"
			}, col.id);
		})]
	});
}
function WorkTable({ snap, layer, block, groups, canDrill, onDrill }) {
	if (block.pmax_note && block.rows.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
		className: "rounded-md bg-inset px-4 py-6 text-sm text-muted",
		children: ["PMax: ", block.pmax_note || "không có search term / keyword chuẩn"]
	});
	if (block.rows.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "rounded-md bg-inset px-4 py-6 text-sm text-muted",
		children: block.complete ? "Không có dòng trong cửa sổ ngày." : "Thiếu dữ liệu — mốc chưa đủ ngày; API không trả hết cửa sổ. Không đoán số."
	});
	const showMatch = layer === "keyword" || layer === "search_term";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
			className: "min-w-full border-separate border-spacing-0 text-left text-sm",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
				className: "text-xs font-medium text-muted",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "sticky left-0 bg-paper pb-2 pr-4",
						children: "Dòng"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "pb-2 pr-4",
						children: "Trạng thái"
					}),
					showMatch ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "pb-2 pr-4",
						children: "Khớp"
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "pb-2 pr-4 text-right",
						children: "Chi tiêu"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "pb-2 pr-4 text-right",
						children: "Click"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "pb-2 pr-4 text-right",
						children: "Click lệch"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "pb-2 pr-4 text-right",
						children: "Conv"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "pb-2 pr-4 text-right",
						children: "CPC"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "pb-2 pr-4 text-right",
						children: "CPL"
					}),
					groups.map((g) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "pb-2 pr-4 text-right",
						children: g.label
					}, g.id))
				]
			}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: block.rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
				className: cn("border-t border-line", canDrill && "cursor-pointer hover:bg-inset/60"),
				onClick: () => canDrill && onDrill(row),
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
						className: "sticky left-0 bg-paper py-2.5 pr-4 font-medium",
						children: [row.name, row.pmax ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "ml-2 rounded-full bg-inset px-2 py-0.5 text-xs font-medium text-muted",
							children: "PMax"
						}) : null]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "py-2.5 pr-4",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusPill, { status: row.status })
					}),
					showMatch ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "py-2.5 pr-4 text-muted",
						children: row.match_type_label || row.match_type || "—"
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "py-2.5 pr-4 text-right tabular-nums",
						children: dong(row.metrics.cost || 0)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "py-2.5 pr-4 text-right tabular-nums",
						children: num(row.metrics.clicks || 0)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "py-2.5 pr-4 text-right tabular-nums",
						children: invalidLabel(row.metrics)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "py-2.5 pr-4 text-right tabular-nums",
						children: convNum(row.metrics.conversions || 0)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "py-2.5 pr-4 text-right tabular-nums",
						children: dong(row.metrics.cpc || 0)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "py-2.5 pr-4 text-right tabular-nums",
						children: dong(row.metrics.cost_per_conversion || 0)
					}),
					groups.map((g) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: "py-2.5 pr-4 text-right tabular-nums",
						children: convNum(Number(row.metrics[g.metric] || 0))
					}, g.id))
				]
			}, row.id)) })]
		}), canDrill ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-2 text-xs text-subtle",
			children: "Bấm dòng để xuống tầng dưới. Campaign tạm dừng / kết thúc vẫn hiện nếu có số trong kỳ. PMax: một dòng, không bịa nhóm Search."
		}) : null]
	});
}
function StatusPill({ status }) {
	const label = statusVi(status);
	const code = String(status || "").toUpperCase();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", code === "ENABLED" || code === "ACTIVE" ? "bg-ok-bg text-ok" : "bg-inset text-muted"),
		children: label
	});
}
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
var saveClassifyEdits = createServerFn({ method: "POST" }).validator(asPayload).middleware([authMiddleware]).handler(createSsrRpc("f586239c6f20597a768549f5f030db83efe0abf606d3b27518dc8d4af4d47394"));
var LABELS = [
	{
		id: "keep",
		vi: "Giữ"
	},
	{
		id: "add_exact",
		vi: "Thêm Exact"
	},
	{
		id: "negative",
		vi: "Phủ định"
	},
	{
		id: "routing",
		vi: "Chuyển nhóm"
	},
	{
		id: "hold",
		vi: "Treo"
	}
];
var FILTERS = [
	{
		id: "all",
		vi: "Tất cả"
	},
	{
		id: "unclassified",
		vi: "Chưa gắn"
	},
	{
		id: "keep",
		vi: "Giữ"
	},
	{
		id: "add_exact",
		vi: "Thêm Exact"
	},
	{
		id: "negative",
		vi: "Phủ định"
	},
	{
		id: "routing",
		vi: "Chuyển nhóm"
	},
	{
		id: "hold",
		vi: "Treo"
	}
];
function tone$1(label, on) {
	if (!on) return "bg-inset text-muted hover:bg-line";
	if (label === "keep") return "bg-ok text-ok-bg";
	if (label === "add_exact") return "bg-accent text-accent-fg";
	if (label === "negative") return "bg-danger text-accent-fg";
	if (label === "routing") return "bg-warn text-accent-fg";
	return "bg-ink text-paper";
}
function chip(label) {
	if (label === "keep") return "bg-ok-bg text-ok";
	if (label === "add_exact") return "bg-inset text-accent";
	if (label === "negative") return "bg-danger-bg text-danger";
	if (label === "routing") return "bg-warn-bg text-warn";
	return "bg-inset text-muted";
}
function keyOf(row) {
	return `${row.query}||${row.campaign_name}||${row.ad_group_name}`;
}
function ClassifyView({ snap, onSaved }) {
	const [rows, setRows] = (0, import_react.useState)(snap.clusters || []);
	const [filter, setFilter] = (0, import_react.useState)("all");
	const [q, setQ] = (0, import_react.useState)("");
	const [dirty, setDirty] = (0, import_react.useState)({});
	const [open, setOpen] = (0, import_react.useState)(null);
	const [saving, setSaving] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
	const [note, setNote] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		setRows(snap.clusters || []);
		setDirty({});
		setError("");
		setNote("");
	}, [snap.client_id, snap.clusters]);
	const coverage = snap.coverage || {
		classified: 0,
		total: 0,
		ratio: 0,
		rows: 0,
		required: 1
	};
	const total = coverage.total || 0;
	const classified = coverage.classified || 0;
	const ratio = coverage.ratio ?? (total ? classified / total : 0);
	const dirtyN = Object.keys(dirty).length;
	const counts = (0, import_react.useMemo)(() => {
		const out = { unclassified: 0 };
		for (const row of rows) if (!row.classified) out.unclassified += 1;
		else out[row.label] = (out[row.label] || 0) + 1;
		return out;
	}, [rows]);
	const visible = (0, import_react.useMemo)(() => {
		const needle = q.trim().toLowerCase();
		return rows.filter((row) => {
			if (filter === "unclassified" && row.classified) return false;
			if (filter !== "all" && filter !== "unclassified" && row.label !== filter) return false;
			if (!needle) return true;
			return `${row.query} ${row.campaign_name} ${row.ad_group_name}`.toLowerCase().includes(needle);
		});
	}, [
		rows,
		filter,
		q
	]);
	function setLabel(row, label) {
		const key = keyOf(row);
		setRows((prev) => prev.map((item) => keyOf(item) === key ? {
			...item,
			label,
			classified: true,
			origin: "human",
			reason: "Người tối ưu gắn nhãn trên màn Phân loại ST.",
			negative_tier: label === "negative" ? item.negative_tier || "ad_group" : null
		} : item));
		setDirty((prev) => ({
			...prev,
			[key]: label
		}));
	}
	async function save() {
		const edits = rows.filter((row) => dirty[keyOf(row)]).map((row) => ({
			query: row.query,
			campaign_name: row.campaign_name,
			ad_group_name: row.ad_group_name,
			label: row.label,
			negative_tier: row.negative_tier,
			reason: row.reason
		}));
		if (!edits.length) return;
		setSaving(true);
		setError("");
		setNote("");
		try {
			const result = await saveClassifyEdits({ data: {
				clientId: snap.client_id,
				edits
			} });
			if (!result.ok) {
				setError(result.error_vi || "Không lưu được nhãn.");
				return;
			}
			setDirty({});
			if (result.snapshot) {
				setRows(result.snapshot.clusters || []);
				onSaved?.(result.snapshot);
			}
			const cov = result.summary;
			setNote(cov ? `Đã lưu ${edits.length} nhãn. Coverage ${Math.round((cov.coverage || 0) * 100)}% (${cov.classified}/${cov.total}). Không sinh FINAL.` : `Đã lưu ${edits.length} nhãn. Không sinh FINAL.`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Không lưu được nhãn.");
		} finally {
			setSaving(false);
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-end justify-between gap-4",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-xs font-medium uppercase tracking-widest text-subtle",
								children: "Phân loại ST"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "font-display text-2xl font-medium tracking-tight",
								children: "Cụm từ tìm kiếm"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-1 max-w-2xl text-sm text-muted",
								children: snap.verdict
							})
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-right",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "font-display text-4xl font-medium tabular-nums tracking-tight",
								children: [
									classified,
									"/",
									total || "—"
								]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-xs text-muted",
								children: [
									Math.round(ratio * 100),
									"% cụm · ",
									coverage.rows || snap.cluster_count || rows.length,
									" dòng cửa sổ"
								]
							})]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-4 h-2 overflow-hidden rounded-full bg-inset",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: cn("h-full rounded-full", ratio >= 1 ? "bg-ok" : "bg-accent"),
							style: { width: `${Math.min(100, Math.round(ratio * 100))}%` }
						})
					}),
					ratio >= 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 rounded-md bg-ok-bg px-4 py-3 text-sm text-ok",
						children: "Coverage 100%. Có thể mở FINAL ở phiên sau. Phiên này không sinh FINAL. AdsOps không tự apply Google Ads."
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 rounded-md bg-danger-bg px-4 py-3 text-sm text-danger",
						children: "Coverage chưa 100% — việc lớn bị chặn, không sinh FINAL."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-xl bg-paper p-4 shadow-sheet md:p-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-col gap-3 md:flex-row md:items-center md:justify-between",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "flex flex-wrap gap-1.5",
							children: FILTERS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => setFilter(item.id),
								className: cn("h-10 rounded-full px-3.5 text-sm font-medium", filter === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line"),
								children: [item.vi, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "ml-1.5 tabular-nums text-xs opacity-80",
									children: item.id === "all" ? rows.length : counts[item.id] || 0
								})]
							}, item.id))
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "relative block md:min-w-72",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { className: "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: q,
								onChange: (e) => setQ(e.target.value),
								placeholder: "Tìm cụm / chiến dịch / nhóm",
								className: "h-11 w-full rounded-md border border-line bg-bg pl-9 pr-3 text-sm text-ink"
							})]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-xs text-subtle",
						children: "Nhãn: Giữ · Thêm Exact · Phủ định · Chuyển nhóm · Treo. Bằng chứng cửa sổ 7/14/30 — không dựa 1 ngày lẻ."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-3 divide-y divide-line",
						children: visible.map((row) => {
							const key = keyOf(row);
							const expanded = open === key;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
								className: "py-3",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
											type: "button",
											onClick: () => setOpen(expanded ? null : key),
											className: "min-w-0 text-left",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
												className: "font-medium text-ink",
												children: row.query
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
												className: "mt-0.5 text-xs text-muted",
												children: [
													row.campaign_name,
													" · ",
													row.ad_group_name,
													row.added_status ? ` · ${row.added_status}` : "",
													row.match_type ? ` · ${row.match_type}` : ""
												]
											})]
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "flex flex-wrap items-center gap-2 lg:justify-end",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
												className: cn("rounded-full px-2.5 py-0.5 text-xs font-medium", chip(row.label)),
												children: [LABELS.find((l) => l.id === row.label)?.vi || row.label, row.classified ? "" : " · chưa gắn"]
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
												className: "text-xs tabular-nums text-muted",
												children: [
													money(row.cost_30, snap.currency || "VND"),
													" · ",
													num(row.clicks_30),
													" click · ",
													num(row.conversions_30, 1),
													" conv"
												]
											})]
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "mt-2 flex flex-wrap gap-1",
										children: LABELS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: () => setLabel(row, item.id),
											className: cn("h-10 rounded-full px-3 text-sm font-medium", tone$1(item.id, row.label === item.id && row.classified)),
											children: item.vi
										}, item.id))
									}),
									expanded ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "mt-3 rounded-md bg-inset px-3 py-3 text-sm",
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
												className: "text-ink",
												children: row.reason
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
												className: "mt-1 text-muted",
												children: row.evidence
											}),
											row.windows ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", {
												className: "mt-2 grid grid-cols-3 gap-2 text-xs md:grid-cols-3",
												children: [
													"7",
													"14",
													"30"
												].map((w) => {
													const b = row.windows?.[w];
													return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
														className: "rounded-sm bg-paper px-2 py-2",
														children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dt", {
															className: "text-subtle",
															children: [w, " ngày"]
														}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dd", {
															className: "tabular-nums text-ink",
															children: [
																num(b?.impressions),
																" imps · ",
																num(b?.clicks),
																" click · ",
																money(b?.cost, snap.currency || "VND"),
																" · ",
																num(b?.conversions, 1),
																" conv"
															]
														})]
													}, w);
												})
											}) : null
										]
									}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "mt-1 line-clamp-2 text-xs text-subtle",
										children: row.reason
									})
								]
							}, key);
						})
					}),
					visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "py-10 text-center text-sm text-muted",
						children: "Không có cụm khớp bộ lọc."
					}) : null
				]
			}),
			dirtyN > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "sticky bottom-3 z-10 rounded-xl bg-ink px-4 py-3 text-paper shadow-sheet",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap items-center justify-between gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-sm",
						children: [dirtyN, " nhãn đã sửa — chưa ghi. Không apply Google Ads."]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: save,
						disabled: saving,
						className: "h-11 rounded-full bg-accent px-5 text-sm font-medium text-accent-fg disabled:opacity-60",
						children: saving ? "Đang lưu…" : "Lưu nhãn"
					})]
				})
			}) : null,
			error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "rounded-md bg-danger-bg px-4 py-3 text-sm text-danger",
				children: error
			}) : null,
			note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "rounded-md bg-ok-bg px-4 py-3 text-sm text-ok",
				children: note
			}) : null
		]
	});
}
function asClientId$1(data) {
	const clientId = data && typeof data === "object" && typeof data.clientId === "string" ? String(data.clientId).trim() : "";
	if (!clientId) throw new Error("Thiếu khách");
	return { clientId };
}
createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("9a728b47921fcc6bb8848e4fe90985f5fd999668ed5937a983d31608f35d31c8"));
var getWorkspaceDirectory = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("c8a76893968b61d693fe7e15fb43cf2711f0415babedd37b662af64e2ae33924"));
var getWorkspacePack = createServerFn({ method: "POST" }).validator(asClientId$1).middleware([authMiddleware]).handler(createSsrRpc("37c08a47b418e0e0534e36a959b58eca11f821e4bf8b1d48b5d1652726748f1f"));
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
}).middleware([authMiddleware]).handler(createSsrRpc("2d48a262387df2adc436cfdd9d62461574818c8b805eb32469c849c510d98007"));
var listAccessMembers = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(createSsrRpc("db22aa728e8b47e79af549d301d9dd59a55dfe86e9f65003aa339a3a2b0ba383"));
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
}).middleware([authMiddleware]).handler(createSsrRpc("1b76e200cee5f3016ad7fc596501b77b241052f99c8a22f317c52a22b9e56d79"));
var revokeAccessMember = createServerFn({ method: "POST" }).validator((data) => {
	const id = data && typeof data === "object" && typeof data.id === "string" ? String(data.id).trim() : "";
	if (!id) throw new Error("Thiếu quyền.");
	return { id };
}).middleware([authMiddleware]).handler(createSsrRpc("735e3a754296bbfa124244595a7f29dad9ac733aec66f7365b47d7a02e665bb5"));
var ROLE_VI = {
	ops: "Vận hành",
	sale: "Sale",
	client: "Khách hàng"
};
function MembersPanel({ clients }) {
	const [rows, setRows] = (0, import_react.useState)([]);
	const [email, setEmail] = (0, import_react.useState)("");
	const [role, setRole] = (0, import_react.useState)("client");
	const [picked, setPicked] = (0, import_react.useState)([]);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		listAccessMembers().then(setRows).catch(() => setError("Không tải được danh sách quyền."));
	}, []);
	const grouped = (0, import_react.useMemo)(() => {
		const by = /* @__PURE__ */ new Map();
		for (const row of rows) {
			const key = `${row.email}::${row.role}`;
			const cur = by.get(key) || [];
			cur.push(row);
			by.set(key, cur);
		}
		return [...by.values()];
	}, [rows]);
	function toggle(id) {
		setPicked((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
	}
	async function grant() {
		setBusy(true);
		setError("");
		try {
			const next = await grantAccessMember({ data: {
				email,
				role,
				clientIds: role === "ops" ? [] : picked
			} });
			setRows(next);
			setEmail("");
			setPicked([]);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Không cấp được quyền.");
		} finally {
			setBusy(false);
		}
	}
	async function revoke(id) {
		setBusy(true);
		setError("");
		try {
			setRows(await revokeAccessMember({ data: { id } }));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Không gỡ được quyền.");
		} finally {
			setBusy(false);
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "space-y-5",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
			className: "rounded-xl bg-paper p-5 shadow-sheet",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-xl font-medium tracking-tight",
					children: "Cấp quyền"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-muted",
					children: "Khách hàng và sale chỉ vào chỉ số báo cáo của tài khoản được chọn. Vận hành vào đủ tab. Không apply Google Ads. Chọn A không thấy số B."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-4 grid gap-3 md:grid-cols-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "flex flex-col gap-1 text-xs font-medium text-muted",
						children: ["Email", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "email",
							value: email,
							onChange: (e) => setEmail(e.target.value),
							className: "h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink",
							autoComplete: "off"
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "flex flex-col gap-1 text-xs font-medium text-muted",
						children: ["Vai trò", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
							value: role,
							onChange: (e) => setRole(e.target.value),
							className: "h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "client",
									children: "Khách hàng — chỉ báo cáo"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "sale",
									children: "Sale — chỉ báo cáo"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
									value: "ops",
									children: "Vận hành — đủ công cụ"
								})
							]
						})]
					})]
				}),
				role !== "ops" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs font-medium text-muted",
							children: "Tài khoản được xem"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-2 flex flex-wrap gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "h-10 rounded-md px-3 text-sm text-muted hover:bg-inset",
								onClick: () => setPicked(clients.map((c) => c.client_id)),
								children: "Chọn hết"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: "h-10 rounded-md px-3 text-sm text-muted hover:bg-inset",
								onClick: () => setPicked([]),
								children: "Bỏ chọn"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-line bg-bg p-2",
							children: clients.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-inset",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: picked.includes(c.client_id),
									onChange: () => toggle(c.client_id)
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [c.display_name, c.customer_id_dashed && c.display_name !== c.customer_id_dashed ? ` · ${c.customer_id_dashed}` : ""] })]
							}) }, c.client_id))
						})
					]
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 rounded-md bg-inset px-3 py-2 text-sm text-muted",
					children: "Vận hành xem mọi tài khoản MCC. Không cần chọn từng khách."
				}),
				error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 text-sm text-danger",
					children: error
				}) : null,
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					disabled: busy || !email.trim(),
					onClick: () => void grant(),
					className: "mt-4 h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60",
					children: busy ? "Đang lưu…" : "Cấp quyền"
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
			className: "rounded-xl bg-paper p-5 shadow-sheet",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "font-display text-lg font-medium tracking-tight",
				children: "Đã cấp"
			}), grouped.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-3 space-y-3",
				children: grouped.map((pack) => {
					const head = pack[0];
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "rounded-md bg-inset px-3 py-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap items-baseline justify-between gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm font-medium",
								children: head.email
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: cn("text-xs font-medium", head.role === "ops" ? "text-ok" : "text-muted"),
								children: ROLE_VI[head.role]
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "mt-2 space-y-1",
							children: pack.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
								className: "flex items-center justify-between gap-2 text-sm",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-muted",
									children: row.display_name
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									disabled: busy,
									onClick: () => void revoke(row.id),
									className: "h-10 shrink-0 px-2 text-sm text-danger disabled:opacity-60",
									children: "Gỡ"
								})]
							}, row.id))
						})]
					}, `${head.email}-${head.role}`);
				})
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 text-sm text-muted",
				children: "Chưa cấp email nào. Người đăng nhập đầu tiên là vận hành."
			})]
		})]
	});
}
function txt$2(v) {
	if (v == null || v === "") return "";
	return String(v);
}
function matchEn(value) {
	const s = value.toLowerCase();
	if (s.includes("chính xác") || s === "exact") return "Exact";
	if (s.includes("cụm") || s === "phrase") return "Phrase";
	if (s.includes("rộng") || s === "broad") return "Broad";
	return value || "Exact";
}
function classifyAction(action) {
	const a = action.toUpperCase();
	if (a.includes("REMOVE")) return "remove";
	if (a.includes("RSA") || a.includes("ASSET")) return "rsa";
	if (a.includes("ROUT") || a.includes("MOVE") || a.includes("ĐIỀU HƯỚNG")) return "routing";
	if (a.includes("NEGATIVE")) return "negative";
	return "keyword";
}
var KIND_META = {
	keyword: {
		title: "Thêm từ khoá?",
		step: "Thêm từ khoá",
		chip: "Thêm từ khoá",
		verb: "từ khoá"
	},
	negative: {
		title: "Phủ định?",
		step: "Phủ định",
		chip: "Phủ định",
		verb: "phủ định"
	},
	rsa: {
		title: "Cải RSA?",
		step: "Cải RSA",
		chip: "Cải RSA",
		verb: "RSA"
	},
	routing: {
		title: "Cấu trúc lại?",
		step: "Điều hướng",
		chip: "Điều hướng",
		verb: "điều hướng"
	},
	remove: {
		title: "Gỡ phủ định?",
		step: "Gỡ phủ định",
		chip: "Gỡ phủ định",
		verb: "gỡ"
	}
};
var SCOPE_META = {
	account: {
		short: "Tài khoản",
		label: "Cấp tài khoản",
		hint: "Dán vào phủ định tài khoản / Negative keyword list. Không mở chiến dịch, không mở nhóm."
	},
	campaign: {
		short: "Chiến dịch",
		label: "Cấp chiến dịch",
		hint: "Mở chiến dịch → Negative keywords. Không mở Ad Group. Không dán vào Keywords."
	},
	ad_group: {
		short: "Nhóm QC",
		label: "Cấp nhóm quảng cáo",
		hint: "Mở đúng Ad Group → Negative keywords. Không dán lên chiến dịch hay tài khoản."
	}
};
function parseScope(raw, pasteInto, kind) {
	const s = raw.trim().toLowerCase();
	if (s === "ad_group" || s === "ad group" || s.startsWith("ad_group") || s === "nhóm") return "ad_group";
	if (s === "campaign" || s === "chiến dịch") return "campaign";
	if (s === "account" || s === "tài khoản") return "account";
	const blob = `${raw} ${pasteInto}`.toLowerCase();
	if (blob.includes("ad_group") || blob.includes("ad group") || blob.includes("đúng nhóm")) return "ad_group";
	if (/\baccount\b/.test(blob) || blob.includes("tài khoản") || blob.includes("keyword list")) return "account";
	if (blob.includes("đúng campaign") || blob.includes("cấp chiến dịch") || blob.includes("chiến dịch")) return "campaign";
	if (kind === "routing") return "campaign";
	return "ad_group";
}
function campaignShort(name) {
	const parts = name.split("|").map((p) => p.trim()).filter(Boolean);
	const drop = /* @__PURE__ */ new Set([
		"search",
		"pmax",
		"display",
		"hcm",
		"hn",
		"lead"
	]);
	return parts.filter((p) => !drop.has(p.toLowerCase()))[0] || parts[1] || parts[0] || name;
}
function isScopeKind(kind) {
	return kind === "negative" || kind === "remove" || kind === "routing";
}
function packTitle(pack) {
	if (!isScopeKind(pack.kind) || pack.scope === "ad_group") return pack.adGroup || pack.campaign;
	if (pack.scope === "account") return "Tài khoản Google Ads";
	return pack.campaign;
}
function packSub(pack) {
	if (!isScopeKind(pack.kind)) return pack.campaign;
	if (pack.scope === "account") return "Negative keyword list · không mở chiến dịch, không mở nhóm";
	if (pack.scope === "campaign") return pack.adGroup ? `Nguồn phát sinh: ${pack.adGroup} — không dán vào nhóm này` : "Dán cấp chiến dịch · không mở Ad Group";
	return pack.campaign;
}
function scopeTone(scope) {
	if (scope === "account") return "bg-danger-bg text-danger";
	if (scope === "campaign") return "bg-warn-bg text-warn";
	return "bg-ok-bg text-ok";
}
function negativeScopeLine(packs) {
	const neg = packs.filter((p) => p.kind === "negative");
	if (!neg.length) return "Không có negative READY";
	const nAcc = neg.filter((p) => p.scope === "account").length;
	const nCamp = neg.filter((p) => p.scope === "campaign").length;
	const nAg = neg.filter((p) => p.scope === "ad_group").length;
	const bits = [];
	if (nAg) bits.push(nAg === neg.length ? "cấp nhóm" : `${nAg} cấp nhóm`);
	if (nCamp) bits.push(nCamp === neg.length ? "cấp chiến dịch" : `${nCamp} cấp chiến dịch`);
	if (nAcc) bits.push(nAcc === neg.length ? "cấp tài khoản" : `${nAcc} cấp tài khoản`);
	return `${neg.length} chỗ dán · ${bits.join(" · ")}`;
}
function parseRows(headers, rows) {
	const idx = (name, fallback) => {
		const hit = headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
		return hit >= 0 ? hit : fallback;
	};
	const iAction = idx("LOẠI HÀNH ĐỘNG", 0);
	const iCamp = idx("Campaign", 1);
	const iGroup = idx("Ad Group nguồn / nơi áp dụng", 2);
	const iTerm = idx("Từ khóa / Negative / Asset", 3);
	const iMatch = idx("Match", 4);
	const iCopy = headers.findIndex((h) => h.toLowerCase().includes("cú pháp"));
	const iPaste = headers.findIndex((h) => h.toLowerCase().includes("dán"));
	const iEvi = headers.findIndex((h) => h.toLowerCase().includes("evidence") || h.toLowerCase().includes("bằng chứng"));
	const iScope = headers.findIndex((h) => h.toLowerCase() === "scope" || h.toLowerCase().includes("phạm vi"));
	const copyAt = iCopy >= 0 ? iCopy : 5;
	const pasteAt = iPaste >= 0 ? iPaste : 6;
	const out = [];
	for (const row of rows) {
		const action = txt$2(row[iAction]);
		const campaign = txt$2(row[iCamp]);
		const adGroup = txt$2(row[iGroup]);
		const term = txt$2(row[iTerm]);
		const match = txt$2(row[iMatch]);
		const syntax = txt$2(row[copyAt]) || (matchEn(match) === "Exact" ? `[${term}]` : term);
		if (!action || !syntax) continue;
		const kind = classifyAction(action);
		const pasteInto = txt$2(row[pasteAt]);
		out.push({
			action,
			campaign,
			adGroup,
			term,
			match,
			syntax,
			pasteInto,
			evidence: iEvi >= 0 ? txt$2(row[iEvi]) : "",
			kind,
			scope: parseScope(iScope >= 0 ? txt$2(row[iScope]) : "", pasteInto, kind)
		});
	}
	return out;
}
function destinationOf(row) {
	if (row.kind === "negative" || row.kind === "routing" || row.kind === "remove") {
		if (row.scope === "account") return `Google Ads → Công cụ → Negative keyword lists (cấp tài khoản) → dán → Lưu`;
		if (row.scope === "campaign") return `Google Ads → ${row.campaign} → Negative keywords (cấp chiến dịch) → + → dán → Lưu`;
		return `Google Ads → ${row.campaign} → ${row.adGroup} → Negative keywords (cấp nhóm) → + → dán → Lưu`;
	}
	if (row.kind === "rsa") return `Google Ads → ${row.campaign} → ${row.adGroup} → Ads / RSA`;
	return `Google Ads → ${row.campaign} → ${row.adGroup} → Từ khoá → + → dán cả khối → Lưu`;
}
var KIND_ORDER = [
	"keyword",
	"negative",
	"routing",
	"rsa",
	"remove"
];
function matchLabelOf(rows) {
	const set = new Set(rows.map((r) => matchEn(r.match)));
	if (set.size === 1 && set.has("Exact")) return "Chính xác";
	if (set.size === 1 && set.has("Phrase")) return "Cụm từ";
	if (set.size === 1 && set.has("Broad")) return "Rộng";
	return `${set.size} kiểu khớp`;
}
function toPacks(rows) {
	const map = /* @__PURE__ */ new Map();
	for (const row of rows) {
		const key = `${row.kind}||${row.scope}||${row.campaign}||${row.scope === "ad_group" ? row.adGroup : ""}`;
		const list = map.get(key);
		if (list) list.push(row);
		else map.set(key, [row]);
	}
	const packs = [];
	for (const [key, list] of map) {
		const first = list[0];
		const unique = [];
		const seen = /* @__PURE__ */ new Set();
		for (const row of list) {
			const id = row.syntax.toLowerCase();
			if (seen.has(id)) continue;
			seen.add(id);
			unique.push(row);
		}
		packs.push({
			key,
			kind: first.kind,
			scope: first.scope,
			action: first.action,
			campaign: first.campaign,
			adGroup: first.adGroup,
			rows: unique,
			destination: destinationOf(first),
			matchLabel: matchLabelOf(unique)
		});
	}
	packs.sort((a, b) => {
		const ka = KIND_ORDER.indexOf(a.kind);
		const kb = KIND_ORDER.indexOf(b.kind);
		if (ka !== kb) return ka - kb;
		if (a.campaign !== b.campaign) return a.campaign.localeCompare(b.campaign, "vi");
		return b.rows.length - a.rows.length;
	});
	return packs;
}
function pasteBlockOf(rows) {
	return rows.map((r) => r.syntax).join("\n");
}
function tsvOf(rows, scope) {
	if (scope === "campaign" || scope === "account") return ["Campaign	Keyword	Criterion type	Level", ...rows.map((r) => `${r.campaign}\t${r.term}\t${matchEn(r.match)}\t${scope === "account" ? "Account" : "Campaign"}`)].join("\n");
	return ["Campaign	Ad group	Keyword	Criterion type	Status", ...rows.map((r) => `${r.campaign}\t${r.adGroup}\t${r.term}\t${matchEn(r.match)}\tEnabled`)].join("\n");
}
async function copyText(text) {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {}
	const el = document.createElement("textarea");
	el.value = text;
	el.setAttribute("readonly", "");
	el.style.position = "fixed";
	el.style.left = "-9999px";
	document.body.appendChild(el);
	el.select();
	const ok = document.execCommand("copy");
	document.body.removeChild(el);
	return ok;
}
function CopyBtn({ label, text, primary, disabled, onCopied }) {
	const [copied, setCopied] = (0, import_react.useState)(false);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
		type: "button",
		disabled: disabled || !text,
		onClick: async () => {
			if (!await copyText(text)) return;
			setCopied(true);
			onCopied?.();
			window.setTimeout(() => setCopied(false), 2200);
		},
		className: cn("inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50", primary ? "w-full bg-accent text-accent-fg hover:bg-accent/90 sm:w-auto" : "border border-line bg-paper text-ink hover:bg-inset"),
		children: [copied ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, { className: "size-4" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Copy, { className: "size-4" }), copied ? "Đã copy" : label]
	});
}
function countByKind(rows) {
	const packs = toPacks(rows);
	const out = {
		keyword: {
			rows: 0,
			packs: 0
		},
		negative: {
			rows: 0,
			packs: 0
		},
		rsa: {
			rows: 0,
			packs: 0
		},
		routing: {
			rows: 0,
			packs: 0
		},
		remove: {
			rows: 0,
			packs: 0
		}
	};
	for (const pack of packs) {
		out[pack.kind].packs += 1;
		out[pack.kind].rows += pack.rows.length;
	}
	return out;
}
function tabById(tabs, id) {
	return tabs.find((t) => String(t.id) === id);
}
function rsaKeepLabel(tabs) {
	const t10 = tabById(tabs, "10");
	const headers = (t10?.headers || []).map(String);
	const rows = Array.isArray(t10?.rows) ? t10.rows : [];
	if (!rows.length) return "Không / giữ hiện trạng";
	const iFinal = headers.findIndex((h) => h.toLowerCase().includes("cuối") || h.toLowerCase().includes("quyết"));
	if (iFinal < 0) return "Không / giữ hiện trạng";
	const statuses = rows.map((r) => String(r[iFinal] || "").toUpperCase());
	if (statuses.length && statuses.every((s) => s === "PASS" || s === "SNAPSHOT" || s === "KEEP")) return "Không / giữ hiện trạng";
	if (statuses.some((s) => s === "HOLD")) return "Chưa READY — không copy";
	return `${rows.length} RSA trên tab 10`;
}
function buildDayCards(tabs, copyRows, holdCount) {
	const counts = countByKind(copyRows);
	const packsAll = toPacks(copyRows);
	const rsaReady = counts.rsa.packs;
	const rsaLine = rsaReady ? `${rsaReady} lô READY` : rsaKeepLabel(tabs);
	const structurePacks = counts.routing.packs + counts.remove.packs;
	const structureRows = counts.routing.rows + counts.remove.rows;
	const t06 = tabById(tabs, "06");
	const holds = holdCount || (Array.isArray(t06?.rows) ? t06.rows.length : 0);
	return [
		{
			id: "keyword",
			title: "Thêm từ khoá?",
			yes: counts.keyword.packs > 0,
			headline: counts.keyword.packs ? `Có · ${counts.keyword.rows}` : "Không",
			detail: counts.keyword.packs ? `${counts.keyword.packs} lần dán · ${counts.keyword.rows} từ` : "Không có exact READY",
			jump: {
				tabId: "12",
				copyKind: "keyword",
				cardId: "keyword"
			}
		},
		{
			id: "negative",
			title: "Phủ định?",
			yes: counts.negative.packs > 0,
			headline: counts.negative.packs ? `Có · ${counts.negative.rows}` : "Không",
			detail: counts.negative.packs ? negativeScopeLine(packsAll) : "Không có negative READY",
			jump: {
				tabId: "12",
				copyKind: "negative",
				cardId: "negative"
			}
		},
		{
			id: "rsa",
			title: "Cải RSA?",
			yes: rsaReady > 0,
			headline: rsaReady ? `Có · ${counts.rsa.rows}` : "Không / giữ hiện trạng",
			detail: rsaLine,
			jump: {
				tabId: rsaReady ? "12" : "10",
				copyKind: rsaReady ? "rsa" : void 0,
				cardId: "rsa"
			}
		},
		{
			id: "routing",
			title: "Cấu trúc lại?",
			yes: structurePacks > 0,
			headline: structurePacks ? `Có · ${structureRows}` : "Không",
			detail: structurePacks ? `${structurePacks} lô điều hướng / gỡ` : "Không đổi cấu trúc hôm nay",
			jump: {
				tabId: structurePacks ? "12" : "03",
				copyKind: structurePacks ? "routing" : void 0,
				cardId: "routing"
			}
		},
		{
			id: "other",
			title: "Việc khác?",
			yes: holds > 0,
			headline: holds ? `Có · ${holds}` : "Không",
			detail: holds ? `${holds} việc chờ tay — không READY` : "Không có HOLD",
			jump: {
				tabId: "06",
				cardId: "other"
			}
		}
	];
}
function DayPackOverview({ tabs, headers, rows, holdCount = 0, activeId, onJump }) {
	const parsed = (0, import_react.useMemo)(() => parseRows(headers, rows), [headers, rows]);
	const cards = (0, import_react.useMemo)(() => buildDayCards(tabs, parsed, holdCount), [
		tabs,
		parsed,
		holdCount
	]);
	const pasteLots = cards.filter((c) => c.id !== "other" && c.yes).reduce((n, c) => {
		const bit = c.detail.match(/^(\d+)/);
		return n + (bit ? Number(bit[1]) : 0);
	}, 0);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-xl bg-paper p-4 shadow-sheet md:p-5",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-medium tracking-wide text-subtle",
				children: "Việc hôm nay · chỉ READY · không apply"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "mt-1 font-display text-lg font-medium tracking-tight",
				children: pasteLots > 0 ? `${pasteLots} lần dán vào Google Ads` : "Không có lô copy hôm nay"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-1 max-w-3xl text-pretty text-sm text-muted",
				children: "Mỗi ô là một loại việc. Bấm để nhảy đúng lô. Phủ định: xem cấp dán (nhóm / chiến dịch / tài khoản) trước khi paste. Thêm từ khoá trước, phủ định sau. HOLD không copy."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5",
				children: cards.map((card) => {
					const on = activeId === card.id;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						onClick: () => onJump(card.jump),
						className: cn("flex min-h-24 flex-col rounded-lg px-4 py-3 text-left transition-colors duration-150", on ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line"),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "flex items-center justify-between gap-2 text-xs font-medium tracking-wide",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: on ? "text-accent-fg/80" : "text-subtle",
									children: card.title
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-4 shrink-0 opacity-70" })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "mt-2 font-display text-lg font-medium tracking-tight",
								children: card.headline
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: cn("mt-1 text-sm", on ? "text-accent-fg/80" : "text-muted"),
								children: card.detail
							})
						]
					}, card.id);
				})
			})
		]
	});
}
function doneKey(clientId) {
	return clientId ? `adsops-tab12-done:${clientId}` : "";
}
function readDone(clientId) {
	const key = doneKey(clientId);
	if (!key || typeof window === "undefined") return /* @__PURE__ */ new Set();
	try {
		const raw = window.localStorage.getItem(key);
		const arr = raw ? JSON.parse(raw) : [];
		return new Set(Array.isArray(arr) ? arr.map(String) : []);
	} catch {
		return /* @__PURE__ */ new Set();
	}
}
function writeDone(clientId, next) {
	const key = doneKey(clientId);
	if (!key) return;
	try {
		window.localStorage.setItem(key, JSON.stringify([...next]));
	} catch {}
}
function Tab12CopyDesk({ headers, rows, clientId, kind = "all", onKindChange }) {
	const parsed = (0, import_react.useMemo)(() => parseRows(headers, rows), [headers, rows]);
	const [query, setQuery] = (0, import_react.useState)("");
	const [activeKey, setActiveKey] = (0, import_react.useState)("");
	const [picked, setPicked] = (0, import_react.useState)(/* @__PURE__ */ new Set());
	const [trim, setTrim] = (0, import_react.useState)(false);
	const [toast, setToast] = (0, import_react.useState)("");
	const [done, setDone] = (0, import_react.useState)(() => readDone(clientId));
	const [localKind, setLocalKind] = (0, import_react.useState)(kind);
	const deskRef = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		setLocalKind(kind);
	}, [kind]);
	const currentKind = localKind;
	(0, import_react.useEffect)(() => {
		setDone(readDone(clientId));
	}, [clientId]);
	const filtered = (0, import_react.useMemo)(() => {
		const q = query.trim().toLowerCase();
		return parsed.filter((row) => {
			if (currentKind !== "all") {
				if (currentKind === "routing") {
					if (row.kind !== "routing" && row.kind !== "remove") return false;
				} else if (row.kind !== currentKind) return false;
			}
			if (!q) return true;
			return row.campaign.toLowerCase().includes(q) || row.adGroup.toLowerCase().includes(q) || row.term.toLowerCase().includes(q) || row.syntax.toLowerCase().includes(q);
		});
	}, [
		parsed,
		currentKind,
		query
	]);
	const packs = (0, import_react.useMemo)(() => toPacks(filtered), [filtered]);
	const allPacks = (0, import_react.useMemo)(() => toPacks(parsed), [parsed]);
	const counts = (0, import_react.useMemo)(() => countByKind(parsed), [parsed]);
	(0, import_react.useEffect)(() => {
		if (!packs.length) {
			setActiveKey("");
			return;
		}
		if (!packs.some((p) => p.key === activeKey)) {
			const pending = packs.find((p) => !done.has(p.key));
			setActiveKey((pending || packs[0]).key);
		}
	}, [
		packs,
		activeKey,
		done
	]);
	(0, import_react.useEffect)(() => {
		setToast("");
	}, [activeKey, currentKind]);
	(0, import_react.useEffect)(() => {
		deskRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "start"
		});
	}, [currentKind]);
	const active = packs.find((p) => p.key === activeKey) || packs[0] || null;
	const stepIndex = active ? packs.findIndex((p) => p.key === active.key) + 1 : 0;
	(0, import_react.useEffect)(() => {
		const pack = packs.find((p) => p.key === activeKey);
		if (!pack) {
			setPicked(/* @__PURE__ */ new Set());
			return;
		}
		setPicked(new Set(pack.rows.map((r) => r.syntax)));
		setTrim(false);
	}, [activeKey, packs]);
	const selectedRows = active ? active.rows.filter((r) => picked.has(r.syntax)) : [];
	const paste = pasteBlockOf(selectedRows);
	const doneCount = packs.filter((p) => done.has(p.key)).length;
	function markDone(key) {
		setDone((prev) => {
			const next = new Set(prev);
			next.add(key);
			writeDone(clientId, next);
			return next;
		});
	}
	function markUndone(key) {
		setDone((prev) => {
			const next = new Set(prev);
			next.delete(key);
			writeDone(clientId, next);
			return next;
		});
	}
	function goNext() {
		if (!active) return;
		const i = packs.findIndex((p) => p.key === active.key);
		const rest = packs.slice(i + 1);
		const nxt = rest.find((p) => !done.has(p.key)) || rest[0] || packs.find((p) => !done.has(p.key));
		if (nxt) setActiveKey(nxt.key);
	}
	function announceCopy() {
		if (!active) return;
		markDone(active.key);
		const meta = KIND_META[active.kind];
		if (isScopeKind(active.kind)) {
			const sc = SCOPE_META[active.scope];
			if (active.scope === "account") setToast(`Đã copy ${selectedRows.length} ${meta.verb}. Dán ${sc.label} — Công cụ → Negative keyword lists. Không mở chiến dịch.`);
			else if (active.scope === "campaign") setToast(`Đã copy ${selectedRows.length} ${meta.verb}. Dán ${sc.label} vào «${active.campaign}» → Negative keywords. Không mở Ad Group.`);
			else setToast(`Đã copy ${selectedRows.length} ${meta.verb}. Dán ${sc.label} vào «${active.adGroup}» → Negative keywords. Không dán lên chiến dịch.`);
			return;
		}
		setToast(`Đã copy ${selectedRows.length} ${meta.verb} của «${active.adGroup}». Mở đúng Campaign / Ad Group đó rồi dán — không trộn nhóm.`);
	}
	const chips = [
		{
			id: "all",
			label: "Tất cả lô",
			n: allPacks.length
		},
		{
			id: "keyword",
			label: KIND_META.keyword.chip,
			n: counts.keyword.packs
		},
		{
			id: "negative",
			label: KIND_META.negative.chip,
			n: counts.negative.packs
		},
		{
			id: "routing",
			label: KIND_META.routing.chip,
			n: counts.routing.packs + counts.remove.packs
		},
		{
			id: "rsa",
			label: KIND_META.rsa.chip,
			n: counts.rsa.packs
		}
	].filter((c) => c.id === "all" || c.n > 0);
	if (!parsed.length) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "text-sm text-muted",
		children: "Không có dòng READY để copy."
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		ref: deskRef,
		id: "tab12-desk",
		className: "flex scroll-mt-4 flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted",
				children: "Một thẻ = một lần dán vào đúng cấp Google Ads. Phủ định có ba cấp: nhóm quảng cáo, chiến dịch, tài khoản — xem badge trước khi dán. Copy cả khối, mỗi dòng một cú pháp. Không apply. Thứ tự: thêm từ khoá → phủ định đúng cấp → điều hướng → RSA → gỡ negative."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex flex-wrap gap-1.5",
				children: chips.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => {
						setLocalKind(item.id);
						onKindChange?.(item.id);
					},
					className: cn("inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors duration-150", currentKind === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line"),
					children: [item.label, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: cn("tabular-nums", currentKind === item.id ? "text-accent-fg/80" : "text-muted"),
						children: [
							" ",
							"· ",
							item.n
						]
					})]
				}, item.id))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "relative block",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { className: "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: query,
					onChange: (e) => setQuery(e.target.value),
					placeholder: "Lọc chiến dịch, nhóm quảng cáo, từ khoá…",
					className: "h-11 w-full rounded-md border border-line bg-paper pl-10 pr-3 text-sm text-ink"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "text-sm text-muted",
				children: [
					doneCount,
					"/",
					packs.length,
					" lô đã copy",
					currentKind !== "all" ? ` · đang xem ${KIND_META[currentKind]?.chip || currentKind}` : ""
				]
			}),
			toast ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "rounded-md bg-ok-bg px-4 py-3 text-sm text-ok",
				role: "status",
				children: toast
			}) : null,
			packs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "rounded-md bg-inset px-4 py-6 text-sm text-muted",
				children: "Không khớp bộ lọc."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 lg:grid-cols-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "rounded-lg bg-inset p-3 lg:col-span-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "mb-3 block lg:hidden",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "mb-1.5 block text-xs font-medium tracking-wide text-subtle",
							children: "Lô dán"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
							value: active?.key || "",
							onChange: (e) => setActiveKey(e.target.value),
							className: "h-11 w-full rounded-md border border-line bg-paper px-3 text-sm text-ink",
							children: packs.map((pack, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", {
								value: pack.key,
								children: [
									done.has(pack.key) ? "✓ " : "",
									i + 1,
									". ",
									KIND_META[pack.kind].step,
									isScopeKind(pack.kind) ? ` · ${SCOPE_META[pack.scope].label}` : "",
									" · ",
									packTitle(pack),
									" (",
									pack.rows.length,
									")"
								]
							}, pack.key))
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "hidden max-h-[32rem] overflow-auto lg:block",
						children: packs.map((pack, i) => {
							const on = pack.key === active?.key;
							const ok = done.has(pack.key);
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								onClick: () => setActiveKey(pack.key),
								className: cn("mb-1 flex min-h-11 w-full items-start justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 last:mb-0", on ? "bg-accent text-accent-fg" : "bg-paper text-ink hover:bg-line"),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "min-w-0",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
											className: cn("block text-xs", on ? "text-accent-fg/80" : "text-subtle"),
											children: [
												i + 1,
												"/",
												packs.length,
												" · ",
												KIND_META[pack.kind].step,
												isScopeKind(pack.kind) ? ` · ${SCOPE_META[pack.scope].short}` : "",
												ok ? " · đã copy" : ""
											]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "mt-0.5 block text-pretty",
											children: packTitle(pack)
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: cn("mt-0.5 block text-xs", on ? "text-accent-fg/80" : "text-muted"),
											children: isScopeKind(pack.kind) && pack.scope === "campaign" ? "Cấp chiến dịch · không mở nhóm" : isScopeKind(pack.kind) && pack.scope === "account" ? "Cấp tài khoản · không mở chiến dịch" : campaignShort(pack.campaign)
										})
									]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: cn("shrink-0 tabular-nums", on ? "text-accent-fg" : "text-muted"),
									children: pack.rows.length
								})]
							}, pack.key);
						})
					})]
				}), active ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LotCard, {
					pack: active,
					stepIndex,
					stepTotal: packs.length,
					selectedRows,
					paste,
					picked,
					setPicked,
					trim,
					setTrim,
					done: done.has(active.key),
					onCopied: announceCopy,
					onToggleDone: () => done.has(active.key) ? markUndone(active.key) : markDone(active.key),
					onNext: goNext,
					hasNext: stepIndex < packs.length
				}) : null]
			})
		]
	});
}
function LotCard({ pack, stepIndex, stepTotal, selectedRows, paste, picked, setPicked, trim, setTrim, done, onCopied, onToggleDone, onNext, hasNext }) {
	const meta = KIND_META[pack.kind];
	const scope = SCOPE_META[pack.scope];
	const scoped = isScopeKind(pack.kind);
	const pills = pack.rows.slice(0, 8);
	const extra = pack.rows.length - pills.length;
	const evidence = pack.rows[0]?.evidence;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "flex flex-col gap-4 rounded-lg bg-paper p-4 shadow-sheet lg:col-span-2",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-xs font-medium tracking-wide text-subtle",
						children: [
							"Bước ",
							stepIndex,
							"/",
							stepTotal,
							" · ",
							meta.step,
							" · ",
							pack.rows.length,
							" ",
							meta.verb,
							" · ",
							pack.matchLabel
						]
					}),
					scoped ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: cn("mt-2 inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium", scopeTone(pack.scope)),
						children: [scope.label, " — dán đúng cấp này"]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", {
						className: "mt-2 font-display text-xl font-medium tracking-tight text-pretty",
						children: packTitle(pack)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: packSub(pack)
					})
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CopyBtn, {
					primary: true,
					text: paste,
					disabled: !selectedRows.length,
					label: `Copy cả ${selectedRows.length} ${meta.verb} — dán 1 lần`,
					onCopied
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: cn("rounded-md px-3 py-3", scoped && pack.scope !== "ad_group" ? "bg-warn-bg text-warn" : scoped ? "bg-ok-bg text-ok" : "bg-inset text-ink"),
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs font-medium tracking-wide",
						children: scoped ? `Dán vào · ${scope.label}` : "Dán vào · Keywords · đúng Ad Group"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-pretty",
						children: pack.destination
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: cn("mt-1 text-xs", scoped && pack.scope !== "ad_group" ? "text-warn" : scoped ? "text-ok" : "text-muted"),
						children: scoped ? scope.hint : "Dán cả khối, mỗi dòng một cú pháp. Sai nhóm = sai traffic."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap gap-1.5",
				children: [pills.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "inline-flex max-w-full rounded-full bg-inset px-3 py-1.5 font-mono text-xs text-ink",
					children: row.syntax
				}, row.syntax)), extra > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "inline-flex items-center text-xs text-muted",
					children: [
						"+",
						extra,
						" trong khối copy"
					]
				}) : null]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CopyBtn, {
						text: tsvOf(selectedRows, pack.scope),
						label: "Copy bảng nhiều thay đổi"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => setTrim((v) => !v),
						className: "inline-flex h-11 items-center rounded-md border border-line bg-paper px-4 text-sm font-medium text-ink hover:bg-inset",
						children: trim ? "Xong chọn bớt" : "Bỏ vài từ không cần"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: onToggleDone,
						className: cn("inline-flex h-11 items-center rounded-md px-4 text-sm font-medium", done ? "bg-ok-bg text-ok" : "border border-line bg-paper text-ink hover:bg-inset"),
						children: done ? "Đã dán lô này" : "Đánh dấu đã dán"
					}),
					hasNext ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: onNext,
						className: "inline-flex h-11 items-center rounded-md border border-line bg-paper px-4 text-sm font-medium text-ink hover:bg-inset",
						children: "Lô tiếp theo"
					}) : null
				]
			}),
			trim ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mb-2 flex flex-wrap gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "h-10 text-sm font-medium text-accent",
					onClick: () => setPicked(new Set(pack.rows.map((r) => r.syntax))),
					children: [
						"Chọn tất cả (",
						pack.rows.length,
						")"
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: "h-10 text-sm font-medium text-muted",
					onClick: () => setPicked(/* @__PURE__ */ new Set()),
					children: "Bỏ chọn hết"
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "max-h-72 overflow-auto rounded-md border border-line",
				children: pack.rows.map((row) => {
					const on = picked.has(row.syntax);
					return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
						className: "border-b border-line last:border-b-0",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-inset",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "checkbox",
								checked: on,
								onChange: () => {
									setPicked((prev) => {
										const next = new Set(prev);
										if (next.has(row.syntax)) next.delete(row.syntax);
										else next.add(row.syntax);
										return next;
									});
								},
								className: "size-4 shrink-0 accent-accent"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-mono text-sm text-ink",
								children: row.syntax
							})]
						})
					}, row.syntax);
				})
			})] }) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "block",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "mb-1.5 block text-xs font-medium tracking-wide text-subtle",
					children: [
						"Khối dán (",
						selectedRows.length,
						" dòng) — bôi đen + Ctrl/Cmd+C nếu nút Copy bị chặn"
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
					readOnly: true,
					value: paste,
					onFocus: (e) => e.currentTarget.select(),
					rows: Math.min(12, Math.max(6, selectedRows.length)),
					className: "w-full rounded-md border border-line bg-inset/50 p-3 font-mono text-sm leading-6 text-ink"
				})]
			}),
			evidence ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-subtle",
				children: evidence
			}) : null
		]
	});
}
function asObj$1(v) {
	return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function isCopyTab(tab) {
	if (!tab) return false;
	if (String(tab.id ?? "").trim() === "12") return true;
	const blob = `${tab.short || ""} ${tab.name || ""} ${tab.title || ""}`.toLowerCase();
	return blob.includes("copy ready") || blob.includes("copy-paste");
}
function asArr$1(v) {
	return Array.isArray(v) ? v : [];
}
function txt$1(v) {
	if (v == null || v === "") return "";
	if (typeof v === "boolean") return v ? "Có" : "Không";
	return String(v);
}
function isMoneyHeader(header) {
	const h = header.toLowerCase();
	return h.includes("chi phí") || h.includes("cpl") || h.includes("cpc") || h.includes("ngân sách") || h.includes("cpa");
}
function isCopyHeader(header) {
	const h = header.toLowerCase();
	return h.includes("cú pháp") || h.includes("copy");
}
function cellText(value, currency, header = "") {
	if (value == null || value === "") return "—";
	if (typeof value === "boolean") return value ? "Có" : "Không";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return "—";
		if (isMoneyHeader(header)) return money(value, currency);
		if (!Number.isInteger(value)) return num(value, 2);
		return num(value, 0);
	}
	return String(value);
}
function statusTone(value) {
	const s = value.toUpperCase();
	if (s.includes("HARD") || s === "STALE" || s === "FAIL" || s.includes("CONFLICT") || s === "STOP") return "bg-danger-bg text-danger";
	if (s === "READY" || s === "PASS" || s === "CÓ" || s === "KEEP" || s.includes("VERIFIED") || s.startsWith("ADD ")) return "bg-ok-bg text-ok";
	if (s.includes("HOLD") || s === "CONDITIONAL" || s === "REVIEW" || s === "MONITOR") return "bg-warn-bg text-warn";
	return "";
}
function isStatusHeader(header) {
	const h = header.toLowerCase();
	return h.includes("trạng thái") || h === "status" || h === "loại hành động" || h === "được làm ngay?";
}
function Guide({ guide }) {
	const entries = Object.entries(guide);
	if (!entries.length) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
		className: "rounded-md bg-inset/80 px-4 py-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", {
			className: "cursor-pointer text-sm font-medium text-ink",
			children: "Hướng dẫn đọc tab"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", {
			className: "mt-3 grid gap-3 text-sm md:grid-cols-2",
			children: entries.map(([key, value]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
				className: "text-xs font-medium uppercase tracking-wide text-subtle",
				children: key
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
				className: "mt-1 text-pretty text-muted",
				children: txt$1(value)
			})] }, key))
		})]
	});
}
function SheetTable({ headers, rows, currency, empty }) {
	if (!headers.length) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
			className: "min-w-full border-separate border-spacing-0 text-left text-sm",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: headers.map((h) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
				className: "sticky top-0 z-10 whitespace-nowrap border-b border-line-strong bg-accent px-2.5 py-2 text-[11px] font-medium uppercase tracking-wide text-accent-fg",
				children: h
			}, h)) }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
				className: "px-2.5 py-6 text-muted",
				colSpan: headers.length,
				children: empty || "Không có dòng ở tab này."
			}) }) : rows.map((row, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", {
				className: "odd:bg-paper even:bg-inset/60",
				children: headers.map((h, c) => {
					const raw = row[c];
					const text = cellText(raw, currency, h);
					const tone = isStatusHeader(h) ? statusTone(txt$1(raw)) : "";
					const copy = isCopyHeader(h);
					return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
						className: cn("max-w-[18rem] border-b border-line px-2.5 py-2 align-top", c === 0 ? "font-medium text-ink" : "text-muted", copy ? "bg-ok-bg/40 font-mono text-ink" : ""),
						children: tone ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tone),
							children: text
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "line-clamp-4 text-pretty",
							children: text
						})
					}, `${i}-${c}`);
				})
			}, i)) })]
		})
	});
}
function AuditRows({ headers, rows, currency, empty }) {
	const [open, setOpen] = (0, import_react.useState)(false);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
		className: "rounded-md bg-inset/80 px-4 py-3",
		onToggle: (e) => setOpen(e.target.open),
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", {
			className: "cursor-pointer text-sm font-medium text-ink",
			children: [
				"Bảng từng dòng (",
				rows.length,
				") — chỉ đối chiếu, không copy từ đây"
			]
		}), open ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-4",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SheetTable, {
				headers,
				rows,
				currency,
				empty
			})
		}) : null]
	});
}
function OverviewBody({ tab, currency }) {
	const coverage = asArr$1(tab.coverage);
	const sources = asArr$1(tab.source_status);
	const kpiHeaders = asArr$1(tab.kpi_headers).map(String);
	const kpiRows = asArr$1(tab.kpi_rows);
	const top5Headers = asArr$1(tab.top5_headers).map(String);
	const top5 = asArr$1(tab.top5);
	const stopHeaders = asArr$1(tab.hard_stop_headers).map(String);
	const stops = asArr$1(tab.hard_stops);
	const tabMap = asArr$1(tab.tab_map);
	const newcomer = asArr$1(tab.newcomer);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-6",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid gap-4 lg:grid-cols-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "mb-2 text-xs font-medium uppercase tracking-wide text-subtle",
					children: "A. Coverage"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "space-y-2 text-sm",
					children: coverage.map((row, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "rounded-md bg-inset px-3 py-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "font-medium",
								children: txt$1(row[0])
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-0.5 tabular-nums",
								children: txt$1(row[1])
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-xs text-muted",
								children: txt$1(row[2])
							})
						]
					}, i))
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "mb-2 text-xs font-medium uppercase tracking-wide text-subtle",
					children: "B. Nguồn dữ liệu"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "space-y-2 text-sm",
					children: sources.map((row, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "rounded-md bg-inset px-3 py-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap items-center gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-medium",
								children: txt$1(row[0])
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: cn("rounded-full px-2 py-0.5 text-xs font-medium", statusTone(txt$1(row[1]))),
								children: txt$1(row[1])
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-xs text-muted",
							children: txt$1(row[2])
						})]
					}, i))
				})] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "mb-2 text-xs font-medium uppercase tracking-wide text-subtle",
				children: "C. KPI 7 / 14 / 30"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SheetTable, {
				headers: kpiHeaders,
				rows: kpiRows,
				currency
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "mb-2 text-xs font-medium uppercase tracking-wide text-subtle",
				children: "D. Đúng 5 việc hôm nay"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SheetTable, {
				headers: top5Headers,
				rows: top5,
				currency,
				empty: "Không có việc READY/HOLD đủ điều kiện."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "mb-2 text-xs font-medium uppercase tracking-wide text-subtle",
				children: "E. Hard stop"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SheetTable, {
				headers: stopHeaders,
				rows: stops,
				currency,
				empty: "Không có HARD_STOP trên gói này."
			})] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "mb-2 text-xs font-medium uppercase tracking-wide text-subtle",
				children: "F. Sơ đồ 12 tab"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "grid gap-2 text-sm md:grid-cols-2",
				children: tabMap.map((row, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "rounded-md bg-inset px-3 py-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-medium",
						children: txt$1(row[0])
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-0.5 text-muted",
						children: txt$1(row[1])
					})]
				}, i))
			})] }),
			newcomer.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
				className: "mb-2 text-xs font-medium uppercase tracking-wide text-subtle",
				children: "Người mới Google Ads cần nhớ"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "grid gap-2",
				children: newcomer.map((row, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "rounded-md bg-inset px-3 py-3 text-sm",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-medium",
							children: txt$1(row[0])
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-pretty text-muted",
							children: txt$1(row[1])
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-xs text-subtle",
							children: txt$1(row[2])
						})
					]
				}, i))
			})] })
		]
	});
}
function FinalWorkbook({ data }) {
	const workbook = asObj$1(data.workbook);
	const tabs = asArr$1(workbook.tabs);
	const [tabId, setTabId] = (0, import_react.useState)(tabs[0] ? String(tabs[0].id) : "00");
	const [copyKind, setCopyKind] = (0, import_react.useState)("all");
	const [overviewId, setOverviewId] = (0, import_react.useState)("");
	const currency = String(data.currency || "VND");
	const tab0 = asObj$1(data.tab0);
	const current = (0, import_react.useMemo)(() => tabs.find((t) => String(t.id) === tabId) || tabs[0] || null, [tabs, tabId]);
	const copyTab = (0, import_react.useMemo)(() => tabs.find((t) => isCopyTab(t)) || null, [tabs]);
	const holdCount = asArr$1(asObj$1(tabs.find((t) => String(t.id) === "06")).rows).length;
	function jumpTo(jump) {
		setTabId(jump.tabId);
		setOverviewId(jump.cardId || "");
		setCopyKind(jump.copyKind || "all");
	}
	if (!tabs.length) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-start justify-between gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-xs font-medium uppercase tracking-widest text-subtle",
								children: "Gói FINAL · 13 tab"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "font-display text-xl font-medium tracking-tight text-balance",
								children: txt$1(workbook.file_title || workbook.title || tab0.title)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-1 max-w-3xl text-pretty text-sm text-muted",
								children: txt$1(tab0.banner)
							})
						] }), txt$1(data.xlsx_href) ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
							href: txt$1(data.xlsx_href),
							className: "inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Download, { className: "size-4" }), "Tải file Google Sheet"]
						}) : null]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-3 flex flex-wrap gap-2 text-sm",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: cn("rounded-full px-2.5 py-0.5 text-xs font-medium", statusTone(txt$1(tab0.guard))),
								children: ["Guard ", txt$1(tab0.guard)]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "rounded-full bg-inset px-2.5 py-0.5 text-xs",
								children: ["Coverage ST ", txt$1(tab0.search_term_coverage) ? `${Math.round(Number(tab0.search_term_coverage) * 100)}%` : "—"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "rounded-full bg-inset px-2.5 py-0.5 text-xs",
								children: txt$1(tab0.source_flag)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "rounded-full bg-inset px-2.5 py-0.5 text-xs",
								children: [
									"Tab 12: ",
									txt$1(asObj$1(data.tab12).count) || "0",
									" READY"
								]
							})
						]
					}),
					txt$1(tab0.hold_note) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 rounded-md bg-warn-bg px-4 py-3 text-sm text-warn",
						children: txt$1(tab0.hold_note)
					}) : null
				]
			}),
			copyTab ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DayPackOverview, {
				tabs,
				headers: asArr$1(copyTab.headers).map(String),
				rows: asArr$1(copyTab.rows),
				holdCount,
				activeId: overviewId,
				onJump: jumpTo
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
				className: "-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "flex min-w-max gap-px overflow-hidden rounded-lg border border-line bg-line shadow-sheet",
					children: tabs.map((item) => {
						const id = String(item.id);
						const active = id === tabId;
						const isCopy = isCopyTab(item);
						return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => setTabId(id),
							className: cn("h-11 shrink-0 px-3 text-xs font-medium transition-colors duration-150 md:text-sm", active ? isCopy ? "bg-ok text-paper" : "bg-accent text-accent-fg" : "bg-paper text-muted hover:bg-inset hover:text-ink"),
							children: isCopy ? "12 Copy dán" : txt$1(item.short || item.name)
						}, id);
					})
				})
			}),
			current ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display text-lg font-medium tracking-tight",
						children: isCopyTab(current) ? "12 — Copy-Paste Ready" : txt$1(current.title)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 max-w-4xl text-pretty text-sm text-muted",
						children: isCopyTab(current) ? "Mỗi lô = một lần dán đúng cấp. Phủ định: nhóm / chiến dịch / tài khoản — xem badge trước khi dán. Không copy HOLD." : txt$1(current.subtitle)
					}),
					isCopyTab(current) ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-4",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Guide, { guide: asObj$1(current.guide) })
					}),
					asArr$1(current.reconciliation).length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-4 grid grid-cols-2 gap-2 md:grid-cols-5",
						children: asArr$1(current.reconciliation).map((row, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "rounded-md bg-inset px-3 py-2 text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-xs text-muted",
								children: txt$1(row[0])
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-0.5 font-medium tabular-nums",
								children: txt$1(row[1])
							})]
						}, i))
					}) : null,
					current.truncated ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-4 rounded-md bg-inset px-3 py-2 text-sm text-muted",
						children: [
							"Đang hiện một phần sổ cái. Còn ",
							txt$1(current.truncated),
							" dòng — tải file để xem đủ như Google Sheet."
						]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-5",
						children: String(current.kind) === "overview" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OverviewBody, {
							tab: current,
							currency
						}) : isCopyTab(current) ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-col gap-6",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tab12CopyDesk, {
								headers: asArr$1(current.headers).map(String),
								rows: asArr$1(current.rows),
								clientId: String(data.client_id || ""),
								kind: copyKind,
								onKindChange: (next) => {
									setCopyKind(next);
									setOverviewId(next === "all" ? "" : next);
								}
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AuditRows, {
								headers: asArr$1(current.headers).map(String),
								rows: asArr$1(current.rows),
								currency,
								empty: txt$1(current.empty)
							})]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SheetTable, {
							headers: asArr$1(current.headers).map(String),
							rows: asArr$1(current.rows),
							currency,
							empty: txt$1(current.empty)
						})
					}),
					txt$1(workbook.footer) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-5 text-xs text-subtle",
						children: txt$1(workbook.footer)
					}) : null
				]
			}) : null
		]
	});
}
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
var saveYamlAndProbe = createServerFn({ method: "POST" }).validator(asIntake).middleware([authMiddleware]).handler(createSsrRpc("9187819b28feba101ac4ead5e32a9bf655b6954c5125a2904d1bf03fc3065f4e"));
var pullClientKpis = createServerFn({ method: "POST" }).validator(asClientId).middleware([authMiddleware]).handler(createSsrRpc("06c764460f146e053bd20fe5709f40349e907b45113d24667fcf762fea35a2c0"));
function asObj(v) {
	return v && typeof v === "object" ? v : {};
}
function asArr(v) {
	return Array.isArray(v) ? v : [];
}
function txt(v) {
	if (v == null || v === "") return "";
	if (typeof v === "boolean") return v ? "Có" : "Không";
	return String(v);
}
function formatProbed(iso) {
	const raw = String(iso || "");
	const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!match) return raw;
	return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
}
function friendlyConnectError(raw) {
	if (/ENOENT|spawn python/i.test(raw)) return "Không gọi được bộ Python cũ. Đã chuyển sang gọi Google Ads trực tiếp — bấm lại Lưu trên máy rồi thử gọi.";
	return raw;
}
var ACCOUNT_STATUS_VI = {
	ENABLED: "Đang chạy",
	PAUSED: "Tạm dừng",
	CANCELED: "Đã hủy",
	CANCELLED: "Đã hủy",
	REMOVED: "Đã xóa",
	UNKNOWN: "Chưa rõ",
	UNSPECIFIED: "Chưa rõ"
};
var FIELD_ORDER = [
	"target",
	"reason",
	"evidence",
	"source_tab",
	"do_now",
	"risk_if_skipped"
];
var FIELD_LABELS = {
	target: "Đối tượng",
	reason: "Lý do",
	evidence: "Bằng chứng",
	source_tab: "Tab nguồn",
	do_now: "Làm ngay?",
	risk_if_skipped: "Rủi ro nếu bỏ qua"
};
var COMPARE_WINDOW_LABELS = {
	"1": "Hôm qua — 1 ngày hoàn chỉnh",
	"7": "7 ngày hoàn chỉnh",
	"14": "14 ngày hoàn chỉnh",
	"30": "30 ngày hoàn chỉnh",
	"90": "90 ngày hoàn chỉnh"
};
function fieldsOf(item) {
	const nested = asObj(item.fields);
	const labels = {
		...FIELD_LABELS,
		...asObj(item.field_labels)
	};
	return FIELD_ORDER.map((key) => ({
		key,
		label: String(labels[key] || FIELD_LABELS[key]),
		value: nested[key] ?? item[key]
	}));
}
function tone(status) {
	const s = status.toUpperCase();
	if (s.includes("HARD") || s === "STALE" || s === "FAIL" || s.includes("CONFLICT")) return "bg-danger-bg text-danger";
	if (s === "CONNECTED" || s === "PASS" || s === "READY" || s === "CLEAR" || s === "OK" || s.includes("VERIFIED")) return "bg-ok-bg text-ok";
	if (s.includes("HOLD") || s === "CONDITIONAL" || s === "MISSING_CREDENTIALS" || s === "CLOUD_PROJECT_TEST" || s === "API_VERSION_SUNSET" || s === "ACCOUNT_NOT_FOUND" || s.includes("TOKEN") || s.includes("PERMISSION")) return "bg-warn-bg text-warn";
	return "bg-inset text-muted";
}
function StatusChip({ value, label }) {
	if (!value) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", tone(value)),
		children: label || value
	});
}
function FileLink({ href, label }) {
	if (!href) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
		href,
		className: "inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Download, { className: "size-4" }), label]
	});
}
function LiveEmpty({ connect, noun, guard }) {
	if (guard && (guard.final_blocked || String(guard.overall) === "HARD_STOP") && !guard.final_generated) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-xl bg-paper p-5 shadow-sheet",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-center gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-xl font-medium tracking-tight",
					children: noun
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: String(guard.overall || "HARD_STOP") })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-3 rounded-md bg-danger-bg px-4 py-3 text-sm text-danger",
				children: ["Không sinh FINAL. ", txt(guard.coverage_note) || txt(guard.final_block_reason) || txt(guard.verdict)]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 text-sm text-muted",
				children: "Chỉ đề xuất — không tự apply Google Ads. Mở tab Guard để xem từng cổng."
			})
		]
	});
	if (connect && String(connect.adapter) === "live") {
		const pulled = Boolean(connect.pulled_kpis);
		return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "rounded-xl bg-paper p-5 shadow-sheet",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-xl font-medium tracking-tight",
					children: noun
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-ink",
					children: txt(connect.title_vi || connect.status)
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-muted",
					children: txt(connect.detail_vi)
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 text-sm text-muted",
					children: pulled ? "Đã có 5 KPI trên tab Báo cáo. Chưa kéo search term, chưa sinh FINAL." : "Chưa kéo ST / FINAL. 5 KPI chỉ kéo khi phiếu ĐÃ NỐI."
				})
			]
		});
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: `Chưa có ${noun.toLowerCase()} cho khách này.` });
}
function CompareBox({ compare, kpis, currency }) {
	const howto = asArr(compare.compare_howto).map((line) => String(line));
	const windows = asObj(compare.windows);
	const ranges = asObj(compare.window_ranges);
	const keys = [
		"1",
		"7",
		"14",
		"30"
	].filter((key) => asObj(windows[key]).days);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-xl bg-paper p-5 shadow-sheet",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-display text-xl font-medium tracking-tight",
				children: "Đối chiếu Google Ads"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-1 text-sm text-muted",
				children: "Cùng tài khoản, cùng cửa sổ ngày, cùng 5 số bìa. Hôm nay không nằm trong số."
			}),
			howto.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
				className: "mt-3 list-decimal space-y-1 pl-5 text-sm text-ink",
				children: howto.map((line) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: line }, line))
			}) : null,
			keys.map((key) => {
				const w = asObj(windows[key]);
				const rng = asObj(ranges[key]);
				return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-xs font-medium text-muted",
						children: [COMPARE_WINDOW_LABELS[key] || `${key} ngày`, rng.start ? ` · ${txt(rng.start)} → ${txt(rng.end)}` : ""]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KpiGrid, {
						kpis: kpis.length ? kpis : fallbackKpis,
						values: w,
						currency
					})]
				}, key);
			})
		]
	});
}
function ReportPanel({ data, live, clientId, onPulled, viewer }) {
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [formError, setFormError] = (0, import_react.useState)("");
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "Chưa có bìa báo cáo cho khách này." });
	const kpis = asArr(data.kpis);
	const cadences = asObj(data.cadences);
	const daily = asObj(cadences.daily);
	const weekly = asObj(cadences.weekly);
	const primary = asObj(daily.primary);
	const weekPrimary = asObj(weekly.primary);
	const cpa = asObj(data.cpa_note);
	const currency = String(data.currency || "VND");
	const compare = asObj(data.compare);
	const hasCompare = Boolean(compare.windows);
	async function refreshKpis() {
		if (!clientId) return;
		setBusy(true);
		setFormError("");
		try {
			const result = await pullClientKpis({ data: { clientId } });
			if (result.error_vi) setFormError(result.error_vi);
			if (result.ok) onPulled?.({
				report: result.report || null,
				compare: result.compare || null,
				connect: result.connect || null,
				hub: result.hub || null
			});
		} catch {
			setFormError("Không kéo được 5 KPI. Không dán token vào chat.");
		} finally {
			setBusy(false);
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			hasCompare ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CompareBox, {
				compare,
				kpis: kpis.length ? kpis : fallbackKpis,
				currency
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-start justify-between gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-display text-xl font-medium tracking-tight",
							children: "Bìa 5 KPI"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-sm text-muted",
							children: txt(data.banner)
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap gap-2",
							children: [!viewer && live && clientId ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => void refreshKpis(),
								disabled: busy,
								className: "inline-flex h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60",
								children: busy ? "Đang kéo 5 KPI…" : "Kéo lại 5 KPI"
							}) : null, !viewer ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileLink, {
								href: txt(daily.xlsx_href) || void 0,
								label: "Tải Daily"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileLink, {
								href: txt(weekly.xlsx_href) || void 0,
								label: "Tải Weekly"
							})] }) : null]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-muted",
						children: txt(data.conversion_note)
					}),
					formError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-danger",
						children: formError
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-xs font-medium text-muted",
						children: txt(daily.period_label) || "Hàng ngày"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(KpiGrid, {
						kpis,
						values: primary,
						currency
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-5 space-y-2 text-sm text-ink",
						children: asArr(daily.narrative).map((line) => String(line)).slice(0, 5).map((line) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: line }, line))
					}),
					cpa.google_7d != null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-4 rounded-md bg-inset px-3 py-2 text-sm text-muted",
						children: [
							"Chi/conv Google ",
							money(Number(cpa.google_7d), currency),
							" — không phải Qualified Lead.",
							cpa.sale_7d != null ? ` Chi/lead sale xác nhận ${money(Number(cpa.sale_7d), currency)}. Không trộn.` : ""
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display text-lg font-medium tracking-tight",
						children: "Tuần — cùng 5 KPI"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: txt(weekly.period_label)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(KpiGrid, {
						kpis,
						values: weekPrimary,
						currency
					})
				]
			})
		]
	});
}
function KpiGrid({ kpis, values, currency }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "mt-4 grid grid-cols-2 gap-3 md:grid-cols-5",
		children: kpis.map((k) => {
			const raw = values[k.id];
			const empty = raw == null || raw === "";
			let shown = "—";
			if (!empty) {
				if (k.id === "cost" || k.id === "cpc") shown = money(Number(raw), currency);
				else if (k.id === "conversions") shown = num(Number(raw), 2);
				else shown = num(Number(raw), 0);
			}
			return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-md bg-inset px-3 py-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "text-xs text-muted",
					children: k.label
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-1 text-lg font-medium tabular-nums",
					children: shown
				})]
			}, k.id);
		})
	});
}
function AlertsPanel({ data }) {
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "Chưa có cảnh báo Guard." });
	const alerts = asArr(data.alerts);
	const journal = asArr(data.journal);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "rounded-xl bg-paper p-5 shadow-sheet",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-xl font-medium tracking-tight",
					children: "Cảnh báo Guard"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-1 text-sm text-muted",
					children: [txt(data.overall_label), ". Stale / conv = 0 / coverage — không gồm ngân sách 1 ngày."]
				}),
				alerts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-4 rounded-md bg-ok-bg px-4 py-3 text-sm text-ok",
					children: "Không có phiếu Guard trên khách này."
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "mt-4 space-y-3",
					children: alerts.map((a, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "rounded-md bg-danger-bg px-4 py-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "font-medium",
							children: txt(a.title)
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-sm",
							children: txt(a.message)
						})]
					}, txt(a.code) || i))
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "rounded-xl bg-paper p-5 shadow-sheet",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "font-display text-lg font-medium tracking-tight",
					children: "Nhật ký xuất"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-muted",
					children: "Chỉ file của khách đang chọn. Chọn A không thấy số B."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "mt-3 divide-y divide-line text-sm",
					children: journal.map((row, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex flex-wrap justify-between gap-2 py-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
							txt(row.artifact),
							" · ",
							txt(row.filename)
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-muted",
							children: txt(row.exported_at)
						})]
					}, i))
				})
			]
		})]
	});
}
function GuardPanel({ data }) {
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "Chưa có Measurement Guard." });
	const checks = asArr(data.checks);
	const cpa = asObj(data.cpa);
	const currency = String(data.currency || cpa.currency || "VND");
	const blocked = Boolean(data.large_actions_blocked);
	const classified = Number(data.classified_search_terms || 0);
	const total = Number(data.total_search_terms || 0);
	const rows = Number(data.search_term_rows || 0);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-xl bg-paper p-5 shadow-sheet",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-center gap-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display text-xl font-medium tracking-tight",
						children: "Measurement Guard"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: txt(data.overall) }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: txt(data.source_flag) })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-1 text-sm text-muted",
				children: txt(data.overall_label)
			}),
			blocked ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-3 rounded-md bg-danger-bg px-4 py-3 text-sm text-danger",
				children: ["Việc lớn bị chặn. ", txt(data.coverage_note) || txt(data.verdict)]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 rounded-md bg-ok-bg px-4 py-3 text-sm text-ok",
				children: txt(data.verdict)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-4 grid grid-cols-2 gap-3 md:grid-cols-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-md bg-inset px-3 py-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-xs text-muted",
								children: "Coverage ST"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mt-1 text-lg font-medium tabular-nums",
								children: pct(Number(data.search_term_coverage || 0))
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "text-xs text-muted",
								children: [
									classified,
									"/",
									total,
									" cụm",
									rows && rows !== total ? ` · ${rows} dòng` : ""
								]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-md bg-inset px-3 py-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-xs text-muted",
								children: "CPA Google 7N"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mt-1 text-lg font-medium tabular-nums",
								children: cpa.google_7d == null ? "—" : money(Number(cpa.google_7d), currency)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-xs text-muted",
								children: "Không phải Qualified Lead"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-md bg-inset px-3 py-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-xs text-muted",
								children: "CPA Sale 7N"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mt-1 text-lg font-medium tabular-nums",
								children: cpa.sale_7d == null ? "Chưa có" : money(Number(cpa.sale_7d), currency)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-xs text-muted",
								children: "Tách khỏi CPA Google"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-md bg-inset px-3 py-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-xs text-muted",
								children: "FINAL"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mt-1 text-lg font-medium",
								children: data.final_blocked ? "Không sinh" : "Chỉ đề xuất"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-xs text-muted",
								children: "Không apply Google Ads"
							})
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-4 space-y-2",
				children: checks.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "rounded-md bg-inset px-3 py-3 text-sm",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-start justify-between gap-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-medium",
								children: txt(c.label)
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: txt(c.status) })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-muted",
							children: txt(c.detail)
						}),
						c.blocks_large_actions && c.status !== "PASS" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-xs text-danger",
							children: "Chặn việc lớn"
						}) : null
					]
				}, txt(c.name)))
			})
		]
	});
}
function HubPanel({ data }) {
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "Chưa có Data Hub." });
	const windows = asObj(data.windows);
	const kpis = asArr(data.kpis);
	const currency = String(data.currency || "VND");
	const keys = [
		"1",
		"7",
		"14",
		"30",
		"90"
	].filter((key) => asObj(windows[key]).days);
	const opt = asObj(data.opt_sources);
	const tables = asArr(opt.tables);
	const preview = asArr(opt.search_term_preview);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "rounded-xl bg-paper p-5 shadow-sheet",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-wrap items-start justify-between gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display text-xl font-medium tracking-tight",
						children: "Nguồn tối ưu Drive"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-1 text-sm text-muted",
						children: [
							"Folder ",
							txt(opt.folder_name) || "chưa gắn",
							" · ",
							txt(opt.dialect) || "ops_drive_v1"
						]
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, {
						value: txt(opt.flag),
						label: txt(opt.flag) || "Chưa kéo"
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-2 text-sm text-muted",
					children: [
						txt(opt.rule) || "Lệch cột = SOURCE-CONFLICT — không đoán, không trộn vào 5 KPI.",
						" Chỉ đề xuất. Coverage ST ",
						pct(Number(opt.search_term_coverage || 0)),
						" — chưa 100% thì không việc lớn."
					]
				}),
				tables.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-4 text-sm text-muted",
					children: "Chưa gắn ST / phủ định / RSA cho khách này."
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "mt-4 space-y-2",
					children: tables.map((table) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "rounded-md bg-inset px-3 py-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap items-center justify-between gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "font-medium",
									children: txt(table.label || table.id)
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: txt(table.flag) })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "mt-1 text-sm text-muted",
								children: [
									txt(table.rows),
									" dòng",
									txt(table.notes) ? ` · ${txt(table.notes)}` : ""
								]
							}),
							asArr(table.missing_columns).length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "mt-1 text-sm text-danger",
								children: ["Thiếu cột: ", asArr(table.missing_columns).map(txt).join(", ")]
							})
						]
					}, txt(table.id)))
				}),
				preview.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs font-medium uppercase tracking-wide text-subtle",
						children: "Cụm từ (xem trước)"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-2 space-y-1.5 text-sm",
						children: preview.map((row, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "flex flex-wrap gap-x-2",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "font-medium",
									children: txt(row.query)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-muted",
									children: txt(row.campaign_name)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-subtle",
									children: txt(row.label)
								})
							]
						}, `${txt(row.query)}-${i}`))
					})]
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "rounded-xl bg-paper p-5 shadow-sheet",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-xl font-medium tracking-tight",
					children: "Data Hub · 5 KPI"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-1 text-sm text-muted",
					children: [
						txt(data.day_count),
						" ngày · ",
						txt(data.date_start),
						" → ",
						txt(data.data_through),
						" · 5 KPI",
						" ",
						txt(data.adapter)
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-1 text-sm text-muted",
					children: "5 KPI kho — không trộn All conversions. Không trộn nguồn Drive."
				}),
				keys.map((key) => {
					const w = asObj(windows[key]);
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-4",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs font-medium text-muted",
							children: COMPARE_WINDOW_LABELS[key] || `${key} ngày`
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(KpiGrid, {
							kpis: kpis.length ? kpis : fallbackKpis,
							values: w,
							currency
						})]
					}, key);
				})
			]
		})]
	});
}
var fallbackKpis = [
	{
		id: "cost",
		label: "Chi tiêu"
	},
	{
		id: "impressions",
		label: "Hiển thị"
	},
	{
		id: "clicks",
		label: "Lượt nhấp"
	},
	{
		id: "conversions",
		label: "Chuyển đổi"
	},
	{
		id: "cpc",
		label: "CPC"
	}
];
function ProposalsPanel({ data }) {
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "Chưa có máy đề xuất." });
	const items = asArr(data.proposals).length ? asArr(data.proposals) : asArr(data.ready);
	const ready = items.filter((p) => txt(p.status) === "READY");
	const largeReady = ready.filter((p) => p.is_large);
	const smallReady = ready.filter((p) => !p.is_large);
	const conditional = items.filter((p) => txt(p.status) === "CONDITIONAL");
	const holds = items.filter((p) => txt(p.kind) === "hold");
	const coverage = Number(asObj(data.guard).search_term_coverage ?? data.search_term_coverage ?? 0);
	const classified = Number(asObj(data.guard).classified_search_terms ?? 0);
	const total = Number(asObj(data.guard).total_search_terms ?? 0);
	const finalBlocked = Boolean(data.final_blocked);
	const guardOverall = txt(asObj(data.guard).overall);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-start justify-between gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-display text-xl font-medium tracking-tight",
							children: "Máy đề xuất"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-sm text-muted",
							children: "Chỉ đề xuất — không tự apply Google Ads. CPA Google không phải Qualified Lead."
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap gap-2",
							children: [guardOverall ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: guardOverall }) : null, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: "CHỈ ĐỀ XUẤT" })]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-4 grid grid-cols-2 gap-3 md:grid-cols-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-md bg-inset px-3 py-3",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-xs text-muted",
										children: "Coverage ST"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "mt-1 text-lg font-medium tabular-nums",
										children: pct(coverage)
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "text-xs text-muted",
										children: [
											classified,
											"/",
											total || "—",
											" cụm đã phân loại"
										]
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-md bg-inset px-3 py-3",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-xs text-muted",
										children: "Việc lớn READY"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "mt-1 text-lg font-medium tabular-nums",
										children: largeReady.length
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-xs text-muted",
										children: "Exact / phủ định / shield"
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-md bg-inset px-3 py-3",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-xs text-muted",
										children: "QA nhỏ READY"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "mt-1 text-lg font-medium tabular-nums",
										children: smallReady.length
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-xs text-muted",
										children: "Không dựa search term"
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-md bg-inset px-3 py-3",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-xs text-muted",
										children: "FINAL"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "mt-1 text-lg font-medium",
										children: finalBlocked ? "Không sinh" : "Chỉ đề xuất"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-xs text-muted",
										children: "Không nút Apply Ads"
									})
								]
							})
						]
					}),
					finalBlocked || txt(data.verdict) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: `mt-4 rounded-md px-4 py-3 text-sm ${finalBlocked ? "bg-danger-bg text-danger" : "bg-ok-bg text-ok"}`,
						children: txt(data.coverage_note) || txt(data.final_block_reason) || txt(data.verdict)
					}) : null
				]
			}),
			holds.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display text-lg font-medium tracking-tight",
						children: "Cổng đang chặn"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: "Mỗi việc đủ 6 trường. Không copy HOLD / HARD_STOP vào Google Ads."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-4 space-y-3",
						children: holds.map((p, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "rounded-md bg-inset px-4 py-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap items-center gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "font-medium",
									children: txt(p.kind_label || p.kind)
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: txt(p.status) })]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SixFields, { item: p })]
						}, `hold-${i}`))
					})
				]
			}),
			smallReady.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display text-lg font-medium tracking-tight",
						children: "Việc nhỏ READY"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-1 text-sm text-muted",
						children: ["QA / gỡ whitelist — không phải việc lớn dựa trên ST.", finalBlocked ? " Coverage chưa 100% thì không đưa vào FINAL." : " Copy tay — AdsOps không tự apply."]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-4 space-y-3",
						children: smallReady.map((p, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "rounded-md bg-inset px-4 py-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap items-center gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "font-medium",
									children: txt(p.kind_label || p.kind)
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: txt(p.status) })]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SixFields, { item: p })]
						}, `small-${i}`))
					})
				]
			}),
			largeReady.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display text-lg font-medium tracking-tight",
						children: "Việc lớn READY"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: "Copy tay. AdsOps không tự apply."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-4 space-y-3",
						children: largeReady.map((p, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "rounded-md bg-inset px-4 py-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap items-center gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "font-medium",
									children: txt(p.kind_label || p.kind)
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: txt(p.status) })]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SixFields, { item: p })]
						}, `large-${i}`))
					})
				]
			}),
			conditional.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display text-lg font-medium tracking-tight",
						children: "Cần duyệt"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: "CONDITIONAL — trưởng phòng Ads duyệt. Không vào Tab 12."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-4 space-y-3",
						children: conditional.map((p, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "rounded-md bg-inset px-4 py-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap items-center gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "font-medium",
									children: txt(p.kind_label || p.kind)
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: txt(p.status) })]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SixFields, { item: p })]
						}, `cond-${i}`))
					})
				]
			}),
			items.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "rounded-md bg-warn-bg px-4 py-3 text-sm text-warn",
					children: "Không có việc READY. Guard đang chặn hoặc nguồn không đủ."
				})
			})
		]
	});
}
function FinalPanel({ data, connect, guard }) {
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LiveEmpty, {
		connect: connect || null,
		noun: "Gói FINAL",
		guard
	});
	if (data.workbook) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FinalWorkbook, { data });
	const tab0 = asObj(data.tab0);
	const tab12 = asObj(data.tab12);
	const top5 = asArr(tab0.top5);
	const rows = asArr(tab12.rows);
	const windows = asObj(tab0.windows);
	const currency = String(data.currency || "VND");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-start justify-between gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-display text-xl font-medium tracking-tight",
							children: "Gói FINAL · Tab 0"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-sm text-muted",
							children: txt(tab0.banner || data.banner)
						})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FileLink, {
							href: txt(data.xlsx_href) || void 0,
							label: "Tải file FINAL"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-3 flex flex-wrap gap-2 text-sm",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: `Guard ${txt(tab0.guard || "")}` }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "rounded-full bg-inset px-2.5 py-0.5 text-xs",
								children: ["Coverage ST ", pct(Number(tab0.search_term_coverage || 0))]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "rounded-full bg-inset px-2.5 py-0.5 text-xs",
								children: txt(tab0.source_flag)
							})
						]
					}),
					txt(tab0.hold_note) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 rounded-md bg-warn-bg px-4 py-3 text-sm text-warn",
						children: txt(tab0.hold_note)
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-4 grid grid-cols-1 gap-3 md:grid-cols-3",
						children: [
							"7",
							"14",
							"30"
						].map((key) => {
							const w = asObj(windows[key]);
							if (!w.days) return null;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "rounded-md bg-inset px-3 py-3 text-sm",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
										className: "text-xs text-muted",
										children: [key, " ngày"]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "mt-1 font-medium tabular-nums",
										children: money(Number(w.cost || 0), currency)
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
										className: "text-muted",
										children: [
											num(Number(w.clicks || 0)),
											" click · ",
											num(Number(w.conversions || 0), 2),
											" conv"
										]
									})
								]
							}, key);
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-3 text-sm text-muted",
						children: [
							"CPA Google ",
							money(Number(tab0.cpa_google_7d), currency),
							" ≠ Qualified Lead",
							tab0.cpa_sale_7d != null ? ` · CPA Sale ${money(Number(tab0.cpa_sale_7d), currency)}` : "",
							"."
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display text-lg font-medium tracking-tight",
						children: "5 việc — đủ 6 trường"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
						className: "mt-3 space-y-3",
						children: top5.map((job) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "rounded-md bg-inset px-4 py-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap items-center gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "font-medium",
									children: [
										txt(job.index),
										". ",
										txt(job.kind_label || job.kind)
									]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { value: txt(job.status) })]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SixFields, { item: job })]
						}, txt(job.index)))
					}),
					top5.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm text-muted",
						children: "Không có việc trên Tab 0 — Guard đang chặn."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper p-5 shadow-sheet",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display text-lg font-medium tracking-tight",
						children: "Tab 12 — copy theo nhóm quảng cáo"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: txt(tab12.banner)
					}),
					rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-4 rounded-md bg-warn-bg px-4 py-3 text-sm text-warn",
						children: "Tab 12 trống. Không copy HOLD / HARD_STOP vào Google Ads."
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-4",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tab12CopyDesk, {
							clientId: txt(data.client_id),
							headers: [
								"LOẠI HÀNH ĐỘNG",
								"Campaign",
								"Ad Group nguồn / nơi áp dụng",
								"Từ khóa / Negative / Asset",
								"Match",
								"CÚ PHÁP COPY",
								"DÁN VÀO"
							],
							rows: rows.map((row) => {
								const term = txt(row.criterion_or_keyword);
								const match = txt(row.match);
								const ml = match.toLowerCase();
								const syntax = ml.includes("chính xác") || ml === "exact" ? `[${term}]` : ml.includes("cụm") || ml === "phrase" ? `"${term}"` : term;
								return [
									txt(row.action),
									txt(row.campaign),
									txt(row.ad_group),
									term,
									match,
									syntax,
									txt(row.note)
								];
							})
						})
					})
				]
			})
		]
	});
}
function SixFields({ item }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", {
		className: "mt-2 grid gap-2 text-sm md:grid-cols-2",
		children: fieldsOf(item).map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
			className: "text-xs text-muted",
			children: f.label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
			className: "mt-0.5 text-pretty",
			children: txt(f.value) || "—"
		})] }, f.key))
	});
}
function SopPanel({ data }) {
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "Chưa có SOP." });
	const sections = asArr(data.sections);
	const forbid = asArr(data.forbid).map(String);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-xl bg-paper p-5 shadow-sheet",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-display text-xl font-medium tracking-tight",
				children: txt(data.title)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-1 text-sm text-muted",
				children: txt(data.lead)
			}),
			forbid.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-4 list-disc space-y-1 pl-5 text-sm",
				children: forbid.map((line) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: line }, line))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-5 space-y-5",
				children: sections.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "font-medium",
					children: txt(s.title)
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
					className: "mt-2 whitespace-pre-wrap font-sans text-sm text-muted",
					children: txt(s.body)
				})] }, txt(s.id)))
			})
		]
	});
}
function ConnectPanel({ data, clientId, live, onConnectResult, onKpiPulled }) {
	const [fileName, setFileName] = (0, import_react.useState)("");
	const [yamlText, setYamlText] = (0, import_react.useState)("");
	const [oauthClientId, setOauthClientId] = (0, import_react.useState)("");
	const [oauthClientSecret, setOauthClientSecret] = (0, import_react.useState)("");
	const [refreshToken, setRefreshToken] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(null);
	const [formError, setFormError] = (0, import_react.useState)("");
	const [dragOver, setDragOver] = (0, import_react.useState)(false);
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, { children: "Chưa có thông tin kết nối." });
	const checks = asArr(data.checklist);
	const status = String(data.status || "");
	const statusVi = {
		CONNECTED: "ĐÃ NỐI",
		MISSING_CREDENTIALS: "CHƯA CÓ QUYỀN",
		FIXTURE: "KHÁCH GIẢ",
		PERMISSION_DENIED: "BỊ TỪ CHỐI QUYỀN",
		TOKEN_EXPIRED: "TOKEN HẾT HẠN",
		CLOUD_PROJECT_TEST: "PROJECT CLOUD CHƯA ĐỦ CẤP",
		DEVELOPER_TOKEN_BLOCKED: "TOKEN NHÀ PHÁT TRIỂN BỊ CHẶN",
		API_VERSION_SUNSET: "BẢN API ĐÃ TẮT",
		ACCOUNT_NOT_FOUND: "KHÔNG TÌM THẤY TÀI KHOẢN"
	}[status] || status;
	const yamlPresent = Boolean(data.yaml_file_present);
	const probed = formatProbed(data.probed_at);
	const showIntake = Boolean(live && clientId);
	const connected = status === "CONNECTED";
	const pulledKpis = Boolean(data.pulled_kpis);
	const hasIntake = Boolean(yamlText.trim() || oauthClientId.trim() || oauthClientSecret.trim() || refreshToken.trim());
	const mccRows = asArr(data.mcc_accounts);
	const mccAds = mccRows.filter((a) => !a.is_manager);
	function clearSecrets() {
		setYamlText("");
		setFileName("");
		setOauthClientId("");
		setOauthClientSecret("");
		setRefreshToken("");
	}
	async function run(save) {
		if (!clientId) return;
		if (save && !hasIntake) {
			setFormError("Kéo file yaml hoặc điền 3 ô OAuth trước khi lưu. Không dán token vào chat.");
			return;
		}
		setBusy(save ? "save" : "probe");
		setFormError("");
		try {
			const result = await saveYamlAndProbe({ data: {
				clientId,
				yamlText: save ? yamlText : "",
				developerToken: "",
				oauthClientId: save ? oauthClientId : "",
				oauthClientSecret: save ? oauthClientSecret : "",
				refreshToken: save ? refreshToken : "",
				save
			} });
			if (result.error_vi) setFormError(friendlyConnectError(result.error_vi));
			if (result.connect) onConnectResult?.(result.connect);
			if (save && result.install?.ok) clearSecrets();
		} catch {
			setFormError("Không thử được. Token không hiện ra đây — thử lại trên màn này, đừng dán chat.");
		} finally {
			setBusy(null);
		}
	}
	async function runKpis() {
		if (!clientId) return;
		setBusy("kpi");
		setFormError("");
		try {
			const result = await pullClientKpis({ data: { clientId } });
			if (result.error_vi) setFormError(result.error_vi);
			if (result.connect) onConnectResult?.(result.connect);
			if (result.ok) onKpiPulled?.({
				report: result.report || null,
				compare: result.compare || null,
				connect: result.connect || null,
				hub: result.hub || null
			});
		} catch {
			setFormError("Không kéo được 5 KPI. Không dán token vào chat.");
		} finally {
			setBusy(null);
		}
	}
	function acceptYaml(file) {
		if (!file) return;
		const name = file.name || "google-ads.yaml";
		if (!/\.(ya?ml)$/i.test(name) && file.type && !/yaml|text\/plain/i.test(file.type)) {
			setFormError("Chỉ nhận file .yaml / .yml. Không dán token vào chat.");
			return;
		}
		setFormError("");
		setFileName(name);
		const reader = new FileReader();
		reader.onload = () => {
			setYamlText(typeof reader.result === "string" ? reader.result : "");
		};
		reader.readAsText(file);
	}
	function onDragOverZone(e) {
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
		setDragOver(true);
	}
	function onDragLeaveZone(e) {
		e.preventDefault();
		if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
	}
	function onDropZone(e) {
		e.preventDefault();
		e.stopPropagation();
		setDragOver(false);
		acceptYaml(e.dataTransfer.files?.[0]);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-xl bg-paper p-5 shadow-sheet",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex flex-wrap items-center gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-xl font-medium tracking-tight",
					children: "Kết nối Ads"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, {
					value: status,
					label: statusVi
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm",
				children: txt(data.title_vi || data.status)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-1 text-sm text-muted",
				children: txt(data.detail_vi)
			}),
			data.customer_id_dashed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-3 text-sm tabular-nums",
				children: [
					"Customer ID ",
					txt(data.customer_id_dashed),
					data.mcc_id_dashed ? ` · MCC ${txt(data.mcc_id_dashed)}` : "",
					data.mcc_display_name ? ` · ${txt(data.mcc_display_name)}` : ""
				]
			}) : null,
			mccRows.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-4 overflow-x-auto",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mb-2 text-sm",
					children: [
						"MCC ",
						txt(data.mcc_display_name) || "Fago Agency",
						" ",
						txt(data.mcc_id_dashed),
						": ",
						mccAds.length,
						" tài khoản quảng cáo",
						data.roster_complete ? " — đã kéo từ MCC." : " — danh sách chưa đủ, không đoán tên."
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
					className: "w-full min-w-[28rem] text-left text-sm",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
						className: "border-b border-line text-xs text-subtle",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "py-2 pr-3 font-medium",
								children: "Tài khoản"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "py-2 pr-3 font-medium",
								children: "Customer ID"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "py-2 pr-3 font-medium",
								children: "Loại"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
								className: "py-2 font-medium",
								children: "Trạng thái"
							})
						]
					}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: mccRows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
						className: "border-b border-line",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "py-2 pr-3",
								children: txt(row.display_name || row.account_name)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "py-2 pr-3 tabular-nums",
								children: txt(row.customer_id_dashed)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "py-2 pr-3",
								children: row.is_manager ? "MCC" : "QC"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
								className: "py-2",
								children: ACCOUNT_STATUS_VI[String(row.status || "").toUpperCase()] || txt(row.status) || "Chưa rõ"
							})
						]
					}, txt(row.client_id) || txt(row.customer_id))) })]
				})]
			}) : data.mcc_id_dashed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-2 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn",
				children: [
					"MCC ",
					txt(data.mcc_display_name) || "Fago Agency",
					" ",
					txt(data.mcc_id_dashed),
					": lần thử API thấy ",
					txt(data.accessible_count) || "?",
					" tài khoản truy cập được. Chỉ hiện tài khoản đã có customer ID xác nhận. Không đoán CID còn lại. Điền 3 ô OAuth rồi bấm Lưu trên máy rồi thử gọi — không dán token vào chat."
				]
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
				className: "mt-3 space-y-1 text-sm",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
						"File cấu hình trên máy:",
						" ",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: yamlPresent ? "text-ok" : "text-warn",
							children: yamlPresent ? "có" : "chưa có"
						}),
						yamlPresent ? " (không hiện nội dung)" : ""
					] }),
					probed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "text-muted",
						children: ["Lần thử gần nhất: ", probed]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "text-muted",
						children: [
							"5 KPI: ",
							pulledKpis ? "đã kéo" : "chưa kéo",
							" · Search term: chưa kéo"
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: txt(data.next_step_vi)
			}),
			connected ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-3 rounded-md bg-ok-bg px-3 py-2 text-sm text-ok",
				children: ["Phiếu ghi ĐÃ NỐI. ", pulledKpis ? "Đã kéo 5 KPI — mở tab Báo cáo để đối chiếu UI." : "Có thể kéo 5 KPI để đối chiếu. Chưa kéo search term."]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn",
				children: "Chưa ĐÃ NỐI — không đối chiếu 5 KPI, không kéo search term, không sinh FINAL."
			}),
			connected && live && clientId ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				disabled: busy !== null,
				onClick: () => void runKpis(),
				className: "mt-4 h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60",
				children: busy === "kpi" ? "Đang kéo 5 KPI…" : pulledKpis ? "Kéo lại 5 KPI" : "Kéo 5 KPI để đối chiếu"
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-4 space-y-2",
				children: checks.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "flex items-center justify-between gap-3 rounded-md bg-inset px-3 py-2 text-sm",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: txt(c.label_vi) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: c.present ? "text-ok" : c.required === false ? "text-subtle" : "font-medium text-warn",
						children: txt(c.state_vi) || (c.present ? "Có" : c.required === false ? "Không bắt buộc" : "Thiếu")
					})]
				}, txt(c.id)))
			}),
			showIntake ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-5 border-t border-line pt-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-medium",
						children: "Đặt quyền trên máy này"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-1 text-sm text-muted",
						children: "Kéo file google-ads.yaml vào ô, hoặc điền 3 ô OAuth. Không dán token vào chat. Google đã bỏ token nhà phát triển (9/2026) — quyền API theo Google Cloud project của OAuth. Không còn gọi Python trên máy này."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						onDragEnter: onDragOverZone,
						onDragOver: onDragOverZone,
						onDragLeave: onDragLeaveZone,
						onDrop: onDropZone,
						className: cn("mt-3 rounded-md border border-dashed px-3 py-4 text-center transition-colors duration-150", dragOver ? "border-accent bg-ok-bg" : "border-line-strong bg-inset"),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Upload, {
									className: "size-4 text-muted",
									"aria-hidden": true
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-sm font-medium",
									children: dragOver ? "Thả file yaml vào đây" : "Kéo file yaml vào đây"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-xs text-subtle",
									children: fileName ? `Đã chọn ${fileName} (nội dung ẩn) — bấm Lưu trên máy rồi thử gọi` : "Chỉ nhận .yaml / .yml — không hiện token"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "file",
									accept: ".yaml,.yml,text/yaml,text/plain",
									className: "sr-only",
									onChange: (e) => acceptYaml(e.target.files?.[0])
								})
							]
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-4 text-xs text-subtle",
						children: "Ba ô OAuth bắt buộc nếu không có file yaml (ô mật khẩu, không chat). Token nhà phát triển không còn cần."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-2 grid gap-2 md:grid-cols-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SecretField, {
								label: "OAuth Client ID",
								value: oauthClientId,
								onChange: setOauthClientId
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SecretField, {
								label: "OAuth Client Secret",
								value: oauthClientSecret,
								onChange: setOauthClientSecret
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SecretField, {
								label: "Refresh token",
								value: refreshToken,
								onChange: setRefreshToken
							})
						]
					}),
					formError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm text-danger",
						children: friendlyConnectError(formError)
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-4 flex flex-col gap-2 sm:flex-row",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy !== null || !hasIntake,
							onClick: () => void run(true),
							className: "h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60",
							children: busy === "save" ? "Đang lưu và thử gọi…" : "Lưu trên máy rồi thử gọi"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							disabled: busy !== null,
							onClick: () => void run(false),
							className: "h-11 rounded-md bg-inset px-4 text-sm font-medium text-ink disabled:opacity-60",
							children: busy === "probe" ? "Đang thử gọi…" : "Thử gọi Google Ads"
						})]
					})
				]
			}) : formError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 text-sm text-danger",
				children: friendlyConnectError(formError)
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 text-xs text-subtle",
				children: "Phiên này: kéo 5 KPI để đối chiếu UI · không kéo search term · không sinh FINAL · không apply Ads. Token không dán vào chat."
			})
		]
	});
}
function SecretField({ label, value, onChange }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "flex flex-col gap-1 text-xs font-medium text-muted",
		children: [label, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
			type: "password",
			autoComplete: "off",
			value,
			onChange: (e) => onChange(e.target.value),
			className: "h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink"
		})]
	});
}
function Empty({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
		className: "rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet",
		children
	});
}
var subscribeToNothing = () => () => {};
var noGateSessionOnServer = () => false;
/**
* Auth state components — plain wrappers around `useCurrentUserState()`.
*
* With auth on, visitors are signed out until they authenticate — in the sandbox
* live preview too, which does real sign-in. The shared dev user appears only
* when auth is disabled (`VITE_AUTH_ENABLED=false`, the shipped default).
* While the session is still resolving, gates that care about signed-out state
* render nothing so there's no signed-out flash on hard reload.
*/
/** Where `RedirectToSignIn` sends signed-out visitors. Create this route. */
var SIGN_IN_PATH = "/login";
/**
* Client-side redirect to the sign-in route (TanStack `<Navigate>` — NOT a full
* `window.location` reload). A hard navigation re-bootstraps the SPA and re-runs
* session loading, which feels like a second "Loading…" on /login.
*
* Guard routes by waiting out `isPending` first (see `use-current-user`), then
* render this.
*/
function RedirectToSignIn({ to = SIGN_IN_PATH }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Navigate, { to });
}
/**
* Minimal signed-in identity chip + sign-out. Restyle freely (see the
* `design-ui` skill). Sign-out is only shown when auth is enabled (the
* disabled-auth dev user has nothing to sign out of) and the session is not
* gate-materialized — behind the gate the next request signs the viewer
* straight back in, so a sign-out control there is a broken loop.
*/
function UserButton() {
	const user = useCurrentUser();
	const [signingOut, setSigningOut] = (0, import_react.useState)(false);
	const gateSession = (0, import_react.useSyncExternalStore)(subscribeToNothing, hasGateSessionMarker, noGateSessionOnServer);
	if (!user) return null;
	const label = user.displayName ?? user.primaryEmail ?? "Account";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-center gap-2",
		children: [
			user.profileImageUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
				src: user.profileImageUrl,
				alt: "",
				className: "h-8 w-8 rounded-full object-cover"
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "grid h-8 w-8 place-items-center rounded-full bg-black/10 text-sm font-medium dark:bg-white/20",
				children: label.charAt(0).toUpperCase()
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-sm font-medium",
				children: label
			}),
			!gateSession && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				disabled: signingOut,
				onClick: () => {
					setSigningOut(true);
					signOut().catch(() => setSigningOut(false));
				},
				className: "cursor-pointer text-sm underline-offset-4 opacity-70 hover:underline disabled:cursor-wait disabled:no-underline",
				children: signingOut ? "Signing out…" : "Sign out"
			})
		]
	});
}
var OPS_TABS = [
	{
		id: "final",
		label: "FINAL"
	},
	{
		id: "proposals",
		label: "Đề xuất"
	},
	{
		id: "classify",
		label: "Phân loại ST"
	},
	{
		id: "guard",
		label: "Guard"
	},
	{
		id: "alerts",
		label: "Cảnh báo"
	},
	{
		id: "report",
		label: "Báo cáo"
	},
	{
		id: "hub",
		label: "Data Hub"
	},
	{
		id: "connect",
		label: "Kết nối"
	},
	{
		id: "sop",
		label: "SOP"
	},
	{
		id: "members",
		label: "Người dùng"
	}
];
var GATE_SCENES = [
	{
		id: "",
		label: "Thực tế"
	},
	{
		id: "stale",
		label: "Nguồn cũ"
	},
	{
		id: "coverage",
		label: "Coverage ST"
	},
	{
		id: "fake_cpa",
		label: "CPA ảo"
	},
	{
		id: "source_conflict",
		label: "Lệch cột"
	}
];
var ALERT_SCENES = [
	{
		id: "",
		label: "Thực tế"
	},
	{
		id: "stale",
		label: "Nguồn cũ"
	},
	{
		id: "conv_zero",
		label: "Conv = 0"
	},
	{
		id: "coverage",
		label: "Coverage ST"
	}
];
function accountsFromSnap(snap) {
	const raw = snap.mcc_accounts;
	if (!Array.isArray(raw)) return [];
	return raw.map((row) => {
		const r = row && typeof row === "object" ? row : {};
		return {
			client_id: String(r.client_id || ""),
			display_name: String(r.display_name || r.account_name || ""),
			customer_id_dashed: String(r.customer_id_dashed || ""),
			in_system: r.in_system !== false,
			is_manager: Boolean(r.is_manager),
			status: String(r.status || "")
		};
	}).filter((a) => a.client_id);
}
function AdsOpsApp() {
	const [clients, setClients] = (0, import_react.useState)([]);
	const [mcc, setMcc] = (0, import_react.useState)(null);
	const [clientId, setClientId] = (0, import_react.useState)("");
	const [tab, setTab] = (0, import_react.useState)("final");
	const [access, setAccess] = (0, import_react.useState)(null);
	const [accessError, setAccessError] = (0, import_react.useState)("");
	const [analytics, setAnalytics] = (0, import_react.useState)(null);
	const [pace, setPace] = (0, import_react.useState)(null);
	const [basePack, setBasePack] = (0, import_react.useState)({});
	const [scenePack, setScenePack] = (0, import_react.useState)(null);
	const [scenario, setScenario] = (0, import_react.useState)("");
	const [loading, setLoading] = (0, import_react.useState)(true);
	const [analyticsLoading, setAnalyticsLoading] = (0, import_react.useState)(false);
	const liveConnectRef = (0, import_react.useRef)(null);
	const viewer = access?.role === "sale" || access?.role === "client";
	const shownTab = viewer ? "report" : tab;
	(0, import_react.useEffect)(() => {
		let cancelled = false;
		getWorkspaceDirectory().then((dir) => {
			if (cancelled) return;
			setAccess(dir.access);
			if (dir.access.role === "pending") {
				setClients([]);
				setLoading(false);
				return;
			}
			const rows = dir.clients.map((c) => ({
				client_id: c.client_id,
				display_name: c.display_name,
				customer_id_dashed: c.customer_id_dashed,
				adapter: c.adapter || "live",
				status: c.status
			}));
			setClients(rows);
			if (dir.mcc) setMcc(dir.mcc);
			if (dir.access.role === "sale" || dir.access.role === "client") setTab("report");
			setClientId((cur) => {
				if (cur && rows.some((c) => c.client_id === cur)) return cur;
				return rows[0]?.client_id || "";
			});
			if (!rows.length) setLoading(false);
		}).catch(() => {
			if (!cancelled) setAccessError("Không đọc được quyền. Đăng nhập lại.");
		});
		return () => {
			cancelled = true;
		};
	}, []);
	(0, import_react.useEffect)(() => {
		let cancelled = false;
		if (!access || access.role === "pending") return;
		if (!clientId || !clients.some((c) => c.client_id === clientId)) return;
		setLoading(true);
		setAnalytics(null);
		setPace(null);
		setScenePack(null);
		setScenario("");
		const id = clientId;
		const isViewer = access.role === "sale" || access.role === "client";
		setAnalyticsLoading(!isViewer);
		getWorkspacePack({ data: { clientId: id } }).then((pack) => {
			if (cancelled) return;
			const liveConnect = liveConnectRef.current;
			const connectSnap = liveConnect && String(liveConnect.client_id || "") === id ? liveConnect : pack.connect;
			setBasePack({
				report: pack.report,
				alerts: pack.alerts,
				guard: pack.guard,
				hub: pack.hub,
				proposals: pack.proposals,
				classify: pack.classify,
				final: pack.final,
				connect: connectSnap,
				sop: pack.sop
			});
			if (!isViewer) {
				setAnalytics(pack.analytics || null);
				setPace(pack.pace || null);
			}
		}).catch(() => {
			if (!cancelled) setBasePack({ report: null });
		}).finally(() => {
			if (!cancelled) {
				setLoading(false);
				setAnalyticsLoading(false);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [
		clientId,
		clients,
		access
	]);
	(0, import_react.useEffect)(() => {
		if (!scenario || viewer) {
			setScenePack(null);
			return;
		}
		let cancelled = false;
		getWorkspaceScene({ data: {
			clientId,
			scenario
		} }).then((scene) => {
			if (cancelled) return;
			setScenePack({
				...basePack,
				final: scene.final || basePack.final,
				guard: scene.guard || basePack.guard,
				proposals: scene.proposals || basePack.proposals,
				alerts: scene.alerts || basePack.alerts
			});
		}).catch(() => {
			if (!cancelled) setScenePack(null);
		});
		return () => {
			cancelled = true;
		};
	}, [
		scenario,
		clientId,
		basePack,
		viewer
	]);
	function goTab(next) {
		if (viewer && next !== "report") return;
		if (access?.role !== "ops" && (next === "members" || next === "analytics")) return;
		setTab(next);
		if (!(next === "final" || next === "proposals" || next === "guard" || next === "alerts") || !(next === "alerts" ? ALERT_SCENES : GATE_SCENES).some((s) => s.id === scenario)) setScenario("");
	}
	function applyConnectResult(snap) {
		liveConnectRef.current = snap;
		setBasePack((prev) => ({
			...prev,
			connect: snap
		}));
		const ads = accountsFromSnap(snap).filter((a) => !a.is_manager && a.client_id);
		if (!ads.length) return;
		setClients(ads.map((a) => ({
			client_id: a.client_id,
			display_name: a.display_name,
			adapter: "live",
			status: a.status === "ENABLED" ? "active" : "paused",
			customer_id_dashed: a.customer_id_dashed
		})));
		setMcc({
			mcc_id_dashed: String(snap.mcc_id_dashed || "532-145-0531"),
			mcc_display_name: String(snap.mcc_display_name || "Fago Agency"),
			last_probe_accessible_count: Number(snap.accessible_count || ads.length),
			roster_complete: Boolean(snap.roster_complete),
			note_vi: String(snap.detail_vi || ""),
			accounts: ads
		});
		setClientId((cur) => ads.some((a) => a.client_id === cur) ? cur : ads[0].client_id);
	}
	function applyKpiPack(next) {
		if (next.connect) liveConnectRef.current = next.connect;
		setBasePack((prev) => ({
			...prev,
			report: next.report ? {
				...next.report,
				...next.compare ? { compare: next.compare } : {}
			} : prev.report,
			connect: next.connect || prev.connect,
			hub: next.hub || prev.hub
		}));
		setTab("report");
	}
	const pack = scenePack || basePack;
	const client = clients.find((c) => c.client_id === clientId);
	const firing = pace?.firing || analytics?.budget_pace?.firing;
	const fixture = !viewer && client?.adapter !== "live";
	const scenes = shownTab === "alerts" ? ALERT_SCENES : GATE_SCENES;
	const showScenes = !viewer && !loading && fixture && (shownTab === "final" || shownTab === "proposals" || shownTab === "guard" || shownTab === "alerts");
	const opsTabs = viewer ? OPS_TABS.filter((t) => t.id === "report") : OPS_TABS;
	const roleVi = access?.role === "ops" ? "Vận hành" : access?.role === "sale" ? "Sale" : access?.role === "client" ? "Khách hàng" : "";
	const body = (0, import_react.useMemo)(() => {
		if (accessError) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
			className: "rounded-xl bg-paper px-5 py-10 text-center text-sm text-danger shadow-sheet",
			children: accessError
		});
		if (!access) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "px-1 py-16 text-center text-sm text-muted",
			children: "Đang đọc quyền…"
		});
		if (access.role === "pending") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "rounded-xl bg-paper px-5 py-10 text-center shadow-sheet",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-display text-xl font-medium",
				children: "Chưa được cấp quyền"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-2 text-sm text-muted",
				children: [access.email || "Email này", " chưa được gắn tài khoản. Nhờ vận hành AdsOps cấp quyền khách hàng hoặc sale — chỉ vào chỉ số báo cáo. Không dán token."]
			})]
		});
		if (loading) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "px-1 py-16 text-center text-sm text-muted",
			children: "Đang mở khách…"
		});
		if (shownTab === "analytics") {
			if (analyticsLoading && !analytics) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "px-1 py-16 text-center text-sm text-muted",
				children: "Đang mở Phân tích…"
			});
			if (!analytics || !(analytics.daily?.account || []).length) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet",
				children: [client?.display_name || "Khách này", " chưa có ngày chi tiêu trong 90 ngày Google Ads (tài khoản mới, tạm ngưng, hoặc Google không trả ngày). Không đoán số. Không apply."]
			});
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AnalyticsView, { snap: analytics }, analytics.client_id);
		}
		if (shownTab === "report") {
			if (!pack.report) return viewer ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
				className: "rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet",
				children: "Chưa có chỉ số báo cáo cho tài khoản này. Vận hành kéo 5 KPI rồi khách/sale mới xem được. Không đoán số."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConnectPanel, {
				data: pack.connect,
				clientId,
				live: client?.adapter === "live",
				onConnectResult: applyConnectResult,
				onKpiPulled: (next) => applyKpiPack(next)
			});
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReportPanel, {
				data: pack.report,
				live: client?.adapter === "live",
				clientId,
				viewer,
				onPulled: (next) => applyKpiPack(next)
			});
		}
		if (shownTab === "alerts") {
			if (!pack.alerts) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConnectPanel, {
				data: pack.connect,
				clientId,
				live: client?.adapter === "live",
				onConnectResult: applyConnectResult
			});
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AlertsPanel, { data: pack.alerts });
		}
		if (shownTab === "guard") {
			if (!pack.guard) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConnectPanel, {
				data: pack.connect,
				clientId,
				live: client?.adapter === "live",
				onConnectResult: applyConnectResult
			});
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(GuardPanel, { data: pack.guard });
		}
		if (shownTab === "hub") {
			if (!pack.hub) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConnectPanel, {
				data: pack.connect,
				clientId,
				live: client?.adapter === "live",
				onConnectResult: applyConnectResult,
				onKpiPulled: (next) => applyKpiPack(next)
			});
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HubPanel, { data: pack.hub });
		}
		if (shownTab === "classify") {
			if (!pack.classify) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
				className: "rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet",
				children: "Chưa có bảng phân loại ST cho khách này. Cần nguồn cụm từ (Drive) rồi gắn keep / add_exact / negative / routing / hold."
			});
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ClassifyView, {
				snap: pack.classify,
				onSaved: (next) => setBasePack((prev) => ({
					...prev,
					classify: next
				}))
			}, String(pack.classify.client_id || clientId));
		}
		if (shownTab === "proposals") {
			if (!pack.proposals) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConnectPanel, {
				data: pack.connect,
				clientId,
				live: client?.adapter === "live",
				onConnectResult: applyConnectResult
			});
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProposalsPanel, { data: pack.proposals });
		}
		if (shownTab === "final") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FinalPanel, {
			data: pack.final,
			connect: pack.connect,
			guard: pack.guard
		});
		if (shownTab === "sop") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SopPanel, { data: pack.sop });
		if (shownTab === "members") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MembersPanel, { clients });
		return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConnectPanel, {
			data: pack.connect,
			clientId,
			live: client?.adapter === "live",
			onConnectResult: applyConnectResult,
			onKpiPulled: (next) => applyKpiPack(next)
		});
	}, [
		shownTab,
		analytics,
		analyticsLoading,
		pack,
		loading,
		clientId,
		client,
		access,
		accessError,
		viewer,
		clients
	]);
	const adsCount = mcc?.accounts.filter((a) => !a.is_manager).length ?? mcc?.accounts.length ?? 0;
	const accessible = mcc?.last_probe_accessible_count || adsCount;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "min-h-screen bg-bg text-ink",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
			className: "border-b border-line bg-paper",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 md:flex-row md:items-end md:justify-between md:px-6",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs font-medium uppercase tracking-widest text-subtle",
						children: "AdsOps"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "font-display text-2xl font-medium tracking-tight text-balance",
						children: viewer ? "Báo cáo Google Ads" : "Vận hành Google Ads"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-0.5 max-w-xl text-pretty text-sm text-muted",
						children: viewer ? "Chỉ chỉ số báo cáo. CPA Google không phải Qualified Lead. Không vào FINAL / kết nối / đề xuất." : "Chỉ đề xuất. CPA Google không phải Qualified Lead. MCC Fago Agency — chọn A không thấy số B."
					})
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex min-w-64 flex-col gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center justify-between gap-3 text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-xs font-medium text-muted",
							children: roleVi
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserButton, {})]
					}), access?.role !== "pending" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "flex flex-col gap-1 text-xs font-medium text-muted",
						children: [
							viewer ? "Tài khoản được cấp" : `Tài khoản MCC ${mcc?.mcc_id_dashed || "532-145-0531"}`,
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
								value: clientId,
								onChange: (e) => setClientId(e.target.value),
								className: "h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink",
								children: clients.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", {
									value: c.client_id,
									children: [c.display_name, c.customer_id_dashed && c.display_name !== c.customer_id_dashed ? ` · ${c.customer_id_dashed}` : ""]
								}, c.client_id))
							}),
							mcc && !viewer ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "text-xs font-normal text-subtle",
								children: [
									mcc.mcc_display_name,
									" · ",
									adsCount,
									"/",
									accessible,
									" tài khoản",
									mcc.roster_complete ? " đã kéo từ MCC" : " — chưa kéo đủ danh sách MCC"
								]
							}) : null
						]
					}) : null]
				})]
			}), access?.role !== "pending" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
				className: "mx-auto max-w-screen-2xl px-4 pb-3 md:px-6",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mb-1 text-xs font-medium text-subtle",
						children: viewer ? "Báo cáo" : "Vận hành"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "flex flex-wrap gap-1",
						children: opsTabs.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => goTab(item.id),
							className: cn("h-10 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors duration-150", shownTab === item.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-inset"),
							children: item.label
						}, item.id))
					}),
					!viewer ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mb-1 mt-3 text-xs font-medium text-subtle",
						children: "Phân tích"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						type: "button",
						onClick: () => goTab("analytics"),
						className: cn("relative h-10 rounded-full px-3.5 text-sm font-medium transition-colors duration-150", shownTab === "analytics" ? "bg-accent text-accent-fg" : "text-muted hover:bg-inset"),
						children: ["Phân tích", firing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ml-1.5 inline-block size-1.5 rounded-full bg-danger outline outline-2 outline-paper" }) : null]
					})] }) : null
				]
			}) : null]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
			className: "mx-auto max-w-screen-2xl px-4 py-4 md:px-6",
			children: [
				client && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mb-3 text-xs text-subtle",
					children: [
						client.display_name,
						client.customer_id_dashed && client.display_name !== client.customer_id_dashed ? ` · ${client.customer_id_dashed}` : "",
						!viewer && mcc?.mcc_id_dashed ? ` · MCC ${mcc.mcc_id_dashed}` : "",
						analytics?.timezone || client.timezone ? ` · ${analytics?.timezone || client.timezone}` : "",
						shownTab === "analytics" ? " · lọc ngày → tầng → loại conv → ST/KW · không apply" : viewer ? " · Chỉ 5 KPI báo cáo. CPA Google không phải Qualified Lead." : " · Guard trước FINAL. Coverage ST chưa 100% thì không việc lớn. Phân loại ST trên tab riêng."
					]
				}),
				showScenes && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mb-4 flex flex-wrap gap-1.5",
					children: scenes.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => setScenario(item.id),
						className: cn("h-10 rounded-full px-3.5 text-sm font-medium transition-colors duration-150", scenario === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line"),
						children: item.label
					}, item.id || "live"))
				}),
				body
			]
		})]
	});
}
function Home() {
	const { user, isPending } = useCurrentUserState();
	if (isPending) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "min-h-screen bg-bg px-6 py-16 text-center text-sm text-muted",
		children: "Đang mở phiên…"
	});
	if (!user) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RedirectToSignIn, {});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AdsOpsApp, {});
}
//#endregion
export { Home as component };
