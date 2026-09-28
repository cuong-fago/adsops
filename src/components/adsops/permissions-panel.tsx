import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminCreateClientUser,
  adminDecideRequest,
  adminDeleteClientUser,
  adminDeleteCustomer,
  adminRemoveStaff,
  adminResetClientPassword,
  adminRevokeClientSessions,
  adminSetGrants,
  adminStartViewAs,
  adminUpdateAdAccount,
  adminUpdateClientUser,
  adminUpsertCustomer,
  adminUpsertStaff,
  cancelGrantRequestFn,
  getAdminDirectory,
  getAuditLog,
  getRequestDirectory,
  submitGrantRequestFn,
} from "@/lib/adsops/admin.functions";
import {
  ASSIGNABLE_STAFF_ROLES,
  CLIENT_ROLES,
  ROLE_LABEL_VI,
  formatSaigon,
  type AdminDirectory,
  type AuditRow,
  type GrantRequestRow,
  type PrincipalKind,
  type RequestDirectory,
} from "@/lib/adsops/permissions.types";
import { cn } from "@/lib/cn";
import { GoogleAdsAdminCard } from "./google-ads-admin-card";

type Caps = { grant?: boolean; requestGrant?: boolean };

const input = "h-10 rounded-md border border-line bg-bg px-3 text-sm text-ink";
const btn = "h-10 rounded-md border border-line-strong bg-inset px-3 text-sm font-medium text-ink hover:bg-line disabled:opacity-60";
const btnPrimary = "h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-60";
const btnDanger = "h-10 rounded-md px-3 text-sm text-danger hover:bg-inset disabled:opacity-60";
const card = "rounded-xl bg-paper p-5 shadow-sheet";

function errMsg(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function statusVi(s: GrantRequestRow["status"]): string {
  return { pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Từ chối", cancelled: "Đã huỷ" }[s] || s;
}

export function PermissionsPanel({ caps, realAdmin, readOnly }: { caps: Caps; realAdmin?: boolean; readOnly?: boolean }) {
  if (caps.grant || realAdmin) {
    return (
      <div className="flex flex-col gap-4">
        {realAdmin ? <GoogleAdsAdminCard readOnly={readOnly} /> : null}
        {caps.grant ? <AdminPermissions /> : null}
      </div>
    );
  }
  if (caps.requestGrant) return <RequestPermissions />;
  return (
    <section className={card}>
      <p className="text-sm text-muted">Vai trò này không quản lý quyền.</p>
    </section>
  );
}

// ── shared: account checklist ────────────────────────────────────────────────────────────────

type AccountOpt = { id: string; display_name: string; external_id: string | null; group?: string };

function AccountChecklist({
  accounts,
  picked,
  onChange,
}: {
  accounts: AccountOpt[];
  picked: string[];
  onChange: (next: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? accounts.filter((a) =>
          `${a.display_name} ${a.external_id || ""} ${a.id} ${a.group || ""}`.toLowerCase().includes(needle),
        )
      : accounts;
    return [...list].sort((a, b) => (a.group || "").localeCompare(b.group || "") || a.display_name.localeCompare(b.display_name));
  }, [accounts, q]);
  const toggle = (id: string) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={cn(input, "min-w-48 flex-1")} placeholder="Tìm tài khoản…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className={btn} onClick={() => onChange([...new Set([...picked, ...shown.map((a) => a.id)])])}>
          Chọn hết (đang lọc)
        </button>
        <button type="button" className={btn} onClick={() => onChange([])}>
          Bỏ chọn
        </button>
        <span className="text-xs text-subtle">Đã chọn {picked.length}</span>
      </div>
      <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-md border border-line bg-bg p-2">
        {shown.map((a) => (
          <li key={a.id}>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-inset">
              <input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} />
              <span className="flex-1">
                {a.display_name}
                {a.external_id ? <span className="text-subtle"> · {a.external_id}</span> : null}
              </span>
              {a.group ? <span className="text-xs text-subtle">{a.group}</span> : null}
            </label>
          </li>
        ))}
        {!shown.length ? <li className="px-2 py-2 text-sm text-muted">Không có tài khoản.</li> : null}
      </ul>
    </div>
  );
}

// ── admin ────────────────────────────────────────────────────────────────────────────

type AdminTab = "users" | "grants" | "accounts" | "requests" | "audit";

