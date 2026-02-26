#!/usr/bin/env bash
#
# Generate composite contact sheets from GFX exports grouped by size.
#
# Usage:
#   ./scripts/gfx-export/make-composites.sh <input-dir> <output-dir>
#
# Example:
#   # First export with --group-by-size:
#   npx tsx scripts/gfx-export/cli.ts public/Siedler4/Gfx/9.gfx output/gfx9-by-size -g
#   # Then generate composites:
#   ./scripts/gfx-export/make-composites.sh output/gfx9-by-size/9 dist/gfx9-composites
#
# Each size group (e.g. 32x32/) becomes one composite PNG + a .txt index file
# mapping grid row,col -> original filename (GFX index).

set -euo pipefail

SRC="${1:?Usage: $0 <input-dir> <output-dir>}"
DST="${2:?Usage: $0 <input-dir> <output-dir>}"

if [ ! -d "$SRC" ]; then
  echo "Error: input directory not found: $SRC" >&2
  exit 1
fi

mkdir -p "$DST" "$DST/index"

for dir in "$SRC"/*/; do
  [ -d "$dir" ] || continue
  size=$(basename "$dir")

  # Collect PNGs sorted by name (preserves original index order)
  files=()
  while IFS= read -r f; do
    files+=("$f")
  done < <(ls "$dir"/*.png 2>/dev/null | sort)
  count=${#files[@]}
  [ "$count" -eq 0 ] && continue

  # Parse WxH
  w=${size%%x*}
  h=${size#*x}

  # Determine thumbnail size - minimum 48px wide for visibility
  if [ "$w" -gt 200 ] || [ "$h" -gt 200 ]; then
    tw=150; th=150
  elif [ "$w" -lt 48 ]; then
    tw=48; th=$(( h * 48 / w ))
    [ "$th" -lt 48 ] && th=48
  else
    tw=$w; th=$h
  fi

  # Determine tile columns
  if [ "$count" -le 8 ]; then
    cols=$count
  elif [ "$count" -le 50 ]; then
    cols=10
  else
    cols=15
  fi

  outfile="$DST/${size}_${count}imgs.png"

  montage "${files[@]}" \
    -tile "${cols}x" \
    -geometry "${tw}x${th}+2+2>" \
    -background '#1a1a1a' \
    "$outfile" 2>/dev/null

  # Generate index file: row,col -> filename (GFX index)
  idxfile="$DST/index/${size}_${count}imgs.txt"
  {
    echo "# Composite index for $size ($count images)"
    echo "# Grid: ${cols} columns, reading left-to-right, top-to-bottom"
    echo "# row,col -> filename (original GFX index)"
    echo "#"
    i=0
    for f in "${files[@]}"; do
      row=$((i / cols))
      col=$((i % cols))
      echo "${row},${col} $(basename "$f" .png)"
      i=$((i + 1))
    done
  } > "$idxfile"

  echo "OK: $size ($count) -> $(basename "$outfile")"
done

echo ""
echo "Done. Composites in: $DST"
echo "Each .txt file maps grid position -> original GFX index."
