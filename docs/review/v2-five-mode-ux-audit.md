# AigcForge v2 · 五模式真实用户 UX 评审 + CLAUDE.md 复审

> **评审方式**：5 个独立子智能体，各绑定一个真实用户画像 + 一个模式，强制「无 `file:line` 不下结论」并附「未能证实」一节；由高级 UX 顾问派发、交叉校验、收敛。
> 随后按 `CLAUDE.md`「改完即审」7 步 + `.aigcfroge/skills/reuse-first-refactor` 四阶段，把结论本身当作**待审 diff** 重跑一遍，抓出并撤回了 6 条自身错误。
> **日期**：2026-09-20
> **工作树**：`/media/win_data/aigcfroge`，分支 `global-shell-e2e`（HEAD `a0d1a6e97`）
> **性质**：本文件是**评审记录**，不是执行授权，也不构成对任何 ADR / 产品契约的修改。

---

## 0. 阅读前必读：结论的时效性边界

**本评审读取的是 `global-shell-e2e` 的工作树**，而该分支相对 `origin/main` 领先 **135 个提交 / 212 个文件**（`git rev-list --left-right --count origin/main...HEAD` = `0 135`）。

因此下列结论**只对该分支的工作树成立**，不适用于 `origin/main`：

| 结论                                                   | 该分支已落地的修复提交                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| B 区窄屏已有入口                                       | `b5fba3411 feat(app): give the mode content panel a narrow-width entry`                        |
| 浮层已有 Escape + 焦点回收                             | `86ca86f2a feat(app): give the floating panel Escape and focus restore`                        |
| 窄屏改为浮层而非停靠                                   | `b4050f363 feat(app): float the mode panel below lg instead of docking it`                     |
| panel 的 aria-controls / breakpoint / focus 绑定真实化 | `d874211b6`、`4ce3fb44b`                                                                       |
| Custom 两个未命名按钮已修                              | `cf618ba3b fix(app): name the two unnamed Custom dismiss buttons, and re-home the persona RED` |
| Custom Start 禁用已有解释                              | `8980c8234 feat(app): explain why the custom Start button is disabled`                         |

**复审自纠**：上一轮报告的「B 区窄屏无入口 / 浮层无 Escape / Custom 按钮无 aria」等条目，是拿该分支工作树的现状去对照 `origin/main` 的基线，属**基线错配**。引用本文件时必须先确认目标分支。

---

## 一、五位真实用户的卡点（按模式）

### Chat / 林可（独立开发者，不读文档）

| #   | 现象                                                                                                                             | 证据                                                                                                                                                                              | 影响                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| P0  | 点 `New` 不建空白资产，而是开一场 AI 对话并把 `asset.panel.newSeed` 塞进 composer                                                | `packages/app/src/pages/mode-workspace-slots.tsx:453-468`                                                                                                                         | 不读文档的人找不到「空白模板」，每建一个资产都要先跟 AI 绕一圈 |
| P0  | 加载态被渲染成空态：主区传 `?? []`，表内 `rows().length === 0` 直接落 `noAssets` 兜底，而 `list` 的 loading 从未在 Provider 暴露 | `packages/app/src/pages/mode-workspace-slots.tsx:559`、`packages/app/src/components/chat/asset-workbench.tsx:297-306`、`packages/app/src/components/chat/chat-assets.tsx:215-222` | 慢服务器 / 首次加载时以为资产丢了                              |
| P1  | Chat 首页没有会话列表（Coding 有 `CodingSessionListMain`）                                                                       | `packages/app/src/components/mode-surfaces.tsx:162-182` vs `packages/app/src/pages/mode-workspace-slots.tsx:191`                                                                  | 回不到刚才的对话                                               |
| P1  | 功能树 `cursor-default` 看着不可点，点了只筛表不导航                                                                             | `packages/app/src/components/mode-surfaces.tsx:125-128`                                                                                                                           | 认知负荷白增                                                   |
| P1  | 删除用伪造 `sessionID: "ses-home-delete"`                                                                                        | `packages/app/src/pages/mode-workspace-slots.tsx:504`；债台账 `docs/technical-debt.md:141`                                                                                        | 审计归属链断裂（台账已注「非安全缺陷」）                       |

唯一的错误态反而是好的：部分失败出横幅 + Retry（`packages/app/src/components/asset-load-error.tsx:24-38`），但缺 `role="alert"`。

### Coding / Alex（全栈 7 年，Vim 键位，几乎不用鼠标）

