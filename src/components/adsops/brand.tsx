import type { ReactNode } from "react";
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
export function NavTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex h-11 shrink-0 items-center whitespace-nowrap px-3 text-sm font-medium transition-colors duration-150",
        "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors",
        active ? "text-ink after:bg-accent" : "text-muted after:bg-transparent hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
