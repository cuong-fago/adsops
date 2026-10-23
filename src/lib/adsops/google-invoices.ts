/** Hóa đơn Google: pure helpers shared by server, UI and tests (no I/O). */

export type InvoiceDocType = "vn_tax" | "invoice" | "credit_memo" | "other";

export const DOC_TYPE_VI: Record<InvoiceDocType, string> = {
  vn_tax: "Hoá đơn thuế tại Việt Nam",
  invoice: "Hóa đơn",
  credit_memo: "Giấy báo có",
  other: "Khác",
};

export type InvoiceRow = {
  doc_no: string;
  doc_type: InvoiceDocType;
  cid: string | null;
  client_id: string | null;
  issue_date: string | null;
  amount: number | null;
  currency: string | null;
  source: "api" | "upload";
  file_name: string | null;
};

/** A document read from an uploaded file, before it is saved. Missing fields stay null. */
export type ParsedDoc = {
  file_name: string;
  doc_no: string | null;
  doc_type: InvoiceDocType;
  issue_date: string | null;
  amount: number | null;
  currency: string | null;
  cid: string | null;
  /** Buyer (bên mua) name and tax code as printed on the document; null when not found. */
  buyer_name: string | null;
  buyer_mst: string | null;
  note: string | null;
};

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/** "2026-10" -> { year: 2026, month: "OCTOBER" } (Google MonthOfYear enum). */
export function issueMonthEnum(ym: string): { year: number; month: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const i = Number(m[2]);
  if (i < 1 || i > 12) return null;
  return { year: Number(m[1]), month: MONTHS[i - 1] };
}

export function isYm(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function cidDigits(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 10 ? d : null;
}

export function dashCid(d: string): string {
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;
}

/** Money text (VN or EN grouping) -> number; null when not a number. */
export function parseMoney(raw: string): number | null {
  let s = String(raw || "").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let norm: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const grp = dec === "." ? "," : ".";
    norm = s.split(grp).join("").replace(dec, ".");
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
    if (!sep) norm = s;
    else {
      const parts = s.split(sep);
      // 1.100.000 / 1,100,000 = thousands; 12,5 / 12.50 = decimal.
      const grouped = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
      norm = grouped ? parts.join("") : `${parts[0]}.${parts[1]}`;
    }
  }
  const n = Number(norm);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const pad = (n: number) => String(n).padStart(2, "0");
function ymd(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
const EN_MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** First date in a text fragment, any of the formats Google uses in VN/EN documents. */
export function findDate(t: string): string | null {
  const s = t.replace(/\s+/g, " ");
  let m: RegExpExecArray | null;
  const hits: { at: number; v: string }[] = [];
  const push = (at: number, v: string | null) => { if (v) hits.push({ at, v }); };
  const r1 = /ng[àa]y\s*(?:\([^)]*\))?\s*(\d{1,2})\s*th[áa]ng\s*(?:\([^)]*\))?\s*(\d{1,2})\s*n[ăa]m\s*(?:\([^)]*\))?\s*(\d{4})/gi;
  while ((m = r1.exec(s))) push(m.index, ymd(+m[3], +m[2], +m[1]));
  const r2 = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g;
  while ((m = r2.exec(s))) push(m.index, ymd(+m[3], +m[2], +m[1]));
  const r3 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = r3.exec(s))) push(m.index, ymd(+m[1], +m[2], +m[3]));
  const r4 = /\b(\d{1,2})\s*thg\s*(\d{1,2}),?\s*(\d{4})/gi;
  while ((m = r4.exec(s))) push(m.index, ymd(+m[3], +m[2], +m[1]));
  const r5 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/gi;
  while ((m = r5.exec(s))) push(m.index, ymd(+m[3], EN_MON[m[1].toLowerCase()], +m[2]));
  const r6 = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})/gi;
  while ((m = r6.exec(s))) push(m.index, ymd(+m[3], EN_MON[m[2].toLowerCase()], +m[1]));
  hits.sort((a, b) => a.at - b.at);
  return hits[0]?.v ?? null;
}

/** Text right after the first keyword that matches (case-insensitive), up to `len` chars. */
function after(text: string, keys: RegExp[], len = 160): string | null {
  for (const k of keys) {
    const m = k.exec(text);
    if (m) return text.slice(m.index + m[0].length, m.index + m[0].length + len);
  }
  return null;
}

