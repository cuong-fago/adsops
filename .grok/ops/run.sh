set -e
python3 - <<'PY'
def patch(path, old, new):
    s = open(path).read()
    assert old in s, (path, old[:60])
    open(path, 'w').write(s.replace(old, new, 1))
patch('src/lib/adsops/permissions.types.ts', '  detail: Record<string, unknown>;\n};\n\nexport type UnassignedLogin', '  /** JSON text of the change detail. */\n  detail: string;\n};\n\nexport type UnassignedLogin')
patch('src/lib/adsops/admin.server.ts', 'detail: (r.detail as Record<string, unknown>) || {} }));', 'detail: typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail ?? {}) }));')
patch('src/components/adsops/permissions-panel.tsx', '{JSON.stringify(r.detail)}', '{r.detail}')
print('ok')
PY
npx tsc --noEmit 2>&1 | grep -E 'error TS' | grep -v 'load-workspace-pack.snippet\|popup.server\|auth/server.ts\|auth-config\|debug-auth' || echo NO_NEW_TSC_ERRORS
