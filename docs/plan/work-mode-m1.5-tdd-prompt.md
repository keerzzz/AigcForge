# Work 模式 M1.5 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 Work M1.5。
> **来源**：[M1.5 实施计划](work-mode-execution-layer-m1.5.md)（Approved）、[Work 路线图](work-mode-roadmap.md)、[Work PRD v4.1](../prd/work-mode-execution-layer.md)、[M1 TDD 手册](work-mode-m1-tdd-prompt.md)
> **分支**：`work-m1.5`（从最新 main 切出）
> **完成标准**：§9 验收清单全过 + typecheck/lint/test 绿

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈工程师。本提示词让你**独立、端到端**执行 [Work 模式 M1.5：进度账本与断点恢复](docs/plan/work-mode-execution-layer-m1.5.md)（Approved）。范围真源是那份计划，本提示词是执行手册。开工前必须通读：`CLAUDE.md`、`AGENTS.md`、`packages/core/src/tool/AGENTS.md`、`packages/aigcfroge/AGENTS.md`、`packages/app/AGENTS.md`、`.aigcfroge/skills/effect/SKILL.md`、`.aigcfroge/skills/protocols/SKILL.md`。

---

## 0. 你的任务（一句话）

让 work-orchestrator 把文档生成拆成可追踪步骤 Task（澄清->构思->撰写->校验），中栏 ProgressLedger 进度条展示步骤状态（复用 SessionTodoProgress），中断/失败时提供"从断点恢复"按钮，用户点击后 work-orchestrator 读 task list 的 outputDigest 增量摘要从 currentStepIndex 续传。

## 1. 范围与禁区

### 1.1 范围（M1.5 只做这些）
- work-orchestrator 解禁 task_create/update/delete/reorder 工具
- work-orchestrator SYSTEM_PROMPT 步骤化 + Resume 指引
- task_update 工具 + updateTask Service 扩展 outputDigest 字段
- SessionTodoProgress 加 Resume 按钮（mode-aware 仅 work）+ outputDigest 展示
- computeProgressLedger 纯派生函数（currentStepIndex + canResume）
- i18n（en/zh/zht）+ 埋点 work_step_resumed

### 1.2 禁区（违反即返工，绝对不做）
- ❌ 不改 M1 候选稿载体（候选稿=assistant 消息正文，不变）
- ❌ 不解禁 edit/shell/command/spawn/schedule
- ❌ 不做 TaskDriver background resume（对话级 resume，用户在场）
- ❌ 不新建 Service/表/组件（复用 SessionTodoProgress）
- ❌ 不新建 ProgressLedger Schema/落库（纯派生，= Task List 子集）
- ❌ 不做"存为资产"（M2）/ DataAnalysis（M3）
- ❌ 不新建数据库 migration（output_digest 列 M2 已落库）

## 2. 设计决策（已定案，必须遵守）

### 2.1 D1 工具集
- 解禁 task_create/task_update/task_delete/task_reorder（permission action = 工具注册名，依据 tool/AGENTS.md:45）
- 仍 deny：task（delegate）/taskspawn/taskschedule/edit/write/shell
- product-mode-agent-policy **无需改**（task 非 command，不受 checkCommandAllowed deny 影响）

### 2.2 D2 ProgressLedger UI = 复用 SessionTodoProgress
- 不新建组件，复用 message-timeline.tsx:1725 已挂载的 SessionTodoProgress（Work 会话走同路径）
- 增强：Resume 按钮（`canResume && mode==="work"`）+ outputDigest 副文案
- 改 timeline 前录生产基准（packages/app/AGENTS.md 强制）

### 2.3 D3 outputDigest 填充
- 扩展 task_update 工具 Input + updateTask Service 加 outputDigest 可选字段
- work-orchestrator 步骤完成时写一句话摘要（如"已构思 5 个分镜场景"）

### 2.4 D4 Resume 对话级
- 点按钮 -> 复用 composer 发送通道发预设消息 -> work-orchestrator 读 task list 续传
- 不走 TaskDriver background；不可新建发送路径

### 2.5 D5 ProgressLedger 派生
- 不新建 Schema/Service，用 computeProgressLedger 纯函数
- TodoProgressInput 加 outputDigest；session-todo-progress.tsx:50-58 的 pickProgressTodos map 携带 outputDigest

## 3. 代码锚点（已核实，直接用）

