# 右侧面板功能增强方案（修订版）

> 目标：借鉴 jinnang-coder 的设计经验，将 Git 操作 + 工具活动/缓存诊断能力融入 **AigcForge 现有上下文/审查模块**  
> 状态：DRAFT (v3)  
> 分支：`right-panel-enhancement`  
> 范围：4 个 Phase，~22 文件，2 条并行轨道  
> 修订说明：根据高级全栈顾问审批意见，修正 Git 层定位、Server 路由位置、SDK 生成方式、status 数据模型、缓存诊断 round 定义与服务端点。

---

## 0. 背景与现状

### 设计原则

遵循 `CLAUDE.md` / `AGENTS.md` / `DESIGN.md`：

| 原则        | 约束                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| 极致减法    | 融入现有模块，不创建新标签页、不引入新交互范式（无右键菜单、无模态确认窗） |
| 模块组织    | `export * as Foo from "./foo"` 自导出，不新建 barrel index                 |
| Effect 编码 | `Effect.fn("Name.method")`、`forkIn(scope)`、`Schema.TaggedErrorClass`     |
| CSS / 主题  | `--v2-*` token，禁止硬编码；v1 token 仅用于匹配现有组件                    |
| Reusability | 新增前先查 owner module；扩展现有模块，不新建平行实现                      |
| 类型检查    | 单包 `bun typecheck`，不直接跑 `tsc`                                       |
| 测试        | 在受影响包内跑 `bun test`，不从根目录跑                                    |

### 架构决策

| 决策                                                | 原因                                                   |
| --------------------------------------------------- | ------------------------------------------------------ |
| Git 操作 → 嵌入审查面板                             | 用户在看 diff 的地方操作 Git，流程自然                 |
| 工具活动图 → 上下文标签页                           | 上下文标签页已是"会话全景"面板，工具活动是全景的一部分 |
| 缓存诊断 → 上下文标签页                             | 紧接工具活动，构成"做了什么 → 效果如何"的阅读流        |
| 不创建独立洞察标签页                                | 避免标签膨胀，复用现有 [上下文] 标签                   |
| 不引入右键菜单                                      | 项目无右键交互模式，已有拖拽满足文件引用需求           |
| 不创建预览幻灯片面板                                | AigcForge 文件标签系统已覆盖                           |
| Git 写操作扩展 `aigcfroge/src/git/index.ts`         | 现有 `Vcs.Service` 已依赖该模块，复用路径最短          |
| 扩展 `/vcs/status` 返回 staged 标志                 | 不新增 endpoint，信息模型更完整                        |
| 缓存诊断走 `/session/{sessionID}/cache-diagnostics` | 数据属于 Session，语义正确                             |

### 现状 vs 目标

```
当前审查面板:                       当前上下文标签页:
┌──────────────────┐               ┌──────────────────┐
│ 只读 diff 列表    │               │ 统计网格          │
│ 无 Git 写操作     │               │ 上下文分解柱状图   │
│ 无提交日志        │               │ 系统提示          │
└──────────────────┘               │ 原始消息          │
                                   └──────────────────┘
```

```
目标审查面板:                       目标上下文标签页:
┌──────────────────┐               ┌──────────────────┐
│ Git 状态栏        │               │ 统计网格          │
│ (分支/ahead/stage)│               │ 上下文分解柱状图   │
├──────────────────┤               ├──────────────────┤
│ diff 列表         │               │ ▼ 工具活动 (实时)  │
│ └ 每行 stage 按钮 │               │ 读文件/写文件/命令等 │
├──────────────────┤               ├──────────────────┤
│ 提交栏 + 日志     │               │ ▼ 缓存诊断         │
└──────────────────┘               │ 命中率/每轮/全局   │
                                   ├──────────────────┤
                                   │ 系统提示          │
                                   │ 原始消息          │
                                   └──────────────────┘
```

### 可复用基础设施

