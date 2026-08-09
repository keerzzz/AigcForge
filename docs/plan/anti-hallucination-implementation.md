# 防幻觉机制实施方案 v3：引用校验 · 验证执行器 · 纠正持久化 · 反向引用 · PGE 路由

> 状态：**REVISED（v3 - 集成临时记忆钩子 + 敏感安全 + 入口边界定案，2026-08-09）**
> 日期：2026-08-09
> Owner：Core（主）+ App（次）
> 范围：`packages/core/src`（主）+ `packages/aigcfroge/src`（挂载 + 配置）
> 关联：[双向链接与防幻觉机制调研](../research/agent/AigcForge-双向链接与防幻觉机制调研.md)（理论源，含 §9 临时记忆钩子）、[Harness 7 层现状调研](../research/agent/AigcForge-Harness-7层现状深度调研.md)（范围真源）、[Harness 7 层加固实施计划](harness-7-layer-hardening.md)（前置计划，波次 1a/1b 已完成）、[防幻觉 PRD](../prd/anti-hallucination.md)
> 分支：**anti-hallucination**（从最新 main 切出）
> 最后更新：2026-08-09

---

## 0. v3 修订记录（相对 v2）

| 编号 | 变更 | 依据 |
|---|---|---|
| R-6 | 新增阶段 0：CorrectionStore Service（临时记忆钩子），阶段 A/B 的公共子模块 | 调研 §9 三模式钩子 + 存纠正不存错误原则 |
| R-7 | settleTool 扩展流程增加纠正拦截（advisory）+ 纠正记录（settle 后） | 调研 §9.3 模式 1/2 |
| R-8 | 新增用户纠正提取入口：`SessionInput.admit` 路径 | 调研 §9.6 入口边界定案 |
| R-9 | 新增敏感内容安全处理：白名单提取 + 敏感模式拒绝 + L3 脱敏 | 调研 §9.7 |
| R-10 | 纠正过期策略定案：TTL 衰减 + 用户纠正豁免 | 调研 §9.6 |
| R-11 | 拦截模式定案：advisory 不 blocking | 调研 §9.6 |
| R-12 | ConfigMeta 扩展加 `correction_store` + `session_memory` 字段 | 本计划 §3.6 |

### 0.1 v2 修订记录（保留）

| 编号 | 问题 | 修正 |
|---|---|---|
| R-1 | v1 写"验证机制挂 lifecycle-hooks"，但 `PostToolUseHook` 返回 `Effect<void>`，是纯观察者 | 改为 **Context.Service + Layer，集成到 runner `settleTool`**（同 doom_loop 模式） |
| R-2 | v1 写"经 ToolFailure.message 通道注入模型"，但 postToolUse 被 `Effect.ignore` 调用 | 改为在 `settleTool` 内直接 **augment `Settlement.result.value`** |
| R-3 | v1 写"runner layer 中注册 postToolUse 钩子"，但 hooks 是模块级数组，非 Service | 改为 `Layer.effect` + `Context.Service`（Location-scoped） |
| R-4 | v1 写"新建 `config/verifier.ts` 独立模块" | 改为 **verifier 配置挂在 `ConfigMeta.Info` 下** |
| R-5 | v1 的 lifecycle-hooks 行声称"已注册"但实际只有 plugin host 注册了钩子 | 修正描述 |

### 0.2 与 harness-7-layer-hardening.md 的关系

| 波次 | 内容 | 状态 |
|---|---|---|
| 1a · V2 doom_loop 检测器 | `session/doom-loop.ts` + PermissionV2 接入 | ✅ 已合入 main |
| 1b · Memory 服务 | `agent/meta/memory.ts` + `meta_agent_memory` 表 + SystemContext 注入 | ✅ 已合入 main |
| 2 · 验证执行器 + 散文报错 | `session/verifier.ts`（未落地） | ❌ **本计划阶段 B 实施** |
| 3 · 执行计划写盘 | `exec-plan-driver.ts`（未落地） | ⏳ 本计划不覆盖 |

---

## 1. 目标、非目标与智能体边界

### 1.1 目标

