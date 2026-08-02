# Todo/Task 升级 M4 AgentHub · TDD 执行提示词（自包含手册）

> **用途**：粘贴到新对话作为初始 prompt，驱动独立 agent 在 `todo-task-m4` 分支上执行 Todo/Task 系统升级的 M4 里程碑（AgentHub 全量：AgentTaskHub 面板 + Agent 视角聚合 + 定时任务完整管理 UI）。
> **来源**：[Todo/Task 升级计划](todo-task-system-upgrade.md)（范围真源，§3.1 A2/A3、§5.3 Layer 4、§5.7 入口决策、§8 M4、§10）
> **前置状态**：M0+M1 已合入本地 main；**M2+M3 已在 `todo-task-m2` 分支交付完毕（22 提交，五层审批闭环：1 BLOCKER + 3 MAJOR + 9 MINOR 全修复，三包 typecheck / 单测 / e2e 全绿）**，审批档案见 `docs/review/`
> **分支**：`todo-task-m4`（从 `todo-task-m2` 切出；m2 合入 main 后 rebase）
> **关键资产**：wip 分支 `todo-task-m4m5` 存有 M4 可复用实现（commit `1b8c426ac`），但**入口形态已被 §5.7 决策否决**（composer 常显按钮 → 改为 dot-grid 下拉），回收时必须改造
> **完成标准**：§4 每个 Step 红→绿→重构→验证→重读协议→提交，全部通过后停止等待审批

---

下面是直接粘贴给新对话的提示词正文（复制 `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` 之间的内容）：

<!-- PROMPT START -->

你是 AigcForge 仓库（/media/keer/办公/aigcfroge）的高级全栈工程师。在新分支 `todo-task-m4`（从 `todo-task-m2` 切出）上执行 Todo/Task 系统升级的 **M4 AgentHub** 里程碑（全量范围，不做裁剪）。计划全文见 `docs/plan/todo-task-system-upgrade.md`，M4 入口位置决策见该文件 §5.7。

---

## 0. 认知加载（写任何代码前必须精读）

按顺序读完以下文件：

```
CLAUDE.md              （根目录 — 第一性原理、八荣八耻、四大拒绝、门禁、改完即审流程）
AGENTS.md              （根目录 — 分支提交、Effect/Schema/测试规范、代码风格）
ARCHITECTURE.md        （根目录 — 系统全景、包拓扑、Product Mode）
DESIGN.md              （根目录 — UI 设计协议：Token、组件、无障碍；本里程碑全程必读）
.aigcfroge/skills/effect/SKILL.md            （Effect v4 编码规范）
.aigcfroge/skills/database/SKILL.md          （schema/迁移/自定义列类型规范）
.aigcfroge/skills/frontend-theming/SKILL.md  （主题引擎）
docs/plan/todo-task-system-upgrade.md        （本计划全文，范围真源；§5.7 是 M4 入口决策）
specs/v2/todo.md                             （V2 状态追踪器，里程碑结束同步）
specs/v2/schema-changelog.md                 （契约变更记录，凡改契约/端点/SDK 必记）
docs/review/AigcForge_DIFFERENTIAL_REVIEW_M2_2026-08-02.md  （M2 审批报告 — 教训清单）
```

**精读 M2/M3 已交付的实现**（你的工作长在它们上面，不是另起炉灶）：

```
packages/schema/src/session-task.ts              TaskInfo 契约（agentID/scheduledAt/recurrence 已在契约层）
packages/core/src/session/task.ts                SessionTask Service（reconcile 保留式语义：省略字段回落既有行）
packages/core/src/session/sql.ts                 TaskTable（M0/M2/M3 列已落，含 agent_id）
packages/core/src/session/scheduled-job.ts       ScheduledJobRunner（arm/tick/trigger/settle + B1 防重入抢占）
packages/core/src/session/scheduled-job-executor.ts  TaskDriver 背书执行器（unattended 子会话 + 预授权）
packages/core/src/tool/taskschedule.ts           task_schedule tool（注册/暂停/恢复/删除，含 dead-job 校验）
packages/core/src/permission.ts                  PermissionV2（unattended 兜底 deny 哨兵，:19-26）
packages/app/src/pages/session/timeline/message-timeline.tsx   标题行 + dot-grid 更多下拉（你的入口挂点）
packages/app/src/pages/session/timeline/session-scheduled-tasks.tsx       M3 定时弹层（session 级，模式范本）
packages/app/src/pages/session/timeline/session-scheduled-tasks-model.ts  弹层 model（纯函数范式）
packages/app/e2e/regression/session-scheduled-tasks.spec.ts    M3 E2E（mock-server PATCH echo 模式范本）
```