| 基础设施        | 位置                                                                      | 用于                          |
| --------------- | ------------------------------------------------------------------------- | ----------------------------- |
| Token/缓存列    | `session` 表 `tokens_cache_read/write`, `tokens_input`                    | 缓存诊断计算                  |
| 工具调用事件    | `session.next.tool.{called,success,failed}`                               | 工具活动实时聚合              |
| 消息/部分同步   | `sync().data.message[id]`, `sync().data.part[id]`                         | 工具活动前端推导              |
| Git diff/status | `packages/aigcfroge/src/git/index.ts`                                     | 审查面板差异与状态            |
| Git patch/apply | `packages/aigcfroge/src/git/index.ts`                                     | Vcs 服务现有能力              |
| Vcs 服务        | `packages/aigcfroge/src/project/vcs.ts`                                   | 封装 Git 写操作给 Server 路由 |
| Session 路由    | `packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts` | 缓存诊断 endpoint             |
| 上下文标签页    | `SessionContextTab`                                                       | 工具活动 + 缓存诊断容器       |
| 审查面板        | `session.tsx` `reviewPanel`                                               | Git 操作容器                  |

### 参考来源 (jinnang-coder)

| 功能         | 源文件                                                    |
| ------------ | --------------------------------------------------------- |
| Git 操作面板 | `src/components/RightPanel/GitPanel.tsx`                  |
| AI 感知层    | `src/components/RightPanel/insight/PerceptionSection.tsx` |
| 缓存诊断     | `src/components/RightPanel/insight/CacheDiagnostics.tsx`  |

---

## Phase 1: Git 操作 — aigcfroge Git 层扩展

> 扩展 `packages/aigcfroge/src/git/index.ts` 的底层 Git 能力，新增 `stage/unstage/commit/log`。

### 改动

| 文件                                  | 操作 | 说明                                              |
| ------------------------------------- | ---- | ------------------------------------------------- |
| `packages/aigcfroge/src/git/index.ts` | 修改 | Interface + impl 新增 4 方法 + `CommitEntry` 类型 |

### Interface

```typescript
export type CommitEntry = {
  readonly hash: string
  readonly message: string
  readonly author: string
  readonly date: string // ISO 8601
}

export interface Interface {
  // ... 现有方法
  readonly stage: (cwd: string, files: string[]) => Effect.Effect<Result>
  readonly unstage: (cwd: string, files: string[]) => Effect.Effect<Result>
  readonly commit: (cwd: string, message: string) => Effect.Effect<Result>
  readonly log: (cwd: string, count?: number) => Effect.Effect<CommitEntry[]>
}
```

> 不引入 `Schema.Class` 等重型 schema：该模块远离 API 边界，内部用 interface + 普通对象即可，保持与现有 `Item/Stat/Patch` 风格一致。

### 实现要点

| 方法      | 命令                                                      | 边界                                            |
| --------- | --------------------------------------------------------- | ----------------------------------------------- |
| `stage`   | `git add -- <files>`                                      | 空 files 无操作；文件路径先校验在 repo 内       |
| `unstage` | `git restore --staged -- <files>`                         | 精确取消暂存                                    |
| `commit`  | `git commit -m <message>`                                 | message 为空时上层禁用，不传 `--allow-empty`    |
| `log`     | `git log --max-count=N --format="%H%x00%s%x00%an%x00%aI"` | 默认 15 条；用 `\0` 分隔避免 message 含特殊字符 |

```typescript
const stage = Effect.fn("Git.stage")(function* (cwd: string, files: string[]) {
  if (files.length === 0) {
    return {
      exitCode: 0,
      text: () => "",
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      truncated: false,
    } satisfies Result
  }
  return yield* run(["add", "--", ...files], { cwd })
})
```

### 验证

```bash
bun --cwd packages/aigcfroge typecheck && bun --cwd packages/aigcfroge test
```

---

## Phase 2: Git 操作 — Vcs 服务层 + Server 端点 + SDK

> 扩展 `Vcs.Service` 封装业务方法，在现有 instance API 暴露 `stage/unstage/commit/log`，并扩展 `/vcs/status` 返回 staged 标志。

### 改动

