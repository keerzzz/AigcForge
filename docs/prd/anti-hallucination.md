# PRD：防幻觉机制（检测 · 纠正持久化 · 验证闭环）

> 状态：**Draft**
> 负责人：Core（检测器与纠正库）/ App（诊断 UI，后期）/ Security（敏感内容边界）
> 范围：`packages/core` + `packages/aigcfroge`（配置）
> 关联：[调研文档](../research/agent/AigcForge-双向链接与防幻觉机制调研.md)（理论源）、[实施计划](../plan/anti-hallucination-implementation.md)（v3）、[Harness 7 层现状调研](../research/agent/AigcForge-Harness-7层现状深度调研.md)、[Harness 7 层加固计划](../plan/harness-7-layer-hardening.md)（波次 1a/1b 已完成）、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.1 Session V2
> 最后更新：2026-08-09

---

## 1. 三行摘要

- **做什么**：为 AigcForge 智能体运行时补齐防幻觉的检测-纠正-验证闭环：引用完整性校验（悬空检测）+ 验证执行器（typecheck 机械化门）+ 临时记忆钩子（纠正持久化，存正确不存错误）+ 反向引用注入 + PGE 动态路由。
- **为谁做**：所有使用 AigcForge 进行代码修改的用户，尤其是长会话、跨模块重构等 compaction 后模型容易遗忘纠正的场景。
- **为什么现在做**：doom_loop（波次 1a）+ Memory（波次 1b）已合入 main，lifecycle-hooks 与 ToolFailure 通道已就绪；检测器地基 4/5 已铺好，唯一缺的是验证执行器本体与纠正持久化层。

## 2. 问题与定位

当前 AigcForge 的防幻觉能力存在三个缺口：

1. **无机械化验证闭环**：模型修改代码后无自动 typecheck/test 验证，状态误判类幻觉（声称已改但实际没改）无法被机械检测。
2. **无引用完整性校验**：模型引用不存在的文件/符号时无机械校验，悬空引用类幻觉只能靠用户发现。
3. **检测结果易失**：即使检测到错误，错误消息是一次性的（augment 到工具结果），compaction 后可能丢失，模型在后续轮次中可能重犯同一错误。

调研结论（§0 摘要）：防幻觉不靠"图"本身，靠"可机械校验的边"；幻觉发现必须依赖外部机械信号源；幻觉自救 = 负向观察上下文闭环 + 纠正持久化。

## 3. 架构前提

| 决策 | 当前状态 | 本 PRD 处理 |
|---|---|---|
| doom_loop V2 检测器 | ✅ 已合入 main | 复用其 Service + Layer + runner settleTool 集成模式 |
| Memory 服务（meta_agent_memory） | ✅ 已合入 main | 跨会话持久记忆，与本 PRD 的 session-scoped 纠正库互补 |
| SystemContext 管道 | ✅ 已就绪 | 纠正库注入走 update 通道（不破坏前缀缓存） |
| lifecycle-hooks | ✅ 已注册 | 插件扩展点，内置验证不挂此处（PostToolUseHook 返回 void） |
| PermissionV2 审批网络 | ✅ 已运行 | HITL 防线已有，不新建通道 |
| judge 仲裁（judgeMerge） | ✅ 已有 | PGE L1 路由复用 |
| task 委派（delegateJudge） | ✅ 已有 | PGE L2 路由复用 |

## 4. 目标与非目标

### 4.1 目标

- 模型编辑文件后，自动检测悬空引用（markdown 链接 + import 路径），错误一次性 augment 到工具结果。
- 模型编辑代码后（code_modification 意图），自动跑受影响包 typecheck，失败经散文映射表（含 AGENTS.md 条款引用）augment 到工具结果。
- 检测到的纠正持久化到 session-scoped CorrectionStore，后续每轮注入"Verified facts"（只含正确方向，不含错误历史），走 SystemContext update 通道不破坏前缀缓存。
- 模型重复已纠正的错误模式时，advisory 提醒正确方向（不 blocking，工具照常执行）。
- 用户在对话中纠正模型时，自动提取纠正内容（模式匹配 + 白名单），敏感内容拒绝存储。
- compaction 后纠正不丢失（合并进新 baseline）。
- codegraph MCP 可用时，opt-in 注入反向引用（防"孤立发明"）。
- 验证失败连续 N 次后，opt-in 升级到 judge/PGE 多模型仲裁。

### 4.2 非目标

- ❌ 不做沙箱隔离（第 1 层，刻意取舍）
- ❌ 不新建第二工具执行入口（tool/AGENTS.md 约束）
- ❌ 不新建 HITL 通道（复用 PermissionV2）
- ❌ 不做知识图谱/双向链接数据库（编程 Harness 不适用）
- ❌ 不做解码级/训练级幻觉检测（模型侧责任）
- ❌ 不做 L4 模型主动记录工具（暂不实施）
- ❌ 不做跨会话纠正共享（session-scoped only）
- ❌ 不用 LLM 做纠正提取或脱敏

## 5. 用户故事

### 5.1 悬空引用检测