**回答了「A/B 主区真实关系」这个架构问题**：

- A/B 是**并排分栏**，不是浮层。决定者是 `sessionPanelWidth()`（`packages/app/src/pages/session.tsx:298-302`）与 `SessionRightPanel.panelWidth`（`packages/app/src/components/session-right-panel.tsx:36-41`）
- 浮层只属于另外 4 个模式的 `modePanel`（`packages/app/src/pages/session/session-side-panel.tsx:69-72`、`:214`）
- 窄屏 Coding 右栏**整个不挂载**，review 退化成 A 区内的 tab（`session-side-panel.tsx:224`、`:96`）

| #   | 现象                                                                                    | 证据                                                           | 影响                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `ResizeHandle` 全程 `onMouseDown` + document 级 `mousemove`，**无 `setPointerCapture`** | `packages/ui/src/components/resize-handle.tsx:28-33`、`:56-66` | 拖分隔条时指针划过 xterm / iframe 沙箱，事件被吃掉，面板不跟手。全仓唯一 pointer capture 在 `packages/ui/src/components/scroll-view.tsx:127` |
| P2  | 分隔条无 `role="separator"`、无 tabIndex、无方向键                                      | `packages/ui/src/components/resize-handle.tsx:69-81`           | 纯键盘用户在这一处破功                                                                                                                       |
| P3  | 窄屏「收起右侧面板」语义错位：期望收栏，实际是换页                                      | `packages/app/src/pages/session/session-side-panel.tsx:224`    | 视觉语义不一致                                                                                                                               |

### Work / Elena（研发架构师，跑 workflow 出产物）

| #   | 现象                                                                                                        | 证据                                                                                                                                | 影响                                                      |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| P0  | workflow 卡不跑 DAG，只拼一段自然语言 prompt；函数注释自认「引导降级」                                      | `packages/app/src/pages/work-preset-launch.ts:25-29`                                                                                | **这是引擎缺口，不是 UX 缺口**，且属已声明延后（见 §三）  |
| P1  | 无 cancel / retry：三个动作只存在于 `WorkflowRuntimePanel`，而该组件全仓**仅 1 处生产挂载**，在 custom 分支 | `packages/app/src/components/custom/custom-snapshot-panel.tsx:188`；`packages/app/src/pages/session/session-side-panel.tsx:372-382` | 长任务跑歪只能弃用整个会话                                |
| P2  | 候选稿 = 最新一条 assistant 文本，多步产出被覆盖                                                            | `packages/app/src/pages/work-artifact-extract.ts:12-22`                                                                             | 「检查中间步骤」的需求落空                                |
| P3  | preset 为 null 时空态文案谎称「从预设起草」                                                                 | `packages/app/src/pages/work-artifact-panel.tsx:150-153`                                                                            | 从 New Session 进入的用户被指向不存在的预设               |
| —   | `work-artifact-panel.tsx` 整文件 `aria-` / `role=` 命中数 = **0**                                           | 实测 grep                                                                                                                           | 无障碍语义整体缺失                                        |
| —   | `work.*` i18n 仅 en / zh / zht 各 39 条，其余 locale 全为 0                                                 | 实测 grep；`packages/app/src/i18n/parity.test.ts:4`                                                                                 | 依赖 English fallback，是**既定约定**而非遗漏（见 §三 ⑤） |

### Assistant / 周岚（技术写作者，非工程师，极在意溯源）

| #    | 现象                                                                                    | 证据                                                                                                                                | 影响                                                            |
| ---- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| P0   | 引用浮层只有标题 + 220 字摘要 + 关闭，**没有「打开原文」**；点开展示的是 `note.content` | `packages/app/src/pages/session/timeline/message-timeline.tsx:1414-1433`、`packages/app/src/pages/session/assistant-kb-tab.tsx:193` | 看到二手段落，无法验证 AI 是否曲解，也点不回喂进去的那篇网页    |
| P0   | 创建硬编码 `scope: "global"`；列表不传 scope 故 global + project 混显                   | `packages/app/src/pages/assistant-dashboard.tsx:132`；`packages/core/src/session/kb-service.ts:166-181`、`:267-268`                 | 「个人库 + 项目库」在 UI 上无法表达，笔记可能写错目录且看不出来 |
| P1   | `kb.get` 失败只有空 catch，无任何提示                                                   | `packages/app/src/pages/session/timeline/message-timeline.tsx:372-375`                                                              | 引用坏了但没人知道                                              |
| P1   | 变更失败一律 `.catch(console.error)`，页面只给通用 loadError                            | `packages/app/src/pages/assistant-dashboard.tsx:136/154`                                                                            | 非工程师看不懂                                                  |
| 缺口 | 导入资料无 UI 入口，而服务端 `syncFromDirectory` 已存在                                 | `packages/core/src/session/kb-service.ts:681`                                                                                       | 「把散落资料喂进去」做不到                                      |

