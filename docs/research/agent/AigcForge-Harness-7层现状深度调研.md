# AigcForge Agent Harness 7 层现状深度调研

> **类型**：项目现状调研（对照行业标准）
> **对照基准**：`docs/research/industry/Agent Harness 7层核心功能具象化与问题解决机制深度调研.md`
> **调研日期**：2026-08-09
> **覆盖范围**：`packages/core/src`、`packages/aigcfroge/src` 中与智能体运行时相关的全部代码

---

## 0. 摘要

本文档以 Agent Harness 七层架构为基准，逐层审计 AigcForge 现有实现，给出"已实现 / 部分实现 / 缺失"三级判定、关键代码定位与落地建议。核心结论：

| 层 | 判定 | 一句话结论 |
|---|---|---|
| 1 执行环境沙箱 | ❌ 缺失 | 无隔离沙箱（刻意取舍），但有 4 道软性进程防护；V1 的 tree-sitter 命令解析器未移植 V2 |
| 2 工具接口与协议 | ✅ 强 | MCP / ACP / Skills 渐进加载 / 意图工具过滤 / Pass-by-Reference 均已实现 |
| 3 上下文与记忆 | ⚠️ 中强 | 三级水位压缩 + 锚定摘要 + Head&Tail 已实现；缺跨会话持久记忆 |
| 4 生命周期与编排 | ✅ 强 | 串行化协调器 + 三种委派模式 + 后台任务全部就绪；缺物理写盘执行计划 |
| 5 可观测性 | ⚠️ 中 | 事件流 + 缓存诊断 + OTLP 已实现；缺 span 归因链与跨会话成本聚合 |
| 6 验证与评估 | ⚠️ 弱 | 仅多模型仲裁；无机械化验证闭环、无语义化散文报错、无完成断言 |
| 7 治理与安全 | ✅ 强 | PermissionV2 审批网络完整 + 子会话降级 + 跨进程权限桥；缺命令语义分级与 V2 doom_loop |

---

## 1. 执行环境沙箱层 —— ❌ 缺失

### 现状

无容器 / MicroVM / gVisor 隔离。命令以宿主用户权限运行（`packages/core/src/tool/bash.ts:116` 明示 "host user's filesystem, process, and network authority"）。

现有防护仅 4 道，均为**软性**：

1. **cwd 锁定**：外部 `workdir` 触发 `permission.assert`（external_directory 规则）拦截
2. **命令参数路径警告**：对命令行中的绝对路径做 advisory 级提示（`bash.ts:92-102`，注释明示 "this scan is advisory only"，非阻断）
3. **超时与进程组清理**：默认 120s / 上限 600s + `forceKillAfter: 3s`（`AppProcess.run`）
4. **输出上限**：1MB 内存截断（`MAX_CAPTURE_BYTES`）

### 关键发现

`bash.ts:77-88` 的 TODO 清单暴露 9 项 V1 未移植能力，其中最关键的是 **tree-sitter bash 解析器**（V1 存在，可精确解析高危命令）——它是"命令语义分级"（read-only / workspace-write / full-access）的前置条件。

### 判定与建议

- 沙箱对桌面本地产品是**刻意取舍**（成本/收益不匹配，全权限兜底是产品设计），不立项
- 但 tree-sitter 命令解析器是**低成本高收益**缺口：它是第 7 层"高危命令语义分级"的前提，建议随第 7 层工作一并移植

---

## 2. 工具接口与协议层 —— ✅ 强

### 已实现

| 能力 | 实现位置 | 说明 |
|---|---|---|
| MCP 客户端 | `packages/core/src/mcp/` | JSON-RPC 动态发现/调用 |
| ACP 客户端 | `packages/core/src/acp-client/` + `tool/claude-code-acp.ts` / `codex-acp.ts` | claude-code/codex 的 ACP 传输桥（PATH 存在时启用） |
| Skills 渐进式加载 | `packages/core/src/skill/` + `.aigcfroge/skills/` | 仅注入名称+描述，触发时加载完整指令 |
| 意图驱动工具过滤 | `packages/core/src/tool/registry.ts:18-42` | Phase 4：按 IntentCategory 过滤工具定义（readonly/write/config 集） |
| Pass-by-Reference | `packages/core/src/tool-output-store.ts` | 大输出落盘 + Head&Tail 预览 + 指针 marker + 7 天保留（详见第 3 层） |
| 三种 CLI 传输 | `tool/cli-adapter.ts` | jsonl（spawn+parse）/ sdk / acp |

### 差距