按调研 §5 + §8 + §9，补齐防幻觉的 5 大机制（阶段 0 为新增公共子模块）：

1. **阶段 0 · CorrectionStore Service**（调研 §9）：临时记忆钩子，三模式（记录/拦截/注入），存纠正不存错误，走 SystemContext update 通道不破坏缓存
2. **阶段 A · 引用完整性校验器**（调研 §5.1）：Context.Service 集成到 runner `settleTool`，检测悬空引用，augment `result.value` + 写入 CorrectionStore
3. **阶段 B · 验证执行器 + 散文报错**（harness-7-layer-hardening 波次 2）：Context.Service 集成到 `settleTool`，typecheck 机械化验证，失败 augment `result.value` + 写入 CorrectionStore
4. **阶段 C · 反向引用注入**（调研 §5.2）：SystemContext 源，codegraph 反向引用注入，默认关闭
5. **阶段 D · PGE 动态路由**（调研 §8）：三级验证策略路由，按任务特征 + 失败历史动态升降级

### 1.2 非目标

- ❌ 不做沙箱隔离、不新建第二工具执行入口、不新建 HITL 通道
- ❌ 不做知识图谱/双向链接数据库、不做解码级/训练级幻觉检测
- ❌ 不做执行计划写盘、不做命令语义分级
- ❌ 阶段 D 不新建 PGE 执行引擎
- ❌ 不修改 lifecycle-hooks 签名（插件扩展点，不是内置验证挂载点）
- ❌ 不做 L4 模型主动记录工具（暂不实施，远期可选）
- ❌ 不做跨会话纠正共享（session-scoped only，父子会话不共享 CorrectionStore）
- ❌ 不用 LLM 做纠正提取或脱敏（循环依赖 + 成本 + 延迟 + 安全风险）

### 1.3 智能体边界

| 阶段 | 适用范围 | 依据 |
|---|---|---|
| 0 CorrectionStore | **所有智能体** | 集成到 runner settleTool + SessionInput.admit，全局生效 |
| A 引用校验器 | **所有智能体** | settleTool 后置校验，任何 agent 编辑文件后触发 |
| B 验证执行器 | **所有智能体** | code_modification 意图触发，不区分 agent |
| C 反向引用注入 | **所有智能体** | SystemContext 源对所有会话生效 |
| D PGE 动态路由 | **仅元智能体** | L1/L2 复用 task 委派 + judgeMerge，只有元智能体有委派权 |

---

## 2. 已就绪基座（全部复用，不新建）

| 能力 | 位置 | 状态 |
|---|---|---|
| **DoomLoop Service 集成模式** | `session/doom-loop.ts` + `runner/llm.ts:125,164-210` + `location-layer.ts:169` | ✅ **阶段 0/A/B 的挂载范式** |
| **SystemContext update 通道** | `context-epoch.ts:72`（Updated 分支返回 stored.baseline 不变，走 ContextUpdated 事件） | ✅ **阶段 0 注入通道（零缓存影响）** |
| lifecycle-hooks | `tool/lifecycle-hooks.ts` | ✅ 插件扩展点，内置验证不挂此处 |
| Ripgrep 服务 | `ripgrep.ts`（`find`/`grep`/`glob`） | ✅ Location-scoped |
| SystemContext 管道 | `system-context/{index,registry,builtins}.ts` | ✅ 注册新源用 `SystemContextRegistry.register` |
| SystemContext 降级模式 | `builtins.ts` Memory 源（`Effect.serviceOption`） | ✅ 阶段 C 复用 |
| SessionInput.admit | `session/input.ts:51`（用户消息唯一入口） | ✅ **阶段 0 用户纠正提取入口** |
| ConfigMeta | `config/meta.ts`（`Memory` + `DoomLoop`） | ✅ `Config.Info` 在 `config.ts:94` 挂载；**阶段 0/A/B/C 扩展** |
| judge 仲裁 | `agent/judge.ts`（`judgeMerge`） | ✅ 阶段 D 复用 |
| task 委派 | `tool/task.ts` + `task-driver-fill.ts` | ✅ 阶段 D 复用 |
| 意图分类 | `agent/meta/intent.ts`（`classify`） | ✅ 7 类已定义 |
| EventV2 事件流 | `session/event.ts` | ✅ 新事件用 `EventV2.define` |
| AppProcess 服务 | `process.ts`（`AppProcess.run`） | ✅ 子进程执行 |
| core 测试基础设施 | `test/lib/effect.ts`（`it.effect` + `it.live` + `testEffect`） | ✅ 无 `it.instance` |

