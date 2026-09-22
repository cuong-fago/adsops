import { useState } from "react";
import { Mail, TriangleAlert, Info } from "lucide-react";
import type { BudgetPace } from "@/lib/adsops/analytics";
import { hoursLabel, money } from "@/lib/adsops/format";
import { cn } from "@/lib/cn";

export type PacePreview = {
  client_id: string;
  display_name?: string;
  currency?: string;
  status: BudgetPace["status"];
  missing_label?: string;
  firing?: boolean;
  tickets: BudgetPace["tickets"];
  ok: BudgetPace["ok"];
  email: BudgetPace["email"];
};

export function BudgetBanner({
  pace,
  currency = "VND",
}: {
  pace: PacePreview;
  currency?: string;
}) {
  const [mailOpen, setMailOpen] = useState(false);
  if (!pace) return null;

  if (pace.status === "missing") {
    return (
      <section className="rounded-xl bg-paper px-4 py-3 shadow-sheet md:px-5">
        <p className="flex items-center gap-2 text-sm text-ink">
          <Info className="size-4 shrink-0 text-muted" />
          <span>
            <span className="font-medium">01 · Ngân sách 1 ngày</span>
            <span className="text-muted">
              {" "}
              — {pace.missing_label || "Thiếu dữ liệu"}. Không lấy chi ngày trước. Tách
              Guard.
            </span>
          </span>
        </p>
      </section>
    );
  }

  if (pace.status === "ok") {
    const row = pace.ok[0];
    return (
      <section className="rounded-xl bg-paper px-4 py-3 shadow-sheet md:px-5">
        <p className="text-sm text-ok">
          <span className="font-medium">01 · Ngân sách 1 ngày</span>
          <span>
            {" "}
            — không cảnh báo
            {row?.hours_remaining != null
              ? ` (còn khoảng ${hoursLabel(row.hours_remaining)})`
              : ""}
            . Tách Guard — không gộp stale / conv = 0 / coverage.
          </span>
        </p>
      </section>
    );
  }

  const ticket = pace.tickets[0];
  if (!ticket) return null;
  const names = ticket.campaigns.map((c) => c.name).join(", ");
  const email = pace.email;

  return (
    <section className="rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 shadow-sheet md:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-tight text-danger">
          <TriangleAlert className="size-4 shrink-0" />
          01 · Ngân sách 1 ngày sắp hết
        </p>
        <p className="text-sm text-ink">
          {ticket.label} · {names}
        </p>
        <span className="rounded-full bg-paper px-3 py-1 text-xs font-medium text-muted md:ml-auto">
          Tách Guard · không chặn đề xuất
        </span>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Stat label="NS ngày" value={money(ticket.daily_budget, currency)} />
        <Stat label="Chi hôm nay" value={money(ticket.cost_today, currency)} />
        <Stat label="Còn lại" value={money(ticket.remaining, currency)} />
        <Stat label="Còn khoảng" value={hoursLabel(ticket.hours_remaining)} warn />
      </dl>
      {email && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setMailOpen((v) => !v)}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-paper px-3 text-sm font-medium"
          >
            <Mail className="size-4 text-accent" />
            Email đã soạn — {email.status === "queued" ? "chờ gửi" : email.status}
            <span className="text-xs font-normal text-muted">
              {(email.to || []).join(", ") || "không có người nhận"}
            </span>
          </button>
          {mailOpen && (
            <div className="mt-2 rounded-md bg-paper px-3 py-3 text-sm">
              <p className="font-medium">{email.subject}</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-muted">{email.body}</pre>
              <p className="mt-2 text-xs text-subtle">{email.note}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("font-medium tabular-nums", warn && "text-danger")}>{value}</dd>
    </div>
  );
}
