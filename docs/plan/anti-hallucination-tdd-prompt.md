# 防幻觉机制 · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 完整执行 [防幻觉机制实施方案 v3](anti-hallucination-implementation.md)（阶段 0 + A + B + C + D）。
> **来源**：[实施计划 v3](anti-hallucination-implementation.md)（范围真源）、[调研文档](../research/agent/AigcForge-双向链接与防幻觉机制调研.md) §5+§8+§9（理论源）、[Harness 7 层现状调研](../research/agent/AigcForge-Harness-7层现状深度调研.md) §10-§11（合规审计）、[审批结论](anti-hallucination-implementation.md) P0-P2 修正
> **分支**：`anti-hallucination`（从最新 main 切出）
> **完成标准**：§9 验收清单全过 + typecheck/lint/test 绿

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 项目的高级全栈工程师。本提示词让你**独立、端到端**执行 [防幻觉机制实施方案 v3](docs/plan/anti-hallucination-implementation.md)（阶段 0 + A + B + C + D）。范围真源是那份计划，本提示词是执行手册。开工前必须通读以下文档：

**协议文档**（按顺序，每阶段开工前重读对应部分）：

1. `CLAUDE.md` - 宪法（九荣九耻、四大拒绝、根因收敛、极致减法、改完即审流程）
2. `AGENTS.md` - 代码风格（import 自导出、Effect 编码、Schema、Testing、V2 Session Core 不变量、分支提交）
3. `ARCHITECTURE.md` - 架构拓扑（§3 包拓扑 + §4 子系统 + §6 跨层边界）
4. `CONTEXT.md` - Session V2 术语与不变量
5. `packages/core/src/tool/AGENTS.md` - 工具架构约束（不新增第二执行入口、不 catchCause）
6. `.aigcfroge/skills/effect/SKILL.md` - Effect 编码（Effect.gen/Effect.fn/Schema.TaggedErrorClass）
7. `.aigcfroge/skills/protocols/SKILL.md` - 任务路由（跨 core/session + core/tool + core/system-context 簇）
8. `docs/research/agent/AigcForge-双向链接与防幻觉机制调研.md` §5+§8+§9 - 理论源

**范式参考代码**（读源码，不猜接口）：9. `packages/core/src/session/doom-loop.ts` - Service + Layer + runner 集成范式（**阶段 0/A/B 的模板**）10. `packages/core/src/session/runner/llm.ts:164-210` - settleTool 函数（挂载点）11. `packages/core/src/location-layer.ts:169` - Layer 组合模式 12. `packages/core/src/system-context/builtins.ts` - SystemContext 降级注入模式 13. `packages/core/src/session/context-epoch.ts:60-74` - reconcile Updated 分支（零缓存影响证据）14. `packages/core/test/doom-loop.test.ts` - TDD 测试范式（testEffect + Layer.mock + configLayer）

---

## 0. 你的任务（一句话）

为 AigcForge 智能体运行时补齐防幻觉的检测-纠正-验证闭环：CorrectionStore（临时记忆钩子，三模式：记录/拦截/注入）+ 引用完整性校验器 + 验证执行器 + 反向引用注入 + PGE 动态路由，全部按 TDD 红->绿->重构推进，每个 Phase 结束执行改完即审 7 步。

---

## 1. 范围与禁区

### 1.1 范围（5 个阶段，按顺序执行）

- **阶段 0**：CorrectionStore Service（三模式钩子）+ correction-extractor（用户纠正提取）+ correction-facts SystemContext 源 + settleTool advisory 拦截集成
- **阶段 A**：引用完整性校验器（ripgrep 扫描悬空链接 + augment result.value + 写入 CorrectionStore）
- **阶段 B**：验证执行器（typecheck 机械化验证 + 散文映射表 + EventV2 事件 + 写入 CorrectionStore）
- **阶段 C**：反向引用注入（SystemContext 源 + codegraph 降级）
- **阶段 D**：PGE 动态路由（L0/L1/L2 升级 + 失败计数）

### 1.2 禁区（违反即返工，绝对不做）

- ❌ 不新建第二工具执行入口（tool/AGENTS.md："Do not add a second executable entry type"）
- ❌ 不修改 lifecycle-hooks 签名（PostToolUseHook 返回 `Effect<void>` 是纯观察者，内置验证不挂此处）
- ❌ 不在 `SessionInput.admit` 中提取用户纠正（**审批 P0-1**：admit 是进程级，CorrectionStore 是 Location-scoped，层级不兼容）
- ❌ 不用 `Effect.fork` / `forkDaemon`（AGENTS.md：用 `Effect.forkIn(scope)`）
- ❌ 不用 LLM 做纠正提取或脱敏（循环依赖 + 安全风险）
- ❌ 不做沙箱隔离 / 知识图谱 / 执行计划写盘 / 命令语义分级 / L4 模型主动记录工具
- ❌ 不做跨会话纠正共享（session-scoped only）
- ❌ 不修改 V1 代码（processor.ts 保持原样）
- ❌ 不修改 compaction.ts / permission.ts / cache-shape.ts / lifecycle-hooks.ts
- ❌ 不用 `Effect.catchAll` 吞掉 interruption/defect（tool/AGENTS.md：用 `Effect.catchTag` 处理已知错误，interruption/defect 透传）
- ❌ 不用 `as any` / `@ts-ignore`（类型负测试用 `@ts-expect-error` 且注明原因）
- ❌ 不用 `export namespace`（AGENTS.md：用 `export * as Foo from "./foo"` 自导出）
- ❌ 不别名 import（`import { foo as bar }` 禁止，同名碰撞例外需注释）
- ❌ 不 star import（`import * as Foo` 禁止，effect 子模块例外）