---

## 3. 设计决策（已定案，必须遵守）

### 3.1 DA0 · CorrectionStore 是 Context.Service + Layer（同 doom_loop 模式）

- **三模式钩子**：
  - 模式 1（记录，settle 后）：检测器发现错误 -> 错误在 `result.value` 中出现一次（augment） -> 钩子只记录纠正 `{ key, correct, wrong?, source, extractLayer }` -> 不记录错误原文/轮次/"你错了"叙述
  - 模式 2（拦截，settle 前）：从工具 args 提取路径/符号名 -> 匹配 `wrong` 字段 -> 命中则 advisory warning 追加到 `result.value`（`ℹ️ [纠正提醒] 此路径已纠正，正确值是 X。如确需使用旧值请忽略此提醒。`）-> 工具照常执行（**advisory 不 blocking**）
  - 模式 3（注入，SystemContext）：每轮 reconcile 检测纠正库变化 -> 注入"Verified facts"列表（只含 `correct`，不含 `wrong`，不含错误历史）-> 走 ContextUpdated 事件（**不破坏前缀缓存**）
- **存储**：`Ref<Map<SessionSchema.ID, CorrectionEntry[]>>`（Location-scoped + SessionID 键控，同 doom_loop 模式），FIFO 环形缓冲最多 20 条
- **存纠正不存错误**：错误在 `result.value` augment 中出现一次，之后上下文只保留正确方向（注意力机制 + 正向指令优于负向指令）

### 3.2 DA1 · 引用校验器是 Context.Service + runner settleTool 集成

- `Context.Service` + `Layer.effect`（Location-scoped），在 `settleTool` 中 `materialization.settle()` 返回后调用
- augment `Settlement.result.value`（追加 `\n\n⚠️ [引用校验] ...`，不改变 `result.type`）
- **新增**：检测到悬空引用时同时写入 CorrectionStore（模式 1 记录）
- 扫描范围限定到改动文件，5s 超时，`Effect.catchAll` -> `Effect.void` 兜底
- 配置：`meta.reference_check.enabled`（默认 true）、`meta.reference_check.timeout_ms`（默认 5000）

### 3.3 DA2 · 验证执行器是 Context.Service + runner settleTool 集成

- 同 DA1 模式，在引用校验后调用
- 触发：仅 `code_modification` 意图 + `edit`/`write`/`apply_patch`/`bash` 工具
- 包路径解析：改动文件 -> `packages/<name>` -> `bun --cwd packages/<name> typecheck`
- 60s 超时，连续失败 ≥ 2 次停止自动触发
- **新增**：验证失败时同时写入 CorrectionStore（模式 1 记录）；验证成功时标记相关纠正为"confirmed"（但不自动清除，见 DA8）
- 事件：`session.next.verify.started` / `verify.passed` / `verify.failed`
- 配置：`meta.verifier.{enabled, timeout_ms, max_consecutive_failures}`

### 3.4 DA3 · 反向引用注入走 SystemContext 管道

- SystemContext 源 `core/reverse-refs`，codegraph MCP 可选，无则 `SystemContext.unavailable`
- 默认关闭：`meta.reverse_refs.enabled`（默认 false）
- 不经过 `meta-prompt.ts` fill，不破坏前缀缓存

### 3.5 DA4 · PGE 动态路由复用 doom_loop 计数语义

- 三级路由：L0 机械验证（阶段 B）/ L1 `judgeMerge`（已有）/ L2 `delegateJudge`（已有）
- 升级计数：`Ref<Map<SessionID, number>>`（复用 doom_loop 计数模式，不复用实例）
- 默认关闭：`meta.verifier.escalation_enabled`（默认 false）