- MCP 工具定义仍全量 materialize（意图过滤是名称级，非定义级按需加载）
- 无 NOOA 式"内存原生对象指针"（当前是文件落盘 + 文本预览，等效但非对象引用）

---

## 3. 上下文与记忆管理层 —— ⚠️ 中强

### 已实现

| 机制 | 实现位置 | 说明 |
|---|---|---|
| 预算感知压缩 | `session/compaction.ts:240-286` | 三级水位：0.5 软警告 / 0.6 压缩 / 0.8 硬触发；溢出恢复双通道（`compactAfterOverflow`） |
| 锚定摘要 | `compaction.ts:21-56, 171-178` | 7 段结构化模板（Goal / Constraints / Progress / Decisions / Next / Critical / Relevant Files）+ previous-summary 增量更新 |
| 卡死防护 | `compaction.ts:184-185, 276-283` | 连续 2 次压缩自动暂停自动压缩（compactStuck） |
| Head&Tail 截断 | `tool-output-store.ts:73-103` | 2000 行 / 50KB 预览 + 完整落盘 `tool-output/` + `... truncated; full content saved to <path> ...` marker |
| 上下文纪元 | `session/context-epoch.ts` | SystemContext 快照持久化 + reconcile/replace + baseline_seq 与事件流对齐 |
| 工具输出序列化 | `compaction.ts:89-122` | 单条工具输出 2000 字符截断（`TOOL_OUTPUT_MAX_CHARS`） |

### 缺失

1. **跨会话持久记忆（Memory）为零**——compaction 摘要在会话内复用后即弃，无沉淀机制。关键发现：`SUMMARY_TEMPLATE` 的 7 段结构**天然就是 Memory 的结构**，Windsurf 式 Memory 表可直接复用此模板，无需新造格式
2. 无语义检索注入——`select()`（compaction.ts:138-169）的 head/recent 划分仅服务摘要生成，没有按相关性检索注入的机制

### 落地建议（P0）

Memory 服务可基于三个已有组件零成本起步：compaction 的 7 段摘要模板（格式）+ ToolOutputStore（落盘机制）+ EventV2（seq 事实源）。

---

## 4. 生命周期与编排层 —— ✅ 强

### 已实现

| 能力 | 实现位置 | 说明 |
|---|---|---|
| 统一外层循环 | `session/runner/llm.ts:183-359`（runTurnAttempt） | 每 turn：产品模式×Agent 策略校验 → SystemContext 装载 → 意图工具物化 → 缓存诊断 → compaction 检查 → 流式 settle |
| 会话串行化协调器 | `session/run-coordinator.ts` | 每 Session 串行 + wake 合并 + interrupt，不同 Session 并发 |
| 子会话编排 | `tool/task-driver.ts` + `task-driver-fill.ts` | 前台 delegate / 后台 delegateBackground / 多模型 delegateJudge / 外部 CLI executeCLI / 恢复 extendBackground |
| 后台任务隔离 | `background-job.ts` | 子 drain 跑独立纤维（规避单连接 SQLite 死锁，task-driver.ts:26-44） |
| 委派上下文压缩 | `task-driver.ts:357-367` | P6.1：便宜 LLM 将父上下文压成 200-500 token 摘要注入子会话 |
| 步骤持久化 | `meta-agent/service.ts` + `sql.ts` | meta_agent / meta_agent_session（role）/ meta_agent_step（状态机） |
| 三种委派模式 | `tool/task.ts:60-71` | subagent / external-cli / judge + 双轨 todo 联动 |
| 外部 CLI 会话恢复 | `tool/cli-session.sql.ts` | resume hint 持久化（按父 Session 键控） |

### 差距

- **物理写盘执行计划与断点恢复**缺失：当前步骤记录在 DB（meta_agent_step），但无 `docs/plan/exec/active/*.md` 形式的可版本化执行计划与 tech-debt 追踪
- 无 1-Minute Build Limit 反馈环概念（与第 6 层联动）

### 落地建议（P2）

执行计划写盘只需在 `meta_agent_step` + `docs/plan/` 之上加物理文件层，与现有事件流/步骤表天然互补。

---

## 5. 可观测性层 —— ⚠️ 中

### 已实现

| 能力 | 实现位置 | 说明 |
|---|---|---|
| 事件流事实源 | `packages/core/src/event/` + `session/event.ts` | append-only 事件流（约 40 种事件，SQLite + 单调 seq），全系统持久化事实源 |
| 缓存诊断 | `session/cache-diagnostics.ts` | 每步 cache read/write + hit rate + 置信度分级（high/estimated/unavailable） |
| CacheShape 追踪 | `runner/llm.ts:247-281` | 前缀哈希对比 + 变更原因 + 会话累计诊断事件 |
| OTLP | `observability/otlp.ts` | opt-in（`OTEL_EXPORTER_OTLP_ENDPOINT`），logs + traces（BatchSpanProcessor + AsyncLocalStorageContextManager） |
| 步骤级持久化 | `meta_agent_step` | 委派步骤的 DB 记录 |

