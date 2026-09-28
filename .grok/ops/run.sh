set -e
python3 - <<'PY'
def patch(path, pairs):
    s = open(path).read()
    for old, new, count in pairs:
        n = s.count(old)
        assert n >= 1, (path, old[:80], n)
        if count == 1:
            s = s.replace(old, new, 1)
        else:
            s = s.replace(old, new)
    open(path, 'w').write(s)

patch('src/components/adsops/analytics-view.tsx', [
  ('export function AnalyticsView({ snap }: { snap: AnalyticsSnap }) {',
   'export function AnalyticsView({ snap, allowCompare = true }: { snap: AnalyticsSnap; allowCompare?: boolean }) {', 1),
  ('const [prevEqual, setPrevEqual] = useState(true);', 'const [prevEqual, setPrevEqual] = useState(allowCompare);', 1),
  ('const prevRange = prevEqual ? previousEqualRange', 'const prevRange = allowCompare && prevEqual ? previousEqualRange', 1),
  ('const weeks = weekN ? previousWeeks', 'const weeks = allowCompare && weekN ? previousWeeks', 1),
  ('const prevMonths = monthN ? previousMonths', 'const prevMonths = allowCompare && monthN ? previousMonths', 1),
  ('{snap.week_choices.map((n) => (', '{(allowCompare ? snap.week_choices : []).map((n) => (', 1),
  ('          <label\n            className={cn(\n              "inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium",\n              monthN > 0',
   '          {allowCompare ? (\n          <label\n            className={cn(\n              "inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium",\n              monthN > 0', 1),
  ('          </label>\n        </div>\n\n        <div className="mt-4 flex flex-col gap-3 lg:flex-row',
   '          </label>\n          ) : null}\n        </div>\n\n        <div className="mt-4 flex flex-col gap-3 lg:flex-row', 1),
  ('          <label className="flex h-11 items-center gap-2 text-sm">\n            <input\n              type="checkbox"\n              checked={prevEqual}',
   '          {allowCompare ? (\n          <label className="flex h-11 items-center gap-2 text-sm">\n            <input\n              type="checkbox"\n              checked={prevEqual}', 1),
  ('            So kỳ trước cùng độ dài\n          </label>', '            So kỳ trước cùng độ dài\n          </label>\n          ) : null}', 1),
])

p = 'src/components/adsops/side-panels.tsx'
s = open(p).read()
i = s.index('export function ReportPanel({')
j = s.index('export function ConnectPanel({')
head, rep, rest = s[:i], s[i:j], s[j:]
assert '  onPulled,\n  viewer,\n' in rep and '  viewer?: boolean;\n' in rep
rep = rep.replace('  onPulled,\n  viewer,\n', '  onPulled,\n  viewer,\n  canPull,\n', 1)
rep = rep.replace('  viewer?: boolean;\n', '  viewer?: boolean;\n  /** Pull / refresh buttons: admin, head_ads, optimizer only. */\n  canPull?: boolean;\n', 1)
assert '{!viewer && live && clientId ? (' in rep
rep = rep.replace('{!viewer && live && clientId ? (', '{!viewer && canPull !== false && live && clientId ? (', 1)
assert '  onKpiPulled,\n' in rest and '  onKpiPulled?: (pack: {' in rest
rest = rest.replace('  onKpiPulled,\n', '  onKpiPulled,\n  canPull,\n  canInstall,\n', 1)
rest = rest.replace('  onKpiPulled?: (pack: {', '  /** Pull / refresh buttons: admin, head_ads, optimizer only. */\n  canPull?: boolean;\n  /** Google Ads API credential intake: admin only. */\n  canInstall?: boolean;\n  onKpiPulled?: (pack: {', 1)
assert 'const showIntake = Boolean(live && clientId);' in rest
rest = rest.replace('const showIntake = Boolean(live && clientId);', 'const showIntake = Boolean(live && clientId && canInstall !== false);', 1)
assert '{connected && live && clientId ? (' in rest
rest = rest.replace('{connected && live && clientId ? (', '{connected && canPull !== false && live && clientId ? (', 1)
open(p, 'w').write(head + rep + rest)
print('patched ok')
PY
grep -n "canPull\|canInstall" src/components/adsops/side-panels.tsx
grep -n "allowCompare" src/components/adsops/analytics-view.tsx
