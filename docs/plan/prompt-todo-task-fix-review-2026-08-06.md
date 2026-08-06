# 修复执行提示词：Todo/Task 升级审批打回项（1/2/3/4/5/6）

> 生成日期：2026-08-06
> 来源：高级顾问对当前未暂存变更（session_task revision 乐观锁 + 单任务 CRUD + task.progress 事件）的差分审批，结论「不予通过（3 BLOCKER + 3 MAJOR）」。本提示词覆盖全部 6 项；其中 MAJOR 4（subagent 权限清单）已经产品裁决（2026-08-06）：**默认 deny，理由见修复 4 正文**。
> 审批报告参考：`docs/review/` 目录下最新差分审查档案。

---

## 第 0 步：强制首读（未读完禁止动手）

按顺序阅读以下协议文本，提取与本次修复相关的门禁与规约：

1. `CLAUDE.md`（执行宪法：九荣九耻、四大拒绝、边界与运行安全、工程规约、改完即审流程）
2. `AGENTS.md`（代码风格、Effect 编码、Schema、测试、Type Checking 章节）
3. `ARCHITECTURE.md` §3 包拓扑与 §4 子系统边界（确认你改的文件属于哪一层、下游是谁）
4. `DESIGN.md`（仅 CSS 修复项需要：Token 体系、禁止硬编码）
5. Skills 文件：
   - `.aigcfroge/skills/database/SKILL.md`（迁移/快照规约，修复 1 必读）
   - `.aigcfroge/skills/frontend-theming/SKILL.md`（修复 6 必读）
   - `.aigcfroge/skills/effect/SKILL.md`（通则）
6. `packages/core/test/AGENTS.md`（测试 fixture 与模式，修复 2/3 必读）
7. 检查 `packages/core/AGENTS.md`、`packages/tui/AGENTS.md`、`packages/sdk/js/AGENTS.md`、`packages/app/AGENTS.md` 是否存在；存在则阅读其中与改动文件相关的条目。

## 第 1 步：建立上下文（上下游五层追踪）

本次未暂存变更的五层链路（先读代码再改，禁止臆断接口）：

```
packages/schema/src/session-task.ts        Info.revision 必填字段
packages/core/src/session/sql.ts           drizzle 表定义 revision 列
packages/core/src/session/task.ts          六个写方法递增 revision、recordProgress 发 task.progress 事件
packages/core/src/tool/task-{create,update,delete,reorder}.ts  新增 4 个内置工具（builtins.ts 已注册）
packages/aigcfroge/src/server/routes/instance/httpapi/{groups,handlers}/session.ts  patch/reorder 端点
packages/sdk/js/src/v2/gen/{types,sdk}.gen.ts  生成物（revision 字段已有，Event 联合缺 task.progress）
packages/app/src/context/{server-sync.tsx,global-sync/event-reducer.ts}  task.progress 消费
packages/app/src/pages/session/timeline/session-todo-progress.{ts,tsx}  revision 收窄 + expectedRevision 回写
```

阅读上述文件的**变更部分**（`git diff -- <file>`）与**测试代码**：

- `packages/core/test/session-task-service.test.ts`、`task-progress.test.ts`（本次新增，已通过）
- `packages/core/test/location-layer.test.ts`（当前失败，修复 2 的目标）
- `packages/core/test/` 中 `DatabaseMigration` 相关测试（当前失败，修复 1 的目标）
- `packages/tui/test/cli/cmd/tui/sync.test.tsx`、`packages/tui/test/plugin/task-todo-project.test.ts`（typecheck 失败，修复 3 的目标）
- `packages/app/src/pages/session/timeline/session-todo-progress-model.test.ts`、`packages/app/e2e/regression/session-todo-progress.spec.ts`（修复 6 的回归面）

## 第 2 步：TDD 工作流（每项修复都走红→绿→回归）

对每一项修复：

1. **红**：先运行该项的验证命令，确认复现审批报告的失败（失败信息应与下文描述一致；若不一致，停下来报告，不要硬修）。
2. **绿**：实施修复，重跑验证命令至通过。
3. **回归**：运行受影响包的完整检查（命令见第 4 步验收清单），确认无新增失败。
4. 修复过程中发现审批报告之外的问题：**不要顺手修**，记录到交付报告的「额外发现」一节。

