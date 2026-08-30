# 会话右栏统一底座归一化 · TDD 实施计划

> 状态：Approved（2026-08-14）
> 范围：`packages/app` 会话右栏 A/B 双区归一化，四模式（coding/chat/work/assistant）统一底座。
> 关联：`assistant-session-detail-plan.md`（回退其 2026-08-13 F1「自包含单面板」修正）、`ARCHITECTURE.md` §4.10、`ADR-15`。

## 1. 背景与问题

会话详情页右栏目前有 4 份实现，其中 coding/chat/work 三份各自复制同一套壳，assistant 是自包含单面板、完全没接通用交互：

| 模式      | 文件                          | 壳 `id`        | 开合状态                            | context tab | 文件 tab/拖拽 | B 区 fileTree     |
| --------- | ----------------------------- | -------------- | ----------------------------------- | ----------- | ------------- | ----------------- |
| coding    | `session-side-panel.tsx`      | `review-panel` | `isDesktop && reviewPanel.opened()` | 动态        | ✅            | `SessionFileTree` |
| chat      | `chat-right-panel.tsx`        | `review-panel` | `reviewPanel.opened()`              | 动态        | ✅            | `SessionFileTree` |
| work      | `work-artifact-panel.tsx`     | `review-panel` | `reviewPanel.opened()`              | 固定        | ❌            | `SessionFileTree` |
| assistant | `assistant-session-panel.tsx` | ❌ 无          | `assistant().opened`（另一套）      | 固定        | ❌            | ❌ 无             |

由此产生三个错位：header `sidebar-right` 图标（`aria-controls="review-panel"`）在 assistant 模式无效；上下文圆环 `toggleEntityPanel` 把「单个 tab 开合」错做成「关整个面板」；assistant 无「关闭单个 tab」。

计划文档 F1 修正当时因「无共享 A/B 骨架」退回自包含单面板。本计划建立该骨架并归一化。

## 2. 决策（已确认）

1. **视觉归一**：work 面板的 `border-l` 平面样式**回归** `raised`（圆角 + 阴影），与 coding/chat 一致。
2. **assistant B 区**：**同 work** —— 接 `SessionFileTree`，内容为项目文件树（`FileTree path=""`），默认关闭（「有，但不显示」）。
3. **UI 复用优先**：统一底座是对**既有三份壳的归并**，复用现成 `TabsV2`/`SortableTab`/`SessionContextTab`/`FileTabContent`/`FileTree`/`SessionFileTree`/`DragDrop*`，**不手写新的视觉组件**。
4. **assistant tab 全动态**（2026-08-14 中途追加）：5 个固定 tab（提醒/记忆/知识库/笔记编辑器/上下文）**全部拆为动态 tab** 走 `tabs()`，不只 context —— 对齐 code/chat 的「动态 tab + 单个关闭」。`assistant()` 状态随之从 `{opened,tab,target}` 收窄为 `{target}`。

## 3. 上下游 5 层映射

| 层                   | 文件                                                                                                     | 本次动作                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| L1 状态/上下文       | `context/layout.tsx`（`view().reviewPanel`、`tabs()`、`assistant()`、`fileTree`）                        | `assistant()` 收窄为 `{target,setTarget}`；删 `opened/tab/close`，tab 管理迁入 `tabs()` |
| L2 顶部模块/通用接线 | `session-header.tsx`、`use-session-commands.tsx`、`session-context-usage.tsx`、`open-session-context.ts` | header/命令无需改（统一后自动生效）；圆环 assistant 分支改 toggle 动态 context tab      |
| L3 槽位路由          | `session-side-panel.tsx`                                                                                 | 4 槽位统一委托新底座                                                                    |
| L4 面板组件          | coding(内联)/chat/work/assistant 四面板                                                                  | 瘦身为 A 区内容注入                                                                     |
| L5 共享壳/helpers    | `session-file-tree.tsx`、`session/helpers.ts`、`file-tabs.tsx`、`components/session`                     | 复用；新增 A 区壳组装（归并，非新 UI）                                                  |

## 4. 复用清单（reuse → delete → merge → refactor → add）

**reuse**：`SessionFileTree`、`SortableTab`、`FileVisual`、`SessionContextTab`、`FileTabContent`、`FileTree`、`TabsV2`、`DragDropProvider/Sensors/Overlay/SortableProvider`、`createSessionTabs`、`createOpenSessionFileTab`、`getTabReorderIndex`、`createSizing`、`shouldShowFileTree`、`createFileTabListSync`、`ConstrainDragYAxis`、`getDraggableId`。

**merge**：A 区 aside 壳（`id="review-panel"` + 开合宽度 + 过渡 + inert）三份 → 一份 `SessionRightPanel`；文件 tab + 拖拽 + 动态 context 组装 code/chat 两份 → 一份 `SessionRightTabs`。

**delete**：`assistant().opened` 状态、`AssistantSessionPanel` 自包含 aside 壳、`toggleEntityPanel` 的「面板开且在 context → 关整面板」错误分支、`ASSISTANT_PANEL_MIN_WIDTH/DEFAULT_WIDTH` 残留。