### 3.6 DA5 · 散文映射表数据驱动

- `{ pattern: RegExp, principle: string, guidance: string }[]`，不依赖 LLM
- 未匹配回退通用散文 + 原始错误摘要

### 3.7 DA6 · 配置统一挂在 ConfigMeta.Info 下

```ts
// config/meta.ts 扩展后
export class Info extends Schema.Class<Info>("ConfigV2.Meta")({
  memory: Memory.pipe(Schema.optional),
  doom_loop: DoomLoop.pipe(Schema.optional),
  reference_check: ReferenceCheck.pipe(Schema.optional),   // 阶段 A
  verifier: Verifier.pipe(Schema.optional),                 // 阶段 B/D
  reverse_refs: ReverseRefs.pipe(Schema.optional),          // 阶段 C
  correction_store: CorrectionStore.pipe(Schema.optional),  // 阶段 0
}) {}
```

### 3.8 DA7 · settleTool 扩展流程

```
[NEW] correctionStore.check (advisory 拦截，settle 前)
  -> doomLoop.check (blocking 拦截，settle 前，已有)
  -> materialization.settle (执行工具，已有)
  -> [NEW] referenceChecker.check (后置校验，augment result.value + 写入 CorrectionStore)
  -> [NEW] verifier.verify (后置验证，augment result.value + 写入 CorrectionStore，仅 code_modification)
  -> 返回 Settlement (可能含追加的 warning/correction 文本)
```

### 3.9 DA8 · 纠正过期：TTL 衰减 + 用户纠正豁免

| 来源 | TTL | 拦截参与 | 注入参与 |
|---|---|---|---|
| L1 检测器 | 10 轮后退出拦截 | ✅ 10 轮内 | ✅ 直到 FIFO 驱逐 |
| L2 用户纠正 | 不过期 | ✅ 永久（session 内） | ✅ 直到 FIFO 驱逐 |
| L3 原文回退 | 5 轮后移除 | ❌ | ✅ 5 轮内 |

不做验证成功自动清除（验证成功 ≠ 纠正已内化，映射不精确）。

### 3.10 DA9 · 敏感内容安全：白名单提取 + 敏感模式拒绝

- **提取白名单**：文件路径、import 路径、类型签名、HTTP 方法、标识符、布尔/枚举值
- **敏感模式黑名单**：`sk-*`/`AKIA*`/`Bearer *`/`eyJ*`（JWT）/`password=`/`secret=`/`token=`/`api_key=`/值 >200 字符/`.env`/`auth.json` 上下文
- **L3 脱敏**：回退原文时先扫描敏感模式，命中则跳过（不存储，只保留工具结果中的一次性 augment）
- **不用 LLM 脱敏**：在写入 CorrectionStore 之前完成机械扫描，敏感内容不进入 Ref/SystemContext/LLM 请求

### 3.11 DA10 · 用户纠正提取入口：SessionInput.admit

- 在 `SessionInput.admit`（`input.ts:51`）中，`PromptAdmitted` 事件发布后、返回前调用 `CorrectionStore.extractFromUserMessage(sessionID, prompt.text)`
- 利用 admit 与 turn 执行的天然时间差，纠正在同轮 turn 开始时已写入 Ref
- 提取是内存操作（模式匹配 + Ref 写入），微秒级，不阻塞 admit

---

## 4. 分阶段实施

### 阶段 0 · CorrectionStore Service（3-4 天*）

**范围**：`session/correction-store.ts` + `system-context/correction-facts.ts` + `session/correction-extractor.ts` + config + settleTool 集成 + admit 集成

**设计**：
- 服务结构：`Context.Service` + `Layer.effect`（Location-scoped），内部 `Ref<Map<SessionSchema.ID, CorrectionEntry[]>>`
- 三模式：
  - 记录（`record(sessionID, entry)`）：被阶段 A/B 调用
  - 拦截（`check(sessionID, toolName, args)`）：在 settleTool 中 doomLoop.check 前调用，返回 advisory warning string（不 blocking）
  - 注入（SystemContext 源 `core/correction-facts`）：读取 Ref，渲染为 "Verified facts:\n- ..."
