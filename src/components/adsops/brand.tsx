import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Logo mark + product name + "by Fago Group". */
export function BrandMark({ product = "AdsOps", by = "by Fago Group", className }: { product?: string; by?: string; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2.5", className)}>
      <img src="/favicon.svg" alt="" width={28} height={28} className="size-7 rounded-lg shadow-sm" />
      <span className="flex items-baseline gap-1.5 leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-ink">{product}</span>
        <span className="hidden text-xs font-medium text-subtle sm:inline">{by}</span>
      </span>
    </span>
  );
}

/** Underline tab used by the top navigation. */
export function NavTab({
  active,
  onClick,
  children,
  icon: Icon,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[15px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        active ? "bg-accent text-white shadow-sm" : "text-slate-800 hover:bg-slate-200/70 hover:text-slate-900",
      )}
    >
      {Icon ? <Icon className={cn("size-4 shrink-0", active ? "text-white" : "text-slate-600")} /> : null}
      {children}
      {badge ? (
        <span
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
            active ? "bg-white text-accent" : "bg-danger text-white",
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}
