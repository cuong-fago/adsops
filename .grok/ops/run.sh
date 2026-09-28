echo '=== fs/data refs in server files'
grep -n "public/adsops\|ADSOPS_DATA\|readFile\|writeFile\|snapshots\|useStorage\|getSql\|adsops_analytics_warehouse\|export async function\|export function" src/lib/adsops/connect.server.ts src/lib/adsops/warehouse.server.ts src/lib/adsops/classify.server.ts | cut -c1-200
echo '=== side-panels handlers'
grep -n "pullClientKpis\|saveYamlAndProbe\|export function\|FileLink\|onPulled\|viewer\|compare\|Kéo\|<button" src/components/adsops/side-panels.tsx | cut -c1-180
echo '=== warehouse refs'
grep -rn "pullAnalyticsWarehouse\|Kéo kho" src | cut -c1-180
echo '=== analytics-view props'
grep -n "export function\|compare\|previous\|download\|xlsx\|csv\|Kéo\|data_through\|pulled_at" src/components/adsops/analytics-view.tsx | cut -c1-180
echo '=== final-workbook href'
sed -n 305,330p src/components/adsops/final-workbook.tsx
echo '=== xlsx_href values'
grep -rhoa '"xlsx_href": *"[^"]*"' public/adsops | sort -u | head
echo '=== report json keys'
node -e "const r=require('./public/adsops/report/tkqc_6810292395.json');console.log(Object.keys(r).join(','));console.log(JSON.stringify(r).slice(0,600))"
echo '=== analytics json keys'
node -e "const r=require('./public/adsops/analytics/tkqc_5800099027.json');console.log(Object.keys(r).join(','))"
echo '=== vc-config'
ls src; ls src/lib
