# Workflow Asset 开闸实施计划（M5）

> 状态：Approved
> 依据：[Chat PRD v4.5 §17.4](../prd/chat-mode-creation-layer.md)（workflow 冻结）、[ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md)（冻结中）、[CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md)
> 前置：M3（AssetKind 框架泛化 + skill/mcp/command/agent 开闸）+ M4（全局资产展示）均已合并到 main
> 分支：`m5-workflow-asset`（从 main 切出，含 M4）
> 范围：`packages/schema` + `packages/core` + `packages/aigcfroge` + `packages/sdk/js` + `packages/app`
> **本文件为自包含实施手册，可供其他 agent 独立执行。**

---

## 0. 背景与目标

### 0.1 问题

工作流（workflow）在 schema 层已注册为 `AssetKindId` 的第 6 种类型（`["prompt", "skill", "mcp", "command", "agent", "workflow"]`），功能树也有入口，但：
- 无 `WorkflowAsset` schema（Summary/Info/Frontmatter）
- 无 core service（registry/loadDir/CRUD）
- 无 HTTP handler
- 无 UI 展示（`Exclude<AssetKindId, "workflow">` 显式排除）
- ADR-13 §5 冻结：工作流归属未决

**用户无法创建、存储、浏览工作流定义**，即使 schema 预留了位置。

### 0.2 目标

1. **ADR-13 Amendment**：解冻"定义归 Chat，执行归 Work"的归属决策
2. **WorkflowAsset 开闸**：复用 M3 标准的五层开闸流水线（schema → core → HTTP → SDK → UI）
3. **文件格式**：YAML DSL（节点+边解耦，行业标准 Open Agent Spec / Dify DSL / `.agf.yaml`）
4. **TDD 每步**：红 → 绿 → 验证（typecheck + test + lint）

### 0.3 非目标

- 不建设工作流执行引擎（归 Work 模式，延后）
- 不做 WorkflowAssetService（propose/apply/delete 事务层，当前只做到 registry 只读）
- 不做 M3 Phase 2B 式的"数据迁移"（无 legacy workflow 需要迁移）
- 不做运行时状态持久化（Checkpoint/中断恢复为执行引擎范畴）

### 0.4 架构决策

| 问题 | 决策 | 依据 |
|------|------|------|
| 工作流归属 | Chat 定义 + Work 执行 | ADR-13 §1 "Chat 创建" + §5 解冻 |
| 资产形态 | 独立资产（非 Skill 扩展） | Skill 语义=知识注入（AgentSkills.io 标准），Workflow 语义=步骤编排（Open Agent Spec），Claude 协议明确定义为两个不同概念 |
| 文件格式 | **YAML**（非 Markdown） | 工作流核心内容是结构化 DAG，非 prose 文档；`js-yaml` 已是 `gray-matter` 传递依赖，零新包 |
| 存储目录 | `.aigcfroge/workflows/` | 对齐现有 5 类目录结构 |
| 执行引擎 | 延后，当前只做定义管理 | Work PRD 正稿阶段再建设 |

---

## 1. 架构全景

```
┌─ schema 层 ────────────────────────────────────────┐
│  schema/workflow-asset.ts                          │
│  Summary(kind=workflow, name, description, ...)    │
│  Info(完整元数据 + step 数组)                       │
│  Frontmatter(name, description, steps, triggers)   │
│  StepDef / BranchDef / ParallelDef 子类型           │
└────────────────────┬──────────────────────────────┘
                     ↓
┌─ core 层 ──────────────────────────────────────────┐
│  core/src/workflow-asset.ts                        │
│  loadDir → Service(layer)                          │
│  读 .aigcfroge/workflows/*.yaml → js-yaml parse    │
│  list / getByPath / findByName / listInvalid       │
│  core/src/workflow-asset/path.ts                   │
└────────────────────┬──────────────────────────────┘
                     ↓
┌─ aigcfroge 层（HTTP API）──────────────────────────┐
│  groups/workflow-asset.ts                          │
│  handlers/workflow-asset.ts                        │
│  list + content (只读，无 apply/delete)             │
└────────────────────┬──────────────────────────────┘
                     ↓
┌─ sdk/js 层 → WorkflowAsset client ────────────────┘
                     ↓
┌─ app 层 ───────────────────────────────────────────┐
│  home.tsx: 加第 6 种 fetch                         │
│  mode-surfaces: 功能树 workflow 入口已存在 ✅      │
│  asset-workbench: AssetKind 已含 workflow ✅        │
│  prompt-asset-candidate: 解除 Exclude<"workflow">  │
│  asset-insert: 加 workflow kind 映射               │
└────────────────────────────────────────────────────┘
```

