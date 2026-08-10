# Harness 7 层加固 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 [Harness 7 层加固实施计划](harness-7-layer-hardening.md)（波次 1a + 1b）。
> **来源**：[实施计划](harness-7-layer-hardening.md)（范围真源）、[Harness 7 层现状调研](../research/agent/AigcForge-Harness-7层现状深度调研.md) §10-§11（合规审计）、[Meta-Agent 实施计划](meta-agent-orchestrator.md)（已合入，前置）
> **分支**：`harness-hardening`（从最新 main 切出）
> **完成标准**：§9 验收清单全过 + typecheck/lint/test 绿

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈工程师。本提示词让你**独立、端到端**执行 [Harness 7 层加固：波次 1（V2 doom_loop 检测器 + Memory 服务）](docs/plan/harness-7-layer-hardening.md)（DRAFT，G0-G4 已过）。范围真源是那份计划，本提示词是执行手册。开工前必须通读：`CLAUDE.md`、`AGENTS.md`、`ARCHITECTURE.md`、`CONTEXT.md`、`packages/core/src/tool/AGENTS.md`、`.aigcfroge/skills/effect/SKILL.md`、`.aigcfroge/skills/database/SKILL.md`、`.aigcfroge/skills/protocols/SKILL.md`，以及调研文档 `docs/research/agent/AigcForge-Harness-7层现状深度调研.md` §7/§10/§11。

---

## 0. 你的任务（一句话）

把 V1 的重复工具调用检测（doom_loop）移植到 V2 runner 并接入 PermissionV2 审批网络；新增数据库持久化的 MemoryService（meta_agent_memory 表 + memory_record/memory_search 工具），复用 compaction 摘要组件、注入走 SystemContext 管道（默认关闭），全部按 TDD 红→绿→重构推进。

## 1. 范围与禁区

### 1.1 范围（波次 1a + 1b 只做这些）
- V2 doom_loop 检测器：`packages/core/src/session/doom-loop.ts` + runner 挂载 + `plugin/agent.ts` defaults 补 `doom_loop: ask` 规则
- Memory：`MetaAgentMemoryTable` + 迁移 + `MemoryService` + `memory_record`/`memory_search` 工具 + SystemContext 注入（默认关闭）+ `meta.memory.*` 配置

### 1.2 禁区（违反即返工，绝对不做）
- ❌ 不抽象 SemanticSummarizer 公共底座（审计 D1：直接复用 `SessionCompaction` 的 serialize/buildPrompt）
- ❌ Memory 注入不走 `meta-prompt.ts` fill（审计 D2：走 SystemContext/builtins，防破坏前缀缓存）
- ❌ 不新建 HITL 通道（doom_loop 走 `PermissionV2.assert` + 现有审批 dock）
- ❌ 不做验证执行器（波次 2）、执行计划写盘（波次 3）、命令语义分级（波次 4）
- ❌ 不新建数据库表以外的 Service/组件（Memory 表外不加列不加表）
- ❌ 不做自动提炼/会话结束钩子（只在显式调用 memory_record 时写入）
- ❌ 不迁移/不修改 V1 代码（`packages/aigcfroge/src/session/processor.ts` 保持原样）

## 2. 设计决策（已定案，必须遵守）

### 2.1 D1 · doom_loop 检测（对齐实施计划 §3.1）
- 指纹：`createHash("sha256").update(toolName + JSON.stringify(input)).digest("hex").slice(0, 16)`（**自实现**，`CacheShape.shortHash` 是私有函数勿引用）
- 状态：`Ref<Map<SessionSchema.ID, string[]>>` 环形缓冲，`DoomLoop` 为 **core 内 Context.Service + Layer.effect**（Location-scoped 由调用方组合）——**禁止引用 aigcfroge 的 InstanceState**（core 不可反向导入 aigcfroge）
- 触发：缓冲满 + 全同 + 真实执行（非 provider-executed）→ `PermissionV2.assert({ action: "doom_loop", resources: [toolName], save: [toolName], sessionID })`（sessionID 为必填）
- 挂载点：`runner/llm.ts:305-326` tool settle 路径（FiberSet.run 前）
- 配置：`meta.doom_loop.enabled`（默认 true）/ `meta.doom_loop.threshold`（默认 3，对齐 V1 `DOOM_LOOP_THRESHOLD`）

