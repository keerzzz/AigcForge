# 五模式 dogfood 缺陷修整 TDD 实施计划

> **状态**：已审批（第 4 版，2026-09-04）；实施提示词已生成，本计划分支仍只承载文档，不含生产代码。
> **代码审查基线**：`origin/main=09a615232`（"fix: complete five-mode runtime remediation"）；本文中的行号、根因与 RED 结论按该代码树复核。
> **实施基线**：两份实施计划合入并推送后，以创建 worktree 时最新的 `origin/main` 为准；S0 必须记录准确 SHA，不能硬退回审查基线。
> **计划分支**：`dogfood-remediation-plan` 只保存计划与提示词；合入后生产实施使用新分支 `dogfood-remediation`，
> 从最新 `origin/main` 创建独立 worktree，命名遵守 `AGENTS.md`（最多三词、连字符、禁类型前缀）。
> **历史核验**：审查时 `git diff --stat origin/main five-mode-tdd` 为空，而当时本地 `main=3c4e2be50` 含额外 delegation 文档；
> 因此 v3 将两者混称为同一基线是错误的。后文 `09a615232` 仅表示代码审查事实，不表示实施时回退。
> **SHA 说明**：已闭环三项原引 `e01ceec06` / `e041e4e70` / `7387c3917`，另 `f70c94bbd`、`707efebcd`
> ——均由 `09a615232` 承载或在该基线不可达；需要逐条 diff 时使用仍存在的 `five-mode-tdd` 引用。
> **来源**：[2026-09-03 真实浏览器 + 真实后端走查报告](../review/five-mode-dogfood-2026-09-03/report.md)、[docs/technical-debt.md §4.1](../technical-debt.md)
> **覆盖层**：Core（session/revert、tool/registry、aisdk、config）→ Schema（可通用创建集合）→
> App（layout、mode-workspace、home-overview、session）→ session-ui → Tests（core 单测 + Playwright e2e）→ Docs
> **实施原则**：识别假设 → 追溯本源 → 重构方案 → 精简输出；复用 → 删除 → 归并 → 重构 → 新增
> **TDD 规则**：每个 Slice 独立走完 RED → GREEN → REFACTOR → 包级门禁 → 数据流复查；未通过不得进入下一 Slice

---

## 0. 摘要与前置裁决

### 0.1 本计划要解决什么

dogfood 报告的 8 项发现中 3 项已闭环。本计划处理 **8 项缺陷 + 3 项附带工程债**：

- **报告的 5 项开放项**：PERMISSION-DENY、TURN-STALL、MODE-MOUNT、REVERT-CONFIRM、HOME-EMPTY
- **追根因时新发现的 3 项**：P0-REVERT-TARGET（还原目标错）、P1-HOME-CUSTOM（首页漏第五档）、
  P1-HOME-CUSTOM-NEW（首页新建会话对 custom 必然失败）
- **附带工程债 3 项**：`tab.close` 重复注册、Solid 生命周期越界警告、E2E 覆盖缺口

| ID                     | 症状                                                   | 严重度   | 归属层     |
| ---------------------- | ------------------------------------------------------ | -------- | ---------- |
| **P0-REVERT-TARGET**   | 点任何消息回滚，磁盘都被还原到会话最早快照             | P0（新） | core       |
| **P1-PERMISSION-DENY** | 权限被拒后整轮静默终止                                 | P1       | core       |
| **P1-TURN-STALL**      | provider 无响应时永久「思考中」                        | P1       | app + core |
| **P1-MODE-MOUNT**      | 模式工作区冷加载只剩顶栏                               | P2→P1    | app        |
| **P2-REVERT-CONFIRM**  | 「重置到此点」无确认立即执行                           | P2       | app        |
| **P1-HOME-CUSTOM**     | 首页左栏模式筛选没有自定义模式                         | P1（新） | app        |
| **P1-HOME-CUSTOM-NEW** | 全局首页「新建会话」在 custom 下必然失败；新档静默继承 | P1（新） | app        |
| **P2-HOME-EMPTY**      | 无项目时「新建会话」无反馈                             | P2       | app        |
| **D-CMD-DUP**          | `tab.close` 重复注册                                   | 债       | app        |
| **D-SOLID-OWNER**      | cleanup/computation 越界警告                           | 债       | app        |
| **D-E2E-GAP**          | 冷启动导航超时 + 窄视口/主题/键盘无覆盖                | 债       | tests      |

### 0.2 本版范围裁决（已吸收审查意见）

下列事项是实施约束，不再作为“代码已经证明”的结论。凡标记为 **RED 决定 owner** 的项，必须先跑真实可满足的 RED，
再确定实现位置；不得先按假设改生产代码。

| 决策/问题            | 本版裁决                                                                                  | 依据与边界                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 基线分层             | `09a615232` 是代码审查基线；实施从计划合入后最新 `origin/main` 创建 `dogfood-remediation` | 文档提交可以前移 main，但不能改变已核验代码事实；执行时也不能硬退回旧 SHA                        |
| 运行时覆盖           | **V1 默认路径 + V2 opt-in 路径均纳入验收矩阵**；未覆盖的运行时不能宣称关闭报告缺陷        | `docs/testing.md §10 #5` 要求双运行时 parity；报告用户路径不默认等于 V2                          |
| P0-REVERT-TARGET     | **纳入，提为 P0 主脊**                                                                    | 磁盘被回滚到错误时点；先修目标选择再写确认文案                                                   |
| P1-PERMISSION-DENY   | **先做 Runner 级 RED，RED 决定边界 owner**；不得预先承诺由 Registry 捕获                  | `Tool.make`/leaf 已可能把 Permission 错误泛化为 `ToolFailure`，`llm.ts` 现有分支只处理 doom-loop |
| P1-TURN-STALL        | **客户端出口 + 后端/Provider 可观测超时**，但必须明确时间源、入口和 V1/V2 path            | 总时长 timeout 不能替代首字节/块间 timeout；UI 时间必须是响应式可推进的                          |
| P1-MODE-MOUNT        | **槽级 fallback/error + 顶层共享资源审计**                                                | `ModeWorkspace` 顶层 Chat 资源不在现有 `ModeSlotActiveProvider` 下，不能只补 Assistant           |
| P2-REVERT-CONFIRM    | **总是确认**；确认内容来自目标 snapshot/diff 的真实数据                                   | 这是破坏性磁盘写，不以“消息是否可恢复”作为免确认条件                                             |
| P1-HOME-CUSTOM / NEW | **同批处理**；列表从单一事实源派生，Custom 新建跳 Builder 原子入口                        | 禁止普通 `custom` draft 旁路；共享 creatable 类型若落 schema，必须把 schema 纳入范围             |
| D-CMD-DUP            | **先行为矩阵，再选全局或 Session owner**                                                  | Titlebar 是全局 owner，Session command 是会话 owner，单凭语义不能裁决                            |
| D-SOLID-OWNER        | **先诊断、后决定是否修**                                                                  | 7 个 `createRoot` 候选中已有正确 owner 传递用法，禁止猜测性重构                                  |

### 0.3 对原报告的三处更正（诚实修订，不是维护体面）

追根因时代码与报告结论不一致的三处，以代码为准：

1. **报告称「重置到此点可能丢失后续对话」——不准确，但真相更糟。**
   消息侧是非破坏性的：`revert` 只写标记（`revert.ts:49-57`），列表按 `message.id < revertMessageID` 过滤
   （`packages/app/src/pages/session/timeline/model.ts:109-112`），且 `SessionRevertDock` 提供逐条 restore。
   真正丢的是**磁盘文件**：`snap.restore(...)` 立即改工作区，且还原目标是错的（见 §2.1）。

2. **报告称「无超时」——机制存在，只是默认关闭且形状不全。**
   `packages/core/src/aisdk.ts:82-96` 已接两个 knob；`chunkTimeout` 甚至已是配置项
   （`packages/core/src/v1/config/provider.ts:111`）。所以修法不是「造超时」，是**选默认值 + 补一个缺失的档**（见 §2.3）。

3. **报告称 BUG-MODE-REENTRY「可能是 render-all 副作用」——副作用隔离已部分实施，但 pending 与资源 owner 都未完整闭环。**
   `mode-slot-active.ts` 已建 `ModeSlotActiveProvider`/`whenActive`，`mode-workspace.tsx:68-76` 已把资产列表逐项 settle
   以免 rejected resource 打穿 Suspense。当前基线已有 6 组 gate；剩余的是 **pending** 无表示、Assistant 五个 slot 内 query 未门控，
   以及 Workspace 顶层 Chat 资源不在任何 Slot gate 下（见 §2.4）。

---

### 0.4 Owner 冲突复核：`origin/main` 已闭环既有 P2-14，S4 仍有两类未收敛资源

初稿曾把 S4 的 `whenActive` 扩面判给
`docs/plan/five-mode-runtime-remediation-tdd-workflow-2026-08-30.md`（其 §S-1 owner 台账 `:193` 明令
「另一计划不得借机重写 render-all 语义」）。按 `origin/main=09a615232` 复核后**这个判定要改**：

| 事实                                                                                                      | 依据                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 那份计划的 P2-14 **证据锚点已修好**                                                                       | 它的锚点是 `mode-surfaces.tsx:242-244` → `custom-sidebar.tsx:30`（`:442`）；`origin/main` 上 `custom-sidebar.tsx:33-35` 已 `whenActive` 门控 |
| 那份计划已随 `09a615232` 声明 complete                                                                    | squash 提交信息声明完成 five-mode runtime remediation                                                                                        |
| 但它的 S10 DoD `:1530`「ModeWorkspace 隐藏 slot 不产生额外网络/Persist/SDK effect」在当前基线仍缺完整证据 | `assistant-dashboard.tsx` 五个 `useQuery` 未门控；`mode-workspace.tsx` 顶层 Chat 资源又位于全部 Slot gate 之外（见 §2.4）                    |
| `layout.tsx:43` 的 fallback-less Suspense 从来不归它                                                      | 全文检索该计划无 `layout.tsx` / `Suspense` / fallback 条目——它管隐藏槽的**副作用**，不管 pending 期的**表示**                                |

**处置（改）**：S4 收进两类剩余工作，不再等待已关闭计划：
① Assistant 的五个 slot 内 `useQuery` 复用现有 `whenActive`/`enabled` 模式；
② Workspace 顶层 Chat 资源先按真实网络 RED 分类为 Chat 专属或明确的 Workspace 共享预热，再决定 gate，不能把它伪装成机械复制。
既有 6 组已门控资源不顺手重写；它们只作为复用样板和回归对照。

**顺带记一条判据，不是指责**：那份计划的 DoD 在「全绿 + complete」后仍缺少覆盖全部资源 owner 的行为证据——
与 dogfood 报告自己的教训同形（三项 P0/P1 在 100 个 e2e 全绿的分支上存活）。
本计划 S4 的网络记账 RED 补的是**当前完整资源集合**，不是只给 Assistant 补一条源码断言。

**同一份计划的 S6「UI 验收」（`:1256-1264`）已列 light/dark、en/zh/zht、keyboard/focus、
loading/empty/error/partial-error、narrow viewport**——与本计划 S8c 的覆盖扩展重叠。
S8c 因此收窄为「只补 S3a 停滞态与 S4 fallback 这两个本计划新增表面的窄视口/键盘用例」，
其余矩阵留给那份计划的 S6 UI 验收，不重复建设。

**已确认无重叠的第三份**：`.worktrees/persistent-delegation` 的
`docs/plan/meta-agent-persistent-delegation-closed-loop.md`（1394 行）与 ADR-22——
全文无 `tool/registry` / `RejectedError` / `CorrectedError` / `permission.assert` / `revert` 命中，
与 S1/S2 无交集。

### 0.5 修订记录：各版之间改了什么、为什么

