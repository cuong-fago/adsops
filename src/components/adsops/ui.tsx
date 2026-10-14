import type { ButtonHTMLAttributes, ComponentType, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Shared visual primitives. Visual only: no data or permission logic here. */

export const cardClass = "rounded-xl bg-paper shadow-sheet";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(cardClass, "p-4 md:p-5", className)} {...rest} />;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-line bg-paper text-ink hover:bg-inset",
  ghost: "text-muted hover:bg-inset hover:text-ink",
  danger: "border border-danger-border bg-paper text-danger hover:bg-danger-bg",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3 text-sm",
        BUTTON[variant],
        className,
      )}
      {...rest}
    />
  );
}

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";
const BADGE: Record<Tone, { box: string; dot: string }> = {
  neutral: { box: "bg-inset text-muted", dot: "bg-subtle" },
  accent: { box: "bg-accent-soft text-accent", dot: "bg-accent" },
  ok: { box: "bg-ok-bg text-ok", dot: "bg-ok" },
  warn: { box: "bg-warn-bg text-warn", dot: "bg-warn" },
  danger: { box: "bg-danger-bg text-danger", dot: "bg-danger" },
};

/** 20px status badge, radius 4, optional 6px dot. */
export function Badge({ tone = "neutral", dot = true, className, children, title }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode; title?: string }) {
  const s = BADGE[tone];
  return (
    <span title={title} className={cn("inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-sm px-1.5 text-xs font-medium tabular-nums", s.box, className)}>
      {dot ? <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", s.dot)} /> : null}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-inset", className)} />;
}

/** Skeleton shaped like a table: header bar + N rows. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Đang tải" className="flex flex-col gap-2 p-1">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }, (_, j) => (
            <Skeleton key={j} className={cn("h-6", j === 0 ? "flex-[2]" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}>
      {Icon ? <Icon className="size-6 text-subtle" /> : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Không tải được dữ liệu", message, onRetry, className }: { title?: string; message?: ReactNode; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-2 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm", className)}>
      <p className="font-semibold text-danger">{title}</p>
      {message ? <p className="text-ink/80 [overflow-wrap:anywhere]">{message}</p> : null}
      {onRetry ? <Button size="sm" variant="danger" onClick={onRetry}>Thử lại</Button> : null}
    </div>
  );
}

/** 4px in-cell bar (0–1). Tone follows the semantic palette. */
export function MiniBar({ value, tone = "accent", className }: { value: number | null | undefined; tone?: Tone; className?: string }) {
  if (value == null || !Number.isFinite(value)) return null;
  const w = Math.max(0, Math.min(1, value)) * 100;
  const fill = tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : tone === "ok" ? "bg-ok" : tone === "neutral" ? "bg-subtle" : "bg-accent";
  return (
    <span aria-hidden className={cn("mt-1 block h-1 w-full max-w-[9rem] overflow-hidden rounded-sm bg-inset", className)}>
      <span className={cn("block h-full rounded-sm", fill)} style={{ width: `${w.toFixed(1)}%` }} />
    </span>
  );
}

/** 3px left accent bar for risky rows (apply to the first, sticky cell). */
export function riskBarClass(level: "red" | "amber" | null | undefined): string {
  return level === "red" ? "shadow-[inset_3px_0_0_var(--color-danger)]" : level === "amber" ? "shadow-[inset_3px_0_0_var(--color-warn)]" : "";
}

/** Coloured text with a 6px status dot (no background), for dense table cells. */
export function DotText({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  const s = BADGE[tone];
  const text = tone === "danger" ? "text-danger font-semibold" : tone === "warn" ? "text-warn font-medium" : tone === "ok" ? "text-ink" : tone === "accent" ? "text-accent" : "text-muted";
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 tabular-nums", text, className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
      {children}
    </span>
  );
}