---

## 2. 设计决策（已定案 + 审批修正，必须遵守）

### 2.1 DA0 · CorrectionStore 是 Context.Service + Layer（同 doom_loop 模式）

- **三模式**：
  - 模式 1（记录，settle 后）：检测器发现错误 -> 错误 augment 到 `result.value`（一次性）-> 钩子只记录纠正 `{ key, correct, wrong?, source, extractLayer, turnCreated }` -> 不记录错误原文/轮次/"你错了"叙述
  - 模式 2（拦截，settle 前）：从工具 args 提取路径/符号名 -> 匹配 `wrong` 字段（TTL 内）-> 命中返回 advisory warning string（`ℹ️ [纠正提醒] 此路径已纠正，正确值是 X。如确需使用旧值请忽略此提醒。`）-> **工具照常执行**（advisory 不 blocking）
  - 模式 3（注入，SystemContext）：每轮 reconcile 检测纠正库变化 -> 注入 "Verified facts:\n- ..."（只含 `correct`，不含 `wrong`，不含错误历史）-> 走 ContextUpdated 事件（**不破坏前缀缓存**）
- **存储**：`Ref<Map<SessionSchema.ID, CorrectionEntry[]>>`（Location-scoped + SessionID 键控，同 doom_loop），FIFO 环形缓冲最多 20 条
- **TTL 轮次追踪**（审批 P1-5）：CorrectionStore 内部维护 `Ref<Map<SessionSchema.ID, number>>` 轮次计数器，每次 `check()` 调用时自增（因为 check 在每个 turn 的 settleTool 中被调用，等价于轮次）。`turnCreated` 在 `record()` 时从计数器读取
- **存纠正不存错误**：错误在 `result.value` augment 中出现一次，之后上下文只保留正确方向

### 2.2 DA10 修正 · 用户纠正提取在 runner turn 循环中（非 admit）

**审批 P0-1 修正**：原计划在 `SessionInput.admit` 提取用户纠正，但 admit 是进程级（`SessionV2.prompt` 调用），CorrectionStore 是 Location-scoped，层级不兼容。

**修正后**：在 runner `run` 函数的 turn 循环中，intent 分类之后、toolMaterialization 之前，调用 `correctionExtractor.extract(sessionID, latestUserMessageText)`。这保持 admit 纯粹的持久化职责，CorrectionStore 保持 Location-scoped。纠正写入 Ref 后，下一轮 `SystemContextRegistry.load()` 自然读到（SystemContext 本来就是下一轮 reconcile 才注入，实际无损失）。

代码位置：`runner/llm.ts` 的 `run` 函数中，`const intent = ...` 之后、`const toolMaterialization = ...` 之前。

### 2.3 DA1 · 引用校验器是 Context.Service + runner settleTool 集成

- `Context.Service` + `Layer.effect`（Location-scoped），在 `settleTool` 中 `materialization.settle()` 返回后调用
- augment `Settlement.result.value`（追加 `\n\n⚠️ [引用校验] ...`，**不改变 `result.type`**）
- 检测到悬空引用时同时调用 `correctionStore.record(sessionID, { key, correct, wrong, source: "reference-checker", extractLayer: 1, turnCreated })`
- 扫描范围限定到改动文件（从工具 args 提取文件路径），5s 超时，`Effect.catchTag` 处理已知错误，interruption/defect 透传
- 配置：`meta.reference_check.enabled`（默认 true）、`meta.reference_check.timeout_ms`（默认 5000）

### 2.4 DA2 · 验证执行器是 Context.Service + runner settleTool 集成

- 同 DA1 模式，在引用校验后调用
- 触发：仅 `code_modification` 意图 + `edit`/`write`/`apply_patch`/`bash` 工具
- 包路径解析：改动文件 -> `packages/<name>` -> `bun --cwd packages/<name> typecheck`（多包逐个跑；非 `packages/` 文件跳过）
- 60s 超时，连续失败 ≥ 2 次停止自动触发（`Ref<Map<SessionID, number>>` 计数，复用 doom_loop 计数模式不复用实例）
- 验证失败时调用 `correctionStore.record(...)`；验证成功时标记相关纠正为 "confirmed"（不自动清除）
- 事件：`session.next.verify.started` / `verify.passed` / `verify.failed`
- 配置：`meta.verifier.{enabled, timeout_ms, max_consecutive_failures}`

### 2.5 DA7 · settleTool 扩展流程

