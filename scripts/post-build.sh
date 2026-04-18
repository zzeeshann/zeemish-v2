#!/usr/bin/env bash
# Post-build steps for Cloudflare deploy.
#
# 1. Tell Cloudflare Workers Static Assets to ignore _worker.js (it's the
#    runtime, not an asset).
#
# 2. Override the Astro Cloudflare adapter's auto-generated _routes.json.
#    The adapter excludes prerendered HTML paths (/, /daily/*, /library, /404)
#    from the worker's reach as a perf optimisation. That bypass means our
#    middleware can't apply security headers (CSP, HSTS, etc.) to static HTML
#    — Cloudflare serves the file directly. By overriding _routes.json we
#    route ALL HTML through the worker; only the bundled JS/CSS, og image,
#    and robots.txt skip the worker (no headers needed for those).

set -euo pipefail

cd "$(dirname "$0")/.."

echo '_worker.js' > dist/.assetsignore

cat > dist/_routes.json <<'EOF'
{
  "version": 1,
  "include": ["/*"],
  "exclude": ["/_astro/*", "/og-image.svg", "/robots.txt"]
}
EOF

echo "✓ post-build: _routes.json routes all HTML through the worker (security-headers fix)"
