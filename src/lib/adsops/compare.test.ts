import { test } from "node:test";
import assert from "node:assert/strict";
import { derive, groupLevel, median, suggestGroups, tone } from "./compare.types.ts";

test("derive keeps missing as null", () => {
  const m = derive({ clicks: null, cost: null, conversions: null });
  assert.equal(m.cpc, null); assert.equal(m.spend, null);
  assert.equal(derive({ clicks: 100, cost: 1000, conversions: 0 }).cpa, null);
});
test("median + weighted", () => {
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null);
  const a = { has_data: true, m: derive({ clicks: 100, cost: 1000, conversions: 10 }) };
  const b = { has_data: true, m: derive({ clicks: 100, cost: 3000, conversions: 10 }) };
  const g = groupLevel([a, b]);
  assert.equal(g.median.cpc, 20); // (10 + 30) / 2
  assert.equal(g.weighted.cpc, (1000 * 10 + 3000 * 30) / 4000); // spend-weighted
});
test("tone respects direction", () => {
  assert.equal(tone("cpc", 12, 10), "worse"); // +20% cost
  assert.equal(tone("cpc", 8, 10), "better");
  assert.equal(tone("cpc", 10.5, 10), null); // within 10%
  assert.equal(tone("cr", 0.05, 0.1), "worse"); // lower CR is worse
  assert.equal(tone("cr", 0.12, 0.1), "better");
  assert.equal(tone("spend", 1, 10), null); // volumes not judged
});
test("suggestGroups by client / company name", () => {
  const s = suggestGroups([
    { client_id: "1", names: ["Quỳnh Thanh - Search"] }, { client_id: "2", names: ["Quynh Thanh PMax"] },
    { client_id: "3", names: ["Gianphoi HN"] }, { client_id: "4", names: ["gianphoi.vn"] },
    { client_id: "5", names: ["Fago Group 0108755817"] }, { client_id: "6", names: ["Fago Group 0108755817 (2)"] },
    { client_id: "7", names: ["Một mình"] },
  ]);
  const sets = s.map((x) => x.members.sort().join(","));
  assert.ok(sets.includes("1,2")); assert.ok(sets.includes("3,4")); assert.ok(sets.includes("5,6"));
  assert.ok(!sets.some((x) => x.includes("7")));
});
