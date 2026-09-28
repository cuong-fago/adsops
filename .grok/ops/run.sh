echo '=== nitro pkg exports'
node -e "const p=require('./node_modules/nitro/package.json');console.log(p.version);console.log(Object.keys(p.exports||{}).join('\n'))"
echo '=== grep useStorage in nitro dist'
grep -rln "export.*useStorage" node_modules/nitro/dist | head -20
echo '=== better-auth version'
node -e "console.log(require('./node_modules/better-auth/package.json').version)"
echo '=== grep adsops urls in components'
grep -rn "adsops/\|\.xlsx\|download\|href=" src/components src/routes | grep -v "@/components/adsops\|@/lib/adsops" | cut -c1-240
echo '=== db.ts exports'
grep -n "^export" src/lib/db.ts
echo '=== routes/index + __root'
cat src/routes/index.tsx src/routes/__root.tsx src/routes/api/auth/\$.ts
echo '=== analytics.ts exports'
grep -n "^export" src/lib/adsops/analytics.ts
echo '=== connect.functions'
cat src/lib/adsops/connect.functions.ts
echo '=== classify.functions'
cat src/lib/adsops/classify.functions.ts
echo '=== migration 0001 + 0004'
cat migrations/0001_auth.sql migrations/0003_memberships_unique.sql migrations/0004_analytics_warehouse.sql
echo '=== analytics registry head'
head -c 1500 public/adsops/analytics-registry.json
echo
echo '=== registry.json clients'
node -e "const r=require('./public/adsops/registry.json');for(const c of r.clients||[])console.log(c.client_id,'|',c.display_name,'|',c.customer_id_dashed,'|',c.status||'',c.adapter||'')"
echo '=== connect-registry clients'
node -e "const r=require('./public/adsops/connect-registry.json');for(const c of r.clients||[])console.log(c.client_id,'|',c.display_name,'|',c.customer_id_dashed)"
echo '=== mcc accounts'
node -e "const r=require('./public/adsops/mcc.json');for(const c of r.accounts||[])console.log(c.client_id,'|',c.display_name||c.account_name,'|',c.customer_id_dashed,'|',c.is_manager?'MGR':'',c.status||'')"
echo '=== pack.json keys'
node -e "const r=require('./public/adsops/pack.json');console.log(Object.keys(r).join(','))"
echo '=== data-and-auth ref'
cat .grok/references/data-and-auth.md
echo '=== project memory'
cat .grok/project_memory.md
