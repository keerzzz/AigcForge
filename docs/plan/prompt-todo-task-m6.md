# M6 执行提示词 — TUI TaskItem 升级（脱离 V1 投影桥）

> 角色：执行 agent。逐 Step 红→绿推进，每步自验后**停下等审批，不 commit**（审批员复核后统一提交）。
> 上游：计划 `docs/plan/todo-task-system-upgrade.md` §8 延后总表（TUI 项）+ §5.3 Layer 5；specs `specs/v2/todo.md`。
> 分支：`todo-task-m6`（从集成分支 `todo-task-m2` tip 切出，M0-M5 已全部闭环）。
> 协议：CLAUDE.md 第一性原理 + 改完即审流程；每步复查结论必须按协议模板输出（影响文件/命中 skills/安全门禁/工程门禁/已运行命令/剩余风险）。

## 1. 背景与目标

TUI 侧栏 Todo 目前靠 V1 投影桥活着：core 每次任务写入投影一份 `todo.updated`（`packages/core/src/session/task.ts:88`），TUI 读老 `session.todo` GET + `todo.updated` SSE。这座桥在 Phase 5（V1 退役）会拆——**TUI 迁移在 V1 退役关键路径上**。本里程碑把 TUI 从投影迁到任务真身，并补全新系统语义。

**关键事实（已核实，不要重新调研）**：

- L1-L4 全部就绪、零改动：schema `SessionTask.Info`、core `SessionTask` 服务 + `task.updated` 事件、server `GET /session/{sessionID}/task`、SDK v2 `session.task` GET（`sdk.gen.ts:4758`）+ `EventTaskUpdated` 类型（`types.gen.ts:8083`）——**本里程碑只动 `packages/tui`**
- TUI sync 现状：`packages/tui/src/context/sync.tsx` 的 `todo` store（:88/:128）、`todo.updated` 监听（:248）、`session.todo` 拉取（:588）
- plugin 公开面：`packages/tui/src/plugin/adapters.tsx:131` 的 `state.session.todo(sessionID)` 是第三方 TUI 插件可见的公开契约——**不能直接删**
- 侧栏插件：`packages/tui/src/feature-plugins/sidebar/todo.tsx`（>2 项折叠）；组件 `packages/tui/src/component/todo-item.tsx`

## 2. 目标范围

| 件              | 范围                                                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ① 数据源迁移    | sync `task` store（`SessionTaskInfo[]` keyed sessionID）+ hydrate 改 `sdk.client.session.task` GET + SSE 改听 `task.updated`；老 todo store/监听/拉取**删除**（删除即资产）                                             |
| ② plugin 兼容   | `adapters.tsx` 的 `state.session.todo()` 保留但标 `@deprecated`（Phase 5 物理删除），实现改为从 task store 投影老 `Todo` 形状（{content,status} 子集映射）；新增 `state.session.task()` 访问器                          |
| ③ TaskItem 组件 | `todo-item.tsx` → `task-item.tsx`（文件+组件+Props 改名）；状态完整映射（pending/in_progress/completed/cancelled/failed/scheduled）；scheduled 任务显示 ⚡ + nextRun（`SessionTaskInfo.nextRun`，派生字段服务端已算好） |
| ④ 侧栏插件迁移  | `sidebar/todo.tsx` → `sidebar/task.tsx` 读 task store；折叠逻辑（>2）保留；标题文案 Todo → Task                                                                                                                         |
| ⑤ 测试 + specs  | 状态映射/scheduled 标记纯函数测试；sync `task.updated` 处理测试；specs/v2/todo.md 加 M6 行 + 计划延后表核销                                                                                                             |

**退出条件**：TUI 不再依赖 `session.todo`/`todo.updated`（grep 零残留，除 adapter deprecated 注释与 Phase 5 说明）；侧栏展示任务真身含定时标记；测试全绿。

**明确不做**：core/server/SDK 任何改动；投影桥删除（Phase 5）；TUI 版 Agent Hub / 定时任务管理交互（已裁决不做，终端管理走 task_schedule 工具）；TUI 以外的包。

## 3. Step 分解

### Step 1 — sync 数据源迁移 + plugin 兼容

**红**：sync 测试——`task.updated` 事件落 `task` store；hydrate 拉 `session.task`；`state.session.todo()` 从 task store 投影老形状（status 映射：scheduled→pending 投影规则需在测试里钉死，理由写注释）。
**绿**：按 §2-①② 实施。`Todo` 旧类型 import 若仅剩 adapter 投影使用则随之收窄。注意 TUI 的 `Todo` 类型来自 `@aigcfroge/sdk/v2`，`SessionTaskInfo` 同包已有。
**验证**：`bun --cwd packages/tui typecheck` + `bun --cwd packages/tui test --timeout 30000`。停下等审批。

### Step 2 — TaskItem 组件 + 侧栏插件

**红**：状态映射纯函数测试（六状态 → 标记/颜色）；scheduled 行渲染含 ⚡ 与 nextRun 文本。
**绿**：按 §2-③④ 实施；`feature-plugins/builtins.ts` 注册同步改名；颜色一律走 `useTheme` token（CLAUDE.md CSS 门禁），nextRun 格式化复用 TUI 既有时间工具（先 grep，没有就用最短 `new Date(x).toLocaleString()` 并在复查结论声明）。
**验证**：typecheck + test + `bunx oxlint --config .oxlintrc.json <改动文件>`。停下等审批。

### Step 3 — specs 收官

- `specs/v2/todo.md` 加 M6 行（数据源迁移/adapter 兼容投影/TaskItem/侧栏迁移）；`todo-task-system-upgrade.md` §8 延后总表 TUI 行核销（→ ✅ M6）
- 输出 M6 里程碑复查结论，停止等审批

## 4. 审批红线（沿用 M4/M5，违反即 REJECT）

- **只动 `packages/tui`**——core/server/SDK 出现任何 diff 直接打回
- 投影桥（core `todo.updated` 投影）**不删**，Phase 5 才拆
- `state.session.todo()` 公开面保持兼容（投影 + `@deprecated`），不得静默删改第三方可见契约
- 状态字面量映射必须显式完整（六状态），禁止 fallthrough 到默认色假装支持
- 无 `as any`/`@ts-ignore`；外部输入先判空（No Null Pointer）
- 测试禁止 `Effect.sleep`/`setTimeout` 等并发，用就绪信号（CLAUDE.md 测试同步门禁）
- 每 Step 停在审批点，不 commit、不 push、不做 git 历史改写
