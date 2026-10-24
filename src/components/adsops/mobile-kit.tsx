import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Pull-to-refresh for touch screens (< md only). Pull down ≥ 70px while the page is at
 * the top → onRefresh(). Desktop never attaches listeners.
 */
export function usePullToRefresh(onRefresh: () => void): number {
  const [pull, setPull] = useState(0);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth >= 768 || !("ontouchstart" in window)) return;
    let start: number | null = null;
    let dist = 0;
    const down = (e: TouchEvent) => { start = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null; dist = 0; };
    const move = (e: TouchEvent) => {
      if (start == null) return;
      dist = Math.max(0, Math.min(110, (e.touches[0].clientY - start) * 0.6));
      setPull(dist);
    };
    const up = () => {
      if (start != null && dist >= 70) cb.current();
      start = null; dist = 0; setPull(0);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, []);
  return pull;
}

/** Small "Kéo để tải lại" badge shown while pulling (mobile). */
export function PullToRefresh({ onRefresh }: { onRefresh: () => void }) {
  const pull = usePullToRefresh(onRefresh);
  if (!pull) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-50 flex justify-center md:hidden" style={{ top: `calc(env(safe-area-inset-top) + ${8 + pull / 2}px)` }}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1.5 text-xs font-medium text-ink shadow-sheet">
        <RefreshCw className="size-3.5" style={{ transform: `rotate(${pull * 3}deg)` }} />
        {pull >= 70 ? "Thả để tải lại" : "Kéo xuống để tải lại"}
      </span>
    </div>
  );
}
