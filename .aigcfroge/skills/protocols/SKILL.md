---
name: protocols
description: "AigcForge protocol navigation - task routing, bidirectional link matrix, and on-demand loading tiers across 21 protocol docs (CLAUDE.md / AGENTS.md / ARCHITECTURE.md / CONTEXT.md / DESIGN.md + package AGENTS.md + skills). Activates when deciding which protocol docs to read, confirming change impact surface, or determining load order. For single-topic depth use the effect/database/frontend-theming skill instead."
allowed-tools: Read Bash Grep Glob
---

# Protocols

## Essential Principles

### 1. 索引不搬运
本 skill 是元数据导航，不复制协议文档内容。所有引用路径实存可校验（`bash scripts/check-refs.sh`）。

### 2. 双向索引
- **正向**（任务 -> 文档）：按任务信号查 Phase 1 路由表
- **反向**（文档 -> 文档）：按改动目标查 Phase 2 双向链接矩阵

### 3. 按需加载层级
L0 常驻（`CLAUDE.md`）-> L1 路由（`AGENTS.md` 章节）-> L2 触发（包级 AGENTS / skills）-> L3 深度（specs / ADR）

### 4. 与专题 skill 互补
`effect`/`database`/`frontend-theming` 覆盖单专题深度；本 skill 覆盖跨专题导航。单专题用对应 skill，跨文档影响面用本 skill。

### 5. 工作流
1. `CLAUDE.md` 常驻（系统提示注入）
2. 接任务 -> 查 Phase 1 路由表，定 L1/L2
3. 改动前 -> 查 Phase 2 影响面，防漏读关联约束
4. 改完即审 -> 用 Phase 1/2 验证未漏读必读、未遗漏影响面

## When to Use

- 接到任务不知该读哪份协议文档
- 改动前确认影响面（改 A 时哪些文档可能受影响）
- 改完即审时验证未漏读必读文档
- 协议文档改名/删除后校验引用完整性

## When NOT to Use

- 单专题深度实现问题 -> 用对应 `effect`/`database`/`frontend-theming` skill
- 架构子系统设计 -> 直接读 `ARCHITECTURE.md` §4
- 具体 API/符号查询 -> codegraph MCP / Grep

## Architecture

### 21 节点三层拓扑

```
宪法层 (1)
  CLAUDE.md ── 顶层入口，单向辐射，无入链

协议层 (4) ── 互引闭环
  AGENTS.md(根) ⇄ ARCHITECTURE.md ⇄ CONTEXT.md
                    ⇅
                  DESIGN.md

技能层 (7)
  skills/effect · skills/database · skills/frontend-theming · skills/protocols · skills/enterprise-code-standard · skills/reuse-first-refactor · skills/quality-to-pr

包级 (6)
  aigcfroge/ · llm/ · app/ · desktop/ · effect-drizzle-sqlite/ · core/src/tool/

子目录 (5)
  aigcfroge/.../httpapi/ · aigcfroge/.../session/llm/ · aigcfroge/test/ · aigcfroge/test/server/ · app/e2e/performance/

specs (1)
  packages/aigcfroge/specs/effect/migration.md
```

### 枢纽
`ARCHITECTURE.md` §1 Document Routing 是全网络唯一显式索引表（MOC），入链最多（4 份回引）。

## Phase 1: 任务路由（正向索引）

**Entry**: 接到任务，需确定读哪些协议文档。

**Actions**:
1. 识别任务触发信号（改动文件路径 / 关键词）
2. 在下表"触发信号"列匹配
3. 命中行取出 L1 必读 + L2 按需 + L3 深度