function AdminPermissions() {
  const [dir, setDir] = useState<AdminDirectory | null>(null);
  const [tab, setTab] = useState<AdminTab>("users");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [grantTarget, setGrantTarget] = useState<string>("");

  const reload = useCallback(async () => {
    try {
      setDir(await getAdminDirectory());
    } catch (err) {
      setError(errMsg(err, "Không tải được danh sách quyền."));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (ok) setNotice(ok);
      await reload();
    } catch (err) {
      setError(errMsg(err, "Thao tác không thành công."));
    } finally {
      setBusy(false);
    }
  }

  async function viewAs(kind: PrincipalKind, id: string) {
    setBusy(true);
    try {
      await adminStartViewAs({ data: { kind, id } });
      window.location.reload();
    } catch (err) {
      setError(errMsg(err, "Không chuyển được chế độ xem."));
      setBusy(false);
    }
  }

  const customerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of dir?.customers || []) m.set(c.id, c.name);
    return m;
  }, [dir]);

  const accountOpts: AccountOpt[] = useMemo(
    () =>
      (dir?.accounts || []).map((a) => ({
        id: a.id,
        display_name: a.display_name,
        external_id: a.external_id,
        group: a.customer_id ? customerName.get(a.customer_id) : undefined,
      })),
    [dir, customerName],
  );
  const accountName = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of dir?.accounts || []) m.set(a.id, a.display_name);
    return m;
  }, [dir]);

  const pending = (dir?.requests || []).filter((r) => r.status === "pending").length;
  const tabs: Array<[AdminTab, string]> = [
    ["users", "Người dùng"],
    ["grants", "Cấp tài khoản"],
    ["accounts", "Khách hàng & TKQC"],
    ["requests", pending ? `Yêu cầu (${pending})` : "Yêu cầu"],
    ["audit", "Nhật ký"],
  ];

  return (
    <section className="space-y-5">
      <article className={card}>
        <h2 className="font-display text-xl font-medium tracking-tight">Phân quyền</h2>
        <p className="mt-1 text-sm text-muted">
          Mọi vai trò (trừ admin) chỉ thấy tài khoản quảng cáo được cấp rõ ràng. Tài khoản mới xuất hiện trong MCC chỉ admin
          thấy cho đến khi được cấp. Mọi thay đổi được ghi nhật ký.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "h-10 rounded-md px-3 text-sm font-medium",
                tab === id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {notice ? <p className="mt-3 text-sm text-ok">{notice}</p> : null}
      </article>
      {!dir ? (
        <article className={card}>
          <p className="text-sm text-muted">Đang tải…</p>
        </article>
      ) : tab === "users" ? (
        <UsersTab
          dir={dir}
          busy={busy}
          run={run}
          viewAs={viewAs}
          customerName={customerName}
          accountOpts={accountOpts}
          onEditGrants={(key) => {
            setGrantTarget(key);
            setTab("grants");
          }}
        />
      ) : tab === "grants" ? (
        <GrantsTab dir={dir} busy={busy} run={run} accountOpts={accountOpts} target={grantTarget} setTarget={setGrantTarget} />
      ) : tab === "accounts" ? (
        <AccountsTab dir={dir} busy={busy} run={run} />
      ) : tab === "requests" ? (
        <RequestsTab requests={dir.requests} busy={busy} run={run} accountName={accountName} />
      ) : (
        <AuditTab />
      )}
    </section>
  );
}

type RunFn = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

