#!/usr/bin/env bash
rm -rf .grok/ops/dump; mkdir -p .grok/ops/dump
grep -n "adsops_kv" -A8 migrations/0005_rbac.sql | head -30
grep -nE "adsops_kv|^export (async )?function|^export type|^type |kind: \"client\"|kind: \"staff\"|principal" src/lib/adsops/permissions.server.ts | head -120
cat src/lib/adsops/principal-middleware.ts
grep -nE "^export|allowCompare|props|function ReportPanel|cadences|compare" src/components/adsops/side-panels.tsx | head -60
grep -n "getSql" -r src/lib/db* | head; ls src/lib
ls attachments | head -50; ls public/__grok | head
gzip -9c server-data/adsops/analytics/tkqc_5800099027.json | base64 -w0 > /tmp/d.b64; wc -c /tmp/d.b64; split -b 18000 -d -a 2 /tmp/d.b64 .grok/ops/dump/strip.b64.