本节替代原先散落各处的「初稿错了」注记。**每条都是以代码或用户裁决为准推翻先前表述**，
留在这里是为了让审批者知道哪些结论已经被自己推翻过一次，别再按旧版理解。

| 版本  | 改动                                                                    | 触发                                                                                                                                                  |
| ----- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| v3→v4 | 基线曾误写为本地 `main=09a615232`                                       | 实际应以 `origin/main=09a615232` 为代码基线；当前本地 `main=3c4e2be50` 含额外文档提交                                                                 |
| v1→v2 | §2.4「`whenActive` 只覆盖 3 处」→ **6 处、5 文件**                      | 初版 grep 只扫了 3 个文件。连带推翻 §0.4 的 owner 判定（那份计划的 P2-14 锚点已闭环）                                                                 |
| v1→v2 | S3b 由「新增首字节 deadline」→ 先判为 parity 移植                       | 发现 `headerTimeout` 已存在于配置 schema 与 V1 实现                                                                                                   |
| v2→v3 | S3b 再改为「V2 侧建契约」，**不复用 V1**                                | 用户指出 V1 将退役；复用将死侧违背极致减法的归并方向。且 V2 schema 其实一档都没声明                                                                   |
| v2→v3 | §12 由「待审批决策」→ **裁决记录**                                      | 六条全部由 `CLAUDE.md` 判定；其中 D1b 原倾向（记债）被协议直接否掉                                                                                    |
| v2→v3 | 新增 §2.7 / §2.8 两项 P1                                                | 用户报「首页左栏没有自定义模式」，追根因又发现新建会话对 custom 必然失败                                                                              |
| v2→v3 | 撤回「五个模式主页各补会话列表」的切片                                  | 用户更正：「首页」指**加载后的全局首页**，不是各模式首页                                                                                              |
| v3→v4 | Permission GREEN 从“Registry 补 catchTag”改为 **RED 决定首次丢失边界**  | 真实 leaf/`Tool.make` 可能已把 Permission outcome 泛化，Registry 无法恢复反馈；doom-loop 映射也不是普通 settlement translator                         |
| v3→v4 | Stall 展示 owner 从 `SessionTurn` 改为 App `MessageTimeline`/`rows.ts`  | `SessionTurn` 另被 enterprise share 使用，但该页把 `session_status` 固定为 `idle`，stall 分支结构上不可达；交互式 App 详情页实际由 timeline rows 渲染 |
| v3→v4 | S4 从“只补 Assistant”扩为 Assistant + Workspace 顶层 Chat resource 分类 | 顶层 `chatAssetList`/`chatSystemData` 位于所有 Slot provider 外，旧 DoD 会漏记                                                                        |
| v3→v4 | S7/S8 改为能力类型与行为矩阵                                            | `modeDraft(currentMode)` 可旁路 Custom 护栏；`tab.close` 不能在未验证 Home/Draft/Session 覆盖前直接删 owner                                           |

**仍然成立、未被推翻的代码事实**：§2.1（revert 目标错）、§2.4（fallback-less Suspense）、
§2.5（revert 无确认）、§2.6（首页空状态静默）已按 `origin/main=09a615232` 复验。§2.2 的用户症状仍成立，
但“由 Registry 翻译”的实现结论已在 v4 撤回，必须由抵达形状 RED 决定。

### 0.6 运行时、入口与验收矩阵（本批硬范围）

报告是在真实浏览器 + 本地后端上发现的；当前仓库并非所有入口都走同一运行时。实施前后必须把“用户路径”和“修复路径”
绑定起来，不能用 V2 单测替代默认 V1 用户流。

| 维度                    | 必测值                                                                                    | 说明                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AIGCFROGE_V2_RUNTIME`  | `false`、`true`                                                                           | 默认 false 时 `promptAsync` 仍可能进入 V1 `SessionProcessor`；true 时才验证 V2 `SessionRunner`/`ToolRegistry` |
| `AIGCFROGE_CUSTOM_MODE` | `false`、`true`（Custom 用 true）                                                         | Custom 的 capability/atomic start 与普通四模式分开验收                                                        |
| 发送入口                | `promptAsync`、同步 `prompt`/`shell`/command（如本批触达）                                | 同步入口当前仍有 V1 兼容语义，不能假定与 async 相同                                                           |
| 权限拒绝                | `DeniedError`、无应答 `RejectedError`、带反馈 `CorrectedError`、过期、CAS 冲突            | 每种都记录是模型可见工具结果、可重试业务错误还是操作失败；不得宽捕获                                          |
| Provider stall          | 无响应头、响应头后无 SSE chunk、完整请求超时关闭档                                        | V1/V2 各自验证实际 fetch owner；默认值不能杀死合法长轮次                                                      |
| UI 回归                 | Work permission、Chat/Assistant stall、Work cold mount、Home empty/custom、Session revert | 每项至少一条真实 DOM/网络/事件行为断言；源码字符串不算证据                                                    |

**关闭标准**：如果某一缺陷只在 V2 修好而默认 V1 仍复现，状态只能记为“V2 已修、V1 开放”，不能移出 §4.1 已开放表。
如果产品决定本批只做 V2，必须在实施前把计划标题、缺陷列表和 DoD 明确改为 V2-only，并单独登记 V1 遗留债。

## 1. 强制协议、Skills 与事实源

| 类别     | 事实源                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 宪法     | `CLAUDE.md`（九荣九耻、四大拒绝、根因收敛、极致减法与方案对冲）                                                                         |
| 执行协议 | `AGENTS.md`（代码风格、分支提交、Effect 编码、Schema）                                                                                  |
| 设计协议 | `DESIGN.md`（Token、组件、i18n、无障碍）                                                                                                |
| 架构协议 | `ARCHITECTURE.md`（包拓扑、子系统边界、数据流）                                                                                         |
| 测试协议 | `docs/testing.md`——**§10 八条红线为硬门禁**，尤其 #8「新增 RED 必须可满足」及其判别式                                                   |
| Skills   | `effect`（Effect 编码）、`enterprise-code-standard`、`reuse-first-refactor`、`quality-to-pr`、`frontend-theming`（S5/S6 涉及 UI Token） |
| 债台账   | `docs/technical-debt.md` §4.1——本计划每闭环一项即移入「已闭环」表并记日期与提交                                                         |

---

## 2. 已核验的根因

每条都给 `path:line`。未验证的推测明确标注为「待 RED 判定」。

### 2.1 P0-REVERT-TARGET：revert 还原的是会话最早的快照，不是用户点的那条

`packages/core/src/session/revert.ts:31-35`：

```ts
// Find the assistant message produced in response to the target user message
const assistantMsg = msgs.find(
  (m): m is Extract<SessionMessage.Message, { type: "assistant" }> =>
    m.type === "assistant" && m.snapshot?.start != null,
)
```

**注释说的是「找与目标用户消息对应的那条 assistant 消息」，代码里 `input.messageID` 从未进入谓词。**
`Array.prototype.find` 返回**第一个**匹配项，`store.context()` 走 `SessionHistory.load` 取全量历史
（`packages/core/src/session/store.ts:51-53`），所以拿到的是**全会话最早**那条带 `snapshot.start` 的 assistant 消息。

后果链：

| 环节                                | 行为                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `revert.ts:43` `snap.restore(...)`  | 工作区文件被还原到**会话第一轮之前**，无论用户点第几条                           |
| `revert.ts:49-57` `store.setRevert` | 标记用的是正确的 `input.messageID`                                               |
| 结果                                | **消息标记与磁盘状态指向两个不同时点**；UI 显示「回滚了 N 条」，磁盘却退回了全部 |
| `revert.ts:46` diff summary         | 因此 additions/deletions/files 统计也是错的（对错误基线做的 diff）               |

可恢复性：`revert.ts:40` 先 `snap.track()` 存 `currentSnapshot`，`unrevert`（`:64-76`）能还原回去——
**只要用户在做别的事之前找到 dock 并点 restore**。所以这是「静默的、可恢复的、超出用户意图的磁盘写」。

**无既有假绿契约阻挡**：`packages/core/test/session-revert-v2.test.ts` 全文 68 行、只有两个用例
（会话不存在；无前置 revert 的 unrevert），完全没断言还原目标。新 RED 可直接落。

### 2.2 P1-PERMISSION-DENY：Permission 错误在不同运行时/边界被不同方式处理

原计划把“Registry 只翻译 `ToolFailure`”直接推导成“应由 Registry 翻译 Permission 错误”。代码核验后，这个推导不成立，
因为必须先区分 V1 与 V2，以及 Permission 错误在哪一层被擦除。

#### V1 实际链路

报告默认路径可能进入 `packages/aigcfroge/src/session/processor.ts`：

```text
PermissionV1/Question reject
  -> SessionProcessor.failToolCall (:229-245)
  -> tool part.state.status = "error"
  -> ctx.blocked = ctx.shouldBreak
  -> settleToolCall
  -> process 返回 stop/continue
```

`processor.ts:241-245` 已经把拒绝转成 error part，但报告中的问题是错误消息与终止原因不可见/不够可恢复；
`processor.ts:971` 还读取已在 V2 配置规格中标记为 remove 的 `experimental.continue_loop_on_deny`。因此 V1 必须有独立的
用户级回归和明确的兼容处置，不能用 V2 Registry 单测“覆盖”它。

#### V2 实际链路

V2 工具调用是：

```text
SessionRunner.llm.ts settleTool
  -> ToolRegistry.Materialization.settle
  -> Tool.settle
  -> Tool.make(config).execute
  -> leaf permission.assert
