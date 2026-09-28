#!/usr/bin/env bash
set -x
npm ci --no-audit --no-fund >/dev/null 2>&1 || echo NPM_CI_FAILED
rg --version >/dev/null 2>&1 || sudo apt-get install -y ripgrep >/dev/null 2>&1
rg -n "snapshots/" src --glob '!src/lib/adsops/snapshots/**' | head -50
rg -n "compare|prev" src/lib/adsops/warehouse.server.ts | head -80
rg -n "export (async )?function|export const|createServerFn" src/lib/adsops/*.functions.ts src/lib/adsops/warehouse.server.ts src/lib/adsops/access.server.ts src/lib/adsops/analytics.ts
rg -n "ST|nhãn|saveClassify|onSave|Lưu" src/components/adsops/classify-view.tsx | head -40
wc -c src/components/adsops/*.tsx src/lib/adsops/*.ts
npx tsc --noEmit 2>&1 | tail -20