**M3 入口模式范本（§5.6，本里程碑复用同一模式）**：`message-timeline.tsx` 的 dot-grid `DropdownMenu.Content`（约 :1550-1570）新增菜单项 → `pendingScheduled` 式延迟打开状态 → 弹层锚定 more 按钮。M3 提交 `9b64051c1` 是该模式的完整 diff 范本，先 `git show 9b64051c1 --stat` 看它的影响面。

确认 `git branch --show-current` 输出 `todo-task-m4`，才能开始写代码。

---

## 1. 目标与范围（用户已裁决：全量闭环，三件套一件不少）

| 件 | 范围 | 对齐 |
|---|---|---|
| ① AgentTaskHub 面板 | 入口 = **标题右侧 dot-grid 更多下拉加"智能体"菜单项 + 弹层**（§5.7 决策，复用 §5.6 模式）；三区结构：我的智能体 + 任务衍生（**占位**，接 M5 task_spawn，本期不接逻辑）+ 新建入口 | 计划 §3.1 A3、§5.3 Layer 4 |
| ② Agent 视角聚合 | 智能体列表 + 每个 Agent 名下的 task / 定时任务聚合视图 | 计划 §3.2 映射表、§8 M4 |
| ③ 定时任务完整管理 UI（agent 视角） | 列表 / 新建 / 启停 / 删除；**删除 Agent 时提示"将同时删除 N 个会话 + N 个定时任务"** | 计划 §3.1 A2、§8 M4（对齐 Accio agent-panel） |

**退出条件**：Agent Hub 可用（三件套联调通过 + E2E 全生命周期）。

**明确不做**：Chat 模式聚合 tab（§5.7 已裁决为 M4 后独立立项）；任务衍生实际逻辑（M5 task_spawn）；TUI 改动；V1 改动（§9.2）。

---

## 2. 可复用资产与禁止带入（wip 分支 `todo-task-m4m5`）

wip 分支 commit `1b8c426ac`（`feat(app): AgentTaskHub panel (M4)`）存有前人实现，**先 `git show 1b8c426ac --stat` 盘点**：

**复用（与入口无关，直接回收）**：
- `packages/app/src/pages/session/composer/agent-task-hub-model.ts` + `agent-task-hub-model.test.ts` — 纯函数 model（聚合/选中/状态派生），5 个测试用例断言真实实现
- `agent-task-hub.tsx` 的**面板内容部分**（agent 列表 / task 列表渲染）
- hub 相关 i18n keys（en/zh/zht 三语言，在 wip 版 `packages/app/src/i18n/` 中）与 hub CSS 块（`[data-component="agent-task-hub-*"]`，在 wip 版 `index.css`）

**必须重做（§5.7 决策否决的部分）**：
- 入口：wip 实现是 composer 区常显"My agents"按钮（`session-composer-region.tsx` 的 hub 挂载 hunk）——**该 hunk 一律不回收**，改为 §5.6 模式的 dot-grid 菜单项 + 弹层；tsx 面板从"popover 挂 composer 按钮"改为"popover 挂 more 按钮 + pendingHub 延迟打开"
- 回收后 `grep -rn "agent-task-hub" packages/app/src/pages/session/composer/` 必须零命中（composer 区不留任何 hub 痕迹）

**禁止带入（M5 内容，整包不入）**：
- wip commit `3e4f50f46`（task_spawn tool / dag.ts / spawn 字段迁移）——M5 里程碑资产，M4 一律不碰；`spawned_from`/`depends_on` 列不落于本分支

---

## 3. TDD 强制循环（每个 Step 必走，不打折扣）

```
1. 精读本 Step 的红/绿/重构 + 关联代码文件
2. 红：先写测试，运行确认失败
3. 绿：最小实现使测试通过
4. 重构：清理，测试保持绿
5. 命令验证：bun run lint + 受影响包 typecheck + 受影响包 test
6. 按 CLAUDE.md §改完即审 输出复查结论
7. 重新阅读协议文件：CLAUDE.md 全文 + AGENTS.md 相关节 + 本 Step 涉及层的 skill + 计划对应小节
8. 全部通过后 git commit（conventional 提交信息），才允许进入下一 Step
```

**测试规范**（CLAUDE.md 强制）：`testEffect(...)` 不手写 runtime；禁 `Effect.sleep(N)` 等 fiber；禁 `as any`/`@ts-ignore`；命令永不从仓库根跑（`bun --cwd packages/<name> test --timeout 30000`）；E2E 用 `bun --cwd packages/app run test:e2e` 定向跑新增/受影响 spec（playwright 环境已验证可用：chromium 1.59.1，M2/M3 5 用例 30s 全绿）。