const MONEY_RE = /-?\(?[₫$€]?\s*\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/;
const VN_SERIAL_RE = /\b([12][CK]\d{2}[TDLMNBGHX][A-Z0-9]{2,3})\b/;

function moneyAfter(text: string, keys: RegExp[]): number | null {
  const tail = after(text, keys, 120);
  if (!tail) return null;
  const m = MONEY_RE.exec(tail.replace(/\u00a0/g, " "));
  return m ? parseMoney(m[0].replace(/\s/g, "")) : null;
}

function currencyOf(text: string): string | null {
  if (/₫|\bVND\b|đồng/i.test(text)) return "VND";
  if (/\bUSD\b|US\$/.test(text)) return "USD";
  return null;
}

/** Reads one document's text (PDF text or CSV-free text). Leaves unknown fields null; never guesses numbers. */
export function parseInvoiceText(text: string, fileName: string): ParsedDoc {
  const t = text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, "");
  const serial = VN_SERIAL_RE.exec(t)?.[1] || VN_SERIAL_RE.exec(base)?.[1] || null;
  const isVn = Boolean(serial) || /gi[áa] tr[ịi] gia t[ăa]ng|k[ýy] hi[ệe]u\s*(\(serial\))?/i.test(t);
  let doc_no: string | null = null;
  let doc_type: InvoiceDocType = "invoice";
  const notes: string[] = [];
  if (isVn) {
    doc_type = "vn_tax";
    const fromName = /([12][CK]\d{2}[A-Z]{3,4})[-_ ]?(\d{1,8})/.exec(base);
    const num = /\bS[ốo]\s*(?:\((?:No|Invoice No)\.?\)\s*)?[:：]?\s*(\d{1,10})\b/i.exec(t)?.[1] || null;
    if (serial && num) doc_no = `${serial}-${Number(num)}`;
    else if (fromName) doc_no = `${fromName[1]}-${Number(fromName[2])}`;
    if (!doc_no) notes.push("Không đọc được ký hiệu/số hoá đơn thuế");
  } else {
    const m = /\b(\d{10}-\d{1,3})\b/.exec(t) || /\b(\d{10}-\d{1,3})\b/.exec(base);
    if (m) doc_no = m[1];
    else {
      const k = after(t, [/(?:s[ốo] h[óo]a đ[ơo]n|invoice number|s[ốo] ch[ứu]ng t[ừu])\s*[:：]?/i], 40);
      const v = k ? /([A-Z0-9][A-Z0-9-]{4,})/i.exec(k)?.[1] : null;
      if (v) doc_no = v;
    }
    if (/credit memo|gi[ấa]y b[áa]o c[óo]|ghi c[óo]/i.test(t)) doc_type = "credit_memo";
    if (!doc_no) notes.push("Không đọc được số chứng từ");
  }
  const dateTail = after(t, [/ng[àa]y l[ậa]p(?: h[óo]a đ[ơo]n)?/i, /ng[àa]y h[óo]a đ[ơo]n/i, /invoice date/i, /ng[àa]y ph[áa]t h[àa]nh/i, /issue date/i], 80);
  const issue_date = (dateTail && findDate(dateTail)) || findDate(t);
  if (!issue_date) notes.push("Không đọc được ngày");
  const amount = moneyAfter(t, [
    /t[ổo]ng (?:c[ộo]ng )?ti[ềe]n thanh to[áa]n\s*(?:\([^)]*\))?\s*[:：]?/i,
    /t[ổo]ng s[ốo] ti[ềe]n(?: thanh to[áa]n| ph[ảa]i tr[ảa])?\s*(?:\([^)]*\))?\s*[:：]?/i,
    /total amount(?: due)?\s*(?:\([^)]*\))?\s*[:：]?/i,
    /amount due\s*[:：]?/i,
    /t[ổo]ng c[ộo]ng\s*(?:\([^)]*\))?\s*[:：]?/i,
  ]);
  if (amount == null) notes.push("Không đọc được số tiền");
  const cidM = /(?:m[ãa] kh[áa]ch h[àa]ng|customer id|id t[àa]i kho[ảa]n|account id)[^\d]{0,20}(\d{3}-\d{3}-\d{4})/i.exec(t) || /\b(\d{3}-\d{3}-\d{4})\b/.exec(t);
  return {
    file_name: fileName,
    doc_no,
    doc_type,
    issue_date,
    amount,
    currency: currencyOf(t),
    cid: cidM ? cidDigits(cidM[1]) : null,
    ...parseBuyer(t),
    note: notes.length ? notes.join("; ") : null,
  };
}

