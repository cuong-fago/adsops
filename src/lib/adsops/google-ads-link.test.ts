import { test } from "node:test";
import assert from "node:assert/strict";
import { cidOf, googleAdsUrl, parseOcid } from "./google-ads-link.ts";

test("cidOf: overview / detail row labels", () => {
  assert.equal(cidOf("444-791-2752 · MCC 532-145-0531"), "4447912752"); // MCC-imported row (the bug)
  assert.equal(cidOf("444-791-2752"), "4447912752"); // plain dashed
  assert.equal(cidOf("4447912752"), "4447912752");
  assert.equal(cidOf("MCC 532-145-0531"), null); // only the manager id
  assert.equal(cidOf("", "4447912752"), "4447912752"); // falls back to client id
  assert.equal(cidOf(null, "rock_kitchen"), null);
});

test("parseOcid keeps only ocid from ads.google.com", () => {
  assert.equal(parseOcid("https://ads.google.com/aw/overview?ocid=8188564074&ascid=8188564074&euid=1&__u=2&uscid=3&__c=4&authuser=0"), "8188564074");
  assert.equal(parseOcid("8188564074"), "8188564074");
  assert.equal(parseOcid("https://evil.example/?ocid=8188564074"), null);
  assert.equal(parseOcid("https://ads.google.com/aw/overview?authuser=0"), null);
});

test("googleAdsUrl: saved ocid → clean link; else __e chooser", () => {
  assert.equal(googleAdsUrl("444-791-2752 · MCC 532-145-0531", "8188564074"), "https://ads.google.com/aw/overview?ocid=8188564074");
  const def = googleAdsUrl("444-791-2752 · MCC 532-145-0531", null)!;
  assert.ok(def.includes(encodeURIComponent("__e=4447912752")));
  assert.ok(!/authuser|__u|euid|uscid|__c|ascid/.test(googleAdsUrl("444-791-2752", "8188564074")!));
});
