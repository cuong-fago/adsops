import { useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsView } from "@/components/adsops/analytics-view";
import { MetaAnalyticsView } from "@/components/adsops/meta-analytics-view";
import { OpenAIAnalyticsView } from "@/components/adsops/openai-analytics-view";
import { TikTokAnalyticsView } from "@/components/adsops/tiktok-analytics-view";
import { MetaAlertsCard, type MetaFocus } from "@/components/adsops/meta-alerts-card";
import { GoogleTrendAlertsCard, TREND_CARD_ID, setTrendFocus, scrollWhenReady } from "@/components/adsops/google-trend-snapshot-ui";
import { NeedsActionView } from "@/components/adsops/needs-action-view";
import { PacingAlertsCard } from "@/components/adsops/budget-pacing";
import { ClassifyView } from "@/components/adsops/classify-view";
import { ClientPortal } from "@/components/adsops/client-portal";
import { ClientReportsView } from "@/components/adsops/client-reports-view";
import { ManagerView } from "@/components/adsops/manager-view";
import { reportDraftCountFn } from "@/lib/adsops/client-report.functions";
import type { PacePreview } from "@/components/adsops/budget-banner";
import { PermissionsPanel } from "@/components/adsops/permissions-panel";
import {
  AlertsPanel,
  ConnectPanel,
  FinalPanel,
  GuardPanel,
  HubPanel,
  ProposalsPanel,
  ReportPanel,
  SopPanel,
} from "@/components/adsops/side-panels";
import {
  getWorkspaceDirectory,
  getWorkspacePack,
  getWorkspaceScene,
  type AccessSnap,
} from "@/lib/adsops/access.functions";
import { adminUpdateAdAccount, stopViewAs } from "@/lib/adsops/admin.functions";
import { AccountPicker } from "@/components/adsops/account-picker";
import { BrandMark } from "@/components/adsops/brand";
import { NavBar, type NavEntry, type NavItem } from "@/components/adsops/nav-bar";
import { ChangeLogView } from "@/components/adsops/change-log-view";
import { AccountsOverview } from "@/components/adsops/accounts-overview";
import { BUDGET_CARD_ID, BudgetRunwayCard, BudgetStrip } from "@/components/adsops/budget-runway-card";
import { RecheckButton } from "@/components/adsops/recheck-button";
import { OptimizationScoreCard, SCORE_CARD_ID, ScoreStrip } from "@/components/adsops/optimization-score-card";
import type { AnalyticsSnap } from "@/lib/adsops/analytics";
import type { ClassifySnap } from "@/lib/adsops/classify.types";
import { clientSignOut } from "@/lib/adsops/client-auth.functions";
import { pullAnalyticsWarehouseFn, pullDeepChunkFn } from "@/lib/adsops/connect.functions";
import { MODULE_CAPABILITY, ROLE_LABEL_VI, formatSaigon } from "@/lib/adsops/permissions.types";
import { UserButton } from "@/lib/auth/gates";
import { cn } from "@/lib/cn";
import {
  BarChart3, Bell, Gauge, BookOpen, CheckCircle2, Database, FileText, History, LayoutGrid, Lightbulb, ShieldCheck, Tags, Users,
  type LucideIcon,
} from "lucide-react";

const TAB_ICON: Partial<Record<string, LucideIcon>> = {
  overview: LayoutGrid, final: CheckCircle2, proposals: Lightbulb, classify: Tags, guard: ShieldCheck, alerts: Bell,
  report: FileText, hub: Database, sop: BookOpen, members: Users, analytics: BarChart3, changelog: History,
};

type ClientRow = {
  client_id: string;
  display_name: string;
  adapter?: string;
  status?: string;
  timezone?: string;
  currency?: string;
  has_warehouse?: boolean;
  customer_id_dashed?: string;
  alias?: string | null;
};

type MccAccount = {
  client_id: string;
  display_name: string;
  customer_id_dashed?: string;
  in_system?: boolean;
  is_manager?: boolean;
  status?: string;
};

type MccRoster = {
  mcc_id_dashed: string;
  mcc_display_name: string;
  last_probe_accessible_count: number;
  roster_complete: boolean;
  note_vi: string;
  accounts: MccAccount[];
};

type TabId =
  | "final"
  | "proposals"
  | "classify"
  | "guard"
  | "alerts"
  | "report"
  | "hub"
  | "connect"
  | "sop"
  | "analytics"
  | "changelog"
  | "overview"
  | "members"
  | "creports"
  | "manager"
  | "needs";

const OPS_TABS: { id: TabId; label: string }[] = [
  { id: "final", label: "FINAL" },
  { id: "proposals", label: "Đề xuất" },
  { id: "classify", label: "Phân loại ST" },
  { id: "guard", label: "Guard" },
  { id: "alerts", label: "Cảnh báo" },
  { id: "report", label: "Báo cáo" },
  { id: "hub", label: "Data Hub" },
  // "Kết nối" (yaml / OAuth-field panel) is hidden: it does not work on Vercel.
  // Google Ads is connected from Phân quyền → Google Ads API.
  { id: "sop", label: "SOP" },
  { id: "members", label: "Phân quyền" },
];

const GATE_SCENES = [
  { id: "", label: "Thực tế" },
  { id: "stale", label: "Nguồn cũ" },
  { id: "coverage", label: "Coverage ST" },
  { id: "fake_cpa", label: "CPA ảo" },
  { id: "source_conflict", label: "Lệch cột" },
];

const ALERT_SCENES = [
  { id: "", label: "Thực tế" },
  { id: "stale", label: "Nguồn cũ" },
  { id: "conv_zero", label: "Conv = 0" },
  { id: "coverage", label: "Coverage ST" },
];

/**
 * Pack key whose content a Vận hành tab shows. The tab is in the nav only once that key is
 * loaded AND non-null for the selected account (null = the tab would show only the empty
 * connection panel / a placeholder). Tabs not listed (Cảnh báo, Phân quyền, Phân tích,
 * Nhật ký tối ưu) follow their permission rules only.
 */
