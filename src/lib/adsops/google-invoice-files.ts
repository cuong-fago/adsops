import { cidDigits, normMst, parseInvoiceCsv, parseInvoiceText, type ParsedDoc } from "./google-invoices.ts";

/**
 * Reading Google billing-document files (browser upload and /api/invoices/ingest share this).
 * A Google zip carries <docno>.pdf and, for VN tax invoices, <docno>.xml (the signed e-invoice).
 * The XML is the legal record, so its fields win; the PDF only fills what the XML lacks.
 */

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] || "",
  );
const tag = (xml: string | null | undefined, name: string): string | null => {
  if (!xml) return null;
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  const v = m ? unescape(m[1]).trim() : "";
  return v || null;
};

/** Vietnamese e-invoice XML (TT78 / NĐ123 schema: HDon > DLHDon). Null when the file isn't one. */
export function parseInvoiceXml(xml: string, fileName: string): ParsedDoc | null {
  const body = tag(xml, "DLHDon") ? /<DLHDon[\s\S]*?<\/DLHDon>/.exec(xml)![0] : null;
  if (!body) return null;
  const head = tag(body, "TTChung");
  const form = tag(head, "KHMSHDon");
  const serial = tag(head, "KHHDon");
  const no = tag(head, "SHDon");
  const date = tag(head, "NLap");
  const buyer = tag(body, "NMua");
  const totals = tag(body, "TToan");
  // TgTTTBSo = tổng tiền thanh toán (đã gồm thuế GTGT) — the amount Google shows for the document.
  const total = tag(totals, "TgTTTBSo");
  const amount = total != null && Number.isFinite(Number(total)) ? Number(total) : null;
  const notes: string[] = [];
  const doc_no = form && serial && no ? `${form}${serial}-${Number(no)}` : null;
  if (!doc_no) notes.push("XML thiếu ký hiệu/số hoá đơn");
  const issue_date = date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null;
  if (!issue_date) notes.push("XML thiếu ngày lập");
  if (amount == null) notes.push("XML thiếu tổng tiền thanh toán");
  const cidM = /\b(\d{3}-\d{3}-\d{4})\b/.exec(tag(body, "DSHHDVu") || "");
  return {
    file_name: fileName,
    doc_no,
    doc_type: "vn_tax",
    issue_date,
    amount,
    currency: tag(head, "DVTTe") || "VND",
    cid: cidM ? cidDigits(cidM[1]) : null,
    buyer_name: tag(buyer, "Ten"),
    buyer_mst: normMst(tag(buyer, "MST")),
    note: notes.length ? notes.join("; ") : null,
  };
}

async function pdfDoc(name: string, bytes: Uint8Array): Promise<ParsedDoc> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return parseInvoiceText(Array.isArray(text) ? text.join("\n") : String(text), name);
}

const baseOf = (n: string) => n.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, "").toUpperCase();
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Item = { doc: ParsedDoc; src: "xml" | "pdf" | "csv"; group: string };

/** XML first, PDF only fills nulls. Same-named pdf+xml (one zip entry pair) become one document. */
function merge(items: Item[]): ParsedDoc[] {
  const out: ParsedDoc[] = [];
  const byKey = new Map<string, { doc: ParsedDoc; xml: boolean }>();
  const fill = (a: ParsedDoc, b: ParsedDoc) => {
    for (const k of ["doc_no", "issue_date", "amount", "currency", "cid", "buyer_name", "buyer_mst"] as const) {
      if (a[k] == null && b[k] != null) (a as Record<string, unknown>)[k] = b[k];
    }
  };
  const ordered = [...items.filter((i) => i.src === "xml"), ...items.filter((i) => i.src !== "xml")];
  for (const it of ordered) {
    if (it.src === "csv") { out.push(it.doc); continue; }
    const key = it.doc.doc_no ? `no:${it.doc.doc_no.toUpperCase()}` : `f:${it.group}`;
    const alt = `f:${it.group}`;
    const hit = byKey.get(key) || byKey.get(alt);
    if (hit) {
      if (hit.xml) {
        fill(hit.doc, it.doc);
        hit.doc.file_name = `${hit.doc.file_name} + ${it.doc.file_name.replace(/^.*[\\/]/, "")}`;
      } else fill(hit.doc, it.doc);
      continue;
    }
    const rec = { doc: { ...it.doc }, xml: it.src === "xml" };
    out.push(rec.doc);
    byKey.set(key, rec);
    byKey.set(alt, rec);
  }
  return out;
}

/** Read zip / pdf / xml / csv files into documents. Unreadable files go to errors, never guessed. */
export async function readInvoiceFiles(files: Array<{ name: string; bytes: Uint8Array }>): Promise<{ docs: ParsedDoc[]; errors: string[] }> {
  const items: Item[] = [];
  const errors: string[] = [];
  const one = async (name: string, bytes: Uint8Array, zip: string) => {
    const lower = name.toLowerCase();
    const group = `${zip}|${baseOf(name)}`;
    try {
      if (lower.endsWith(".xml")) {
        const d = parseInvoiceXml(new TextDecoder("utf-8").decode(bytes), name);
        if (d) items.push({ doc: d, src: "xml", group });
        else errors.push(`${name}: không phải XML hoá đơn điện tử`);
      } else if (lower.endsWith(".pdf")) items.push({ doc: await pdfDoc(name, bytes), src: "pdf", group });
      else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
        for (const d of parseInvoiceCsv(new TextDecoder("utf-8").decode(bytes), name)) items.push({ doc: d, src: "csv", group });
      } else if (lower.endsWith(".zip")) {
        const { unzipSync } = await import("fflate");
        const inner = unzipSync(bytes);
        for (const [n, b] of Object.entries(inner)) if (!n.endsWith("/") && !n.startsWith("__MACOSX")) await one(n, b, name);
      } else errors.push(`${name}: định dạng chưa hỗ trợ (cần .zip, .pdf, .xml hoặc .csv)`);
    } catch (e) {
      if (lower.endsWith(".pdf")) pdfFail.push({ group, msg: `${name}: không đọc được (${errText(e)})` });
      else errors.push(`${name}: không đọc được (${errText(e)})`);
    }
  };
  const pdfFail: Array<{ group: string; msg: string }> = [];
  for (const f of files) await one(f.name, f.bytes, f.name);
  // A PDF that failed next to its XML twin loses nothing: the XML already has every field.
  const xmlGroups = new Set(items.filter((i) => i.src === "xml").map((i) => i.group));
  for (const f of pdfFail) if (!xmlGroups.has(f.group)) errors.push(f.msg);
  return { docs: merge(items), errors };
}