- 用户纠正提取（`correction-extractor.ts`）：
  - 纠正信号检测：中文"不对"/"错了"/"应该是"，英文"no"/"wrong"/"should be"
  - 实体提取：正则匹配文件路径、import 路径、类型签名、HTTP 方法、标识符
  - 白名单校验：只存储白名单模式匹配的纠正
  - 敏感模式拒绝：黑名单命中则跳过整条纠正
  - L3 回退：无法结构化提取时存储原文（先做敏感扫描），`wrong` 字段为空（不参与拦截）
- TTL 管理：每条 entry 记录 `turnCreated`，拦截时检查 `currentTurn - turnCreated > ttl` 则跳过
- FIFO 容量：20 条/session，超出驱逐最老条目

**文件清单**：
```
packages/core/src/session/correction-store.ts           新建：CorrectionStore Service（Context.Service + Layer.effect）
packages/core/src/session/correction-extractor.ts        新建：用户纠正提取（模式匹配 + 白名单 + 敏感拒绝）
packages/core/src/system-context/correction-facts.ts    新建：CorrectionFacts SystemContext 源
packages/core/src/config/meta.ts                         扩展：加 CorrectionStore Schema class + Info 字段
packages/core/src/session/runner/llm.ts                 扩展：settleTool 中 correctionStore.check (advisory, settle 前)
packages/core/src/session/input.ts                       扩展：admit 中调用 correctionExtractor
packages/core/src/location-layer.ts                      扩展：CorrectionStore.layer 组合
packages/core/test/correction-store.test.ts              新建（TDD：record/check/注入/TTL/FIFO）
packages/core/test/correction-extractor.test.ts          新建（TDD：模式匹配/白名单/敏感拒绝/L3 回退）
packages/core/test/system-context-correction-facts.test.ts 新建（TDD：enabled=false 零变化/有纠正时注入正确事实）
```

**TDD 工作流**：
1. **红**：`correction-store.test.ts`（record 写入 + 按 sessionID 隔离 + FIFO 20 条驱逐 + TTL 10 轮后退出拦截 + advisory 不 blocking）；`correction-extractor.test.ts`（"不对，路径是 ./bar 不是 ./foo" -> 提取 `wrong=./foo, correct=./bar`；"sk-xxx" -> 拒绝存储；无白名单匹配 -> L3 原文回退 + 敏感扫描）；`system-context-correction-facts.test.ts`（空库 -> baseline "No verified facts"；有纠正 -> "Verified facts:\n- ..."）
2. **绿**：CorrectionStore + Extractor + SystemContext 源 + config + runner/admit 集成
3. **重构**：白名单和黑名单模式提取为常量表；TTL 检查提取为 helper
4. **退出**：三测试文件全绿 + typecheck

### 阶段 A · 引用完整性校验器（2-3 天*）

**范围**：`session/reference-checker.ts` + config + runner 集成 + CorrectionStore 写入

**设计**：
- 同 v2，新增：检测到悬空引用时调用 `correctionStore.record(sessionID, { key, correct, wrong, source: "reference-checker", extractLayer: 1 })`
- augment `result.value`（一次性错误反馈）+ 写入 CorrectionStore（持久化正确方向）

**文件清单**：
```
packages/core/src/session/reference-checker.ts        新建：ReferenceChecker Service
packages/core/src/config/meta.ts                       扩展：加 ReferenceCheck Schema class
packages/core/src/session/runner/llm.ts               扩展：settleTool 中 settle 后调用 + 写入 CorrectionStore
packages/core/src/location-layer.ts                   扩展：ReferenceChecker.layer 组合
packages/core/test/reference-checker.test.ts           新建（TDD）
```

### 阶段 B · 验证执行器 + 散文报错（5-8 天*）

**范围**：`session/verifier.ts` + `session/verifier-prose.ts` + config + runner + EventV2 + CorrectionStore 写入

