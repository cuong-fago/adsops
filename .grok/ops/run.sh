set -x
mkdir -p server-data
git mv public/adsops server-data/adsops
ls public public/__grok | head
ls server-data/adsops | head -40
set +x
echo ---VITETAIL
sed -n '/Bundle AdsOps snapshot/,$p' vite.config.ts
echo ---PKG
grep -n '"build"\|"db:migrate"\|"postbuild"\|"vercel-build"' package.json
echo ---AUTH
grep -n "emailAndPassword\|disableSignUp\|signUp" src/lib/auth/*.ts
echo ---MW
cat server/middleware/adsops-json-guard.ts
echo ---VERCELJSON
cat vercel.json
echo ---GATES
grep -n "export" src/lib/auth/gates.tsx src/lib/auth/client.ts | head -30