```

关键事实：

- `packages/core/src/tool/tool.ts:30-50` 的 `Tool.make` 执行契约最终只允许 `ToolFailure`；
- `packages/core/src/tool/bash.ts:198` 等 leaf 使用 `Effect.mapError(() => new ToolFailure(...))`，可能已经把
  `DeniedError`/`RejectedError`/`CorrectedError` 泛化成“Unable to execute …”；
- `packages/core/src/tool/registry.ts:175-179` 只捕获 `LLM.ToolFailure`，不能从普通 `ToolFailure` 恢复原始
  `CorrectedError.feedback`；
- `packages/core/src/session/runner/llm.ts:415-440` 的映射属于 **doom-loop check**，不是所有普通 tool settlement 的
  通用权限翻译。

所以 S2 的根因不是“少写了三个 `catchTag`”，而是**typed permission outcome 在哪个边界拥有翻译权尚未被证明**。

#### S2 的 owner 约束

必须先用真实工具和真实 `PermissionV2.Service` 做抵达形状探针：

1. `DeniedError`：拒绝 bash/read/write/edit 等至少一个真实 leaf；记录 `ToolRegistry.settle` 的 `Exit` 以及最终
   `ToolResultValue`。
2. `CorrectedError`：带反馈拒绝，验证反馈是否已经在 leaf 被擦掉。
3. `RejectedError`/`AskExpiredError`：验证它们是工具结果、typed 业务错误还是 defect。
4. `GrantEvent.CommitRejected` 与 `NotFoundError`：验证是否属于操作失败，不得默认降级为模型文本。

**GREEN 只能从 RED 结果选择以下最小方案之一：**

- 如果 Permission 错误在 leaf 被泛化：在工具边界抽一个共享的、只处理明确分类错误的 translator，供 leaf 复用；不得在 Registry
  用 `catchCause` 逆向猜测。
- 如果 `Tool.make` 是统一丢失 typed 错误的边界：扩展其错误适配，但只允许明确列出的 recoverable Permission error；
  interruption、defect、CAS 冲突保持原有操作失败语义。
- 如果问题只存在 V1：修 `SessionProcessor.failToolCall` 的可见消息/状态，并为 V2 保留独立测试；不要为了“跨运行时统一”
  强行改 Registry。

`llm.ts` 的 doom-loop 分支只有在 translator 的语义确实相同、且不丢失 doom-loop 专属上下文时才复用；否则保留其
独立消息。`AskExpiredError`、`CommitRejected` 不得列为自动 ToolFailure，除非 RED + 协议评审证明模型可安全恢复。

**最终验收语义：**

- 用户拒绝后，tool part 必须可见地表达“权限被拒/反馈内容”，而不是静默终止；
- 当前轮次是否继续由对应运行时既有 runner policy 决定，不复活已在 `specs/v2/config.md:396` 标记 remove 的旧配置；
- interruption/defect 不得被吞成成功工具结果；
- V1 与 V2 各有一条端到端回归，且报告路径使用的运行时必须被实际跑到。

### 2.3 P1-TURN-STALL：交互式 App owner 是 `MessageTimeline`；enterprise share 的 `SessionTurn` stall 分支当前不可达

报告用户路径描述的是交互式详情页 `Chat/Assistant` 的时间线。全仓调用图复核结果是：

- `SessionTurn` 的真实消费者不是只有 Storybook：除 `session-turn.stories.tsx`、`timeline-playground.stories.tsx` 外，
  `packages/enterprise/src/routes/share/[shareID].tsx:2` 也 import，并在 `:253`、`:334-346` 渲染。
- 但 enterprise share 在 `getData()` 中把 `session_status[share.sessionID]` 固定为 `{ type: "idle" }`
  （`[shareID].tsx:89-93`）；`SessionTurn.showThinking()` 要求 `status().type !== "idle"`。因此当前只读 share 路径上
  stalled/永久思考分支是**结构不可达**的。若以后 share 接入实时 busy 状态，这个不变量失效，必须为该路径另补 RED。
- 交互式 App 生产路径是 `packages/app/src/pages/session/timeline/message-timeline.tsx`：
  `sessionStatus()` → `workingTurn()`（`:994`）→ `rows.ts:197-208` 生成 `TimelineRow.Thinking` →
  `TimelineThinkingRow`（`:139-150`）渲染「Thinking」。
- `SessionRetry` 在同一时间线的 `Retry` row（`message-timeline.tsx:1253-1259`）中复用，不能把 retry 状态误当成 stalled 状态。

因此 S3a 的客户端出口应落在 `MessageTimeline`/`rows.ts` 的真实交互式调用链；在 enterprise share 保持固定 `idle` 的前提下，
本缺陷不修改 `session-turn.tsx`。这不是因为它“只有演示调用”，而是因为其唯一生产消费者的 stall 前置状态当前不可达。

**客户端停滞判据必须是可重复、可响应的：**

```text
active message userMessage.time.created
+ associated assistant message.time.created / latest part activity
+ reactive now tick
+ zero renderable assistant parts
+ sessionStatus.type === "busy"
→ stalled
```

实现约束：

1. 不在 `createMemo` 中单独读取非响应式 `Date.now()`；时间经过必须能触发重算。
2. `MessageTimeline` 提供可注入的 `now`/tick seam；生产使用组件内受清理的 interval 或已有 timer 机制，测试使用可控时钟推进，
   不用 `Effect.sleep`、`setTimeout` 等等待测试结果。
3. `lastActivityAt` 的优先级必须写死并测试：最新 assistant message 创建时间，其次是该 turn 最新 part 的时间，
   没有 assistant activity 时回退到 user message 创建时间；缺失/异常时间不得把停滞误判为已超时。
4. stalled 是**客户端派生展示态**，不是直接扩展服务端 `SessionStatus` union；除非 RED 证明客户端没有足够事实，才另开协议裁决。
5. 出口动作通过 `MessageTimeline` 的 actions 注入：至少复用现有 session abort/halt；切换模型必须复用现有
   `DialogSelectModel`/model selector，不新建第二套模型入口。动作不可用时仍显示明确的停止/重试建议，不能只换一段文案。

**服务端超时与客户端出口分开验收。** 服务端真实状态仍需覆盖：

- 无响应头（header timeout）；
- 收到响应头但 SSE chunk 长时间不来（chunk timeout）；
- 完整请求 timeout/abort；
- abort 后已有的 `LLMError`/`session.error`/`session_status` 错误渲染路径。

V1 与 V2 的超时实现和用户入口必须分别跑到；不允许用 V2 `aisdk.ts` 的单测关闭 V1 报告缺陷。

**超时契约的真实现状：**

| 层         | 事实                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1         | `packages/core/src/v1/config/provider.ts:95-114` 有三档选项；`packages/aigcfroge/src/provider/provider.ts:1716-1746` 消费，其中 V1 默认实现为首字节 10,000ms、chunk 60,000ms |
| V2 Config  | `packages/core/src/config/provider.ts:65-71` 目前没有显式三档；API 结构来自 `packages/schema/src/provider.ts:25-31` 的开放 `settings` record                                 |
| V2 runtime | `packages/core/src/provider.ts:15-17` 把 `settings` 进一步放宽为 `any`；`packages/core/src/aisdk.ts:73-90` 整包 spread，并只显式消费 `chunkTimeout`/`timeout`                |
| 默认切换   | `packages/aigcfroge/src/effect/app-runtime.ts:92` 的 `AIGCFROGE_V2_RUNTIME` 默认 false，故默认用户流未必经过 V2                                                              |

**S3b 的 owner 决定：**

- Provider API 结构的唯一 schema owner 是 `packages/schema/src/provider.ts`；core Config 只组合/复用该结构，不在
  `packages/core/src/config/provider.ts` 复制一份平行 `settings` schema。
- timeout 字段须在开放第三方 settings 中以 typed known fields + 明确 rest 结构表达；`apiKey`、provider-specific options、
  custom `fetch` 等既有能力不能因收窄被删除。
- `packages/core/src/provider.ts` 的 `MutableApi` 必须从 `any` 收窄为该 typed settings 的深可变类型；如第三方 API 类型确需逃逸，
  必须只在适配边界局部 cast 并注释原因，不能继续使用自家 `settings: any`。
- `packages/core/src/aisdk.ts` 通过 typed settings 读取三档超时，再将剩余 provider options 传给 AI SDK；不能用整包
  `Record<string, any>` 继续掩盖契约。
- 优先级写成可测试契约：模型级 request options 与 provider API settings 不得同名静默覆盖；timeout 归 provider transport，
  request body 中的同名字段不得改变 transport deadline。若当前数据模型无法表达该优先级，S3b RED 必须先停下并拆出模型。
- `headerTimeout=false`、`timeout=false`、`chunkTimeout=false`（若要支持关闭）及 omitted/default 的行为分别测试；不要以 `0`
  同时承担“关闭”和“非法正数”的两种语义。

**禁止跨包反向依赖**：V2 不 import `packages/aigcfroge/src/provider/provider.ts` 的 V1 常量/helper。V1 先作为独立
回归基线；如果默认 V1 用户路径仍复现报告缺陷，必须在其真实 owner 做最小修复，或把状态明确保持为 V1 开放，不能用 V2 结果代替。
V1 退役债只在确认无默认调用方后再移除。

### 2.4 P1-MODE-MOUNT：`<main>` 的 Suspense 无 fallback，pending 期等同白屏

`packages/app/src/pages/layout.tsx:42-44`：

```tsx
<main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
  <Suspense>{props.children}</Suspense>
