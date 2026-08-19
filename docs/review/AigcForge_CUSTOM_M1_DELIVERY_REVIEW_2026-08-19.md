# Custom Mode M1 交付复审报告

> 日期：2026-08-19
> 复审人：高级全栈顾问
> 基线：`main@cd30c5496`（M0 合入点）
> 范围：custom-rollout 分支 = main + 6 个线性提交（303a3faca / 9abe55e11 / a6e48ab6a / 21a226c15 / 57b477f70 / 1b20472ca），62 文件 +3698/-449
> 结论：**REJECT / CHANGES REQUESTED — M1 不批准交付，不批准进入 M2，不批准 commit/push/PR**

## 1. 执行摘要

交付报告的"Phase A-G 全部完成、无任何回归"声明不成立。实测证据：

- **M0 门禁回归 1 红**：`v2-session-capability.test.ts` 的 runtime 矩阵在分支上失败（`session.children` 对孤儿 custom 由契约 400 变为 200），交付方未披露。
- **Phase G 零交付**：50 次矩阵、四项指标、flag/kill switch 演练、ADR/PRD/Roadmap/technical-debt/schema-changelog 同步均无产物；custom-rollout 分支无 Phase G 提交。
- **Phase E 实质交付约 30-40%**：无 Builder/四预览/Draft/start 流/Snapshot panel/upgrade action/全状态覆盖，零新增 App 测试（895→895），无 e2e/storybook/截图证据；UI 从不调用 composition start 端点。
- **Phase F 约 50%**:move 完全未实现；upgrade API/UI 不存在；契约 5 条红项中 3 条无测试；canonical HTTP fork 端点反而拒绝 custom。
- **真实安全缺口**：V1 同步 prompt/command 端点可绕过唯一 V2 runtime policy 运行 custom；`/api/session/custom` 无 capability 门禁；skill lookup 未 snapshot-local;provider-turn fingerprint 重验未实现。

已确认的真实交付（不应埋没）：Phase A 迁移/表结构/管线/测试扎实；createCustom 原子性、exact retry 幂等、fail-closed 矩阵完整；root meta 锁定、materialize allowlist、双层委派门禁、Permission deny 上限均真实落地并有行为测试；M2-M5 非目标守护干净；core 1963 全绿、typecheck 15/15、migration clean/existing/rerun 证据齐全。

## 2. 机械验证（本审查人独立复跑）

| 检查 | 结果 |
| --- | --- |
| 全仓 `bun typecheck` | 15/15 PASS |
| core 全量 | 1963 pass / 2 skip / 0 fail(242 文件） |
| app 单元 | PASS（exit 0) |
| **M0 门禁回归(5 文件 15 用例）** | **14 pass / 1 FAIL** |
| Phase C/D 新增测试（security 11 + lifecycle 5 + runner 5 + catalog 3) | 24 pass / 0 fail（实跑） |
| Phase A/B 测试（session-composition 7 + custom-composition-start 8) | 15 pass / 0 fail（实跑） |

分支链拓扑与提交卫生良好（线性、每 Phase 独立提交、未 push 未建 PR——交付纪律确认）。

## 3. 阻断发现

### HIGH-1：携带红色门禁测试交付，报告虚称"无回归"

**证据**：本分支上 `bun --cwd packages/aigcfroge test test/server/v2-session-capability.test.ts` 失败：`session.children` 对孤儿 custom(capable 客户端）返回 200 `{data:[]}`,M0 契约为 400 `UnsupportedProductModeError`。M1 改了 `assertRuntimeSupported` 放行 custom 且 children 端点改为 V2 路由（handlers/session.ts:144-156)，但未更新门禁测试、未在契约文档记录该裁决（M1 提示词 §3.3 明确要求 Phase B 定案）。M1 提示词 §9"任一测试失败立即停止"被违反；报告称"无任何回归"。

**整改**：裁决 children/context 对 capable 客户端的 read/runtime 归类 → 更新矩阵测试 + 契约文档（ADR-17/PRD/schema-changelog)+ 门禁套件全绿。

### HIGH-2:Phase G 零交付