**设计**：
- 同 v2，新增：验证失败时调用 `correctionStore.record(sessionID, { key, correct, wrong, source: "verifier", extractLayer: 1 })`；验证成功时标记相关纠正为 "confirmed"
- 事件：`session.next.verify.started` / `verify.passed` / `verify.failed`

**文件清单**：
```
packages/core/src/session/verifier.ts                 新建：Verifier Service
packages/core/src/session/verifier-prose.ts            新建：散文映射表
packages/core/src/config/meta.ts                       扩展：加 Verifier Schema class
packages/core/src/session/event.ts                     扩展：verify 事件
packages/core/src/session/runner/llm.ts               扩展：settleTool 中调用 + 写入 CorrectionStore
packages/core/src/location-layer.ts                    扩展：Verifier.layer 组合
packages/core/test/session-verifier.test.ts            新建（TDD）
packages/core/test/verifier-prose.test.ts              新建（TDD）
packages/core/test/session-runner-verifier.test.ts     新建（集成）
```

### 阶段 C · 反向引用注入（3-4 天*）

**范围**：`system-context/reverse-refs.ts` + config + builtins 注册

**设计**：同 v2，无变化。

### 阶段 D · PGE 动态路由（4-6 天*，依赖阶段 B 完成）

**范围**：`session/verification-router.ts` + 升级路由 + config

**设计**：同 v2，无变化。

---

## 5. 测试规范

同 v2，新增：
- CorrectionStore 测试用 `it.effect`（纯逻辑）+ `it.live`（SystemContext 注入验证）
- correction-extractor 测试用 `it.effect`（模式匹配，表驱动：输入文本 × 期望提取结果）
- 敏感模式拒绝测试：`sk-xxx` / `Bearer xxx` / `password=xxx` -> 拒绝存储
- advisory 拦截测试：匹配 wrong -> 返回 warning string，不 blocking，工具照常执行

---

## 6. 分支与提交规范

- 分支：`anti-hallucination`（从最新 main 切出）
- commit：`type(scope): summary`；scope 用 `core`；每完成一个阶段一个 commit
- 阶段 0 先于阶段 A 提交（A 依赖 CorrectionStore）

---

## 7. 完成标准

- [ ] **阶段 0**：CorrectionStore 三模式工作；advisory 拦截不 blocking；SystemContext 注入"Verified facts"（只含 correct）；TTL 10 轮后退出拦截；FIFO 20 条驱逐；敏感模式拒绝存储；用户纠正在 admit 路径提取；`enabled=false` 时零缓存影响
- [ ] **阶段 A**：悬空链接检测 + augment `result.value` + 写入 CorrectionStore；`read` 工具不触发；ripgrep 不可用跳过；`result.type` 不变
- [ ] **阶段 B**：typecheck 自动执行 + 60s 超时 + 连续 2 次失败停止 + 散文报错 augment + 写入 CorrectionStore + verify 事件发布
- [ ] **阶段 C**：`enabled=false` 零变化；`enabled=true` 含反向引用；codegraph 不可用降级
- [ ] **阶段 D**：L0 默认；L0 失败 2 次升 L1；L1 失败升 L2；成功回退 L0；`escalation_enabled=false` 永远 L0
- [ ] 全部：typecheck + lint + test 绿；复查结论 7 步全过

---

## 8. 数据流追踪

### 8.1 完整 settleTool 流程（v3）

```
runner settleTool(input)
  -> [NEW] correctionStore.check (advisory 拦截，settle 前)
     -> 从 args 提取路径/符号名
     -> 匹配 wrong 字段（TTL 内的条目）
     -> 命中：advisory warning（追加到后续 result.value，不 blocking）
     -> 未命中：无操作
  -> doomLoop.check (blocking 拦截，settle 前，已有)
  -> materialization.settle (执行工具，已有)
  -> [NEW] referenceChecker.check (后置校验)
     -> 悬空报告 -> augment result.value（一次性错误）
     -> 写入 CorrectionStore（持久化正确方向）
  -> [NEW] verifier.verify (后置验证，仅 code_modification)
     -> typecheck 失败 -> 散文报错 -> augment result.value
     -> 写入 CorrectionStore
     -> typecheck 成功 -> 标记相关纠正 confirmed
  -> [advisory warning 若有] 追加到 result.value
  -> 返回 Settlement (result.type 不变)
```

