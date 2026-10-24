import { useEffect } from "react";

/** Registers /sw.js (static shell cache + web push). Skipped in dev/preview iframes. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (import.meta.env.DEV || window.self !== window.top) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