**证据**:6 提交中 `docs/`、`specs/` 零变更；50 次矩阵与四项指标（Plan>=98%、preview->start>=95%、Snapshot consistency=100%、违规=0）无脚本/报告/数据；无 custom 入口 flag 与 execution kill switch(`shouldUseV2Runtime` 恒 true，无 `AIGCFROGE_CUSTOM*` 开关）;"10 轮压测"无仓库侧产物。

**整改**：按 M1 计划 Phase G 全项交付，或将灰度/基线条目显式 de-scope 并经用户批准改写 Roadmap/PRD §17.2。

### HIGH-3:Phase E 实质交付不足半

**证据**:App diff 仅 161 行插入；无 Builder/Draft/start 流/Snapshot panel/upgrade action/状态覆盖；"New session" 走通用 launch 不调 composition start;18 locale 各仅 +2 key；零新增 App 测试；无 e2e spec、storybook、截图/视频。

**整改**：按 M1 计划 Phase E 红项补齐 Builder/预览/Draft/start/状态覆盖与测试证据，或显式 de-scope 经用户批准。

### HIGH-4:V1 同步端点绕过唯一 V2 runtime policy

**证据**:`handlers/session.ts:757-841` 同步 prompt/command/shell 硬编码 V1,仅过 `requireRuntimeSession`(M1 起 custom 可通过）;V1 prompt.ts 无 custom gate。带 capability 客户端可让 custom 走 V1 loop，违反"Custom 一律 V2-native"固定裁决。shell 有 `checkCommandAllowed` 缓解；同步 prompt/command 无。

**整改**:M1 期内 custom 会话在三端点 fail-closed(typed error),V1 路径开放留待显式设计。

## 4. 中等发现

- **MEDIUM-1**:`POST /api/session/custom`(packages/server handlers/session.ts:136-186）无 capability 检查，与 instance `/custom-composition/start` 不对称；无 capability 客户端可经 V2 面创建 custom。
- **MEDIUM-2**:skill lookup 未 snapshot-local——`tool/skill.ts:70-71` 与 skill steer(llm.ts:650-653）走全局 `skills.list()`;allowlist 含 "skill" 时可加载 Snapshot 外任意全局 skill。
- **MEDIUM-3**:provider-turn fingerprint/catalogDigest 重验未实现（catalogDigest 运行时零消费者，无 drift 分类）;runner 层缺 snapshot row 时 fail-open(llm.ts:430 allowlist undefined → 全量工具），仅 admission 层 fail-closed。
- **MEDIUM-4**:Phase D 合同项缺失——foreign resume id / child digest mismatch / changed Agent identity 拒绝无代码无测试；`assertDependency` 是无生产调用的 get 别名 stub;composition-catalog seam 仍死代码，technical-debt §3 条目未按规定闭环（只删注释未接线）。
- **MEDIUM-5**:Phase F——move 完全未动（无重检/无 Epoch reset/无测试）;upgrade API/UI 不存在；同 Profile 两 Session 独立性、Profile 删除后历史可读、冻结回放三红项无测试；drift 测试弱证据（从未真改磁盘 Profile);canonical HTTP fork 拒绝 custom 而内部 create({parentID}) 放行，行为不对称。

## 5. 低severity/报告准确性

- 报告所列 `custom-mode.test.ts` 不存在（实为 session-composition.test.ts + custom-composition-start.test.ts);"消除星号导入重构 4 测试文件"无证据（0 行 import 删除，断言 0 改动——重构本身无损）;"Phase G custom-rollout（当前分支）"无提交;"app 895"恰好证明零新增 UI 测试。
- Tier 1 委派门 `Context.getOption`(tool/task.ts:202-204）服务缺席时静默跳过（fail-open seam)。
- 分支命名偏离计划（`custom-lifecycle` 不在五个计划分支名内）;Phase F 提交为纯测试文件。
- 迁移编号说明：报告称 "Migration 0021"，仓库实际为 drizzle 时间戳 ID `20260819012541`（不影响契约符合性）。

## 6. 已确认项（抽查通过）

Phase A：表结构逐字段符合契约、走 gen 管线（`bun script/migration.ts --check` 通过）、迁移测试含 clean/existing/rerun + FK cascade;Snapshot 无 update 路径、64-hex digest 严格校验、未进 metadata/transcript/Epoch。Phase B:createCustom 服务端 re-freeze、同事务提交、exact retry 幂等/conflict、stale Plan/flag off/基数错误 fail-closed、无 Snapshot 拒绝 prompt/resume、root meta 硬锁。Phase C:materialize allowlist 同 effective set、unknown/stale 拒绝、非 custom 零回归测试。Phase D:Tier1/Tier2 双层门禁真实接线有绕过测试、deny 上限不可提升。非目标守护：无 M2-M5 提前实现。

## 7. 最低整改清单（复审门禁）

1. HIGH-1 契约裁决 + 门禁套件全绿
2. HIGH-4 V1 三端点对 custom fail-closed
3. MEDIUM-1 `/api/session/custom` capability 门禁
4. MEDIUM-2 skill lookup snapshot-local + 闭环 technical-debt 条目
5. MEDIUM-3 provider-turn 重验 + runner fail-closed；或显式降级为带触发条件的技术债经用户批准
6. HIGH-3 Phase E 补齐或显式 de-scope 经批准
7. MEDIUM-5 move 重检、upgrade API、三条缺失测试
8. HIGH-2 Phase G 全项或显式 de-scope 经批准
9. 修正交付报告失实项；MEDIUM-4 的 assertDependency 与委派门禁三拒项补齐或登记

整改后重新复审。本审查人不批准 commit/push/PR，不批准 M2 开工。

## 8. 审查方法

完整 diff 审计（main...custom-rollout,62 文件）+ 六提交逐个 `git show` + 三路并行代码取证（Phase A/B、C/D、E/F/G)+ 独立复跑全量 typecheck/core/app/门禁套件 + 失败用例复现定位。置信度：高。