function UsersTab({
  dir,
  busy,
  run,
  viewAs,
  customerName,
  accountOpts,
  onEditGrants,
}: {
  dir: AdminDirectory;
  busy: boolean;
  run: RunFn;
  viewAs: (kind: PrincipalKind, id: string) => Promise<void>;
  customerName: Map<string, string>;
  accountOpts: AccountOpt[];
  onEditGrants: (key: string) => void;
}) {
  const [staffEmail, setStaffEmail] = useState("");
  const [staffRole, setStaffRole] = useState<string>("optimizer");
  const [cu, setCu] = useState({ username: "", password: "", display_name: "", email: "", role: "client_owner", customer_id: "" });
  const [cuAccounts, setCuAccounts] = useState<string[]>([]);

  return (
    <>
      <article className={card}>
        <h3 className="font-display text-lg font-medium tracking-tight">Nhân sự nội bộ (đăng nhập Google)</h3>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Email
            <input className={cn(input, "w-72")} type="email" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Vai trò
            <select className={input} value={staffRole} onChange={(e) => setStaffRole(e.target.value)}>
              {ASSIGNABLE_STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL_VI[r]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || !staffEmail.trim()}
            onClick={() =>
              void run(async () => {
                await adminUpsertStaff({ data: { email: staffEmail, role: staffRole } });
                setStaffEmail("");
              }, "Đã lưu vai trò nhân sự.")
            }
          >
            Lưu vai trò
          </button>
        </div>
        <ul className="mt-4 divide-y divide-line">
          {dir.staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="min-w-56 flex-1 font-medium">
                {s.email}
                {!s.has_logged_in && !s.hard_coded ? <span className="ml-2 text-xs text-subtle">(chưa đăng nhập)</span> : null}
              </span>
              {s.hard_coded ? (
                <span className="text-xs font-medium text-ok">Admin (cố định) · thấy tất cả</span>
              ) : (
                <>
                  <select
                    className={input}
                    value={s.role}
                    disabled={busy}
                    onChange={(e) => void run(() => adminUpsertStaff({ data: { email: s.email, role: e.target.value } }), "Đã đổi vai trò.")}
                  >
                    {ASSIGNABLE_STAFF_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL_VI[r]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className={btn} onClick={() => onEditGrants(`staff:${s.id}`)}>
                    {s.account_ids.length} tài khoản
                  </button>
                  <button type="button" className={btn} disabled={busy} onClick={() => void viewAs("staff", s.id)}>
                    Xem như người dùng này
                  </button>
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Gỡ ${s.email} khỏi AdsOps (mất mọi quyền)?`)) {
                        void run(() => adminRemoveStaff({ data: { id: s.id } }), "Đã gỡ nhân sự.");
                      }
                    }}
                  >
                    Gỡ
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {dir.unassigned_logins.length ? (
          <div className="mt-4 rounded-md bg-inset p-3">
            <p className="text-xs font-medium text-muted">Đã đăng nhập nhưng chưa có vai trò (không thấy gì):</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {dir.unassigned_logins.map((u) => (
                <li key={u.user_id}>
                  <button type="button" className={btn} onClick={() => setStaffEmail(u.email)}>
                    {u.email}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </article>

      <article className={card}>
        <h3 className="font-display text-lg font-medium tracking-tight">Tạo người dùng khách hàng</h3>
        <p className="mt-1 text-sm text-muted">
          Khách đăng nhập bằng tên đăng nhập (hoặc email) + mật khẩu tại trang đăng nhập → “Đăng nhập khách hàng”.
          Không gửi email. Mật khẩu tối thiểu 10 ký tự — tự gửi cho khách qua kênh riêng.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {(
            [
              ["username", "Tên đăng nhập", "text"],
              ["password", "Mật khẩu", "text"],
              ["display_name", "Tên hiển thị", "text"],
              ["email", "Email (tuỳ chọn)", "email"],
            ] as const
          ).map(([k, label, type]) => (
            <label key={k} className="flex flex-col gap-1 text-xs font-medium text-muted">
              {label}
              <input
                className={input}
                type={type}
                autoComplete="off"
                value={cu[k]}
                onChange={(e) => setCu({ ...cu, [k]: e.target.value })}
              />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Vai trò
            <select className={input} value={cu.role} onChange={(e) => setCu({ ...cu, role: e.target.value })}>
              {CLIENT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL_VI[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Khách hàng (công ty)
            <select className={input} value={cu.customer_id} onChange={(e) => setCu({ ...cu, customer_id: e.target.value })}>
              <option value="">—</option>
              {dir.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-4 text-xs font-medium text-muted">Tài khoản quảng cáo được xem (có thể cấp sau)</p>
        <div className="mt-2">
          <AccountChecklist accounts={accountOpts} picked={cuAccounts} onChange={setCuAccounts} />
        </div>
        <button
          type="button"
          className={cn(btnPrimary, "mt-4")}
          disabled={busy || !cu.username.trim() || cu.password.length < 10}
          onClick={() =>
            void run(async () => {
              await adminCreateClientUser({
                data: {
                  ...cu,
                  email: cu.email.trim() || null,
                  customer_id: cu.customer_id || null,
                  display_name: cu.display_name.trim() || null,
                  accountIds: cuAccounts,
                },
              });
              setCu({ username: "", password: "", display_name: "", email: "", role: "client_owner", customer_id: "" });
              setCuAccounts([]);
            }, "Đã tạo người dùng khách hàng.")
          }
        >
          Tạo người dùng
        </button>
      </article>

      <article className={card}>
        <h3 className="font-display text-lg font-medium tracking-tight">Người dùng khách hàng</h3>
        {dir.clients.length ? (
          <ul className="mt-3 divide-y divide-line">
            {dir.clients.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-56 flex-1">
                  <span className="font-medium">{c.username}</span>
                  {c.display_name ? <span className="text-muted"> · {c.display_name}</span> : null}
                  <span className="block text-xs text-subtle">
                    {c.customer_id ? customerName.get(c.customer_id) || c.customer_id : "Chưa gán khách hàng"} · đăng nhập gần nhất{" "}
                    {c.last_login_at ? formatSaigon(c.last_login_at) : "chưa"} · {c.active_sessions} phiên
                  </span>
                </span>
                <select
                  className={input}
                  value={c.role}
                  disabled={busy}
                  onChange={(e) => void run(() => adminUpdateClientUser({ data: { id: c.id, role: e.target.value } }), "Đã đổi vai trò.")}
                >
                  {CLIENT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL_VI[r]}
                    </option>
                  ))}
                </select>
                <select
                  className={input}
                  value={c.customer_id || ""}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() => adminUpdateClientUser({ data: { id: c.id, customer_id: e.target.value || null } }), "Đã gán khách hàng.")
                  }
                >
                  <option value="">— khách hàng —</option>
                  {dir.customers.map((cu2) => (
                    <option key={cu2.id} value={cu2.id}>
                      {cu2.name}
                    </option>
                  ))}
                </select>
                <button type="button" className={btn} onClick={() => onEditGrants(`client:${c.id}`)}>
                  {c.account_ids.length} tài khoản
                </button>
                <button type="button" className={btn} disabled={busy} onClick={() => void viewAs("client", c.id)}>
                  Xem như người dùng này
                </button>
                <button
                  type="button"
                  className={btn}
                  disabled={busy}
                  onClick={() => {
                    const pw = window.prompt(`Mật khẩu mới cho ${c.username} (tối thiểu 10 ký tự). Mọi phiên đang mở sẽ bị đăng xuất.`);
                    if (pw) void run(() => adminResetClientPassword({ data: { id: c.id, password: pw } }), "Đã đặt lại mật khẩu.");
                  }}
                >
                  Đặt lại mật khẩu
                </button>
                <button
                  type="button"
                  className={btn}
                  disabled={busy || !c.active_sessions}
                  onClick={() => void run(() => adminRevokeClientSessions({ data: { id: c.id } }), "Đã đăng xuất mọi phiên.")}
                >
                  Đăng xuất mọi phiên
                </button>
                <button
                  type="button"
                  className={btnDanger}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Xoá hẳn người dùng ${c.username}? Mọi quyền và phiên đăng nhập mất ngay.`)) {
                      void run(() => adminDeleteClientUser({ data: { id: c.id } }), "Đã xoá người dùng.");
                    }
                  }}
                >
                  Xoá
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">Chưa có người dùng khách hàng.</p>
        )}
      </article>
    </>
  );
}