**服务端已就绪**：`kb.list` / `kb.search` 都收 `scope?`（`packages/aigcfroge/src/server/routes/instance/httpapi/handlers/kb.ts:25-26`、`:95-98`）。缺的只是 UI 入口——但归属见 `docs/technical-debt.md:48`（已裁定归 Assistant 专项）。

### Custom / 马工（平台工程师，编排 + MCP，要交接）

| #   | 现象                                                                                                                           | 证据                                                                                                                 | 影响                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| P0  | flag 默认关，但 `ModeSwitcher` 五图标**无任何 flag 判断**；进去后 plan 400、Start 永久禁用                                     | `packages/app/src/components/mode-switcher.tsx:35-66`；`packages/core/src/product-mode-policy.ts:40-45`              | 交接时同事只看到「服务器禁用了」，不知该找谁开 |
| P0  | 认停用靠**服务端英文文案子串**匹配                                                                                             | `packages/app/src/components/custom/custom-plan-state.ts:88`、`:94-97`                                               | 服务端改一个词，UI 判断静默失效                |
| P1  | 加载中五类全显 `noAgents / noWorkflows / ...` 空文案，不是骨架；`status()` 算了却只喂给 `showsEmptyState`                      | `packages/app/src/components/custom/custom-sidebar.tsx:58`、`:236-242`                                               | 以为项目没资产                                 |
| P1  | 不能挂 MCP（`ASSET_KINDS` 无 mcp）；不能写 workflow（只能选）；profile 是裸输入框；`toggleCapability` 在 UI 上**零生产调用点** | `packages/app/src/components/custom/custom-asset-catalog.ts:15`、`packages/app/src/context/custom-draft.tsx:237-248` | 想用 Custom 编排，实际还得手写 yaml            |
| P2  | 快照 `state: "absent"` 无专门文案，digest 只渲染 `-`                                                                           | `packages/app/src/components/custom/custom-plan-state.ts:177`                                                        | 分不清「没快照」和「没加载完」                 |

**做得好的地方**：Start 禁用有**单一门禁 + 就近解释**，不是哑按钮（`packages/app/src/components/custom/custom-plan-state.ts:141-156`、`packages/app/src/components/custom/custom-preview-column.tsx:155-186`）。

---

## 二、收敛出的根因

### 根因 1：非 Happy Path 被系统性地渲染成「没有」——命中 5/5 模式

| 模式      | 同一个病                                                   |
| --------- | ---------------------------------------------------------- |
| Chat      | 加载中 → 「还没有保存的 Prompt」                           |
| Coding    | 超时 / 流式卡住 → 无渲染分支                               |
| Work      | Artifact 无 loading 分支，只有 empty / candidate / applied |
| Assistant | `kb.get` 失败 → 空 catch 静默                              |
| Custom    | 加载中 → 五条空文案；计划失败 → 只给通用 blocker           |

**共同前提**：`createResource` 的 `loading` 没被提升为 UI 状态，只有 `data` 被消费；`rows().length === 0` 一个判断同时承担「空」「加载中」「失败」三种语义。

### 根因 2：B 区「一个原语 + 两个门 + 一个缺位消费者」

**复审后修正（见 §三 ③）**：不是「两套并行实现」。`SessionRightPanel` 这个原语有 **4 个消费者**（chat / work / assistant / coding），采用率 4/5；Custom 是唯一缺位者。

真正重复的是**门**：

- coding：`packages/app/src/pages/session/session-side-panel.tsx:224` 的 `<Show when={isDesktop() && mode.currentMode === "coding"}>`
- 其余四模式：`session-side-panel.tsx:207-220` 的 `modePanel()` + `:368-383` 的 `contentPanelShown()`

### 根因 3：圆角没有按既有 owner 取值

- `--v2-radius` 全仓**零命中**
- `packages/ui/src/v2` 下 **47 处**硬编码 `border-radius`
- `packages/app` 下 **84 处** Tailwind 任意值：`rounded-[6px]`×40、`[4px]`×15、`[3px]`×10、`[8px]`×6、`[10px]`×6、`[12px]`×3、`[1px]`×3、`[2px]`×1
- 同一个浮层在三处各写一遍 `rounded-[10px]`：`packages/app/src/pages/session.tsx:2041`、`session-side-panel.tsx:214`、`packages/app/src/components/session-right-panel.tsx:56`

