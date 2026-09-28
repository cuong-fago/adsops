#!/usr/bin/env bash
set -e
git apply --whitespace=nowarn .grok/ops/b.patch
rm -f .grok/ops/b.patch
git diff --stat
npx tsc --noEmit 2>&1 | grep -E 'error TS' | sed 's/(.*//' | sort | uniq -c || true
echo B-APPLIED
