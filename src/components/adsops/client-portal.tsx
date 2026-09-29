import { useEffect, useMemo, useState } from "react";
import { LogOut } from "lucide-react";
import { AnalyticsView } from "@/components/adsops/analytics-view";
import { ClientOverview } from "@/components/adsops/client-overview";
import { getWorkspacePack, setMyLanguage, type AccessSnap } from "@/lib/adsops/access.functions";
import type { AnalyticsSnap } from "@/lib/adsops/analytics";
import { isLang, t, type Lang } from "@/lib/adsops/client-i18n";
import { accountOptionLabel, compareAccountsByAlias } from "@/lib/adsops/account-label";
import { fmtDay } from "@/lib/adsops/client-overview";
import { formatSaigon } from "@/lib/adsops/permissions.types";
import { cn } from "@/lib/cn";

type ClientRow = { client_id: string; display_name: string; customer_id_dashed?: string; alias?: string | null };

type Loaded = {
  clientId: string;
  analytics: AnalyticsSnap | null;
  as_of: string | null;
  data_through: string | null;
};

const LANG_KEY = "adsops.lang";

function freshnessText(lang: Lang, asOf: string | null, through: string | null): string {
  const f = formatSaigon(asOf);
  if (f) {
    const [time, date] = f.split(" ");
    return t(lang, "fresh_time", { time, date });
  }
  if (through) return t(lang, "fresh_day", { date: fmtDay(through) });
  return "";
}

export function FagoMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <img src="/favicon.svg" alt="" className="size-8 rounded-lg" width={32} height={32} />
      <span className="leading-none">
        <span className="block font-display text-lg font-semibold tracking-tight text-ink">Fago Group</span>
      </span>
    </span>
  );
}

/**
 * Customer portal (client_owner / client_staff, or admin "view as" a customer).
 * One-screen overview for ONE granted ad account at a time + the Analytics tab.
 * Data comes from the same grant-filtered server function as staff screens;
 * compare/previous-period payloads are stripped server-side for these roles.
 */
export function ClientPortal({
  access,
  clients,
  onSignOut,
  onExitViewAs,
}: {
  access: AccessSnap;
  clients: ClientRow[];
  onSignOut: () => void;
  onExitViewAs: () => void;
}) {
  const [lang, setLang] = useState<Lang>(() => {
    if (isLang(access.lang)) return access.lang;
    if (typeof window !== "undefined") {
      const v = window.localStorage.getItem(LANG_KEY);
      if (isLang(v)) return v;
    }
    return "vi";
  });
  const [tab, setTab] = useState<"overview" | "analytics">("overview");
  const [clientId, setClientId] = useState(clients[0]?.client_id || "");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setError("");
    getWorkspacePack({ data: { clientId, modules: ["analytics"] } })
      .then((pack) => {
        if (cancelled) return;
        setLoaded({
          clientId,
          analytics: (pack.analytics as unknown as AnalyticsSnap | null) || null,
          as_of: pack.as_of,
          data_through: pack.data_through,
        });
      })
      .catch(() => {
        if (!cancelled) setError(t(lang, "load_error"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  function changeLang(next: Lang) {
    if (next === lang) return;
    setLang(next);
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      /* private mode */
    }
    // Per-user preference on the server (skipped while an admin is viewing-as).
    if (!access.read_only) void setMyLanguage({ data: { lang: next } }).catch(() => undefined);
  }

  const client = clients.find((c) => c.client_id === clientId);
  const pickerClients = useMemo(() => [...clients].sort(compareAccountsByAlias), [clients]);
  const ready = loaded && loaded.clientId === clientId;
  const snap = ready ? loaded.analytics : null;
  const fresh = ready ? freshnessText(lang, loaded.as_of, loaded.data_through) : "";
  const isRealClient = access.kind === "client" && !access.view_as;

  return (
    <div className="min-h-screen bg-bg text-ink">
      {access.view_as ? (
        <div className="bg-warn-bg px-4 py-2 text-sm text-warn">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <span>{t(lang, "view_as_banner", { label: access.view_as.label })}</span>
            <button
              type="button"
              onClick={onExitViewAs}
              className="h-9 rounded-md border border-line-strong bg-paper px-3 text-sm font-medium text-ink"
            >
              {t(lang, "exit_view_as")}
            </button>
          </div>
        </div>
      ) : null}

      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 md:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <FagoMark />
              <span className="hidden text-sm text-muted sm:inline">· {t(lang, "brand_sub")}</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                role="group"
                aria-label={t(lang, "lang_label")}
                className="inline-flex h-9 items-center rounded-full bg-inset p-0.5 text-xs font-semibold"
              >
                {(["vi", "en"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => changeLang(l)}
                    aria-pressed={lang === l}
                    className={cn(
                      "h-8 rounded-full px-3 uppercase transition-colors",
                      lang === l ? "bg-paper text-ink shadow-sm" : "text-muted hover:text-ink",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {isRealClient ? (
                <button
                  type="button"
                  onClick={onSignOut}
                  aria-label={t(lang, "sign_out")}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-sm font-medium text-ink hover:bg-inset"
                >
                  <LogOut className="size-4" />
                  <span className="hidden sm:inline">{t(lang, "sign_out")}</span>
                </button>
              ) : null}
            </div>
          </div>

          {clients.length ? (
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted md:w-[28rem]">
                {t(lang, "account")}
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="h-11 w-full min-w-0 truncate rounded-md border border-line bg-bg px-3 text-sm text-ink"
                >
                  {pickerClients.map((c) => (
                    <option key={c.client_id} value={c.client_id}>
                      {accountOptionLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
              <nav className="flex gap-1" aria-label="tabs">
                {(["overview", "analytics"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={cn(
                      "h-10 flex-1 rounded-full px-4 text-sm font-medium transition-colors md:flex-none",
                      tab === id ? "bg-accent text-accent-fg" : "bg-inset text-ink hover:bg-line",
                    )}
                  >
                    {t(lang, id === "overview" ? "tab_overview" : "tab_analytics")}
                  </button>
                ))}
              </nav>
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-6">
        {!clients.length ? (
          <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet">
            {t(lang, "no_accounts")}
          </section>
        ) : error ? (
          <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-danger shadow-sheet">{error}</section>
        ) : !ready ? (
          <p className="py-16 text-center text-sm text-muted">{t(lang, "loading")}</p>
        ) : !snap ? (
          <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet">
            {t(lang, "empty_none")}
          </section>
        ) : tab === "overview" ? (
          <ClientOverview key={`${clientId}:${snap.warehouse_end || ""}`} snap={snap} lang={lang} freshness={fresh} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {client?.alias ? `${client.alias} — ${client.display_name}` : client?.display_name} · {t(lang, "analytics_note")}
              {fresh ? <span className="font-medium"> · {fresh}</span> : null}
            </p>
            {(snap.daily?.account || []).length ? (
              <AnalyticsView key={snap.client_id} snap={snap} allowCompare={false} userKey={access.real_email || access.email} />
            ) : (
              <section className="rounded-xl bg-paper px-5 py-10 text-center text-sm text-muted shadow-sheet">
                {t(lang, "empty_none")}
              </section>
            )}
          </div>
        )}
        <p className="mt-8 text-center text-xs text-subtle">{t(lang, "footer")}</p>
      </main>
    </div>
  );
}