测试纪律（来自协议）：只在包目录内跑 `bun --cwd packages/<name> test --timeout 30000`，**永不从仓根跑测试**；typecheck 用 `bun --cwd packages/<name> typecheck`，禁止直接调 `tsc`。

---

## 第 3 步：五项修复

### 修复 1（BLOCKER）：drizzle 快照基线 `packages/core/schema.json` 与迁移脱节

**问题**：本次变更手写了 `packages/core/src/database/migration/20260806000001_add_task_revision.ts` 并手改了 `migration.gen.ts`/`schema.gen.ts`，但生成器的快照基线 `packages/core/schema.json` 未更新（`revision` 在其中出现 0 次）。`DatabaseMigration > declared schema has no ungenerated migrations` 测试因此失败——drizzle 以陈旧快照为基线算出幻影 diff `ALTER TABLE task ADD revision integer DEFAULT 1 NOT NULL;`。

**修复步骤**：

1. 先确认手写迁移 SQL 与 drizzle 将生成的 SQL 一致（应为 `ALTER TABLE \`task\` ADD \`revision\` integer DEFAULT 1 NOT NULL;`，可从失败测试输出中核对）。
2. 删除手写迁移文件 `packages/core/src/database/migration/20260806000001_add_task_revision.ts`。
3. 还原两个手改文件：`git checkout -- packages/core/src/database/migration.gen.ts packages/core/src/database/schema.gen.ts`（它们的 diff 各只有 +1 行，均与本次手写迁移相关，还原安全——执行前自行 `git diff` 确认）。
4. 运行生成器：`bun --cwd packages/core script/migration.ts --name add_task_revision`。它会一次性产出：新迁移文件（drizzle 时间戳命名）、更新 `schema.json` 快照、再生成 `schema.gen.ts` 与 `migration.gen.ts`。
5. `git diff` 检查产物：`schema.gen.ts`/`migration.gen.ts` 应与还原前的工作区版本等价（仅迁移文件名可能不同）；若出现无关 diff，停下来报告，禁止手改生成物。
6. **验证**：`bun --cwd packages/core test --timeout 30000 test/` 中 DatabaseMigration 相关测试通过（或先跑 `bun --cwd packages/core script/migration.ts --check`，退出码 0）。

### 修复 2（BLOCKER）：`packages/core/test/location-layer.test.ts` 工具期望清单陈旧

**问题**：`builtins.ts` 新增了 `task_create`/`task_update`/`task_delete`/`task_reorder` 四个内置工具，但 `:132` 和 `:162` 两处硬编码的排序后期望数组未同步，`LocationServiceMap > isolates location state…` 失败。**两处清单都陈旧，只修第一处会冒出第二次失败。**

**修复**：两处数组均按排序序插入四个名字——`"task"` 之后、`"task_schedule"` 之前插入 `"task_create"`、`"task_delete"`、`"task_reorder"`；`"task_spawn"` 之后、`"taskwrite"` 之前插入 `"task_update"`。

**验证**：`bun --cwd packages/core test --timeout 30000 test/location-layer.test.ts` 全绿。

### 修复 3（BLOCKER）：tui 测试 fixture 缺必填 `revision`

**问题**：SDK `SessionTaskInfo.revision` 已是必填，两处 tui 测试字面量未同步，`bun --cwd packages/tui typecheck` 报 2 个 TS2741/TS2322（已实测复现）：

- `packages/tui/test/cli/cmd/tui/sync.test.tsx:80` — fixture 对象补 `revision: 1`
- `packages/tui/test/plugin/task-todo-project.test.ts:6` — fixture 对象补 `revision: 1`
- 顺带对齐：`sync.test.tsx:106` 的 `session.task` hydrate mock（非类型化 JSON，不报错但与真实载荷不符）同样补 `revision: 1`

**验证**：`bun --cwd packages/tui typecheck` 通过；`bun --cwd packages/tui test --timeout 30000` 全绿。

### 修复 4（MAJOR，已裁决：默认 deny）：subagent 权限清单同步新 CRUD 工具

