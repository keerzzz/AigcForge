#!/usr/bin/env bash
# AigcForge ↔ upstream opencode v2 divergence scanner.
#
# Compares each shared package between this fork and a local checkout of
# https://github.com/anomalyco/opencode branch v2, with the fork's brand
# rename normalized away (aigcfroge→opencode, AigcForge→OpenCode,
# AIGCFROGE→OPENCODE) so "rename-only" files are separated from true
# divergence.
#
# Usage:
#   ./scan-divergence.sh [FORK_DIR] [UPSTREAM_DIR] [OUT_DIR]
#   ./scan-divergence.sh . /tmp/opencode-v2 /tmp/v2sync
#
# Requirements: a FULL (non-blob-filtered) checkout of upstream v2.
#   git clone --branch v2 https://github.com/anomalyco/opencode.git /tmp/opencode-v2
#
# Outputs into OUT_DIR:
#   summary.txt            per-package tally (paste into reports verbatim)
#   common-<pkg>.txt       files present in both trees (after rename mapping)
#   changed-<pkg>.txt      shared files that still differ after normalization
#   forkonly-<pkg>.txt      fork files with no upstream counterpart
#   uponly-<pkg>.txt       upstream files with no fork counterpart
#
# Caveats (do not read the numbers as exact port effort):
#   * diverged-lines counts both directions of a normalized diff, sizing only.
#   * aigcfroge↔cli is a nominal mapping (different lineages); its numbers
#     describe disjointness, not merge difficulty.
#   * sdk↔sdk compares structurally different packages (fork sdk/js is
#     OpenAPI-generated; upstream sdk composes the generated client).
#   * llm and effect-sqlite-node have no upstream counterpart anymore
#     (upstream renamed llm→ai on 2026-07-15 and deleted effect-sqlite-node
#     on 2026-08-05, inlining the driver into core/src/database).

set -euo pipefail

FORK_DIR="${1:-.}"
UP_DIR="${2:-/tmp/opencode-v2}"
OUT_DIR="${3:-/tmp/v2sync}"

# Baseline graft point, verified 2026-10-10:
#   fork initial commit c51269f7e (2026-06-25) package trees are
#   byte-identical to upstream v2 commit 116ac93 (2026-06-24) for every
#   shared package; use it to graft history when you need upstream diffs:
#     git log 116ac93..origin/v2 -- packages/core
readonly BASE_SHA="116ac93ddbc3bb7a900468fba6980f5dce850fc5"

# fork package -> upstream package (fork aigcfroge descends from the baseline
# packages/opencode entry package, compared here against today's packages/cli)
declare -r -A MAP=(
  [core]=core [schema]=schema [server]=server [ui]=ui [session-ui]=session-ui
  [tui]=tui [app]=app [desktop]=desktop [plugin]=plugin [sdk]=sdk [script]=script
  [effect-drizzle-sqlite]=effect-drizzle-sqlite [effect-sqlite-node]=effect-sqlite-node
  [http-recorder]=http-recorder [storybook]=storybook [llm]=llm [aigcfroge]=cli
)
# Normalize fork content towards upstream spelling. Order matters: longest
# brand tokens first. Service tags dropped their "/v2/" segment on both sides,
# so no rule is needed for it.
declare -r NORM='s|aigcfroge|opencode|g; s|AigcForge|OpenCode|g; s|AIGCFROGE|OPENCODE|g'

mkdir -p "$OUT_DIR"
: > "$OUT_DIR/summary.txt"
echo "fork=$FORK_DIR upstream=$UP_DIR base=$BASE_SHA" >> "$OUT_DIR/summary.txt"

for pkg in "${!MAP[@]}"; do
  f="$FORK_DIR/packages/$pkg"
  u="$UP_DIR/packages/${MAP[$pkg]}"
  if [ ! -d "$f" ]; then continue; fi
  if [ ! -d "$u" ]; then
    echo "$pkg: UPSTREAM-MISSING ${MAP[$pkg]}" >> "$OUT_DIR/summary.txt"
    continue
  fi
  (cd "$f" && git ls-files -- . | grep -vE '^(dist|node_modules|out|\.turbo)/' | sort > "$OUT_DIR/f-$pkg.txt")
  (cd "$u" && git ls-files -- . | grep -vE '^(dist|node_modules|out|\.turbo)/' | sort > "$OUT_DIR/u-$pkg.txt")
  comm -12 "$OUT_DIR/f-$pkg.txt" "$OUT_DIR/u-$pkg.txt" > "$OUT_DIR/common-$pkg.txt"
  comm -23 "$OUT_DIR/f-$pkg.txt" "$OUT_DIR/u-$pkg.txt" > "$OUT_DIR/forkonly-$pkg.txt"
  comm -13 "$OUT_DIR/f-$pkg.txt" "$OUT_DIR/u-$pkg.txt" > "$OUT_DIR/uponly-$pkg.txt"

  id=0; rn=0; dv=0; dvl=0
  : > "$OUT_DIR/changed-$pkg.txt"
  while IFS= read -r rel; do
    if cmp -s "$f/$rel" "$u/$rel"; then id=$((id+1)); continue; fi
    if sed "$NORM" "$f/$rel" | cmp -s - "$u/$rel"; then rn=$((rn+1)); continue; fi
    dv=$((dv+1))
    dvl=$((dvl + $(sed "$NORM" "$f/$rel" | diff - "$u/$rel" | grep -cE '^[<>]')))
    echo "$rel" >> "$OUT_DIR/changed-$pkg.txt"
  done < "$OUT_DIR/common-$pkg.txt"
  echo "$pkg (fork) vs ${MAP[$pkg]} (upstream): identical=$id rename-only=$rn diverged=$dv diverged-lines=$dvl forkonly=$(wc -l < "$OUT_DIR/forkonly-$pkg.txt") uponly=$(wc -l < "$OUT_DIR/uponly-$pkg.txt")" >> "$OUT_DIR/summary.txt"
done
echo "DONE" >> "$OUT_DIR/summary.txt"
cat "$OUT_DIR/summary.txt"
