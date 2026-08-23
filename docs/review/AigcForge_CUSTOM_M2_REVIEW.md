# AigcForge Custom Mode M2 复审报告（单一真源）

> 里程碑：Custom Mode M2 — 多 Agent 与 Workflow 编排
> 分支：`workflow-surface`（脏工作树，未提交）· 基线：`main@f4556bc00` · HEAD：`ef068e83b` + 未提交改动
> 依据：`CLAUDE.md`、`AGENTS.md`、[ADR-18](../architecture/adr/ADR-18-custom-mode-workflow-execution.md) v1.1、[M2 实施计划](../plan/custom-mode-m2-multi-agent-workflow.md)
> 最后更新：2026-08-22（R5）
> **当前结论：APPROVED — R5 补齐独立 differential + security 专项复审，其 3 项 P0 与 8 项 P1 已全部整改并各带指名测试**

> [!IMPORTANT]
> 本文件是 Custom M2 复审的**唯一**真源。R1–R5 五轮结论、全部发现与门禁证据都在此文内，按轮次归档。
> 本文件不带日期后缀，后续复审在 §2 追加一行、在 §3 更新状态，**不再新建报告文件**。

## 1. 结论与复审历史

| 轮次 | 日期 | 方式 | 结论 |
| --- | ---: | --- | --- |
| R0 | 2026-08-20 | 自审 | ~~COMPLETED & VERIFIED~~ **作废**：宣称 Phase A-G 全部完成，与当时代码和门禁结果不符 |
| R1 | 2026-08-20 | 独立五层差异审查 | **REJECT / BLOCK MERGE** — 4 项 P0、5 项 P1 |
| R2 | 2026-08-21 | 门禁复跑 + R1 阻断项逐项复核 | **维持 BLOCKED** — 机械门禁归零但 4 项 P0 仅 1 项完全关闭；新增 N-1…N-10 |
| R3 | 2026-08-21 | FOCUSED differential review | **REJECT / BLOCK MERGE** — 4 项 P0、7 项 P1、3 项 P2 |
| R4 | 2026-08-22 | 整改验收 + 全门禁实跑 | **CONDITIONAL PASS** — 全部阻断项闭环；另新增并修复 2 个此前无门禁可发现的 P0 |
| R5 | 2026-08-22 | **独立 differential + security 专项复审（R3/R4 两轮未取得，本轮补齐）** | **BLOCK -> 整改后 APPROVED** — 4 份独立复审共 3 项 P0、8 项 P1，全部整改，见 §2.5 |
| R6 | 2026-08-23 | 合并后由 M3 Phase A 第一个红测试触发 + 整改复审 | **P0 已闭环** — R5 标为 UNVERIFIED 的那条是真的：main 上 custom 委派 child 在真实 provider turn 上跑不起来（R6-0）；拟修复自身另有 1 P0 + 2 P1，四项均已整改并经复审实证。**修复未合入 main**，attended 缺口留 Phase D，见 §2.6 |

R4 曾因 API 额度耗尽两轮未能启动独立专项复审，并如实标注为「未取得」。R5 取得了 4 份独立复审（core 运行时、security、schema 边界、HTTP/SDK/App 表层），结论一致为 **BLOCK**，且找到了 R1–R4 五轮自审全部漏掉的 3 个 P0。这印证 R2 的判词：

**门禁归零只证明「没有已知回归」，不证明 ADR-18 的根不变量已恢复。** 因此 §3 的闭环判定一律附实现位置 + 具体测试用例名，不以「测试全绿」代替证据。


## 2. 发现总账

状态取值：**闭环** = 有实现位置且有指名测试；**部分闭环** = 主体已实现但有明确残留，残留已登记技术债；**已知残留** = 未修，理由明确。

### 2.1 R1 阻断与重要发现（2026-08-20）

| 编号 | 发现 | 状态 | 闭环实现与证据 |
| --- | --- | --- | --- |
| P0-1 | 默认 executor 只返回 `{ stepId, agent, executedAt }`，不调模型/工具/权限/TaskDriver/child Session，使 API 的 `completed` 具有误导性 | 闭环 | 合成 executor 已删除，`taskDriverExecutor` 走真实 `TaskDriver.createChild` + `delegate`；`timeoutSeconds` 已消费；`concurrency: "unbounded"` 已消除。`workflow-runner.test.ts` `executes a multi-step linear workflow to completion`、`executes a parallel workflow with branches and merge` |
| P0-2 | Durable owner 无事务/幂等/CAS：`create` 无事务留孤儿 run，`getBySession -> create` 并发可建多个 run，`InvalidStateTransitionError` 定义未用 | 闭环 | 唯一索引 + run/step seed 同事务 + 原子 `getOrCreate` + status×revision CAS（0 行即抛 `InvalidStateTransitionError`）。`workflow-run.test.ts` `creates a workflow run and seeds initial step runs`、`allows one concurrent step CAS winner and emits one matching event`、`creates an idempotent terminal retry lineage and rejects request reuse conflicts` |
| P0-3 | 未选分支的后代可继续执行；非法分支静默选 `Object.values(def.branches)[0]` | 闭环 | 传递性 skip 闭包 + 非法/缺失 branch key fail-closed，回退分支已删除，`invalid_branch_output` 为固定分类。`workflow-runner.test.ts` `executes dynamic branching and skips non-selected branch` |
| P0-4 | `failRun` 只取消 `running`，遗留 `pending`/`ready`；旧测试还断言 abort 后下游保持 `pending` | 闭环（R2） | `failRun`/`cancelRun` 同事务两阶段结算 `running → cancelled`、`pending\|ready → skipped`；`completeRun` 拒绝未结算步骤。`workflow-run.test.ts` `cancels run and marks all pending/ready/running steps as cancelled`、`fails workflow run when abort step fails` |
| P1-1 | 原始 `input`/`output`/`error` 落库并经状态 API 返回 | 闭环（R2） | 迁移 `20260820130142_cynical_sasquatch.ts` 重建表**物理移除** raw 三列并回填 digest；行映射只读 digest；`ErrorCategory` 为封闭 `Schema.Literals`；HTTP 返回封闭 `WorkflowStatusResponse`；SDK 类型无 raw 字段 |
| P1-2 | Consumer/Command 契约不可达；`maxAttempts`/`timeoutSeconds` 无约束 | 闭环 | `steps/<stepId>` 已从 resolver 允许集移除；Resolver 真正解析 commands（见 P1-7）；数值约束见 P1-5(R3) |
| P1-3 | Builder 丢 `state.workflow`；Snapshot 面板用错数据源 | 闭环 | `toCompositionInput()` 传递 `state.workflow`；面板改用 `session.composition` 并经 `Schema.decodeUnknownOption` 校验；Builder 入口见 P1-6(R3) |
| P1-4 | Kill-switch 只阻断占位 batch，未覆盖真实 drain | **部分闭环** | 见 §3.1 |
| P1-5 | HTTP/SDK 只有状态查询 + 同步 run | 闭环 | 见 P1-3(R3) |

### 2.2 R2 新增发现（2026-08-21）

