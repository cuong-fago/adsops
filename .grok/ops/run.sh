set -e
python3 - <<'PY'
import re, json
p='vite.config.ts'
s=open(p).read()
old=s
s=re.sub(r"\n\s*// Bundle AdsOps snapshot JSON into the serverless function so\n\s*// access\.server can read via assets:adsops \(no per-request HTTP\)\.\n\s*serverAssets: \[\s*\{\s*baseName: \"adsops\",\s*dir: \"\./public/adsops\",\s*\},\s*\],", "\n            // AdsOps data lives in server-data/adsops and is copied into the\n            // function by scripts/bundle-adsops-data.mjs (never public/).", s)
assert s!=old, 'vite not patched'
open(p,'w').write(s)
p='package.json'
s=open(p).read()
old='"build": "node scripts/with-app-env.mjs vite build && npm run db:migrate"'
assert old in s
s=s.replace(old,'"build": "node scripts/with-app-env.mjs vite build && node scripts/bundle-adsops-data.mjs && npm run db:migrate"')
open(p,'w').write(s)
p='src/lib/auth/server.ts'
s=open(p).read()
old='{ emailAndPassword: { enabled: true } }'
assert old in s
s=s.replace(old,'{ emailAndPassword: { enabled: true, disableSignUp: true } }')
open(p,'w').write(s)
print('patched')
PY
git rm -q src/components/adsops/members-panel.tsx
grep -n "serverAssets\|bundle-adsops\|disableSignUp" vite.config.ts package.json src/lib/auth/server.ts