```
[NEW] correctionStore.check (advisory 拦截，settle 前)
  -> doomLoop.check (blocking 拦截，settle 前，已有)
  -> materialization.settle (执行工具，已有)
  -> [NEW] referenceChecker.check (后置校验，augment result.value + 写入 CorrectionStore)
  -> [NEW] verifier.verify (后置验证，augment result.value + 写入 CorrectionStore，仅 code_modification)
  -> [advisory warning 若有] 追加到 result.value
  -> 返回 Settlement (result.type 不变)
```

关键约束：

- 引用校验和验证执行**串行**（引用校验先 5s，验证执行后 60s），各自独立超时
- 兜底用 `Effect.catchTag` 处理已知错误类型，**不用 `Effect.catchAll`**（tool/AGENTS.md：interruption/defect 透传）
- augment 只追加文本，不改变 `result.type`（text 仍为 text，error 仍为 error）

### 2.6 DA8 · 纠正过期：TTL 衰减 + 用户纠正豁免

| 来源        | TTL             | 拦截参与              | 注入参与          |
| ----------- | --------------- | --------------------- | ----------------- |
| L1 检测器   | 10 轮后退出拦截 | ✅ 10 轮内            | ✅ 直到 FIFO 驱逐 |
| L2 用户纠正 | 不过期          | ✅ 永久（session 内） | ✅ 直到 FIFO 驱逐 |
| L3 原文回退 | 5 轮后移除      | ❌                    | ✅ 5 轮内         |

不做验证成功自动清除。

### 2.7 DA9 · 敏感内容安全

- **提取白名单**：文件路径、import 路径、类型签名、HTTP 方法、标识符、布尔/枚举值
- **敏感模式黑名单**：`sk-[a-zA-Z0-9]{20,}` / `AKIA[A-Z0-9]{16}` / `Bearer\s+[a-zA-Z0-9._-]+` / `eyJ[a-zA-Z0-9._-]+\.`（JWT）/ `password\s*[=:]` / `secret\s*[=:]` / `token\s*[=:]` / `api[_-]?key\s*[=:]` / 值 >200 字符 / `.env`/`auth.json` 上下文
- L3 回退原文时先扫描敏感模式，命中则**跳过存储**（只保留工具结果中的一次性 augment）
- 不用 LLM 脱敏（机械扫描在写入前完成）

### 2.8 DA6 · 配置统一挂在 ConfigMeta.Info 下

```ts
// config/meta.ts 扩展后（对齐 config/compaction.ts 模式）
export class ReferenceCheck extends Schema.Class<ReferenceCheck>("ConfigV2.Meta.ReferenceCheck")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  timeout_ms: PositiveInt.pipe(Schema.optional),
}) {}

export class Verifier extends Schema.Class<Verifier>("ConfigV2.Meta.Verifier")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  timeout_ms: PositiveInt.pipe(Schema.optional),
  max_consecutive_failures: PositiveInt.pipe(Schema.optional),
  escalation_enabled: Schema.Boolean.pipe(Schema.optional),
  escalation_threshold: PositiveInt.pipe(Schema.optional),
}) {}

export class ReverseRefs extends Schema.Class<ReverseRefs>("ConfigV2.Meta.ReverseRefs")({
  enabled: Schema.Boolean.pipe(Schema.optional),
}) {}

export class CorrectionStoreConfig extends Schema.Class<CorrectionStoreConfig>("ConfigV2.Meta.CorrectionStore")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  max_entries: PositiveInt.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Meta")({
  memory: Memory.pipe(Schema.optional),
  doom_loop: DoomLoop.pipe(Schema.optional),
  reference_check: ReferenceCheck.pipe(Schema.optional),
  verifier: Verifier.pipe(Schema.optional),
  reverse_refs: ReverseRefs.pipe(Schema.optional),
  correction_store: CorrectionStoreConfig.pipe(Schema.optional),
}) {}
```

---

## 3. 代码锚点（已核实，直接用）