function GrantsTab({
  dir,
  busy,
  run,
  accountOpts,
  target,
  setTarget,
}: {
  dir: AdminDirectory;
  busy: boolean;
  run: RunFn;
  accountOpts: AccountOpt[];
  target: string;
  setTarget: (v: string) => void;
}) {
  const current = useMemo(() => {
    const [kind, ...rest] = target.split(":");
    const id = rest.join(":");
    if (kind === "staff") return dir.staff.find((s) => s.id === id)?.account_ids || [];
    if (kind === "client") return dir.clients.find((c) => c.id === id)?.account_ids || [];
    return [];
  }, [dir, target]);
  const [picked, setPicked] = useState<string[]>(current);
  useEffect(() => setPicked(current), [current]);

  const staff = dir.staff.filter((s) => !s.hard_coded);
  return (
    <article className={card}>
      <h3 className="font-display text-lg font-medium tracking-tight">Chọn người → tick tài khoản</h3>
      <select className={cn(input, "mt-3 w-full max-w-lg")} value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">— chọn người —</option>
        <optgroup label="Khách hàng">
          {dir.clients.map((c) => (
            <option key={c.id} value={`client:${c.id}`}>
              {c.username}
              {c.display_name ? ` · ${c.display_name}` : ""} ({ROLE_LABEL_VI[c.role]})
            </option>
          ))}
        </optgroup>
        <optgroup label="Nội bộ">
          {staff.map((s) => (
            <option key={s.id} value={`staff:${s.id}`}>
              {s.email} ({ROLE_LABEL_VI[s.role]})
            </option>
          ))}
        </optgroup>
      </select>
      {target ? (
        <>
          <div className="mt-4">
            <AccountChecklist accounts={accountOpts} picked={picked} onChange={setPicked} />
          </div>
          <button
            type="button"
            className={cn(btnPrimary, "mt-4")}
            disabled={busy}
            onClick={() => {
              const [kind, ...rest] = target.split(":");
              void run(
                () => adminSetGrants({ data: { kind: kind as PrincipalKind, id: rest.join(":"), accountIds: picked } }),
                "Đã lưu quyền tài khoản (có hiệu lực ngay).",
              );
            }}
          >
            Lưu quyền
          </button>
        </>
      ) : null}
    </article>
  );
}

