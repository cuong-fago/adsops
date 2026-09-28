import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AdsOpsApp } from "@/components/adsops/app-shell";
import { getViewer, type ViewerSummary } from "@/lib/adsops/client-auth.functions";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  // Customer users have their own session cookie (not Better Auth).
  const [viewer, setViewer] = useState<ViewerSummary | undefined>(undefined);

  useEffect(() => {
    if (isPending || user) return;
    let cancelled = false;
    getViewer()
      .then((v) => {
        if (!cancelled) setViewer(v);
      })
      .catch(() => {
        if (!cancelled) setViewer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isPending, user]);

  if (isPending || (!user && viewer === undefined)) {
    return (
      <div className="min-h-screen bg-bg px-6 py-16 text-center text-sm text-muted">
        Đang mở phiên…
      </div>
    );
  }
  if (!user && !viewer) return <RedirectToSignIn />;
  return <AdsOpsApp />;
}
