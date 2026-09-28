echo ---SP
grep -n "viewer\|live &&\|export function ReportPanel\|export function ConnectPanel\|pullClientKpis\|FileLink\|xlsx_href\|onKpiPulled\|onPulled" src/components/adsops/side-panels.tsx | head -80
echo ---FW
grep -n "xlsx_href\|href" src/components/adsops/final-workbook.tsx | head
echo ---AV
grep -n "compare\|Compare\|prev\|kỳ trước\|So sánh\|export function" src/components/adsops/analytics-view.tsx | head -60
echo ---WH
grep -n "function loadSecrets\|SECRET_FILE\|process.env" src/lib/adsops/warehouse.server.ts | head -30
wc -c .grok/file-push/pieces/new_load.txt
head -c 3000 .grok/file-push/pieces/new_load.txt
echo
echo ---WHLS
sed -n '/function loadSecrets/,/^}/p' src/lib/adsops/warehouse.server.ts
echo ---ACCESS-asof
grep -n "as_of\|data_through" src/lib/adsops/access.server.ts | head -20