function AccountsTab({ dir, busy, run }: { dir: AdminDirectory; busy: boolean; run: RunFn }) {
  const [name, setName] = useState("");
  const sales = dir.staff.filter((s) => s.role === "sale");
  const staffEmail = new Map(dir.staff.map((s) => [s.id, s.email]));
  return (
    <>
      <article className={card}>
        <h3 className="font-display text-lg font-medium tracking-tight">Tài khoản quảng cáo</h3>
        <p className="mt-1 text-sm text-muted">
          Đổi Sale = chuyển giao từng tài khoản: Sale mới được cấp quyền tài khoản này, Sale cũ bị gỡ quyền trên tài khoản này.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-subtle">
                <th className="py-2 pr-2">Tài khoản</th>
                <th className="py-2 pr-2">Nền tảng</th>
                <th className="py-2 pr-2">Khách hàng</th>
                <th className="py-2 pr-2">Sale phụ trách</th>
                <th className="py-2">Được cấp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {dir.accounts.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-2">
                    {a.display_name}
                    <span className="block text-xs text-subtle">
                      {a.external_id || a.id} · {a.id}
                    </span>
                  </td>
                  <td className="py-2 pr-2">{a.platform}</td>
                  <td className="py-2 pr-2">
                    <select
                      className={input}
                      value={a.customer_id || ""}
                      disabled={busy}
                      onChange={(e) =>
                        void run(() => adminUpdateAdAccount({ data: { id: a.id, customer_id: e.target.value || null } }), "Đã gán khách hàng.")
                      }
                    >
                      <option value="">—</option>
                      {dir.customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      className={input}
                      value={a.sale_staff_id || ""}
                      disabled={busy}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        const from = a.sale_staff_id ? staffEmail.get(a.sale_staff_id) || "?" : "(chưa có)";
                        const to = next ? staffEmail.get(next) || "?" : "(bỏ trống)";
                        if (window.confirm(`Chuyển tài khoản "${a.display_name}" từ ${from} sang ${to}?`)) {
                          void run(() => adminUpdateAdAccount({ data: { id: a.id, sale_staff_id: next } }), "Đã chuyển Sale.");
                        }
                      }}
                    >
                      <option value="">—</option>
                      {sales.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.email}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 text-muted">{a.grant_count} người</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
      <article className={card}>
        <h3 className="font-display text-lg font-medium tracking-tight">Khách hàng (công ty)</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className={cn(input, "w-72")} placeholder="Tên khách hàng mới" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || !name.trim()}
            onClick={() =>
              void run(async () => {
                await adminUpsertCustomer({ data: { name } });
                setName("");
              }, "Đã tạo khách hàng.")
            }
          >
            Tạo
          </button>
        </div>
        <ul className="mt-3 divide-y divide-line">
          {dir.customers.map((c) => {
            const n = dir.accounts.filter((a) => a.customer_id === c.id).length;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="flex-1">
                  {c.name} <span className="text-xs text-subtle">· {n} tài khoản</span>
                </span>
                <button
                  type="button"
                  className={btn}
                  disabled={busy}
                  onClick={() => {
                    const next = window.prompt("Tên mới", c.name);
                    if (next && next.trim() && next !== c.name) {
                      void run(() => adminUpsertCustomer({ data: { id: c.id, name: next } }), "Đã đổi tên.");
                    }
                  }}
                >
                  Đổi tên
                </button>
                <button
                  type="button"
                  className={btnDanger}
                  disabled={busy || n > 0}
                  onClick={() => void run(() => adminDeleteCustomer({ data: { id: c.id } }), "Đã xoá khách hàng.")}
                >
                  Xoá
                </button>
              </li>
            );
          })}
        </ul>
      </article>
    </>
  );
}

