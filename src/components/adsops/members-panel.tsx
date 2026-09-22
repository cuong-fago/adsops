import { useEffect, useMemo, useState } from "react";
import {
  grantAccessMember,
  listAccessMembers,
  revokeAccessMember,
  type AccessRole,
  type MemberRow,
} from "@/lib/adsops/access.functions";
import { cn } from "@/lib/cn";

type ClientOpt = {
  client_id: string;
  display_name: string;
  customer_id_dashed?: string;
};

const ROLE_VI: Record<AccessRole, string> = {
  ops: "Vận hành",
  sale: "Sale",
  client: "Khách hàng",
};

export function MembersPanel({ clients }: { clients: ClientOpt[] }) {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccessRole>("client");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listAccessMembers()
      .then(setRows)
      .catch(() => setError("Không tải được danh sách quyền."));
  }, []);

  const grouped = useMemo(() => {
    const by = new Map<string, MemberRow[]>();
    for (const row of rows) {
      const key = `${row.email}::${row.role}`;
      const cur = by.get(key) || [];
      cur.push(row);
      by.set(key, cur);
    }
    return [...by.values()];
  }, [rows]);

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function grant() {
    setBusy(true);
    setError("");
    try {
      const next = await grantAccessMember({
        data: { email, role, clientIds: role === "ops" ? [] : picked },
      });
      setRows(next);
      setEmail("");
      setPicked([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không cấp được quyền.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
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

  return (
    <section className="space-y-5">
      <article className="rounded-xl bg-paper p-5 shadow-sheet">
        <h2 className="font-display text-xl font-medium tracking-tight">Cấp quyền</h2>
        <p className="mt-1 text-sm text-muted">
          Khách hàng và sale chỉ vào chỉ số báo cáo của tài khoản được chọn. Vận hành vào đủ tab.
          Không apply Google Ads. Chọn A không thấy số B.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink"
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Vai trò
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AccessRole)}
              className="h-11 rounded-md border border-line bg-bg px-3 text-sm text-ink"
            >
              <option value="client">Khách hàng — chỉ báo cáo</option>
              <option value="sale">Sale — chỉ báo cáo</option>
              <option value="ops">Vận hành — đủ công cụ</option>
            </select>
          </label>
        </div>
        {role !== "ops" ? (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted">Tài khoản được xem</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="h-10 rounded-md px-3 text-sm text-muted hover:bg-inset"
                onClick={() => setPicked(clients.map((c) => c.client_id))}
              >
                Chọn hết
              </button>
              <button
                type="button"
                className="h-10 rounded-md px-3 text-sm text-muted hover:bg-inset"
                onClick={() => setPicked([])}
              >
                Bỏ chọn
              </button>
            </div>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-line bg-bg p-2">
              {clients.map((c) => (
                <li key={c.client_id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-inset">
                    <input
                      type="checkbox"
                      checked={picked.includes(c.client_id)}
                      onChange={() => toggle(c.client_id)}
                    />
                    <span>
                      {c.display_name}
                      {c.customer_id_dashed && c.display_name !== c.customer_id_dashed
                        ? ` · ${c.customer_id_dashed}`
                        : ""}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 rounded-md bg-inset px-3 py-2 text-sm text-muted">
            Vận hành xem mọi tài khoản MCC. Không cần chọn từng khách.
          </p>
        )}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <button
          type="button"
          disabled={busy || !email.trim()}
          onClick={() => void grant()}
          className="mt-4 h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60"
        >
          {busy ? "Đang lưu…" : "Cấp quyền"}
        </button>
      </article>
      <article className="rounded-xl bg-paper p-5 shadow-sheet">
        <h3 className="font-display text-lg font-medium tracking-tight">Đã cấp</h3>
        {grouped.length ? (
          <ul className="mt-3 space-y-3">
            {grouped.map((pack) => {
              const head = pack[0];
              return (
                <li key={`${head.email}-${head.role}`} className="rounded-md bg-inset px-3 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{head.email}</p>
                    <span
                      className={cn(
                        "text-xs font-medium",
                        head.role === "ops" ? "text-ok" : "text-muted",
                      )}
                    >
                      {ROLE_VI[head.role]}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {pack.map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-muted">{row.display_name}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void revoke(row.id)}
                          className="h-10 shrink-0 px-2 text-sm text-danger disabled:opacity-60"
                        >
                          Gỡ
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">Chưa cấp email nào. Người đăng nhập đầu tiên là vận hành.</p>
        )}
      </article>
    </section>
  );
}