| 文件                                                                       | 操作 | 说明                                                                      |
| -------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------- |
| `packages/aigcfroge/src/project/vcs.ts`                                    | 修改 | Interface 新增 stage/unstage/commit/log/statusDetailed；扩展 `FileStatus` |
| `packages/aigcfroge/src/server/routes/instance/httpapi/groups/instance.ts` | 修改 | 新增 4 个 route + 扩展 vcsStatus                                          |
| `packages/sdk/js/src/v2/gen/types.gen.ts`                                  | 生成 | 运行 `build.ts` 后自动生成                                                |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts`                                    | 生成 | 运行 `build.ts` 后自动生成                                                |

### Vcs.Service 扩展

```typescript
export const FileStatus = Schema.Struct({
  file: Schema.String,
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.Literals(["added", "deleted", "modified"]),
  staged: Schema.Boolean, // 新增
}).annotate({ identifier: "VcsFileStatus" })

export const CommitEntry = Schema.Class<CommitEntry>("VcsCommitEntry")({
  hash: Schema.String,
  message: Schema.String,
  author: Schema.String,
  date: Schema.String,
})

export interface Interface {
  // ... 现有方法
  readonly stage: (files: string[]) => Effect.Effect<void, PatchApplyError>
  readonly unstage: (files: string[]) => Effect.Effect<void, PatchApplyError>
  readonly commit: (message: string) => Effect.Effect<void, PatchApplyError>
  readonly log: (count?: number) => Effect.Effect<CommitEntry[], PatchApplyError>
}
```

> `Vcs.Service` 仍复用已有的 `PatchApplyError`，通过扩展 `reason` 枚举表达 stage/unstage/commit 失败： `"non-git" | "not-clean" | "stage-failed" | "commit-failed"`。

### Server 端点

在 `packages/aigcfroge/src/server/routes/instance/httpapi/groups/instance.ts` 中新增：

```
POST /vcs/stage    body: { files: string[] }       → void
POST /vcs/unstage  body: { files: string[] }       → void
POST /vcs/commit   body: { message: string }       → void
GET  /vcs/log      query: { count?: number }       → CommitEntry[]
```

并扩展现有 `GET /vcs/status` 的 response schema，使返回的 `VcsFileStatus` 包含 `staged`。

沿用 `/vcs/status` 的路径风格、认证方式与 `WorkspaceRoutingQuery`。

### SDK 生成

SDK 文件为自动生成产物，**禁止手改**。

```bash
bun run packages/sdk/js/script/build.ts
```

生成后确认：

- `VcsFileStatus` 含 `staged: boolean`
- `sdk().client.vcs.stage/unstage/commit/log` 存在

### 验证

```bash
bun --cwd packages/aigcfroge typecheck && bun --cwd packages/aigcfroge test
bun run packages/sdk/js/script/build.ts
bun --cwd packages/sdk/js typecheck
```

---

## Phase 3: Git 操作 — 嵌入审查面板

> 在现有审查面板中集成暂存/取消暂存/提交/日志 UI，无模态确认窗。

### 改动

| 文件                                                     | 操作     | 说明                                                                               |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `packages/app/src/pages/session.tsx`                     | 修改     | `reviewPanel` 嵌入 GitStatusBar + GitCommitBar；注入 stage/unstage/commit handlers |
| `packages/app/src/pages/session/git-state.ts`            | **新增** | Git status / log / mutations 状态管理                                              |
| `packages/app/src/components/session/git-status-bar.tsx` | **新增** | 分支/ahead/behind/全部暂存按钮                                                     |
| `packages/app/src/components/session/git-commit-bar.tsx` | **新增** | 提交输入框 + 提交按钮 + 最近提交折叠列表                                           |
| `packages/app/src/components/session/index.ts`           | 修改     | 导出新组件                                                                         |
| `packages/app/src/i18n/en.ts`                            | 修改     | 新增 Git 操作 i18n                                                                 |
| `packages/app/src/i18n/zh.ts`                            | 修改     | 新增 Git 操作 i18n                                                                 |

### 审查面板新布局

```text
┌─── 审查面板 ─────────────────────────────────┐
│ [git/main]  ↑1 ↓0  [全部暂存]                │ ← GitStatusBar
├──────────────────────────────────────────────┤
│  变更文件列表 (SessionReview)                 │
│                                              │
│  ┌─ src/file1.ts ─────────────────────────┐ │
│  │ [+5 -2] 修改了登录逻辑           [取消暂存]│ │ ← 文件行级操作
│  └────────────────────────────────────────┘ │
│  ┌─ src/file2.ts ─────────────────────────┐ │
│  │ [+1 -0] 新增类型               [暂存]   │ │
│  └────────────────────────────────────────┘ │
│                                              │
├──────────────────────────────────────────────┤
│ [输入提交信息... (Cmd+Enter)]        [提交]  │ ← GitCommitBar
├──────────────────────────────────────────────┤
│ ▼ 最近提交                                   │
│  a1b2c3d feat: add login  2h ago            │ ← 可折叠日志
│  e4f5g6h fix: typo        5h ago            │
└──────────────────────────────────────────────┘
```

### ahead/behind 计算

在 `Vcs.Info` 扩展 `ahead?: number`、`behind?: number`，由 `Vcs.Service` 在 `branch()` 时一并计算：

```bash
git rev-list --count HEAD..@{upstream}   # behind
git rev-list --count @{upstream}..HEAD   # ahead
```

无 upstream 时显示 `--` 或隐藏箭头。

### 数据流

```typescript
// git-state.ts
export const createGitState = (input: {
  directory: () => string
  vcsKey: () => readonly string[]
  wantsReview: () => boolean
  isGitProject: () => boolean
}) => {
  const statusQuery = createQuery(() => ({
    queryKey: [...input.vcsKey(), "status"] as const,
    enabled: () => input.wantsReview() && input.isGitProject(),
    queryFn: () =>
      sdk()
        .client.vcs.status()
        .then((r) => r.data),
  }))

  const logQuery = createQuery(() => ({
    queryKey: [...input.vcsKey(), "log"] as const,
    enabled: () => input.wantsReview() && input.isGitProject(),
    queryFn: () =>
      sdk()
        .client.vcs.log({ count: 15 })
        .then((r) => r.data),
  }))

  const stageMutation = useMutation(() => ({
    mutationFn: (files: string[]) => sdk().client.vcs.stage({ files }),
    onSuccess: () => invalidateStatus(),
    onError: (err) => showCommitError(err),
  }))

  // unstage/commit 类似 ...

  return { statusQuery, logQuery, stageMutation, unstageMutation, commitMutation }
}
```

### 提交确认机制

- **不弹模态确认窗**。
- 提交按钮在 `message.trim() === ""` 时 **禁用**。
- 提交成功/失败通过 `showToast` 反馈。
- 提交过程中按钮显示 loading 状态。

### 注入方式

```typescript
// session.tsx reviewPanel
const git = createGitState({
  directory: () => sdk().directory,
  vcsKey,
  wantsReview,
  isGitProject: () => sync().project?.vcs === "git",
})

