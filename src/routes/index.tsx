import { createFileRoute } from "@tanstack/react-router";
import { AdsOpsApp } from "@/components/adsops/app-shell";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <div className="min-h-screen bg-bg px-6 py-16 text-center text-sm text-muted">
        Đang mở phiên…
      </div>
    );
  }
  if (!user) return <RedirectToSignIn />;
  return <AdsOpsApp />;
}
