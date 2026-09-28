set -e
python3 - <<'PY'
p='src/lib/adsops/access.server.ts'
s=open(p).read()
if 'export function resolveDataDir(' not in s:
    assert 'function resolveDataDir(' in s
    s=s.replace('function resolveDataDir(', 'export function resolveDataDir(', 1)
    open(p,'w').write(s)
print('ok')
PY
grep -n "function resolveDataDir" -A3 src/lib/adsops/access.server.ts
cat .grok/read/ops.log.prev 2>/dev/null || true