模型在编辑文档时添加了 `[配置说明](docs/config.md)` 链接，但 `docs/config.md` 不存在。引用校验器在工具结果中追加 `⚠️ [引用校验] 文件 docs/config.md 中引用了 docs/config.md，但该文件不存在。` 模型在下一轮看到并修正链接。

### 5.2 验证执行器拦截类型错误

模型修改了 `packages/core/src/session/runner/llm.ts`，引入了类型错误。验证执行器自动运行 `bun --cwd packages/core typecheck`，失败后在工具结果中追加 `⚠️ [验证失败] 违反 AGENTS.md §Style Guide: Avoid the `any` type. 错误: Type 'string' is not assignable to type 'number'. 修正指引: 检查类型定义是否匹配。` 模型在下一轮看到并修正。

### 5.3 纠正持久化防重犯

模型在 turn 5 被纠正"import 路径是 ./bar 不是 ./foo"。turn 20 compaction 后，模型忘记了纠正，再次 import ./foo。CorrectionStore 的 advisory 拦截返回 `ℹ️ [纠正提醒] 此路径已纠正，正确值是 ./bar。如确需使用旧值请忽略此提醒。` 模型调整为 ./bar。

### 5.4 用户纠正自动提取

用户说"不对，这个函数是 async 的，返回 Promise\<string\> 不是 string"。CorrectionExtractor 在 admit 路径提取纠正 `{ wrong: "string", correct: "Promise<string>", source: "user-correction" }`，存入 CorrectionStore。后续每轮注入 "Verified facts:\n- function foo returns Promise\<string\>"。

### 5.5 敏感内容拒绝

用户说"不对，API key 是 sk-abc123..."。CorrectionExtractor 检测到 `sk-` 模式，拒绝存储该纠正。错误仍出现在工具结果中（一次性），但不持久化到 CorrectionStore（不进入 SystemContext/LLM 请求）。

## 6. 产品核心流程

### 6.1 检测-纠正-验证闭环

```
用户消息 -> admit -> [correctionExtractor 提取用户纠正]
  -> runner turn 开始 -> SystemContext 加载（含 Verified facts）
  -> LLM 推理 -> 工具调用
  -> settleTool:
     [correctionStore.check (advisory 拦截)]
     -> doomLoop.check (blocking)
     -> materialization.settle (执行)
     -> referenceChecker.check (后置校验)
     -> verifier.verify (后置验证，仅 code_modification)
     -> [augment result.value + 写入 CorrectionStore]
  -> 模型在下一轮看到 warning + Verified facts
```

### 6.2 纠正生命周期

```
写入（检测器/用户纠正） -> TTL 计数 -> 拦截参与（10 轮内/L2 永久）
  -> 注入参与（直到 FIFO 驱逐） -> compaction 后合并进 baseline
```

## 7. 数据与接口契约

### 7.1 CorrectionEntry

```ts
interface CorrectionEntry {
  key: string           // "function:foo:signature" / "import:module-X"
  correct: string       // 正确值（注入用）
  wrong?: string        // 错误值（拦截匹配用，可空）
  source: "reference-checker" | "verifier" | "user-correction" | "permission-corrected"
  extractLayer: 1 | 2 | 3  // 提取层级
  turnCreated: number   // TTL 计算用
  confirmed?: boolean   // 验证成功标记
}
```

### 7.2 配置 schema

```jsonc
{
  "meta": {
    "memory": { "enabled": false, "top_n": 10 },
    "doom_loop": { "enabled": true, "threshold": 3 },
    "correction_store": { "enabled": true, "max_entries": 20 },
    "reference_check": { "enabled": true, "timeout_ms": 5000 },
    "verifier": {
      "enabled": true,
      "timeout_ms": 60000,
      "max_consecutive_failures": 2,
      "escalation_enabled": false,
      "escalation_threshold": 2
    },
    "reverse_refs": { "enabled": false }
  }
}
```

### 7.3 EventV2 新事件

| 事件类型 | 触发 | 数据 |
|---|---|---|
| `session.next.verify.started` | 验证执行器开始 | sessionID, package, command |
| `session.next.verify.passed` | typecheck 通过 | sessionID, package, duration |
| `session.next.verify.failed` | typecheck 失败 | sessionID, package, errorSummary, proseMessage |

### 7.4 敏感模式黑名单

```
sk-[a-zA-Z0-9]{20,}          # OpenAI API key
AKIA[A-Z0-9]{16}              # AWS access key
Bearer\s+[a-zA-Z0-9._-]+      # Bearer token
eyJ[a-zA-Z0-9._-]+\.          # JWT token
password\s*[=:]               # Password
secret\s*[=:]                 # Secret
token\s*[=:]                  # Token
api[_-]?key\s*[=:]            # API key
```

## 8. 安全边界与权限授权

