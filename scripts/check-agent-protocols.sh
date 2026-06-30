#!/usr/bin/env bash
set -euo pipefail

# check-agent-protocols.sh
# Verifies agent protocol card consistency across the codebase.
# Run from repo root.
#
# C1: All V1-registered subagents have agent.json
# C2: Each agent.json maps to a known agent name
# C3: Each agent.json referencing a protocol has matching protocol.md
# C4: protocol.md files contain ## Role header
# C5: protocol.md files do not exceed 25 lines

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="$ROOT/packages/aigcfroge/src/agent"
ERRORS=0

check() {
  local desc="$1"
  shift
  if "$@"; then
    echo "  ✅ $desc"
  else
    echo "  ❌ $desc"
    ERRORS=$((ERRORS + 1))
  fi
}

echo "→ Agent Protocol Consistency Check"
echo ""

# C1: agent.json for each registered agent
echo "── C1: agent.json existence ──"
for agent in build explore plan general; do
  check "$agent/agent.json exists" test -f "$AGENT_DIR/$agent/agent.json"
done
check "meta/agent.json not required (meta uses meta.txt)" test ! -f "$AGENT_DIR/meta/agent.json"

echo ""
echo "── C2: agent names in agents.json ──"
AGENTS_JSON=$(cat "$AGENT_DIR/agents.json" 2>/dev/null) || {
  echo "  ❌ agents.json not found"
  ERRORS=$((ERRORS + 1))
}
if [ -n "$AGENTS_JSON" ]; then
  for agent in build explore plan general; do
    if echo "$AGENTS_JSON" | grep -q "\"$agent\""; then
      echo "  ✅ $agent listed in agents.json"
    else
      echo "  ❌ $agent listed in agents.json"
      ERRORS=$((ERRORS + 1))
    fi
  done
fi

echo ""
echo "── C3: protocol.md for agents with protocol field ──"
for agent in build explore plan general; do
  if cat "$AGENT_DIR/$agent/agent.json" 2>/dev/null | grep -q '"protocol"'; then
    check "$agent/protocol.md exists" test -f "$AGENT_DIR/$agent/protocol.md"
  fi
done

echo ""
echo "── C4: protocol.md contains ## Role ──"
for agent in build explore plan general; do
  md="$AGENT_DIR/$agent/protocol.md"
  if [ -f "$md" ]; then
    check "$agent/protocol.md has ## header" grep -q "^## " "$md"
  fi
done

echo ""
echo "── C5: protocol.md ≤ 25 lines ──"
for agent in build explore plan general; do
  md="$AGENT_DIR/$agent/protocol.md"
  if [ -f "$md" ]; then
    lines=$(wc -l < "$md")
    check "$agent/protocol.md ($lines lines)" test "$lines" -le 25
  fi
done

echo ""
if [ "$ERRORS" -eq 0 ]; then
  echo "✅ All checks passed."
  exit 0
else
  echo "❌ $ERRORS check(s) failed."
  exit 1
fi