/** Vietnamese MST: 10 digits, optional -3 branch suffix. Returns the normalized form or null. */
export function normMst(v: unknown): string | null {
  const m = /(?:^|\D)(\d{10})(?:-(\d{3}))?(?!\d)/.exec(String(v ?? "").replace(/[\s.]/g, ""));
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

/**
 * Buyer block of a VN tax invoice / Google document: the first MST and company name after a buyer
 * heading ("Người mua", "Đơn vị mua", "Bill to", "Buyer"...). Seller details printed before it are ignored.
 */
export function parseBuyer(text: string): { buyer_name: string | null; buyer_mst: string | null } {
  const t = text.replace(/\u00a0/g, " ");
  const anchor = /(ng[ưu][ờo]i mua(?: h[àa]ng)?|đ[ơo]n v[ịi] mua(?: h[àa]ng)?|b[êe]n mua|buyer|bill(?:ed)? to|th[ôo]ng tin kh[áa]ch h[àa]ng|customer information)/i.exec(t);
  if (!anchor) return { buyer_name: null, buyer_mst: null };
  const block = t.slice(anchor.index, anchor.index + 1200);
  const mstM = /(?:m[ãa] s[ốo] thu[ếe]|mst|tax (?:code|id|registration(?: number)?))\s*(?:\([^)]*\))?\s*[:：]?\s*([\d][\d\s.-]{8,16}\d)/i.exec(block);
  const nameM = /(?:t[êe]n đ[ơo]n v[ịi]|t[êe]n c[ôo]ng ty|t[êe]n ng[ưu][ờo]i mua|company(?: name)?|name)\s*(?:\([^)]*\))?\s*[:：]\s*([^\n]{3,160}?)(?=\s*(?:m[ãa] s[ốo] thu[ếe]|mst|tax|đ[ịi]a ch[ỉi]|address|\n|$))/i.exec(block);
  const name = nameM ? nameM[1].replace(/\s+/g, " ").trim().replace(/[,;:]$/, "") : null;
  return { buyer_name: name && /[A-Za-zÀ-ỹ]/.test(name) ? name : null, buyer_mst: mstM ? normMst(mstM[1].replace(/[\s.]/g, "")) : null };
}

/** One billing_setup snapshot: which payments profile (company) paid for an account and when. */
export type CompanyPeriod = {
  profile_id: string | null;
  profile_name: string | null;
  status: string;
  valid_from: string | null; // yyyy-mm-dd, null = unknown/open start
  valid_to: string | null; // yyyy-mm-dd inclusive, null = open
};

const LIVE_STATUSES = new Set(["APPROVED", "APPROVED_HELD"]);

/**
 * The company in effect for an account on a date. APPROVED setups count; a CANCELLED one counts only
 * when Google gives it a real start and end (it ran, then ended). Several matches: latest start wins.
 * Returns null when nothing covers the date (shown as "-").
 */
export function companyAt(periods: CompanyPeriod[], date: string | null): CompanyPeriod | null {
  if (!date) return null;
  const hits = periods.filter((p) => {
    if (!p.profile_id) return false;
    const usable = LIVE_STATUSES.has(p.status) || (p.status === "CANCELLED" && p.valid_from && p.valid_to && p.valid_from <= p.valid_to);
    if (!usable) return false;
    if (p.valid_from && date < p.valid_from) return false;
    if (p.valid_to && date > p.valid_to) return false;
    return true;
  });
  hits.sort((a, b) => (b.valid_from || "").localeCompare(a.valid_from || ""));
  return hits[0] || null;
}

/** Google billing_setup date-time ("2024-03-01 00:00:00", far-future end = open) -> yyyy-mm-dd or null. */
export function setupDate(v: unknown, isEnd = false): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  if (!m) return null;
  if (isEnd && Number(m[1]) >= 2037) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Minimal CSV reader (quotes, commas or semicolons or tabs). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\ufeff/, "");
  const first = src.split(/\r?\n/, 1)[0] || "";
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();