### 2.2 D2 · Memory 表与 Service（对齐实施计划 §3.2 + database skill）
- 字段 snake_case；`project_id` 键控（项目级隔离，防跨项目污染）；`fact_category` 加 `.$type<"code_trap" | "protocol" | "api" | "workflow">()`
- `content` 提炼复用 **compaction 已导出的 `serializeToolContent`（compaction.ts:89）与 `buildPrompt`（compaction.ts:171）**；`serialize`/`SUMMARY_TEMPLATE` 是私有，**不引用不导出**——compaction.ts 零改动
- **meta_agent_id 来源**：`record` 先经 `MetaAgentSessionTable.findBySession(sessionID)` 反查；无映射（非 meta 会话）返回明确错误
- Service 方法：`record` / `query`（project_id + fact_category 过滤）/ `search`（LIKE 关键词）/ `remove`（id）
- 迁移文件：`packages/core/src/database/migration/<YYYYMMDDHHMMSS>_add_meta_agent_memory.ts`（database skill：禁止 down，up 返回 Effect）

### 2.3 D3 · 注入走 SystemContext（对齐实施计划 §3.3）
- `system-context/builtins.ts` 新增 Memory 源：enabled=true 时按 project_id 检索 TOP-N（默认 10）归类条目注入 baseline
- **新增 `Database.Service` 依赖**：Memory 源 load effect 查 DB，层组合处补 `Layer.provide(Database.defaultLayer)`；源内部用 `Effect.serviceOption(Database.Service)` 优雅降级（无 DB 不装载、不阻塞其他源）
- enabled=false 时零检索零注入——**验收硬指标：CacheShape 前缀哈希与现状一致**

### 2.4 D4 · 工具注册（对齐 tool/AGENTS.md）
- `memory_record` / `memory_search`：注册名 = permission action；Schema 输入输出完整；不新建第二执行入口

## 3. 代码锚点（已核实，直接用）

| 能力 | 位置 | 动作 |
|---|---|---|
| V1 doom_loop 参考 | `packages/aigcfroge/src/session/processor.ts:35,522-546` | 只读参考，不修改 |
| V1 doom_loop 权限规则 | `packages/aigcfroge/src/agent/agent.ts:131` | 语义参考（`doom_loop: "ask"`） |
| V2 runner tool settle | `packages/core/src/session/runner/llm.ts:305-326` | 挂载检测点（FiberSet.run 前） |
| V2 agent defaults | `packages/core/src/plugin/agent.ts:228-238` | 补 `{ action: "doom_loop", resource: "*", effect: "ask" }` |
| PermissionV2 assert/ask | `packages/core/src/permission.ts:237-264` | 复用（assert 语义：deny→DeniedError / allow→过 / ask→挂起；**sessionID 为必填**） |
| PermissionV2 事件 | `packages/core/src/permission.ts:80-90` | `permission.v2.asked` 已定义，复用 |
| 保存审批 | `packages/core/src/permission/saved.ts` | `save: [toolName]` → always 记忆化，复用 |
| compaction 已导出函数 | `packages/core/src/session/compaction.ts:89`（`serializeToolContent`）+ `:171`（`buildPrompt`） | Memory content 提炼复用（**零改动**） |
| SystemContext builtins | `packages/core/src/system-context/builtins.ts` | 加 Memory 源（**新增 Database.Service 依赖**） |
| ContextEpoch | `packages/core/src/session/context-epoch.ts` | 注入后走既有 reconcile/advance |
| 既有 meta 表 | `packages/core/src/meta-agent/sql.ts` | 加 MetaAgentMemoryTable（参考 MetaAgentTable 风格 + `.$type` 枚举） |
| meta_agent 反查 | `packages/core/src/meta-agent/service.ts`（`findBySession`） | record 前反查 meta_agent_id |
| 迁移范式 | `packages/core/src/database/migration/20260806061818_add_task_revision.ts` | 格式参考 |
| 工具注册范式 | `packages/core/src/tool/task.ts:146-163`（layer 注册） | memory 工具对齐 |
| 配置模块范式 | `packages/core/src/config/compaction.ts`（`export * as ConfigCompaction` + Schema.Class） | 新建 `config/meta.ts` 对齐 |
| 测试基座 | `packages/core/test/lib/effect.ts`（`it` = effect+live、`testEffect`、`pollWithTimeout`） | 测试基础设施（**无 it.instance**） |
| DB 测试范式 | `packages/core/test/agent-asset.test.ts:19`（`it.live` + tmpdir） | Memory 落库测试参考 |

