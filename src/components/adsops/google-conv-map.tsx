import { useState } from "react";
import { setConvGroupFn } from "@/lib/adsops/connect.functions";
import { CONV_GROUPS, CONV_GROUP_LABEL, type ConvActionsRead, type ConvGroup } from "@/lib/adsops/google-conv-groups";
import { cn } from "@/lib/cn";

/** Admin / Trưởng phòng Ads: map each Google conversion action to a standard group. Saved in AdsOps only. */
export function GoogleConvMap({ clientId, read, onChange }: { clientId: string; read: ConvActionsRead; onChange: (r: ConvActionsRead) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const save = async (id: string, v: string) => {
    const a = read.actions.find((x) => x.id === id);
    if (!a) return;
    const group = v === "auto" ? null : (v as ConvGroup);
    setBusy(id); setErr("");
    try {
      await setConvGroupFn({ data: { clientId, actionId: id, group } });
      onChange({ ...read, actions: read.actions.map((x) => (x.id === id ? { ...x, group: group ?? x.auto_group, overridden: group != null } : x)) });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  };
  return (
    <div className="mt-3 rounded-lg border border-line">
      <button type="button" onClick={() => setOpen(!open)} className="w-full px-3 py-2 text-left text-xs font-semibold text-ink" title="Chỉ Admin / Trưởng phòng Ads. Lưu trong AdsOps, không thay đổi gì trên Google Ads.">
        {open ? "▾" : "▸"} Nhóm chuyển đổi ({read.actions.length} hành động)
      </button>
      {open ? (
        <div className="overflow-x-auto px-3 pb-3">
          {err ? <p className="text-xs text-danger">{err}</p> : null}
          {!read.actions.length ? <p className="text-xs text-muted">Không có hành động chuyển đổi.</p> : (
            <table className="w-full text-xs">
              <thead className="text-muted"><tr>
                <th className="py-1 text-left font-medium">Hành động chuyển đổi</th>
                <th className="text-left font-medium" title="Chính: tính vào cột Chuyển đổi / CPA. Phụ: chỉ để tham khảo.">Chính/Phụ</th>
                <th className="text-left font-medium">Danh mục · Loại (Google)</th>
                <th className="text-left font-medium">Tự động</th>
                <th className="text-left font-medium">Nhóm dùng</th>
              </tr></thead>
              <tbody>
                {read.actions.map((a) => (
                  <tr key={a.id} className={cn("border-t border-line", a.status === "REMOVED" && "opacity-60")}>
                    <td className="max-w-[280px] truncate py-1 pr-2" title={a.name}>{a.name}{a.status && a.status !== "ENABLED" ? <span className="ml-1 text-subtle">({a.status === "REMOVED" ? "đã xoá" : a.status === "HIDDEN" ? "ẩn" : a.status})</span> : null}</td>
                    <td className="pr-2">{a.primary ? <span className="text-ok">Chính</span> : <span className="text-muted">Phụ</span>}</td>
                    <td className="pr-2 text-muted">{a.category || "-"} · {a.type || "-"}</td>
                    <td className="pr-2 text-muted">{CONV_GROUP_LABEL[a.auto_group]}</td>
                    <td>
                      <select disabled={busy === a.id} value={a.overridden ? a.group : "auto"} onChange={(e) => save(a.id, e.target.value)} className="rounded border border-line bg-surface px-1 py-0.5 text-xs">
                        <option value="auto">Tự động ({CONV_GROUP_LABEL[a.auto_group]})</option>
                        {CONV_GROUPS.map((g) => <option key={g} value={g}>{CONV_GROUP_LABEL[g]}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}