| 能力 | 位置 | 动作 |
|---|---|---|
| Task Schema（含 outputDigest） | `packages/schema/src/session-task.ts:39-75` | 不改，复用 |
| SessionTask Service updateTask | `packages/core/src/session/task.ts:886-915` | 改：input 加 outputDigest + update set 加 output_digest |
| task_update 工具 | `packages/core/src/tool/task-update.ts:14` | 改：Input 加 outputDigest 可选字段 |
| task_update 测试 | 无（缺口） | 新建 `packages/core/test/tool-task-update.test.ts` |
| work-orchestrator SYSTEM_PROMPT | `packages/core/src/agent/prompt/work-orchestrator.ts` | 改：加步骤化 + Resume 指引 |
| work-orchestrator 权限 | `packages/core/src/plugin/agent.ts:343-360` | 改：permissions 加 4 个 task allow |
| product-mode-agent-policy | `packages/core/src/product-mode-agent-policy.ts` | 验证无需改（task 非 command） |
| policy 测试 | `packages/core/test/product-mode-agent-policy.test.ts` | 扩展：work 模式 task allow/deny |
| work-orchestrator 测试 | `packages/core/test/work-orchestrator.test.ts` | 扩展：SYSTEM_PROMPT 步骤化 + Resume 结构 |
| progress model | `packages/app/src/pages/session/timeline/session-todo-progress-model.ts` | 改：加 computeProgressLedger + ProgressLedgerView + TodoProgressInput 加 outputDigest |
| progress model 测试 | `packages/app/src/pages/session/timeline/session-todo-progress-model.test.ts` | 扩展：computeProgressLedger 派生 |
| SessionTodoProgress 组件 | `packages/app/src/pages/session/timeline/session-todo-progress.tsx:28` | 改：:50-58 map 携带 outputDigest + Resume 按钮 + outputDigest 展示 |
| 进度条挂载点 | `packages/app/src/pages/session/timeline/message-timeline.tsx:1725` | 不改（已挂载） |
| SDK SessionTaskInfo | `packages/sdk/js/src/v2/gen/types.gen.ts:3700` | 不改（已含 outputDigest） |
| server-sync task store | `packages/app/src/context/server-sync.tsx:278` | 不改（reconcile key="id" 透传 outputDigest） |
| mode 信号 | `packages/app/src/pages/session/session-side-panel.tsx:483` | 复用 `mode.currentMode === "work"` |
| composer 发送通道 | `packages/app/src/pages/session/composer/session-composer-region.tsx` | 实施时 grep 确认，复用 session.prompt 调用 |
| EventV2 事件定义范式 | `packages/core/src/session/artifact.ts:32-40` | 参考：work_step_resumed 事件定义 |
| i18n parity | `packages/app/src/i18n/parity.test.ts` | 约束 en/zh/zht 三 locale |

## 4. 修改文件清单

```
packages/core/src/tool/task-update.ts                    Input 加 outputDigest
packages/core/src/session/task.ts                        updateTask 加 outputDigest
packages/core/src/agent/prompt/work-orchestrator.ts      SYSTEM_PROMPT 步骤化 + Resume
packages/core/src/plugin/agent.ts                        permissions 加 task CRUD allow
packages/app/src/pages/session/timeline/session-todo-progress-model.ts   computeProgressLedger + TodoProgressInput
packages/app/src/pages/session/timeline/session-todo-progress.tsx        map 携带 + Resume 按钮 + outputDigest 展示
packages/app/src/i18n/en.ts + zh.ts + zht.ts             work.resume.* / work.step.* 文案
packages/core/test/tool-task-update.test.ts              新建（TDD 红测试）
```

**不改的文件**：artifact.ts / work-artifact-panel.tsx / session-context-tab.tsx / mode-workspace-slots.tsx / session-task.ts（Schema）/ message-timeline.tsx（进度条挂载点）/ server-sync.tsx。

## 5. TDD 工作流（红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。禁止"写完再补测试"。

### Phase A - 契约扩展（1d）
1. **红**：新建 `packages/core/test/tool-task-update.test.ts`（task_update 传 outputDigest 持久化到 output_digest 列 + 事件 payload 携带；不传时不动现有值，向后兼容）+ 扩展 `session-todo-progress-model.test.ts`（computeProgressLedger 的 currentStepIndex/canResume 派生，含 failed/in_progress/completed 三态组合 + outputDigest 透传）
2. **绿**：`task-update.ts` Input 加 outputDigest；`task.ts` updateTask input + update set 加 output_digest；`session-todo-progress-model.ts` 加 ProgressLedgerView + computeProgressLedger + TodoProgressInput 加 outputDigest；`session-todo-progress.tsx:50-58` map 携带 outputDigest
3. **重构**：outputDigest 写入复用 patch 的 output_digest set 模式（不重复逻辑）；TodoProgressInput 映射点唯一
4. **退出**：`bun --cwd packages/core test --timeout 30000` + `bun --cwd packages/app test`（model 单测）绿；typecheck 绿