## 4. 修改文件清单

```
packages/core/src/session/doom-loop.ts                      新建：DoomLoop 检测服务（Context.Service + Layer.effect）
packages/core/src/plugin/agent.ts                            defaults 加 doom_loop ask
packages/core/src/session/runner/llm.ts                      挂载检测
packages/core/src/meta-agent/sql.ts                          MetaAgentMemoryTable
packages/core/src/database/migration/<ts>_add_meta_agent_memory.ts  新建
packages/core/src/agent/meta/memory.ts                       MemoryService（record 先反查 meta_agent_id）
packages/core/src/tool/memory.ts                             memory_record / memory_search
packages/core/src/system-context/builtins.ts                 Memory 源（默认关闭；新增 Database.Service 依赖）
packages/core/src/config/meta.ts                             新建（ConfigMeta，对齐 config/compaction.ts）
packages/core/src/config                                     Config.Info 挂载 meta 字段
packages/core/test/doom-loop.test.ts                         新建（TDD 红）
packages/core/test/meta-agent-memory.test.ts                 新建（TDD 红）
packages/core/test/tool-memory.test.ts                       新建（TDD 红）
packages/core/test/system-context-memory.test.ts             新建（TDD 红，缓存零影响验证）
```

**不改的文件**：processor.ts（V1 保持原样）/ meta-prompt.ts / compaction.ts / permission.ts / task-driver.ts / cache-shape.ts。

## 5. TDD 工作流（红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。禁止"写完再补测试"。

### Phase A - doom_loop 检测（1d）
1. **红**：新建 `packages/core/test/doom-loop.test.ts`——`it.effect`：连续 3 次相同指纹触发 assert（permission deny 时 DeniedError）；2 次不触发；input 不同不触发；provider-executed 不触发；`threshold=3` 配置生效
2. **绿**：`doom-loop.ts` 实现（`Ref<Map<SessionID, string[]>>` 环形缓冲 + Context.Service + Layer.effect，**不引用 aigcfroge InstanceState**）；`runner/llm.ts` 挂载；`plugin/agent.ts` defaults 补 doom_loop ask
3. **重构**：指纹为 `doom-loop.ts` 私有 helper（`createHash("sha256")...slice(0, 16)`，自实现不引用私有 `CacheShape.shortHash`）
4. **退出**：`bun --cwd packages/core test --timeout 30000` 绿 + `bun --cwd packages/core typecheck` 绿

### Phase B - Memory 表与 Service（2d）
1. **红**：`meta-agent-memory.test.ts`——**`it.live`** + 手动 tmpdir + `Layer.succeed(Database.Service, ...)`（参考 `agent-asset.test.ts:19`）：record 写入返回 id；**非 meta 会话 record 拒绝**（findBySession 反查）；query 按 project_id + fact_category 过滤；search LIKE 命中；remove 幂等；重复 id 不重复插入
2. **绿**：sql.ts 表（`fact_category` 加 `.$type<"code_trap" | "protocol" | "api" | "workflow">()`）+ 迁移文件 + `memory.ts` Service（`Effect.fn("MetaAgentMemory.record")` 等命名；record 先 `findBySession` 反查 meta_agent_id）
3. **重构**：content 提炼调用 `SessionCompaction.serializeToolContent`（compaction.ts:89，已导出）与 `buildPrompt`（行 171），不复制序列化逻辑；时间用 `DateTime.nowAsDate` 转 epoch
4. **退出**：memory 测试绿 + 迁移可应用（`bun --cwd packages/core test` 跑迁移相关套件）+ typecheck

