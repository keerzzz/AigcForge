# Harness 7 层加固实施计划：doom_loop V2 化 · Memory 服务 · 验证闭环 · 执行计划

> 状态：**DRAFT**（待审批）
> 日期：2026-08-09
> Owner：Core（主）+ App（次）
> 范围：`packages/core` + `packages/aigcfroge`（提示词/权限）+ `packages/app`（仅波次 4 可选）
> 关联：[Harness 7 层现状调研](../research/agent/AigcForge-Harness-7层现状深度调研.md)（范围真源，§10 合规审计后修正版 §11 为编排依据）、[Agent Harness 行业基准](../research/industry/Agent Harness 7层核心功能具象化与问题解决机制深度调研.md)、[AI 协议白皮书](../research/industry/AI智能体协议研究.md)、[Meta-Agent 实施计划](meta-agent-orchestrator.md)（已合入，本计划前置）
> 分支：**harness-hardening**（从最新 main 切出；连字符分隔无前缀，符合 AGENTS.md Branch 规范）
> 最后更新：2026-08-09

---

## 0. 审批状态与执行 Gate

| Gate | 条件 | 状态 | 阻塞范围 |
|---|---|---|---|
| **G0 范围真源** | Harness 7 层现状调研 Approved（§9-§11）；本计划是对其修正版的直接实施 | ✅ 调研已完成 | 全部波次 |
| **G1 合规审计** | §10 审计 7 项缺点（D1-D7）已收敛进本计划 §3 设计决策 | ✅ 已收敛 | 全部波次 |
| **G2 复用确认** | Memory 复用 compaction 摘要组件（不抽象新底座）；doom_loop 复用 PermissionV2 审批网络；验证闭环复用 lifecycle-hooks | ✅ 已确认 | 波次 1-2 |
| **G3 待拍板** | 执行计划存放语义：入 git（Codex 风格）vs 本地运行时目录 | ⚠️ **待审批**（本计划默认：入 git） | 波次 3 |
| **G4 依赖就绪** | V1 doom_loop（processor.ts:35,522-539）与 V1 tree-sitter 解析器可移植；compaction（compaction.ts:171-178）可用；lifecycle-hooks（lifecycle-hooks.ts）已注册 | ✅ 已确认 | 全部波次 |

---

## 1. 目标、非目标与收敛

### 1.1 目标

按调研修正版四波次，将 Harness 7 层中「缺失/偏弱」的 4 大项补齐到可生产状态：

1. **波次 1a · V2 doom_loop 检测器**：把 V1 的重复工具调用检测（连续 3 次相同调用触发审批）移植到 V2 runner，接入 PermissionV2 审批网络（复用 `permission.v2.asked` 事件 + 现有审批 dock），并补 V2 defaults 缺失的 `doom_loop: ask` 规则
2. **波次 1b · Memory 服务**：数据库持久化的跨会话记忆（`meta_agent_memory` 表 + `MemoryService` + `memory_record`/`memory_search` 工具），**复用 compaction 摘要组件**做提炼（不抽象新底座），注入走 SystemContext 管道（不破坏 L1/L2/L3 缓存），默认关闭
3. **波次 2 · 验证执行器 + 散文报错**：在 lifecycle-hooks 挂验证执行器（typecheck/test 机械化闭环），含 monorepo 包路径解析（遵守 do-not-run-tests-from-root 门禁），错误经 ToolFailure 通道散文化
4. **波次 3 · 执行计划写盘**：`docs/plan/exec/active|completed` 物理执行计划 + 断点恢复（默认入 git，Codex 风格）

### 1.2 非目标

- ❌ 不做沙箱隔离（第 1 层，刻意取舍，调研 §1 结论）
- ❌ 不抽象 `SemanticSummarizer` 公共底座（审计 D1：复用 compaction，第三处需求出现再归并）
- ❌ 不新建第二工具执行入口（tool/AGENTS.md 约束；验证执行器挂 lifecycle-hooks，不是新工具）
- ❌ 不做命令语义分级（波次 4 之外的 tree-sitter 移植后置，依赖评估）
- ❌ 不做 span 归因全链路（波次 4 只做最低成本项）
- ❌ 不新建 HITL 通道（全部复用 PermissionV2 ask/assert 网络）
- ❌ Memory 注入**不做** prompt 模板 fill（审计 D2：走 SystemContext，防破坏前缀缓存）
- ❌ 不做 ACP/A2A 标准化（远期，非本次）