### 8.2 用户纠正提取流程

```
SessionInput.admit(sessionID, prompt)
  -> 发布 PromptAdmitted 事件
  -> [NEW] correctionExtractor.extract(sessionID, prompt.text)
     -> 检测纠正信号（"不对"/"错了"/"should be"）
     -> 提取纠正对（白名单模式匹配）
     -> 敏感模式扫描（黑名单命中 -> 拒绝存储）
     -> L3 回退（无法提取 -> 原文 + 敏感扫描）
     -> 写入 CorrectionStore Ref
  -> 返回 Admitted
  --- 天然时间差 ---
  -> SessionExecution.wake -> runner turn 开始
  -> SystemContextRegistry.load -> correction-facts 源读取 Ref
  -> reconcile 检测变化 -> "Updated" -> ContextUpdated 事件
  -> 模型在 messages 中看到 "Verified facts:\n- ..."
  -> baseline 不变 -> 前缀缓存保留
```

### 8.3 缓存影响总结

| 场景 | baseline | 前缀缓存 | 机制 |
|---|---|---|---|
| 正常轮次，纠正库无变化 | 不变 | 保留 | reconcile Unchanged |
| 正常轮次，纠正库有新条目 | 不变 | 保留 | reconcile Updated -> ContextUpdated 事件（进 messages 不进 system） |
| compaction 后 | 变 | break | replace 重新加载，纠正合并进新 baseline（compaction 本身 break） |

---

## 9. 执行协议（实施者必读）

1. `CLAUDE.md` - 宪法
2. `AGENTS.md` - 代码风格
3. `ARCHITECTURE.md` - 架构拓扑
4. `CONTEXT.md` - Session V2 术语与不变量
5. `.aigcfroge/skills/protocols/SKILL.md` - 任务路由
6. `.aigcfroge/skills/effect/SKILL.md` - Effect 编码
7. `packages/core/src/tool/AGENTS.md` - 工具架构约束
8. [调研文档](../research/agent/AigcForge-双向链接与防幻觉机制调研.md) §5+§8+§9 - 理论源
9. [Harness 7 层现状调研](../research/agent/AigcForge-Harness-7层现状深度调研.md) §10-§11 - 合规审计基准
10. [Harness 7 层加固实施计划](harness-7-layer-hardening.md) - 前置计划
11. **doom_loop 实现代码** - Service + Layer + runner 集成范式参考
12. **builtins.ts Memory 源** - SystemContext 降级注入模式参考

---

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| advisory 拦截误报 | 中 | 模型看到不必要的 warning | warning 格式含"如确需使用旧值请忽略此提醒"；advisory 不 blocking |
| 纠正库累积导致 SystemContext 注入过长 | 低 | 上下文 token 消耗 | FIFO 20 条上限 + 注入格式简短（正向事实比错误历史短） |
| 用户纠正提取模式覆盖不全 | 中 | 部分纠正未被提取 | L3 原文回退兜底（不丢失信息，只是无拦截能力） |
| 敏感内容遗漏（黑名单不全） | 低 | 敏感信息进入 LLM 请求 | 白名单提取优先（只存技术模式）；黑名单是第二道防线；L3 原文做敏感扫描 |
| settleTool 延迟叠加（advisory + reference + verify） | 中 | 整 turn 延迟增加 | advisory 微秒级；reference 5s 超时；verify 60s 超时；各自独立 `Effect.catchAll` 兜底 |
| compaction 后纠正合并进 baseline 导致 system prompt 变长 | 低 | 前缀变长 | FIFO 20 条上限；compaction 后 baseline 重算是预期行为 |
| correction-extractor 在 admit 中阻塞 | 低 | 用户消息延迟 | 提取是内存操作（模式匹配 + Ref 写入），微秒级；worst case 可改为 `Effect.fork` |

---

\* 人天为量级估计（非承诺排期），依据：新增文件数 / 挂载点就绪度 / 测试复杂度。
