export function money(value: number | null | undefined, currency = "VND") {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Math.round(Number(value));
  return `${n.toLocaleString("vi-VN")} ${currency}`;
}

export function moneyPlain(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString("vi-VN");
}

export function num(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString("vi-VN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function pct(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${(Number(value) * 100).toLocaleString("vi-VN", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  })}%`;
}

export function hoursLabel(value: number | null | undefined) {
  if (value == null) return "—";
  if (value <= 0) return "đã hết";
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} giờ`;
}

export function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function formatRange(start: string, end: string) {
  if (start === end) return start;
  return `${start} → ${end}`;
}

export function formatRangeVi(start: string, end: string) {
  const a = start.split("-");
  const b = end.split("-");
  if (a.length !== 3 || b.length !== 3) return formatRange(start, end);
  const [ys, ms, ds] = a;
  const [ye, me, de] = b;
  if (start === end) return `${ds}/${ms}/${ys}`;
  if (ys === ye && ms === me) return `${ds}–${de}/${me}/${ye}`;
  if (ys === ye) return `${ds}/${ms}–${de}/${me}/${ye}`;
  return `${ds}/${ms}/${ys} → ${de}/${me}/${ye}`;
}

export function statusVi(raw?: string) {
  const code = String(raw || "").toUpperCase();
  if (code === "ENABLED" || code === "ACTIVE") return "Đang chạy";
  if (code === "PAUSED") return "Tạm dừng";
  if (code === "REMOVED") return "Đã gỡ";
  if (code === "ENDED") return "Kết thúc";
  return raw || "—";
}