| 编号 | 发现 | 状态 | 闭环实现与证据 |
| --- | --- | --- | --- |
| N-1 | `branches` + `failurePolicy: "continue"` 失败不 abort，`failed + continue` 被判依赖满足 → **所有分支臂全部执行** | 闭环 | `workflow-asset.ts:331` `validateGraph` 禁止该组合（author-reachable YAML 被 Schema 拦下），Runner 保留运行时 fail-closed 防线 |
| N-2 | `TaskDriver.active()` 用 `installations.at(-1)`，与调用方所属 composition root 零关联 | 闭环 | 见 P0-3(R3) |
| N-3 | 无 orphan `running` 回收；`runner.run` 在 HTTP handler 内联同步执行 | 闭环 | 见 P0-2(R3) |
| N-4 | `cancelRun`/`failRun` 按 ID 无条件覆写，run `revision` 只是计数器，不存在 run 级乐观锁 | 闭环 | 见 P1-1(R3) |
| N-5 | `maxAttempts`/`timeoutSeconds` 只有下界无上界，`1e12` 可通过 | 闭环 | `MAX_ATTEMPTS = 8`、`MAX_TIMEOUT_SECONDS = 86_400`、`maxConcurrency ∈ 1..8`、`MAX_STEPS = 64`（`workflow-asset.ts:133-136`、`:173`、`:182`） |
| N-6 | `setWorkflow(...)` 全 `packages/app` 零调用者，`toCompositionInput` 的 workflow 分支在新建草稿路径上是死代码 | 闭环 | 见 P1-6(R3) |
| N-7 | Resolver 注入 `CommandAsset.Service` 但零读取，`commands` 恒为 `[]` | 闭环 | 见 P1-7(R3) |
| N-8 | `createChild` defect 被无差别收敛为 `executor_unavailable`，allowlist 拒绝亦落入该分类 | 闭环 | allowlist 拒绝在 dispatch 前即返回 `agent_not_allowed`（`workflow-runner.ts:211`），创建后 parent 不匹配同样归 `agent_not_allowed`（`:254`）；`agent_not_allowed` 已是 `ErrorCategory` 字面量（`workflow-asset.ts:77`）。**残留**：`createChild` defect 仍收敛为 `executor_unavailable`，但保留 `defectTag` 日志可诊断，且 N-2 修复后「走错 root」这一主要成因已消除 |
| N-9 | exerciser `--mode effect` 挂起无结果（非本分支引入） | 闭环 | R4 实跑 `pass=284 fail=0 skip=0 missing=0 extra=0`，取得有限结果 |
| N-10 | 并发与 CAS 代码无测试；传递性 skip 只覆盖直接目标 | 闭环 | `workflow-run.test.ts` 新增 13 例，含 event/revision 一致性、commit 回滚、并发 CAS 单赢者、幂等终态重试 lineage 与请求复用冲突 |

### 2.3 R3 发现（2026-08-21）

| 编号 | 发现 | 状态 | 闭环实现与证据 |
| --- | --- | --- | --- |
| P0-1 | 分支失败 fail-open（同 N-1） | 闭环 | 同 N-1 |
| P0-2 | 请求中断或进程崩溃留下永久 orphan `running` | 闭环 | `WorkflowExecution`（`workflow/workflow-execution.ts` + `execution/local.ts`）以 `SessionRunCoordinator` 承载进程内 owner，HTTP 只做 admission 返回 `202`；新增 `dispatching` 阶段与 `execution_unknown` / `recovery_required` 终态。`workflow-run.test.ts` `recovers dispatching work back to ready without replaying provider work`、`freezes a run when provider execution is orphaned and keeps terminal state immutable` |
| P0-3 | TaskDriver 按进程全局最后注册项选 runtime | 闭环 | `tool/task-driver.ts` 改 `Context.Reference` `Runtime` + 私有 `RuntimeState` Ref，`active()` 只解析当前 Context，缺失即 `Effect.die`；`installForTesting` 只返回值、须由测试自行 `provide`。`task-driver-fill.test.ts:622` `isolates simultaneous composition roots through the runtime context`、`:648` `fails closed when no composition root runtime is provided` |
| P0-4 | 根 `meta` 没有获得步骤结果，也没有生成最终回答 | 闭环 | `workflow-runner.ts:366-381`：终态（非 `pending`/`running`/`cancelled`）经 `renderRootHandoff` 生成受限摘要 → `CredentialScanner` 脱敏 → 确定性 `msg_workflow_${digest}` → `TaskDriver.injectSynthetic`；DB/事件只留 digest 与固定 `ErrorCategory` |
| P1-1 | run revision 没有形成乐观锁 | 闭环 | 状态提交走 `EventV2.publish(..., { commit })`，DB CAS 与事件同事务，`event.seq + 1 === run.revision`，commit 被拒时两侧一起回滚。`workflow-run.test.ts` `commits durable workflow events with event seq plus one equal to run revision`、`rolls back workflow state and durable event when the commit fails` |
| P1-2 | kill switch 不会中断在飞 child | **部分闭环** | 见 §3.1 |
| P1-3 | HTTP/SDK 只有 status 与同步 run | 闭环 | 5 个端点：status / run(202) / run cancel / step cancel / step retry(202)，均带 typed 幂等（`requestID` + `expectedRunRevision`/`expectedStepRevision`）；`workflow.run.updated` durable EventV2 走既有 `/event`，不新开 SSE。exerciser 三模式各 284 pass |
| P1-4 | Workflow 路由丢弃显式 workspace identity | 闭环 | `handlers/session.ts` `workflowLocation` 保留 `workspaceID`，经 `LocationServiceMap` 路由 |
| P1-5 | 重试次数与超时没有服务端上限 | 闭环 | 同 N-5 |
| P1-6 | 新建 Custom Draft 无 Workflow 选择入口，运行态 UI 不存在 | 闭环 | `custom-sidebar.tsx` 新增 workflows / commands 分类与 `toggleWorkflow` / `toggleCommand`；`custom-builder-main.tsx` 展示 `draft.state.workflow` 与 `boundCommands`；`WorkflowRuntimePanel` 投影服务端状态并提供 cancel / retry / reload。`custom-builder-contract.test.ts`、`workflow-runtime-panel.test.tsx`、Playwright `workflow-runtime.spec.ts` 5/5 |
| P1-7 | Command binding 被 Schema 接受但 Resolver 永远忽略 | 闭环 | `composition-resolver.ts` 真正解析 `binding.commands` 并冻结 consumer 目录（`:427`、`:465-466`、`:533`、`:639`、`:714`、`:731`、`:761`）；Command 仍只是静态模板，不创建 executor、不增 Tool/OS 权限 |
| P2-1 | Agent allowlist 拒绝被误分类为 executor unavailable | 闭环 | 同 N-8 |
| P2-2 | 测试 teardown 用 `dispose().catch(() => undefined)` 静默吞失败 | 闭环 | 两处已改为 `await Promise.all(disposals.map((dispose) => dispose()))`（`httpapi-instance-route-auth.test.ts:51`、`httpapi-ui.test.ts:58`），失败会真实抛出 |
| P2-3 | 被推翻的 FINAL 报告顶部仍声明 `COMPLETED & VERIFIED` | 闭环 | R0 报告已并入本文 §1 并删除源文件，不再存在可被误读的独立结论 |