### 缺失

1. **无 span 归因链**：工具执行、模型调用、子会话 drain 之间无 trace 关联（`Effect.withSpan` 仅 ContextEpoch 使用 2 处）。"高层失败归因到具体工具调用"不可达
2. **meta_agent_step 孤岛**：只记录 subagent/external-cli 步骤，无 token 成本、无结果摘要入表（updateStep 只写 status/result）、无 trace 连接
3. **无跨会话成本聚合**：`Step.Ended` 事件已带 token 明细，但 MetaAgentService.stats 只算 sessions 总数

### 落地建议（P2）

可观测性缺的是「语义」而非「管道」——在现有事件流上补 span 关联与成本聚合视图即可。

---

## 6. 验证与评估层 —— ⚠️ 弱（最大空白）

### 现状

| 能力 | 实现位置 | 说明 |
|---|---|---|
| 多模型仲裁 | `agent/judge.ts` | judgeMerge：N 模型跑同一任务 → Judge LLM 合并（4 级 fallback，工程成熟） |
| 错误反馈通道 | `tool/registry.ts:110-112` | ToolFailure → 捕获 → `result.error`，模型看到**错误消息原文**，无散文化 |
| 生命周期钩子 | `tool/lifecycle-hooks.ts` | preToolUse（可阻断：现用于 policy 拦截）+ postToolUse（观察型）——**验证闭环的现成挂载点，尚无任何测试/typecheck 钩子注册** |
| bash 反馈 | `tool/bash.ts:62-68` | `compactOutput` 拼接 stdout/stderr + "Command exited with code N"——机械式 |

### 缺失（3 项全部为空白）

1. **机械化验证闭环**（Act-Observe-Verify-Adjust）：无"代码修改后自动跑 typecheck/test"机制；无 1-Minute Build Limit 反馈环
2. **语义化散文报错**：错误是原样文本，无"违反哪条架构原则 + 如何修复"指引
3. **完成断言拦截**：无"模型声称完成 → 跑断言 → 失败则拦截退出信号"的 Ralph 式续航机制

### 落地建议（P1）

挂载点已明确：`lifecycle-hooks`（pre/post tool use）+ `ToolFailure` 通道 + 现有 `task` 重试语义三者铺好地基，仅缺"验证执行器"本体（跑测试/typecheck 并产出散文报错）。

---

## 7. 治理与安全层 —— ✅ 强（HITL 审批网已建，缺语义分级）

### 已实现

| 能力 | 实现位置 | 说明 |
|---|---|---|
| 三级审批网络 | `packages/core/src/permission.ts` | ask 挂起（pending map + Deferred）→ `permission.v2.asked` 事件 → UI 审批 dock → once/always/reject 回复 |
| 审批记忆化 | `permission.ts:296-301` + `permission/saved.ts` | `always` 写 PermissionSaved 表（项目级），后续同操作自动放行 |
| 反馈注入 | `permission.ts:278-281` | 拒绝带 `CorrectedError.feedback`（可注入模型纠偏） |
| 拒绝级联 | `permission.ts:283-292` | reject 同 Session 全部 pending 请求一并拒绝 |
| 子会话降级 | `permission.ts:181-183` | 未出席子会话 ask→deny 自动拒绝（防挂死） |
| 跨进程权限桥 | `task-driver-fill.ts:263-277` | 外部 CLI 的 canUseTool 回调走父 Session 权限规则 |
| doom_loop | V1：`aigcfroge/src/session/processor.ts:539` | 连续 DOOM_LOOP_THRESHOLD 次相同工具调用触发审批 |

### 缺失

1. **高危命令语义分级**：审批粒度是"整条命令字符串"（bash assert 的 resource 是 `input.command` 全文），无 `rm -rf` / `git push --force` 级别的动作分类——导致审批疲劳（每条都 ask）或漏网（整串全 allow）
2. **V2 doom_loop 检测器缺失**：V2 权限默认含 `doom_loop: ask`（`plugin/agent.ts` defaults），但 V2 runner 中未发现对应检测实现——疑似功能缺口
3. policy.ts 仅用于 `provider.use`（catalog.ts:19），与工具执行无关

### 落地建议