</main>
```

**无 fallback。**同一边界已被三处独立注释点名为危险源：`mode-workspace.tsx:70-76`、
`components/mode-surfaces.tsx:94`、`components/custom/custom-preview-column.tsx:61-70`。

render-all 机制：`mode-workspace.tsx:221` 与 `:237` 用 `style={{ display: ... }}` 同时挂载五模式的
Sidebar 与 Main，靠 CSS 隐藏；`:222`/`:241` 用 `ModeSlotActiveProvider` 传入「本槽是否在屏」。

副作用隔离**已部分实施但覆盖不全**——`packages/app/src/pages/mode-slot-active.ts:1-12` 的注释已列出五模式各自的
资源（ChatFeatureSidebar 的 kind 计数、coding/work 的 session load、work 的 workflow 资产列表、Custom 侧栏的
资产发现 + Builder 的 plan 调用），并明确「Plan §S6 REFACTOR 的修法是保留 render-all，把网络/SDK/persist 效应
放到 active 信号后面」。`whenActive`/`useModeSlotActive` 在 `origin/main=09a615232` 上共 **6 组调用点、5 个文件**：
`mode-workspace-slots.tsx:230-232`（coding session load）、`:624-626`（work session load）、`:668`（work workflow 资产）、
`mode-surfaces.tsx:88-90`（chat 七类资产）、`custom-sidebar.tsx:33-35`、`custom-preview-column.tsx:40-42`。

**范围修正：`ModeWorkspace` 顶层仍有一组跨 Slot 资源没有挂在 `ModeSlotActiveProvider` 下。**
`packages/app/src/pages/mode-workspace.tsx:57-90` 的 `chatDirSdk`/`chatAssetList` 会在目录存在时读取七类 Chat 资产，
`:160-164` 的 `chatSystemData` 会触发 `sync().child(dir, { mcp: true })`；它们位于所有 Sidebar/Main slot 外。
因此“隐藏 slot 请求数为 0”不能只统计 Assistant 五个 `useQuery`。S4 必须先把这组顶层资源分类为：

- **共享后台资源**：若产品确实要求所有模式预热，则 DoD 必须从“所有隐藏资源为 0”改为“共享资源有明确 owner，且每个
  hidden slot 自身无额外调用”；或
- **Chat 专属资源**（本批建议）：把 source/child bootstrap 绑定到 `mode.currentMode === "chat"` 的 Chat active gate，
  再验证从 Chat 切到其他模式后不新增调用，且已有数据通过 `latest`/缓存保持可读。

在该分类完成前，S4 不能声称已完成全仓隐藏 Slot 副作用收敛。

**实际目标建议**：把 `chatDirSdk`/`chatAssetList`/`chatSystemData` 移入 Chat 专属 owner，或让其 source 明确接受
`mode.currentMode === "chat"` 的 active gate；若保留 Workspace 级预热，则必须把它从 hidden-slot 零调用断言中单独列为
“共享预热调用”，并记录缓存/取消/切换后的生命周期，不得用“它在 slot 外”掩盖网络副作用。

> 覆盖数以 `origin/main=09a615232` 全树检索为准（v1 曾少算，见 §0.5）。

**已明确仍未门控的 slot 内专属资源是 Assistant**：`packages/app/src/pages/assistant-dashboard.tsx` 五个 `useQuery`
（`:41` pending、`:53` recent、`:62` memory、`:92` kb、`:157` sessionLoad）既无 `enabled: slotActive()`
也未 import `useModeSlotActive`。这与报告观测到的「只看 Coding 却发出 Assistant 的提醒/记忆/知识库请求」精确对应。
除此之外，前述 Workspace 顶层 Chat 资源仍未完成 owner 分类，不能写成“只有 Assistant”。

当前基线能直接解释隐藏 Assistant 请求和跨 Slot 的 Chat bootstrap；Custom 相关资源已在上述 6 组 gate 内，是否仍有重复请求
必须由 S4 的新网络 RED 复验，不能沿用旧报告直接推定当前仍复现。

两个症状分属两个原因，必须分开修：

| 症状                      | 原因                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| 主区只剩顶栏、无 spinner  | fallback-less Suspense 在 **pending** 期渲染空（dev 下按需编译约 10 秒）                    |
| 跨模式请求风暴 / 重复请求 | Assistant slot gate 缺失 + Workspace 顶层 Chat owner 未分类；已门控资源另做回归，不默认重写 |

报告的 `scrollWidth === clientWidth === 390` 已排除水平溢出，与「内容未挂载」结论一致。

### 2.5 P2-REVERT-CONFIRM：一次点击即改磁盘，撤销入口默认折叠

- `packages/session-ui/src/components/message-part.tsx:1218-1233`：IconButton `onClick` 直接 `revert()`，无确认。
  **已有的保护**：`:1222` `disabled={busy()}`——轮次进行中点不到，所以「误点打断运行中轮次」不是本缺陷。
- `packages/app/src/pages/session.tsx:1567-1570` → `:1499-1521` `revertMutation`：先 `halt(sessionID)`，
  再 `sdk().client.session.revert(input)`，失败时回滚本地标记与草稿。
- **撤销已存在**：`packages/app/src/pages/session/composer/session-revert-dock.tsx` 逐条给 restore 按钮
  （`:83-91`），接 `session.tsx:1523-1541` 的 `restoreMutation`；但 dock **默认 `collapsed: true`**（`:15-17`），
  且每次 items 变化都强制回到折叠态（`:19-23`），折叠时只露一条 preview。

结论：本项**不需要新建撤销机制**（复用 > 新增），需要的是①确认这次写盘、②让既有撤销可发现。
且顺序上必须排在 §2.1 之后——在还原目标错误的前提下写确认文案，就是把错误信息也确认一遍。

### 2.6 P2-HOME-EMPTY：两条静默 early return

`packages/app/src/pages/home-overview.tsx:159-172`：

```ts
function openNewSession() {
  const conn = focusedServer()
  const ctx = focusedServerCtx()
  if (!conn || !ctx) return          // :162 静默
  const directory = newSessionDirectory()
  if (!directory) return             // :164 无项目时命中，静默
  launchModeSession({ ... })
}
```

`newSessionDirectory()`（`:144-157`）在无 selected、无 lastSession、`projects()` 为空时返回 `undefined`，
于是 `:164` 命中并静默返回。**与报告症状完全一致：无导航、无 toast、无说明。**

### 2.7 P1-HOME-CUSTOM：首页左栏把 `MODE_DEFINITIONS` 手抄了一遍，抄漏了 custom

`packages/app/src/pages/home-overview.tsx:345-351` 手写枚举四档：

```ts
const filters = createMemo<Array<{ id: "all" | Mode; label: string; count: number }>>(() => [
  { id: "all", label: language.t("home.overview.all"), count: props.total },
  { id: "coding", label: language.t("mode.coding"), count: props.counts.coding },
  { id: "chat", label: language.t("mode.chat"), count: props.counts.chat },
  { id: "work", label: language.t("mode.work"), count: props.counts.work },
  { id: "assistant", label: language.t("mode.assistant"), count: props.counts.assistant },
])
```

**其余各层早就到位，唯独渲染这一层分叉了**：

| 层                                                    | 状态                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| 单一事实源 `context/mode.tsx:6-45` `MODE_DEFINITIONS` | **五档**，含 `custom`（`labelKey: "mode.custom"`、`icon: "mode-custom"`） |
| 计数 `home-overview-model.ts:5` `countByMode`         | 已数五档（`custom: 0` 初值在内）                                          |
| 筛选状态 `home-overview.tsx:60`                       | 类型 `"all" \| Mode`，本来就接受 `"custom"`                               |
| 侧栏 props `home-overview.tsx:285`                    | `counts: Record<Mode, number>`，类型含 custom                             |
| **渲染列表 `:345-351`**                               | **手抄四档，漏 custom**                                                   |
| 对照：`components/mode-switcher.tsx:39`               | `<For each={MODE_DEFINITIONS}>` 无条件五档                                |

所以这既不是 flag 门控，也不是数据缺失——是**同一个契约存在两份表述**，而抄的那份漏了一项。
`docs/architecture/pages/mode-switcher.md:79` 已把 `MODE_DEFINITIONS` 写成
「ModeSwitcher、ModeRoute 与 Mode surface 的单一导航/展示契约…五档含 `custom`」，
首页侧栏仍然分叉了它，属九荣九耻「以创造接口为耻，以复用现有为荣」的直接违例。

`home-overview.tsx` 全文 `custom` 零命中，且 `packages/app/e2e` 对
`home-overview-mode-filter` 零覆盖——所以这个漏项没有任何门禁会发现。

### 2.8 P1-HOME-CUSTOM-NEW：全局首页「新建会话」在 custom 下必然失败，且新档会静默继承这个坑

**「首页」的定义**：本节及 §2.7 的「首页」指**加载后出现的全局首页**（`/`，`home-overview.tsx`），
不是各模式自己的首页（见 §0.5）。

全局首页的会话列表本身是模式无关的、且已正确：

| 环节                                  | 状态                                                               |
| ------------------------------------- | ------------------------------------------------------------------ |
| 计数 `home-overview-model.ts:5`       | 数五档（含 custom）                                                |
| 过滤 `helpers.ts:44-51`               | 对 `ProductMode` 泛型，无手写枚举                                  |
| 行渲染 `home-shared.tsx:52`           | 走 `SessionTabAvatar`（按项目），**无任何按模式手抄的图标/标签表** |
| 打开 `helpers.ts:262`→`:231`          | 与模式无关；`app.tsx:159` 经 `isMode`（五档）同步 `currentMode`    |
| **左栏筛选 `:345-351`**               | **手抄四档，漏 custom**（§2.7）                                    |
| **「新建会话」`:159-172`/`:301-308`** | **对 custom 必然失败**（本条）                                     |

**必然失败的链条**（每一步都已核验）：

1. `mode.currentMode` 在首页是**持久化的上次模式**（`mode.tsx:86-96`，`isMode` 校验通过即保留，
   所以访问过 `/mode/custom` 之后它就是 `"custom"`）。
2. `home-overview.tsx:165` 与 `:302` 都用 `mode: mode.currentMode` 调 `launchModeSession`。
3. `launchModeSession`（`helpers.ts:195-219`）→ `modeDraft(mode)` → 建普通草稿。
4. 首次发送走通用创建，而 `packages/core/src/product-mode-policy.ts:55-64`
   `assertCreationSupported` **对 custom 是 typed 拒绝**：
   「Generic session creation is not supported for mode "custom". Custom sessions require
   atomic snapshot creation via M1 composition start.」

所以这不是偶发，是**设计上必然**：custom 会话只能经 `customComposition.start` 原子创建
（dogfood 那条已闭环的 P0 就是这个 400 的另一种形态）。

**修好 §2.7 会把它从隐蔽变显眼**：左栏出现「自定义」档后，用户自然会在该档下点「新建会话」，
于是拿到一个注定发不出去的草稿。两条必须同批修。

**结构性缺口——这才是「以后加新模式怎么办」的落点**：
`launchModeSession` 的签名是 `mode: Mode`（`helpers.ts:196`），**未加约束的全档联合**；
全仓约 20 处调用点（`titlebar.tsx:346`、`secondary-sidebar.tsx:146/157/753/768`、
`mode-location-new-session.tsx:28`、`app.tsx:89`、`mode-surfaces.tsx:159`、
`home-overview.tsx:165/302`、`session.tsx:1689`、`assistant-dashboard.tsx:196`、
`mode-workspace-slots.tsx` 7 处等）里**没有一处知道 custom 不能通用创建**——
app 侧对 `UnsupportedProductModeError` / `assertCreationSupported` 零命中。
新增第六档会**自动继承「通用创建可用」这个假设**，没有任何门禁会说话。

### 2.9 附带债

| 债            | 已核验事实                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-CMD-DUP     | 警告出处 `packages/app/src/context/command.tsx:272`；`tab.close` **两处真实注册**：`components/titlebar.tsx:412` 与 `pages/session/use-session-commands.tsx:442`。是双 owner，不是生命周期泄漏——确定性小修                                                                                                                                                                                           |
| D-SOLID-OWNER | **无确认根因，需诊断 slice。**候选是 `packages/app/src/context/` 下 7 处 detached `createRoot`（`comments.tsx:212`、`tab-memory.ts:24`、`terminal.tsx:416`、`prompt.tsx:328`、`file/view-cache.ts:129`、`global-sync/child-store.ts:181`、`components/titlebar.tsx:601`）。其中 `tab-memory.ts:24` 与 `child-store.ts:181` 已显式传 owner / 用 `runWithOwner`，属正确用法——**不得先假定culprit再改** |
| D-E2E-GAP     | `packages/app/e2e/regression/` 现 26 spec；报告记录并行冷启动 6 例 `page.goto` timeout、单 worker 独立端口全绿。窄视口 / 浅色主题 / 多语言 / 键盘焦点矩阵无覆盖                                                                                                                                                                                                                                      |

---

## 3. 根因收敛

八项缺陷按**共同前提**形成四个收敛面（同一缺陷可跨面），而不是按文件分组。修一个点，好一片面：

### 面 A：跨边界时 typed 结果被丢掉或不被翻译

| 现象               | 共同前提                                          |
| ------------------ | ------------------------------------------------- |
| P0-REVERT-TARGET   | 入参携带的身份（`messageID`）在跨到快照层时被丢弃 |
| P1-PERMISSION-DENY | 用户意图的 typed 错误跨到工具边界时没有翻译规则   |

**共同判据**：边界上「身份或 typed outcome 被丢失」。修法一致——**在首次丢失语义的边界穷举 typed 输入并各自给去向**。
`llm.ts:422-440` 只提供 doom-loop 专属先例；普通 tool settlement 的 owner 必须由 S2 抵达形状 RED 决定，不能预设归并到 Registry。

### 面 B：状态机缺档——「进行中」与「已停」之间没有第三态

| 现象               | 共同前提                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------- |
| P1-TURN-STALL      | App `MessageTimeline`/`rows.ts` 无响应式时间维度；provider transport 缺完整 deadline 契约 |
| P1-MODE-MOUNT      | Suspense pending 无表示，路由「已可见」与槽「已就绪」是同一个态                           |
| P1-PERMISSION-DENY | 「因拒绝而终止」与「崩了」在持久数据里同形                                                |

**共同判据**：用户看到的两个状态（在转 / 没了）背后其实有三种真实状态，中间那个没有表示。
修法一致——**把中间态显式化，并各自给一个出口动作**。

### 面 C：生命周期归属不清

| 现象          | 共同前提                           |
| ------------- | ---------------------------------- |
| D-CMD-DUP     | 同一 id 两个注册 owner             |
| D-SOLID-OWNER | effect/cleanup 建在 owner 之外     |
| P1-MODE-MOUNT | 隐藏槽的资源生命周期不随可见性收敛 |

**共同判据**：谁创建、谁销毁没有单一答案。修法一致——**每个副作用认一个 owner**。

> 面 D 与面 A 的区别：面 A 是「边界上丢了 typed 输入」，面 D 是「按模式枚举的表面各自决定要不要接住新档」。
> 两者都靠「派生而非手抄」收敛，但验收物不同：面 A 验证错误可见，面 D 验证枚举等长同序。

### 面 D：第五档在 UI 表层没有被平等对待

| 现象                   | 共同前提                                                           |
| ---------------------- | ------------------------------------------------------------------ |
| P1-HOME-CUSTOM         | 首页手抄模式表，抄漏第五档                                         |
| P1-HOME-CUSTOM-NEW     | `launchModeSession` 的 `mode: Mode` 无约束，新档默认「能通用创建」 |
| §2.4 的 Assistant 门控 | 五档里唯独 assistant 的资源没接 `whenActive`                       |

**共同判据**：`MODE_DEFINITIONS` 是五档单一事实源，但**每个消费点自己决定要不要平等对待新档**，
于是「新增一档」没有任何结构保证会被各表面接住。修法分两种，按表面性质选，且都不靠人的记性：

| 表面性质                               | 收敛手段                                                   | 验收物                                            |
| -------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| **列表/枚举型**（首页筛选）            | 从 `MODE_DEFINITIONS` **派生**，删掉手抄                   | 断言与源逐项**等长同序**，非「包含 custom」       |
| **能力型**（能否通用创建、槽资源门控） | 把能力做成**收窄的类型**（镜像服务端判断），而不是自由联合 | `@ts-expect-error` 负测试：不表态的第六档不过编译 |

第二种才是「后面继续添加新模式怎么办」的答案：不是 shell 悄悄替新档兜住（那已被
`mode-page-unification-v2.md:17` 判为过度参数化），而是**新档不表态就编译不过**。

### 收敛验收

每个 slice 完成后必须报告「该分组还剩几条」。若修完面 A 后 P1-PERMISSION-DENY 的
控制台/事件证据未同时消失，说明分组错了，回到 §3 重新归类，不允许继续往下修。

---

## 4. 目标 owner 地图

| 关注点                                     | 目标 owner / 裁决方式                                                                                                       | 现状偏差                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 「回滚到哪个快照」                         | `packages/core/src/session/revert.ts` 内一个由 `messageID` 定位的选择函数                                                   | 谓词忽略 `messageID`                                                                                                              |
| 「permission outcome → 用户/模型可见结果」 | 由真实 leaf → `Tool.make` → Registry/Runner 抵达形状 RED 找到**首次丢失 typed 语义的边界**；只在语义相同时抽共享 translator | leaf 可能先泛化为 `ToolFailure`；Registry 只认 `ToolFailure`；`llm.ts` 映射属于 doom-loop 专用逻辑                                |
| 「轮次是否停滞」                           | 交互式 App 的 `MessageTimeline`/`rows.ts` 响应式派生 + schema/core provider timeout transport                               | enterprise share 虽渲染 `SessionTurn`，但状态固定 `idle`、stall 分支不可达；App timeline 无响应式时间输入，V2 settings 仍为宽类型 |
| 「模式槽是否就绪」                         | `mode-workspace.tsx` 的槽级边界（fallback + ErrorBoundary），`layout.tsx` 只保留最小全局兜底                                | 当前 pending 落到无 fallback 的全局 `layout.tsx:43`                                                                               |
| 「隐藏槽副作用」                           | slot 专属资源归 `mode-slot-active.ts`；顶层 Chat 资源归 Chat active owner 或经证据确认的 Workspace 共享 owner               | 6 组已接入；Assistant 五个 query 未接入；顶层 Chat 资源仍未分类                                                                   |
| `tab.close` 命令                           | 先跑 Home/Draft/Session/context 行为矩阵；当前推荐保留 Titlebar 全局 owner、删除 Session 重复注册                           | `titlebar.tsx` 与 `use-session-commands.tsx` 同时注册，直接删除任一处可能丢上下文                                                 |

---

## 5. 分阶段 TDD 工作流

每个 slice 独立走完 **RED → GREEN → REFACTOR → 包级门禁 → 数据流复查**，未通过不得进入下一个。
所有 RED 必须满足 `docs/testing.md` §10 #8 的判别式：临时把生产代码改对 → 变绿 → 还原 → 两次输出都进报告。

### S0：冻结行为基线（不改生产代码）

**目标**：把 6 条核心现状钉成可执行行为断言。每条先在 `origin/main=09a615232` 运行；受影响运行时应红，
未受影响运行时记录为基线通过，不得为了凑“全红”篡改 fixture。其余三项缺陷在 S5-S7 各自建立 RED。

| 断言                                                                                                 | 层                         | 基线判据                                   |
| ---------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------ |
| revert 到第 N 条用户消息 → `snap.restore` 收到第 N 轮的 `snapshot.start`                             | core 单测                  | **红**                                     |
| 真实 permission leaf 被 Denied/Corrected 后，报告运行时产生可见 error outcome、保留反馈且不静默消失  | core/aigcfroge Runner 测试 | 受影响运行时**红**；另一运行时记录实际结果 |
| App 真实 `MessageTimeline` 在 busy 且无可渲染输出超过阈值后出现 stalled 出口，响应式时钟推进即可触发 | app unit + e2e             | **红**                                     |
| 冷加载 `/mode/work` 时 `<main>` 出现 loading 表示                                                    | app e2e                    | **红**                                     |
| 无项目时点「新建会话」有可断言反馈                                                                   | app e2e                    | **红**                                     |
| `tab.close` 在 Home/Draft/Session/context 各恰有一个可执行 owner，快捷键与 palette 不重复触发        | app 单测/e2e               | 至少一个上下文**红**；同时记录未丢失场景   |

**产物**：`docs/review/five-mode-dogfood-2026-09-03/red-baseline.md` 记录 6 条的初始输出、运行时 flag、入口和环境。
**停止条件**：任一条「红得不对」（红的原因不是被测缺陷，而是测试自身写错）→ 重写该断言，不得进入 S1。

### S1：P0-REVERT-TARGET（core）

**RED**：`packages/core/test/session-revert-v2.test.ts` 新增用例——造 3 轮对话（每轮 assistant 带不同
`snapshot.start`），revert 到第 3 条用户消息，断言 mock 的 `restore` 收到第 3 轮的快照 id。
现状会收到第 1 轮的 → 红。`snapshotMock`（该文件 `:16-24`）已具备记录调用参数的形状，扩展它即可，**不新建 mock**。

**GREEN**：`revert.ts:31-35` 的谓词按 `input.messageID` 定位：找到该用户消息之后紧邻的、带
`snapshot.start` 的 assistant 消息。找不到时**保持既有语义**（`:37` 原样返回 session，不写标记、不动磁盘）。

**REFACTOR**：把「由 messageID 定位 assistant 快照」抽成本文件内的具名函数，删掉现在说谎的注释
（`:31` 那行注释描述的是修复后的行为，不是现状）。

**门禁**：`bun --cwd packages/core test test/session-revert-v2.test.ts` + `bun --cwd packages/core typecheck`

**数据流复查**：`session.revert` HTTP → `SessionRevert.revert` → `V2Snapshot.restore`（磁盘）

- `store.setRevert`（标记）→ SSE → app `roll()`（`session.tsx:1366`）→ `selectVisibleUserMessages`。
  确认修复后**标记与磁盘指向同一时点**，且 `:46` 的 diff summary 基线随之正确。

### S2：P1-PERMISSION-DENY（core）

**RED/探针**：

1. **V2 抵达形状**：对至少一个真实 permission leaf 依次触发 `DeniedError`、`CorrectedError`、`RejectedError`、
   `AskExpiredError`、`CommitRejected`，记录 leaf、`Tool.make`、Registry settlement 和 Runner 最终 part 的 `Exit/Cause`；
   探针只取事实，不预设必须抵达 `settleWith`。
2. **V2 行为**：可恢复的拒绝必须落为可见 `type: "error"`，`CorrectedError.feedback` 不丢；interruption/defect/CAS 冲突
   不得被吞成成功工具结果。轮次继续或停止沿用既有 Runner policy，并在断言中明确。
3. **V1 用户路径**：通过 `SessionProcessor.failToolCall` 的真实入口复现无反馈拒绝与带反馈拒绝，断言 error part、终止原因和
   用户可见反馈；不能只测 V2。

**GREEN**：严格按 §2.2 的探针结果选择最小 owner：

- 若 leaf 首先泛化错误，在 leaf 共用的明确边界保留/翻译 recoverable Permission outcome；
- 若 `Tool.make` 首先丢失 typed 语义，只扩展该适配边界的穷举契约；
- 只有错误以 typed failure 抵达 Registry 时，才在 `registry.ts` settlement 翻译；
- 若缺陷只存在 V1，只修 `SessionProcessor.failToolCall` 的可见状态/消息，不为形式统一改 V2。

任何方案都禁止 `catchCause` 宽吞 interruption/defect。`AskExpiredError`、`CommitRejected`、`NotFoundError` 各自给明确
操作语义；没有 RED 和协议证据，不得伪装成模型可恢复的普通 `ToolFailure`。

**REFACTOR**：只有普通 settlement 与 `llm.ts` doom-loop 分支的输入、输出、审计语义完全相同，才抽共享 translator；
否则保留两个具名边界，避免“归一化”抹掉 doom-loop 上下文。

**门禁**：`bun --cwd packages/core test --timeout 30000` + `bun --cwd packages/aigcfroge test --timeout 30000`；
权限类按 `docs/testing.md §10 #4` 成对覆盖 assert + 物化，并补报告入口的 App e2e/集成回归。

