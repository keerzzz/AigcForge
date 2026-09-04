#!/usr/bin/env bash
set -euo pipefail

# Validate the cross-document contract for the persistent delegation design.
# This is intentionally stronger than path-existence checks: it checks the
# current normative vocabulary, decision precedence, API shape, and gate map.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
paths = {
    "prd": root / "docs/prd/meta-agent-orchestrator.md",
    "adr": root / "docs/architecture/adr/ADR-22-meta-agent-persistent-delegation.md",
    "plan": root / "docs/plan/meta-agent-persistent-delegation-closed-loop.md",
    "history": root / "docs/plan/meta-agent-orchestrator.md",
    "architecture": root / "ARCHITECTURE.md",
    "testing": root / "docs/testing.md",
    "debt": root / "docs/technical-debt.md",
}
errors = []

def require_path(key: str) -> str:
    path = paths[key]
    if not path.is_file():
        errors.append(f"missing required file: {path.relative_to(root)}")
        return ""
    return path.read_text()

text = {key: require_path(key) for key in paths}
current = {key: text[key] for key in ("prd", "adr", "plan")}


def require(key: str, needle: str, label: str) -> None:
    if needle not in text[key]:
        errors.append(f"{label}: missing {needle!r}")


def forbid_regex(key: str, pattern: str, label: str) -> None:
    if re.search(pattern, text[key], re.MULTILINE):
        errors.append(f"{label}: matched forbidden pattern {pattern!r}")

# Current PRD/ADR/plan links and precedence.
require("prd", "v2.1（2026-09-04）", "current PRD version")
if re.search(r"^>.*(?:HISTORICAL|SUPERSEDED)", text["prd"], re.MULTILINE):
    errors.append("current PRD must not be marked HISTORICAL/SUPERSEDED")
require("prd", "规范层级与范围", "PRD responsibility section")
require("prd", "ADR-22", "PRD ADR link")
require("prd", "唯一实施计划", "PRD implementation-plan link")
require("plan", "PRD 负责产品目标与用户可见行为", "plan precedence statement")
require("plan", "本文覆盖 TDD 顺序、owner、命令、测试证据、迁移和回滚", "plan precedence statement")
require("adr", "统一实施计划", "ADR implementation-plan link")
require("architecture", "### 4.11 External CLI Dispatch and Persistent Delegation", "architecture PermissionV2 baseline")
require("testing", "bun --cwd", "testing command baseline")
require("debt", "技术债", "technical debt baseline")

# Normative vocabulary and forbidden positive shapes.
for key in current:
    if "quiet" in text[key] or "wakeup" in text[key]:
        errors.append(f"{key}: quiet/wakeup vocabulary remains in current normative docs")
    require(key, "steer", f"{key} steer vocabulary")
    require(key, "queue", f"{key} queue vocabulary")
    require(key, "copyable(changeKind, verdict)", f"{key} copy policy")
    require(key, "formatting_only", f"{key} formatting-only policy")
    require(key, "保守降级", f"{key} conservative formatting policy")
    require(key, "retry", f"{key} retry contract")
    require(key, "reconcile", f"{key} reconcile contract")

# Reject stale top-level states without rejecting explanatory negative mentions.
for key in current:
    forbid_regex(key, r"(?:status|状态)[^\n`]{0,80}stale_review|stale_review[^\n`]{0,80}(?:status|状态)", f"{key} stale_review top-level status")

# A participant kind/capability table is allowed to be mentioned only as a
# rejected/forbidden shape; a positive implementation declaration is not.
for key in current:
    for line in text[key].splitlines():
        if re.search(r"(?:kind\s*:\s*internal\s*\|\s*external_cli|capabilities\??\s*[:=])", line):
            if not re.search(r"(?:没有|不设|禁止|拒绝|rejected|不新增|不得)", line, re.IGNORECASE) and not re.match(r"\s*\d+\.\s+", line):
                errors.append(f"{key}: positive participant kind/capability shape: {line.strip()}")