### 2.4 R4 新增发现（2026-08-22）

两项均为 P0，且都**不是**任何既有门禁能发现的：typecheck、单测、lint、exerciser 全绿的同时它们都存在。

#### P0-A：生成 SDK 命名空间漂移，App 取消/重试永久不可用

**根因：** `groups/session.ts` 的 `workflowCancelRun` / `workflowCancelStep` / `workflowRetryStep` 缺 `OpenApi.annotations({ identifier: "session.workflow.*" })`。hey-api 按 `operationId` 分组，缺注解即回退到端点名并平铺到父 `Session` 类，因此 `client.session.workflow.cancelRun` 在运行时是 `undefined`。

**此前的处理方式（已推翻）：** App 侧把三个方法声明为 optional，探测不到就返回 `{ status: "unavailable", reason: "sdk_missing" }`，常驻 warning 横幅并永久禁用按钮，i18n 文案写「需要生成的工作流变更接口」，且用测试把该 workaround 钉住（原测试名 `keeps mutation capabilities explicit when the generated SDK has only reads`）。这是治标，违反「拒绝表面回答 → 追溯根因」与 No Cheating。

**闭环：**
- 补三处 `identifier` + `summary` + `description`。
- 新增 `custom workflow OpenAPI operation identity`（5 条 `operationId` 断言，`packages/aigcfroge/test/server/httpapi-custom-workflow.test.ts`）。红证据：把其中一个 identifier 临时改为 `REDPROOF.` 前缀 → `1 fail`，恢复后 `5 pass`。
- 重新生成 SDK（`bun ./packages/sdk/js/script/build.ts`）。生成后 `Workflow` 类含 `get / run / cancelRun / cancelStep / retryStep`，平铺残留 `public workflowCancelRun|CancelStep|RetryStep` 计数为 0。
- 删除 App 侧 `capabilities` 探测与 `sdk_missing` 分支，替换为真实错误路径：`409` → `conflict` 提示，其它失败 → `failed` 带 message，两者都强制 refetch 权威状态。i18n en/zh/zht 同步（`mutationUnavailable` → `mutationConflict` + `mutationFailed`）。
- 新增负向契约测试：`workflow-runtime-model.ts` / `workflow-runtime-panel.tsx` 内不得再出现 `capabilities`、`sdk_missing`、`mutationUnavailable`。

#### P0-B：App 经 core 触达 `flag.ts`，整个 Web 应用白屏

**根因：** 分支首个提交 `8749e2e0a` 为消除硬编码，把 `app/src/utils/server.ts` 的两个 header 字面量换成从 `@aigcfroge/core/product-mode-policy` 导入的常量。该模块 `import { Flag } from "./flag/flag"`，而 `flag.ts` 在模块作用域读 `process.env`。浏览器无 `process`，`utils/server.ts` 又位于 SDK 创建路径上，于是任意路由都抛 `ReferenceError: process is not defined`，Solid 整树卸载 → 白屏。

**为何所有门禁都没发现：** Vite dev 编译无报错；`tsgo -b` 通过；App 单测在 bun/happy-dom 下有 `process` 故通过；`packages/app/e2e` 不在 `app/tsconfig.json` 的 `include` 内（只含 `src`），自身带 29 个存量类型错误，很容易被跳过；而只有 e2e 能看到这个错误。

**影响面：** 实测 `session-todo-progress.spec.ts` 修复前 3/3 失败（空白页），修复后 17/17 通过 — 分支上**全部** session 页 e2e 此前都是坏的。

**闭环：**
- 两个能力常量移入 `@aigcfroge/schema/product-mode`（浏览器安全），`core/product-mode-policy` 改为再导出，约 40 处 server/test 调用点零改动。
- App 改为从 `@aigcfroge/schema/product-mode` 导入。
- 新增 `packages/app/src/utils/browser-boundary.test.ts`：遍历 `packages/app/src` 全部 `@aigcfroge/core/*` 导入，在 `packages/core/src` 内做相对导入 BFS，命中「模块作用域读 `process`」即失败并打印完整链路；另有一条「守卫的守卫」防止解析或正则失效导致空跑。红证据：修复前输出 `utils/server.ts -> @aigcfroge/core/product-mode-policy -> flag/flag.ts`，修复后 `2 pass`。

### 2.5 R5 独立专项复审发现（2026-08-22）

4 份独立复审：core 运行时（L1+L2）、security（全层）、schema 解码边界、HTTP/SDK/App 表层（L3+L4）。三份给出 BLOCK。以下全部已整改，每条附实现位置与指名测试。**没有一条是 R1–R4 五轮自审发现的**，也没有一条能被既有门禁发现——typecheck / 单测 / lint / exerciser 在它们全部存在时都是绿的。