**数据流复查**：分别画出 V1 `HTTP reply → SessionProcessor → part/state → SSE` 与 V2
`HTTP reply → PermissionV2 → leaf → Tool.make → Registry/Runner → part → SSE`。确认“用户拒绝”“过期/并发冲突”与
“defect/interruption”在持久结果和 UI 中可区分。

### S3：P1-TURN-STALL（app + core），客户端真实 owner + 双运行时 Provider 契约

**先决**：先完成 §0.6 的运行时矩阵和 S0 preflight；再完成 §2.3 的调用图/错误路径 RED。不能因为 `SessionTurn` 有同名
`showThinking` 就跳过 App 交互式 owner 验证；enterprise share 的固定 `idle` 不变量只作为“当前无需同批修改”的证据。

**S3a — 客户端可见出口（app，必要时 session-ui 仅承载可复用纯视图）**

- **RED-1（生产调用图）**：Playwright 在 `MessageTimeline` 的真实详情页注入 busy + 无 assistant 输出，验证当前 DOM 仍只有
  `session-turn-thinking`，且没有 stalled/stop/retry 出口。测试必须从 App 路由进入，不能 import `SessionTurn` 代替。
- **RED-2（纯判定）**：从 `rows.ts`/时间模型抽出最小纯判定 seam，覆盖 `now < threshold`、`now === threshold`、`now > threshold`、
  缺失时间、已有可渲染 part、retry/error/idle 状态；仅由生产代码修改可变绿。
- **GREEN**：在 `message-timeline.tsx` 的真实 Thinking row owner 增加响应式 now/tick 和 stalled 分支；只在
  `busy + active + no error + no renderable assistant part + elapsed >= threshold` 下显示。若抽取纯判定函数，放在该 owner
  附近的 `.ts` 文件，不能另造 parallel SessionTurn runtime。
- **出口**：复用已有 abort/halt 与 `DialogSelectModel`。将 `stop`/`retry`/`changeModel` 通过现有 `UserActions`/MessageTimeline props
  传入；若现有 retry 只对 error/retry 状态开放，必须复用其底层 restart/resume action，而不是伪造 `status.type === "retry"`。
  动作执行期间有 disabled/busy 保护，失败走现有 toast/error owner。
- **展示**：可以复用 `SessionRetry` 的 Card/视觉层级，但不得复用 retry 的 `status.type === "retry"` 判据或 interval 文案；
  需要补 `en/zh/zht` i18n key，并验证 aria label、focus、窄视口和中英文溢出。
- **RED/green 判别式**：暂时让生产时间判定固定为“已超阈值”，运行 App e2e 确认 stalled 出现；还原后恢复 RED。测试不得
  通过修改自身 fixture 造出恒真条件。

**S3b — Provider timeout 契约（schema + core + V1/V2 运行时回归）**

**前置门禁（已实测）**：先用独立提交修复 `packages/core/src/plugin.ts` ↔ `packages/core/src/plugin/internal.ts` 的 ESM 模块循环。
当前 `plugin/internal.ts:119` 在 `plugin.ts` 尚未完成求值时读取 `PluginV2.locationLayer`；不同 import 顺序也可在
`plugin.ts:158` 反向读到尚未初始化的依赖。该错误发生在测试收集阶段，不是 `plugin.ts` 内部声明顺序问题。

影响面已量化：`session-revert-v2.test.ts` 为 2 pass、`session-runner-tool-registry.test.ts` 为 18 pass，故循环不阻塞 S1/S2；
`plugin/provider-dynamic.test.ts` 为 0 pass / 1 fail，且 plugin import surface 命中 48 个 Core 测试文件。S3b 的 provider/config
契约测试位于该红区，必须先取得 plugin boot layer 的绿基线，不能到 S3b 完成后才发现没有可用绿证。

- **RED-1（类型归属）**：在 `packages/schema/src/provider.ts` 对 AI SDK settings 解码/类型检查三档 timeout，且保留
  provider-specific rest options；`packages/core/src/config/provider.ts` 通过复用得到相同类型。不要用源码 `toContain`。
