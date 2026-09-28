#!/usr/bin/env bash
set -e
git apply --whitespace=nowarn .grok/ops/c.patch
rm -f .grok/ops/c.patch
cat > /tmp/sums <<'EOF'
12823bfd5e936e7ec58e75c40084d0dce7642264ae92575bf8fc9ff6fde6ec55  src/components/adsops/client-overview.tsx
eb63ef815fcfb43cc0bc5576b5173a6607822976584656edb2b5277c1e74f7fa  src/components/adsops/client-portal.tsx
7912651d32d9443c3f07bee1638bf9b2d59d9b06250c538b9baf9209226f4e42  src/lib/adsops/client-i18n.ts
d5ae6059adc4b09858fab7b48b1e7f03e4fca25efec77efcdcae4914d1cbecdc  src/lib/adsops/client-overview.ts
3e7ad2766b9049e14aeeefc3f24b085eb4683b05f1c9d24a01d078ba4be14a03  src/components/adsops/app-shell.tsx
bfdd6658f4c147bc8c98646ea2ba48171d5a05d271a4e787c77889e42af11041  src/lib/adsops/access.server.ts
5bf72a0c4c42215de5438243965d25516adae80ce2efa10f3d47bc85770c263d  src/lib/adsops/access.functions.ts
d4b24dd0de729049b2c60d016a6fcfdff7048c35c3ae8bf765e63879017f94ce  src/lib/adsops/access.types.ts
EOF
sha256sum -c /tmp/sums || true
git status --short
npx tsc --noEmit 2>&1 | grep -E 'error TS' | sed 's/(.*//' | sort | uniq -c || true
echo C-APPLIED
