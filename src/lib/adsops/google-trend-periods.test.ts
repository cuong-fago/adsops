import { test } from "node:test";
import assert from "node:assert/strict";
import { trendPeriods, periodLabel, bucketOf } from "./google-trend-periods.ts";

test("kỳ liền trước: 4 equal windows ending at range", () => {
  const p = trendPeriods("2026-10-16", "2026-10-23", "prev");
  assert.deepEqual(p.map((x) => periodLabel(x.key, 2026)), ["22–29/09", "30/09–07/10", "08–15/10", "16–23/10"]);
  assert.ok(p.every((x) => x.days === 8));
});
test("cùng kỳ tháng trước: same days, clamp at month end", () => {
  assert.deepEqual(trendPeriods("2026-10-16", "2026-10-23", "mom").map((x) => periodLabel(x.key, 2026)), ["16–23/07", "16–23/08", "16–23/09", "16–23/10"]);
  const c = trendPeriods("2026-05-29", "2026-05-31", "mom");
  assert.equal(c.find((x) => x.start.startsWith("2026-02"))?.end, "2026-02-28");
  assert.ok(c.some((x) => x.clamped));
});
test("bucket maps dates to periods", () => {
  const b = bucketOf(trendPeriods("2026-10-16", "2026-10-23", "prev"));
  assert.equal(b("2026-10-01"), "2026-09-30_2026-10-07");
  assert.equal(b("2026-09-01"), null);
});
