import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { saveClassifyEdits, type ClassifyCluster, type ClassifyLabel, type ClassifySnap } from "@/lib/adsops/classify.functions";
import { money, num } from "@/lib/adsops/format";
import { cn } from "@/lib/cn";

const LABELS: { id: ClassifyLabel; vi: string }[] = [
  { id: "keep", vi: "Giữ" },
  { id: "add_exact", vi: "Thêm Exact" },
  { id: "negative", vi: "Phủ định" },
  { id: "routing", vi: "Chuyển nhóm" },
  { id: "hold", vi: "Treo" },
];

const FILTERS: { id: string; vi: string }[] = [
  { id: "all", vi: "Tất cả" },
  { id: "unclassified", vi: "Chưa gắn" },
  { id: "keep", vi: "Giữ" },
  { id: "add_exact", vi: "Thêm Exact" },
  { id: "negative", vi: "Phủ định" },
  { id: "routing", vi: "Chuyển nhóm" },
  { id: "hold", vi: "Treo" },
];

function tone(label: string, on: boolean) {
  if (!on) return "bg-inset text-muted hover:bg-line";
  if (label === "keep") return "bg-ok text-ok-bg";
  if (label === "add_exact") return "bg-accent text-accent-fg";
  if (label === "negative") return "bg-danger text-accent-fg";
  if (label === "routing") return "bg-warn text-accent-fg";
  return "bg-ink text-paper";
}

function chip(label: string) {
  if (label === "keep") return "bg-ok-bg text-ok";
  if (label === "add_exact") return "bg-inset text-accent";
  if (label === "negative") return "bg-danger-bg text-danger";
  if (label === "routing") return "bg-warn-bg text-warn";
  return "bg-inset text-muted";
}

function keyOf(row: ClassifyCluster) {
  return `${row.query}||${row.campaign_name}||${row.ad_group_name}`;
}