**裁决背景（先读，理解后再改）**：新增的 `task_create`/`task_update`/`task_delete`/`task_reorder` 是 `taskwrite` 的功能等价物，但两处 subagent 默认 deny 清单未收录，「子代理默认不写任务列表」的控制被静默绕过。产品裁决（2026-08-06）：**不需要子代理任务进度上报（P2-b），只要最终结果**——故默认 deny。注意 P2-b 不会因此焊死：两处清单都是「默认拒绝、显式放行」模式（agent 配置显式授权则不追加 deny），自定义 agent 仍可 opt-in 启用进度上报。此裁决已如实接受「默认 general 子代理下 P2-b 进度脉冲不触发、父 UI 脉冲保持 indeterminate」的后果（作者残余风险 #3 已声明该场景无回归）。

**修复步骤**：

1. `packages/aigcfroge/src/agent/subagent-permissions.ts:20-37`——按既有 `canTaskwrite` 模式为四个新工具各加一条：先 `const canTaskCreate = input.subagent.permission.some((rule) => rule.permission === "task_create")`（其余三个同理），再在返回数组中追加 `...(canTaskCreate ? [] : [{ permission: "task_create" as const, pattern: "*" as const, action: "deny" as const }])` 等四条，紧跟现有 taskwrite 条目之后。加一行注释说明裁决：「task_* 增量工具默认 deny（2026-08-06 裁决：子代理只交付结果、不维护任务进度；显式授权可 opt-in 启用 P2-b 进度上报）」。
2. `packages/core/src/plugin/agent.ts:276-283`——`general` 子代理的 `PermissionV2.merge(defaults, [...])` deny 列表中，`taskwrite` 条目之后插入 `{ action: "task_create", resource: "*", effect: "deny" }` 等四条（`task_update`/`task_delete`/`task_reorder` 同），并加同款裁决注释。
3. **确认权限名拼写**：deny 规则里的 permission/action 字符串必须与 `builtins.ts` 注册的工具名完全一致（`task_create` 等，下划线），写错拼写等于没 deny——改完后 grep 两处文件确认四个名字与 `packages/core/src/tool/builtins.ts` 的注册名逐字一致。
4. `packages/core/test/agent.test.ts:152` 附近的 general 子代理权限回归清单，补四个新工具的 deny 断言；同时在 `packages/aigcfroge` 下 grep `subagent-permissions` 的既有测试，若有对应断言清单同步补齐，若无则为四个新工具补一条「未显式授权 → 默认 deny；显式授权 → 不追加 deny」的用例（沿用该文件既有测试模式）。

**验证**：`bun --cwd packages/core test --timeout 30000 test/agent.test.ts` 与 `bun --cwd packages/aigcfroge test --timeout 30000`（subagent-permissions 相关用例）全绿；`bun --cwd packages/aigcfroge typecheck` 通过。

### 修复 6（MAJOR）：`packages/app/src/index.css` 失效 token 与死选择器

**问题 A**：`:234`、`:235`、`:326` 引用了不存在的 token `--v2-state-fg-error`——`packages/ui/src/v2/styles/theme.css` 只定义 `--v2-state-fg-danger`（:61/:176/:278/:387），全仓无 `--v2-state-fg-error` 定义，failed 任务节点的背景/边框与面板 failed 文案颜色因此全部失效（var() 未定义 → 属性 unset）。
**修复 A**：三处改为 `var(--v2-state-fg-danger)`。

**问题 B**：`:325`/`:329` 新增的 failed/scheduled 面板文案规则用了 `[data-component="session-todo-progress-checkbox-label"]`，而 JSX 实际属性是 `data-slot`（`packages/app/src/pages/session/timeline/session-todo-progress.tsx:264`），选择器永不命中。`:315`/`:320` 的 completed/cancelled 两条是同一根因的既有错位（提交 `056e00430` 起）——按根因收敛原则**四条一并修**，不顺手扩大其他范围。
**修复 B**：四条选择器统一改为 `[data-slot="session-todo-progress-checkbox-label"]`。

**验证**：