| 能力                        | 位置                                                                                         | 动作                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **doom_loop Service 范式**  | `session/doom-loop.ts`（Context.Service + Layer.effect + Ref<Map> + fingerprintOf helper）   | **阶段 0/A/B 的模板**，读源码后对齐风格                          |
| **doom_loop runner 集成**   | `runner/llm.ts:125`（`yield* DoomLoop.Service`）+ `:164-210`（settleTool 中 doomLoop.check） | 阶段 0/A/B 的挂载点                                              |
| **doom_loop Layer 组合**    | `location-layer.ts:169`（`DoomLoop.layer.pipe(Layer.provide(services))`）                    | 新 Layer 按此模式组合                                            |
| **doom_loop 测试范式**      | `test/doom-loop.test.ts`（testEffect + configLayer + Layer.mock(PermissionV2.Service)）      | **所有新测试的模板**                                             |
| **SystemContext 降级模式**  | `system-context/builtins.ts:93-113`（Memory 源 `Effect.serviceOption` 降级）                 | 阶段 0 correction-facts 源 + 阶段 C reverse-refs 源复用          |
| **SystemContext reconcile** | `context-epoch.ts:60-74`（Updated 分支返回 stored.baseline 不变，走 ContextUpdated 事件）    | 零缓存影响的代码级证据                                           |
| **CacheShape 哈希**         | `cache/cache-shape.ts:65-69`（capture 只哈希 `[system, baseline]` + tools + rewriteVersion） | 验证缓存影响的依据                                               |
| **ContextUpdated -> 消息**  | `message-updater.ts:142`（`session.next.context.updated` -> SessionMessage.System）          | 纠正注入走消息不进系统提示词                                     |
| **entriesForRunner 过滤**   | `history.ts:41`（包含 seq > baselineSeq 的 system 消息）                                     | 模型在 messages 中看到 ContextUpdated                            |
| **runner turn 循环**        | `runner/llm.ts:256-290`（currentStep / intent 分类 / toolMaterialization）                   | 阶段 0 用户纠正提取插入点（intent 后、toolMaterialization 前）   |
| **settleTool 函数**         | `runner/llm.ts:164-210`                                                                      | 阶段 0/A/B 的挂载扩展点                                          |
| **ConfigMeta 现状**         | `config/meta.ts`（Memory + DoomLoop Schema classes）                                         | 扩展加 ReferenceCheck/Verifier/ReverseRefs/CorrectionStoreConfig |
| **Config.Info 挂载**        | `config.ts:94`（`meta: ConfigMeta.Info.pipe(Schema.optional)`）                              | 已有，只需扩展 ConfigMeta.Info                                   |
| **意图分类**                | `agent/meta/intent.ts`（`classify` 返回 IntentCategory）                                     | 阶段 B 触发条件                                                  |
| **AppProcess**              | `process.ts`（`AppProcess.run`）                                                             | 阶段 B typecheck 执行                                            |
| **Ripgrep**                 | `ripgrep.ts`（`grep`/`glob`/`find`）                                                         | 阶段 A 引用扫描                                                  |
| **EventV2.define**          | `session/event.ts`（如 `SessionEvent.Tool.Failed = EventV2.define({...})`）                  | 阶段 B verify 事件定义                                           |
| **judgeMerge**              | `agent/judge.ts`                                                                             | 阶段 D L1 路由                                                   |
| **task delegateJudge**      | `tool/task.ts:97-102` + `task-driver-fill.ts`                                                | 阶段 D L2 路由                                                   |
| **测试基座**                | `test/lib/effect.ts`（`testEffect` = `it.effect` + `it.live`，**无 it.instance**）           | 测试基础设施                                                     |
| **DB 测试范式**             | `test/agent-asset.test.ts:19`（`it.live` + tmpdir + `Layer.succeed(Database.Service, ...)`） | SystemContext 落库测试参考                                       |

---

## 4. 修改文件清单

```
--- 阶段 0 ---
packages/core/src/session/correction-store.ts              新建：CorrectionStore Service（Context.Service + Layer.effect + Ref<Map>）
                                                             self-export: export * as CorrectionStore from "./correction-store"
packages/core/src/session/correction-extractor.ts           新建：用户纠正提取（模式匹配 + 白名单 + 敏感拒绝）
                                                             self-export: export * as CorrectionExtractor from "./correction-extractor"
packages/core/src/system-context/correction-facts.ts       新建：CorrectionFacts SystemContext 源
                                                             self-export: export * as CorrectionFacts from "./correction-facts"
packages/core/src/config/meta.ts                            扩展：加 CorrectionStoreConfig + Info 字段
packages/core/src/session/runner/llm.ts                    扩展：settleTool 中 correctionStore.check (advisory, settle 前) + turn 循环中 correctionExtractor.extract
packages/core/src/location-layer.ts                         扩展：CorrectionStore.layer 组合
packages/core/test/correction-store.test.ts                 新建（TDD 红）
packages/core/test/correction-extractor.test.ts             新建（TDD 红）
packages/core/test/system-context-correction-facts.test.ts  新建（TDD 红）

--- 阶段 A ---
packages/core/src/session/reference-checker.ts             新建：ReferenceChecker Service
                                                             self-export: export * as ReferenceChecker from "./reference-checker"
packages/core/src/config/meta.ts                            扩展：加 ReferenceCheck Schema class
packages/core/src/session/runner/llm.ts                    扩展：settleTool 中 settle 后调用 + 写入 CorrectionStore
packages/core/src/location-layer.ts                        扩展：ReferenceChecker.layer 组合
packages/core/test/reference-checker.test.ts                新建（TDD 红）

--- 阶段 B ---
packages/core/src/session/verifier.ts                      新建：Verifier Service
                                                             self-export: export * as Verifier from "./verifier"
packages/core/src/session/verifier-prose.ts                 新建：散文映射表（数据驱动）
                                                             self-export: export * as VerifierProse from "./verifier-prose"
packages/core/src/config/meta.ts                            扩展：加 Verifier Schema class
packages/core/src/session/event.ts                          扩展：session.next.verify.started/passed/failed 事件
packages/core/src/session/runner/llm.ts                    扩展：settleTool 中调用 + 写入 CorrectionStore
packages/core/src/location-layer.ts                        扩展：Verifier.layer 组合
packages/core/test/session-verifier.test.ts                 新建（TDD 红）
packages/core/test/verifier-prose.test.ts                   新建（TDD 红）
packages/core/test/session-runner-verifier.test.ts          新建（集成）

--- 阶段 C ---
packages/core/src/system-context/reverse-refs.ts           新建：ReverseRefs SystemContext 源
                                                             self-export: export * as ReverseRefs from "./reverse-refs"
packages/core/src/config/meta.ts                            扩展：加 ReverseRefs Schema class
packages/core/src/system-context/builtins.ts                扩展：注册 reverse-refs 源
packages/core/test/system-context-reverse-refs.test.ts      新建（TDD 红）

--- 阶段 D ---
packages/core/src/session/verification-router.ts            新建：VerificationRouter Service
                                                             self-export: export * as VerificationRouter from "./verification-router"
packages/core/src/session/verifier.ts                       扩展：验证失败后调用 router
packages/core/src/config/meta.ts                            扩展：verifier 加 escalation 配置字段
packages/core/test/verification-router.test.ts              新建（TDD 红）
```