### Phase B - Agent 步骤化（2d）
1. **红**：扩展 `product-mode-agent-policy.test.ts`（work 模式 task_create/update/delete/reorder allow，spawn/schedule/edit/shell 仍 deny）+ `work-orchestrator.test.ts`（SYSTEM_PROMPT 含"Plan steps"+"Resume"分支文本结构）
2. **绿**：`plugin/agent.ts:349-360` permissions 加 4 个 task allow（action=工具注册名）；`work-orchestrator.ts` SYSTEM_PROMPT 加步骤化 + Resume 指引（计划 §4.2）
3. **重构**：permissions 顺序在 `deny *` 之后（findLast 语义）；product-mode-agent-policy 验证无需改
4. **退出**：policy + work-orchestrator 测试绿；权限单测证明 task CRUD 可调、spawn/edit/shell 仍拒

### Phase C - Resume UI（2d）
1. **红**：扩展 `session-todo-progress-model.test.ts`（canResume 时 computeProgressLedger 返回 true）+ 组件测试（Resume 按钮 canResume=true 且 work 模式渲染、=false 或非 work 隐藏；outputDigest 副文案渲染）
2. **绿**：`session-todo-progress.tsx` 加 Resume 按钮（`<Show when={ledger().canResume && mode() === "work"}>`）+ outputDigest 展示 + onResume 回调（复用 composer 发送通道，grep session-composer-region.tsx 确认）
3. **重构**：Resume 按钮 UI 全用 v2 token（`--v2-*`，禁硬编码）；mode 判断复用 mode.currentMode
4. **退出**：组件测试绿；Coding/Chat 会话不显示 Resume 按钮；改 timeline 前后基准对比无回归

### Phase D - 端到端（1.5d）
1. **红**：扩展 `packages/app/e2e/regression/session-todo-progress.spec.ts`（已有 481 行）：选预设 -> task_create 步骤 -> 中断（模拟 failed 步骤）-> Resume 按钮可见（work 模式）-> 点击 -> work-orchestrator 读 task list 续传（不重复已完成步骤）
2. **绿**：端到端联调；修复合并问题
3. **重构**：E2E 复用现有 spec 的 fixture 与断言模式，不新建 spec
4. **退出**：端到端通过；恢复测试达标（Resume 后不重新生成已完成步骤）

### Phase E - 打磨（1d）
- i18n：`en.ts` + `zh.ts` + `zht.ts` 补 `work.resume.button`/`work.resume.prompt`/`work.step.digest`（**parity.test.ts 约束 en/zh/zht 三 locale**）
- 埋点：`work_step_resumed` 事件（参考 PRD §12，对齐 `work.artifact_applied` 事件定义模式 `artifact.ts:32-40`）
- 测试补齐
- **退出**：`tsgo -b`（app）+ `tsgo --noEmit`（core）+ `bun run lint` + 全包 test 绿；parity 通过；改完即审 7 步全过

## 6. 测试规范（必须遵守）

### 6.1 命令（永不从仓库根跑 test）
```bash
bun --cwd packages/core test --timeout 30000
bun --cwd packages/app test
bun --cwd packages/core typecheck      # tsgo --noEmit
bun --cwd packages/app typecheck       # tsgo -b
bun run lint
```

### 6.2 三模式选择
| 模式 | 何时用 |
|---|---|
| `it.effect` | SessionTask Service updateTask、policy 权限判定、work-orchestrator prompt 结构 |
| `it.live` | 真实时间/事件发布顺序 |
| `it.instance` | 真实 tmpdir + 实例（若涉及落盘验证） |

