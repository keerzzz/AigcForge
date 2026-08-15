#!/usr/bin/env bash
# 校验 protocols skill 引用的所有协议文档路径是否存在
# 用法: bash .aigcfroge/skills/protocols/scripts/check-refs.sh
# 退出码: 0 全部存在, 1 有缺失

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

# 本 skill 引用的协议文档路径（相对仓库根）
PATHS=(
  CLAUDE.md
  AGENTS.md
  ARCHITECTURE.md
  CONTEXT.md
  DESIGN.md
  packages/aigcfroge/AGENTS.md
  packages/llm/AGENTS.md
  packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md
  packages/aigcfroge/src/session/llm/AGENTS.md
  packages/aigcfroge/test/AGENTS.md
  packages/aigcfroge/test/server/AGENTS.md
  packages/app/e2e/performance/AGENTS.md
  packages/core/src/tool/AGENTS.md
  packages/desktop/AGENTS.md
  packages/effect-drizzle-sqlite/AGENTS.md
  .aigcfroge/skills/effect/SKILL.md
  .aigcfroge/skills/database/SKILL.md
  .aigcfroge/skills/frontend-theming/SKILL.md
  .aigcfroge/skills/protocols/SKILL.md
  .aigcfroge/skills/enterprise-code-standard/SKILL.md
  .aigcfroge/skills/reuse-first-refactor/SKILL.md
  .aigcfroge/skills/quality-to-pr/SKILL.md
  docs/prd/chat-mode-creation-layer.md
  docs/architecture/adr/ADR-13-amendment-2-meta-agent-dispatch.md
  packages/aigcfroge/specs/effect/migration.md
  packages/aigcfroge/specs/effect/guide.md
  specs/v2/session.md
  specs/v2/provider-model.md
  specs/v2/tools.md
  docs/architecture/system-blueprint.md
  packages/aigcfroge/test/EFFECT_TEST_MIGRATION.md
  docs/plan/mode-module-switching-completion.md
  .aigcfroge/references/effect-smol
)

miss=0
for p in "${PATHS[@]}"; do
  if [ -e "$p" ]; then
    echo "OK   $p"
  else
    echo "MISS $p"
    miss=$((miss + 1))
  fi
done

echo ""
if [ "$miss" -gt 0 ]; then
  echo "FAIL: $miss path(s) missing - update SKILL.md references"
  exit 1
fi

echo "All ${#PATHS[@]} paths OK"
