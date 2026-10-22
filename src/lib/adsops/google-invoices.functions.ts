import { createServerFn } from "@tanstack/react-start";
import { principalMiddleware } from "./principal-middleware";
import { cidDigits, isYm, normDocNo, type InvoiceDocType } from "./google-invoices.ts";

export type { InvoiceMonth, InvoiceMonthRow, InvoiceAccountSum, ProbeResult, InvoiceAccount } from "./google-invoices.server.ts";

type Ctx = import("./permissions.server").AccessContext;
const rec = (d: unknown) => (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
const TYPES: InvoiceDocType[] = ["vn_tax", "invoice", "credit_memo", "other"];

/** Admin or Kế toán (the effective principal; Xem như a Kế toán shows the same read-only tab). */
async function assertInvoices(ctx: Ctx) {
  const { ForbiddenError } = await import("./permissions.server");
  if (ctx.principal.kind !== "staff" || !ctx.caps.invoices) throw new ForbiddenError("Chỉ Admin và Kế toán xem được Hóa đơn Google.");
}
async function assertInvoicesWrite(ctx: Ctx) {
  await assertInvoices(ctx);
  const { ForbiddenError } = await import("./permissions.server");
  if (ctx.viewAs || ctx.readOnly) throw new ForbiddenError("Đang Xem như — thoát chế độ xem để tải chứng từ lên.");
}

export const readInvoiceMonthFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const m = rec(d).month;
    if (!isYm(m)) throw new Error("Tháng không hợp lệ");
    return { month: m };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await assertInvoices(context.access);
    const s = await import("./google-invoices.server.ts");
    const [month, accounts] = await Promise.all([s.readInvoiceMonth(data.month), s.invoiceAccounts()]);
    const ctx = context.access;
    return {
      ...month,
      account_list: accounts,
      can_upload: !ctx.viewAs && !ctx.readOnly,
      can_probe: Boolean(ctx.real.isSuperAdmin && !ctx.viewAs && !ctx.readOnly && ctx.caps.grant),
    };
  });

/** Admin only: "Thử đọc chứng từ" (ListInvoices read) for one CID + month. */
export const probeInvoicesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const r = rec(d);
    const cid = cidDigits(r.cid);
    if (!cid) throw new Error("CID phải có 10 chữ số (vd. 153-987-9678).");
    if (!isYm(r.month)) throw new Error("Tháng không hợp lệ");
    return { cid, month: r.month as string, save: r.save === true };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    const { assertEffectiveAdmin } = await import("./permissions.server");
    assertEffectiveAdmin(context.access);
    const s = await import("./google-invoices.server.ts");
    const res = await s.probeInvoices(data.cid, data.month);
    let saved: number | null = null;
    if (data.save && res.ok) {
      const acc = (await s.invoiceAccounts()).find((a) => a.cid === data.cid);
      if (acc) saved = (await s.ingestAccount(acc, [data.month])).found;
    }
    return { ...res, saved };
  });

export const checkInvoiceDocsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const nos = Array.isArray(rec(d).docNos) ? (rec(d).docNos as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 2000) : [];
    return { docNos: nos };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await assertInvoices(context.access);
    return { existing: await (await import("./google-invoices.server.ts")).existingDocNos(data.docNos) };
  });

export const saveInvoiceDocsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const list = Array.isArray(rec(d).docs) ? (rec(d).docs as unknown[]) : [];
    if (!list.length || list.length > 2000) throw new Error("Không có chứng từ để lưu");
    return {
      docs: list.map((x) => {
        const r = rec(x);
        const doc_no = typeof r.doc_no === "string" ? normDocNo(r.doc_no) : "";
        const doc_type = TYPES.includes(r.doc_type as InvoiceDocType) ? (r.doc_type as InvoiceDocType) : null;
        const issue_date = typeof r.issue_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.issue_date) ? r.issue_date : null;
        const amount = typeof r.amount === "number" && Number.isFinite(r.amount) ? r.amount : null;
        const client_id = typeof r.client_id === "string" ? r.client_id : "";
        if (!doc_no || !doc_type || !issue_date || amount == null || !client_id) throw new Error(`Chứng từ ${doc_no || "?"} thiếu số, loại, ngày, số tiền hoặc tài khoản.`);
        return {
          doc_no,
          doc_type,
          issue_date,
          amount,
          client_id,
          currency: typeof r.currency === "string" ? r.currency.slice(0, 8) : null,
          file_name: typeof r.file_name === "string" ? r.file_name.replace(/\u0000/g, "").slice(0, 300) : null,
        };
      }),
    };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await assertInvoicesWrite(context.access);
    const { actorLabel } = await import("./permissions.server");
    return (await import("./google-invoices.server.ts")).saveUploaded(data.docs, actorLabel(context.access.real));
  });

export const deleteInvoiceDocFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const n = rec(d).docNo;
    if (typeof n !== "string" || !n.trim()) throw new Error("Thiếu số chứng từ");
    return { docNo: n };
  })
  .middleware([principalMiddleware])
  .handler(async ({ context, data }) => {
    await assertInvoicesWrite(context.access);
    return { deleted: await (await import("./google-invoices.server.ts")).deleteUploaded(data.docNo) };
  });