**里程碑结束时**：同步 `specs/v2/todo.md` + `specs/v2/schema-changelog.md`（凡改端点/SDK 必记）→ 输出完成报告 → **停止，等待审批，不自行进入 M5**。

---

## 4. 实施步骤

### Step 1 — 分支与资产回收

- `git checkout -b todo-task-m4`（从 `todo-task-m2`）
- 按 §2 清单从 wip 回收 model/tests/i18n/CSS/面板内容（`git checkout todo-task-m4m5 -- <path>` 或手动摘取），**剔除 composer 挂载 hunk**
- 此时 tsx 入口未接线，先让 model 测试独立转绿：`bun --cwd packages/app test --timeout 30000 -- src/pages/session/composer/agent-task-hub-model.test.ts`
- 提交 `feat(app): recover AgentTaskHub model and panel content from wip`

### Step 2 — 入口改造（dot-grid 下拉 + 弹层）

**红**：组件测试——dot-grid 下拉出现"智能体"菜单项；点击后弹层打开、渲染 agent 列表。

**绿**：
- `message-timeline.tsx` 的 `DropdownMenu.Content` 加菜单项（仿 :1559-1566 定时任务项），`pendingHub` 延迟打开模式（仿 `pendingScheduled`），弹层锚定 more 按钮
- tsx 面板改挂新入口；composer 区零改动
- i18n：三语言 key 对齐（parity 测试必须过）；CSS 复用 wip hub 块 + 既有 token，**每个 token 先 grep `packages/ui` 确认存在**（红线 13）
- **上下文按钮区（SessionContextUsage）零改动**（§5.6 纪律延续）

**验证**：app typecheck + test + lint。提交 `feat(app): agent hub entry via dot-grid dropdown (M4)`

### Step 3 — Agent 视角聚合数据路径

**红**：聚合读路径测试——按 agentID 聚合的 task/scheduled job 视图数据正确（含跨 session 同 agent 的聚合、无 agent 的 task 归"未归属"）。

**绿**：
- 先 grep 现有资产再设计（红线：复用 → 新增）：`AgentV2.Service`（`packages/core/src/agent/`）、`agent-asset` handlers（`packages/aigcfroge/src/server/routes/instance/httpapi/handlers/agent-asset.ts`）、session 的 agent 绑定字段
- task 聚合数据源：`TaskTable.agent_id`（M3 已落列）跨 session 查询——如需新读端点，走 httpapi 管线（group + handler + `Effect.fn` 命名 + 4xx catchTag 模式）+ SDK 再生成（`./packages/sdk/js/script/build.ts`，生成 diff 一并提交）+ schema-changelog 记录
- model 层做聚合/派生（纯函数，仿 session-scheduled-tasks-model 范式）

**验证**：受影响包 typecheck + test + lint。提交。

### Step 4 — 定时任务完整管理 UI（agent 视角）

**红**：
- agent 视角定时任务列表（该 agent 名下全部 session 的 scheduled task）
- 新建 / 启停 / 删除操作测试；**删除 Agent 联动提示**：删除有 N 个 session + M 个定时任务的 agent 时，确认文案包含两个计数（计划 §3.1 A2）
- 写回路径测试：启停/删除走 task_schedule 的 pause/resume/remove 语义（M3 已交付，服务端 reconcile 保留式——省略字段不会抹掉调度配置，`task.ts:258-261` 已验证）

**绿**：弹层内 agent 详情区承载管理 UI；复用 M3 弹层的 checkbox/列表模式；删除 Agent 的联动提示走项目既有确认弹窗组件（先 grep 复用）。

**验证**：app typecheck + test + lint + 定向 E2E。提交。

### Step 5 — 三区结构收尾 + E2E

- 任务衍生区：**占位 UI**（文案 + disabled/coming-soon 态），不接逻辑，注释标注"接 M5 task_spawn"
- 新建入口：跳项目既有 agent 创建路径（先 grep agent 创建入口复用，不新造）
- E2E spec（`packages/app/e2e/regression/`，仿 session-scheduled-tasks.spec.ts 的 mock-server 模式）：打开入口 → agent 列表 → 聚合视图 → 启停一个定时任务 → 断言 PATCH 写回

**验证**：`bun --cwd packages/app run test:e2e`（定向）+ typecheck + lint。**M4 完成：同步 specs → 输出报告 → 停止等审批。**

---

## 5. 数据流全貌（M4 主线）

