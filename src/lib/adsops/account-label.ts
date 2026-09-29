/** Local display alias for a Google Ads account. Pure helpers; no server imports. */

export const ACCOUNT_ALIAS_MAX = 80;

/** Trim, collapse whitespace, cap length. Empty string means "no alias". */
export function normalizeAccountAlias(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  return s.slice(0, ACCOUNT_ALIAS_MAX);
}

export function accountOptionLabel(c: {
  alias?: string | null;
  display_name: string;
  customer_id_dashed?: string | null;
}): string {
  const google = c.display_name || "";
  const id = (c.customer_id_dashed || "").trim();
  const idPart = id && id !== google ? ` · ${id}` : "";
  const alias = normalizeAccountAlias(c.alias);
  if (!alias) return `${google}${idPart}`;
  return `${alias} — ${google}${idPart}`;
}

/** Alias first (accounts with no alias sort by the Google name), then Google name. */
export function compareAccountsByAlias<T extends { alias?: string | null; display_name: string }>(a: T, b: T): number {
  const ka = normalizeAccountAlias(a.alias) || a.display_name || "";
  const kb = normalizeAccountAlias(b.alias) || b.display_name || "";
  const primary = ka.localeCompare(kb, "vi");
  if (primary) return primary;
  return (a.display_name || "").localeCompare(b.display_name || "", "vi");
}
