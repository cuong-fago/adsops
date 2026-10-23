import { createFileRoute } from "@tanstack/react-router";

/**
 * Box automation: POST Google billing-document files (zip / pdf / xml / csv) to store them
 * like a manual upload. Nothing is sent to Google.
 *
 * Auth: `Authorization: Bearer $INVOICE_INGEST_TOKEN` (constant-time compare). Without the env
 * the route refuses to run.
 * Form fields: one or more files (any field name), optional `cid` used for documents whose files
 * carry no customer ID (Google VN tax invoices don't print it).
 * Documents missing a field, or whose account can't be resolved, are reported and not stored.
 */
const MAX_BYTES = 40 * 1024 * 1024;

export function ingestAuthorized(request: Request): boolean {
  const secret = process.env.INVOICE_INGEST_TOKEN?.trim();
  if (!secret || secret.length < 32) return false;
  const got = request.headers.get("authorization") || "";
  const want = `Bearer ${secret}`;
  let diff = got.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= (got.charCodeAt(i) || 0) ^ want.charCodeAt(i);
  return diff === 0;
}

async function handle({ request }: { request: Request }): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status, headers });
  if (!process.env.INVOICE_INGEST_TOKEN?.trim()) return fail(503, "INVOICE_INGEST_TOKEN not configured");
  if (!ingestAuthorized(request)) return fail(401, "unauthorized");
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) return fail(413, "too large (max 40 MB per request)");

  let form: FormData;
  try { form = await request.formData(); } catch { return fail(400, "expected multipart/form-data"); }
  const { cidDigits, normDocNo } = await import("@/lib/adsops/google-invoices");
  const rawCid = form.get("cid");
  const formCid = typeof rawCid === "string" && rawCid.trim() ? cidDigits(rawCid) : null;
  if (typeof rawCid === "string" && rawCid.trim() && !formCid) return fail(400, "cid must be a 10-digit Google Ads customer ID");

  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  let total = 0;
  for (const [, v] of form.entries()) {
    if (typeof v === "string") continue;
    total += v.size;
    if (total > MAX_BYTES) return fail(413, "too large (max 40 MB per request)");
    files.push({ name: v.name || "file", bytes: new Uint8Array(await v.arrayBuffer()) });
  }
  if (!files.length) return fail(400, "no files");

  const { readInvoiceFiles } = await import("@/lib/adsops/google-invoice-files");
  const s = await import("@/lib/adsops/google-invoices.server");
  const { docs, errors } = await readInvoiceFiles(files);
  const byCid = new Map((await s.invoiceAccounts()).map((a) => [a.cid, a]));

  type Out = { file: string; doc_no: string | null; doc_type: string; issue_date: string | null; amount: number | null; currency: string | null; cid: string | null; account: string | null; buyer_name: string | null; buyer_mst: string | null; status: "saved" | "duplicate" | "skipped"; reason?: string; company?: string | null; company_mst?: string | null; mst_mismatch?: boolean };
  const out: Out[] = [];
  const toSave: Parameters<typeof s.saveUploaded>[0] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    const cid = d.cid || formCid;
    const acc = cid ? byCid.get(cid) : undefined;
    const o: Out = { file: d.file_name, doc_no: d.doc_no, doc_type: d.doc_type, issue_date: d.issue_date, amount: d.amount, currency: d.currency, cid, account: acc?.name || null, buyer_name: d.buyer_name, buyer_mst: d.buyer_mst, status: "skipped" };
    const missing = [!d.doc_no && "doc_no", !d.issue_date && "issue_date", d.amount == null && "amount", !cid && "cid"].filter(Boolean);
    if (d.cid && formCid && d.cid !== formCid) o.reason = `file CID ${d.cid} differs from cid field ${formCid}`;
    else if (missing.length) o.reason = `missing ${missing.join(", ")}${d.note ? ` (${d.note})` : ""}`;
    else if (!acc) o.reason = `CID ${cid} is not a Google account in AdsOps`;
    else if (seen.has(normDocNo(d.doc_no!))) { o.status = "duplicate"; o.reason = "repeated in this request"; }
    else {
      seen.add(normDocNo(d.doc_no!));
      toSave.push({ doc_no: d.doc_no!, doc_type: d.doc_type, client_id: acc.client_id, issue_date: d.issue_date!, amount: d.amount!, currency: d.currency, file_name: d.file_name.slice(0, 300), buyer_name: d.buyer_name, buyer_mst: d.buyer_mst });
    }
    out.push(o);
  }
  const r = toSave.length ? await s.saveUploaded(toSave, "ingest") : { saved: 0, duplicates: [] as string[], mst_filled: 0 };
  const dup = new Set(r.duplicates.map(normDocNo));
  for (const o of out) if (o.status === "skipped" && !o.reason) o.status = o.doc_no && dup.has(normDocNo(o.doc_no)) ? "duplicate" : "saved";
  for (const o of out) if (o.status === "duplicate" && !o.reason) o.reason = "already stored";
  const comp = await s.companiesFor(out.map((o) => ({ cid: o.cid, date: o.issue_date }))).catch(() => out.map(() => null));
  out.forEach((o, i) => {
    o.company = comp[i]?.name ?? null;
    o.company_mst = comp[i]?.mst ?? null;
    o.mst_mismatch = Boolean(o.buyer_mst && comp[i]?.mst && o.buyer_mst !== comp[i]!.mst);
  });
  return Response.json(
    {
      ok: true,
      files: files.length,
      documents: out.length,
      saved: out.filter((o) => o.status === "saved").length,
      duplicates: out.filter((o) => o.status === "duplicate").length,
      skipped: out.filter((o) => o.status === "skipped").length,
      mst_filled: r.mst_filled,
      errors,
      results: out,
    },
    { headers },
  );
}

export const Route = createFileRoute("/api/invoices/ingest")({
  server: { handlers: { POST: handle } },
});
