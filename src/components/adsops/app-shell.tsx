import { useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsView } from "@/components/adsops/analytics-view";
import { ClassifyView } from "@/components/adsops/classify-view";
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
import { stopViewAs } from "@/lib/adsops/admin.functions";
import type { AnalyticsSnap } from "@/lib/adsops/analytics";
import type { ClassifySnap } from "@/lib/adsops/classify.types";
import { clientSignOut } from "@/lib/adsops/client-auth.functions";
import { pullAnalyticsWarehouseFn } from "@/lib/adsops/connect.functions";
import { MODULE_CAPABILITY, ROLE_LABEL_VI, formatSaigon } from "@/lib/adsops/permissions.types";
import { UserButton } from "@/lib/auth/gates";
import { cn } from "@/lib/cn";

type ClientRow = {
  client_id: string;
  display_name: string;
  adapter?: string;
  status?: string;
  timezone?: string;
  currency?: string;
  has_warehouse?: boolean;
  customer_id_dashed?: string;
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
  | "members";

const OPS_TABS: { id: TabId; label: string }[] = [
  { id: "final", label: "FINAL" },
  { id: "proposals", label: "Đề xuất" },
  { id: "classify", label: "Phân loại ST" },
  { id: "guard", label: "Guard" },
  { id: "alerts", label: "Cảnh báo" },
  { id: "report", label: "Báo cáo" },
  { id: "hub", label: "Data Hub" },
  { id: "connect", label: "Kết nối" },
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
  members: [],
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
  if (id === "members") return Boolean(caps.grant || caps.requestGrant);
  if (id === "analytics") return caps.analytics;
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
      return `Số liệu Google Ads cập nhật đến ${hm} ngày ${day} (giờ VN)`;
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
  const [tab, setTab] = useState<TabId>("final");
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
  const liveConnectRef = useRef<Record<string, unknown> | null>(null);

  const caps = access?.caps;
  /** Customer-side view (no ops tabs). */
  const viewer = Boolean(access && access.role !== "pending" && !access.caps.opsTabs);
  const canPull = Boolean(caps?.pull && !access?.read_only);
  const canInstall = Boolean(access?.real_is_admin && !access?.read_only);
  const shownTab: TabId = access && !tabAllowed(access, tab) ? "report" : tab;

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
          adapter: c.adapter || "live",
          status: c.status,
        }));
        setClients(rows);
        if (dir.mcc) setMcc(dir.mcc);
        if (!dir.access.caps.opsTabs) setTab("report");
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
  }, []);

  function noteFreshness(pack: { as_of?: string | null; data_through?: string | null }) {
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
    if (!clientId || !clients.some((c) => c.client_id === clientId)) return;
    setLoading(true);
    setAnalytics(undefined);
    setPace(undefined);
    setScenePack(null);
    setScenario("");
    setBasePack({});
    setFresh({ as_of: null, data_through: null });
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
    setClients(
      ads.map((a) => ({
        client_id: a.client_id,
        display_name: a.display_name,
        adapter: "live" as const,
        status: a.status === "ENABLED" ? "active" : "paused",
        customer_id_dashed: a.customer_id_dashed,
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

  async function pullWarehouse() {
    if (!clientId || !canPull) return;
    setWarehouseBusy(true);
    setWarehouseMsg("");
    try {
      const res = await pullAnalyticsWarehouseFn({ data: { clientId, lookbackDays: 180 } });
      if (res.ok && res.analytics) {
        setAnalytics(res.analytics as unknown as AnalyticsSnap);
        setFresh((prev) => ({
          as_of: new Date().toISOString(),
          data_through: res.warehouse_end || prev.data_through,
        }));
        setWarehouseMsg(
          `Đã kéo kho ${res.day_count ?? ""} ngày (${res.warehouse_start || "?"} → ${res.warehouse_end || "?"})${
            res.persisted_neon ? " · đã lưu Neon" : ""
          }.`,
        );
      } else {
        setWarehouseMsg(res.error_vi || res.note_vi || "Không kéo được kho phân tích.");
      }
    } catch (err) {
      setWarehouseMsg(err instanceof Error && err.message ? err.message : "Không kéo được kho phân tích.");
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
  const opsTabs = OPS_TABS.filter((t) => tabAllowed(access, t.id));
  const roleVi = access ? ROLE_LABEL_VI[access.role] || "" : "";
  const freshText = freshnessLine(fresh);

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
          <h2 className="font-display text-xl font-medium">Chưa được cấp quyền</h2>
          <p className="mt-2 text-sm text-muted">
            {access.email || "Tài khoản này"} chưa có vai trò trong AdsOps. Nhờ admin cấp vai trò và tài khoản
            quảng cáo. Không dán token.
          </p>
        </section>
      );
    }
    if (shownTab === "members") return <PermissionsPanel caps={access.caps} />;
    if (!clients.length) {
      return (
        <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet">
          Chưa được cấp tài khoản quảng cáo nào. Nhờ admin cấp quyền.
        </section>
      );
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
            onClick={() => void pullWarehouse()}
            className="h-10 rounded-full bg-inset px-4 text-sm font-medium text-ink hover:bg-line disabled:opacity-60"
          >
            {warehouseBusy ? "Đang kéo kho…" : "Kéo kho phân tích (180 ngày)"}
          </button>
          {warehouseMsg ? <span className="text-sm text-muted">{warehouseMsg}</span> : null}
        </div>
      ) : null;
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
          <AnalyticsView key={analytics.client_id} snap={analytics} allowCompare={Boolean(access.caps.compare)} />
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
      if (!pack.alerts) return connectFallback(false);
      return <AlertsPanel data={pack.alerts as never} />;
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
  ]);

  const adsCount = mcc?.accounts.filter((a) => !a.is_manager).length ?? mcc?.accounts.length ?? 0;
  const accessible = mcc?.last_probe_accessible_count || adsCount;
  const isClientKind = access?.kind === "client" && !access.view_as;

  return (
    <div className="min-h-screen bg-bg text-ink">
      {access?.view_as ? (
        <div className="bg-warn-bg px-4 py-2 text-sm text-warn md:px-6">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-2">
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
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 md:flex-row md:items-end md:justify-between md:px-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-subtle">AdsOps · Fago Group</p>
            <h1 className="font-display text-2xl font-medium tracking-tight text-balance">
              {viewer ? "Báo cáo Google Ads" : "Vận hành Google Ads"}
            </h1>
            <p className="mt-0.5 max-w-xl text-pretty text-sm text-muted">
              {viewer
                ? "Chỉ số của tài khoản được cấp. CPA Google không phải Qualified Lead."
                : "Chỉ đề xuất, không apply Google Ads. CPA Google không phải Qualified Lead. Chỉ thấy tài khoản được cấp."}
            </p>
          </div>
          <div className="flex min-w-64 flex-col gap-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-xs font-medium text-muted">
                {roleVi}
                {access?.display_name && access.kind === "client" ? ` · ${access.display_name}` : ""}
              </span>
              {isClientKind ? (
                <button
                  type="button"
                  onClick={() => void signOutClient()}
                  className="h-9 rounded-md border border-line-strong bg-inset px-3 text-sm font-medium text-ink hover:bg-line"
                >
                  Đăng xuất
                </button>
              ) : (
                <UserButton />
              )}
            </div>
            {access && access.role !== "pending" && clients.length ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                {access.all_clients ? `Tài khoản MCC ${mcc?.mcc_id_dashed || "532-145-0531"}` : "Tài khoản được cấp"}
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink"
                >
                  {clients.map((c) => (
                    <option key={c.client_id} value={c.client_id}>
                      {c.display_name}
                      {c.customer_id_dashed && c.display_name !== c.customer_id_dashed
                        ? ` · ${c.customer_id_dashed}`
                        : ""}
                    </option>
                  ))}
                </select>
                {mcc && access.all_clients ? (
                  <span className="text-xs font-normal text-subtle">
                    {mcc.mcc_display_name} · {adsCount}/{accessible} tài khoản
                    {mcc.roster_complete ? " đã kéo từ MCC" : " — chưa kéo đủ danh sách MCC"}
                  </span>
                ) : null}
              </label>
            ) : null}
          </div>
        </div>
        {access && access.role !== "pending" ? (
          <nav className="mx-auto max-w-screen-2xl px-4 pb-3 md:px-6">
            <p className="mb-1 text-xs font-medium text-subtle">{viewer ? "Báo cáo" : "Vận hành"}</p>
            <div className="flex flex-wrap gap-1">
              {opsTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goTab(item.id)}
                  className={cn(
                    "h-10 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors duration-150",
                    shownTab === item.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-inset",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {caps?.analytics ? (
              <>
                <p className="mb-1 mt-3 text-xs font-medium text-subtle">Phân tích</p>
                <button
                  type="button"
                  onClick={() => goTab("analytics")}
                  className={cn(
                    "relative h-10 rounded-full px-3.5 text-sm font-medium transition-colors duration-150",
                    shownTab === "analytics" ? "bg-accent text-accent-fg" : "text-muted hover:bg-inset",
                  )}
                >
                  Phân tích
                  {firing ? (
                    <span className="ml-1.5 inline-block size-1.5 rounded-full bg-danger outline outline-2 outline-paper" />
                  ) : null}
                </button>
              </>
            ) : null}
          </nav>
        ) : null}
      </header>

      <main className="mx-auto max-w-screen-2xl px-4 py-4 md:px-6">
        {client && shownTab !== "members" && (
          <p className="mb-3 text-xs text-subtle">
            {client.display_name}
            {client.customer_id_dashed && client.display_name !== client.customer_id_dashed
              ? ` · ${client.customer_id_dashed}`
              : ""}
            {access?.all_clients && mcc?.mcc_id_dashed ? ` · MCC ${mcc.mcc_id_dashed}` : ""}
            {analytics?.timezone || client.timezone
              ? ` · ${analytics?.timezone || client.timezone}`
              : ""}
            {freshText ? <span className="font-medium text-muted">{` · ${freshText}`}</span> : null}
            {shownTab === "analytics"
              ? " · lọc ngày → tầng → loại conv → ST/KW · không apply"
              : viewer
                ? " · CPA Google không phải Qualified Lead."
                : " · Guard trước FINAL. Coverage ST chưa 100% thì không việc lớn. Phân loại ST trên tab riêng."}
          </p>
        )}
        {showScenes && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {scenes.map((item) => (
              <button
                key={item.id || "live"}
                type="button"
                onClick={() => setScenario(item.id)}
                className={cn(
                  "h-10 rounded-full px-3.5 text-sm font-medium transition-colors duration-150",
                  scenario === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
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
