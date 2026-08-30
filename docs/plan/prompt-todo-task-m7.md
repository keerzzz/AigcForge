# M7 执行提示词 — SessionTodoProgress 统一轨道 UX 重构

> 角色：执行 agent。逐 Step 红→绿推进，每步自验后**停下等审批，不 commit**（审批员复核后统一提交）。
> 上游：计划 `docs/plan/todo-task-system-upgrade.md` §5.8（M7 决策全录，先读）+ §5.5（边界兜底，仍然有效）；specs `specs/v2/todo.md`（M2 限制①修订、M7 条目）。
> 分支：`todo-task-m7`（从集成分支 `todo-task-m2` tip 切出，M0-M6 + 三轮审批修复 `4f300f3c6` 已全部闭环）。
> 协议：CLAUDE.md 第一性原理 + 改完即审流程；DESIGN.md（quiet/dense、布局稳定、i18n、无障碍）；AGENTS.md 风格门禁；命中 skills：`frontend-theming`（涉主题配色/动画，先读 `.aigcfroge/skills/frontend-theming/SKILL.md`）。每步复查结论必须按协议模板输出（影响文件/命中 skills/安全门禁/工程门禁/已运行命令/剩余风险）。

## 1. 背景与目标

M2 脉冲线上线后实测暴露 7 项缺陷，审批与设计双通道已确诊根因（**已核实，不要重新调研根因，直接按 §5.8 决策实施**）：

- 首尾节点裁切：model `pct = i/(total-1)*100` 把首节点钉 0%、末节点钉 100%，节点 8px + `margin-left:-4px` 半溢出视口，且统计按钮 `right:0` 压在末节点头顶
- 填充/节点双错位：填充 `top:0; height:2px`（线心 y=1）vs 节点 `top:0; height:8px`（圆心 y=4）；填充按 `doneRatio` 比率裁剪 vs 节点按 `i/(total-1)` 索引排布，两套语义永不对齐
- 统计不更新（⑦ session_task 静态锁定）：`session-todo-progress.tsx:44-49` 偏好逻辑「`session_task[id]` 非空即永远使用」+ `:58-78` 挂载播种——一旦播种成功，`todo.updated` 通道的实时更新被永久忽略（V1 runtime 必现）
- 折叠面板无 dismiss layer（只有 `toggleOpen`），打开后常驻遮挡标题行右侧 more-options 图标
- 顶部不明白块：**身份未指认**——Step 1 先用 playwright 截图+元素检查定位，不得盲改

**目标**：按 §5.8 决策 1-8 全部落地——统一轨道下移标题行下方、四态状态机（含 idle 静态留存，修订 M2 限制①）、几何修复（8px 内缩/10px 带勾节点/圆心压线/填充索引语义）、双脉冲动画、面板外部关闭、⑦ freshness 修复、④ 白块指认后处理。

## 2. 关键事实（已核实）