### 6.3 硬性规则
- 用 `testEffect(...)`（`packages/aigcfroge/test/lib/effect.ts`）不要手写 runtime；`Layer.mock` 代替手写 stub
- 禁止 `Effect.sleep(N)` 等 fiber--用 readiness 信号（`pollWithTimeout`/`Deferred`/`SessionStatus`）
- 禁止 `as any`、`@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- 测试实际实现，不把逻辑复制进测试

## 7. Effect 编码规范（引用 AGENTS.md §Effect + effect skill）
- `Effect.gen(function* () {})` 组合；命名效果用 `Effect.fn("Work.xxx")`
- 失败用 `yield* new MyError(...)`（`Schema.TaggedErrorClass`），不用 `Effect.fail(new ...)`
- 禁 `Effect.fork`/`forkDaemon`；用 `Effect.forkIn(scope)`
- 时间用 `DateTime.nowAsDate`；`Effect.void` 优先于 `Effect.succeed(undefined)`
- 边界（文件/网络/子进程）必须 Catch Everything：`Effect.try`/`catchTag`
- 外部输入先判空/收窄，禁无理由非空断言
- 新代码用 `export * as Foo from "./foo"` 自导出；禁 namespace/别名 import/star import

## 8. 分支与提交规范
- 分支：`work-m1.5`（从最新 main 切出）
- commit：`type(scope): summary`；scope 用 `core`/`app`
- 每完成一个 Phase 一个 commit（`feat(core): ...` / `feat(app): ...`），不批量
- `.husky/pre-push` 会跑 `bun typecheck`--push 前确保全绿

## 9. 完成标准（验收清单，全过才算完成）
- [ ] work-orchestrator 执行时调用 task_create 创建 3-5 步骤，SessionTodoProgress 自动显示进度条
- [ ] 步骤推进时 task_update 写 status + outputDigest，进度条 anchor 高亮当前步骤
- [ ] 步骤完成时 outputDigest 展示在 fold-over panel 步骤项副文案
- [ ] 中断后重新进入会话，ProgressLedger 显示 canResume，"从断点恢复"按钮可见（**仅 work 模式**）
- [ ] 点击 Resume -> 发送续传消息 -> work-orchestrator 读 task list 从 currentStepIndex 续传
- [ ] Resume 后不重新生成已完成步骤（依赖 outputDigest 恢复上下文）
- [ ] Context Tab 与 Coding 模式一致（文件列表/Token/Permission）
- [ ] work-orchestrator 仍无 edit/shell/spawn 权限（权限测试）
- [ ] Coding/Chat 会话不显示 Resume 按钮（mode-aware 验证）
- [ ] 埋点 `work_step_resumed` 上报
- [ ] en/zh/zht i18n parity 通过
- [ ] typecheck + lint + test 全绿

## 10. 改完即审（每 Phase 结束必须执行）
1. `git diff -- <files>` 锁定本次改动，不顺手修无关代码
2. 安全复查：Catch Everything / No Null Pointer / Security First
3. 整洁复查：No Cheating / Reusability / Clean Logs（不输出 API key/token/完整 prompt）
4. 数据流追踪：每个 Effect 的 Layer 依赖已 provide；import 真实存在；条件分支两端有执行路径
5. 输出复查结论：
```text
复查结论:
- 影响文件:
- 命中 skills:
- 安全门禁:
- 工程门禁:
- 已运行命令:
- 剩余风险:
```

## 11. 禁止事项（八荣八耻）
- 禁瞎猜接口--查 `codegraph`（MCP）或 grep 确认后再写
- 禁模糊执行--任务不清停下来问，不自我感动式盲目执行
- 禁创造接口--先查 owner module 能否复用（SessionTodoProgress / composer 通道 / mode 信号 / EventV2 范式都有现成）
- 禁跳过验证--改完必须跑对应包 test
- 禁破坏架构--遵循 ADR-11~15 + AGENTS.md 分层；新代码用 `export * as Foo` 自导出
- 禁假装理解--未知技术栈承认并向人类求助
- 禁长注释--默认无注释，仅 WHY 非显然处加一行
- 禁把 M2（存为资产）/ M3（图表产出）混进 M1.5

<!-- PROMPT END -->

---

## 使用说明

| 项 | 值 |
|---|---|
| 复制范围 | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` |
| 新对话 model | 默认（工程执行建议主力模型） |
| 新对话打开文件 | `docs/plan/work-mode-execution-layer-m1.5.md`（范围真源）+ 本文件 |
| 开工顺序 | 通读 CLAUDE.md/AGENTS.md/skills -> git 切 `work-m1.5` -> Phase A 红测试开始 |
| 卡住时 | 回报阶段 + 已过/未过测试 + 具体报错，不要绕过（`--no-verify` 禁） |