| 编号 | 级别 | 发现 | 整改与证据 |
| --- | --- | --- | --- |
| R5-1 | P0 | **分支路由在生产执行器上永远无法成功。** `taskDriverExecutor.execute` 恒返回**字符串**（`TaskDriver.delegate: Effect<string>`），而 `branchTarget()` 要求 `typeof output === "object"`，因此任何带 `branches` 的 step 恒落 `invalid_branch_output` -> `failed` -> 整个 run `failed`。ADR §2.5.3 的动态路由（M2 头号特性）在唯一的生产执行器上是死的。3 个分支测试全部注入返回 `{ output: { branch } }` 的 customExecutor——生产执行器无法产出该形状；`invalid_branch_output` 在任何测试文件中出现 0 次 | `workflow-runner.ts` 新增 `decodeBranchOutput`（按已声明的 `WorkflowAsset.BranchOutput` 解析子会话文本，支持裸 JSON / ```json 围栏 / 前后夹叙述）+ `renderBranchContract`（在子 prompt 中显式告知可路由 key 与 summary 上限），无法解码则保持字符串并 fail closed。这同时消灭了「`BranchOutput` 零生产消费方」的死 schema。测试：`workflow-runner.test.ts` `fails a branch step closed when the child answers with unroutable text`、`WorkflowRunner branch output contract`（3 例：契约解码 / 不可解码保持字符串 / 只认自有 key） |
| R5-2 | P0 | **`failRun` 从不结算 `dispatching` / `cancelling` step，留下终态 run 下的永久孤儿。** 只清扫 `running -> cancelled` 与 `pending\|ready -> skipped`。`Effect.forEach` 并发 > 1 时首个失败会中断兄弟 fiber，被中断在 `prepare` 里的兄弟停在 `dispatching`；run 转终态后 `recoverRunning` 对终态 run 早返回，永远捞不回来。违反 ADR §2.2「每个已派发 Step 必须显式 settle」，且与 `completeRun`（拒绝任何未结算 step）自相矛盾 | `workflow-run.ts` failRun 清扫范围改为 `["running", "dispatching", "cancelling"]`。测试：`workflow-run.test.ts` `settles dispatching and cancelling steps when the run fails`（对每个 step 断言终态正则，`dispatching`/`cancelling` 均须为 `cancelled`） |
| R5-3 | P0 | **Kill-switch 排空使用过期 run revision，run 卡死非终态且无人可达。** `currentRun` 在 `while` 循环外只取一次；每轮 dispatch/settle 都会推进 run revision，因此第 2 轮起 `cancelRun({ expectedRevision: currentRun.revision })` 必然 CAS 失败 -> `InvalidStateTransitionError` -> drain fiber 失败，而 `SessionRunCoordinator.settle` 不会重排；run 永久停在 `running`。此时 flag 已关，5 个端点全部 400（`requireRuntimeSession` -> `assertRuntimeSupported`），客户端既不能重推也不能取消。直接违反 ADR §2.6.3 | flag 检查下移到 `activeRun` 新鲜读取之后，CAS 改用 `activeRun.revision`。测试：`workflow-runner.test.ts` `cancels mid-drain when the kill-switch flips after the first round`。**红证据**：把 `expectedRevision` 改回 `currentRun.revision` -> 3 个测试失败；改回修复 -> 13 pass |
| R5-4 | P0（越权） | **`workflowRetryStep` 缺少两个兄弟端点都有的 run→session 归属校验。** `retryRun` 仅按 `runID` 查源 run，新 lineage run 写在**源** run 的 `session_id` 下，而 step 行来自**调用方**快照的 `stepsDef`；且 SQLite 是单一全局库、非 per-Location。ADR §2.7.3 明确要求「run/step 不属于该 Session -> 404」 | `handlers/session.ts` 在 `retryRun` 前补 `run.sessionID !== ctx.params.sessionID -> 404`；`WorkflowRun.retryRun` 新增可选 `sessionID` 谓词做纵深防御，handler 恒传入 |
| R5-5 | P1 | **Skip 闭包会丢弃仍有分支外活预设节点的 step。** 唯一排除项是被选中臂的传递闭包；菱形结构（`fan -> [cls, other]`，`cls` 分支到 `armA\|armB`，`armB.next = join`，`other.next = join`）中 `join` 属于未选中臂的后代却被 skip，真实工作被静默丢弃，run 还结算成 `completed` 而非 `partial_success`。上方 10 行构建的 `predecessors` map 从未被使用 | `findReadySteps` 先聚合 `abandoned` 集合，再迭代到不动点，保留任何仍有「非本分支节点且不在 abandoned 内」预设节点的后代。测试：`workflow-run.test.ts` `keeps a merge step that a taken path still feeds out of the branch skip closure` |
| R5-6 | P1 | **迁移 `20260820130142` 在任何「同 session 有两条 run」的非空库上直接失败。** 先把所有历史 run 的 `snapshot_digest` 回填为该 session 的当前快照 digest，再建 `UNIQUE INDEX workflow_run_identity_idx` -> `UNIQUE constraint failed` -> `DatabaseMigration.apply` 失败 -> `database.ts` `Effect.orDie` -> Database 层建不起来，**每次启动都失败**。而该索引两个迁移之后就被 `clear_boomerang` 删掉，在最终 schema 里毫无用途 | 删除该 `CREATE UNIQUE INDEX`。测试：`database-migration.test.ts` `migrates a session that already holds two legacy workflow runs` |
| R5-7 | P1 | **历史 run 回填让终态 run 借状态盲的身份去重复活。** legacy run 被打上迁移时刻的当前 digest，而 `getOrCreate` 的身份查询无状态过滤，于是组合未变时的新提交会返回旧的 **`failed`** run，runner 走 `reconcileTerminal` 早返回，什么都不执行，UI 展示一个陈旧失败 | 迁移改为逐行哨兵 `'legacy:' \|\| id`（不可能与真实 digest 相撞）；同时 `getOrCreate` 身份去重收窄为**仅活跃 run**。测试：`database-migration.test.ts` 断言哨兵值且「按当前 digest 查不到任何 run」；`workflow-run.test.ts` `dedupes run identity against the active run only, never a terminal one` |
| R5-8 | P1 | **一个身份两条 run：去重是非原子的 read-then-insert，且其唯一索引已被删除。** 身份 `SELECT` 在事务外，`onConflictDoNothing()` 已无可命中的目标约束（最终 schema 只剩 `PRIMARY KEY(id)` 与 `UNIQUE(session_id, request_id)`，而不同 requestID 之间互不相撞）。两个同 tick、不同 `requestID` 的提交会建出两条 `pending` run，`admit` 驱动其中一条而 `getBySession`（`time_created DESC`）可能返回另一条，UI 轮询到一条永远不会离开 `pending` 的 run。违反 ADR §2.4.2 | 身份重查移入 `EventV2.publish` 的 commit 回调（与事件行同事务，SQLite 写锁串行化），命中即 `false` 走回落重读；回落路径同时覆盖 `(session_id, request_id)` 唯一索引冲突。注意不能靠恢复身份唯一索引解决——终态重试 lineage 故意复用同一身份，这也是 `clear_boomerang` 当初删它的原因 |
| R5-9 | P1 | **重试按钮对服务端一律拒绝的 step 状态开放。** `canRetryStep` 对 `completed` / `skipped` 返回 true 且完全不看 run 状态，而 core 只允许 `failed \| cancelled \| execution_unknown` 且源 run 必须已终态。结果：按钮渲染 -> POST 409 -> 面板显示「run 已变化」并重新拉取到完全相同的状态，永久是个带误导文案的空操作 | `canRetryStep(status, runStatus)` 与服务端守卫对齐，`workflow-runtime-panel.tsx` 传入 `props.run().status`。测试：`workflow-runtime-model.test.ts` 新增 `completed`/`skipped`/`failed+running` 三条负向断言 |
| R5-10 | P1 | **`cancelRun` 可能返回 200 但 run 停在非终态 `cancelling`，UI 再无出路。** `finalizeCancelRun` 的 CAS 失败被吞掉并替换为一次普通重读；被 interrupt 的 owner 可能已经推进过 run revision，于是 finalize 内部 409，handler 返回 200 + `status: "cancelling"`，而 `canCancelRun("cancelling") === false`，取消按钮从此禁用、owner 已死 | handler 在 CAS 失败后重读一次并用新鲜 revision 重试 finalize，仍非终态才返回当前状态 |
| R5-11 | P1 | **exerciser fixture 被削弱：seeded task 状态 `in_progress` -> `pending`。** 这是唯一断言 seeded task 状态经写→读往返存活的场景，而 `pending` 恰好是生产陈旧声明清扫（`ScheduledJob.recoverStaleClaims`）会强制写入的值，于是该场景再也无法区分「状态往返正确」与「状态被强制覆盖」 | 已回退为 `in_progress`。并实测确认 `recoverStaleClaims` 只作为 `SchedulerCore.daemon` 的 `startupSweep` 在进程启动时跑**一次**（`scheduled-job.ts:231`），不可能与后续 seed 竞争；恢复强断言后 exerciser coverage 实测 **284 pass / 0 fail** |
| R5-12 | P2 | `branchTarget()` 经 `Object.prototype` 解析分支 key，`{"branch":"constructor"}` 会拿到一个函数、绕过 fail-closed 硬规则，随后被绑进 SQLite 触发 defect（当前因生产执行器只产字符串而潜伏，一旦解析子 JSON 即激活） | 改为 `Object.hasOwn` + 结果必须是字符串。测试：`resolves only own branch keys, never the prototype chain`（`constructor`/`__proto__`/`toString`/`valueOf`/`hasOwnProperty` 全部 undefined） |
| R5-13 | P2 | `<workflow_result>` handoff 直接插值未转义的子会话输出，且以 `role: "user"` 落成 durable 消息注入根编排器 —— 子 Agent 可闭合信封、伪造 step 状态、追加指令 | 新增 `escapeHandoffDetail`（`<`/`>` 转义 + 换行折叠）；并把 `CredentialScanner` 从「先裁剪后扫描」改为**逐 step 先扫描后裁剪**，避免跨裁剪点的凭据只剩下不足以被正则识别的前缀 |
| R5-14 | P2 | `requestID` 是无上界 `Schema.String`，却落进 `workflow_run` 的唯一索引且 `workflow_run` 无保留策略；同结构里的 `expectedSnapshotDigest` 是 64 位十六进制强约束，说明遗漏非本意 | 两个 payload 统一改为 `Schema.isMinLength(1) + isMaxLength(128)` |
| R5-15 | P2 | 重试用裸 `crypto.randomUUID()`，在非安全上下文（非 loopback 的 `http://`，本仓明确支持的部署形态）为 undefined，抛出的 `TypeError` 被 `settle()` 捕获成普通失败 —— 唯一的 `execution_unknown` / `recovery_required` 恢复入口彻底不可用。仓库自带 `utils/uuid.ts` 已处理三种情况且有测试点名该风险 | 改用 `uuid()` 助手 |
| R5-16 | P2 | `common.remove` 在 en/zh/zht 与 `@aigcfroge/ui` 全部不存在，`translator` 对缺失 key 返回 `undefined`，于是 3 个纯图标按钮的 `aria-label` 属性根本不渲染，屏幕阅读器只念「button」。typecheck 不拦（dict 是未标注字面量） | 三语补齐 `common.remove` |
| R5-17 | P2 | 浏览器边界门禁存在两个盲区：`[^"'\n]*?` 无法跨行，47 个多行 `from "..."` 说明符不可见（含一条真实 app -> core 边）；且只下钻 `@aigcfroge/core/`，本分支新增的 `@aigcfroge/schema/*` 一跳从不检查 —— 正是这条门禁存在的意义所在 | 正则放宽为 `\bfrom\s*["']([^"']+)["']`，解析器泛化为任意 `@aigcfroge/<pkg>/`（按 `packages/<pkg>/src` 定位）并跨包续跳；「守卫的守卫」补断言 schema 跳转与多行 import 可见性。实测放宽后当前仍 0 offender |
| R5-18 | P2 | `WorkflowRunInfo` 声明了 `handoffDigest` / `handoffStatus` / `handoffErrorCategory`（连带 `WorkflowHandoffStatus`），已进入 HTTP 契约与生成 SDK 类型、被 Storybook story 使用，但**没有任何生产代码写它们**，`rowToRunInfo` 也不映射 —— 契约恒缺字段，违反 No Cheating | 三个字段与 `WorkflowHandoffStatus` 一并删除，SDK 重新生成，story 与 e2e fixture 同步。durable handoff 状态（需要 ADR §2.2 为终态 run 的 handoff 记账开一个例外）改为登记技术债 |
| R5-19 | P2 | `workflow-runtime-panel.test.tsx` 5 个用例全是 `readFileSync` + `toContain`，其中「renders the complete runtime state surface」根本没有 import 组件，只是在源码里找 12 个状态字面量 —— 组件挂载即抛也照样通过 | 收窄为 2 条源码契约（移除的 `sdk_missing` 兜底不得复活、面板确实被挂载），describe 改名为「source contract」，并注明渲染行为由 Playwright、纯投影逻辑由 `workflow-runtime-model.test.ts` 各自真实覆盖，以及为何降级（bun#28605） |
| R5-20 | P2 | Playwright spec 的 `trackPageErrors` 只累积数组、从不参与断言，仅在标题定位超时的 catch 里插值 —— 面板内的未捕获 rejection 只要标题渲染出来就不会让测试失败 | 挂载断言后补 `expect(pageErrors).toEqual([])` |
| R5-21 | P2 | resolver 的第一层委派门禁把 `"meta"` 播进 allowlist，且 `step.agent &&` 跳过空串 —— `agent: meta` / `agent: ""` 能冻结成 valid plan，直指 `root_agent_forbidden` 要挡的根编排器（第二层仍 fail closed，故为坏门禁而非活越权） | `knownAgents` 移除 `"meta"`，守卫改为无条件 `!knownAgents.has(step.agent)` |
| R5-22 | 架构 | `location-layer.ts` 的 LayerMap lookup 里新增了 `Flag.AIGCFROGE_DB === ":memory:" ? Layer.empty : Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer)` —— 按环境变量分叉 Layer 拓扑，测试与生产各走一套；且 `Layer.empty` 的 ROut 是 `never`，联合类型里 `never \| X = X`，类型系统会**谎报**两个服务恒被提供 | 整段删除。依据：LayerMap 的 `dependencies` 数组本就已含 `EventV2.defaultLayer`（`:272`）与 `Database.defaultLayer`（`:281`）；另用一次性探针实测 `LayerMap` 经 `Layer.CurrentMemoMap.getOrCreate` 共享父层 MemoMap、且 MemoMap 按**叶子 Layer 对象引用**去重，`database instance shared: true` / `eventv2 instance shared: true`。删除后 typecheck 15/15、core workflow 定向 40 pass、exerciser coverage 284 pass |