- 组件三件套：`packages/app/src/pages/session/timeline/session-todo-progress.tsx`（188 行）+ `session-todo-progress-model.ts`（纯逻辑，pct/doneRatio/降采样/anchor）+ CSS `packages/app/src/index.css:26-204`（whip keyframes :27-41、容器 :43-63、M2 段 :65-204）
- 挂载点：`message-timeline.tsx:1387-1402`——`session-progress` 容器在 sticky 标题栏内、标题行**之前**；显隐由 `<Show when={workingStatus() !== "hidden" && settings.general.showSessionProgressBar()}>` 控制；`:1391` 有 todos 时 `aria-hidden` 移除；sticky 头部渐变在 `:1378`（`--background-stronger` 实色 48px → 渐隐，轨道下移后需按 §5.8 决策 9 延伸实色段覆盖轨道区，**保持 v1 token 不换**）
- whip 条颜色来自行内 `tint() ?? var(--icon-interactive-base)`（v1 token，`:1396`）——统一轨道迁移时环境脉冲改走 `--v2-icon-icon-accent` 50% 柔光（`color-mix`），注意保持 agent tint 语义或如实记录取舍
- 双数据源：`serverSync().data.session_task[id]`（task.updated SSE + GET 播种）与 `serverSync().data.session_todo[id]`（todo.updated + `sync().session.todo` 拉取）；事件入口 `context/global-sync/event-reducer.ts`、`context/server-sync.tsx`
- 既有测试：`session-todo-progress-model.test.ts`（171 行，pct/doneRatio/降采样/flipTaskStatus）+ e2e `e2e/regression/session-todo-progress.spec.ts`（4 用例：节点+折叠+PATCH 回写、reload 恢复、id 稳定往返、V1 只读降级；断言节点带 `title` 属性）+ mock `e2e/utils/mock-server.ts`
- i18n：三语言（en/zh/zht）有 `session.todo.progress` 等 key，其余 16 语言走 en fallback；新增「任务列表」key 只需三语言
- token：`--v2-icon-icon-accent`、`--v2-text-text-muted`、`--v2-background-bg-*`、`--v2-state-*` 成功色族（确切名称 grep `packages/ui/src/v2/styles/` 确认）；节点小勾可用 `packages/ui/src/v2/components/icon.tsx` 既有 check 图形或 inline SVG（DESIGN.md：不引外部图标库）

## 3. 目标范围

| 件                 | 范围                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ① ⑦ freshness 修复 | 双源按新鲜度选择（如记录各源最近更新戳/来源标记），V1 下播种数据不锁死 `todo.updated` 实时流；含单测                                                                                                                                                                                                                                                                                                 |
| ② ④ 白块指认       | playwright 对 mock 环境截图 + 元素检查，报告元素身份；属本组件则修，非本组件如实记录不动                                                                                                                                                                                                                                                                                                             |
| ③ model 几何       | pct 映射加轨道内缩（两端 8px 等效百分比由轨道宽度换算或 CSS 侧 inset，选型需注释理由）；**填充终点改索引语义**（anchor pct / 无 anchor 取最后完成节点 pct / 全完成 100 / 无 in_progress 无 anchor）；既有除零/降采样/归一化兜底保留                                                                                                                                                                  |
| ④ 统一轨道迁移     | `session-progress` 容器从标题行上方移到**下方**（同一 sticky 容器，absolute 零占位）；显隐条件改状态机：无 TODO 且 working=环境脉冲、有任务=交互条（working 带动画 / idle 静态留存）；无 TODO 时左侧文本/节点/统计**不渲染**；**可读性遮蔽（§5.8 决策 9）**：sticky 头部渐变实色段从 48px 延伸到覆盖轨道区（按轨道实际落点校准），token 保持 `--background-stronger` 不换，不加任何轨道模块背景/pill |
| ⑤ 组件视觉         | 10px 节点圆心压线、完成态 accent 实心+小勾、anchor 呼吸光晕、左「任务列表」i18n 文本、右统计（全完成切 `--v2-state-*` 成功色、宽度不变）、面板从轨道下缘展开 + **点击外部关闭**                                                                                                                                                                                                                      |
| ⑥ 双脉冲           | 环境脉冲：复用 clip-path 扫描，~1.4s 周期含停留段 + 50% 柔光；任务脉冲：高亮段 `[--pulse-from, --pulse-to]` 区间往返（CSS 变量+keyframes，无 JS 帧循环），无 anchor 不跑                                                                                                                                                                                                                             |
| ⑦ 测试 + 文档      | model 单测（索引语义/内缩/状态机）+ 组件/e2e 行为断言（见各 Step）；`specs/v2/todo.md` M7 行 ✅ 化 + M2 限制①移除作废标记；计划 §8 如涉延后项同步                                                                                                                                                                                                                                                    |

**退出条件**：四态状态机各态渲染正确；统计实时更新（V1/V2 双 runtime 语义）；几何无裁切无错位；面板可外部关闭；e2e 全绿；specs 声明=行为。