const reviewPanel = () => (
  <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
    <GitStatusBar
      branch={git.branch()}
      ahead={git.ahead()}
      behind={git.behind()}
      hasChanges={git.hasChanges()}
      onStageAll={git.stageAll}
      onUnstageAll={git.unstageAll}
    />
    <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
      {reviewContent({
        ...existing,
        gitFileStatus: git.statusMap(),
        onStageFile: git.stageFile,
        onUnstageFile: git.unstageFile,
      })}
    </div>
    <GitCommitBar
      message={git.commitMessage()}
      onMessageChange={git.setCommitMessage}
      hasStaged={git.hasStaged()}
      onCommit={git.commit}
      log={git.logQuery.data}
    />
  </div>
)
```

### 不需改动的现有功能

- 文件差异对比（`SessionReview` 分屏/统一/评论）
- diff 模式切换器（git/branch/turn）
- 变更计数
- 文件树"变更"标签联动

### 验证

```bash
bun --cwd packages/app typecheck && bun --cwd packages/app test && bun run lint
```

---

## Phase 4: 上下文标签页增强 — 工具活动 + 缓存诊断

> 在 `SessionContextTab` 中新增两个区域（工具活动实时图 + 缓存诊断），**不创建新标签页**。

### 改动

| 文件                                                                      | 操作     | 说明                                                           |
| ------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| `packages/core/src/session/cache-diagnostics.ts`                          | **新增** | 缓存诊断聚合服务（session 级 + per-step）                      |
| `packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts` | 修改     | 新增 `GET /session/{sessionID}/cache-diagnostics`              |
| `packages/app/src/components/session/session-context-tab.tsx`             | 修改     | 插入 `<SessionToolActivity />` + `<SessionCacheDiagnostics />` |
| `packages/app/src/components/session/session-tool-activity.tsx`           | **新增** | 实时工具活动图组件（纯前端推导）                               |
| `packages/app/src/components/session/session-cache-diagnostics.tsx`       | **新增** | 缓存诊断 UI（查询后端 + 可视化）                               |
| `packages/app/src/components/session/session-tool-activity-model.ts`      | **新增** | 工具活动聚合纯函数（便于测试）                                 |
| `packages/app/src/components/session/index.ts`                            | 修改     | 导出新组件                                                     |
| `packages/app/src/i18n/en.ts`                                             | 修改     | 新增工具活动 + 缓存诊断 i18n                                   |
| `packages/app/src/i18n/zh.ts`                                             | 修改     | 同上                                                           |

### 上下文标签页新布局

```text
┌─── 上下文标签页 ─────────────────────────────┐
│ ┌─ 统计网格 ───────────────────────────────┐ │ ← 现有
│ │ Provider / Model / Token / 费用 ...     │ │
│ └──────────────────────────────────────────┘ │
│ ┌─ 上下文分解 ─────────────────────────────┐ │ ← 现有
│ │ ████████░░░░ 系统/用户/助手/工具         │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌─ ▼ 工具活动 (新增 · 实时) ──────────────┐ │
│ │ 📄 读取文件                      12 次  │ │ ← 从 ToolPart 实时聚合
│ │  src/file1.ts                  ████████ │ │
│ │  src/file2.ts                  ████     │ │
│ │ ✏️ 修改文件                      4 次  │ │
│ │  src/file3.ts                  ████     │ │
│ │ 💻 执行命令                      8 次  │ │
│ │  npm run build                 ██████   │ │
│ │ 🔌 MCP 调用                      5 次  │ │
│ │  @aigcfroge/server             ████     │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌─ ▼ 缓存诊断 (新增 · 分析) ───────────────┐ │
│ │ ┌────────────────────────┐               │ │ ← 从 token 列 + Step.Ended 计算
│ │ │ Session 命中率: 76%    │               │ │
│ │ │ ████████░░░░░░░░░░     │               │ │
│ │ │ 可信度: 高              │               │ │
│ │ │ 读: 456K  写: 180K     │               │ │
│ │ └────────────────────────┘               │ │
│ │ 每轮命中率:                               │ │
│ │ ┌───┐ ┌───┐ ┌───┐ ┌───┐                │ │
│ │ │ 85│ │ 92│ │ 23│ │ 78│ %              │ │
│ │ └───┘ └───┘ └───┘ └───┘                │ │
│ │  R1   R2   R3   R4          [刷新]      │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌─ 系统提示 ───────────────────────────────┐ │ ← 现有
│ │ ...                                       │ │
│ └──────────────────────────────────────────┘ │
│ ┌─ 原始消息 ───────────────────────────────┐ │ ← 现有
│ │ [系统] [用户] [助手] [工具]              │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘

额外提醒
你当前 CLI 默认连的是 /home/keer/.local/share/aigcfroge/aigcfroge-local.db（只有测试数据），而真实服务跑的是 /home/keer/.local/share/aigcfroge/aigcfroge.db（123MB）。如果以后还要手动查数据库，记得用对路径。

```

### 4a: 工具活动实时组件 (SessionToolActivity)

**纯前端实现，无需后端服务。** 实时数据来自已有的 `sync().data.message[id]` 和 `sync().data.part[id]` 响应式数据。

#### Part 类型

SDK `Part` 联合类型中工具相关为 `ToolPart`：

```typescript
export type ToolPart = {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: ToolState
  metadata?: Record<string, unknown>
}
```

> 注意：不是 `tool_call`，而是 `type: "tool"`。

#### 聚合策略

按 `ToolPart.tool` 名称映射到分类：

```typescript
const classifyTool = (tool: string): ToolCategory => {
  if (/^read/.test(tool)) return "read"
  if (/^edit|^write|^apply/.test(tool)) return "write"
  if (/^bash|^shell|^command/.test(tool)) return "command"
  if (/^mcp/.test(tool)) return "mcp"
  if (/^skill/.test(tool)) return "skill"
  if (/^web/.test(tool)) return "web"
  return "other"
}
```

聚合函数放在 `session-tool-activity-model.ts`，输入 `messages` 和 `getParts`，输出分类统计：

```typescript
export type ToolActivity = {
  category: ToolCategory
  label: string
  total: number
  items: { name: string; count: number }[]
}