**refactor**：assistant 5 固定 tab → 5 动态 tab（entity + context 全走 `tabs()`，对齐 code/chat 的动态 tab + 单个关闭）。

**add**（唯一）：`SessionRightPanel` 壳 + `SessionRightTabs` 组装 —— 均为归并产物，非新视觉组件。

## 5. 目标形态

```
SessionRightPanel(props: {
  size: Sizing
  fileTree?: JSX.Element      // B 区 children；assistant/work = 项目 FileTree，默认关闭
  children: JSX.Element       // A 区（tab 栏 + content）
  tabs?: JSX.Element          // A 区 tab trigger 列表（模式差异）
})
```

壳统一负责：`id="review-panel"` aside + `isDesktop && reviewPanel.opened()` 开合 + `panelWidth`(open? reviewOpen?auto:fileTreeWidth:0px) + 过渡 + inert + `SessionFileTree` B 区槽 + `raised` 视觉。header 图标 / `aria-controls` / `review.toggle` 命令**只在此接线一次**。

## 6. TDD 切片（先红后绿；测试为源码契约测试，见 §7）

> **实施状态（2026-08-14）**：Slice 0/1/3/4 已完成并全绿（typecheck + lint + 840 单测 0 fail）；Slice 2 暂缓（可选后续重构）。

- **Slice 0 契约基线（红）** ✅：新增 `session-right-panel.test.tsx`，断言四面板委托统一壳、壳含 `id="review-panel"`+`reviewPanel.opened()`+`<SessionFileTree`、assistant B 区同 work。
- **Slice 1 抽壳（纯移动，无行为变化）** ✅：新建 `SessionRightPanel`，coding/chat/work 三份 aside 壳归并；`session-file-tree.test.tsx` 断言更新为新结构。
- **Slice 2 抽 A 区 tab 组装** 🔶 部分完成：抽出 `SessionContextTabTrigger`/`SessionContextTabPanel`（context tab 组装，coding/chat/assistant 三处归并）。剩余「拖拽 + 文件 tab + sticky 包装 + 空态 + plus 按钮」的完整 `SessionRightTabs` 框架抽取因布局差异（sticky/空态/plus）需视觉验证，暂缓。
- **Slice 3 assistant 接入底座** ✅：`AssistantSessionPanel` 改用底座 + `reviewPanel.opened()`；**5 tab 全拆为动态**（`tabs()`）；`assistant()` 收窄为 `target`；B 区接 work 项目 FileTree；圆环 assistant 分支删除、走通用 `openSessionContext`/`tabs().close("context")`；`openEntityPanel` 改为 `{view,tabs,assistant,kind,itemId}` 信号。
- **Slice 4 归一化细节 + 清冗余** ✅：work 回 `raised`；删 `toggleEntityPanel`/`assistant().opened/tab/close`/常量残留；注释英文化；修 `unbound-method`。

## 7. 测试矩阵

> 约束：app 无 solid-testing-library，UI 契约用「源码契约测试」（`fs.readFileSync` + `toContain`），纯逻辑抽 helper 补真实单测。

| 测试文件                                     | 断言                                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-right-panel.test.tsx`（新）         | 四面板委托壳；壳含 `id="review-panel"`/`reviewPanel.opened`/`SessionFileTree`；work/assistant 视觉统一 `raised`；assistant B 区同 work FileTree |
| `assistant-session-panel.test.tsx`（改）     | 委托壳、无自包含 aside、context 动态、B 区接 `SessionFileTree`                                                                                  |
| `assistant-session-panel-open.test.ts`（改） | `openEntityPanel` 只切 tab 不关整面板；context 走 `tabs()`                                                                                      |
| `session-file-tree.test.tsx`（扩）           | assistant 也委托 `SessionFileTree`                                                                                                              |
| helpers/model 单测                           | `createSessionTabs`/`shouldShowFileTree` 边界                                                                                                   |

## 8. 门禁与命令

```bash
bun run script/lint-changed.ts          # 增量 lint
bun --cwd packages/app typecheck        # tsgo -b
bun --cwd packages/app test --timeout 30000
# UI 验证：/mode/{coding,chat,work,assistant} 右栏开合/圆环/关 tab/窄屏/light-dark
```

命中 skills：`reuse-first-refactor`、`enterprise-code-standard`、`frontend-theming`（v2 token）、`protocols`（`ARCHITECTURE.md` §4.10 + ADR-15）、`quality-to-pr`。

## 9. 风险

| 风险                                                       | 等级 | 缓解                                           |
| ---------------------------------------------------------- | ---- | ---------------------------------------------- |
| assistant context 改动态 tab 牵动 `assistant().tab/target` | 中   | Slice 3 单独切片 + 状态迁移测试                |
| 三份壳归并引入行为漂移                                     | 中   | 逐模式回归 + `session-file-tree.test.tsx` 兜底 |
| 契约测试只测源码字符串、不测运行时                         | 既有 | 补 Playwright e2e 覆盖四模式开合               |
| work 回 `raised` 视觉变化                                  | 低   | 已确认，统一为 coding/chat 样式                |