**明确不做**：L1-L4（schema/core/server/SDK）与 tui/plugin 任何改动；节点下文字标签/百分比徽标/节点内数字/大卡片布局/宽度变化 pill（§5.8 已裁决否决）；自动展开面板；composer 区任何改动；拖拽排序。

## 4. Step 分解

### Step 1 — ⑦ freshness 修复 + ④ 白块侦查

**红**：双源 freshness 单测——模拟「播种 session_task 后 todo.updated 继续到达」，断言显示跟随更新的源；V1 场景（无 task.updated）断言不被播种锁死。
**绿**：按 §3-① 实施（改动尽量收在 server-sync/event-reducer/组件数据源 memo 之一处，不新建平行 store）。
**侦查**：playwright mock 环境截图 + `page.evaluate` 元素检查指认白块元素（selector/computed style），结果写进复查结论。
**验证**：`bun --cwd packages/app typecheck` + `bun --cwd packages/app test --timeout 30000`。停下等审批。

### Step 2 — model 几何重构

**红**：单测——填充终点索引语义（有 anchor 止 anchor / 无 anchor 止最后完成 / 全完成 100 / 单节点 / 空数组）；内缩后首末节点 pct 不再贴 0/100；既有降采样/归一化/flipTaskStatus 回归。
**绿**：按 §3-③ 改 model（保持纯函数，组件只消费）。
**验证**：typecheck + test。停下等审批。

### Step 3 — 统一轨道迁移 + 状态机 + 视觉 + 双脉冲

**红**：组件/e2e 断言——轨道渲染在标题行下方（相对位置断言）；无 TODO 时无文本/节点/统计；激活后出现；idle 静态留存（无动画类）；全完成统计成功色；面板点击外部关闭。
**绿**：按 §3-④⑤⑥ 实施。CSS 全 token 无硬编码；新 i18n key 三语言；`role="progressbar"` 与 aria 属性保留；节点 `title` 属性保留（既有 e2e 断言依赖，M2 偏差声明仍有效）。
**验证**：typecheck + test + `bunx oxlint --config .oxlintrc.json <改动文件>` + 改动文件 `prettier --check`。停下等审批。

### Step 4 — e2e + 文档收官

- 更新 `session-todo-progress.spec.ts` 受影响断言（位置/状态机/外部关闭/freshness），新增覆盖：idle 静态留存、全完成成功色、统计实时更新
- `bunx playwright test e2e/regression/session-todo-progress.spec.ts e2e/regression/session-scheduled-tasks.spec.ts e2e/regression/agent-task-hub.spec.ts --project=chromium` 全绿
- `specs/v2/todo.md` M7 行 ✅ 化 + M2 限制①正式移除；计划 §5.8 标注已落地；输出 M7 里程碑复查结论，停止等审批

## 5. 审批红线（沿用 M4/M5/M6，违反即 REJECT）

- **只动 `packages/app` + 文档**——core/server/SDK/schema/tui/plugin 出现任何 diff 直接打回
- composer 区/`SessionContextUsage` 零改动；`message-timeline.tsx` 仅限挂载点移动 + 显隐条件 + 必要 import
- CSS 无硬编码颜色/尺寸常量（走 `--v2-*` token，px 几何常量除外但需注释）；新组件/状态优先 v2 token
- 无 TODO 时环境脉冲与现 whip 机制同源（复用 clip-path 扫描），仅位置/节奏/透明度参数化——不得新写一套动画引擎
- 声明=行为：specs/plan 文档语义必须和代码一致（本仓历史抓过 spec 误述，commit `839f5c9e9`）；交互功能必须有行为断言测试，渲染断言不算数
- 无 `as any`/`@ts-ignore`；外部输入先判空；测试禁 `Effect.sleep`/`setTimeout` 等并发
- 禁 `console.log`/`.only`/注释掉的断言等调试残留；改动文件 prettier 合规
- 每 Step 停在审批点，不 commit、不 push、不做 git 历史改写；自报结果必须附真实命令输出（审批员禁止采信无证据自报）