function RequestsTab({
  requests,
  busy,
  run,
  accountName,
}: {
  requests: GrantRequestRow[];
  busy: boolean;
  run: RunFn;
  accountName: Map<string, string>;
}) {
  return (
    <article className={card}>
      <h3 className="font-display text-lg font-medium tracking-tight">Yêu cầu cấp quyền</h3>
      {requests.length ? (
        <ul className="mt-3 divide-y divide-line">
          {requests.map((r) => (
            <li key={r.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  <span className="font-medium">{r.requested_by}</span>
                  <span className="text-muted"> ({ROLE_LABEL_VI[r.requester_role] || r.requester_role}) xin cho </span>
                  <span className="font-medium">{r.target_label}</span>
                </span>
                <span className={cn("text-xs font-medium", r.status === "pending" ? "text-warn" : "text-muted")}>
                  {statusVi(r.status)} · {formatSaigon(r.created_at)}
                </span>
              </div>
              <p className="mt-1 text-muted">{r.ad_account_ids.map((id) => accountName.get(id) || id).join(", ")}</p>
              {r.note ? <p className="mt-1 text-xs text-subtle">Ghi chú: {r.note}</p> : null}
              {r.status === "pending" ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className={btnPrimary}
                    disabled={busy}
                    onClick={() => void run(() => adminDecideRequest({ data: { id: r.id, approve: true } }), "Đã duyệt.")}
                  >
                    Duyệt
                  </button>
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={busy}
                    onClick={() => {
                      const note = window.prompt("Lý do từ chối (tuỳ chọn)") ?? "";
                      void run(() => adminDecideRequest({ data: { id: r.id, approve: false, note } }), "Đã từ chối.");
                    }}
                  >
                    Từ chối
                  </button>
                </div>
              ) : r.decided_by ? (
                <p className="mt-1 text-xs text-subtle">
                  {r.decided_by} · {formatSaigon(r.decided_at)}
                  {r.decision_note ? ` · ${r.decision_note}` : ""}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">Chưa có yêu cầu.</p>
      )}
    </article>
  );
}

const ACTION_VI: Record<string, string> = {
  "grant.set": "Đặt quyền tài khoản",
  "grant.request_submitted": "Gửi yêu cầu cấp quyền",
  "grant.request_approved": "Duyệt yêu cầu",
  "grant.request_rejected": "Từ chối yêu cầu",
  "grant.request_cancelled": "Huỷ yêu cầu",
  "client.create": "Tạo người dùng khách",
  "client.update": "Sửa người dùng khách",
  "client.delete": "Xoá người dùng khách",
  "client.password_reset": "Đặt lại mật khẩu",
  "client.sessions_revoked": "Đăng xuất mọi phiên",
  "staff.create": "Thêm nhân sự",
  "staff.role_set": "Đổi vai trò nhân sự",
  "staff.remove": "Gỡ nhân sự",
  "staff.migrated": "Chuyển từ quyền cũ",
  "account.customer_set": "Gán khách hàng cho TKQC",
  "account.sale_transfer": "Chuyển Sale",
  "account.discovered": "TKQC mới (chỉ admin thấy)",
  "customer.create": "Tạo khách hàng",
  "customer.update": "Đổi tên khách hàng",
  "customer.delete": "Xoá khách hàng",
  "view_as.start": "Bắt đầu Xem như",
  "view_as.stop": "Kết thúc Xem như",
};

function AuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const load = useCallback(async (beforeId?: number) => {
    try {
      const next = await getAuditLog({ data: { limit: 100, beforeId } });
      setRows((prev) => (beforeId ? [...prev, ...next] : next));
      if (next.length < 100) setDone(true);
    } catch (err) {
      setError(errMsg(err, "Không tải được nhật ký."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <article className={card}>
      <h3 className="font-display text-lg font-medium tracking-tight">Nhật ký thay đổi quyền</h3>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-subtle">
              <th className="py-2 pr-2">Thời điểm (VN)</th>
              <th className="py-2 pr-2">Ai</th>
              <th className="py-2 pr-2">Việc</th>
              <th className="py-2 pr-2">Đối tượng</th>
              <th className="py-2">Chi tiết</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line align-top">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap py-2 pr-2">{formatSaigon(r.at)}</td>
                <td className="py-2 pr-2">{r.actor}</td>
                <td className="py-2 pr-2">{ACTION_VI[r.action] || r.action}</td>
                <td className="py-2 pr-2 text-muted">
                  {r.target_kind}:{r.target_id}
                </td>
                <td className="max-w-md break-words py-2 font-mono text-xs text-muted">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!done && rows.length ? (
        <button type="button" className={cn(btn, "mt-3")} onClick={() => void load(rows[rows.length - 1]?.id)}>
          Tải thêm
        </button>
      ) : null}
    </article>
  );
}

// ── sale / head_ads: request form ─────────────────────────────────────────────────────────────

function RequestPermissions() {
  const [dir, setDir] = useState<RequestDirectory | null>(null);
  const [clientId, setClientId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    try {
      setDir(await getRequestDirectory());
    } catch (err) {
      setError(errMsg(err, "Không tải được dữ liệu."));
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const accountName = useMemo(() => new Map((dir?.accounts || []).map((a) => [a.id, a.display_name])), [dir]);

  async function submit() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await submitGrantRequestFn({ data: { clientUserId: clientId, accountIds: picked, note } });
      setPicked([]);
      setNote("");
      setNotice("Đã gửi yêu cầu. Admin sẽ duyệt.");
      await reload();
    } catch (err) {
      setError(errMsg(err, "Không gửi được yêu cầu."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <article className={card}>
        <h2 className="font-display text-xl font-medium tracking-tight">Xin cấp quyền cho khách hàng</h2>
        <p className="mt-1 text-sm text-muted">
          Chọn người dùng khách hàng và tài khoản (trong số tài khoản bạn được giao). Chỉ admin duyệt; người dùng khách hàng mới do
          admin tạo.
        </p>
        {!dir ? (
          <p className="mt-3 text-sm text-muted">Đang tải…</p>
        ) : (
          <>
            <select className={cn(input, "mt-3 w-full max-w-lg")} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— chọn người dùng khách hàng —</option>
              {dir.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.username}
                  {c.display_name ? ` · ${c.display_name}` : ""}
                </option>
              ))}
            </select>
            <div className="mt-3">
              <AccountChecklist accounts={dir.accounts} picked={picked} onChange={setPicked} />
            </div>
            <input className={cn(input, "mt-3 w-full")} placeholder="Ghi chú cho admin (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} />
            {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
            {notice ? <p className="mt-3 text-sm text-ok">{notice}</p> : null}
            <button type="button" className={cn(btnPrimary, "mt-3")} disabled={busy || !clientId || !picked.length} onClick={() => void submit()}>
              Gửi yêu cầu
            </button>
          </>
        )}
      </article>
      <article className={card}>
        <h3 className="font-display text-lg font-medium tracking-tight">Yêu cầu của tôi</h3>
        {dir?.my_requests.length ? (
          <ul className="mt-3 divide-y divide-line">
            {dir.my_requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="flex-1">
                  <span className="font-medium">{r.target_label}</span>
                  <span className="text-muted"> · {r.ad_account_ids.map((id) => accountName.get(id) || id).join(", ")}</span>
                  <span className="block text-xs text-subtle">
                    {statusVi(r.status)} · {formatSaigon(r.created_at)}
                    {r.decision_note ? ` · ${r.decision_note}` : ""}
                  </span>
                </span>
                {r.status === "pending" ? (
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={busy}
                    onClick={() =>
                      void cancelGrantRequestFn({ data: { id: r.id } })
                        .then(reload)
                        .catch((err) => setError(errMsg(err, "Không huỷ được.")))
                    }
                  >
                    Huỷ
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">Chưa có yêu cầu.</p>
        )}
      </article>
    </section>
  );
}