- **RED-2（V2 behavior）**：直接对 `packages/core/src/aisdk.ts` 的 fetch seam 做可控 fake server/fetch：无响应头、header 后无 chunk、
  omitted/default、false 关闭；断言 abort 的时序和错误归因。
- **RED-3（V1 parity）**：同一组关键语义在 `packages/aigcfroge` 现有 header-timeout/chunk-timeout 测试和报告用户入口中执行；
  先记录真实现状，不预设必须改 V1。若 V1 仍有受影响缺口，在 V1 真实 owner 做独立最小修复；否则保留通过证据。
  若 V1 与 V2 都是受影响用户路径，DoD 不能只留 core test。
- **GREEN**：schema owner 放在 `packages/schema/src/provider.ts`，core `MutableApi` 收窄；`aisdk.ts` 只从 typed settings 读取
  transport knobs，并保留其他 options。默认采用已有 V1 验证数值 10,000/60,000 作为候选，不 import V1 常量；若默认值
  改变现有测试语义，按停止条件停下，不强行改测试。
- **数据流**：config file → Config.Info/ConfigProvider.Info → Catalog merge → ModelV2.Info.api → Provider/Model adapter →
  `aisdk.prepareOptions` → fetch → LLM error/status → App `MessageTimeline`。每段都要给出类型和优先级断言。

**门禁**：`bun --cwd packages/schema test`（若 schema 变更）+ `bun --cwd packages/core test --timeout 30000` +
`bun --cwd packages/aigcfroge test --timeout 30000` + `bun --cwd packages/ui test`（若改共享 i18n/view）+
`bun --cwd packages/session-ui test`（若承载共享视图）+ `bun --cwd packages/app test:unit` + 相关 Playwright e2e；
受影响包 typecheck 全部通过。

### S4：P1-MODE-MOUNT（app shell：槽级 pending/error + Workspace 顶层资源）

**RED**：

1. App e2e——冷加载 `/mode/work`，在主区内容就绪前断言出现 loading 表示；现状 fallback-less `<Suspense>` 为空，故红。
2. App e2e/网络记账——在 Chat/Coding/Work/Assistant/Custom 间切换，断言可见槽正常请求、隐藏槽不新增专属请求，且
   `ModeWorkspace` 顶层 `chatAssetList`/`chatSystemData` 的调用被单独记账；不能只覆盖 Assistant `useQuery`。
3. App e2e——一个资源请求 pending、一个请求 rejected、一个部分成功时，槽仍保留在 DOM 并显示局部 loading/error，不得让
   整个 `<main>` 变成空白；现有 `mode-surface-wiring` / Custom partial-error fixture 优先复用。

**GREEN**：

- `<main>` 的全局 Suspense 补最小 fallback，但最终可见 loading/error owner 放在 `ModeWorkspace` 槽边界；复用
  `app.tsx:376-391` 的 `ErrorBoundary` 形状，不新建错误页/原语。
- `assistant-dashboard.tsx` 的五个 `useQuery` 加 `enabled: slotActive()`，照抄已存在的 `mode-workspace-slots.tsx:230-232`/`:624-626`。
- 处理 `mode-workspace.tsx:57-90` 的 Workspace 顶层 Chat 资源：优先建议移入 Chat owner 或绑定 Chat active gate；若保留共享预热，
  修改 DoD/记账为“共享 owner 可请求、hidden slot 专属资源为 0”，并测试切换与缓存生命周期。
- 槽包装抽取只在确认 Sidebar/Main 两处的 provider/display/fallback 语义相同后进行；抽取组件不能改变 render-all 的状态保留
  语义，也不能在 hidden slot 误卸载现有 draft/store。
- 新增 UI 只用既有 v2 token、`en/zh/zht` 三语 key、可见 focus 和 aria 语义；不要用硬编码 spinner 样式。

**REFACTOR**：允许抽取 slot wrapper，但不顺手重写已闭环的 6 处 `whenActive`；改动范围必须以 `assistant-dashboard.tsx`、
`mode-workspace.tsx`、`layout.tsx` 和测试为主，并在 diff 中证明未改其它已闭环 owner。

**门禁**：`bun --cwd packages/app test:unit` + `bun --cwd packages/app test:e2e` + `bun --cwd packages/app typecheck`。

**数据流复查**：route → `mode.currentMode` → visible/hidden slot display → slot active → resource source/enabled → SDK call。
另画出 Workspace 顶层 Chat resource 的 owner，确认它没有成为“隐藏资源无调用”的漏网项。

### S5：P2-REVERT-CONFIRM（session-ui + app），真实数据来源先于文案

**RED**：App e2e 在详情页点击真实的“重置到此点”按钮，断言：

1. 先显示确认对话框，取消后 `session.revert`/`session.unrevert`/abort 请求均为 0；
2. 文案基于当前 session diff/summary，能表达将影响的消息范围和文件数量；零文件、无 summary、无 snapshot 都有明确降级；
3. 确认后请求只发一次，失败时本地 timeline/draft 恢复，且错误可见。

**GREEN**：

- `message-part.tsx` 已在 `UserMessageDisplay` 内拥有 `useDialog()`，优先在该 owner 接确认，而不是在每个 App 页面复制按钮逻辑。
- 确认所需的文件数必须明确来自 `session_diff[sessionID]` 或服务端 `Session.Info` summary；如果当前 `UserMessageDisplay` 没有
  该数据上下文，沿 `MessageTimeline`/`Session` props 传入一个只读 `revertPreview`，不得在 UI 重新猜 snapshot。
- 文案同时说明：消息投影可由现有 dock restore 恢复；工作区文件已实际写回并可通过现有 restore 回去。只有真实有 snapshot/diff
  时才显示文件数，不能把“消息条数”冒充“文件数”。
- `session-revert-dock.tsx:15-23` 改为：新一次 revert 后默认展开一次；用户手动折叠后不因每个 items 响应式变化再次强制展开。
  保留已有 restore 请求和失败回滚，不新建撤销系统。
- `V1` 与 `V2` 的 revert endpoint 都至少跑一条确认/取消回归；Custom 如走不同创建/详情树，明确是同一确认 owner 还是记录
  为不支持范围，不能静默绕过。
- 新增文案按所属 i18n owner 写入 `packages/ui/src/i18n/{en,zh,zht}.ts`（session-ui message）和/或
  `packages/app/src/i18n/{en,zh,zht}.ts`（app dock），并运行 parity。

**门禁**：`bun --cwd packages/ui test`（若改共享 i18n）+ `bun --cwd packages/session-ui test` +
`bun --cwd packages/app test:unit` + `bun --cwd packages/app test:e2e`；受影响的 `ui`/`session-ui`/`app` typecheck 全部通过。

### S6：首页两项（app）——P1-HOME-CUSTOM + P2-HOME-EMPTY

同一个全局 Home owner 一起修，但测试必须分辨模式筛选和空项目反馈两条行为。

**RED**：

1. 将 `HomeOverviewSidebar` 的 filters 逻辑抽成最小纯 `.ts` owner 后，断言输出与 `MODE_DEFINITIONS` 派生结果逐项等长同序；
   禁止源码字符串断言，也不能只断言包含 `custom`。
2. App e2e 构造真实无项目状态，点击全局 Home 的“新建会话”，断言打开既有目录/项目选择器或显示明确引导；现状静默
   early return，故红。另断言点击后无 project 时没有 `POST /session`。
3. App e2e 构造含 Custom session 的 Home 数据，选择 Custom filter，断言列表实际只显示 Custom 记录；不能只看 count 为 0 的空态。

**GREEN**：

- 删除 `home-overview.tsx:345-351` 手抄列表，从 `MODE_DEFINITIONS` 派生 `all + definitions.map(...)`；label 用 definition 的
  `labelKey`，count 用 `Record<Mode, number>`，顺序由单一事实源决定。
- `!directory` 时复用已有 `useDirectoryPicker`/“添加项目”入口；`!conn || !ctx` 是连接缺失，使用现有 toast owner，不能与无项目混成
  同一个 silent return。
- 过滤状态仍由 Home owner 管理，列表管线复用 `filterSessionsByMode`/`home-shared`；不修改各模式主页会话列表债。

**门禁**：`bun --cwd packages/app test:unit` + `bun --cwd packages/app test:e2e` + `bun --cwd packages/app typecheck`。

### S7：P1-HOME-CUSTOM-NEW（schema + core policy + app）——把通用创建能力变成共享契约

**范围边界**：只处理全局 Home/Titlebar 等普通新建入口；五个模式主页现有会话列表不在本 slice。

**RED**：

1. **Schema 类型级**：在 `packages/schema/src/product-mode.ts` 建立唯一的 `GenericSessionMode`/等价“可通用创建模式”类型，
   由 `chat | coding | work | assistant` 明确构成；`custom` 和未来未表态的新档不可赋值。
2. **Core 一致性**：`packages/core/src/product-mode-policy.ts:55-72` 的 `assertCreationSupported` 必须消费同一个 schema
   集合/谓词，测试逐档比较“客户端可传集合”和服务端允许集合；禁止 app 复制四个 if 分支。
3. **App 纯行为**：`launchModeSession` 和 `modeDraft` 的普通新建参数收窄后，动态 `currentMode === "custom"` 的 Home/Titlebar 路径
   不能创建普通 Custom draft；断言改为导航 `/mode/custom`/Builder 或给出明确说明，且不发通用 `POST /session`。
4. **旁路清点**：`tabs.newDraft({ ...modeDraft(mode.currentMode) })`（`titlebar.tsx:354`）必须纳入同批；只收窄
   `launchModeSession` 不算闭环。

**GREEN**：

- schema owner 定义 `GenericSessionMode` 和派生集合；Core policy import 该 owner 并用 `Schema`/集合做 fail-closed 判断。
- `packages/app/src/pages/layout/helpers.ts:195-219` 的 `launchModeSession` 接受 `GenericSessionMode`；`modeDraft` 同样不接受
  `custom`，避免绕过普通创建护栏。固定字面量调用点保留；动态点显式分支到 Custom Builder。
- `HomeOverview` 使用 `useNavigate` 复用既有 `/mode/custom` 路由；Titlebar 在 current mode 为 custom 时也走同一导航 owner，
  不新建普通 draft。若当前页面无 `useNavigate` 上下文，必须先复用既有 `tabs`/route helper 并补 e2e，而不是静默 return。
- Schema 改动不等于 OpenAPI 改动：只有生成脚本检测到公共 HTTP schema 变化时才重生成 SDK；不得手改生成物。

**REFACTOR**：只保留一个共享能力类型/集合；不要新增 `isGenericSessionMode` 的 app/core 平行版本。

**门禁**：`bun --cwd packages/schema test` + `bun --cwd packages/core test --timeout 30000` + `bun --cwd packages/app test:unit` +
`bun --cwd packages/app test:e2e` + 三包 typecheck（若 schema 进入 SDK/API，再执行生成脚本和 SDK drift 检查）。

**数据流复查**：persisted `currentMode` → Home/Titlebar new action → generic-mode type guard → Draft 或 `/mode/custom` Builder →
Custom `customComposition.start` atomic Session。确认不存在“可点、能建草稿、首次发送必 400”的路径。

### S8：附带债

**S8a — D-CMD-DUP**：先做行为矩阵，再收敛为一个全局 owner。

- 矩阵必须覆盖 Home 当前 tab、Draft tab、Session tab、Session context 子 tab、无可关闭 tab、快捷键、command palette、Tab close button。
- **RED**：通过 `useCommand().options`/注册表行为断言 `tab.close` 对每种上下文最多一条有效 registration；不得读源码字符串。
- **推荐 GREEN owner**：保留 `titlebar.tsx:399-419` 的全局 tab command，因为它覆盖 Home/Draft/Session 当前 tab；删除
  `use-session-commands.tsx:430-447` 中重复的 `fileCmds()` `tab.close`，而 Session context/Tab UI 继续只读取
  `command.keybind("tab.close")`。若行为矩阵证明 Titlebar 在某上下文未挂载，才反向选择 Session owner，并补全 Home/Draft 的全局 owner，
  不能直接删除全局注册。