### 2.6 R6 合并后发现的 P0（2026-08-23，M3 Phase A 触发）

**M2 已合入 main 后才暴露：`main` 上 custom 模式的委派 child 在真实 provider turn 上是坏的。**

R5 的 schema 边界复审把这条标为 **UNVERIFIED**（「代码路径已核实，但没有任何测试驱动这种 child 跑真实 turn」）。我把它写成 M3 执行提示词 §4.6 的**第一个红测试**，M3 Phase A 执行时打出来了——确实是死路，提交 `custom-child-turn@c0de66899` 标题即 "unbrick delegated custom child turns"。

| 编号 | 级别 | 发现 | 状态 |
| --- | --- | --- | --- |
| R6-0 | **P0（M2 漏网）** | 每轮 provider turn 调 `ProductModeAgentPolicy.enforcePrimary(session.mode, session.agent)`（`session/runner/llm.ts:479`）且无 parent/child 豁免，而 `checkPrimaryAgent("custom", agent)` **只允许 `meta`**，否则 `Effect.die`。但 custom child 合法地持有非 meta agent（`resolveAgent` 的 `parent && parentSnapshot` 分支绕过 create 期 `enforcePrimary`，`session.ts:334-342`），workflow child 又走同一个 runner。**结论：M2 的多 Agent 委派在真实 Provider 上跑不起来；R1–R5 五轮复审 + 全套门禁全部没发现，因为没有测试驱动真实 turn。** 这是我在 R5 判 APPROVED 时漏掉的——门禁绿 ≠ 功能能跑，R2 的判词再次成立 | **修复已整改、待复审合入**：分支 `custom-child-turn`（`c0de66899` + 整改 `a508eca43`/`607194cb4`/`34d99ccd4`），探针绿证据 `custom-child-provider-turn.test.ts` "non-meta custom child completes one real provider turn without dying"；R6-1/R6-2/R6-3 见下 |
| R6-1 | P0 | 拟修复 `c0de66899` 的 deny-first custom 天花板**丢弃 base 的显式非通配 `deny`**：custom 分支用 `flatMap` 只保留 ask→deny，`ceilingAllows` 追加在尾部，而 `evaluate` 是 `findLast`。实测（纯函数探针）：同一 base 下 `read .env` 在 **custom unattended → allow**、在 coding unattended → deny。加固补丁使 custom 在显式 deny 上弱于其它所有模式 | 闭环（`custom-child-turn@a508eca43`）：显式非通配 deny 保留且排在白名单 allow 之后（头部 deny → ask→deny → 白名单 allow → 显式 deny）。测试：`permission-effective.test.ts` R6 整改块 "R6-1 custom unattended 的显式资源级 deny 压过通配 allow，且与 coding 配对防再分叉"（红：修前 read .env=allow；绿：deny 且 read src/=allow、coding 同断言 deny） |
| R6-2 | P1 | 同一天花板是**黑名单**（仅排除 `*` 与 bash/edit/write/apply_patch），实测 `task_spawn` 与 `webfetch` 仍 allow。`task_spawn` 正是天花板要抑制的扇出放大原语。应改为只读类 action 白名单，新工具默认 deny | 闭环（同提交）：改只读白名单 `glob/grep/list_assets/read`（成员逐一取自 `builtins.ts` 注册清单，Security 复审确认项已写入 ADR-20 §2.6 v1.1）。测试：同块 "R6-2 白名单制：扇出与外发通道在 custom unattended 默认 deny"（task_spawn/webfetch deny）+ "R6-2 守卫：未列入只读白名单的 action 默认 deny" |
| R6-3 | P1 | 豁免范围宽于缺陷：以 `session.parentID !== undefined` 对**所有模式所有 child** 跳过 `checkPrimaryAgent`，但理由是 custom 专属的 `assertAgentAllowed`；`product-mode-agent-policy.ts` 无 delegation 专用门禁，非 custom child 豁免后每轮 mode×agent 门禁全空。要么收窄到 `mode === "custom"`，要么举证替代门禁 | 闭环（`custom-child-turn@607194cb4`）：采纳方案①收窄至 `mode === "custom"`——依据是该 mode 独有的 create 期 `assertAgentAllowed`（session.ts:341）与派发期 allowlist 双门禁；非 custom child 恢复 per-turn 主 agent 门禁。测试：`custom-child-provider-turn.test.ts` "non-custom children stay subject to the per-turn primary gate (R6-3)"（红：修前 chat+work-orchestrator child turn 不被拦；绿：die AgentNotAllowedError 且零 provider 请求） |