| 边界 | 规则 |
|---|---|
| **敏感内容** | 白名单提取（只存技术模式）+ 黑名单拒绝（API key/token/password）+ L3 脱敏（原文扫描）+ 不用 LLM 脱敏 |
| **拦截力度** | advisory 不 blocking（不阻止工具执行，只追加 warning） |
| **TTL** | L1 检测器 10 轮后退出拦截；L2 用户纠正不过期；L3 原文 5 轮后移除 |
| **容量** | FIFO 20 条/session |
| **会话范围** | Location-scoped + SessionID 键控，父子会话不共享 |
| **缓存** | 正常轮次零影响（走 update 通道）；compaction 后随 compaction break |
| **Clean Logs** | 纠正库内容不包含敏感值（机械扫描在写入前完成） |

## 9. 智能体边界

| 机制 | 所有智能体 | 仅元智能体 |
|---|---|---|
| CorrectionStore（记录/拦截/注入） | ✅ | - |
| 引用校验器 | ✅ | - |
| 验证执行器 | ✅ | - |
| 反向引用注入 | ✅ | - |
| PGE L0 机械验证 | ✅ | - |
| PGE L1 judgeMerge | - | ✅ |
| PGE L2 delegateJudge | - | ✅ |

## 10. 里程碑与演进规划

| 阶段 | 内容 | 预估 | 依赖 |
|---|---|---|---|
| 0 | CorrectionStore Service + 用户纠正提取 + 敏感安全 | 3-4 天 | 无 |
| A | 引用完整性校验器 | 2-3 天 | 阶段 0 |
| B | 验证执行器 + 散文报错 | 5-8 天 | 阶段 0 |
| C | 反向引用注入 | 3-4 天 | 无（可与 A/B 并行） |
| D | PGE 动态路由 | 4-6 天 | 阶段 B |

详细实施见 [实施计划 v3](../plan/anti-hallucination-implementation.md)。

## 11. 成功指标与埋点

| 指标 | 测量方式 | 目标 |
|---|---|---|
| 悬空引用检测率 | 引用校验器触发的次数 / 工具调用次数 | 覆盖所有 edit/write/apply_patch/bash 调用 |
| typecheck 拦截率 | verify.failed 事件 / code_modification turns | 及时发现类型错误 |
| 纠正重犯率 | advisory 拦截触发次数 / 纠正总数 | 趋势下降（模型逐步内化纠正） |
| compaction 后纠正存活率 | compaction 后 baseline 含纠正条目数 / compaction 前总数 | 100%（设计保证） |
| 敏感内容泄漏 | CorrectionStore 中黑名单命中次数 | 0（拒绝存储） |
| 前缀缓存命中率 | CacheShape 诊断（correction_store enabled vs disabled） | 无差异（设计保证） |

## 12. 灰度、回滚与监控

- **灰度**：所有机制默认 enabled（除 reverse_refs 和 escalation_enabled 默认 false）。可通过 config 逐项关闭。
- **回滚**：每项机制独立 config 开关，关闭后零影响（CorrectionStore 不注入、引用校验跳过、验证执行器跳过）。
- **监控**：EventV2 verify.* 事件 + CacheShape 诊断 + CorrectionStore 容量日志。

## 13. 验收与测试

- 引用校验器：`it.live` + tmpdir 真实文件结构
- 验证执行器：`it.live` + 真实子进程 typecheck
- CorrectionStore：`it.effect`（纯逻辑）+ `it.live`（SystemContext 注入）
- correction-extractor：`it.effect` 表驱动（输入文本 × 期望提取结果）
- 敏感模式拒绝：`it.effect`（黑名单输入 -> 拒绝存储）
- advisory 拦截：`it.effect`（匹配 wrong -> 返回 warning，不 blocking）
- 缓存影响：`it.live`（enabled=false 时 CacheShape 前缀哈希不变）
- 禁 `Effect.sleep(N)`、禁 `as any`、禁 `@ts-ignore`
- 详细测试规范见实施计划 §5

## 14. 开放问题与应对

| 问题 | 当前决策 | 触发重新评估的条件 |
|---|---|---|
| L4 模型主动记录工具是否需要 | 暂不实施 | 用户反馈纠正覆盖率不足（L1-L3 覆盖率 < 70%） |
| 跨会话纠正共享 | 不做 | 委派场景中子会话重复父会话错误成为高频问题 |
| 散文映射表覆盖范围 | 静态映射表（3 条初始） | 未匹配率 > 30% 时扩展 |
| advisory 拦截是否升级为 blocking | advisory | 模型忽略 advisory 且重犯率 > 50% 时考虑 |
| 纠正条目数上限 20 是否足够 | 20 条 FIFO | 长会话中纠正驱逐率 > 20% 时调整 |

## 15. 批准 Gate

| Gate | 条件 | 状态 |
|---|---|---|
| G0 理论源 | 调研文档 §0-§9 定案 | ✅ |
| G1 前置计划 | 波次 1a/1b 已合入 main | ✅ |
| G2 复用确认 | 全部复用现有 Service/Layer/管道 | ✅ |
| G3 智能体边界 | 阶段 0/A/B/C 全智能体，D 元智能体 | ✅ |
| G4 安全边界 | 白名单+黑名单+L3 脱敏+不用 LLM 脱敏 | ✅ |
| G5 缓存影响 | 正常轮次零影响，compaction 随 break | ✅ |