**但既有 owner 已存在**：`packages/ui/src/styles/theme.css:45-49` 定义 `--radius-xs/sm/md/lg/xl` = 2/4/6/8/10px，且已被 `packages/app/src/index.css:1` 全局加载。直方图显示约 **106/131 处可无损映射**；孤儿值只有 `3px`、`1px`、`12px`、`9999px`、`0px`。

**所以这不是「新建 token」问题，是「没有复用既有 token」问题。**

### 根因 4：能力已在服务端，UI 没接

| 能力                    | 服务端               | UI                                                      |
| ----------------------- | -------------------- | ------------------------------------------------------- |
| KB scope 过滤           | 有                   | 硬编码 `"global"`（归属见 `docs/technical-debt.md:48`） |
| KB 目录导入             | 有                   | 无入口                                                  |
| workflow cancel / retry | 组件已存在且模式无关 | 只挂在 custom                                           |
| Custom flag 谓词        | 有                   | 靠英文文案子串                                          |
| Work 真执行引擎         | **本身不存在**       | 已声明延后（见 §三 ④）                                  |

---

## 三、CLAUDE.md 复审：必须撤回或修正的 6 条（含对自己的修正）

### ① 撤回 P0「建 `--v2-radius-*` token」——违反「极致减法」

原报告写「新建 `--v2-radius-sm/md/lg/full` 收敛 131 处硬编码」，**这是「新增」，不是「复用」**。既有 `--radius-*` 值完全对得上且已全局加载。正确动作是**复用 + 删除**。

（计数口径说明：`--include=*.css` 得 47，按值直方图得 42，差 5 来自 `inherit`×2、`var(--avatar-radius)`、`4px 0 0 4px` 简写、一条 `transition` 误命中——这 5 处未逐条核对。）

### ② 撤回 P1「Custom 入口按 `ProductModePolicy` 同一谓词显隐」——不可实现

`docs/technical-debt.md:156` 明确：`app` 引任何传递依赖 `core/flag/flag.ts` 的模块**会让 Web 构建白屏**，app 侧那个常量是刻意复制的字面量。照做会打挂 Web 构建。该条已有 owner 与 unlock 条件（服务端写 `kind: "custom_mode_disabled"`，客户端改判 `kind`）。

### ③ 修正「B 区两套并行实现」——夸大，真实缺口小得多

见 §二 根因 2。收敛目标是「一个原语 + 两个门 + 一个缺位消费者」。

### ④ 修正「Work 执行引擎不存在 = P0 产品级发现」——框架错了

`packages/app/src/pages/work-preset-launch.ts:25-29` 注释自认「真执行引擎 M2 立项后替换」，`docs/plan/chat-m5-workflow-asset.md` §0.3 明写「不建设工作流执行引擎（归 Work 模式，延后）」。**这是有文档的 deferral，不是未登记的缺口**，不该混进 v2 设计收敛当 P0。

### ⑤ 修正「18 国语言 parity 门禁 ✅」——门禁强度被高估

`work.*` 在 en / zh / zht 各 39 条，其余 16 个 locale 全为 0；`packages/app/src/i18n/parity.test.ts:4` 的注释确认依赖 English fallback。**所以某个 namespace 在 16 个 locale 全空是能过门禁的。**「门禁存在」成立，「能拦住膨胀」不成立。

### ⑥ 修正唯一那条「未证实」——是检索路径错误造成的假阴性

原报告写「todo 进度条的 Resume 门控 grep 未命中，未证实」。实际文件在 **timeline 子目录**：

- `packages/app/src/pages/session/timeline/session-todo-progress.tsx:31` 定义存在
- `:208` `role="progressbar"`、`:212` `aria-valuenow`
- 挂载点 `packages/app/src/pages/session/timeline/message-timeline.tsx:1832`、导入 `:83`

现状：文件与进度条语义**已证实**；具体那行 work 门控**仍未读到**。

### 另附：台账已登记、被当作「新发现」重报的 6 条

`docs/technical-debt.md` 是**单一真源**。下列条目在原报告中以「新发现」形式出现，实际已有 owner 与 unlock 条件：