**不改的文件**：processor.ts / meta-prompt.ts / compaction.ts / permission.ts / cache-shape.ts / lifecycle-hooks.ts / tool/registry.ts（settleWith 内部不改，只在 runner settleTool 中 augment）。

---

## 5. TDD 工作流（红 -> 绿 -> 重构，逐 Phase）

每个 Phase 严格三步骤：**先写失败测试 -> 实现最小代码到测试通过 -> 重构去重**。禁止"写完再补测试"。

### Phase 0A - CorrectionStore 核心（record + check + TTL + FIFO）（1.5d）

1. **红**：`correction-store.test.ts`--`it.effect`：
   - `record` 写入后 `check` 能匹配 `wrong` 字段返回 advisory warning string
   - `check` 未命中 `wrong` 返回空 string（不 blocking）
   - 按 `sessionID` 隔离（session A 的纠正不影响 session B）
   - FIFO 20 条驱逐（写入 21 条后最老条目被移除，`check` 不再匹配）
   - TTL 10 轮后退出拦截（`check` 调用 10 次后 L1 纠正不再匹配）
   - L2 用户纠正不过期（TTL 检查跳过 `source: "user-correction"`）
   - advisory warning 格式含"如确需使用旧值请忽略此提醒"
   - `enabled=false` 时 `check` 返回空 string，`record` 不写入
2. **绿**：`correction-store.ts` 实现（`Context.Service` + `Layer.effect` + `Ref<Map<SessionID, CorrectionEntry[]>>` + `Ref<Map<SessionID, number>>` 轮次计数器 + `Effect.fn("CorrectionStore.record")` / `Effect.fn("CorrectionStore.check")` 命名）
3. **重构**：TTL 检查提取为私有 helper `isExpired(entry, currentTurn)`；FIFO 驱逐提取为私有 helper `evictOldest(entries, maxEntries)`
4. **退出**：`bun --cwd packages/core test --timeout 30000` 绿 + `bun --cwd packages/core typecheck` 绿

### Phase 0B - correction-extractor（用户纠正提取 + 敏感安全）（1d）

1. **红**：`correction-extractor.test.ts`--`it.effect` 表驱动：
   - "不对，路径是 ./bar 不是 ./foo" -> 提取 `{ wrong: "./foo", correct: "./bar", source: "user-correction", extractLayer: 2 }`
   - "错了，函数返回 Promise<string> 不是 string" -> 提取 `{ wrong: "string", correct: "Promise<string>" }`
   - "should be POST not GET" -> 提取 `{ wrong: "GET", correct: "POST" }`
   - "sk-abc123def456..." -> **拒绝存储**（敏感模式命中）
   - "Bearer eyJhbGc..." -> **拒绝存储**
   - "password=secret123" -> **拒绝存储**
   - 无纠正信号（"请帮我写一个函数"）-> 不提取
   - 有纠正信号但无白名单匹配 -> L3 原文回退（`wrong` 为空，`correct` = 原文，先做敏感扫描）
   - L3 原文含敏感模式 -> **拒绝存储**
   - 值 >200 字符 -> **拒绝存储**
2. **绿**：`correction-extractor.ts` 实现（纠正信号正则 + 实体提取正则 + 白名单校验 + 敏感模式黑名单 + L3 回退）
3. **重构**：白名单模式和黑名单模式提取为常量表（`WHITELIST_PATTERNS` / `SENSITIVE_PATTERNS`）
4. **退出**：测试绿 + typecheck

### Phase 0C - correction-facts SystemContext 源 + runner 集成（1d）

1. **红**：`system-context-correction-facts.test.ts`--`it.live`：
   - 空库 -> baseline "No verified facts recorded."
   - 有 1 条纠正 -> baseline "Verified facts:\n- [key] correct_value"
   - 有 3 条纠正 -> baseline 含 3 行
   - `correction_store.enabled=false` -> baseline "No verified facts recorded."（零变化）
   - **缓存零影响**：`enabled=false` 时 `CacheShape.capture` 前缀哈希与无 correction-facts 源时一致