详细复审与实测输出见 [ADR-20 §4](../architecture/adr/ADR-20-scoped-grant-model.md#4-审批与授权记录)。

**当前风险敞口（2026-08-23 复审后更新）**：R6-0/R6-1/R6-2/R6-3 **全部闭环并经复审实证**——复审方用发现 R6-1/R6-2 的同一支纯函数探针复跑（`read .env → deny`、`task_spawn`/`webfetch`/未知工具 → deny、只读 `read` 存活、coding 分支逐字未变），白名单四个成员逐一核对为真实工具名，R6-3 收窄经 `resolveAgent` create 期判定确认无新断路；门禁实跑 core 全量 **2061 pass / 2 skip / 0 fail**（`env -u` 复现 CI）、定向 30 pass、typecheck / lint-changed / `diff --check` 全绿。

修复位于 `custom-child-turn`（5 提交），**尚未合入 main**——因此 `main@1d5c51f6c` 上 custom workflow 委派仍不可用，合并优先级高于 M3 任何 Phase。合并顺序必须是 `custom-child-turn` → `mcp-scope-adr`（后者引用前者的提交哈希与测试名）。

**唯一残留**：attended custom 的尾部通配 allow 缺口仍开放（实测 `attended=true` 时 allow-all 资产的 `bash`/`edit`/`write` 全部 `allow`，且因判定为 `allow` 而**永不弹审批框**）。ADR-20 §2.6 的 attended 扩展为提案，随 Phase D 与产品一并裁决，不提前实现。

## 3. 遗留项

### 3.1 kill switch 无「关闭即中断在飞 child」的进程内通知（R1 P1-4 / R3 P1-2 的残留）

**已实现：** `ProductModePolicy.assertRuntimeSupported()` 对 custom 关时 fail-closed（`product-mode-policy.ts:77`，覆盖 `session.ts` 6 处 prompt/command/shell/revert 入口 + `handlers/session.ts:146`）；`WorkflowRunner` 在每轮调度前与每个 step dispatch 前各查一次（`workflow-runner.ts:207` / `:260` / `:402`），落 `custom_mode_disabled`。测试：`workflow-runner.test.ts` `cancels workflow run when custom mode kill-switch is triggered`。

**仍缺：** `isCustomModeEnabled()` 只读环境值，没有「开关变化」通知入口，因此关闭开关无法中断已在 Provider 请求中途的 child——最坏情况多跑到当前 step 结束。**不虚假承诺**普通环境变量翻转能在任意 Provider 请求中途被自动感知。

**根治方向：** 加显式进程内 disable 通知，调用 `WorkflowExecution.interrupt` 与 `SessionExecution` 中断并等 finalizer settle 后返回。已登记 `docs/technical-debt.md`。

### 3.2 其它已登记技术债

| 项 | 摘要 |
| --- | --- |
| `packages/sdk/openapi.json` 长期未再生成 | 实测比真实 spec 少 **72 个 path / 172 个 schema**，其中 71 个 path 来自 M2 之前已合并的里程碑。无代码消费方，不造成运行时或类型漂移。有意不在本分支再生成（会把约 470KB 无关产物混入 M2 diff） |
| Storybook 构建 OOM | 4GB / 6GB 堆均在 Vite transform 阶段崩；移除新 story 后照样 OOM，分支既有 |
| **durable handoff 状态未持久化**（R5-18 的另一半） | `handoff*` 契约字段已删除，但「已投递 / 已丢失」仍不可区分：`injectSynthetic` 失败只落一条 `Effect.logError`（带 `defectTag`），run 仍报 `completed`。根治需要为终态 run 的 handoff 记账在 ADR §2.2「终态不可变」上开一个显式例外，并新增列 + 迁移，超出本轮范围 |
| **Agent 资产可自授权限，且 workflow child 无人值守**（R5 schema 复审 P1） | 允许清单以 author 可控的 `name` 为身份，但真正生效的权限来自全局 `AgentV2` 注册表：资产 frontmatter 里的 `config.permissions` 可写 `{action:"*",resource:"*",effect:"allow"}`，而 `evaluate` 用 `findLast`，尾部通配 allow 胜出；child 以 `attended: false` 创建，无人值守时 `ask` 被压成 `deny` 但尾部 allow 不受影响。另一变体是与内置 agent 同名（如 `build`）导致资产被丢弃、内置的 allow-all ruleset 生效，而 Plan/Snapshot 仍显示已绑定的资产。**该权限机制早于本分支**，本分支新增的是无人值守的 workflow 扇出（最多 64 step × 8 attempt）。根治：为 `mode === "custom"` 的 child 用 deny-first 的 custom 基线与解析出的 ruleset 求交，并在 provenance 与绑定路径不一致时 fail closed |
| `MAX_STEPS` 等图不变量不在解码期与资产写入期强制 | `validateGraph` 唯一非测试调用方是 `composition-resolver.ts:257`，因此 YAML 加载与 `workflow-asset/apply` 会接受 17 万 step、环、重复 id、悬空 `next`、`branches`+`continue`；只有 `freeze` 才拒绝。ADR §2.5.3 写的是「解析期拒绝」，二者需对齐（改代码，不是改 ADR） |
| `timeoutSeconds` 省略即无超时 | `StepDef.timeoutSeconds` 没有 `withDecodingDefaultKey`（相邻的 `maxAttempts` / `failurePolicy` 都有），`workflow-runner.ts` 在字段缺失时直接 `return yield* delegated`，于是 `failurePolicy: retry` + `maxAttempts: 8` 每次 attempt 都无墙钟上限——比 ADR 宣传的「86400 上限」严格更差。加默认值会静默截断合法长任务，属产品决策，故登记而非本轮改 |

### 3.3 已知残留，本轮未修

`custom-sidebar.tsx:32-50` 对 5 个资产 list 同时用 per-call `.catch(() => ({data:{assets:[]}}))` 与外层 `catch {}`，任何失败都渲染成与「0 个资产」无法区分的空态，无错误提示也无重试。该模式在 `main` 上对 agents/prompts/skills 已存在，本分支只是扩展到 workflows/commands，按「不顺手修无关代码」未纳入本轮范围。

exerciser 对 5 个端点中的 3 个（`cancelRun` / `cancelStep` / `retryStep`）只覆盖 404「run 不存在」路径，没有 200/202 成功路径与 409 stale revision。覆盖门禁按 `METHOD path` 计数，故 `.missing` 场景名同样满足门禁——「已覆盖」并不等于「行为已测」。这三条的成功路径由 core 单测与 Playwright（mock server）覆盖。

## 4. 门禁结果（R4，2026-08-22 本机实跑）

> R5 整改后的复跑结果见 §4.2；本表保留 R4 快照以便对照。

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| Schema 全量 | `bun --cwd packages/schema test` | 116 pass / 0 fail |
| Core 全量 | `bun --cwd packages/core test` | 2040 pass / 2 skip / 0 fail |
| App 全量 | `bun --cwd packages/app test` | 925 pass / 0 fail（+ virtualizer 3 pass） |
| AigcForge 全量 | `bun --cwd packages/aigcfroge test` | 3224 pass / 22 skip / 6 fail — 见 §5.1 |
| AigcForge 定向（能力头 + workflow，7 文件） | — | 29 pass / 0 fail |
| 全仓类型检查 | `bun turbo typecheck` | 15 / 15 successful |
| 增量 lint | `bun run script/lint-changed.ts` | passed，93 changed files / 12100 added lines |
| 全仓 lint | `oxlint` | 0 errors / 45 warnings（均为存量，含未改动文件） |
| 迁移漂移 | `bun --cwd packages/core run migration --check` | No schema changes, nothing to migrate |
| exerciser coverage | `test:httpapi` 第 1 段 | pass=284 fail=0 skip=0 missing=0 extra=0 |
| exerciser auth | `test:httpapi` 第 2 段 | pass=284 fail=0 skip=0 missing=0 extra=0 |
| exerciser effect | `test:httpapi` 第 3 段 | pass=284 fail=0 skip=0 missing=0 extra=0（R2 记录的 N-9「挂起无结果」本轮取得有限结果） |
| Playwright 新增 workflow spec | `test:e2e e2e/regression/workflow-runtime.spec.ts` | 5 passed |
| **Playwright 全量** | `bun run test:e2e` | **59 passed**（修复 P0-B 前 session 页各 spec 全部白屏失败） |
| 格式 | `git diff --check` | clean |

### 4.1 新增 Playwright 覆盖

`packages/app/e2e/regression/workflow-runtime.spec.ts`，复用既有 `mockAigcfrogeServer` + `trackPageErrors`，5 个场景：

1. 空态 → 收到 `workflow.run.updated` 后重新拉取权威状态（事件不带步骤数据，故行只可能来自 refetch，这正是「事件只是失效通知」不变量）。
2. 7 种非终态步骤状态全部投影；取消 run 时 POST 体断言 `{ expectedRunRevision: 18 }`；随后收敛到 `cancelled` 且取消按钮禁用。
3. `409` stale revision → 渲染 `workflow-runtime-action-notice`，且屏幕上留下的是权威状态而非乐观结果。
4. 重试失败步骤 → 响应 `202`，POST 体断言两个 revision 且 `requestID` 为非空字符串（调用方从不提供该幂等键）；随后 `recovery_required` 与 `partial_success` 终态均不提供取消。
5. 读取失败 → 渲染 `workflow-runtime-error`。

### 4.2 R5 整改后复跑（2026-08-22 本机实跑）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| Schema 全量 | `bun --cwd packages/schema test` | 116 pass / 0 fail |
| Core 全量 | `bun --cwd packages/core test` | **2049 pass / 2 skip / 0 fail**（R4 为 2040，+9 为 R5 新增用例） |
| App 全量 | `bun --cwd packages/app test` | 922 pass / 0 fail（+ virtualizer 3 pass；R4 为 925，−3 为删除的假测试断言） |
| AigcForge 全量 | `bun --cwd packages/aigcfroge test` | 3225 pass / 22 skip / 1 todo / 5 fail — 全部为负载超时，见 §5.1 |
| 全仓类型检查 | `bun turbo typecheck` | 15 / 15 successful |
| 全仓 lint | `bun run lint` | 0 errors / 48 warnings（均为存量）+ 增量 lint passed（93 files / 12376 added lines） |
| 迁移漂移 | `bun run script/migration.ts --check` | No schema changes, nothing to migrate |
| exerciser coverage | `--mode coverage --fail-on-missing --fail-on-skip` | pass=284 fail=0 skip=0 missing=0 extra=0（已恢复 `in_progress` 强断言） |
| exerciser auth | `--mode auth --fail-on-missing --fail-on-skip` | pass=284 fail=0 skip=0 missing=0 extra=0 |
| Playwright workflow spec | `test:e2e e2e/regression/workflow-runtime.spec.ts` | 5 passed（含新增 `expect(pageErrors).toEqual([])`） |
| SDK 重新生成 | `bun ./packages/sdk/js/script/build.ts` | 成功；`class Workflow` 仍含 `get/run/cancelRun/cancelStep/retryStep`，平铺残留 0，`handoff*` 字段已消失 |
| 格式 | `git diff --check` | clean |

R5 新增/修改用例（均为红证据可复现）：

- `workflow-run.test.ts`：`settles dispatching and cancelling steps when the run fails`、`keeps a merge step that a taken path still feeds out of the branch skip closure`、`dedupes run identity against the active run only, never a terminal one`
- `workflow-runner.test.ts`：`cancels mid-drain when the kill-switch flips after the first round`、`fails a branch step closed when the child answers with unroutable text`、`WorkflowRunner branch output contract`（3 例）
- `database-migration.test.ts`：`migrates a session that already holds two legacy workflow runs`，以及 legacy 哨兵 digest 断言（含「按当前 digest 查不到任何 run」）
- `workflow-runtime-model.test.ts`：`canRetryStep` 三条负向断言 + tone 断言从 `toBeDefined()`（不可能失败）改为闭集断言
- `browser-boundary.test.ts`：跨包跳转与多行 import 可见性断言

## 5. 如实记录：未通过与未取得

### 5.1 AigcForge 套件失败均为负载超时，非回归

R4 记录 6 个失败；R5 整改后复跑为 5 个，集中在 spawn 子进程 / 实例引导类文件：`test/project/instance-bootstrap.test.ts`（3 例）与 `test/cli/acp/initialize-auth.test.ts`（2 例），全部 `TimeoutError`（15–59s）。两次全量运行期间本机都在并行跑 lint、typecheck 与多个复审子代理。**空载单独重跑这两个文件：7 pass / 0 fail。** R4 记录的 `test/cli/acp/skills.test.ts`、`test/cli/run/run-process.test.ts` 单跑同样 17 pass / 0 fail。结论：负载敏感集合比 R4 记录的更大（需加上 `instance-bootstrap`），但均非本分支引入，已登记技术债。

同一现象也出现在 Playwright 全量与 exerciser auth 各一次：`session-timeline.spec.ts:33 keeps the visible message fixed while prepending history` 在 59 例全量里失败 1 例，单跑该文件 **5 passed**；exerciser auth 在重负载下曾出现 282/2，空载复跑 **284/0**。两者都记为负载敏感而非回归。


### 5.2 Storybook 构建 OOM — 分支既有，非新 story 引入

`bun run build`（`packages/storybook`）在 Vite transform 阶段 OOM，`--max-old-space-size=4096` 与 `6144` 均崩。把新增的 `workflow-runtime-panel.stories.tsx` 移出 stories 目录后**照样 OOM**，故与本轮改动无关。

新 story 本身已过 `bun --cwd packages/app typecheck`（`app/tsconfig.json` 的 `include: ["src"]` 覆盖 `.stories.tsx`），11 个 story 覆盖 loading / error / empty / running / partial_success / failed / cancelled / recovery_required / narrow / dark / conflict，遵循仓库既有的 `frameHeight` 与 `themes.themeOverride`（`storybook/.storybook/preview.tsx:48`）约定。**但视觉截图门禁本轮未取得。**

### 5.3 专项复审：R5 已取得

R3/R4 两轮因 API 额度耗尽未能启动，已如实标注。**R5 取得 4 份独立专项复审**（core 运行时、security、schema 解码边界、HTTP/SDK/App 表层），三份给出 BLOCK，共 3 项 P0、8 项 P1、11 项 P2，全部发现与整改证据见 §2.5。

仍未取得：Storybook 视觉截图门禁（需先解 OOM，见 §5.2）。

### 5.4 其它未执行项

- `packages/sdk/openapi.json` 有意未再生成，理由见 §3.2。
- 50 轮内存增长 / 挂起 fiber 矩阵未跑。
- 未接真实外部 Provider / MCP / CLI —— 因此 R5-1 的「生产执行器返回字符串」结论建立在静态调用链 + 类型签名 + 定向测试上，不是真实 Provider 跑通。
- R2/R3 引用的 core 用例只核对了本文列出的具体用例名，其余未逐条阅读。
- R5 未复跑 Playwright 全量（只跑了 workflow spec 5/5 与 `session-timeline` 单文件 5/5）。

## 6. Git 与后续

- R1–R4 全程未执行 commit / push / PR / reset / checkout / clean / rebase。
- R5 在整改完成、上述门禁全绿后执行提交与推送，并开 PR；提交按层拆分（schema+core / surface+sdk / app / docs），分支 `workflow-surface` 不 rebase、不 force push。
- PR 标题：`feat(custom): durable multi-agent workflow execution with async owner and runtime surface`
- PR 描述显式列出 §2.4 的两个 P0、§2.5 的 R5 全部发现、以及 §3.2 / §5 的未取得项与技术债。

## 7. 归档说明

本文件由以下 4 份报告合并，源文件已删除以消除相互矛盾的多入口。未跟踪的 3 份在删除前已写入 git 对象库，可用 `git cat-file -p <hash> > <path>` 恢复：

| 原文件 | 轮次 | 恢复 hash |
| --- | --- | --- |
| `AigcForge_CUSTOM_M2_FINAL_APPROVAL_2026-08-20.md` | R0 | 已提交版 `git show ef068e83b:docs/review/AigcForge_CUSTOM_M2_FINAL_APPROVAL_2026-08-20.md`；含 SUPERSEDED 标注的工作树版 `ddd96faabcb0fb9c891652189316531d9b5147c1` |
| `AigcForge_CUSTOM_M2_INDEPENDENT_APPROVAL_2026-08-20.md` | R1 + R2 | `419e53a2266fa53bfdb24d78f23479bba6515ad8` |
| `AigcForge_CUSTOM_M2_R3_DIFFERENTIAL_REVIEW_2026-08-21.md` | R3 | `7b366a435fdcecc2ecd5bacb428037a6d73c2b55` |
| `AigcForge_CUSTOM_M2_R4_GATE_REPORT_2026-08-22.md` | R4 | `04ed34790329d0125aa04eabdbc3796025044ebe` |

R1 报告中的 Phase 0–8 整改方案未并入本文：它已执行完毕，且实施顺序的真源是 [M2 实施计划](../plan/custom-mode-m2-multi-agent-workflow.md)，复审报告不再重复承载计划内容。

> `docs/review/` 下的 `AigcForge_DIFFERENTIAL_*_M2_*_2026-08-0{2,3,4}.md` 三份属于 `todo-task-m2`（Todo/Task 里程碑 M2，已合入 main），与 Custom Mode M2 无关，未纳入本次合并。