| 原报告「发现」                           | 台账                         | 台账说得更好的地方                                                                     |
| ---------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| Custom 停用判定靠英文文案子串            | `docs/technical-debt.md:156` | 给出根治协议（写 `kind`）并解释为什么不能 import core                                  |
| 伪造 `sessionID: "ses-home-delete"`      | `docs/technical-debt.md:141` | 已注明「非安全缺陷」及范围决定                                                         |
| Assistant global / project scope 无 UI   | `docs/technical-debt.md:48`  | 已裁定归 Assistant 专项，unlock = 「Assistant 专项启动时」                             |
| Custom 快照面板硬编码调色板 + 英文字面量 | `docs/technical-debt.md:87`  | 逐项列出 `bg-amber-500/10`、`Workflow (...)` 等                                        |
| `timeoutSeconds` 省略即无墙钟上限        | `docs/technical-debt.md:80`  | 指出加默认值会静默截断合法长任务，属产品决策                                           |
| Chat 加载态 = 空态                       | `docs/technical-debt.md:86`  | 已在闭环条目留残留：「仍缺：loading 骨架屏（状态已建模并返回，但只用于抑制空态提示）」 |

**这违反「以创造接口为耻，以复用现有为荣」。正确姿势是复用台账编号与 owner，而不是新建平行结论。**

---

## 四、复审后**站得住**的结论

| 结论                                                      | 证据                                                                                                  | 状态                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 三态（空 / 加载 / 失败）被渲染成同一个「没有」，跨 5 模式 | Chat `?? []` → `noAssets`；Custom `noAgents`；Assistant 空 catch；Work Artifact 无 loading 分支       | 成立，但应接着 `docs/technical-debt.md:86` 已有条目做，非新立项 |
| `ResizeHandle` 无 pointer capture、无 `role="separator"`  | `packages/ui/src/components/resize-handle.tsx:28-33`、`:56-66`、`:69-81` 全文读完                     | 成立，未在所读台账 §1–§3.2 出现                                 |
| `WorkflowRuntimePanel` 全仓仅 1 处生产挂载                | 仅 `packages/app/src/components/custom/custom-snapshot-panel.tsx:188`                                 | 成立                                                            |
| `work-artifact-panel.tsx` 整文件无无障碍语义              | `aria-` / `role=` 命中数 = 0                                                                          | 成立                                                            |
| `toggleCapability` 零生产调用点                           | 仅 `packages/app/src/context/custom-draft.tsx:237` 定义 + 测试                                        | 成立                                                            |
| Custom 资产列表无 mcp                                     | `packages/app/src/components/custom/custom-asset-catalog.ts:15`                                       | 成立                                                            |
| `ModeSwitcher` 无 flag 分支                               | `packages/app/src/components/mode-switcher.tsx:35-66` 仅 `For each={MODE_DEFINITIONS}`                | 成立（但修法受限，见 §三 ②）                                    |
| KB scope 服务端已就绪                                     | `handlers/kb.ts:25-26`、`:95-98`                                                                      | 成立，归属见 `docs/technical-debt.md:48`                        |
| `--radius-*` 在两处重复定义                               | `packages/ui/src/styles/theme.css:45-49` vs `packages/ui/src/styles/tailwind/index.css:59-63` 同 5 值 | 新发现；谁是权威**未查**，判为 `needs-owner-decision`           |

---

## 五、修正后的收敛方案（严格按 复用 → 删除 → 归并 → 重构 → 新增）

| 序  | 动作                                                                                                                                      | 性质                                            | 依据                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | 把 app / v2 的硬编码圆角替换为**既有** `--radius-*`（约 106 处零决策）；`3px` / `1px` 归并到 `xs` / `sm`；只对 `12px` / `9999px` 决策一次 | **复用 + 删除**                                 | `packages/ui/src/styles/theme.css:45-49`、`packages/app/src/index.css:1` |
| 2   | 合并 `--radius-*` 的双定义                                                                                                                | **归并**                                        | 上表两条                                                                 |
| 3   | `WorkflowRuntimePanel` 挂进 work 分支                                                                                                     | **复用**（组件模式无关，零新增）                | `packages/app/src/components/custom/custom-snapshot-panel.tsx:188`       |
| 4   | 三态契约：`loading` 提升为 UI 状态，骨架 ≠ 空态 ≠ 错误                                                                                    | **重构**（接着 `docs/technical-debt.md:86` 做） | 命中 5/5                                                                 |
| 5   | `ResizeHandle` → PointerEvent + `setPointerCapture` + `role="separator"` + 方向键                                                         | **重构**（组件级）                              | `packages/ui/src/components/resize-handle.tsx:28-81`                     |
| 6   | Custom 补上 `SessionRightPanel`；两个门收敛为一个谓词                                                                                     | **重构**（原语 4/5 采用率）                     | `session-side-panel.tsx:224` vs `:207-220`                               |
| —   | **撤回**：新建 `--v2-radius`、Custom 按 `ProductModePolicy` 统一谓词、Work 引擎当 P0                                                      | 见 §三                                          | —                                                                        |
| —   | **不动**：KB scope（`:48`）、fake sessionID（`:141`）、Custom 文案子串（`:156`）、Work 引擎（已声明延后）                                 | 已有 owner / unlock                             | —                                                                        |