const TAB_DATA_KEY: Partial<Record<TabId, string>> = {
  final: "final",
  proposals: "proposals",
  classify: "classify",
  guard: "guard",
  report: "report",
  hub: "hub",
  sop: "sop",
};

/** Pack keys needed before a tab can render (undefined = not loaded yet). */
const TAB_MODULES: Record<TabId, string[]> = {
  final: ["final", "connect", "guard"],
  proposals: ["proposals", "connect"],
  classify: ["classify"],
  guard: ["guard", "connect"],
  alerts: ["alerts", "connect"],
  report: ["report", "connect"],
  hub: ["hub", "connect"],
  connect: ["connect"],
  sop: ["sop"],
  analytics: ["analytics", "pace"],
  changelog: [],
  overview: [],
  members: [],
  creports: [],
  manager: [],
  needs: [],
};

const PACK_SLICE_KEYS = [
  "report",
  "alerts",
  "guard",
  "hub",
  "proposals",
  "classify",
  "final",
  "connect",
  "sop",
] as const;

/** UI mirror of the server permission matrix (cosmetic; the server enforces). */
function tabAllowed(access: AccessSnap | null, id: TabId): boolean {
  if (!access || access.role === "pending") return false;
  const caps = access.caps;
  // Phân quyền: effective admin (never while viewing-as), or Trưởng phòng Ads for its grant
  // request form. Sale / người tối ưu / customers: hidden.
  if (id === "members") return Boolean((caps.grant && !access.read_only) || (access.role === "head_ads" && caps.requestGrant));
  if (id === "analytics") return caps.analytics;
  // Server functions enforce the same capability (admin / head_ads only).
  if (id === "changelog") return Boolean(caps.changeLog);
  // Every staff role (view-as included); the server checks again. Never customer roles.
  if (id === "overview") return access.kind === "staff";
  // Cần xử lý (3 tháng): every staff role (Sale: assigned accounts only); server checks again.
  if (id === "needs") return access.kind === "staff";
  // Báo cáo khách hàng: Admin, Trưởng phòng Ads, người tối ưu (server checks again).
  // Bảng điều hành: Admin and Trưởng phòng Ads only (server checks again).
  if (id === "manager") return access.kind === "staff" && (access.role === "admin" || access.role === "head_ads");
  if (id === "creports") return access.kind === "staff" && (access.role === "admin" || access.role === "head_ads" || access.role === "optimizer");
  // Old connect panel: never shown, so a stale "connect" tab falls back like any disallowed tab.
  if (id === "connect") return false;
  const cap = MODULE_CAPABILITY[id];
  return cap ? Boolean(caps[cap]) : false;
}

/** Only modules the role may load (the server filters again). */
function allowedModules(access: AccessSnap, modules: string[]): string[] {
  return modules.filter((m) => {
    const cap = MODULE_CAPABILITY[m];
    return cap ? Boolean(access.caps[cap]) : false;
  });
}

function accountsFromSnap(snap: Record<string, unknown>): MccAccount[] {
  const raw = snap.mcc_accounts;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const r = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return {
        client_id: String(r.client_id || ""),
        display_name: String(r.display_name || r.account_name || ""),
        customer_id_dashed: String(r.customer_id_dashed || ""),
        in_system: r.in_system !== false,
        is_manager: Boolean(r.is_manager),
        status: String(r.status || ""),
      };
    })
    .filter((a) => a.client_id);
}

type Freshness = { as_of: string | null; data_through: string | null };

function freshnessLine(f: Freshness): string {
  if (f.as_of) {
    const t = formatSaigon(f.as_of);
    if (t) {
      const [hm, day] = t.split(" ");
      return `Số liệu Google Ads cập nhật đến ${hm} ngày ${day} (giờ Việt Nam)`;
    }
  }
  if (f.data_through) {
    const [y, m, d] = f.data_through.split("-");
    return `Số liệu Google Ads đến hết ngày ${d}/${m}/${y}`;
  }
  return "";
}