# Delivery has no public identity/query API. Negative explanatory mentions are
# expected and are not failures.
for key in current:
    for line in text[key].splitlines():
        if "listDeliveries(" in line and not re.search(r"(?:没有|不得|不存在|禁止|无|不暴露)", line):
            errors.append(f"{key}: positive listDeliveries API: {line.strip()}")
        if re.search(r"(?:/delivery/[^ ]*deliveryID|deliveryID\s*[:=]|return[^\n]*deliveryID)", line):
            errors.append(f"{key}: positive deliveryID API/field: {line.strip()}")

# EventV2 aggregate contract is explicit and consistent.
for key in ("prd", "adr", "plan"):
    require(key, 'aggregate: "delegationID"', f"{key} EventV2 aggregate")
    require(key, "delegationID", f"{key} EventV2 payload id")

# Retry/reconcile API is present in both product and implementation contracts.
require("prd", "HTTP/SDK/UI 提供 retry 和 reconcile 入口", "PRD retry/reconcile UX")
require("plan", "/delegation/:delegationID/turn/:turnID/retry", "plan retry endpoint")
require("plan", "/delegation/:delegationID/reconcile", "plan reconcile endpoint")
require("plan", "/delegation/:delegationID/review/retract-rejection", "plan sticky-blocker endpoint")
require("adr", "`retry`、`reconcile`、`retract-rejection`", "ADR retry/reconcile gate")

# Both the plan and ADR must carry the complete, matching gate set.
expected = {f"G{number}" for number in range(1, 17)}
for key in ("adr", "plan"):
    found = set(re.findall(r"\|\s*(G\d+)\s*\|", text[key]))
    missing = expected - found
    if missing:
        errors.append(f"{key}: Gate↔Phase map missing {', '.join(sorted(missing, key=lambda value: int(value[1:])))}")
require("plan", "Gate / 不可妥协条件", "plan Gate map columns")
require("plan", "来源", "plan Gate map source column")
require("plan", "证据", "plan Gate map evidence column")

# The corrected architecture section is a fact, not an outstanding action.
require("architecture", "So \"absent PermissionV2 → auto-deny\" is true for ACP", "architecture transport-specific PermissionV2 wording")
require("plan", "ARCHITECTURE.md §4.11` 已于 **2026-09-03** 按 transport 修正", "plan architecture correction history")
forbid_regex("plan", r"ARCHITECTURE\.md[^\n]*必须在同一批次修正", "plan stale architecture repair action")
forbid_regex("plan", r"codex SDK 的 PermissionV2 桥是[^\n]*Phase 3[^\n]*新增", "plan fake Codex bridge action")
forbid_regex("adr", r"codex SDK 的 PermissionV2 桥是[^\n]*Phase 3[^\n]*新增", "ADR fake Codex bridge action")

# Historical plan has exactly one historical state and no implementation-ready
# status line.
require("history", "HISTORICAL / SUPERSEDED", "historical plan header")
if re.search(r"^>.*READY", text["history"], re.MULTILINE):
    errors.append("historical plan still contains a READY status line")
require("plan", "docs/plan/meta-agent-orchestrator.md", "historical source citation")

# UI and formatting scope must be narrowed for this batch.
for key in ("prd", "plan", "adr"):
    require(key, "完整 dark", f"{key} UI follow-up scope")
    require(key, "不作为本期", f"{key} UI scope narrowing") if key == "plan" else None
require("prd", "完整 dark theme、三语和全量窄视口矩阵另行建设", "PRD UI scope narrowing")
require("adr", "完整 dark/i18n/全量窄视口矩阵列为后续 UI 基础设施任务", "ADR UI scope narrowing")

if errors:
    print("Delegation documentation consistency check: FAIL")
    for error in errors:
        print(f"  ❌ {error}")
    sys.exit(1)

print("Delegation documentation consistency check: PASS")
print("  checked: PRD v2.1, ADR-22, canonical plan, historical plan, ARCHITECTURE §4.11, testing.md, technical-debt.md")
print("  gates: G1–G16 mapped in ADR and plan")
print("  API: retry/reconcile/retract-rejection present; no public deliveryID/listDeliveries shape")
print("  vocabulary: steer/queue only; formatting_only conservatively downgraded")
PY
