#!/usr/bin/env bash
# scripts/sync-theme.sh
#
# Pull the canonical theme-core assets from the Signal repo into the
# current repo. Run from the root of the consumer repo (scrumpoker or
# retrospective). Lives in Signal as the source; other repos copy it
# into their own scripts/ dir alongside their own theme manifest.
#
# Usage:  ./scripts/sync-theme.sh /path/to/signal

set -euo pipefail

SOURCE="${1:-/var/www/signal}"
MANIFEST="${SCRIPT_MANIFEST:-scripts/theme-manifest.txt}"

if [ ! -d "$SOURCE" ]; then
  echo "Source repo not found: $SOURCE" >&2
  exit 1
fi
if [ ! -f "$MANIFEST" ]; then
  echo "Manifest not found: $MANIFEST" >&2
  exit 1
fi

while IFS= read -r REL; do
  [ -z "$REL" ] && continue
  case "$REL" in \#*) continue ;; esac
  SRC="$SOURCE/$REL"
  DST="$REL"
  if [ ! -f "$SRC" ]; then
    echo "MISSING in source: $SRC" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$DST")"
  SRC_REAL=$(realpath "$SRC")
  DST_REAL=$(realpath "$DST")
  if [ "$SRC_REAL" != "$DST_REAL" ]; then
    cp "$SRC" "$DST"
  fi
  echo "synced  $REL"
done < "$MANIFEST"

echo "Theme sync complete. Don't forget to commit the changed files."
