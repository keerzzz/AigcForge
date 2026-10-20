# 文档归档（`docs-archive` 分支）

本分支只用于长期保存**未进入 main** 的计划、评审与研究文档；不参与构建、不合并回 main，也不改变 main 历史。

## 来源

- 源分支：`local-docs-checkpoint`（`37bbf11cd`），基于 `main-preserved-20261019`（`75ee27fbd`，原本地 main）。
- 时间范围：2026-10-16 ~ 2026-10-17，共 48 个 docs 提交。
- 完整提交清单：见同目录 `COMMITS.txt`。
- 完整历史（含本分支未收录的原始日志）：annotated tag `docs-checkpoint-20261017` → `37bbf11cd`。
- 本机 patch 备份：`/home/keer/aigcfroge-backup-20261019/`（`main-local-patches/` 45 份、`checkpoint-patches/` 3 份）。

## 收录内容（26 个文件，6,906 行）

- **计划**：agent interaction UI 执行 prompt、TDD 实施计划、brand mode icons、v2 整改与上游同步。
- **研究**：ZCode/Antigravity/DeepSeekHarness 核验与 UI 深度调研、agent UI 审计证据 JSON、testing-debate 5 篇、upstream v2 同步 2 篇计划 + `scan-divergence.sh` + 3 个摘要文件。
- **评审**：agent interaction 澄清 / S00 基线 / TDD 批准及证据、依赖卫生审计、上游 v2 桌面对齐与迁移分支批准、v2 分支独立评审正文。

## 未收录及原因

- `docs/review/v2-branch-independent-review-2026-10-17/` 证据目录（含 `check-force.log` 24,693 行等原始日志）：体积大且可复跑；完整内容在 tag `docs-checkpoint-20261017` 中。
- `docs/research/upstream-v2-sync/data/` 的 `changed-*.txt`、`fork-delta.txt`、`forkonly-*.txt`、`uponly-core.txt`（生成式 diff 转储）：可用 `scan-divergence.sh` 重新生成；只保留 3 个摘要文件。
- `docs/technical-debt.md` 的旧 §15 上游 v2 债务段：与当前 main 的 §15 编号体系冲突，未移植。
- `CLAUDE.md` 一行文案调整：已不适用于当前 main。

## 使用方式

```sh
git fetch origin docs-archive
git switch -c docs-archive origin/docs-archive
# 查看完整历史（含未收录证据）
git fetch origin tag docs-checkpoint-20261017
git log --oneline 37bbf11cd
```

维护规则：只追加，不改写历史；新的归档内容以新提交加入本分支。
