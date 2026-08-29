#!/usr/bin/env bash
# Refresh app/roster.json (and app/roster.js) from the live ESPN feeds.
#
# Usage:
#   ./refresh.sh                 # normal refresh, uses the on-disk cache
#   ./refresh.sh --refresh-cache # force a full re-fetch, ignoring cache freshness
#   ./refresh.sh --strict        # fail (exit 2) if validation warnings are present
#
# Any extra arguments are passed straight through to pipeline/build_roster.py.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

python3 pipeline/build_roster.py \
  --team kc \
  --out app/roster.json \
  --cache-dir tmp/cache \
  --delay 0.4 \
  --validate \
  "$@"