export function ClassifyView({
  snap,
  onSaved,
}: {
  snap: ClassifySnap;
  onSaved?: (next: ClassifySnap) => void;
}) {
  const [rows, setRows] = useState<ClassifyCluster[]>(snap.clusters || []);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [dirty, setDirty] = useState<Record<string, ClassifyLabel>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    setRows(snap.clusters || []);
    setDirty({});
    setError("");
    setNote("");
  }, [snap.client_id, snap.clusters]);

  const coverage = snap.coverage || { classified: 0, total: 0, ratio: 0, rows: 0, required: 1 };
  const total = coverage.total || 0;
  const classified = coverage.classified || 0;
  const ratio = coverage.ratio ?? (total ? classified / total : 0);
  const dirtyN = Object.keys(dirty).length;
  const counts = useMemo(() => {
    const out: Record<string, number> = { unclassified: 0 };
    for (const row of rows) {
      if (!row.classified) out.unclassified += 1;
      else out[row.label] = (out[row.label] || 0) + 1;
    }
    return out;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "unclassified" && row.classified) return false;
      if (filter !== "all" && filter !== "unclassified" && row.label !== filter) return false;
      if (!needle) return true;
      return `${row.query} ${row.campaign_name} ${row.ad_group_name}`.toLowerCase().includes(needle);
    });
  }, [rows, filter, q]);

  function setLabel(row: ClassifyCluster, label: ClassifyLabel) {
    const key = keyOf(row);
    setRows((prev) =>
      prev.map((item) =>
        keyOf(item) === key
          ? {
              ...item,
              label,
              classified: true,
              origin: "human",
              reason: "Người tối ưu gắn nhãn trên màn Phân loại ST.",
              negative_tier: label === "negative" ? item.negative_tier || "ad_group" : null,
            }
          : item,
      ),
    );
    setDirty((prev) => ({ ...prev, [key]: label }));
  }

  async function save() {
    const edits = rows
      .filter((row) => dirty[keyOf(row)])
      .map((row) => ({
        query: row.query,
        campaign_name: row.campaign_name,
        ad_group_name: row.ad_group_name,
        label: row.label,
        negative_tier: row.negative_tier,
        reason: row.reason,
      }));
    if (!edits.length) return;
    setSaving(true);
    setError("");
    setNote("");
    try {
      const result = await saveClassifyEdits({ data: { clientId: snap.client_id, edits } });
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
      setNote(
        cov
          ? `Đã lưu ${edits.length} nhãn. Coverage ${Math.round((cov.coverage || 0) * 100)}% (${cov.classified}/${cov.total}). Không sinh FINAL.`
          : `Đã lưu ${edits.length} nhãn. Không sinh FINAL.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không lưu được nhãn.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl bg-paper p-5 shadow-sheet">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-subtle">Phân loại ST</p>
            <h2 className="font-display text-2xl font-medium tracking-tight">Cụm từ tìm kiếm</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">{snap.verdict}</p>
          </div>
          <div className="text-right">
            <p className="font-display text-4xl font-medium tabular-nums tracking-tight">
              {classified}/{total || "—"}
            </p>
            <p className="text-xs text-muted">
              {Math.round(ratio * 100)}% cụm · {coverage.rows || snap.cluster_count || rows.length} dòng cửa sổ
            </p>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-inset">
          <div
            className={cn("h-full rounded-full", ratio >= 1 ? "bg-ok" : "bg-accent")}
            style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
          />
        </div>
        {ratio >= 1 ? (
          <p className="mt-3 rounded-md bg-ok-bg px-4 py-3 text-sm text-ok">
            Coverage 100%. Có thể mở FINAL ở phiên sau. Phiên này không sinh FINAL. AdsOps không tự apply Google Ads.
          </p>
        ) : (
          <p className="mt-3 rounded-md bg-danger-bg px-4 py-3 text-sm text-danger">
            Coverage chưa 100% — việc lớn bị chặn, không sinh FINAL.
          </p>
        )}
      </div>

      <div className="rounded-xl bg-paper p-4 shadow-sheet md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={cn(
                  "h-10 rounded-full px-3.5 text-sm font-medium",
                  filter === item.id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
                )}
              >
                {item.vi}
                <span className="ml-1.5 tabular-nums text-xs opacity-80">
                  {item.id === "all" ? rows.length : counts[item.id] || 0}
                </span>
              </button>
            ))}
          </div>
          <label className="relative block md:min-w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm cụm / chiến dịch / nhóm"
              className="h-11 w-full rounded-md border border-line bg-bg pl-9 pr-3 text-sm text-ink"
            />
          </label>
        </div>

        <p className="mt-3 text-xs text-subtle">
          Nhãn: Giữ · Thêm Exact · Phủ định · Chuyển nhóm · Treo. Bằng chứng cửa sổ 7/14/30 — không dựa 1 ngày lẻ.
        </p>

        <ul className="mt-3 divide-y divide-line">
          {visible.map((row) => {
            const key = keyOf(row);
            const expanded = open === key;
            return (
              <li key={key} className="py-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <button type="button" onClick={() => setOpen(expanded ? null : key)} className="min-w-0 text-left">
                    <p className="font-medium text-ink">{row.query}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {row.campaign_name} · {row.ad_group_name}
                      {row.added_status ? ` · ${row.added_status}` : ""}
                      {row.match_type ? ` · ${row.match_type}` : ""}
                    </p>
                  </button>
                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", chip(row.label))}>
                      {LABELS.find((l) => l.id === row.label)?.vi || row.label}
                      {row.classified ? "" : " · chưa gắn"}
                    </span>
                    <span className="text-xs tabular-nums text-muted">
                      {money(row.cost_30, snap.currency || "VND")} · {num(row.clicks_30)} click · {num(row.conversions_30, 1)} conv
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {LABELS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setLabel(row, item.id)}
                      className={cn("h-10 rounded-full px-3 text-sm font-medium", tone(item.id, row.label === item.id && row.classified))}
                    >
                      {item.vi}
                    </button>
                  ))}
                </div>
                {expanded ? (
                  <div className="mt-3 rounded-md bg-inset px-3 py-3 text-sm">
                    <p className="text-ink">{row.reason}</p>
                    <p className="mt-1 text-muted">{row.evidence}</p>
                    {row.windows ? (
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs md:grid-cols-3">
                        {(["7", "14", "30"] as const).map((w) => {
                          const b = row.windows?.[w];
                          return (
                            <div key={w} className="rounded-sm bg-paper px-2 py-2">
                              <dt className="text-subtle">{w} ngày</dt>
                              <dd className="tabular-nums text-ink">
                                {num(b?.impressions)} imps · {num(b?.clicks)} click · {money(b?.cost, snap.currency || "VND")} · {num(b?.conversions, 1)} conv
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1 line-clamp-2 text-xs text-subtle">{row.reason}</p>
                )}
              </li>
            );
          })}
        </ul>
        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">Không có cụm khớp bộ lọc.</p>
        ) : null}
      </div>

      {dirtyN > 0 ? (
        <div className="sticky bottom-3 z-10 rounded-xl bg-ink px-4 py-3 text-paper shadow-sheet">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">{dirtyN} nhãn đã sửa — chưa ghi. Không apply Google Ads.</p>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="h-11 rounded-full bg-accent px-5 text-sm font-medium text-accent-fg disabled:opacity-60"
            >
              {saving ? "Đang lưu…" : "Lưu nhãn"}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="rounded-md bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p> : null}
      {note ? <p className="rounded-md bg-ok-bg px-4 py-3 text-sm text-ok">{note}</p> : null}
    </section>
  );
}