| 任务 | 触发信号 | L1 必读 | L2 按需 | L3 深度 |
|---|---|---|---|---|
| 写/改 Effect | `Effect.gen`/`Effect.fn` | `AGENTS.md`->Effect · `packages/aigcfroge/AGENTS.md`->Effect rules | `skills/effect/SKILL.md` | `packages/aigcfroge/specs/effect/migration.md` |
| 改数据库 | `*.sql.ts`/`migration/*.ts` | `packages/aigcfroge/AGENTS.md`->Database | `skills/database/SKILL.md` | `ARCHITECTURE.md` §4.8 · `packages/effect-drizzle-sqlite/AGENTS.md` |
| 加 HttpApi | `httpapi/` 路由 | `packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md` | `AGENTS.md`->Effect · `ARCHITECTURE.md` §6 | `packages/aigcfroge/test/server/AGENTS.md` |
| 改 UI/主题 | `.css`/`.tsx`/`packages/ui` | `DESIGN.md` | `skills/frontend-theming/SKILL.md` | `ARCHITECTURE.md` §1 |
| 改 Session V2 | `packages/core/src/session/` | `AGENTS.md`->V2 Core · `CONTEXT.md` | `ARCHITECTURE.md` §4.1 | `specs/v2/session.md` · `docs/architecture/system-blueprint.md` §11 |
| 改 LLM | `packages/llm/`/`session/llm/` | `packages/llm/AGENTS.md` ⇄ `packages/aigcfroge/src/session/llm/AGENTS.md` | `ARCHITECTURE.md` §4.9 | `specs/v2/provider-model.md` |
| 改 Tool | `packages/core/src/tool/` | `packages/core/src/tool/AGENTS.md` | `ARCHITECTURE.md` §4.4 · `AGENTS.md`->Tool Synergy | `specs/v2/tools.md` |
| 写测试 | `*.test.ts`/`*.spec.ts` | `AGENTS.md`->Testing · `packages/aigcfroge/test/AGENTS.md` | `packages/aigcfroge/test/server/AGENTS.md` | `packages/aigcfroge/test/EFFECT_TEST_MIGRATION.md` |
| 改 desktop | `packages/desktop/src/` | `packages/desktop/AGENTS.md` | `ARCHITECTURE.md` §6 | - |
| 改 Product Mode | `mode`/`DraftTab.mode` | `ARCHITECTURE.md` §4.10 · `CONTEXT.md`->Product Mode | ADR-11~16 | `docs/plan/mode-module-switching-completion.md` |
| 改 Custom 模式/组合平台 | `custom-profile`/`CompositionPlan`/`CompositionSnapshot`/`mode=custom` | `ARCHITECTURE.md` §4.1/§4.4/§4.6/§4.10 · `CONTEXT.md` | ADR-17 · `DESIGN.md` | `docs/prd/custom-mode-composition-platform.md` · `docs/roadmap/custom-mode-roadmap.md` · `specs/v2/session.md` · `specs/v2/tools.md` |
| 改 Chat 模式/资产系统 | `prompt-asset`/`workflow-asset`/`chat-right-panel` | `DESIGN.md` · `ARCHITECTURE.md` §4.10 | ADR-13 · ADR-13-Amendment-1/2 | `docs/prd/chat-mode-creation-layer.md` |
| 规范重构/代码标准 | 全仓代码重构/新增文件 | `CLAUDE.md` · `AGENTS.md` | `skills/enterprise-code-standard/SKILL.md` · `skills/reuse-first-refactor/SKILL.md` | - |
| PR 交付/质量门禁 | 分支合并/PR 提交 | `CLAUDE.md` §改完即审 | `skills/quality-to-pr/SKILL.md` | `.aigcfroge/skills/quality-to-pr/references/delivery-gates.md` |

> 未命中时回退 `ARCHITECTURE.md` §1 Document Routing（按子系统）。

**Exit**: 得到本次任务的协议文档加载清单（L1 必读 + L2 按需）。

## Phase 2: 影响面分析（反向索引）

**Entry**: 改动前，需确认改 A 时哪些文档可能受影响。

**Actions**:
1. 查"真双向"表：改一方必查互引另一方
2. 查"关键单向边"表：改源端时检查目标端是否需同步
3. 查"同名陷阱"：避免误读同名文档

### 真双向（互引，改一方必查另一方）

| 对 | 关系 |
|---|---|
| `packages/llm/AGENTS.md` ⇄ `packages/aigcfroge/src/session/llm/AGENTS.md` | integration point 互指（4 适配器 ↔ LLMClient/LLMEvent 来源） |
| `ARCHITECTURE.md` ⇄ `CONTEXT.md` | §4.1/§4.2 引；CONTEXT Protocol links 回引 §4.1 |
| `ARCHITECTURE.md` ⇄ `DESIGN.md` | §1 路由；DESIGN Verification 回引做 consistency check |
| `DESIGN.md` ⇄ `skills/frontend-theming/SKILL.md` | Tokens/Theme 引；SKILL "参考 DESIGN.md token 规则" |

### 关键单向边（改源端时检查目标端是否需同步）