---

## 六、未验证边界（诚实登记）

- `--radius-*` 双定义谁是权威，未查
- 圆角计数 47 vs 42 的 5 处差异未逐条核对
- `session-todo-progress.tsx` 的 work 门控那一行仍未读（文件位置已修正）
- `docs/technical-debt.md` 只读到 §3.2（约 111 行），后续章节未读 → 「未在台账出现」仅指**所读到的部分**
- 本评审**未修改任何生产代码**，只读
- 未跑 typecheck / test / lint；所有结论均为**源码级证实**，未做运行时验证

---

## 七、本轮实际运行的验证命令

```text
ls / grep / sed / read：
  packages/ui/src/components/resize-handle.tsx（全文）
  packages/app/src/pages/session/session-side-panel.tsx:204-222
  packages/app/src/components/mode-switcher.tsx:35-66
  packages/app/src/components/custom/custom-asset-catalog.ts:10-20
  packages/app/src/pages/work-preset-launch.ts（全文）
  packages/app/src/pages/work-artifact-extract.ts:1-50
  docs/technical-debt.md:48 / 80 / 86 / 87 / 141 / 156（逐行）
  packages/app/src/i18n/{en,zh,zht,de,fr,ja,ru}.ts（work.* 计数）
  packages/app/src/pages/session/timeline/session-todo-progress.tsx
  packages/app/src/pages/session/timeline/message-timeline.tsx:1828-1836
  packages/app/src/components/chat/chat-right-panel.tsx:217
  packages/app/src/pages/session/assistant-session-panel.tsx:151
  packages/app/src/pages/work-artifact-panel.tsx:240
  .aigcfroge/skills/frontend-theming/SKILL.md（全文）
  .aigcfroge/skills/reuse-first-refactor/SKILL.md（全文）

脚本：
  radius 值直方图（v2 CSS + app Tailwind 任意值 → v1 token 映射）
  coverage-manifest.json 结构读取
```

---

## 八、复查结论

```text
复查结论:
- 影响文件: docs/review/v2-five-mode-ux-audit.md（本文件，新增）
- 命中 skills: reuse-first-refactor（复用优先排序 / 重复实现识别）、
              frontend-theming（token 纪律；其 --v2-* 规则范围是颜色，圆角不在其内）
- 安全门禁: 不适用（本评审无代码改动）；
            复审中发现原报告一条 P1 若实施会导致 Web 构建白屏（app → core/flag 传递依赖），已撤回
- 工程门禁: 违反「极致减法」1 项（拟新增 --v2-radius 而非复用 --radius-*）；
            违反「单一真源」6 项（重报已登记债）；
            夸大 1 项（B 区「两套实现」）；
            框架错误 1 项（Work 引擎当 P0）；
            门禁强度误判 1 项（i18n parity 允许 English fallback）；
            自证假阴性 1 项（检索路径错致「未证实」）；
            基线错配 1 项（拿 global-shell-e2e 工作树对照 origin/main 基线）
- 已运行命令: 见 §七
- 剩余风险: 修正后的方案未经 typecheck / test / lint；
            所有结论仅源码级证实，未跑运行时；
            §六 未验证边界未闭环
```

---

## 九、后续

本评审的收敛项与 `global-shell-e2e`（135 提交 / 212 文件，主战场 `packages/app` 140 文件）在 `packages/app` 层存在物理重叠。

**建议**：等该分支结束、`origin/main` 前进后再开新工作区执行 §五，避免并行改动冲突；届时基线须显式指定：

```bash
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
```

（`CLAUDE.md` 记的陷阱：`script/lint-changed.ts:94` 默认以本地 `main` 为 diff 基线，本地 `main` 可能长期落后于 `origin/main`。）
