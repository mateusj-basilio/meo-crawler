#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
export PATH="$PWD/runtime:$HOME/.local/bin:$PATH"
if [[ -d browsers ]]; then export PLAYWRIGHT_BROWSERS_PATH="$PWD/browsers"; fi
if ! command -v node >/dev/null; then
  echo 'Instale Node.js 24.15+ para iniciar o crawler.' >&2
  exit 1
fi
node --input-type=module -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || major === 24 && minor < 15) { console.error("Requer Node.js 24.15+"); process.exit(1); }'
if [[ ! -d node_modules ]]; then npm ci --no-audit --no-fund; fi
exec node scripts/start.mjs
