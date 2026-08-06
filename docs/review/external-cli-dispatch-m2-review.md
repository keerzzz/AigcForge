# M2 审批记录：外部 CLI 委派 UI 呈现闭环（2026-08-06，通过）

> 审批对象：执行智能体按 `docs/plan/prompt-external-cli-dispatch.md`（通用前置 + M1 补丁 + M2）产出的改动。
> 方案依据：`docs/plan/external-cli-dispatch-implementation.md` §4。前置：M1 已通过（`external-cli-dispatch-m1-review.md`）。

## 1. 改动清单

| 文件 | 摘要 |
|---|---|
| `packages/session-ui/src/components/task-tool-card-model.ts`（新建） | 纯函数 `taskCardModel(input, metadata, output)`：external-cli 识别、标题解析、四态映射、`<task_result>/<task_error>` summary 提取、href——渲染器无关，可单测 |
| `packages/session-ui/src/components/task-tool-card-model.test.ts`（新建） | 11 用例覆盖模型契约（含 running 态仅靠 input.execution_type 识别、timeout 从 task_error 文本区分） |
| `packages/session-ui/src/components/message-part.tsx` | `getToolInfo` task 分支与 task 卡片消费模型：terminal 图标 + CLI 徽标（i18n `ui.tool.cli`）、`hideDetails={!isExternalCli}`（subagent 保留 hideDetails 不回归）、状态 chip（failed/timeout 配色走 `data-state`）、summary 折叠区 |
| `packages/session-ui/src/components/message-part.css` | 新增 4 个 `data-component` 选择器样式，全部引用 v2 token（`--v2-border-border-muted`/`--v2-state-bg-danger` 等），无硬编码颜色 |
| `packages/app/src/pages/session/composer/session-permission-dock.tsx` | 渲染 `request.metadata` 的 execution_type/cli_target/description，独立 `permission-metadata` 区块，不动 patterns 列表 |
| `packages/app/src/pages/session/composer/session-permission-dock.test.tsx`（新建） | 源码 wiring 契约测试（遵循 `agent-task-hub.test.tsx` 惯例） |
| `packages/app/src/components/prompt-input/slash-popover.tsx` | 硬编码 `"CLI"` 徽标改走 `ui.tool.cli` |
| `packages/tui/src/routes/session/index.tsx` | `taskAgentLabel` 纯格式化函数：external-cli 标题取 `metadata.cli ?? input.cli_target ?? "CLI"` |
| `packages/tui/src/routes/session/permission.tsx` | `permissionTaskTitle`：external-cli 显示 `{Cli} CLI`，图标区分（λ/#） |
| `packages/tui/test/component/external-cli-task.test.ts`（新建） | 7 用例测两个纯格式化函数（帧断言的等价替代，见 §3 偏差声明） |
| `packages/tui/src/component/prompt/autocomplete.tsx` | `[CLI]` 统一为 `CLI`（TUI 无 i18n 体系，已声明） |
| `packages/ui/src/i18n/{en,zh,zht}.ts` | 新增 `ui.tool.cli`（语言政策：仅 en/zh/zht 为维护语言，其余 15 个冻结快照走英文回退，parity 测试证实） |

## 2. 验证证据

- session-ui：72 pass / 0 fail；tui：208 pass / 1 skip / 0 fail；app：637 pass / 0 fail（96 文件）。
- typecheck：session-ui / tui / ui（`tsgo --noEmit`）+ app（`tsgo -b`）全过。
- `bun run lint`：0 error，1 warning 为 M1 已登记的既有问题（`core/src/session/task.ts:71`，非本次引入）。
- i18n parity（ui + app 两处）通过；`packages/ui/src/i18n/parity.test.ts` 注释确认三语政策（2026-07-31），15 个冻结语言缺失 key 有英文回退，无遗漏风险。

## 3. 偏差声明（执行方主动申报，审批接受）

1. **TUI 帧断言 → 纯格式化函数测试**：`routes/session` 的 `Task()`/`PermissionPrompt` 依赖完整 sync/sdk 运行时，仓库无该 harness（`task-item.test.tsx` 也只测低层原语）。按 `inline-tool-wrap-snapshot` 先例抽纯函数测试，契约等价。**接受**；若后续建 routes 级 harness，这两个函数仍是渲染入口，无需返工。
2. **TUI 无 i18n 体系**：autocomplete 只能统一为硬编码 `CLI` 标签。**接受**（与 app 侧标签文案一致）。
3. **app 测试误报自修**：`agent-task-hub` 的 residue 扫描会命中新测试文件注释中的 "agent-task-hub" 字样，执行方改写注释规避。**接受**（规避合理，但提示该 residue 测试本身脆弱，记入额外发现）。

## 4. 审批结论

**M2 通过验收，无需修复项。** 卡片四点（CLI 徽标/可展开摘要/状态 chip/可跳转）三端齐；permission dock 显示委派目标；i18n 三语同步；门禁达标（v2 token、data-component/data-state、复用 BasicTool/sessionLink/taskAgent、无 star/alias import）。

轻微观察（不阻塞）：running 态 chip 与 spinner 并存略冗余；`getToolInfo` 与卡片两处都消费 `taskCardModel` 是一致的，无发散风险。

## 5. 额外发现（不在本次修复范围）

- `agent-task-hub` 的 composer residue 测试基于注释文本扫描，易被误伤——建议后续改为结构化标记。
- TUI 缺 routes 级渲染 harness——若 M5 任务卡片升级（ACP 实时进度）落地，届时需要评估补建。

## 6. 下一步

M3（声明式配置 + 三处探测解冻）开工。M1+M2 手动验收项（tmux TUI 调度 claude-code 看卡片徽标/摘要/状态、子会话双消息）建议在 M3 解冻探测后一并人工核对。