2. **绿**：`correction-facts.ts` SystemContext 源（复用 `builtins.ts` Memory 源的 `Effect.serviceOption` 降级模式）+ `builtins.ts` 注册 + runner `settleTool` 中 `correctionStore.check` (advisory, settle 前) + runner turn 循环中 `correctionExtractor.extract`
3. **重构**：注入格式提取为 helper `renderFacts(entries)`；runner 集成的 advisory warning 拼接提取为 helper
4. **退出**：测试绿 + typecheck + **缓存零影响验证**（enabled=false 时 CacheShape 前缀哈希不变，写进测试断言）

### Phase A - 引用完整性校验器（2-3d）

1. **红**：`reference-checker.test.ts`--`it.live` + tmpdir：
   - markdown 文件含 `[text](./nonexistent.md)` -> 报悬空 + augment `result.value`
   - markdown 文件含 `[text](./exists.md)` 且 `./exists.md` 存在 -> 不报
   - TypeScript 文件含 `import { X } from "./nonexistent"` -> 报悬空
   - `import { X } from "./exists"` 且 `./exists.ts` 存在 -> 不报
   - `read` 工具不触发校验
   - `grep` 工具不触发校验
   - augment 后 `result.type` 不变（text 仍为 text，error 仍为 error）
   - 检测到悬空时写入 CorrectionStore（`wrong` = 悬空路径，`correct` = "文件不存在"或正确路径）
   - 超时跳过不阻塞（`timeout_ms=1` + 大文件 -> 跳过，返回原 result 不 augment）
   - `enabled=false` -> 不触发
2. **绿**：`reference-checker.ts` Service（`Layer.effect` + Ripgrep + `Bun.file().exists()`）+ runner settleTool 集成 + config
3. **重构**：文件路径提取按工具名分发（`write` -> `args.path`，`edit` -> `args.file_path`，`bash` -> 正则提取 `command` 中的路径）提取为 helper；augment 格式提取为 helper
4. **退出**：测试绿 + typecheck

### Phase B - 验证执行器 + 散文报错（5-8d）

1. **红**：`session-verifier.test.ts`--`it.live`：
   - 包路径解析：`packages/core/src/foo.ts` -> `packages/core`
   - 包路径解析：`packages/app/src/bar.tsx` -> `packages/app`
   - 非 workspace 文件（`/tmp/test.ts`）-> 跳过验证
   - timeout 60s（`timeout_ms=1` -> 超时跳过）
   - 连续失败 2 次后停止自动触发（第 3 次不执行 typecheck）
   - 成功恢复计数（失败后成功 -> 计数清零 -> 下次仍触发）
   - augment 后 `result.type` 不变
   - 验证失败时写入 CorrectionStore
   - `enabled=false` -> 不触发
   - `code_understanding` 意图 -> 不触发（仅 `code_modification`）

   `verifier-prose.test.ts`--`it.effect` 表驱动：
   - `Cannot find module 'X'` -> 含 "Self-export is the global default"
   - `Type 'A' is not assignable to type 'B'` -> 含 "Avoid the `any` type"
   - `Property 'X' does not exist on type 'Y'` -> 含 "No Null Pointer"
   - 未匹配错误 -> 通用散文 + 原始错误摘要

2. **绿**：`verifier.ts` Service + `verifier-prose.ts` 映射表 + EventV2 事件 + runner 集成 + ConfigMeta 扩展
3. **重构**：包路径解析复用 `Location.directory`（不硬编码包列表）；散文映射表数据驱动；连续失败计数提取为 `Ref<Map<SessionID, number>>` 私有 helper
4. **退出**：三测试文件全绿 + typecheck + `bun --cwd packages/core test` 全量

### Phase C - 反向引用注入（3-4d）

1. **红**：`system-context-reverse-refs.test.ts`--`it.live`：
   - `enabled=false` -> baseline 不含 reverse-refs 段（CacheShape 前缀哈希不变）
   - `enabled=true` 且 codegraph 可用 -> baseline 含 "Modules referenced..." 段
   - codegraph 不可用 -> `SystemContext.unavailable`，不阻塞其他源
   - 无改动文件 -> baseline "No reverse references."
2. **绿**：`reverse-refs.ts` 源 + config + builtins 注册
3. **重构**：模块名提取复用 Phase B 的包路径解析 helper
4. **退出**：测试绿 + typecheck + 缓存零影响验证

### Phase D - PGE 动态路由（4-6d，依赖 Phase B 完成）

1. **红**：`verification-router.test.ts`--`it.effect`：
   - 默认走 L0（`escalation_enabled=false` -> 永远 L0）
   - `escalation_enabled=true` + L0 连续失败 2 次 -> 升 L1
   - L1 失败 -> 升 L2
   - 验证成功 -> 计数清零 -> 回退 L0
   - `content_creation` 意图直接走 L1（跳过 L0）
   - `code_modification` 单包改动 -> 走 L0
