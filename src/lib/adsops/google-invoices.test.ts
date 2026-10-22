import { test } from "node:test";
import assert from "node:assert/strict";
import { accountTotal, dedupeDocs, findDate, issueMonthEnum, parseInvoiceCsv, parseInvoiceText, parseMoney } from "./google-invoices.ts";

test("parseMoney", () => {
  assert.equal(parseMoney("1.100.000"), 1100000);
  assert.equal(parseMoney("₫1,100,000"), 1100000);
  assert.equal(parseMoney("1.100.000,50"), 1100000.5);
  assert.equal(parseMoney("12.50"), 12.5);
  assert.equal(parseMoney("abc"), null);
});

test("findDate", () => {
  assert.equal(findDate("Ngày (Date) 05 tháng (month) 10 năm (year) 2026"), "2026-10-05");
  assert.equal(findDate("Ngày lập: 07/09/2026"), "2026-09-07");
  assert.equal(findDate("Invoice date Oct 5, 2026"), "2026-10-05");
  assert.equal(findDate("5 thg 10, 2026"), "2026-10-05");
  assert.equal(findDate("nothing"), null);
});

test("VN tax invoice text", () => {
  const d = parseInvoiceText(
    "HÓA ĐƠN GIÁ TRỊ GIA TĂNG Ký hiệu (Serial): 1C26TGG Số (No.): 0003402833 Ngày (Date) 05 tháng (month) 10 năm (year) 2026 Mã khách hàng 153-987-9678 Tổng tiền thanh toán (Total payment): 1.100.000",
    "x.pdf",
  );
  assert.equal(d.doc_type, "vn_tax");
  assert.equal(d.doc_no, "1C26TGG-3402833");
  assert.equal(d.issue_date, "2026-10-05");
  assert.equal(d.amount, 1100000);
  assert.equal(d.cid, "1539879678");
  assert.equal(d.note, null);
});

test("Google Hóa đơn text and missing amount stays null", () => {
  const d = parseInvoiceText("Hóa đơn Số hóa đơn: 5720482500-2 Ngày lập hóa đơn 5 thg 10, 2026", "a.pdf");
  assert.equal(d.doc_type, "invoice");
  assert.equal(d.doc_no, "5720482500-2");
  assert.equal(d.issue_date, "2026-10-05");
  assert.equal(d.amount, null);
  assert.match(d.note || "", /số tiền/);
});

test("CSV", () => {
  const rows = parseInvoiceCsv('Số chứng từ,Ngày,Loại,Số tiền\n5720482500-2,05/10/2026,Hóa đơn,"1.000.000"\n1C26TGG-3402833,05/10/2026,Hoá đơn thuế tại Việt Nam,"1.100.000"\n', "c.csv");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].doc_type, "invoice");
  assert.equal(rows[1].doc_type, "vn_tax");
  assert.equal(rows[1].amount, 1100000);
});

test("dedupe + totals count only VN tax", () => {
  const { kept, dropped } = dedupeDocs([{ doc_no: "a-1" }, { doc_no: "A-1" }, { doc_no: null }]);
  assert.equal(kept.length, 2);
  assert.equal(dropped, 1);
  const t = accountTotal([
    { doc_type: "invoice", amount: 1000 },
    { doc_type: "vn_tax", amount: 1100 },
    { doc_type: "vn_tax", amount: null },
  ]);
  assert.deepEqual(t, { total: 1100, basis: "vn_tax", counted: 1 });
  assert.deepEqual(accountTotal([{ doc_type: "invoice", amount: 5 }]), { total: 5, basis: "invoice", counted: 1 });
  assert.deepEqual(accountTotal([]), { total: null, basis: null, counted: 0 });
  assert.deepEqual(issueMonthEnum("2026-10"), { year: 2026, month: "OCTOBER" });
});