- P0：V2 doom_loop 检测器移植（V1 processor.ts 有实现，成本低）
- P1：命令语义分级 + 高危 HITL（前置依赖：tree-sitter 解析器移植）

---

## 8. 关键交叉发现

1. **V1 资产与 V2 平台断层**：tree-sitter 命令解析器、doom_loop 检测、V1 processor 的审批流都在 V1；V2 runner 是统一循环但没有这些能力——**HITL 门禁的最大成本在"把 V1 的解析能力移植到 V2"**
2. **Memory 可零成本起步**：compaction 的 7 段摘要模板 + ToolOutputStore 的落盘机制 + EventV2 的 seq 事实源，三个已有组件可直接组装为 Memory 服务
3. **验证闭环的地基**：lifecycle-hooks + ToolFailure + judge 模式 + task 重试 = 验证闭环 4/5 已就绪，唯一缺的是"验证执行器"
4. **可观测性缺的是「语义」而非「管道」**：OTLP/事件流/诊断都已存在，缺的是 span 关联和成本聚合视图

## 9. 落地优先级总表

| 优先级 | 项目 | 复用基础 | 预估成本 |
|---|---|---|---|
| P0 | V2 doom_loop 检测器移植 | V1 processor.ts 实现 | 低 |
| P0 | Memory 服务（compaction 模板复用） | compaction.ts + EventV2 | 中 |
| P1 | 命令语义分级 + 高危 HITL | 需移植 tree-sitter 解析器 | 中 |
| P1 | 验证执行器 + 散文报错 | lifecycle-hooks + ToolFailure | 中 |
| P2 | 执行计划写盘 | meta_agent_step + docs/plan | 中 |
| P2 | span 关联 + 成本聚合 | EventV2 + OTLP | 低-中 |

> ⚠️ 注：上表为初版评估。经 §10 合规审计后，编排与实施方式已修正，见 §11 审计修正版。

---

## 10. 合规审计（对照协议文档与 skills）

> 审计依据：`CLAUDE.md`（宪法）· `AGENTS.md`（根）· `ARCHITECTURE.md` · `CONTEXT.md` · `packages/core/src/tool/AGENTS.md` · `.aigcfroge/skills/{protocols,database,effect}/SKILL.md` · 行业基准（research/industry 三份）

### 10.1 优点（合规亮点）

| # | 原总结内容 | 对应协议条款 | 评价 |
|---|---|---|---|
| 1 | Memory 复用 compaction 模板、验证闭环复用 lifecycle-hooks、执行计划复用 meta_agent_step | 宪法"以创造接口为耻，以复用现有为荣" | ✅ 复用优先级正确 |
| 2 | 识别"V1/V2 断层"为 3 项差距的共享根因 | 宪法"根因收敛三步法"（归类→找交集→一击必杀） | ✅ 收敛正确 |
| 3 | 命令语义分级后置并声明"现有 ask 网已可用" | 宪法"方案对冲：选简单实现须显式声明" | ✅ 权衡显式化 |
| 4 | 验证执行器定位为"缺本体，地基已 4/5" | `packages/core/src/tool/AGENTS.md`"不新增第二执行入口" | ✅ 未建议新造引擎 |
| 5 | doom_loop 判定"移植不是复制，适配新循环" | 宪法"以盲目修改为耻，谨慎重构" | ✅ 未建议照搬 V1 事件驱动 |

### 10.2 缺点（不合规 / 不完善）——按严重度排序

**D1. 「语义化摘要器公共底座」违背极致减法（严重）**

宪法修复优先级：**复用 → 删除 → 归并 → 重构 → 新增**。原总结建议"波次 1 就抽象 `SemanticSummarizer` 公共组件"——提前新增抽象，违反优先级且违反行业"三之法则"（Rule of Three）。compaction 的 `buildPrompt`/`serialize` 已存在，Memory 应**直接复用 compaction 组件**；验证闭环、执行计划各自先用现成摘要，第三处需求出现时再归并提取。

**D2. Memory 注入机制与 L1/L2/L3 缓存架构冲突未解决（严重）**

原总结仅说"注入 L2/L3 区"，未落到机制。CONTEXT.md / Context Epoch（`baseline_seq` 对齐）表明系统上下文是**持久化快照 + reconcile** 的——Memory 若走 `meta-prompt.ts` 的 fill 替换（每次会话检索结果不同），会**破坏跨会话提示词前缀缓存**（`promptCacheKey` 是 session id 哈希）。正确路径是走 **SystemContext 机制**（快照 + baseline_seq），或会话开始时一次性检索注入（L2 区），且默认关闭。

