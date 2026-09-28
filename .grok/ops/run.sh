set -x
git mv public/adsops server-data/adsops
for f in .contentpath-test.txt .lazy-load-push-test.txt .lazy-load-push-test2.txt .size13k-test.txt .size16k-probe.txt; do
  [ -f "src/components/adsops/$f" ] && git rm -q "src/components/adsops/$f"
done
ls -la src/components/adsops | grep '^-.* \.' || true
sed -i 's#/workspace/public/adsops#/workspace/server-data/adsops#g; s#public/adsops#server-data/adsops#g' src/lib/adsops/connect.server.ts src/lib/adsops/warehouse.server.ts
grep -rn "public/adsops\|/adsops/" src --include=*.ts --include=*.tsx | grep -v '^src/lib/adsops/snapshots' | head -60
echo ---RCF
grep -n "resolveClientFile" -A40 src/lib/adsops/access.server.ts | head -60
echo ---PERM
grep -n "export " src/lib/adsops/permissions.server.ts
sed -n '/export async function deleteClientSessionByToken/,$p' src/lib/adsops/permissions.server.ts | head -40
echo ---USERTABLE
grep -rln 'create table' migrations | xargs grep -n 'create table' | head -30
echo ---VITE
cat vite.config.ts
echo ---PKG
grep -n '"build"\|"db:migrate"\|"scripts"' -A0 package.json
echo ---AUTH
grep -n "emailAndPassword\|disableSignUp\|signUp" -n src/lib/auth/*.ts
echo ---MW
cat server/middleware/adsops-json-guard.ts
echo ---VERCELJSON
cat vercel.json 2>/dev/null || echo none
ls server-data/adsops | head -50