- `grep -n "v2-state-fg-error" packages/app/src/index.css` 无输出；`grep -c 'data-component="session-todo-progress-checkbox-label"' packages/app/src/index.css` 为 0。
- `bun --cwd packages/app typecheck` 通过；`bun --cwd packages/app test --timeout 30000` 全绿。
- 若本机 Playwright 环境可用，运行 `packages/app/e2e/regression/session-todo-progress.spec.ts` 对应 e2e（按 packages/app 的 e2e 运行方式）；不可用则在交付报告中标注「e2e 未验证，failed/scheduled 颜色需人工截图确认」。**注意**：现有 e2e 只断言 `data-state` 属性、不断言颜色，测试全绿不能证明颜色修复生效——如断言 computed style 成本低可补一条，否则如实记录。

### 修复 5（MAJOR）：SDK 生成物与 core 事件契约不同步

**问题**：core 新增了 `SessionTask.Event.Progress`（type `"task.progress"`，见 `packages/core/src/session/task.ts` 的 EventV2.define），但 `packages/sdk/js/src/v2/gen/types.gen.ts` 的 `Event` 联合缺 `EventTaskProgress`（全文 grep 无 `task.progress`）——gen 是在事件加入 core **之前**生成的。app 端目前靠松类型 + `server-sync.tsx` 自定义的 `TaskProgressSnapshot` 平行类型绕过。

**修复步骤**：

1. 从仓根运行 `./packages/sdk/js/script/build.ts` 再生成 SDK。
2. 验证：`grep -n "task.progress\|EventTaskProgress" packages/sdk/js/src/v2/gen/types.gen.ts` 有命中。
3. `git diff packages/sdk/js` 审查生成 diff：若出现与本次无关的大量 churn（其他端点漂移），如实报告，禁止手改 gen 文件。
4. 对齐 app 的平行类型：将 `packages/app/src/context/server-sync.tsx` 的 `TaskProgressSnapshot` 与生成类型逐字段比对（sessionID/taskID/phase/progress?/current?/total?/updatedAt）。若生成类型可直接复用，替换平行声明并更新 `event-reducer.ts`/`bootstrap.ts` 的 import；若生成类型形态不适合直接消费（如 hey-api 的数字联合），保留收窄逻辑但加注释指向生成类型，并在交付报告中说明取舍。**不做超过此范围的 app 重构。**
5. **验证**：`bun --cwd packages/sdk/js typecheck`、`bun --cwd packages/app typecheck`、`bun --cwd packages/tui typecheck`（SDK 类型下游）全部通过。

---

## 第 4 步：验收清单（全部通过后交付）

```bash
bun --cwd packages/core typecheck
bun --cwd packages/core test --timeout 30000        # 1509 pass / 0 fail（当前 1507/2 fail）
bun --cwd packages/tui typecheck
bun --cwd packages/tui test --timeout 30000
bun --cwd packages/sdk/js typecheck
bun --cwd packages/app typecheck
bun --cwd packages/app test --timeout 30000
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/aigcfroge test --timeout 30000
bun run lint                                         # 仓根 oxlint
```

## 边界（红线）

- **只修上述六项**（含各自注明的顺带项：修复 3 的 mock 对齐、修复 6 的两条既有死选择器）。其余审批发现（MINOR 清单）一律不动。
- 禁止 `git commit`/`git add` 等任何 git 变更操作；唯一的 git 写操作是修复 1 中注明的 `git checkout --` 两个文件。
- 禁止从仓根跑 `bun test`；禁止直接调 `tsc`。
- 生成物（`schema.gen.ts`/`migration.gen.ts`/`sdk/js/src/v2/gen/*`）只通过生成器更新，禁止手改。
- 任何与审批报告描述不符的实际现象（失败信息不同、文件行号漂移、生成 diff 异常），停下来如实报告，不要猜测硬修。

## 交付报告格式

```text
修复交付报告:
- 已完成修复: [逐项列出 1/2/3/4/5/6 的实际改动文件与行数]
- 验证命令结果: [逐条列出验收清单命令与通过/失败]
- 生成物 diff 摘要: [schema.gen/migration.gen/sdk gen 的 diff 是否仅含预期内容]
- 额外发现: [修复过程中发现的报告外问题，未修]
- 未验证项与风险: [如 e2e 未跑、颜色需人工确认等，如实声明]
```