**S8b — D-SOLID-OWNER 诊断**：先诊断不先改。在 `command.tsx:272` 捕获 dev-only stack，跑 S4/S8a 相关 e2e，按真实栈顶分类：

- 已显式传 owner/`runWithOwner` 的 `tab-memory.ts:24`、`global-sync/child-store.ts:181` 保持不动；
- culprit 在本批已改范围才修；在范围外只把栈顶、触发场景、是否影响生产 build 写回本计划和技术债台账；
- dev-only 诊断不得进入生产日志、不得包含 token/prompt/用户文件内容。

**S8c — D-E2E-GAP**：

- 冷启动问题不通过提高 `page.goto`/test timeout 掩盖。先在 `e2e/utils/waits.ts` 建可复用 readiness gate：等待 Vite/backend
  真实 ready signal，再导航目标路由；并行 worker 场景用单 worker 独立端口复现，记录是否为 server/process/resource contention。
- 新增窄视口覆盖只针对本计划新增表面：S3a stalled 出口和 S4 slot fallback；至少断言 keyboard focus/Enter/Escape 路径，
  不宣称已覆盖完整 light/dark/18 locale 矩阵。
- 每条 E2E gap 必须有完成信号（DOM/网络/URL/事件），禁止只靠 sleep/timeout。

**门禁**：`bun --cwd packages/app test:unit` + `bun --cwd packages/app test:e2e` + `bun --cwd packages/app typecheck`。

## 6. 文件变更范围（预估）

下表是 blast-radius 上界，不是预授权修改清单。S2、S3a、S8a 的最终生产文件由 RED/行为矩阵决定；未被证据触达的候选文件不改。

| 文件                                                                   | 性质                                                                      | Slice                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------- |
| `packages/core/src/session/revert.ts`                                  | 修改                                                                      | S1                    |
| `packages/core/test/session-revert-v2.test.ts`                         | 扩展                                                                      | S0/S1                 |
| `packages/core/src/tool/{tool,registry,bash,...}.ts`                   | RED 决定首次丢失 typed permission outcome 的边界                          | S2                    |
| `packages/core/src/session/runner/llm.ts`                              | 仅在 doom-loop 与普通 settlement 可安全复用时修改                         | S2                    |
| `packages/aigcfroge/src/session/processor.ts`                          | 仅当 V1 用户路径 RED 证明仍有缺陷时最小修改                               | S2                    |
| `packages/core/test/tool-*.test.ts` / Runner 相关测试                  | permission 抵达形状与行为矩阵                                             | S0/S2                 |
| `packages/aigcfroge/test/**`                                           | V1 permission/provider 用户路径回归                                       | S2/S3b                |
| `packages/core/src/plugin.ts` / `packages/core/src/plugin/internal.ts` | 修复 ESM location-layer 循环；独立前置提交                                | S3b 前置              |
| `packages/schema/src/provider.ts`                                      | Provider settings typed owner                                             | S3b                   |
| `packages/core/src/config/provider.ts`                                 | 复用 typed settings                                                       | S3b                   |
| `packages/core/src/provider.ts`                                        | `settings` 收窄                                                           | S3b                   |
| `packages/core/src/aisdk.ts`                                           | typed timeout transport                                                   | S3b                   |
| `packages/schema/src/product-mode.ts`                                  | GenericSessionMode owner                                                  | S7                    |
| `packages/core/src/product-mode-policy.ts`                             | 消费共享创建能力集合                                                      | S7                    |
| `packages/app/src/pages/session/timeline/message-timeline.tsx`         | 真实 stalled owner；传 revert preview/actions                             | S3a/S5                |
| `packages/app/src/pages/session/timeline/rows.ts`                      | stalled row 判定 seam                                                     | S3a                   |
| `packages/session-ui/src/components/session-turn.tsx`                  | 当前不改；仅当 enterprise share 改为实时非 idle 状态并出现独立 RED 时纳入 | S3a（条件）           |
| `packages/ui/src/i18n/{en,zh,zht}.ts`                                  | session-ui 所属文案（若共享视图承载）                                     | S3a/S5                |
| `packages/app/src/i18n/{en,zh,zht}.ts`                                 | App 时间线/dock 所属文案                                                  | S3a/S5/S6/S7          |
| `packages/app/src/pages/layout.tsx`                                    | 最小全局 fallback                                                         | S4                    |
| `packages/app/src/pages/mode-workspace.tsx`                            | 槽边界 + 顶层 Chat resource owner                                         | S4                    |
| `packages/app/src/pages/assistant-dashboard.tsx`                       | 五处接 active gate                                                        | S4                    |
| `packages/session-ui/src/components/message-part.tsx`                  | 确认 owner/preview props                                                  | S5                    |
| `packages/app/src/pages/session.tsx`                                   | revert preview/rollback wiring                                            | S5                    |
| `packages/app/src/pages/session/composer/session-revert-dock.tsx`      | 修改 discoverability                                                      | S5                    |
| `packages/app/src/pages/home-overview.tsx`                             | filters/empty/custom route                                                | S6/S7                 |
| `packages/app/src/components/titlebar.tsx`                             | Custom 新建分支；按矩阵保留/收敛 global tab owner                         | S7/S8a                |
| `packages/app/src/pages/session/use-session-commands.tsx`              | 仅在行为矩阵支持推荐 owner 时删除重复 `tab.close`                         | S8a                   |
| `packages/app/e2e/utils/waits.ts`                                      | readiness gate                                                            | S8c                   |
| `packages/app/e2e/regression/*.spec.ts`                                | 新增/扩展行为回归                                                         | S0/S3/S4/S5/S6/S7/S8c |
| `docs/architecture/pages/{work,mode-switcher,home}.md`                 | 行号/描述同步                                                             | S4/S6/S7 收尾         |
| `docs/technical-debt.md` §4.1                                          | 按证据部分/完全闭环                                                       | 每 slice              |

**S3b 范围护栏**：三档 timeout 在 V2 侧建立 typed 契约；V1 与 V2 各自按真实 transport owner 验收。
行为差异必须记录，任何仍受影响的默认用户路径保持开放，不能以“V2 更正确”为由代替完整关闭。

**明确不做**：V2 不复用或反向 import 将退役的 V1 provider helper；不因无 RED 的 parity 偏好重写 V1；不手改 SDK 生成物。
若 V1 用户路径 RED 证明仍有本报告缺陷，则允许在 V1 真实 owner 做独立最小修复，不能与 V2 typed contract 混成一个实现。
Schema 包是 S3b/S7 的 typed owner；只有公共 HTTP/API schema 实际变化且生成脚本判定有 drift 时才重生成 SDK。
`packages/effect-drizzle-sqlite` / `packages/effect-sqlite-node`（vendor 桥接）不动；已门控的 6 组资源只做回归，
不顺手重写（`mode-workspace-slots.tsx` / `mode-surfaces.tsx` / `custom-sidebar.tsx` / `custom-preview-column.tsx`，见 §2.4）。

**页面文档必须同步的理由**：`docs/architecture/pages/work.md:22-23` 直接引用
`mode-workspace-slots.tsx` 与 `mode-workspace-slots.tsx:667`，`mode-switcher.md:79` 描述
`MODE_DEFINITIONS` 的 surface slot 契约。S4 动槽包装后这些行号与描述即失效。
先例：`five-mode-tdd` 上的 `f70c94bbd docs: S9.6 — the three page docs that described a codebase from a month ago`（已 squash 进 `09a615232`）——
这个仓库的页面文档已经因为不同步坏过一次，不重复。

---

## 7. 提交与 PR 切片

每个提交只承载一个可独立验证、可独立回滚的变更，消息体写「红在哪 / 为什么这么修」。一个 slice 可以有前置 RED 测试提交；
跨包契约只有在每个提交都能保持可验证和可回滚时才拆分。实施分支 `dogfood-remediation` 在计划合入并推送后
**从最新 `origin/main` 新切**，命名遵守 `AGENTS.md`「最多三个词、连字符、禁类型前缀」。
`dogfood-remediation-plan` 只承载计划、审查修订与执行提示词。

| 提交                        | 内容                                                                   |
| --------------------------- | ---------------------------------------------------------------------- |
| `test(core)`                | S0 RED/探针基线（core 与 V1 runner 相关断言可按包拆提交）              |
| `test(app)`                 | S0 App 行为基线                                                        |
| `fix(core)`                 | S1 revert 目标选择                                                     |
| `fix(core)`                 | S2 V2 permission outcome（仅按 RED 命中的 owner）                      |
| `fix(aigcfroge)`（条件）    | S2 V1 可见拒绝语义，仅在 V1 RED 时创建                                 |
| `fix(app)`                  | S3a App 生产时间线 stalled 出口；enterprise share 固定 idle 路径不改   |
| `fix(core)`                 | S3b 前置：解除 `plugin.ts` ↔ `plugin/internal.ts` location-layer 循环 |
| `fix(schema)` / `fix(core)` | S3b typed Provider schema 与 V2 transport；按可回滚边界拆分            |
| `fix(aigcfroge)`（条件）    | S3b V1 stall，仅在默认路径 RED 时创建                                  |
| `fix(app)`                  | S4 槽级 fallback + Assistant gate + 顶层 Chat resource owner           |
| `fix(app)`                  | S5 revert 确认 + dock 可发现                                           |
| `fix(app)`                  | S6 首页模式筛选派生 + 空状态引导                                       |
| `fix`                       | S7 schema/core/app 通用创建能力契约 + Custom Builder 分支              |
| `refactor(app)`             | S8a `tab.close` 单 owner（以行为矩阵为准）                             |
| `fix(app)` 或 `docs(debt)`  | S8b 只在 culprit 位于本批范围时修，否则记录真实栈顶                    |
| `test(app)`                 | S8c e2e readiness + 两项覆盖                                           |
| `docs(debt)`                | §4.1 按实际闭环状态更新                                                |

**PR 边界建议**：拆 3 个可回滚单元：

1. S1 + 经 RED 证明的 S2 core/session correctness；
2. S3b 前置 plugin 模块循环修复 + schema/core provider contract（必要时加 V1/V2 parity 证据）；
3. S3a/S4/S5/S6/S7/S8 app observability/UX。

S7 虽然含 schema/core policy 类型约束，但其用户行为与 Home/Titlebar 同批验证；不能把 S7 漏在提交表之外。

## 8. 验证命令（逐 slice 执行，非最后一次性跑）

**S0 前置 preflight（只记录基线，不修改生产代码）**：先运行受影响包的 typecheck/test，保存已有失败的完整命令、首个错误和
是否与本计划变更无关。当前已知基线失败为：

- `bun --cwd packages/core test test/plugin/provider-dynamic.test.ts`：0 pass / 1 fail，抛出点为
  `packages/core/src/plugin/internal.ts:119:22` 的 `Layer.provideMerge(PluginV2.locationLayer)`；
- `bun --cwd packages/core test test/config/provider.test.ts`：同一循环在另一 import 顺序下可抛于
  `packages/core/src/plugin.ts:158:22`；根因是 `plugin.ts` ↔ `plugin/internal.ts` 的模块求值循环，不是单文件内部顺序；
- `bun --cwd packages/core test test/session-revert-v2.test.ts`：2 pass / 0 fail；
- `bun --cwd packages/core test test/session-runner-tool-registry.test.ts`：18 pass / 0 fail；
- `bun --cwd packages/session-ui typecheck`：`markdown-shiki.worker.ts:74,85,86` 的多版本 `@shikijs/types` 类型不兼容。

