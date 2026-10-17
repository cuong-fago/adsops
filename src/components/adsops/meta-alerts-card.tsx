import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { readMetaAlertsFn } from "@/lib/adsops/meta-ads.functions";
import { FATIGUE, FREQ_ALERT, type MetaAlert, type MetaAlertKind, type MetaAlertsRead } from "@/lib/adsops/meta-alerts.types";
import { cn } from "@/lib/cn";
import { Badge, Card, EmptyState, ErrorState, TableSkeleton, type Tone } from "@/components/adsops/ui";

export const META_ALERTS_CARD_ID = "meta-alerts";

const KIND_LABEL: Record<MetaAlertKind, string> = {
  fatigue: "Mẫu quảng cáo mỏi",
  frequency: "Tần suất cao",
  learning_limited: "Hạn chế học",
  learning: "Đang học",
};
const SEV_TONE: Record<MetaAlert["severity"], Tone> = { danger: "danger", warn: "warn", info: "neutral" };

export type MetaFocus = { clientId: string; level: "adset" | "ad"; id: string; campaignId: string | null; adsetId: string | null };

export function alertBadge(a: MetaAlert) {
  return (
    <Badge key={`${a.kind}`} tone={SEV_TONE[a.severity]} title={`${a.reason}\n${a.detail}${a.tip ? `\n${a.tip}` : ""}`}>
      {a.kind === "frequency" ? (a.severity === "danger" ? "Tần suất >4" : "Tần suất >3") : KIND_LABEL[a.kind]}
    </Badge>
  );
}

/** Staff-only Facebook alerts across every FB account the viewer may see. */
export function MetaAlertsCard({ onJump }: { onJump?: (f: MetaFocus) => void }) {
  const [data, setData] = useState<MetaAlertsRead | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [kinds, setKinds] = useState<Set<MetaAlertKind>>(new Set());
  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    readMetaAlertsFn({ data: {} })
      .then((r) => { if (live) setData(r); })
      .catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [nonce]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of data?.alerts || []) c[a.kind] = (c[a.kind] || 0) + 1;
    return c;
  }, [data]);
  const shown = (data?.alerts || []).filter((a) => !kinds.size || kinds.has(a.kind));
  if (!loading && data && data.accounts === 0) return null;
  return (
    <Card id={META_ALERTS_CARD_ID} className="mb-4 scroll-mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="mr-2 text-lg font-semibold tracking-tight">Cảnh báo Facebook</h2>
        {(Object.keys(KIND_LABEL) as MetaAlertKind[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kinds.has(k)}
            onClick={() => setKinds((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })}
            className={cn("h-7 rounded-md border px-2.5 text-xs font-medium", kinds.has(k) ? "border-accent-border bg-accent-soft text-accent" : "border-line bg-paper text-muted hover:text-ink")}
          >
            {KIND_LABEL[k]} <span className="tabular-nums opacity-70">{counts[k] || 0}</span>
          </button>
        ))}
        <button type="button" onClick={() => setNonce((n) => n + 1)} className="ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted hover:bg-inset hover:text-ink" title="Tải lại">
          <RefreshCw className={cn("size-4", loading && "animate-spin")} /> Tải lại
        </button>
      </div>
      <p className="border-b border-line px-4 py-2 text-xs text-subtle">
        Mỏi mẫu: CTR liên kết 3 ngày gần nhất giảm ≥{FATIGUE.ctrDrop * 100}% so với 7 ngày trước VÀ (CPM tăng ≥{FATIGUE.cpmRise * 100}% HOẶC tần suất 7 ngày &gt;{FATIGUE.freq}); mỗi khoảng ≥{FATIGUE.minImpr.toLocaleString("vi-VN")} hiển thị.
        Tần suất 7 ngày: vàng &gt;{FREQ_ALERT.warn}, đỏ &gt;{FREQ_ALERT.bad}. Chỉ nhóm / quảng cáo đang chạy. Thiếu số liệu thì không cảnh báo.
      </p>
      {err ? (
        <ErrorState message={err} onRetry={() => setNonce((n) => n + 1)} className="m-4" />
      ) : loading && !data ? (
        <div className="p-4"><TableSkeleton rows={4} cols={4} /></div>
      ) : !shown.length ? (
        <EmptyState title={data?.alerts.length ? "Không có cảnh báo khớp bộ lọc." : "Không có cảnh báo Facebook."} className="py-8" />
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((a) => (
            <li key={`${a.client_id}:${a.kind}:${a.level}:${a.object_id}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-subtle">{a.account_label} · {a.level === "ad" ? "Quảng cáo" : "Nhóm quảng cáo"}</p>
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink [overflow-wrap:anywhere]">{a.name} {alertBadge(a)}</p>
                {a.level === "ad" && a.adset_name ? <p className="text-xs text-muted"><span className="text-subtle">Nhóm:</span> {a.adset_name}</p> : null}
                {a.campaign_name ? <p className="text-xs text-muted"><span className="text-subtle">Chiến dịch:</span> {a.campaign_name}</p> : null}
                <p className="mt-1 text-sm text-ink">{a.reason}</p>
                <p className="text-xs tabular-nums text-muted">{a.detail}</p>
                {a.tip ? <p className="mt-0.5 text-xs text-accent">Gợi ý: {a.tip}</p> : null}
              </div>
              {onJump ? (
                <button
                  type="button"
                  onClick={() => onJump({ clientId: a.client_id, level: a.level, id: a.object_id, campaignId: a.campaign_id, adsetId: a.adset_id })}
                  className="h-8 shrink-0 rounded-md border border-line bg-paper px-3 text-sm font-medium text-accent hover:bg-inset"
                >
                  Xem dòng →
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {data?.errors.length ? (
        <p className="border-t border-line px-4 py-2 text-xs text-warn">Không đọc được: {data.errors.map((e) => e.account_label).join(", ")}</p>
      ) : null}
    </Card>
  );
}