### Phase C - memory 工具（1d）
1. **红**：`tool-memory.test.ts`——工具 Input/Output Schema 解码（非法输入拒绝）；执行走 MemoryService（Layer.mock）；permission action = "memory_record"/"memory_search" 声明生效
2. **绿**：`tool/memory.ts` 注册两工具（对齐 `task.ts` 的 layer 注册模式 + `Tool.make`）
3. **重构**：工具错误统一 `ToolFailure`；描述文案含用法边界（不承诺检索排名）
4. **退出**：工具测试绿 + typecheck

### Phase D - SystemContext 注入（1.5d）
1. **红**：`system-context-memory.test.ts`——**`it.live`**（真实 DB）：`meta.memory.enabled=false` 时 baseline **不含** Memory 段（与现状快照逐字节一致，验证 `CacheShape` 前缀不变）；enabled=true 时含 TOP-N 归类条目（同 project 优先、按 time_updated 倒序）；**无 Database.Service 时该源不装载且不阻塞其他源**（serviceOption 降级）
2. **绿**：`system-context/builtins.ts` 加 Memory 源（走 `SystemContext.initialize` 的既有装载路径；层组合补 `Layer.provide(Database.defaultLayer)`）
3. **重构**：注入格式与既有 sources（skill/reference）拼装风格一致；检索上限走配置（`ConfigMeta`）
4. **退出**：注入测试绿 + **缓存零影响验证**（enabled=false 时 `CacheShape` 前缀哈希与合并前一致，写进测试断言）

### Phase E - 打磨（0.5d）
- 配置文档条目（`meta.memory.enabled/top_n`、`meta.doom_loop.enabled/threshold`）三处同步：config 默认值、文档注释、测试
- **退出**：`bun --cwd packages/core typecheck` + `bun run lint` + 全量 test 绿；改完即审 7 步全过

## 6. 测试规范（必须遵守）

### 6.1 命令（永不从仓库根跑 test）
```bash
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck      # tsgo --noEmit
bun run lint
```

### 6.2 三模式选择（core 测试基座无 it.instance）
| 模式 | 何时用 |
|---|---|
| `it.effect` | DoomLoop 检测纯逻辑、工具 Schema 校验、Memory CRUD（DB 用 mock layer） |
| `it.live` | **真实 DB 落库**（Memory、SystemContext 注入——手动 tmpdir + `Layer.succeed(Database.Service, ...)`，参考 `agent-asset.test.ts:19`）、真实事件发布顺序 |

> `it.instance` 是 aigcfroge 包的基础设施（依赖 InstanceStore），`packages/core/test/lib/effect.ts` 不提供——core 测试一律用 `it.live` + 手动 tmpdir。

