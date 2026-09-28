set -e
echo '=== grep server fns'
grep -rn "createServerFn\|assertOps\|authMiddleware\|/adsops/" src server --include=*.ts --include=*.tsx | grep -v snapshots | cut -c1-220
echo '=== imports of functions'
grep -rn "from \"@/lib/adsops\|from '@/lib/adsops\|from \"\.\./\|from \"\./" src/components src/routes | cut -c1-200
echo '=== vite config serverAssets'
grep -n "serverAssets\|publicAssets\|nitro\|snapshots" vite.config.ts
