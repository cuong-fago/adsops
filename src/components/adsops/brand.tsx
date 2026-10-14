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
        "relative inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3.5 text-[15px] font-semibold transition-colors duration-150",
        "after:pointer-events-none after:absolute after:inset-x-2 after:-bottom-[7px] after:h-0.5 after:rounded-full after:transition-colors",
        active ? "bg-accent-soft text-accent after:bg-accent" : "text-ink/85 after:bg-transparent hover:bg-inset hover:text-ink",
      )}
    >
      {Icon ? <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-muted")} /> : null}
      {children}
      {badge ? (
        <span
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-danger px-1.5 text-[11px] font-bold tabular-nums text-white",
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}
