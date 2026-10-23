/** "Xu hướng" comparison periods for non-month presets (pure; shared by server + UI). */
export type PeriodMode = "prev" | "mom";
export type TrendPeriod = { key: string; start: string; end: string; days: number; clamped: boolean };

const P = (s: string) => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
const F = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const T = (s: string) => Date.parse(`${s}T00:00:00Z`);
export const addDays = (s: string, n: number) => new Date(T(s) + n * 86400000).toISOString().slice(0, 10);
export const spanDays = (a: string, b: string) => Math.round((T(b) - T(a)) / 86400000) + 1;
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Same day-of-month n months earlier; clamps to month end (31/10 → 30/09). */
export function shiftMonths(s: string, n: number): { v: string; clamped: boolean } {
  const { y, m, d } = P(s);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const yy = t.getUTCFullYear(), mm = t.getUTCMonth() + 1, last = dim(yy, mm);
  return { v: F(yy, mm, Math.min(d, last)), clamped: d > last };
}
export const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(T(s));
/** Longest range for which "Cùng kỳ tháng trước" does not overlap itself. */
export const MOM_MAX_DAYS = 28;

/** Oldest → newest; last = the selected range. Always 4 periods (3 earlier + current). */
export function trendPeriods(start: string, end: string, mode: PeriodMode): TrendPeriod[] {
  const n = spanDays(start, end);
  const out: TrendPeriod[] = [];
  for (let i = 3; i >= 0; i--) {
    let s: string, e: string, clamped = false;
    if (mode === "prev") { s = addDays(start, -n * i); e = addDays(end, -n * i); }
    else { const a = shiftMonths(start, -i), b = shiftMonths(end, -i); s = a.v; e = b.v; clamped = a.clamped || b.clamped; }
    out.push({ key: `${s}_${e}`, start: s, end: e, days: spanDays(s, e), clamped });
  }
  return out;
}
export function bucketOf(periods: TrendPeriod[]): (date: string) => string | null {
  return (d) => { for (const p of periods) if (d >= p.start && d <= p.end) return p.key; return null; };
}
/** "16–23/10" / "30/09–07/10" / "23/10" (year when not the current year). */
export function periodLabel(key: string, thisYear = new Date().getUTCFullYear()): string {
  const [s, e] = key.split("_");
  if (!e) return key;
  const a = P(s), b = P(e);
  const dm = (x: { d: number; m: number }) => `${String(x.d).padStart(2, "0")}/${String(x.m).padStart(2, "0")}`;
  const yr = b.y !== thisYear ? `/${b.y}` : "";
  if (s === e) return `${dm(a)}${yr}`;
  return a.m === b.m && a.y === b.y ? `${String(a.d).padStart(2, "0")}–${dm(b)}${yr}` : `${dm(a)}${a.y !== b.y ? `/${a.y}` : ""}–${dm(b)}${yr}`;
}