export function AdsOpsApp() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [mcc, setMcc] = useState<MccRoster | null>(null);
  const [clientId, setClientId] = useState("");
  /** Latest selected account, for async callbacks (ignore results for a previous account). */
  const clientIdRef = useRef("");
  clientIdRef.current = clientId;
  const [tab, setTab] = useState<TabId>("final");
  /** Cảnh báo Facebook → "Xem dòng": account + row to open in the FB tab. */
  const [metaFocus, setMetaFocus] = useState<MetaFocus | null>(null);
  /** Bumped by "Kiểm tra lại" so the budget / score pills re-read the stored result. */
  const [recheckN, setRecheckN] = useState(0);
  const [access, setAccess] = useState<AccessSnap | null>(null);
  const [accessError, setAccessError] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsSnap | null | undefined>(undefined);
  const [pace, setPace] = useState<PacePreview | null | undefined>(undefined);
  const [basePack, setBasePack] = useState<Record<string, unknown>>({});
  const [scenePack, setScenePack] = useState<Record<string, unknown> | null>(null);
  const [scenario, setScenario] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [fresh, setFresh] = useState<Freshness>({ as_of: null, data_through: null });
  const [warehouseBusy, setWarehouseBusy] = useState(false);
  const [warehouseMsg, setWarehouseMsg] = useState("");
  const [deepEpoch, setDeepEpoch] = useState(0);
  const [adsStatus, setAdsStatus] = useState<{ state: string; message_vi: string } | null>(null);
  const liveConnectRef = useRef<Record<string, unknown> | null>(null);

  const caps = access?.caps;
  /** Customer-side view (no ops tabs). */
  const viewer = Boolean(access && access.role !== "pending" && !access.caps.opsTabs);
  const canPull = Boolean(caps?.pull && !access?.read_only);
  const canInstall = Boolean(access?.real_is_admin && !access?.read_only);
  const shownTab: TabId = access && !tabAllowed(access, tab) ? "report" : tab;
  // "Có báo cáo nháp cần duyệt": draft count badge (report staff only; 0 for everyone else).
  const [reportDrafts, setReportDrafts] = useState(0);
  const reportStaff = Boolean(access && tabAllowed(access, "creports"));
  useEffect(() => {
    if (!reportStaff) return;
    let live = true;
    reportDraftCountFn().then((r) => { if (live) setReportDrafts(r.drafts); }).catch(() => {});
    return () => { live = false; };
  }, [reportStaff, shownTab]);

  const [dirEpoch, setDirEpoch] = useState(0);
  const [aliasDraft, setAliasDraft] = useState<string | null>(null);
  const [aliasMsg, setAliasMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    getWorkspaceDirectory()
      .then((dir) => {
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
          alias: c.alias || "",
          adapter: c.adapter || "live",
          status: c.status,
        }));
        setClients(rows);
        if (dir.mcc) setMcc(dir.mcc);
        if (!dir.access.caps.opsTabs) setTab("report");
        else if (dir.access.caps.grant && !dir.access.read_only && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("gads")) {
          setTab("members");
        }
        setClientId((cur) => {
          if (cur && rows.some((c) => c.client_id === cur)) return cur;
          return rows[0]?.client_id || "";
        });
        if (!rows.length) setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setAccessError("Không đọc được quyền. Đăng nhập lại.");
      });
    return () => {
      cancelled = true;
    };
  }, [dirEpoch]);

  function noteFreshness(pack: {
    as_of?: string | null;
    data_through?: string | null;
    ads_status?: { state: string; message_vi: string } | null;
  }) {
    if ("ads_status" in pack) setAdsStatus(pack.ads_status || null);
    setFresh((prev) => ({
      as_of: pack.as_of && (!prev.as_of || pack.as_of > prev.as_of) ? pack.as_of : prev.as_of,
      data_through:
        pack.data_through && (!prev.data_through || pack.data_through > prev.data_through)
          ? pack.data_through
          : prev.data_through,
    }));
  }

  function mergePackSlice(
    prev: Record<string, unknown>,
    pack: {
      report: unknown;
      alerts: unknown;
      guard: unknown;
      hub: unknown;
      proposals: unknown;
      classify: unknown;
      final: unknown;
      connect: unknown;
      sop: unknown;
      analytics?: unknown;
      pace?: unknown;
    },
    modules: string[] | null,
    id: string,
  ): Record<string, unknown> {
    const keys =
      modules && modules.length
        ? modules.filter((k) => (PACK_SLICE_KEYS as readonly string[]).includes(k))
        : [...PACK_SLICE_KEYS];
    const next = { ...prev };
    const liveConnect = liveConnectRef.current;
    for (const key of keys) {
      if (key === "connect") {
        next.connect =
          liveConnect && String(liveConnect.client_id || "") === id
            ? liveConnect
            : pack.connect;
      } else {
        next[key] = (pack as Record<string, unknown>)[key];
      }
    }
    return next;
  }

  function applyAnalyticsPace(
    pack: { analytics?: unknown; pace?: unknown },
    modules: string[] | null,
  ) {
    const wantAll = !modules || !modules.length;
    if (wantAll || modules.includes("analytics")) {
      setAnalytics((pack.analytics as AnalyticsSnap | null) || null);
    }
    if (wantAll || modules.includes("pace")) {
      setPace((pack.pace as PacePreview | null) || null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!access || access.role === "pending") return;
    // Customers use ClientPortal, which loads its own (analytics-only) data.
    if (access.kind === "client") return;
    if (!clientId || !clients.some((c) => c.client_id === clientId)) return;
    setLoading(true);
    setAnalytics(undefined);
    setPace(undefined);
    setScenePack(null);
    setScenario("");
    setBasePack({});
    setFresh({ as_of: null, data_through: null });
    setAdsStatus(null);
    setWarehouseMsg("");
    const id = clientId;
    const isViewer = !access.caps.opsTabs;
    const activeTab: TabId = tabAllowed(access, tab) ? tab : "report";
    const primary = allowedModules(access, isViewer ? ["report"] : TAB_MODULES[activeTab]);
    setAnalyticsLoading(activeTab === "analytics" || primary.includes("analytics"));

    (async () => {
      try {
        if (primary.length) {
          const pack = await getWorkspacePack({ data: { clientId: id, modules: primary } });
          if (cancelled) return;
          setBasePack((prev) => mergePackSlice(prev, pack, primary, id));
          applyAnalyticsPace(pack, primary);
          noteFreshness(pack);
        }

        if (!cancelled) {
          setLoading(false);
          if (activeTab !== "analytics") setAnalyticsLoading(false);
        }

        // Background full pack for internal roles (server returns only allowed modules).
        if (!cancelled && !isViewer) {
          getWorkspacePack({ data: { clientId: id } })
            .then((pack) => {
              if (cancelled) return;
              setBasePack((prev) => mergePackSlice(prev, pack, null, id));
              applyAnalyticsPace(pack, null);
              noteFreshness(pack);
              setAnalyticsLoading(false);
            })
            .catch(() => {
              if (!cancelled) setAnalyticsLoading(false);
            });
        }
      } catch {
        if (!cancelled) {
          setBasePack({ report: null });
          setLoading(false);
          setAnalyticsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // tab is read once on client change for primary modules; tab switches use a separate effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, clients, access]);

  useEffect(() => {
    if (!access || access.role === "pending" || loading) return;
    if (access.kind === "client") return;
    if (!clientId || !clients.some((c) => c.client_id === clientId)) return;
    const needed = allowedModules(access, TAB_MODULES[shownTab]);
    if (!needed.length) return;
    const missing = needed.filter((key) => {
      if (key === "analytics") return analytics === undefined;
      if (key === "pace") return pace === undefined;
      return !(key in basePack);
    });
    if (!missing.length) return;

    let cancelled = false;
    const id = clientId;
    if (missing.includes("analytics")) setAnalyticsLoading(true);
    getWorkspacePack({ data: { clientId: id, modules: missing } })
      .then((pack) => {
        if (cancelled) return;
        setBasePack((prev) => mergePackSlice(prev, pack, missing, id));
        applyAnalyticsPace(pack, missing);
        noteFreshness(pack);
        setAnalyticsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shownTab, clientId, clients, access, loading, basePack, analytics, pace]);

  useEffect(() => {
    if (!scenario || viewer) {
      setScenePack(null);
      return;
    }
    let cancelled = false;
    const id = clientId;
    getWorkspaceScene({ data: { clientId: id, scenario } })
      .then((scene) => {
        if (cancelled) return;
        setScenePack({
          ...basePack,
          final: scene.final || basePack.final,
          guard: scene.guard || basePack.guard,
          proposals: scene.proposals || basePack.proposals,
          alerts: scene.alerts || basePack.alerts,
        });
      })
      .catch(() => {
        if (!cancelled) setScenePack(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scenario, clientId, basePack, viewer]);

  function goTab(next: TabId) {
    if (!tabAllowed(access, next)) return;
    setTab(next);
    const ops = next === "final" || next === "proposals" || next === "guard" || next === "alerts";
    const list = next === "alerts" ? ALERT_SCENES : GATE_SCENES;
    if (!ops || !list.some((s) => s.id === scenario)) setScenario("");
  }

  function jumpMeta(f: MetaFocus) {
    setMetaFocus(f);
    setClientId(f.clientId);
    goTab("analytics");
  }

  /** Strip pill → Cảnh báo, then scroll to that card once it renders. */
  function openAlertCard(cardId: string) {
    goTab("alerts");
    let tries = 0;
    const seek = () => {
      const el = document.getElementById(cardId);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (++tries < 25) window.setTimeout(seek, 120);
    };
    window.setTimeout(seek, 0);
  }

  function applyConnectResult(snap: Record<string, unknown>) {
    liveConnectRef.current = snap;
    setBasePack((prev) => ({ ...prev, connect: snap }));
    const accounts = accountsFromSnap(snap);
    let ads = accounts.filter((a) => !a.is_manager && a.client_id);
    // Only admin may widen the roster from an MCC probe.
    if (!access?.all_clients) {
      const allowed = new Set(clients.map((c) => c.client_id));
      ads = ads.filter((a) => allowed.has(a.client_id));
    }
    if (!ads.length) return;
    setClients((prev) =>
      ads.map((a) => ({
        client_id: a.client_id,
        display_name: a.display_name,
        adapter: "live" as const,
        status: a.status === "ENABLED" ? "active" : "paused",
        customer_id_dashed: a.customer_id_dashed,
        alias: prev.find((c) => c.client_id === a.client_id)?.alias || "",
      })),
    );
    if (access?.all_clients) {
      setMcc({
        mcc_id_dashed: String(snap.mcc_id_dashed || "532-145-0531"),
        mcc_display_name: String(snap.mcc_display_name || "Fago Agency"),
        last_probe_accessible_count: Number(snap.accessible_count || ads.length),
        roster_complete: Boolean(snap.roster_complete),
        note_vi: String(snap.detail_vi || ""),
        accounts: ads,
      });
    }
    setClientId((cur) => (ads.some((a) => a.client_id === cur) ? cur : ads[0].client_id));
  }

  function applyKpiPack(next: {
    report?: Record<string, unknown> | null;
    compare?: Record<string, unknown> | null;
    connect?: Record<string, unknown> | null;
    hub?: Record<string, unknown> | null;
  }) {
    if (next.connect) liveConnectRef.current = next.connect;
    const rep = next.report || null;
    if (rep && typeof rep.pulled_at === "string") {
      setAdsStatus(null);
      noteFreshness({
        as_of: rep.pulled_at,
        data_through: typeof rep.data_through === "string" ? rep.data_through : null,
      });
    }
    setBasePack((prev) => ({
      ...prev,
      report: next.report
        ? { ...next.report, ...(next.compare && caps?.compare ? { compare: next.compare } : {}) }
        : prev.report,
      connect: next.connect || prev.connect,
      hub: next.hub || prev.hub,
    }));
    setTab("report");
  }

  async function pullWarehouse(lookbackDays: 180 | 365) {
    if (!clientId || !canPull) return;
    setWarehouseBusy(true);
    setWarehouseMsg(`Đang kéo ${lookbackDays} ngày từ Google Ads — có thể mất 1–3 phút, đừng đóng trang…`);
    try {
      const res = await pullAnalyticsWarehouseFn({ data: { clientId, lookbackDays } });
      if (res.ok && res.analytics) {
        setAnalytics(res.analytics as unknown as AnalyticsSnap);
        setAdsStatus(null);
        setFresh((prev) => ({
          as_of: res.pulled_at || new Date().toISOString(),
          data_through: res.warehouse_end || prev.data_through,
        }));
        const coreMsg =
          res.note_vi ||
          `Đã kéo kho ${res.day_count ?? ""} ngày (${res.warehouse_start || "?"} → ${res.warehouse_end || "?"}).`;
        setWarehouseMsg(`${coreMsg} Tiếp theo: nhóm / từ khoá theo từng tháng…`);
        // Continue with ad group / keyword / search term, month by month.
        await runDeepLoop(res.warehouse_start || undefined, "Tài khoản + chiến dịch: xong. ");
      } else {
        setWarehouseMsg(res.error_vi || res.note_vi || "Không kéo được kho phân tích.");
      }
    } catch (err) {
      setWarehouseMsg(err instanceof Error && err.message ? err.message : "Không kéo được kho phân tích.");
    } finally {
      setWarehouseBusy(false);
    }
  }

  /** Month-by-month ad group / keyword / search term pull; returns false on error. */
  async function runDeepLoop(targetStart: string | undefined, prefix: string): Promise<boolean> {
    let done = false;
    for (let i = 0; i < 14; i++) {
      const res = await pullDeepChunkFn({ data: { clientId, targetStart, refreshRecent: i === 0 } });
      if (!res.ok) {
        setWarehouseMsg(
          `${prefix}${res.error_vi || "Không kéo được nhóm / từ khoá."} Bấm "Kéo nhóm / từ khoá" để kéo tiếp phần còn lại.`,
        );
        return false;
      }
      setWarehouseMsg(
        `${prefix}${res.note_vi || "Đã kéo một tháng."}${res.done ? "" : " Đang kéo tiếp, đừng đóng trang…"}`,
      );
      if (res.done) {
        done = true;
        break;
      }
    }
    // One refresh after the pull, not between months, so the table does not blank.
    setDeepEpoch((n) => n + 1);
    if (!done) setWarehouseMsg(`${prefix}Chưa xong — bấm "Kéo nhóm / từ khoá" để kéo tiếp phần còn lại.`);
    return done;
  }

  async function pullDeepLayers() {
    if (!clientId || !canPull) return;
    setWarehouseBusy(true);
    setWarehouseMsg("Đang kéo nhóm / từ khoá (tháng mới nhất trước)…");
    try {
      const targetStart = typeof analytics?.warehouse_start === "string" ? analytics.warehouse_start : undefined;
      await runDeepLoop(targetStart, "");
    } catch (err) {
      setWarehouseMsg(
        `${err instanceof Error && err.message ? err.message : "Không kéo được nhóm / từ khoá."} Bấm "Kéo nhóm / từ khoá" để kéo tiếp.`,
      );
    } finally {
      setWarehouseBusy(false);
    }
  }

  async function exitViewAs() {
    try {
      await stopViewAs();
    } finally {
      window.location.reload();
    }
  }

  async function signOutClient() {
    try {
      await clientSignOut();
    } finally {
      window.location.assign("/login");
    }
  }

  const pack = scenePack || basePack;
  const client = clients.find((c) => c.client_id === clientId);
  const firing = caps?.optimize ? pace?.firing || analytics?.budget_pace?.firing : false;
  const fixture = !viewer && client?.adapter !== "live";
  const scenes = shownTab === "alerts" ? ALERT_SCENES : GATE_SCENES;
  const showScenes =
    !viewer &&
    !loading &&
    fixture &&
    (shownTab === "final" || shownTab === "proposals" || shownTab === "guard" || shownTab === "alerts");
  // A data tab shows only once its content is known to exist for this account (never the
  // empty connection panel / placeholder). Unknown (still loading) counts as absent.
  const packRec = pack as Record<string, unknown>;
  const tabHasData = (id: TabId) => {
    const key = TAB_DATA_KEY[id];
    return !key || Boolean(packRec[key]);
  };
  const shownKey = TAB_DATA_KEY[shownTab];
  const shownKnown = Boolean(shownKey && shownKey in packRec);
  const shownPresent = tabHasData(shownTab);
  // Cảnh báo badge: alerts already in the loaded pack (no extra query); every listed alert is a red one.
  const alertCount = Array.isArray((pack?.alerts as { alerts?: unknown[] } | null | undefined)?.alerts)
    ? ((pack?.alerts as { alerts: unknown[] }).alerts.length)
    : 0;
  const opsTabs = OPS_TABS.filter((t) => tabAllowed(access, t.id) && tabHasData(t.id));
  const opsTabIds = opsTabs.map((t) => t.id).join(",");
  const roleVi = access ? ROLE_LABEL_VI[access.role] || "" : "";
  const freshText = freshnessLine(fresh);

  // The active tab has no data for this account: open Phân tích, else the first visible tab.
  useEffect(() => {
    if (loading || !shownKey || !shownKnown || shownPresent) return;
    const first = opsTabIds.split(",").filter(Boolean)[0] as TabId | undefined;
    const next: TabId | undefined = tabAllowed(access, "analytics") ? "analytics" : first;
    if (next && next !== shownTab) setTab(next);
  }, [shownTab, loading, shownKey, shownKnown, shownPresent, opsTabIds, access]);

  const body = useMemo(() => {
    if (accessError) {
      return (
        <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-danger shadow-sheet">
          {accessError}
        </section>
      );
    }
    if (!access) {
      return <p className="px-1 py-16 text-center text-sm text-muted">Đang đọc quyền…</p>;
    }
    if (access.role === "pending") {
      return (
        <section className="rounded-xl bg-paper px-5 py-10 text-center shadow-sheet">
          <h2 className="font-display text-lg font-semibold">Chưa được cấp quyền</h2>
          <p className="mt-2 text-sm text-muted">
            {access.email || "Tài khoản này"} chưa có vai trò trong AdsOps. Nhờ admin cấp vai trò và tài khoản
            quảng cáo. Không dán token.
          </p>
        </section>
      );
    }
    if (shownTab === "members")
      return <PermissionsPanel caps={access.caps} readOnly={access.read_only} />;
    if (!clients.length) {
      return (
        <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet">
          Chưa được cấp tài khoản quảng cáo nào. Nhờ admin cấp quyền.
        </section>
      );
    }
    if (shownTab === "overview") {
      return (
        <AccountsOverview
          selectedClientId={clientId}
          isAdmin={access.kind === "staff" && access.role === "admin" && !access.read_only}
          onOpenAccount={(id) => {
            setClientId(id);
            setAliasDraft(null);
            setAliasMsg("");
            goTab(tabAllowed(access, "analytics") ? "analytics" : "alerts");
          }}
        />
      );
    }
    if (shownTab === "manager") {
      return <ManagerView onOpenAccount={tabAllowed(access, "analytics") ? (id) => { setClientId(id); goTab("analytics"); } : undefined} />;
    }
    if (shownTab === "needs") {
      return (
        <NeedsActionView
          onOpen={tabAllowed(access, "analytics") ? (id, channel, campaignId) => {
            setTrendFocus({ clientId: id, channel, campaignId });
            setClientId(id);
            goTab("analytics");
            scrollWhenReady(campaignId ? `trend-row-${campaignId}` : TREND_CARD_ID);
          } : undefined}
        />
      );
    }
    if (shownTab === "creports") {
      return <ClientReportsView />;
    }
    if (shownTab === "changelog") {
      return <ChangeLogView clients={clients} clientId={clientId} canPull={Boolean(access.caps.changeLog && !access.read_only)} canDiagnose={Boolean(access.caps.grant && !access.read_only)} />;
    }
    if (loading) {
      return <p className="px-1 py-16 text-center text-sm text-muted">Đang mở khách…</p>;
    }
    const tabKeys = allowedModules(access, TAB_MODULES[shownTab]);
    const tabMissing = tabKeys.some((key) => {
      if (key === "analytics") return analytics === undefined;
      if (key === "pace") return pace === undefined;
      return !(key in basePack);
    });
    if (tabMissing) {
      return <p className="px-1 py-16 text-center text-sm text-muted">Đang mở…</p>;
    }
    if (shownTab === "analytics") {
      const pullBar = canPull ? (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={warehouseBusy || !clientId}
            onClick={() => void pullWarehouse(180)}
            className="h-10 rounded-full bg-inset px-4 text-sm font-medium text-ink hover:bg-line disabled:opacity-60"
          >
            {warehouseBusy ? "Đang kéo…" : "Kéo kho phân tích (180 ngày)"}
          </button>
          <button
            type="button"
            disabled={warehouseBusy || !clientId}
            onClick={() => void pullWarehouse(365)}
            className="h-10 rounded-full bg-inset px-4 text-sm font-medium text-ink hover:bg-line disabled:opacity-60"
          >
            Kéo 365 ngày
          </button>
          <button
            type="button"
            disabled={warehouseBusy || !clientId}
            onClick={() => void pullDeepLayers()}
            className="h-10 rounded-full bg-inset px-4 text-sm font-medium text-ink hover:bg-line disabled:opacity-60"
          >
            Kéo nhóm / từ khoá
          </button>
          {warehouseMsg ? <span className="text-sm text-muted">{warehouseMsg}</span> : null}
        </div>
      ) : null;
      if (clientId.startsWith("tt_")) {
        return <TikTokAnalyticsView key={clientId} clientId={clientId} allowCompare={Boolean(access.caps.compare && access.kind === "staff")} />;
      }
      if (clientId.startsWith("oa_")) {
        return <OpenAIAnalyticsView key={clientId} clientId={clientId} allowCompare={Boolean(access.caps.compare && access.kind === "staff")} />;
      }
      if (clientId.startsWith("fb_")) {
        const focus = metaFocus && metaFocus.clientId === clientId ? metaFocus : null;
        return (
          <MetaAnalyticsView
            key={clientId}
            clientId={clientId}
            allowCompare={Boolean(access.caps.compare && access.kind === "staff")}
            staffAlerts={access.kind === "staff" && tabAllowed(access, "alerts")}
            focus={focus}
            onFocusDone={() => setMetaFocus(null)}
          />
        );
      }
      if (analyticsLoading && analytics === undefined) {
        return <p className="px-1 py-16 text-center text-sm text-muted">Đang mở Phân tích…</p>;
      }
      if (!analytics || !(analytics.daily?.account || []).length) {
        return (
          <>
            {pullBar}
            <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet">
              {client?.display_name || "Khách này"} chưa có ngày chi tiêu trong kho phân tích Google Ads (tài khoản
              mới, tạm ngưng, hoặc chưa kéo kho). Không đoán số.
            </section>
          </>
        );
      }
      return (
        <>
          {pullBar}
          <AnalyticsView
            key={analytics.client_id}
            snap={analytics}
            allowCompare={Boolean(access.caps.compare && access.kind === "staff")}
            deepEpoch={deepEpoch}
            userKey={access.real_email || access.email}
            onReloadAnalytics={async () => {
              const id = clientId;
              const next = await getWorkspacePack({ data: { clientId: id, modules: ["analytics"] } });
              if (id === clientIdRef.current) applyAnalyticsPace(next, ["analytics"]);
            }}
          />
        </>
      );
    }
    if (shownTab === "report") {
      if (!pack.report) {
        return viewer || !access.caps.opsTabs ? (
          <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet">
            Chưa có chỉ số báo cáo cho tài khoản này. Không đoán số.
          </section>
        ) : (
          <ConnectPanel
            data={pack.connect as never}
            clientId={clientId}
            live={client?.adapter === "live"}
            canPull={canPull}
            canInstall={canInstall}
            onConnectResult={applyConnectResult}
            onKpiPulled={(next) => applyKpiPack(next)}
          />
        );
      }
      return (
        <ReportPanel
          data={pack.report as never}
          live={client?.adapter === "live"}
          clientId={clientId}
          viewer={viewer}
          canPull={canPull}
          onPulled={(next) => applyKpiPack(next)}
        />
      );
    }
    const connectFallback = (withKpi: boolean) => (
      <ConnectPanel
        data={pack.connect as never}
        clientId={clientId}
        live={client?.adapter === "live"}
        canPull={canPull}
        canInstall={canInstall}
        onConnectResult={applyConnectResult}
        {...(withKpi ? { onKpiPulled: (next: Parameters<typeof applyKpiPack>[0]) => applyKpiPack(next) } : {})}
      />
    );
    if (shownTab === "alerts") {
      // Staff only (the tab needs optimize; client roles never have it). The server checks again.
      const canCheck = Boolean(access.caps.pull && !access.read_only);
      const runway =
        access.kind === "staff" ? (
          <>
            <BudgetRunwayCard canCheck={canCheck} />
            <OptimizationScoreCard canCheck={canCheck} />
            <PacingAlertsCard
              labels={Object.fromEntries(clients.map((c) => [c.client_id, c.alias ? `${c.alias} — ${c.display_name}` : c.display_name]))}
              onOpenAccount={tabAllowed(access, "analytics") ? (id) => { setClientId(id); goTab("analytics"); } : undefined}
            />
            <MetaAlertsCard onJump={tabAllowed(access, "analytics") ? jumpMeta : undefined} />
            <GoogleTrendAlertsCard
              labels={Object.fromEntries(clients.map((c) => [c.client_id, c.alias ? `${c.alias} — ${c.display_name}` : c.display_name]))}
              onOpen={tabAllowed(access, "analytics") ? (id) => {
                setClientId(id);
                goTab("analytics");
                // The trend card mounts after the account loads: retry the scroll for a few seconds.
                let n = 0;
                const tick = () => { const el = document.getElementById(TREND_CARD_ID); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); else if (n++ < 40) setTimeout(tick, 200); };
                setTimeout(tick, 200);
              } : undefined}
            />
          </>
        ) : null;
      // No alert file: show only the budget runway card, never the empty connection panel.
      if (!pack.alerts) {
        return runway ?? <p className="px-1 py-16 text-center text-sm text-muted">Không có cảnh báo cho tài khoản này.</p>;
      }
      return (
        <>
          {runway}
          <AlertsPanel data={pack.alerts as never} />
        </>
      );
    }
    if (shownTab === "guard") {
      if (!pack.guard) return connectFallback(false);
      return <GuardPanel data={pack.guard as never} />;
    }
    if (shownTab === "hub") {
      if (!pack.hub) return connectFallback(true);
      return <HubPanel data={pack.hub as never} />;
    }
    if (shownTab === "classify") {
      if (!pack.classify) {
        return (
          <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet">
            Chưa có bảng phân loại ST cho khách này. Cần nguồn cụm từ (Drive) rồi gắn keep / add_exact /
            negative / routing / hold.
          </section>
        );
      }
      return (
        <ClassifyView
          key={String((pack.classify as ClassifySnap).client_id || clientId)}
          snap={pack.classify as ClassifySnap}
          canEdit={canPull}
          onSaved={(next) =>
            setBasePack((prev) => ({
              ...prev,
              classify: next,
            }))
          }
        />
      );
    }
    if (shownTab === "proposals") {
      if (!pack.proposals) return connectFallback(false);
      return <ProposalsPanel data={pack.proposals as never} />;
    }
    if (shownTab === "final") {
      // No final pack: an effect moves to Phân tích / Báo cáo; never render the empty card.
      if (!pack.final) return <p className="px-1 py-16 text-center text-sm text-muted">Đang mở…</p>;
      return (
        <FinalPanel
          data={pack.final as never}
          connect={pack.connect as never}
          guard={pack.guard as never}
        />
      );
    }
    if (shownTab === "sop") return <SopPanel data={pack.sop as never} />;
    return connectFallback(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shownTab,
    analytics,
    analyticsLoading,
    pace,
    pack,
    basePack,
    loading,
    clientId,
    client,
    access,
    accessError,
    viewer,
    clients,
    canPull,
    canInstall,
    warehouseBusy,
    warehouseMsg,
    deepEpoch,
  ]);

  const adsCount = mcc?.accounts.filter((a) => !a.is_manager).length ?? mcc?.accounts.length ?? 0;
  const accessible = mcc?.last_probe_accessible_count || adsCount;
  const isClientKind = access?.kind === "client" && !access.view_as;

  // Customer roles (and admin "view as" a customer) get the customer portal.
  if (access && access.kind === "client" && access.role !== "pending") {
    return (
      <ClientPortal
        access={access}
        clients={clients}
        onSignOut={() => void signOutClient()}
        onExitViewAs={() => void exitViewAs()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      {access?.view_as ? (
        <div className="bg-warn-bg px-4 py-2 text-sm text-warn md:px-6">
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2">
            <span>
              Đang <b>Xem như người dùng này</b>: {access.view_as.label} ({ROLE_LABEL_VI[access.view_as.role] || access.view_as.role}) —
              chỉ đọc, thấy đúng những gì người này thấy. Được ghi nhật ký.
            </span>
            <button
              type="button"
              onClick={() => void exitViewAs()}
              className="h-9 rounded-md border border-line-strong bg-paper px-3 text-sm font-medium text-ink"
            >
              Thoát chế độ xem
            </button>
          </div>
        </div>
      ) : null}
      <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
        <div className="mx-auto flex min-h-14 max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 md:px-6 lg:px-8">
          <BrandMark product={viewer ? "AdsOps Báo cáo" : "AdsOps"} />
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-3 sm:flex-none">
            {access && access.role !== "pending" && clients.length ? (
              <div className="min-w-0 flex-1 sm:w-[22rem] sm:flex-none lg:w-[28rem]">
                <AccountPicker
                  compact
                  label={access.all_clients ? `Tài khoản MCC ${mcc?.mcc_id_dashed || "532-145-0531"}` : "Tài khoản được cấp"}
                  clients={clients}
                  value={clientId}
                  onChange={(id) => {
                    setClientId(id);
                    setAliasDraft(null);
                    setAliasMsg("");
                  }}
                />
              </div>
            ) : null}
            <span className="hidden h-6 items-center whitespace-nowrap rounded-sm border border-line bg-inset px-2 text-xs font-medium text-muted lg:inline-flex">
              {roleVi}
              {access?.display_name && access.kind === "client" ? ` · ${access.display_name}` : ""}
            </span>
            {isClientKind ? (
              <button
                type="button"
                onClick={() => void signOutClient()}
                className="h-9 shrink-0 rounded-lg border border-line px-3 text-sm font-medium text-ink hover:bg-inset"
              >
                Đăng xuất
              </button>
            ) : (
              <UserButton />
            )}
          </div>
        </div>
        {access && access.role !== "pending" ? (
          <div className="border-t border-line bg-paper">
          <nav aria-label="Điều hướng" className="mx-auto flex max-w-[1800px] items-center px-4 py-2 md:px-6 lg:px-8">
            <NavBar entries={(() => {
              const tab = (id: TabId, label: string, icon?: NavItem["icon"], extra: Partial<NavItem> = {}): NavItem => ({ id, label, text: label, icon, active: shownTab === id, onClick: () => goTab(id), ...extra });
              const out: NavEntry[] = [];
              if (access.kind === "staff") {
                out.push({ kind: "tab", item: tab("overview", "Tổng quan tài khoản", TAB_ICON.overview) });
                if (tabAllowed(access, "needs")) out.push({ kind: "tab", item: tab("needs", "Cần xử lý (3 tháng)", Bell) });
                if (tabAllowed(access, "manager")) out.push({ kind: "tab", item: tab("manager", "Bảng điều hành", Gauge) });
                if (tabAllowed(access, "creports")) out.push({ kind: "tab", item: tab("creports", "Báo cáo khách hàng", FileText, { badge: reportDrafts || undefined }) });
              }
              const ops = opsTabs.map((it) => tab(it.id, it.label, TAB_ICON[it.id], { badge: it.id === "alerts" ? alertCount || undefined : undefined }));
              if (ops.length === 1) out.push({ kind: "tab", item: ops[0] });
              else if (ops.length) out.push({ kind: "group", id: "ops", label: viewer ? "Báo cáo" : "Vận hành", items: ops });
              const ana: NavItem[] = [];
              if (caps?.analytics) ana.push(tab("analytics", "Phân tích", TAB_ICON.analytics, { dot: Boolean(firing) }));
              if (caps?.changeLog) ana.push(tab("changelog", "Nhật ký tối ưu", TAB_ICON.changelog));
              if (ana.length === 1) out.push({ kind: "tab", item: ana[0] });
              else if (ana.length) out.push({ kind: "group", id: "ana", label: "Phân tích", items: ana });
              return out;
            })()} />
          </nav>
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-5 md:px-6 lg:px-8">
        <section className="mb-5 flex flex-col gap-3 rounded-xl bg-paper px-4 py-3 shadow-sheet md:flex-row md:items-center md:justify-between md:px-5">
          <div className="min-w-0">
            {client && shownTab !== "members" && shownTab !== "overview" ? (
              <>
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="truncate text-lg font-semibold tracking-tight text-ink">{client.alias || client.display_name}</span>
                  {client.alias ? <span className="truncate text-muted">{client.display_name}</span> : null}
                </p>
                <p className="mt-0.5 text-xs text-subtle tabular-nums">
                  {[
                    client.customer_id_dashed && client.display_name !== client.customer_id_dashed ? client.customer_id_dashed : "",
                    access?.all_clients && mcc?.mcc_id_dashed ? `MCC ${mcc.mcc_id_dashed}` : "",
                    analytics?.timezone || client.timezone || "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {freshText ? <span className="font-medium text-ok">{` · ${freshText}`}</span> : null}
                  {shownTab === "analytics"
                    ? " · lọc ngày → tầng → loại conv → ST/KW · không apply"
                    : viewer
                      ? " · CPA Google không phải Qualified Lead."
                      : " · Guard trước FINAL. Coverage ST chưa 100% thì không việc lớn. Phân loại ST trên tab riêng."}
                </p>
                {access?.kind === "staff" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <BudgetStrip
                      key={`b-${client.client_id}-${recheckN}`}
                      clientId={client.client_id}
                      onOpen={tabAllowed(access, "alerts") ? () => openAlertCard(BUDGET_CARD_ID) : undefined}
                    />
                    <ScoreStrip
                      key={`s-${client.client_id}-${recheckN}`}
                      clientId={client.client_id}
                      onOpen={tabAllowed(access, "alerts") ? () => openAlertCard(SCORE_CARD_ID) : undefined}
                    />
                    <RecheckButton key={`r-${client.client_id}`} clientId={client.client_id} onDone={() => setRecheckN((n) => n + 1)} />
                  </div>
                ) : null}
                {canPull && adsStatus?.message_vi ? <p className="mt-1 text-xs text-danger">{adsStatus.message_vi}</p> : null}
              </>
            ) : null}
            {mcc && access?.all_clients && access.role !== "pending" && clients.length ? (
              <p className="mt-0.5 text-xs text-subtle">
                {mcc.mcc_display_name} · {adsCount}/{accessible} tài khoản
                {mcc.roster_complete ? " đã kéo từ MCC" : " — chưa kéo đủ danh sách MCC"}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-subtle">
              {viewer
                ? "Chỉ số của tài khoản được cấp. CPA Google không phải Qualified Lead."
                : "Chỉ đề xuất, không apply Google Ads. CPA Google không phải Qualified Lead. Chỉ thấy tài khoản được cấp."}
            </p>
          </div>
          {access && access.real_is_admin && !access.read_only && client ? (
            <form
              className="flex w-full shrink-0 flex-col gap-1 md:w-80"
              onSubmit={(e) => {
                e.preventDefault();
                const next = (aliasDraft ?? client.alias ?? "").trim();
                const id = client.client_id;
                setAliasMsg("");
                void adminUpdateAdAccount({ data: { id, alias: next } })
                  .then(() => {
                    setAliasMsg(next ? "Đã lưu tên gọi." : "Đã xoá tên gọi. Danh sách hiện tên Google.");
                    setAliasDraft(null);
                    setDirEpoch((n) => n + 1);
                  })
                  .catch(() => setAliasMsg("Không lưu được tên gọi."));
              }}
            >
              <span className="text-[11px] font-medium text-subtle">
                Tên gọi của tài khoản đang chọn — chỉ admin, không đổi tên trên Google Ads
              </span>
              <div className="flex gap-1.5">
                <input
                  value={aliasDraft ?? client.alias ?? ""}
                  maxLength={80}
                  placeholder="Tên gọi ngắn, ví dụ website"
                  aria-label="Tên gọi tài khoản"
                  onChange={(e) => {
                    setAliasDraft(e.target.value);
                    setAliasMsg("");
                  }}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 text-sm text-ink"
                />
                <button type="submit" className="h-9 shrink-0 rounded-lg bg-brand px-3.5 text-sm font-medium text-accent-fg shadow-sm hover:opacity-95">
                  Lưu
                </button>
              </div>
              {aliasMsg ? <span className="text-xs font-normal text-muted">{aliasMsg}</span> : null}
            </form>
          ) : null}
        </section>
        {showScenes && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {scenes.map((item) => (
              <button
                key={item.id || "live"}
                type="button"
                onClick={() => setScenario(item.id)}
                className={cn(
                  "h-8 rounded-md border px-3 text-sm font-medium transition-colors duration-150",
                  scenario === item.id ? "border-accent bg-accent-soft text-accent" : "border-line bg-paper text-muted hover:text-ink",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        {body}
      </main>
    </div>
  );
}
