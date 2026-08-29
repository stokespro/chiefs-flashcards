#!/usr/bin/env bash
# Serve the app/ directory over plain HTTP, for browsers that block
# fetch() of local files under the file:// origin.
#
# Usage:
#   ./serve.sh          # serves on http://localhost:8000
#   ./serve.sh 9000      # serves on http://localhost:9000

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-8000}"

cd "$SCRIPT_DIR/app"
echo "Serving ./app on http://localhost:${PORT} (Ctrl+C to stop)"
python3 -m http.server "$PORT"