export function aggregateToolActivity(messages: Message[], getParts: (id: string) => Part[]): ToolActivity[]
```

#### 实时性

`sync().data.message[id]` 是响应式的，使用 `createMemo` 即可实时更新。

#### UI 交互

- 每个类别用 `AccordionV2.Item` 可折叠
- 每个条目显示文件名/命令（截断至 60 字符）+ 调用次数条形图
- 按次数降序排列，取 Top N
- 空类别隐藏

### 4b: 缓存诊断 (SessionCacheDiagnostics)

#### 服务层

```typescript
// packages/core/src/session/cache-diagnostics.ts
export class CacheDiagnostics extends Schema.Class<CacheDiagnostics>("CacheDiagnostics")({
  sessionHitRate: Schema.Number,
  sessionCacheRead: Schema.Number,
  sessionCacheWrite: Schema.Number,
  sessionTotalInput: Schema.Number,
  confidence: Schema.Literal("high", "estimated", "unavailable"),
  perStep: Schema.Array(StepCacheStats),
  // 全局缓存预留
  globalTotalCalls: Schema.optional(Schema.Number),
  globalHitRate: Schema.optional(Schema.Number),
  globalTotalTokens: Schema.optional(Schema.Number),
}) {}

export class StepCacheStats extends Schema.Class<StepCacheStats>("StepCacheStats")({
  assistantMessageID: Schema.String,
  hitRate: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
}) {}
```

#### 聚合逻辑

从 `session` 表 token 列 + `Step.Ended` 事件计算。注意 `SessionSchema.Info.tokens` 结构为 `tokens.cache.read/write`：

```typescript
export const getCacheDiagnostics = Effect.fn("CacheDiagnostics.get")(function* (sessionID: SessionSchema.ID) {
  const info = yield* sessionInfo(sessionID)
  const tokens = info.tokens
  const totalNonCache = Math.max(0, tokens.input - tokens.cache.write)
  const hitRate =
    totalNonCache + tokens.cache.read > 0 ? (tokens.cache.read / (totalNonCache + tokens.cache.read)) * 100 : 0
  const confidence = classifyConfidence(tokens.cache.read, tokens.cache.write)
  const steps = yield* readStepEndedEvents(sessionID)
  const perStep = steps.map((s) => ({
    assistantMessageID: s.assistantMessageID,
    hitRate: calcStepHitRate(s.tokens),
    cacheRead: s.tokens.cache.read,
    cacheWrite: s.tokens.cache.write,
  }))
  return CacheDiagnostics.make({
    sessionHitRate: hitRate,
    sessionCacheRead: tokens.cache.read,
    sessionCacheWrite: tokens.cache.write,
    sessionTotalInput: tokens.input,
    confidence,
    perStep,
  })
})
```

> `Step.Ended` 没有 `round` 字段，一轮就是一个 Step，用 `assistantMessageID` 标识。

#### Server Endpoint

在 `packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts` 中新增：

```
GET /session/{sessionID}/cache-diagnostics  → CacheDiagnostics
```

#### UI

- `AccordionV2` 可折叠，默认折叠
- 命中率使用柱状图（纯 CSS `div` + `width` 百分比）
- 每轮命中率用紧凑柱状条排列，X 轴显示 R1/R2/...（按 step 顺序）
- 置信度徽章：高=绿 / 估算=黄 / 不可用=灰
- 刷新按钮（`IconButtonV2` + `refresh` 图标）
- 全局缓存字段 optional，未获取时隐藏对应区域

### 集成位置

```typescript
// session-context-tab.tsx

