/** Shared chart styling (Recharts + hand-drawn SVG). Keep colours here, not inline in JSX. */
export const chartColors = {
  primary: "#2b8336", // brand hue, 4.8:1 on white (logo #3bb44a is too light for a thin line)
  brand: "#3bb44a",
  primarySoft: "#b2e6b9",
  grid: "#f3f4f6",
  axis: "#9ca3af",
  border: "#e5e7eb",
  ok: "#0f766e",
  warn: "#d97706",
  danger: "#dc2626",
  /** Categorical series, muted, ordered by priority. */
  series: ["#2b8336", "#0891b2", "#d97706", "#7c3aed", "#9ca3af"],
} as const;

export const chartTheme = {
  grid: { stroke: chartColors.grid, vertical: false },
  axisTick: { fontSize: 11, fill: chartColors.axis },
  axis: { tickLine: false, axisLine: false },
  line: { type: "monotone" as const, strokeWidth: 2, dot: false, activeDot: { r: 3, strokeWidth: 0 } },
  bar: { radius: [3, 3, 0, 0] as [number, number, number, number], maxBarSize: 28 },
  tooltip: {
    contentStyle: {
      borderRadius: 6,
      border: `1px solid ${chartColors.border}`,
      background: "#ffffff",
      boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
      fontSize: 12,
      fontVariantNumeric: "tabular-nums",
      padding: "6px 10px",
    },
    labelStyle: { color: "#6b7280", marginBottom: 2 },
    cursor: { stroke: chartColors.border, strokeWidth: 1 },
  },
};