2. **绿**：`verification-router.ts` Service + verifier 扩展 + config 扩展
3. **重构**：升级计数提取为 `Ref<Map<SessionID, number>>` 私有 helper；L2 组装复用 `task` 委派
4. **退出**：测试绿 + typecheck + 全量 test

---

## 6. 测试规范（必须遵守）

### 6.1 命令（永不从仓库根跑 test）

```bash
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck      # tsgo --noEmit
bun run script/lint-changed.ts         # 增量 lint
```

### 6.2 三模式选择（core 测试基座无 it.instance）

| 模式        | 何时用                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `it.effect` | CorrectionStore 纯逻辑、correction-extractor 模式匹配、Verifier 散文映射、VerificationRouter 路由逻辑、包路径解析纯函数                                            |
| `it.live`   | **真实 ripgrep**（引用校验器）、**真实子进程 typecheck**（验证执行器）、**真实 DB**（SystemContext 源注入验证）、**真实文件系统**（tmpdir + markdown/import 文件） |

> core 测试基座 `packages/core/test/lib/effect.ts` 只提供 `it.effect` + `it.live`（无 `it.instance`）。真实 DB 测试用 **`it.live` + 手动 tmpdir + `Layer.succeed(Database.Service, ...)`** 模式（参考 `packages/core/test/agent-asset.test.ts:19`）。

### 6.3 硬性规则

- 用 `testEffect(...)`（`packages/core/test/lib/effect.ts`，`import { testEffect } from "./lib/effect"`），不手写 runtime
- `Layer.mock` 代替手写 stub（参考 `doom-loop.test.ts` 的 `Layer.mock(PermissionV2.Service, {...})`）
- 禁 `Effect.sleep(N)` 等 fiber 等待--用 readiness 信号（`pollWithTimeout`/`Deferred`）
- 禁 `as any`/`@ts-ignore`；类型负测试用 `@ts-expect-error` 且注明原因
- 测试实际实现，不把逻辑复制进测试
- 散文映射表测试 = 表驱动（错误模式 × 期望散文），不写死单个字符串断言
- correction-extractor 测试 = 表驱动（输入文本 × 期望提取结果），不写死
- augment 测试：验证 `result.type` 在 augment 后不改变（text 仍为 text，error 仍为 error）
- 敏感模式拒绝测试：`sk-xxx` / `Bearer xxx` / `password=xxx` -> 拒绝存储
- advisory 拦截测试：匹配 wrong -> 返回 warning string，不 blocking，工具照常执行
- 缓存影响测试：`enabled=false` 时 `CacheShape.capture` 前缀哈希与无新源时一致（写进断言）

---

## 7. Effect 编码规范（引用 AGENTS.md §Effect + effect skill）

- `Effect.gen(function* () {})` 组合
- 命名效果用 `Effect.fn("Domain.method")`（如 `Effect.fn("CorrectionStore.record")`、`Effect.fn("ReferenceChecker.check")`、`Effect.fn("Verifier.verify")`、`Effect.fn("VerificationRouter.route")`）；内部 helper 用 `Effect.fnUntraced`
- 失败用 `yield* new MyError(...)`（`Schema.TaggedErrorClass`），不用 `Effect.fail(new ...)`
- **每个新 Service 至少定义一个 TaggedErrorClass**（如 `CorrectionStore.ExtractionError`、`ReferenceChecker.ScanError`、`Verifier.TimeoutError`、`Verifier.ExecutionError`）
- 禁 `Effect.fork`/`forkDaemon`；用 `Effect.forkIn(scope)`（**审批 P1-1**：风险表中的 `Effect.fork` 已修正）
- 时间用 `DateTime.nowAsDate`；`Effect.void` 优先于 `Effect.succeed(undefined)`
- 边界（文件/网络/子进程）必须 Catch Everything：用 `Effect.catchTag` 处理已知错误类型，**不用 `Effect.catchAll`**（tool/AGENTS.md：interruption/defect 透传）
- 外部输入先判空/收窄，禁无理由非空断言
- 新代码用 `export * as Foo from "./foo"` 自导出（**审批 P1-2**）；禁 namespace/别名 import/star import
- Schema：多字段用 `Schema.Class`，单值用 `Schema.brand`，错误用 `Schema.TaggedErrorClass`
- 配置 Schema 对齐 `config/compaction.ts` 模式（`Schema.Class` + `Schema.optional` 字段）

---

## 8. 分支与提交规范

- 分支：`anti-hallucination`（从最新 main 切出）
- commit：`type(scope): summary`；scope 用 `core`
- 每完成一个 Phase 一个 commit，不批量
- 阶段 0 先于阶段 A 提交（A 依赖 CorrectionStore）
- `.husky/pre-push` 跑 `bun typecheck`--push 前确保全绿

---

## 9. 完成标准（验收清单，全过才算完成）