## 2. 文件格式设计（YAML DSL）

使用 `js-yaml` 解析（已是 `gray-matter` 传递依赖，零新包）：

```ts
import yaml from "js-yaml"
const parsed = yaml.load(content)  // { kind, name, steps, ... }
```

文件内容直接就是完整的工作流定义，无需 frontmatter/content 分离。

`.aigcfroge/workflows/<name>.yaml` 示例：

```yaml
kind: workflow
name: code-review
description: "Automated code review pipeline"
version: "1.0.0"
triggers:
  - "/review"
steps:
  - id: fetch_diff
    name: "Fetch Git Diff"
    agent: "builtin"
    input:
      command: "git diff HEAD~1"
    next: lint_scan
  - id: lint_scan
    name: "Lint Scan"
    agent: "builtin"
    input:
      command: "bun run lint"
    next: security_check
  - id: security_check
    name: "Security Check"
    agent: "builtin"
    input:
      command: "bun run audit"
    branches:
      success: report_good
      failure: report_issues
  - id: report_good
    name: "Report Clean"
    agent: "builtin"
    input:
      template: "Code review passed"
    next: END
  - id: report_issues
    name: "Report Issues"
    agent: "builtin"
    input:
      template: "Issues found: {{steps.security_check.output}}"
    next: END
```

### Schema 类型定义

```ts
class StepDef {
  id: string
  name: string
  agent: string
  input: Schema.Unknown          // agent 特定输入（JSON-serializable）
  next?: string                  // 串行下一步
  branches?: Record<string, string>  // 条件分支
  parallel?: string[]            // 并行步 id 列表
}
```

### 存储路径

```
.aigcfroge/workflows/
├── code-review.yaml
├── release-pipeline.yaml
└── daily-report.yaml
```

路径常量：`WORKFLOWS_DIR = ".aigcfroge/workflows"`（`constants.ts` 追加）

---

## 3. Phase 划分（TDD 每步）

| Phase | 内容 | 测试包 | 包 | 依赖 |
|-------|------|--------|-----|------|
| **0** | ADR-13 Amendment 文档 | — | docs | — |
| **1A** | WorkflowAsset schema：Summary/Info/Frontmatter/StepDef/InvalidEntry | `packages/schema/test/` | schema | — |
| **1B** | WorkflowAsset path 模块 | `packages/core/test/` | core | 1A |
| **1C** | WorkflowAsset core Service：loadDir + layer + watch | `packages/core/test/` | core | 1B |
| **2A** | HTTP API：groups + handlers（list/content）+ LocationServiceMap 注册 | `packages/aigcfroge/test/server/` | aigcfroge | 1C |
| **2B** | SDK 重新生成 | — | sdk/js | 2A |
| **3A** | App UI：home.tsx 加第 6 种 fetch | — | app | 2B |
| **3B** | 解除 Exclude<"workflow"> + asset-insert 路径映射 | — | app | 3A |
| **4** | 集成验证 | — | 全部 | 3B |

---

## 4. 详细实施步骤

### Phase 0：ADR-13 Amendment

**文件**：`docs/architecture/adr/ADR-13-amendment-1-workflow-asset.md`

追加条款：
- §5a：工作流**定义**归 Chat 模式，可作为第 6 类资产类型创建和版本化
- §5b：工作流**执行**归 Work 模式，与 Chat 的定义管理通过文件系统解耦
- 本 Amendment 不影响 ADR-13 其他条款

**验证**：仅文档。

---

### Phase 1A：Schema

**文件**：`packages/schema/src/workflow-asset.ts`（新）+ `packages/schema/src/index.ts`（追加导出）