// 在 return 中，上下文分解之后、系统提示之前
<Show when={params.id}>
  {/* 工具活动 — 实时，从 sync 数据推导 */}
  <SessionToolActivity messages={messages()} getParts={getParts} />
  {/* 缓存诊断 — 查询后端 */}
  <SessionCacheDiagnostics sessionID={params.id} />
</Show>
```

### 验证

```bash
bun --cwd packages/core typecheck && bun --cwd packages/core test
bun --cwd packages/aigcfroge typecheck && bun --cwd packages/aigcfroge test
bun --cwd packages/app typecheck && bun run lint
```

---

## 执行计划

### 依赖图

```
Phase 1 (aigcfroge git) ──→ Phase 2 (Vcs + Server + SDK) ──→ Phase 3 (Review Panel)
Phase 4 (工具活动 + 缓存诊断) ── 完全独立，与 Phase 1→2→3 并行
```

### 推荐顺序

| 顺序 | Phase                            | 预估  | 并行                |
| ---- | -------------------------------- | ----- | ------------------- |
| 1    | Phase 1: aigcfroge git 扩展      | 0.5d  | 轨道 A              |
| 2    | Phase 4: 工具活动 + 缓存诊断     | 2d    | 轨道 B (与 #1 并行) |
| 3    | Phase 2: Vcs 服务 + Server + SDK | 0.75d | 依赖 #1             |
| 4    | Phase 3: Git UI 嵌入             | 1.5d  | 依赖 #3             |

总计：**~4–5d**，2 条并行轨道。

### 影响范围

| 包                   | Phase   | 新增文件  | 修改文件  |
| -------------------- | ------- | --------- | --------- |
| `packages/aigcfroge` | 1, 2, 4 | 0         | 4+        |
| `packages/core`      | 4       | 1         | 0         |
| `packages/sdk/js`    | 2, 4    | 0（生成） | 2（生成） |
| `packages/app`       | 3, 4    | 5         | 4         |

---

## 改完即审模板

每个 Phase 完成后输出：

```text
复查结论:
- 影响文件:
- 命中 skills:
- 安全门禁: Catch Everything / No Null Pointer / Security First
- 工程门禁: No Cheating / Reusability / Clean Logs
- 已运行命令: bun typecheck / bun test / bun lint
- 剩余风险:
```

---

## 开放问题

1. **全局缓存统计 API**：当前无全局缓存服务。Phase 4 先做 session 级诊断，全局缓存字段留 `optional` 且 UI 隐藏，待后端就绪后再开放。

2. **工具活动实时边界**：当前会话的数据通过 `sync().data` 实时同步，但跨会话历史需额外查询。Phase 4 仅做到当前会话实时，历史会话数据量大的话延迟加载。

3. **Git status 刷新策略**：操作后手动 `invalidateQueries`，不自动轮询；文件 watcher 事件 `file.watcher.updated` 已能触发 `refreshVcs()`。

4. **未跟踪文件标记**：`git status` 输出的未跟踪文件在审查列表中用 `?` 标记，stage 后进入 staged 列表。

---

## 风险与注意事项

1. **Git 版本兼容性**：`git restore --staged` 需要 git 2.23+。项目目标环境已满足，但需在实现注释中说明。
2. **路径穿越**：stage/unstage 的文件路径必须先校验位于当前 repo 工作区内。
3. **空提交**：commit 操作不传 `--allow-empty`，上层通过禁用空 message 按钮防止。
4. **并发**：多个 Git 写操作同时执行可能冲突，通过 TanStack Query mutation 序列化同一 key 的请求。
5. **缓存诊断可信度**：当 `tokens_cache_read` 和 `tokens_cache_write` 均为 0 时，confidence 应为 `unavailable`；仅其一有值时为 `estimated`；均有值时为 `high`。