### 6.3 硬性规则
- 用 `testEffect(...)`（**`packages/core/test/lib/effect.ts`**，`import { testEffect } from "./lib/effect"`）不要手写 runtime；`Layer.mock` 代替手写 stub
- 禁止 `Effect.sleep(N)` 等 fiber 等待——用 readiness 信号（`pollWithTimeout`/`Deferred`/`SessionStatus`）
- 禁止 `as any`、`@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- 测试实际实现，不把逻辑复制进测试
- Memory 测试断言 `project_id` 隔离（同 content 不同 project 互不可见）

## 7. Effect 编码规范（引用 AGENTS.md §Effect + effect skill）
- `Effect.gen(function* () {})` 组合；命名效果用 `Effect.fn("Domain.method")`（如 `Effect.fn("MetaAgentMemory.record")`）
- 失败用 `yield* new MyError(...)`（`Schema.TaggedErrorClass`），不用 `Effect.fail(new ...)`
- 禁 `Effect.fork`/`forkDaemon`；用 `Effect.forkIn(scope)`
- 时间用 `DateTime.nowAsDate`；`Effect.void` 优先于 `Effect.succeed(undefined)`
- 边界（文件/网络/DB）必须 Catch Everything：`Effect.try`/`catchTag`
- 外部输入先判空/收窄，禁无理由非空断言
- 新代码用 `export * as Foo from "./foo"` 自导出；禁 namespace/别名 import/star import
- 数据库：snake_case 字段、迁移禁 down、全部走 Effect Drizzle 接口（database skill）

## 8. 分支与提交规范
- 分支：`harness-hardening`（从最新 main 切出）
- commit：`type(scope): summary`；scope 用 `core`（如 `feat(core): port V2 doom_loop detector`、`feat(core): add meta agent memory service`）
- 每完成一个 Phase 一个 commit，不批量；迁移文件独立 commit（`feat(core): add meta_agent_memory migration`）
- `.husky/pre-push` 会跑 `bun typecheck`——push 前确保全绿

## 9. 完成标准（验收清单，全过才算完成）
- [ ] 连续 3 次相同工具调用触发 doom_loop 审批（ask 拒绝返回 DeniedError 且工具不执行）；2 次/不同 input/provider-executed 不触发
- [ ] `doom_loop: always` 记忆化后（save）不再打扰（复用 permission/saved.ts）
- [ ] `memory_record` 写入 → 同 project 新会话 `memory_search` 可检索；跨 project 不可见；**非 meta 会话调用 record 被拒绝**
- [ ] `meta.memory.enabled=false` 时 SystemContext baseline 与现状逐字节一致（CacheShape 前缀哈希不变，测试断言）
- [ ] `meta.memory.enabled=true` 时 baseline 含 TOP-N 归类条目（time_updated 倒序）
- [ ] 迁移 `<ts>_add_meta_agent_memory.ts` 可应用、字段 snake_case、`fact_category` 带 `.$type` 枚举、无 down
- [ ] memory 工具：非法输入拒绝（Schema 校验）、权限 action 声明生效、错误走 ToolFailure
- [ ] V1 processor.ts 零改动；meta-prompt.ts / compaction.ts / permission.ts / cache-shape.ts 零改动
- [ ] DoomLoop 状态不引用 aigcfroge InstanceState（core 内 Ref + Layer）
- [ ] typecheck + lint + test 全绿

## 10. 改完即审（每 Phase 结束必须执行）
1. `git diff -- <files>` 锁定本次改动，不顺手修无关代码
2. 安全复查：Catch Everything / No Null Pointer / Security First（Memory 内容不落日志，防泄漏 prompt 全文）
3. 整洁复查：No Cheating / Reusability / Clean Logs
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
- 禁瞎猜接口——查 `codegraph`（MCP）或 grep 确认后再写
- 禁模糊执行——任务不清停下来问，不自我感动式盲目执行
- 禁创造接口——compaction 已导出函数 / permission 网络 / EventV2 都有现成可复用；DoomLoop 状态用 core 内 Ref + Layer（禁 InstanceState）
- 禁跳过验证——改完必须跑对应包 test（`bun --cwd packages/core test --timeout 30000`）
- 禁破坏架构——遵循 AGENTS.md 分层；新代码用 `export * as Foo` 自导出；不改 V1 代码
- 禁假装理解——未知技术栈承认并向人类求助
- 禁长注释——默认无注释，仅 WHY 非显然处加一行
- 禁把波次 2/3/4 内容混进本次执行

<!-- PROMPT END -->

---

## 使用说明

| 项 | 值 |
|---|---|
| 复制范围 | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` |
| 新对话 model | 默认（工程执行建议主力模型） |
| 新对话打开文件 | `docs/plan/harness-7-layer-hardening.md`（范围真源）+ 本文件 + 调研文档 |
| 开工顺序 | 通读 CLAUDE.md/AGENTS.md/skills -> git 切 `harness-hardening` -> Phase A 红测试开始 |
| 卡住时 | 回报阶段 + 已过/未过测试 + 具体报错，不要绕过（`--no-verify` 禁） |