- [ ] **阶段 0**：CorrectionStore 三模式工作；advisory 拦截不 blocking（工具照常执行）；SystemContext 注入"Verified facts"（只含 `correct` 不含 `wrong`）；TTL 10 轮后退出拦截（L1）；L2 用户纠正不过期；FIFO 20 条驱逐；敏感模式（`sk-*`/`Bearer *`/`password=`）拒绝存储；用户纠正在 runner turn 循环中提取（**非 admit**）；`enabled=false` 时零缓存影响（CacheShape 前缀哈希不变）
- [ ] **阶段 A**：`edit` 修改 markdown 后悬空链接被检测 + augment `result.value` + 写入 CorrectionStore；`write` 创建文件后 import 指向不存在模块被检测；`read`/`grep` 不触发；ripgrep 不可用跳过不阻塞；`result.type` 不变
- [ ] **阶段 B**：`code_modification` turn 后自动跑受影响包 typecheck；失败 60s 超时；连续 2 次失败停止；散文报错 augment（含 AGENTS.md 条款引用）+ 写入 CorrectionStore；非 `packages/` 文件跳过；`code_understanding` 意图不触发；`session.next.verify.started`/`verify.passed`/`verify.failed` 事件正确发布
- [ ] **阶段 C**：`enabled=false` 零变化（CacheShape 前缀哈希不变）；`enabled=true` 且 codegraph 可用时 baseline 含反向引用；codegraph 不可用降级为 `unavailable` 不阻塞
- [ ] **阶段 D**：默认走 L0；L0 连续失败 2 次升 L1（`judgeMerge`）；L1 失败升 L2（`delegateJudge`）；验证成功回退 L0；`escalation_enabled=false` 时永远 L0
- [ ] 全部：typecheck + lint + test 绿；改完即审 7 步全过

---

## 10. 改完即审（每 Phase 结束必须执行）

1. `git diff -- <files>` 锁定本次改动，不顺手修无关代码
2. 安全复查：Catch Everything（各阶段独立超时+`catchTag`兜底）/ No Null Pointer（CorrectionEntry 字段可空需 narrowing）/ Security First（敏感内容不持久化，白名单+黑名单）
3. 整洁复查：No Cheating（无 as any/@ts-ignore）/ Reusability（复用 doom_loop 模式）/ Clean Logs（纠正库内容不含敏感值）
4. 数据流追踪：每个 Effect 的 Layer 依赖已 provide；import 真实存在；条件分支两端有执行路径；**CorrectionStore 是 Location-scoped，不在进程级代码中 yield\***
5. V2 Session Core 不变量核对：
   - "Keep durable prompt admission separate from model execution"（用户纠正提取在 runner 不在 admit ✓）
   - "Keep SessionRunner Location-scoped"（CorrectionStore Location-scoped ✓）
   - "Keep the System Context algebra in packages/core/src/system-context"（correction-facts.ts 在此目录 ✓）
6. 命令验证：`bun --cwd packages/core test --timeout 30000` + `bun --cwd packages/core typecheck` + `bun run script/lint-changed.ts`
7. 输出复查结论：

```text
复查结论:
- 影响文件:
- 命中 skills:
- 安全门禁:
- 工程门禁:
- 已运行命令:
- 剩余风险:
```

---

## 11. 禁止事项（九荣九耻）

- 禁瞎猜接口--查 codegraph（MCP）或 grep 确认后再写
- 禁模糊执行--任务不清停下来问，不自我感动式盲目执行
- 禁臆想业务--业务逻辑不清晰时主动提出疑问
- 禁创造接口--doom_loop 范式 / SystemContext 管道 / EventV2 都有现成可复用
- 禁跳过验证--改完必须跑对应包 test
- 禁破坏架构--遵循 AGENTS.md 分层；新代码用 `export * as Foo` 自导出；不改 V1 代码
- 禁假装理解--未知技术栈承认并向人类求助
- 禁盲目修改--小步快跑，每次重构前理清依赖关系
- 禁治标敷衍--不修现象，只解决本质问题

---

## 12. 开工顺序

1. 通读 CLAUDE.md / AGENTS.md / ARCHITECTURE.md / CONTEXT.md / tool/AGENTS.md / skills
2. 读 doom_loop 源码（`doom-loop.ts` + `runner/llm.ts:164-210` + `location-layer.ts:169` + `doom-loop.test.ts`）
3. 读 SystemContext 源码（`builtins.ts` + `context-epoch.ts:60-74` + `index.ts`）
4. `git checkout -b anti-hallucination`
5. Phase 0A 红测试开始

<!-- PROMPT END -->

---

## 使用说明

| 项             | 值                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 复制范围       | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->`                                                                                            |
| 新对话 model   | 默认（工程执行建议主力模型）                                                                                                                |
| 新对话打开文件 | `docs/plan/anti-hallucination-implementation.md`（范围真源）+ 本文件 + 调研文档 `docs/research/agent/AigcForge-双向链接与防幻觉机制调研.md` |
| 开工顺序       | 通读协议文档 -> 读 doom_loop 范式代码 -> git 切 `anti-hallucination` -> Phase 0A 红测试开始                                                 |
| 卡住时         | 回报阶段 + 已过/未过测试 + 具体报错，不要绕过（`--no-verify` 禁）                                                                           |
| 审批角色       | 执行完成后由审批 agent 按 §10 改完即审 7 步逐 Phase 验收                                                                                    |