/** CSV export of Chứng từ -> documents. Columns found by header name; unknown cells stay null. */
export function parseInvoiceCsv(text: string, fileName: string): ParsedDoc[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map(fold);
  const col = (...re: RegExp[]) => head.findIndex((h) => re.some((r) => r.test(h)));
  const iNo = col(/so chung tu|so hoa don|document (number|id)|invoice (number|id)|^so$|^id$/, /chung tu|document|invoice/);
  const iDate = col(/ngay (lap|phat hanh|hoa don|chung tu)|issue date|invoice date|^ngay$|^date$/, /ngay|date/);
  const iType = col(/loai|^type$|document type/);
  const iAmt = col(/tong so tien|so tien|amount|total|tong/);
  const iCid = col(/ma khach hang|customer id|id tai khoan|account id/);
  const iCur = col(/tien te|currency/);
  const iBuyer = col(/ten (don vi|cong ty|nguoi mua|khach hang)|buyer|company name|ho so thanh toan|payments profile/);
  const iMst = col(/ma so thue|^mst|tax (code|id)/);
  const out: ParsedDoc[] = [];
  for (const r of rows.slice(1)) {
    const cell = (i: number) => (i >= 0 ? String(r[i] ?? "").trim() : "");
    const typeText = cell(iType);
    const no = cell(iNo) || null;
    const isVn = /thue|tax/i.test(fold(typeText)) || Boolean(no && VN_SERIAL_RE.test(no));
    const notes: string[] = [];
    const date = findDate(cell(iDate)) || null;
    const amt = cell(iAmt) ? parseMoney(cell(iAmt)) : null;
    if (!no) notes.push("Thiếu số chứng từ");
    if (!date) notes.push("Thiếu ngày");
    if (amt == null) notes.push("Thiếu số tiền");
    out.push({
      file_name: fileName,
      doc_no: no,
      doc_type: isVn ? "vn_tax" : /credit|bao co|ghi co/i.test(fold(typeText)) ? "credit_memo" : typeText || no ? "invoice" : "other",
      issue_date: date,
      amount: amt,
      currency: cell(iCur) || currencyOf(r.join(" ")),
      cid: cidDigits(cell(iCid)),
      buyer_name: cell(iBuyer) || null,
      buyer_mst: normMst(cell(iMst)),
      note: notes.length ? notes.join("; ") : null,
    });
  }
  return out;
}

/** Keeps the first document per number (case-insensitive, spaces removed). */
export function dedupeDocs<T extends { doc_no: string | null }>(docs: T[]): { kept: T[]; dropped: number } {
  const seen = new Set<string>();
  const kept: T[] = [];
  let dropped = 0;
  for (const d of docs) {
    const k = d.doc_no ? d.doc_no.replace(/\s+/g, "").toUpperCase() : "";
    if (k && seen.has(k)) { dropped++; continue; }
    if (k) seen.add(k);
    kept.push(d);
  }
  return { kept, dropped };
}

export function normDocNo(v: string): string {
  return v.replace(/\s+/g, "").toUpperCase().slice(0, 80);
}

export type AccountTotal = {
  /** Sum that the totals use; null = no countable document. */
  total: number | null;
  /** "vn_tax" = Hoá đơn thuế VN only; "invoice" = fell back to Hóa đơn/credit memo (no VN tax doc that month). */
  basis: "vn_tax" | "invoice" | null;
  counted: number;
};

/**
 * Totals per account for one month: only "Hoá đơn thuế tại Việt Nam" so each pair counts once.
 * An account with no VN tax document at all that month falls back to its Hóa đơn (+ credit memos),
 * flagged by basis = "invoice". Documents without an amount never count.
 */
export function accountTotal(rows: Pick<InvoiceRow, "doc_type" | "amount">[]): AccountTotal {
  const vn = rows.filter((r) => r.doc_type === "vn_tax" && r.amount != null);
  if (vn.length) return { total: vn.reduce((s, r) => s + (r.amount as number), 0), basis: "vn_tax", counted: vn.length };
  const inv = rows.filter((r) => (r.doc_type === "invoice" || r.doc_type === "credit_memo") && r.amount != null);
  if (inv.length) return { total: inv.reduce((s, r) => s + (r.amount as number), 0), basis: "invoice", counted: inv.length };
  return { total: null, basis: null, counted: 0 };
}

/** Whether a row is part of the account's counted total. */
export function rowCounted(row: Pick<InvoiceRow, "doc_type" | "amount">, basis: AccountTotal["basis"]): boolean {
  if (row.amount == null || !basis) return false;
  return basis === "vn_tax" ? row.doc_type === "vn_tax" : row.doc_type === "invoice" || row.doc_type === "credit_memo";
}