```
AgentV2 注册 / agent-asset            TaskTable.agent_id（M3 已落列）
        ↓                                     ↓
        └──────→ Agent 聚合读路径（Step 3，复用优先）←──────┘
                          ↓
              dot-grid"智能体"菜单项（§5.7 入口）
                          ↓
              AgentTaskHub 弹层（三区：我的智能体 / 任务衍生占位 / 新建）
                          ↓
        ┌── task 聚合视图（reconcile 保留式 PATCH 写回）
        └── 定时任务管理（task_schedule pause/resume/remove 语义）
                          ↓
              task.updated SSE → reconcile 刷新
```

---

## 6. 强制规则 + 审批红线（M0-M3 四轮审批的教训，违反即 REJECT）

### 流程规则
- 每 Step 完成后必须重读协议文件、跑 lint + typecheck + test；测试先红后绿；禁 `--no-verify`
- 里程碑结束同步 specs + SDK 再生成提交 + 输出报告，**停下等审批**
- 禁 as any / @ts-ignore / 改无关文件；工具归 `packages/core/src/tool/`（禁写入 V1 退役区 `packages/aigcfroge/src/tool/`）
- 阻塞问题：先报告现状和已试方案，请求决策，不绕过

### 审批红线（M0/M1 十条继承 + M2/M3 新增四条）
1. **V1 runtime 兼容**：默认 `AIGCFROGE_V2_RUNTIME=false` 路径零回归；M1-M5 不改 V1（§9.2）
2. **禁 `Effect.die` 处理预期失败**：业务拒绝用 `Schema.TaggedErrorClass`，HTTP 边界 catchTag 映射 4xx，tool 边界 mapError 保留 message（外层不得覆盖内层）
3. **Schema.Class 必须实例化**：多字段记录一律 `Schema.Class`，构造点用 `new X({...})`（TaskRecurrence 为已裁决例外，见 schema-changelog）
4. **每条触发路径都必须 settle + 防重入**：成功/失败/取消三分支回写 + in-flight guard（M3 B1 教训：executor 运行期间状态必须脱离"可被重新入队"的集合，先抢占再执行）
5. **Clean Logs**：digest 只允许固定分类短语，禁 raw error/stack 进事件或 outputDigest
6. **事件 payload 与 DB 一致**：落库回退/保留逻辑必须同步反映在 resolved Info 与事件 payload
7. **迁移纪律**：drizzle 管线 + migration.gen.ts 注册；新列可空或有默认值；ID 走 `Identifier.ascending`
8. **specs 零漂移**：交付什么同步什么；不写"pending"写事实
9. **UI 纪律**：颜色/间距/圆角全走 CSS 变量（`--v2-*` 优先）；边界只兜底"外部输入 + 计算除零"
10. **新增 finding 必须有回归测试**：不接受"手动验证过"
11. **新工具注册必须同步 subagent 默认 deny**（M2 教训：`task_schedule` 加了 deny、`task_spawn` 漏了构成旁路）——任何新 permission action 都要检查 `subagent-permissions.ts` + `agent.ts` 的默认 deny 链并补测试
12. **CSS token 使用前必须 grep 验证存在**（M2 教训：引用不存在的 `--v2-*` 导致 fallback 恒生效，硬编码 rgba 混进来）——引用前去 `packages/ui` 确认定义
13. **字段/功能跟着消费者里程碑走**（M2 裁决教训：M4/M5 内容因零消费者被整体移出 m2 分支）——无消费者不入分支；本分支只做 M4 三件套，M5 资产一律不碰
14. **unattended 语义**：新增任何后台/无人值守执行路径，权限兜底是 deny 不是 ask（`permission.ts:19-26` 哨兵模式），预授权走 saved ruleset

**已知延后（不在本期范围）**：Chat 模式 Agent Hub 聚合 tab（独立立项）；任务衍生实际逻辑（M5）；DAG 依赖（M5）；V1 物理删除（Phase 5）；拖拽排序；集群化调度。

<!-- PROMPT END -->

---

## 使用说明

| 项 | 值 |
|---|---|
| 复制范围 | `<!-- PROMPT START -->` 到 `<!-- PROMPT END -->` |
| 前置动作 | 确认 `todo-task-m2` 已合入 main 或接受从 m2 切分支（m2 未合入时 m4 基于 m2，m2 合入后 rebase） |
| 新对话打开文件 | `docs/plan/todo-task-system-upgrade.md`（范围真源，§5.7 入口决策）+ 本文件 |
| 开工顺序 | 通读 §0 清单 → `git checkout -b todo-task-m4`（基于 todo-task-m2）→ Step 1 资产回收 |
| 节奏 | 每 Step：红→绿→验证→重读协议→提交；里程碑结束：specs 同步 → 报告 → **等审批** |
| 卡住时 | 回报阶段 + 已过/未过测试 + 具体报错，不绕过 |
| 审批 | 由审查 agent 按差异审批流程复核（重点：§6 审批红线 14 条） |