**D3. 执行计划写盘的存放语义未拍板（git 资产 vs 运行产物）（中等）**

`docs/plan/` 是知识资产（git 版本控制），而执行计划是**高频读写运行产物**。Codex 做法（docs/exec-plans 入 git）与 `.aigcfroge/plans`（已 gitignore 的运行时产物）是两种语义。宪法要求方案对冲显式声明——原总结未做。**需拍板**：入 git（版本控制 + 断点恢复，Codex 风格，需约定提交时机防噪音）还是本地运行时目录（`.aigcfroge/` 风格）。

**D4. 验证执行器"跑测试"与测试门禁冲突未识别（中等）**

AGENTS.md 明确："Tests cannot run from repo root"、"run from package dirs like `packages/<name>`"。验证执行器要在 agent 循环里自动跑 typecheck/test，必须**解析包路径**（monorepo 上下文），否则触发 guard 拒绝。验证执行器设计必须含"Location → 包路径解析"逻辑。

**D5. doom_loop 移植未落到 PermissionV2 接缝（中等）**

V1 走 `permission.ask({permission:"doom_loop"})`（V1 API）；V2 正确路径是 `PermissionV2.assert` → 发布 `permission.v2.asked` 事件 → 复用现有 UI 审批 dock——**复用现有审批网络，不新造 HITL 通道**（九荣九耻）。

**D6. 优先级评估缺证据、缺测试策略（轻微）**

- "3-5 天 / 5-8 天"人天估算是**猜测**（"以瞎猜为耻"）——应标注为量级估计并给出依据（V1 代码行数、新增表数）
- 每波次未配测试计划（宪法"以主动测试为荣"）：MemoryService 单测、doom_loop 检测单测、验证执行器集成测试应显式列出

**D7. 未检查 CONTEXT.md 的 Session 不变量（轻微）**

AGENTS.md V2 Session Core 不变量（如 "Keep EventV2 replay owner claims separate"、"Keep SessionExecution process-global and Session-ID based"）对执行计划写盘、Memory 写入是硬约束，未逐条核对。执行计划/Memory 设计文档需附"不变量核对清单"。

---

## 11. 审计修正版（编排与实施方式）

| 波次 | 项目 | 修正点 |
|---|---|---|
| 波次 1 | V2 doom_loop 移植（1-2 天*） | 走 PermissionV2 审批网络（action: doom_loop）；带检测单测 |
| 波次 1 | Memory 服务（3-5 天*） | **复用 compaction 摘要组件**（不抽象新底座）；注入走 SystemContext 管道；含 DB 迁移（database skill：snake_case + migration/*.ts）；默认关闭开关；带 MemoryService 单测 |
| 波次 2 | 验证执行器 + 散文报错（5-8 天*） | 含"Location → 包路径解析"（monorepo 测试门禁）；挂 lifecycle-hooks；带集成测试 |
| 波次 3 | 执行计划写盘（3-5 天*） | 先拍板"入 git vs 本地产物"；核对 CONTEXT 不变量清单 |
| 波次 4 | 命令语义分级 + 高危 HITL | 不变（依赖 tree-sitter 移植） |
| 波次 4 | span 关联 + 成本聚合 | 不变（内部工程债） |

\* 人天为**量级估计**（非承诺排期），依据：V1 对应实现行数 / 新增表与迁移数 / 挂载点就绪度。

### 修正后的关键决策清单

1. ~~抽象 `SemanticSummarizer` 公共底座~~ → **复用 compaction 摘要组件**，第三处需求出现时再归并
2. Memory 注入 → **SystemContext / SessionContextEpoch 管道**（快照 + baseline_seq），非 prompt 模板替换
3. 执行计划存放 → **待拍板**：git 版本控制（Codex 风格）vs `.aigcfroge/plans` 运行时风格
4. doom_loop → **复用 PermissionV2 审批网络**，不新造 HITL 通道
5. 验证执行器 → **必须解析包路径**（`packages/<name>`），遵守 do-not-run-tests-from-root 门禁

---

## 参考

- 行业基准：`docs/research/industry/Agent Harness 7层核心功能具象化与问题解决机制深度调研.md`
- 协议演进：`docs/research/industry/AI智能体协议研究.md`
- 方法论：`docs/research/industry/第一性原理与智能体.md`
- 实施计划：`docs/plan/meta-agent-orchestrator.md`、`docs/plan/meta-agent-v2-production-closure.md`
- 架构契约：`ARCHITECTURE.md`、`AGENTS.md`、`CONTEXT.md`
- 技能规范：`.aigcfroge/skills/{protocols,database,effect}/SKILL.md`
