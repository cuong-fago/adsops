#!/usr/bin/env bash
mkdir -p .grok/ops/dump
cat > /tmp/walk.mjs <<'EOF'
import fs from 'node:fs'; import path from 'node:path';
const re=/prev|compare|delta|previous|change|wow|mom|_pct|growth|trend/i;
function walk(v,p,out,depth){ if(depth>6||v===null||typeof v!=='object')return; if(Array.isArray(v)){ if(v.length) walk(v[0],p+'[0]',out,depth+1); return;} for(const [k,x] of Object.entries(v)){ const q=p+'.'+k; if(re.test(k)) out.add(q+' :: '+(typeof x==='object'?(Array.isArray(x)?'array':'object'):JSON.stringify(x).slice(0,60))); walk(x,q,out,depth+1);} }
for (const f of process.argv.slice(2)) { const j=JSON.parse(fs.readFileSync(f,'utf8')); const out=new Set(); walk(j,'',out,0); console.log('== '+f+' topkeys: '+Object.keys(j).join(',')); for(const l of out) console.log('  '+l); }
EOF
node /tmp/walk.mjs server-data/adsops/analytics/tkqc_9634070340.json server-data/adsops/report/tkqc_6810292395.json server-data/adsops/compare/tkqc_6810292395.json server-data/adsops/connect/tkqc_6810292395.json server-data/adsops/hub/tkqc_6810292395.json
node -e "const j=require('./server-data/adsops/analytics/tkqc_9634070340.json'); console.log(JSON.stringify({rules:j.rules,week:j.week_choices,month:j.month_choices,metrics:j.metrics,cg:j.conversion_groups,camps:j.campaigns.slice(0,3),acc:j.daily.account.slice(-2),camp:j.daily.campaign.slice(-2),through:j.data_through,ws:j.warehouse_start,we:j.warehouse_end,pulled:j.pulled_at,gen:j.generated_at,asof:j.as_of,n:j.daily.account.length},null,1))"
for f in server-data/adsops/analytics/*.json; do node -e "const j=require('./$f'); const a=j.daily.account; const s=a.reduce((x,r)=>x+(r.cost||0),0); console.log('$f', a.length, j.warehouse_start, j.warehouse_end, Math.round(s), j.display_name, j.pulled_at||j.generated_at)"; done
rg -n "adsops_kv" -A6 migrations/0005_rbac.sql | head -30
rg -n "adsops_kv|export (async )?function|export type|kind: \"client\"|userId|user_id" src/lib/adsops/permissions.server.ts | head -80
rg -n "compare|allowCompare|prevEqual|week_choices|month_choices" src/components/adsops/analytics-view.tsx | head -60
split -b 15000 -d -a 1 src/components/adsops/app-shell.tsx .grok/ops/dump/app-shell.
cp src/lib/adsops/access.types.ts src/lib/adsops/permissions.types.ts src/lib/adsops/format.ts .grok/ops/dump/
ls src/components/ui 2>/dev/null | head -80; ls src/styles* src/*.css 2>/dev/null; ls public | head -40