结论：plugin 循环**不阻塞 S1/S2**，但会阻塞 S3b 所需的 provider/config/plugin boot 绿证，所以它是 S3b 点名前置，
不是所有 slice 的全局前置。上述基线红不能被“跳过”或算作本计划绿证。

```bash
# 增量 lint —— 注意基线陷阱：本地 main 有未推送提交时必须显式给基线
LINT_BASE_REF=origin/main bun run script/lint-changed.ts

# 包级 typecheck（tsgo，不用 tsc；只跑本 slice 触达的包）
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/ui typecheck
bun --cwd packages/session-ui typecheck
bun --cwd packages/app typecheck          # = tsgo -b && tsgo --noEmit -p e2e/tsconfig.json

# 包级测试（永不从根目录跑；只跑本 slice 触达的包）
bun --cwd packages/schema test
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/ui test
bun --cwd packages/session-ui test
bun --cwd packages/app test:unit
bun --cwd packages/app test:e2e

# 协议引用检查（docs 改动后）
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
git diff --check
```

## 9. RED→GREEN 证据模板（每 slice 必填）

```text
Slice: S<n> <名称>
RED 输出:        <失败断言与实际值>
可满足性判别式:  临时改对生产代码 → <变绿输出> → 已还原 → <复红输出>
GREEN 输出:      <通过输出>
收敛验收:        面<A/B/C/D> 该分组剩余 <n> 条
已运行命令:      <逐条>
剩余风险:        <诚实列出，不得为空写"无"除非真的逐项确认过>
```

## 10. 停止条件与回滚

**必须停下报告，不得自行绕过**：

1. 任一 RED「红得不对」——红的原因不是被测缺陷。
2. S2 的抵达形状探针显示 recoverable Permission outcome 已变成 defect，或需要通过 `catchCause` 才能恢复——
   说明首次丢失边界/错误契约超出当前裁决，需重新画数据流并回报，不能直接在 Registry 兜底。
3. S3b 开始前 plugin boot layer 的模块循环仍未修复——provider/config 测试会在收集阶段失败，无法形成有效 RED/GREEN 证据。
4. S3b 的默认值让既有测试改变通过条件——有测试依赖「永不超时」。
5. S4 接入 `whenActive` 后某模式功能失效——说明该资源确实需要在隐藏态运行，属设计冲突而非漏接。
6. S8b 诊断出的 culprit 落在本计划范围外。
7. 修完一个面后该分组现象未同时消失（§3 收敛验收失败）。

**回滚**：每 slice 一个提交，`git revert <sha>` 即可单独退。S2 按 RED 命中的 owner 切片；只有确实抽取共享 translator 的文件
才必须同提交一起退。S3a/S3b 分别回滚（前者 App 展示/动作，后者 schema/core transport；条件性 V1 修复再独立回滚）。

## 11. Definition of Done

- [ ] 8 项缺陷各有一条**曾经红过**且可由生产代码满足的自动化断言；每条 RED→临时生产修复→变绿→还原复红证据入报告。
- [ ] §0.6 运行时矩阵完成：默认 `AIGCFROGE_V2_RUNTIME=false`、`true`，Custom flag/capability，以及实际触达的 sync/async 入口均有记录。
- [ ] §3 四个面各自的收敛验收通过；若某面只在 V2 消失而 V1 仍复现，保持开放，不移出债台账。
- [ ] P0 revert 的目标选择、磁盘恢复、消息 projection、summary/diff 四者指向同一时点；无目标时不写盘。
- [ ] Permission 的 Denied/Rejected/Corrected/AskExpired/CommitRejected 分别有明确 outcome；无 `catchCause` 吞 interruption/defect，
      且 V1/V2 用户路径各有回归。
- [ ] S3a 修改的是 App 生产时间线 owner（`MessageTimeline`/`rows.ts`），或有 call graph 证据证明共享组件确实被生产调用；
      stalled 在响应式时钟推进后可见，且 stop/retry/model action 可达。
- [ ] S3b 开始前 `plugin.ts` ↔ `plugin/internal.ts` 模块循环已在独立提交中修复，provider/config/plugin boot 目标测试可收集并通过；
      S1/S2 不被迫等待该前置。
- [ ] 三档 timeout 在 schema typed owner、Core Config/Catalog/Model/AI SDK transport 全链路可追踪；V1/V2 header/chunk/total
      timeout 语义和关闭档有回归；`settings: any` 不再作为自家契约逃逸。
- [ ] S4 除 Assistant 五个 query 外，Workspace 顶层 Chat 资源的 owner/生命周期也有测试和 DoD 解释；不再有未分类漏网请求。
- [ ] S7 的 `GenericSessionMode`（或等价共享类型）由 schema 唯一拥有，Core policy 与 App 消费同一 owner；`custom` 不能进入普通
      `launchModeSession`/`modeDraft`，Home/Titlebar custom 新建走 Builder/明确引导。
- [ ] S5 取消确认零请求；确认文案的文件数来自真实 diff/summary；失败回滚覆盖 V1/V2/Custom 适用路径。
- [ ] S8a 行为矩阵通过，`tab.close` 在 Home/Draft/Session/context 不重复且不丢失；S8b 的 culprit 已修复或以栈顶写债。
- [ ] S8c readiness gate 不靠提高 timeout；S3a/S4 新增窄视口键盘回归有 URL/DOM/网络完成信号。
- [ ] 受影响包 typecheck + test 全绿：`schema`（若改）、`core`、`aigcfroge`、`ui`（若改）、`session-ui`（若改）、
      `app`（含 e2e）。
- [ ] `LINT_BASE_REF=origin/main bun run script/lint-changed.ts` 零新增问题；`git diff --check` 通过；协议引用检查通过。
- [ ] 安全门禁：Catch Everything、No Null Pointer、Security First、No Cheating、Reusability、Clean Logs 逐项记录证据。
- [ ] `docs/technical-debt.md §4.1` 逐项更新：5 个原开放项、新增 3 项、D-CMD-DUP、D-E2E-GAP 按实际部分/完全闭环分别记录；
      D-SOLID-OWNER 只有诊断定位在本批范围内并完成修复才可移入已闭环。
- [ ] `docs/review/five-mode-dogfood-2026-09-03/report.md` 补 §0.3 三处更正和运行时限制；不能把原报告默认 V1 路径冒充 V2。
- [ ] `docs/architecture/pages/{work,mode-switcher,home}.md` 的描述/行号与改后代码同步。
- [ ] 每个实际 slice 在提交表中有独立提交，S7 不得遗漏；实施日志在 `dogfood-remediation` 分支按 Slice 回写。
- [ ] 计划分支不含生产代码；实施 worktree 从推送后的最新 `origin/main` 创建并记录准确 SHA。

## 12. 裁决记录与实施期停止条件

本节只保留已经由协议或本次代码复核确定的边界；会改变用户可感知行为或依赖 RED 事实的事项，不伪装成既定答案。

| ID  | 裁决/约束                                                                                                             | 判据                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| D0  | `09a615232` 为代码审查基线；生产实施分支 `dogfood-remediation` 从计划合入后的最新 `origin/main` 创建                  | 审查事实与实施 Git 基线分层，禁止混称或硬退回                  |
| D1  | V1/V2 都必须出现在验收矩阵；不允许 V2-only 结果关闭默认用户报告                                                       | `docs/testing.md §10 #5` 双运行时 parity                       |
| D2  | P0 revert 先修目标选择，再写确认文案；确认总是弹                                                                      | 磁盘破坏性写入 + Security First                                |
| D3  | Permission translator owner 由真实抵达形状 RED 决定；不得预先指定 Registry                                            | `Tool.make`/leaf/Registry/Runner 的实际边界不同                |
| D4  | Provider settings schema owner 在 schema；Core Config/Catalog 复用，V2 不 import 将退役 V1 helper                     | 共享 API shape 与依赖方向                                      |
| D5  | S3a 以交互式 App `MessageTimeline` 为 owner；enterprise share 虽使用 `SessionTurn`，但固定 `idle` 使 stall 分支不可达 | 真实 call graph + `[shareID].tsx` 状态不变量 + route-level e2e |
| D6  | Workspace 顶层 Chat resource 必须分类；不能把 slot 外副作用排除在 hidden-effect DoD 外                                | 根因收敛与生命周期 owner                                       |
| D7  | Custom 普通新建采用 `/mode/custom` Builder + `customComposition.start` 原子创建；禁止普通 Custom draft                | `assertCreationSupported` + Custom atomic start contract       |
| D8  | `tab.close` 先行为矩阵；推荐保留全局 Titlebar owner，结果以 RED 为准                                                  | Home/Draft/Session 生命周期覆盖                                |
| D9  | D-SOLID-OWNER 先诊断，culprit 在范围外只记债                                                                          | 禁止盲目修改                                                   |
| D10 | plugin location-layer 模块循环是 S3b 点名前置，不是 S1/S2 的全局前置                                                  | 目标测试 2/18 pass；provider-dynamic 在收集阶段失败            |

**实施期必须停下并回报：**

1. 任一 RED 红因测试自身错误、基线环境错误或不能由生产代码满足；
2. V1/V2 某一条实际入口仍静默停转，且当前 slice 只修了另一运行时；
3. S2 探针显示 defect/interruption 被吞或 CommitRejected 被误作普通工具结果；
4. S3b 开始时 plugin 模块循环仍导致测试收集失败，或循环修复无法作为独立绿提交；
5. S3b typed 收窄影响范围超出 schema/core/aigcfroge，或现有 provider-specific options 被破坏；
6. S4 gate 后某模式功能失效，或顶层 Chat resource 无法定义 owner；
7. S8b culprit 超出本批范围；
8. 任一“收敛面”修完后该面中另一现象仍然复现。

## 13. 方案对冲声明

**被否的简单实现**（如选它必须显式记债）：

| 简单做法                                          | 为什么否                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| S1 只改注释，让代码「符合描述」                   | 注释是对的，代码是错的。改注释等于把缺陷合法化                     |
| S2 只在 UI 上显示「权限被拒」                     | 轮次仍然终止，模型仍然学不到；治标                                 |
| S3 只给总时长超时一个默认值                       | 会杀掉合法长轮次；形状错误                                         |
| S3b 让 V2 复用 / import V1 的常量与 helper        | V1 迟早退役，存活侧挂将死侧；`归并` 的 owner 必须落在 V2（§2.3）   |
| S3b 只改 `aisdk.ts` 不动 V2 schema                | 那等于继续吃 `settings: any` 透传，`No Cheating` 不允许            |
| 把 `settings: any` 收口登记成债、本批不动         | No Null Pointer 把「配置」逐字列为必须收窄；债只能记协议允许的取舍 |
| S4 给 `layout.tsx:43` 加个 spinner 就收工         | 跨模式请求风暴不解，且隐藏槽的失败仍会打穿边界                     |
| S5 直接加确认框                                   | 在 S1 之前加，确认的是错误行为                                     |
| S7 只给 Chat/Custom 各补一个列表                  | 第六档照样漏；收敛手段必须是契约而不是补丁（面 D）                 |
| S7 在 app 侧复制 `assertCreationSupported` 的分支 | 复制即第二事实源；必须镜像同一处判断                               |
| S8c 给 e2e 加 timeout                             | CLAUDE.md 根因收敛表已把「构建挂死就加超时参数」列为不收敛的典型   |

**本计划自身承认的技术债**：

- 浅色主题、全语言、完整键盘焦点矩阵仍未覆盖（沿用既有债条目，本批不扩张）。
- S3a 的停滞阈值是产品判断而非实测分布；上线后应据真实 provider 延迟分布回调，此项记债。
- `ChatFeatureSidebar` 与 `mode-workspace.tsx` 两处读同七类资产的重复读取，`mode-workspace.tsx:74-76`
  已记为债，本计划不合并（不在根因面内，合并属顺手改）。

---

> **审批后方可创建实施提交。** 本文件在实施过程中随裁决与证据持续回写，不另建第二份状态文档。