| 源 | -> | 目标 |
|---|---|---|
| `CLAUDE.md` | -> | `AGENTS`·`ARCHITECTURE`·`DESIGN`·`skills/*`·`packages/aigcfroge/AGENTS`·`packages/llm/AGENTS` |
| `AGENTS.md`(根) | -> | `ARCHITECTURE §4.1`·`CONTEXT`·`skills/effect`·`skills/database`·`packages/aigcfroge/test/AGENTS`·`packages/aigcfroge/AGENTS`·`packages/llm/AGENTS` |
| `ARCHITECTURE.md` | -> | `packages/core/src/tool/AGENTS`(§4.4)·`packages/llm/AGENTS`(§4.9)·`session/llm/AGENTS`(§4.9)·`httpapi/AGENTS`(§6)·`skills/*`·`specs/v2/*`·ADR |
| `packages/aigcfroge/AGENTS.md` | -> | `packages/aigcfroge/specs/effect/migration.md` |
| `skills/effect/SKILL.md` | -> | `.aigcfroge/references/effect-smol` |
| `packages/effect-drizzle-sqlite/AGENTS.md` | -> | `.aigcfroge/references/effect-smol`（同源） |

> `effect-smol` 是 gitignored 的本地上游 checkout（`.aigcfroge/.gitignore` 忽略 `references/`，不入库），故不纳入 `check-refs.sh` 的存在性校验；需要交叉核对 Effect 实现细节时自行克隆到该路径。

### 孤岛（无显式链接，仅靠目录位置生效）
- `packages/desktop/AGENTS.md` · `packages/app/e2e/performance/AGENTS.md`

### 同名陷阱
- `CONTEXT.md`：Session Runtime 术语字典，非项目级 context（`ARCHITECTURE.md` §1 caveat）
- `packages/llm/DESIGN.md`：`@aigcfroge/ai` 草案，非根 `DESIGN.md` 子协议（`ARCHITECTURE.md` §4.9 caveat）

**Exit**: 确认所有受影响文档已纳入加载清单，无遗漏关联约束。

## Phase 3: 按需加载

**Entry**: 已确定要读哪些文档，需决定加载顺序与时机。

**Actions**:
1. 按层级表确定每份文档的加载时机
2. L0 常驻无需手动加载（系统提示注入）
3. L1 接任务后立即读；L2 主题命中时读；L3 遇具体问题再读

| 层级 | 何时 | 文档 |
|---|---|---|
| L0 常驻 | 每会话 | `CLAUDE.md`（系统提示注入） |
| L1 路由 | 接任务后 | `AGENTS.md`(根) 对应章节 |
| L2 触发 | 主题命中 | 包级 `AGENTS.md` · `skills/*/SKILL.md` |
| L3 深度 | 遇具体问题 | `specs/` · `migration.md` · ADR · `docs/architecture/` |

**Exit**: 文档按层级顺序加载完毕，开始执行任务。

## Quick Reference

### 主题簇（隐式关联）

| 簇 | 成员 |
|---|---|
| V2 Session | `AGENTS`(V2)⇄`ARCHITECTURE §4.1`⇄`CONTEXT`（三方互引闭环） |
| Effect 编码 | `AGENTS`·`packages/aigcfroge/AGENTS`·`packages/llm/AGENTS`·`skills/effect`·`migration.md` |
| 数据库 | `packages/aigcfroge/AGENTS`·`packages/effect-drizzle-sqlite/AGENTS`·`skills/database`·`ARCH §4.8` |
| UI/主题 | `DESIGN`⇄`skills/frontend-theming` |
| LLM 运行时 | `packages/llm/AGENTS`⇄`session/llm/AGENTS`·`ARCH §4.9` |
| Tool 系统 | `packages/core/src/tool/AGENTS`·`AGENTS`(Tool Synergy) |
| HttpApi | `httpapi/AGENTS`·`packages/aigcfroge/test/server/AGENTS` |
| 测试 | `AGENTS`(Testing)·`test/AGENTS`·`test/server/AGENTS`·`app/e2e/performance/AGENTS` |

### 校验脚本

```bash
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
```

### 使用实例

见 `examples/agent-workflow.md`。

## Success Criteria

- [ ] 接任务后能在 Phase 1 路由表匹配到任务行
- [ ] 改动前用 Phase 2 确认影响面
- [ ] 引用路径全部实存（`check-refs.sh` 通过）
- [ ] 单专题问题回退到对应 `effect`/`database`/`frontend-theming` skill
- [ ] 新代码任务先加载 `enterprise-code-standard` 和 `reuse-first-refactor`
- [ ] 需要远程交付时加载 `quality-to-pr`，完成测试、差异审查和 PR 证据