### 1.3 相对调研文档的收敛

| 调研结论 | 本计划实施收敛 |
|---|---|
| "V2 权限默认含 doom_loop: ask"（调研 §7） | **勘误**：V2 `plugin/agent.ts` defaults 实际无 doom_loop 规则（仅 V1 `aigcfroge/agent.ts:131` 有）。波次 1a 需**新增** V2 规则 + 检测器 |
| "语义化摘要器公共底座"（原总结） | 审计 D1 否决：直接复用 `compaction.ts` 的 `buildPrompt`/`serialize`/`SUMMARY_TEMPLATE` |
| Memory 注入"L2/L3 区"（原总结） | 审计 D2 修正：走 SystemContext（`system-context/index.ts` + `SessionContextEpoch`），会话初始化时装载 |
| 执行计划"docs/plan/exec"（原总结） | 审计 D3：存放语义待拍板；本计划默认**入 git**（恢复依赖 git 树检索），提交时机约定见 §3.4 |

---

## 2. 背景与当前状态

### 2.1 已就绪基座（全部复用，不新建）

| 能力 | 位置 | 状态 |
|---|---|---|
| V1 doom_loop 检测（连续 N 次相同工具调用 → ask） | `packages/aigcfroge/src/session/processor.ts:35,522-539`（`DOOM_LOOP_THRESHOLD = 3`） | ✅ 可移植参考 |
| PermissionV2 审批网络（ask 挂起 → `permission.v2.asked` 事件 → UI dock → once/always/reject） | `packages/core/src/permission.ts:237-331` | ✅ 复用，不新造 |
| V1 权限规则 `doom_loop: "ask"` | `packages/aigcfroge/src/agent/agent.ts:131` | ✅ 语义参考 |
| V2 runner 工具 settle 路径（FiberSet 并行） | `packages/core/src/session/runner/llm.ts:305-326` | ✅ 检测器挂载点 |
| V2 agent defaults 规则集 | `packages/core/src/plugin/agent.ts:228-238` | ⚠️ 需补 doom_loop 规则 |
| compaction 摘要（锚定模板 + serialize + select） | `packages/core/src/session/compaction.ts:21-56,89-178` | ✅ Memory 提炼复用源 |
| SystemContext 管道（快照 + baseline_seq + reconcile） | `packages/core/src/system-context/` + `session/context-epoch.ts` | ✅ Memory 注入通道 |
| lifecycle-hooks（pre/post tool use） | `packages/core/src/tool/lifecycle-hooks.ts` | ✅ 验证闭环挂载点 |
| ToolFailure 通道（registry 捕获 → result.error） | `packages/core/src/tool/registry.ts:110-112` | ✅ 散文报错改造点 |
| 包路径约定（do-not-run-tests-from-root） | `AGENTS.md` Testing 节 | ✅ 验证执行器约束源 |
| MetaAgentService 步骤持久化 | `packages/core/src/meta-agent/service.ts` + `sql.ts` | ✅ 执行计划关联点 |
| Drizzle 迁移体系（migration/*.ts） | `packages/core/src/database/migration/`（database skill 规范） | ✅ Memory 表落库通道 |
| EventV2 事件流（append-only + seq） | `packages/core/src/event/` | ✅ Memory 事实源 |

### 2.2 需新建/修改

| 交付物 | 位置 | 动作 |
|---|---|---|
| V2 doom_loop 检测器 | `packages/core/src/session/doom-loop.ts`（新建） | 检测逻辑 + PermissionV2 接入 |
| V2 doom_loop 权限规则 | `packages/core/src/plugin/agent.ts:228-238` | defaults 加 `{ action: "doom_loop", resource: "*", effect: "ask" }` |
| meta_agent_memory 表 | `packages/core/src/meta-agent/sql.ts` | 新增表（snake_case） |
| Memory 迁移 | `packages/core/src/database/migration/<ts>_add_meta_agent_memory.ts` | 新建（database skill 规范） |
| MemoryService | `packages/core/src/agent/meta/memory.ts`（新建） | record/query/search/remove |
| memory_record / memory_search 工具 | `packages/core/src/tool/memory.ts`（新建） | 工具注册 + 权限声明 |
| Memory 注入 | `packages/core/src/system-context/builtins.ts` | SystemContext 管道注入（默认关闭） |
| 配置开关 | `packages/core/src/config` | `meta.memory.enabled` |
| 验证执行器 | `packages/core/src/session/verifier.ts`（新建） | typecheck/test 执行 + 包路径解析 + 超时 |
| 散文报错格式化 | `packages/core/src/session/verifier.ts` 或 `tool/registry.ts` | 错误 → 散文（架构原则 + 修正指引） |
| 验证挂载 | `packages/core/src/session/runner/llm.ts` | 工具 settle 后触发验证（postToolUse 注册） |
| ExecPlanDriver | `packages/core/src/agent/meta/exec-plan-driver.ts`（新建） | create/update/complete/load |
| 执行计划目录 | `docs/plan/exec/active/` + `docs/plan/exec/completed/`（新建） | 物理文件 + git 版本控制 |

---

## 3. 设计决策（已定案，必须遵守）

### 3.1 D1 · doom_loop 走 PermissionV2 网络（审计 D5 收敛）

- 检测器是**纯检测 + 事件源**：不直接审批，检测到连续 N=3 次相同（tool name + input 指纹）调用时发布检测信号
- 审批走 `PermissionV2.assert({ action: "doom_loop", resources: [toolName] })`（权限规则 allow/ask/deny 由 agent defaults 控制，默认 ask）
- `always` 记忆化复用现有 `permission/saved.ts`（项目级），不新造
- **配置**：`doom_loop.threshold`（默认 3）、`doom_loop.enabled`（默认 true——与 V1 行为对齐）

### 3.2 D2 · Memory 复用 compaction（审计 D1 收敛）

- **不抽象新摘要组件**。提炼逻辑直接调用 `SessionCompaction` 的序列化器（`serialize`/`buildPrompt` 公开函数）或等价复用
- Memory 结构 = compaction 7 段模板的子集：`fact`（单一事实）+ `category` + `scope`（project/session）
- **不自动提炼**：只在 meta agent 显式调用 `memory_record` 时写入（Windsurf 式自动提炼后置，避免会话结束钩子的复杂度）
- 范围：**项目级**（`project_id` 键控），避免跨项目污染

### 3.3 D3 · Memory 注入走 SystemContext（审计 D2 收敛）

- `system-context/builtins.ts` 新增 MEMORY 源：`MemoryContext` 装载时按 `project_id` 检索 TOP-N（默认 10）条 `fact_category` 归类条目
- **默认关闭**：`meta.memory.enabled=false` 时不检索不注入（零缓存影响）
- 注入内容进 `SystemContext` 的 baseline 快照（`context-epoch.ts` 管理 reconcile/advance），不经过 `meta-prompt.ts` fill——**不破坏 L1/L2/L3 前缀缓存**
- 验证项：Memory 开关关闭时 `CacheShape` 诊断无变化（前缀哈希不变）

### 3.4 D4 · 执行计划入 git（Codex 风格）

- 目录：`docs/plan/exec/active/*.md` → 完成/中止移 `docs/plan/exec/completed/*.md`
- 内容模板（对齐 Codex 白皮书）：依赖图解 + 原子子任务清单（checkbox）+ 进度状态 + 关键决策日志
- **提交时机约定**：每个原子子任务完成时 agent 必须 commit（`docs(exec-plan): update <id> progress`），避免批量噪音
- 断点恢复：新会话/新实例启动时扫 `docs/plan/exec/active/*.md`，按清单继续
- `tech-debt-tracker.md` 放在 `docs/plan/exec/` 根（技术债固化写盘）

### 3.5 D5 · 验证执行器挂 lifecycle-hooks（tool/AGENTS.md 约束）

- **不做新工具**（避免第二执行入口 + 权限/可见性膨胀）：在 `SessionRunner` 工具 settle 后触发（postToolUse 注册）
- 触发策略：仅 `code_modification` 意图的 turn 后 + 涉及 `edit/write/apply_patch/bash` 工具调用时
- **包路径解析**：从 Location 工作区 + 改动文件路径推导 `packages/<name>`，命令：`bun --cwd packages/<name> typecheck`（若改动涉及 core/aigcfroge 等多包则逐个跑）
- **超时与防死循环**：单次验证 ≤ 60s（1-Minute Build Limit 对齐）；连续失败 ≥ 2 次本轮不再自动触发（防 Ralph 死循环）
- 验证失败 → 散文报错注入（见 D6）

### 3.6 D6 · 散文报错（Semantic Prose）

- 格式：`[验证失败] <工具/文件> <违反原则> <具体错误摘要(head)> <修正指引>`
- 注入点：`ToolFailure.message`（registry.ts:110-112 已捕获通道）+ 独立 `verify.failed` 事件（EventV2 定义）
- 原则来源：`AGENTS.md` 分层/自导出/Effect 编码条款的**静态映射表**（错误模式 → 原则 + 指引），不依赖 LLM（确定性优先）

### 3.7 D7 · 配置与特性开关汇总

```jsonc
// aigcfroge.jsonc
{
  "meta": {
    "memory": { "enabled": false, "top_n": 10 },
    "doom_loop": { "enabled": true, "threshold": 3 }
  },
  "verifier": { "enabled": true, "timeout_ms": 60000, "max_consecutive_failures": 2 }
}
```

---

## 4. 分波次实施

### 波次 1a · V2 doom_loop 检测器（1-2 天*）

**范围**：`packages/core/src/session/doom-loop.ts` + `plugin/agent.ts` defaults + runner 挂载

**设计**：
- 指纹：`SHA256(toolName + JSON.stringify(input))`；每 Session 环形缓冲最近 `threshold` 次（`Ref<Array<string>>`，按 sessionID 键控，Location-scoped `InstanceState`）
- 触发条件：缓冲满 + 全部相同 + 当前调用是真实执行（非 provider-executed）→ `PermissionV2.assert({ action: "doom_loop", resources: [toolName], save: [toolName] })`
- 挂载点：`runner/llm.ts:305-326` 的 tool settle 路径（`FiberSet.run(toolFibers)` 前）

**文件清单**：
```
packages/core/src/session/doom-loop.ts              新建：DoomLoop 检测服务
packages/core/src/plugin/agent.ts                   defaults 加 doom_loop ask 规则
packages/core/src/session/runner/llm.ts             挂载检测（settle 前）
packages/core/test/doom-loop.test.ts                新建（TDD 红测试）
packages/core/test/session-runner-doom-loop.test.ts 新建（runner 集成）
```

**TDD 工作流**：
1. **红**：`doom-loop.test.ts`——连续 3 次相同指纹触发 `PermissionV2.assert`（ask 被拒绝时返回 DeniedError）；2 次不触发；input 不同不触发；非 provider-executed 不触发
2. **绿**：实现 DoomLoop 服务 + 挂载 + defaults 规则
3. **重构**：指纹计算复用 `CacheShape.capture` 的哈希模式（不重复实现）
4. **退出**：`bun --cwd packages/core test --timeout 30000` + typecheck 绿

### 波次 1b · Memory 服务（3-5 天*）

**范围**：`meta_agent_memory` 表 + `MemoryService` + 工具 + SystemContext 注入 + 配置

**表结构**（snake_case，database skill 规范）：
```sql
CREATE TABLE meta_agent_memory (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  meta_agent_id TEXT NOT NULL REFERENCES meta_agent(id) ON DELETE CASCADE,
  fact_category TEXT NOT NULL,        -- code_trap / protocol / api / workflow
  content TEXT NOT NULL,              -- 单条事实（复用 compaction serialize 提炼）
  source_session_id TEXT,
  source_step_id TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
CREATE INDEX meta_agent_memory_project_idx ON meta_agent_memory(project_id);
```

**文件清单**：
```
packages/core/src/meta-agent/sql.ts                      加 MetaAgentMemoryTable
packages/core/src/database/migration/<ts>_add_meta_agent_memory.ts  新建
packages/core/src/agent/meta/memory.ts                    MemoryService（record/query/search/remove）
packages/core/src/tool/memory.ts                          memory_record / memory_search 工具
packages/core/src/system-context/builtins.ts              MemoryContext 源（默认关闭）
packages/core/src/config                                   meta.memory.* 配置
packages/core/test/meta-agent-memory.test.ts              新建（TDD）
packages/core/test/tool-memory.test.ts                    新建（TDD）
packages/core/test/system-context-memory.test.ts          新建（注入 + 缓存无影响）
```

**TDD 工作流**：
1. **红**：`meta-agent-memory.test.ts`（record 写入 + query 按 project_id/category 过滤 + search 关键词 + remove；UUID 幂等）；`tool-memory.test.ts`（工具 Schema 校验 + 权限 action 声明）；`system-context-memory.test.ts`（enabled=false 时 baseline 不含 Memory 段 → CacheShape 前缀哈希不变；enabled=true 时含 TOP-N 归类条目）
2. **绿**：表 + Service + 工具 + SystemContext 源 + 配置
3. **重构**：content 提炼复用 `SessionCompaction.serialize`（不重复序列化逻辑）；工具注册对齐 `builtins.ts` 既有模式
4. **退出**：三测试文件全绿 + typecheck + `bun --cwd packages/core test` 全量

### 波次 2 · 验证执行器 + 散文报错（5-8 天*）

**范围**：`session/verifier.ts` + runner 挂载 + 散文映射 + 事件

**文件清单**：
```
packages/core/src/session/verifier.ts            新建：Verifier 服务（执行 + 包路径解析 + 超时）
packages/core/src/session/runner/llm.ts          挂载：code_modification turn 后触发
packages/core/src/tool/registry.ts               散文注入点（ToolFailure 消息增强）
packages/core/src/session/event.ts               verify.failed / verify.passed 事件
packages/core/test/session-verifier.test.ts      新建（TDD：执行/超时/失败次数上限）
packages/core/test/verifier-prose.test.ts        新建（TDD：错误→散文映射）
packages/core/test/session-runner-verifier.test.ts 新建（集成）
```

**TDD 工作流**：
1. **红**：`session-verifier.test.ts`（包路径解析：core 文件→`packages/core`；timeout 60s；连续失败 2 次停止自动触发；成功恢复计数）；`verifier-prose.test.ts`（typecheck 错误 → "违反 AGENTS.md §X：<原则>，修正指引"映射表全项）
2. **绿**：Verifier 服务 + 挂载 + 散文映射表 + 事件定义
3. **重构**：包路径解析复用 `Global.Path`/workspace 拓扑（不硬编码包列表）；散文映射表数据驱动
4. **退出**：三测试绿 + 全量 test + typecheck

### 波次 3 · 执行计划写盘（3-5 天*，依赖 G3 拍板）

**范围**：`exec-plan-driver.ts` + `docs/plan/exec/` 目录约定 + meta_agent_step 关联

**文件清单**：
```
packages/core/src/agent/meta/exec-plan-driver.ts  新建：create/update/complete/load/list
docs/plan/exec/active/                            新建（git 版本控制）
docs/plan/exec/completed/                         新建
docs/plan/exec/tech-debt-tracker.md               新建
packages/core/src/agent/meta/meta-prompt.ts       执行计划指令注入（L3 委托上下文区）
packages/core/test/exec-plan-driver.test.ts       新建（TDD）
```

**TDD 工作流**：
1. **红**：`exec-plan-driver.test.ts`（create 生成 active/*.md + 模板结构；update 进度；complete 移到 completed/；load 恢复断点解析 checkbox 状态；git 状态校验）
2. **绿**：driver 实现 + 目录约定
3. **重构**：markdown 渲染复用 `docs/plan` 既有文档风格；不重复 meta_agent_step 的状态机（执行计划是文件的投影 + step 是 DB 的投影，互不替代）
4. **退出**：测试绿 + typecheck

### 波次 4 · 最低成本可观测项（按需）

- tree-sitter 命令解析移植（独立评估，前置 G 决策）
- span 关联：`Effect.withSpan` 补 tool settle + Memory 注入 + 验证执行三处（低风险，可随时合入）

---

## 5. 测试规范（必须遵守）

### 5.1 命令（永不从仓库根跑 test）
```bash
bun --cwd packages/core test --timeout 30000
bun --cwd packages/core typecheck      # tsgo --noEmit
bun --cwd packages/aigcfroge typecheck
bun run lint
```

### 5.2 三模式选择
| 模式 | 何时用 |
|---|---|
| `it.effect` | DoomLoop 检测、MemoryService CRUD、Verifier 散文映射、ExecPlanDriver 纯逻辑 |
| `it.live` | 真实子进程（验证执行器跑 typecheck）、真实时间/事件顺序 |
| `it.instance` | 真实 tmpdir + 实例（Memory 落库、执行计划文件操作） |

### 5.3 硬性规则
- `testEffect(...)`（`packages/aigcfroge/test/lib/effect.ts`），不手写 runtime；`Layer.mock` 代替全量 stub
- 禁 `Effect.sleep(N)` 等待 fiber——用 readiness 信号（`pollWithTimeout`/`Deferred`/`BackgroundJob.wait`）
- 禁 `as any`/`@ts-ignore`；测试实际实现，不把逻辑复制进测试
- 散文映射表测试 = 表驱动（错误模式 × 期望散文），不写死单个字符串断言

---

## 6. 分支与提交规范

- 分支：`harness-hardening`（从最新 main 切出）
- commit：`type(scope): summary`；scope 用 `core`；每完成一个波次一个 commit，不批量
- 波次内子任务完成后可拆 commit（`feat(core): ...`）
- `.husky/pre-push` 跑 `bun typecheck`——push 前确保全绿

---

## 7. 完成标准（验收清单，全过才算完成）

- [ ] **波次 1a**：连续 3 次相同工具调用触发审批（ask 拒绝返回 DeniedError 且工具不执行）；2 次/不同 input 不触发；`doom_loop: always` 记忆化后不再打扰
- [ ] **波次 1b**：`memory_record` 写入 → 新会话 `memory_search` 可检索（同 project）；`meta.memory.enabled=false` 时系统上下文零变化（CacheShape 前缀哈希不变）
- [ ] **波次 2**：code_modification turn 后自动跑受影响包 typecheck；失败 60s 超时；连续 2 次失败停止；错误以散文格式注入模型（含 AGENTS.md 条款引用）
- [ ] **波次 3**：复杂任务自动生成 `docs/plan/exec/active/*.md`；模拟中断后新实例可断点恢复；完成后移 completed/
- [ ] 全部：typecheck + lint + test 绿；复查结论 7 步全过

---

## 8. 执行协议（实施者必读，先读后写）

1. `CLAUDE.md` — 宪法（九荣九耻、四大拒绝、根因收敛、极致减法）
2. `AGENTS.md` — 代码风格（import/Effect/Schema/Testing/分支）
3. `ARCHITECTURE.md` — 架构拓扑 §1 路由 + §4 子系统
4. `CONTEXT.md` — Session V2 术语与不变量（Memory/执行计划不得违反）
5. `.aigcfroge/skills/protocols/SKILL.md` — 任务路由（本计划属 core/session + core/tool 簇）
6. `.aigcfroge/skills/effect/SKILL.md` — Effect 编码
7. `.aigcfroge/skills/database/SKILL.md` — 表/迁移规范
8. `packages/core/src/tool/AGENTS.md` — 工具架构约束
9. 本计划 + [Harness 7 层现状调研](../research/agent/AigcForge-Harness-7层现状深度调研.md) §10-§11

## 9. 参考

- 调研：`docs/research/agent/AigcForge-Harness-7层现状深度调研.md`
- 行业：`docs/research/industry/Agent Harness 7层核心功能具象化与问题解决机制深度调研.md`
- 白皮书：`docs/research/industry/AI智能体协议研究.md`
- 前置计划：`docs/plan/meta-agent-orchestrator.md`、`docs/plan/meta-agent-v2-production-closure.md`
- TDD 范式：`docs/plan/work-mode-m1.5-tdd-prompt.md`

\* 人天为量级估计（非承诺排期），依据：V1 对应实现行数 / 新增表与迁移数 / 挂载点就绪度。