**测试要点**：
- Summary 接受 `kind: "workflow"`
- Frontmatter 接受 `steps` 数组 + `triggers` 可选
- StepDef 必填字段校验
- InvalidEntry 结构
- Candidate 占位

---

### Phase 1B：Path 模块

**文件**：`packages/core/src/workflow-asset/path.ts`（新）

**测试要点**：
- `isValidSegment` 校验
- `validateRelativePath` 强制 `.yaml` 扩展名
- `nameToRelativePath` 产生 `.aigcfroge/workflows/<name>.yaml`
- `resolveOwnerRoot` / `resolveSafeTarget`

---

### Phase 1C：Core Service

**文件**：
- `packages/core/src/workflow-asset.ts`（新）
- `packages/core/src/constants.ts`（追加 `WORKFLOWS_DIR`）

**测试要点**：
- `loadDir` 从 `.aigcfroge/workflows/*.yaml` 加载
- `yaml.load()` + `Schema.decodeUnknownOption` decode
- YAML parse 失败 → `parse_error`
- Schema decode 失败 → `bad_frontmatter`
- 同名 → `name_conflict`
- 跨 kind 同文件名不冲突（isolated 测试）

---

### Phase 2A：HTTP API

**文件**：
- `packages/aigcfroge/src/server/routes/instance/httpapi/groups/workflow-asset.ts`（新）
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/workflow-asset.ts`（新）
- `packages/aigcfroge/src/server/routes/instance/httpapi/api.ts`（注册 group + LocationServiceMap）

**测试要点**：
- GET `/workflow-asset` 返回 assets 列表
- GET `/workflow-asset/content?path=xxx` 返回 Info
- 404 for missing workflow

---

### Phase 2B：SDK 重新生成

```bash
bun --cwd packages/sdk/js run build.ts
```

---

### Phase 3A：App UI

**文件**：`packages/app/src/pages/home.tsx`

- `chatAssetList` 加第 6 种 `sdk.client.workflowAsset.list()`

功能树 `workflow` 入口已存在，**零改**。
AssetKind 已含 `"workflow"`，**零改**。

---

### Phase 3B：解除 Exclude<"workflow">

**文件**：
- `packages/app/src/components/chat/prompt-asset-candidate.ts` — `SupportedAssetKind` 改为 `AssetKindId`
- `packages/app/src/components/chat/asset-insert.ts` — 加 `"workflow"` kind 映射

---

### Phase 4：集成验证

```bash
bun --cwd packages/schema typecheck
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/app typecheck
bun --cwd packages/app test --timeout 30000
bun run lint
```

---

## 5. 验收标准

- [ ] ADR-13 Amendment 完成（定义归 Chat，执行归 Work）
- [ ] WorkflowAsset Summary 接受 `kind: "workflow"`
- [ ] WorkflowAsset Frontmatter 支持 `steps` + `triggers`
- [ ] `loadDir` 正确扫描 `.aigcfroge/workflows/*.yaml`
- [ ] 无效 YAML 标记为 `parse_error`，无效 frontmatter 标记为 `bad_frontmatter`
- [ ] HTTP GET `/workflow-asset` 返回 assets 列表
- [ ] HTTP GET `/workflow-asset/content` 返回单个 Info
- [ ] SDK 重新生成，WorkflowAsset client 可用
- [ ] home.tsx 表格显示 workflow 资产（6 种 kind 并发 fetch）
- [ ] asset-insert.ts 支持 `workflow` kind 路径映射
- [ ] typecheck + 全量测试 + lint 通过

---

## 6. 已排除

- WorkflowAssetService（propose/apply/delete 事务层）
- Workflow 执行引擎（归 Work 模式）
- 运行时 Checkpoint/状态持久化
- Workflow 编辑 UI（当前只读浏览）
- 工作流的导入/导出

---

## 7. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| ADR-13 Amendment 不被接受 | 低 | 阻断 Phase 1-4 | Phase 0 先行 |
| `js-yaml` parse 与 Schema decode 不一致 | 低 | 低 | Phase 1A 测试覆盖嵌套场景 |
| workflow 功能树入口无内容 | 中 | 中 | AssetWorkbenchTable 显示空态 |
