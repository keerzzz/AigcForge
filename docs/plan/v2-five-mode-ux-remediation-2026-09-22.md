# v2 五模式 UX 收敛 TDD 实施计划

> **状态**：**已审批（第 2 版，修订执行版，2026-09-22）**。
> **Owner**：App + UI；第 2 版执行范围无 core / aigcfroge 协议或 HTTP 变更。
> **事实来源**：[`docs/review/v2-five-mode-ux-audit.md`](../review/v2-five-mode-ux-audit.md)（评审记录，当前 **untracked**）。
> **实施基线**：`origin/main` = `HEAD` = `53800bb8549443372243e5ba37b8277e225cf4df`（`git rev-list --left-right --count origin/main...HEAD` = `0 0`，当前分支 `main`）。
> **计划分支**：`five-mode-ux-plan`（只承载本计划、审查修订与执行提示词）；合入后生产实施使用新分支 **`five-mode-ux`**，从最新 `origin/main` 新切，命名遵守 `AGENTS.md`（最多三词、连字符、禁类型前缀）。
> **协议依据**：[`CLAUDE.md`](../../CLAUDE.md)、[`AGENTS.md`](../../AGENTS.md)、[`DESIGN.md`](../../DESIGN.md)、[`ARCHITECTURE.md`](../../ARCHITECTURE.md)、[`docs/testing.md`](../testing.md)、[`packages/app/AGENTS.md`](../../packages/app/AGENTS.md)。
> **技能依据**：`.aigcfroge/skills/reuse-first-refactor`（复用 → 删除 → 归并 → 重构 → 新增）、`.aigcfroge/skills/frontend-theming`、`.aigcfroge/skills/quality-to-pr`。
> **实施原则**：识别假设 → 追溯本源 → 重构方案 → 精简输出。
> **TDD 规则**：每个 Slice 必须独立完成 RED → GREEN → REFACTOR → 包级门禁 → 数据流复查；当前 Slice 未绿不得进入下一 Slice。

---

## 审批修订（第 2 版，权威覆盖下文的冲突描述）

本版基于当前 `main`（`53800bb85`）逐层复核后批准实施，但只批准无产品契约变更的 A 批；需要新增产品行为、安全边界或服务端契约的事项从本批移出。下文中与本修订冲突的段落以本节为准。

### 已修正的阻塞项

1. **S5b 取消**：`modeContentPanelShown()` 已是唯一门谓词，coding 窄屏排除是 `layout-helpers.ts:71-86` 明确并测试的决策；原计划把它描述成“两个门”属于基线误读。B2 会撤销现有刻意设计，本批不做。
2. **S7a 不改 Main**：Chat 的 owner 边界是 `ChatFeatureSidebar` 承载 Session 导航、`ChatAssetWorkbenchMain` 承载资产工作台（`docs/architecture/pages/chat.md:13,40-41`）。S7a 移到 Chat 专项，不能复用 `CodingSessionListMain` 替换 Main。
3. **S8c 取消**：`WorkArtifactContent` 没有 `preset` 输入或 preset-null 状态（`work-artifact-panel.tsx:39-54,143-152`）。该项基于不存在的前提，本批不再实现。
4. **S9a 收敛为显式入口**：`KBNote.Note` 没有原文 URL/文件路径字段，引用点击已经打开 KB Tab 并显示笔记正文（`message-timeline.tsx:365-371`）。本批只在浮层增加“打开笔记”按钮，复用 `openEntityPanel`；不改 core/schema，不补来源字段。
5. **S9c 延期**：`syncFromDirectory` 只有 core 服务，KB HTTP group 未暴露该能力。新增目录导入端点属于路径 containment、scope 授权与审计的安全边界变更，必须另立 ADR/专项。
6. **S6 延期待裁决**：七类资产没有独立的空白创建 endpoint；现有写入边界是 per-kind `Candidate` + `*.apply`。直接空白创建需要逐 kind 定义合法候选、权限与 refetch 契约，先做产品/技术设计，不在本批伪装成 UI 接线。
7. **RED 必须是行为证据**：遵守 `docs/testing.md:150-176`，禁止新增源码字符串/分支计数断言。源码扫描只允许作为一次性审计或构建产物验证；TDD 断言放 e2e、纯函数、类型或请求 payload 层。
8. **S1 必须先做 spike**：先验证 `@theme` alias 合并后的计算值；若依赖 cascade 才能成立，则不宣称“单次声明”，改为“唯一字面量真源 + 构建产物证明”。S2 的 107 处等价替换与 3px/1px/12px 视觉归并拆开，后者需单独签字。
9. **命令修正**：单文件用 `bun --cwd packages/app test:unit:file <file>`；Playwright 用 `bun --cwd packages/app test:e2e`；协议检查用 `bash .aigcfroge/skills/protocols/scripts/check-refs.sh`。

### 本批执行范围

| 状态 | Slice | 说明 |
| --- | --- | --- |
| **执行** | S1 | 先 spike，再最小归并 |
| **执行** | S2a | 只做 107 处无争议映射 |
| **待决** | S2b | 1px/3px/12px 视觉归并，单独签字 |
| **执行** | S3 | WorkflowRuntimePanel 独立 Tab |
| **执行** | S4b/S4c/S4d/S4e | Chat、Work、Assistant 引用、Custom 三态；S4a 仅在行为测试需要共享时提取 |
| **执行** | S5a | Custom 接入 SessionRightPanel |
| **执行** | S8a | AssetLoadError `role="alert"` |
| **执行** | S9b | Assistant mutation 错误可见化 |
| **移出** | S5b/S6/S7a/S8c/S9c | 产品、架构或安全专项 |


---

## 0. 摘要与前置裁决

### 0.1 前置条件：审计 §九 的等待条件已满足

审计 §九 要求「等 `global-shell-e2e` 结束、`origin/main` 前进后再开新工作区执行 §五，避免并行改动冲突」。实测：

```text
$ git rev-parse HEAD            → 53800bb8549443372243e5ba37b8277e225cf4df
$ git rev-parse origin/main     → 53800bb8549443372243e5ba37b8277e225cf4df
$ git rev-list --left-right --count origin/main...HEAD → 0	0
$ git log -1 --format=%s HEAD   → Merge pull request #77 from keerzzz/global-shell-e2e
```

`global-shell-e2e` 已并入 `main`，审计 §0 声明的「135 提交 / 212 文件领先」已归零。**前置条件成立，可以开工。**

### 0.2 本版范围裁决

审计 §五 的原 6 项动作中，`ResizeHandle` 已完成，S5b 的前提经复核不成立；其余可执行项按下面的第 2 版范围收敛：

| 批次 | Slice | 内容 | 依据 |
| --- | --- | --- | --- |
| **A · 执行** | S1 | `--radius-*` 字面量真源归并（先 spike） | 审计 §五-2（**归并**） |
| | S2a | 107 处无争议圆角映射 | 审计 §五-1（**复用 + 删除**） |
| | S3 | `WorkflowRuntimePanel` 挂进 work 分支 | 审计 §五-3（**复用**） |
| | S4b/S4c/S4d/S4e | 三态契约：loading ≠ 空 ≠ 错误 | 审计 §五-4（**重构**） |
| | S5a | Custom 采用 `SessionRightPanel` | 审计 §五-6 前半（**复用**） |
| | S8a | 错误横幅补 `role="alert"` | §一 三处 `—` 行 |
| | S9b | Assistant mutation 错误可见化 | §一 Assistant P1 |
| **B · 移出/待决** | S2b | 1px/3px/12px 视觉归并 | 需单独签字 |
| | S5b | coding 窄屏浮层化 | 会撤销现有刻意设计，需新 ADR |
| | S6 | Chat 空白资产创建路径 | 缺 per-kind 空白 Candidate 契约 |
| | S7a | Chat Session 导航 | 应归 `ChatFeatureSidebar` 专项 |
| | S7b | Chat feature tree 导航语义 | 先澄清 filter vs navigation |
| | S8c | Work preset 空态文案 | 当前组件无 preset 输入，前提不成立 |
| | S9a | 引用浮层显式打开笔记 | 仅复用现有 `openEntityPanel`，不改服务端字段 |
| | S9c | 目录导入 UI | 需新增 HTTP API 与安全边界 |

### 0.3 对审计结论的独立复核（不誊抄，逐条实测）

本计划未直接采信审计或上一轮 DeepSeek 会话的结论。以下为本次独立实测结果：

| 审计/上轮结论 | 本次独立实测 | 判定 |
| --- | --- | --- |
| §五-5 `ResizeHandle` **已修复** | `resize-handle.tsx`：`:94 setPointerCapture`、`:141 role="separator"`、`:144 aria-orientation`、`:145-148 aria-label/valuenow/min/max`、`:149 tabIndex={0}`、`:121-136 handleKeyDown`（含 Home/End）、`:44-53 keyDeltaFor` 纯函数 | **确认已完成，本计划不含此项** |
| 根因3 `--v2-radius` 零命中 | `grep -rn -- "--v2-radius" packages` → 空 | **确认** |
| 根因3 圆角硬编码计数 | app `rounded-[Npx]` + `rounded-r-[6px]` 实测：`6px`×40、`4px`×15、`3px`×10、`8px`×6、`10px`×6、`1px`×3、`12px`×3、`2px`×1、`rounded-r-[6px]`×1 = **85**；`packages/ui/src/v2` `border-radius: Npx` 实测：`4px`×17、`6px`×14、`2px`×6、`9999px`×3、`8px`×1、`3px`×1 = **42** | **确认，与审计逐值吻合** |
| 根因3 「约 106/131 可无损映射」 | 按 2/4/6/8/10px → `xs/sm/md/lg/xl` 映射：app 69 + v2 38 = **107 处零决策**；孤儿值 1px×3、3px×11、12px×3、9999px×3 = **20 处需决策**。原审计漏计 `rounded-r-[6px]`×1，按实际口径修正 | **确认并修正为 107** |
| §四 `--radius-*` 双定义「谁是权威**未查**」 | **本次查清**：`packages/ui/src/styles/theme.css:45-49`（`:root`）**正在被消费**——`packages/app/src/index.css:308`、`packages/ui/src/components/{select,radio-group,text-field,list,image-preview}.css` 共 10+ 处 `border-radius: var(--radius-*)`；而 `packages/ui/src/styles/tailwind/index.css:59-63`（`@theme`）**写入的是重复字面量**，且其生成的 `rounded-xs/sm/md/lg/xl` 工具类在 `packages/app/src` + `packages/ui/src` 源码中**零使用** | **权威 = `theme.css` 的 `:root` 组；`@theme` 组应改为引用而非复制。原「未查」已闭环，见 S1** |
| §四 `WorkflowRuntimePanel` 仅 1 处生产挂载 | `grep -rn WorkflowRuntimePanel packages/app/src`（排除 stories/test/import/定义）→ 仅 `custom-snapshot-panel.tsx:188` | **确认** |
| §四 `work-artifact-panel.tsx` 无障碍语义 = 0 | `grep -cE "aria-\|role=" packages/app/src/pages/work-artifact-panel.tsx` → `0` | **确认** |
| 根因2 `SessionRightPanel` 4/5 采用、Custom 缺位 | 消费者：`chat-right-panel.tsx`、`work-artifact-panel.tsx`（`WorkSessionPanel`）、`assistant-session-panel.tsx`、`session-side-panel.tsx:225`（coding）= **4 家**；`session-side-panel.tsx:372-380` custom 分支挂 `CustomSessionPanel`（在 `CustomDraftProvider` 内）= **缺位** | **确认** |
| 根因1 三态被渲染成「没有」 | `asset-workbench.tsx:298-304`：`<Show when={rows().length > 0} fallback={noAssets}>`；`custom-sidebar.tsx:236-242`：`<Show when={filteredAgents().length > 0} fallback={noAgents}>`；`work-artifact-panel.tsx:144-209`：仅 `appliedCurrent` / `candidate` / `empty` 三分支，**无 loading 分支** | **确认** |
| §一 Assistant P0 引用无「打开原文」、展示 220 字摘要 | `message-timeline.tsx:371` `citationSummary(note.content ?? "", 220)` | **确认** |
| §一 Assistant P0 创建硬编码 scope | `assistant-dashboard.tsx:132` `.create({ ..., scope: "global" })` | **确认** |
| §一 Assistant 缺口：服务端已有目录导入 | `kb-service.ts:113`（接口声明）、`:681`（`syncFromDirectory` 实现）**已存在** | **确认，能力在服务端** |
| §一 Chat P0 点 New 塞 `newSeed` | `mode-workspace-slots.tsx:459` `language.t("asset.panel.newSeed", ...)` | **确认** |
| §一 Chat P1 伪造 sessionID | `mode-workspace-slots.tsx:505` `sessionID: "ses-home-delete"` | **确认** |
| §一 Chat P1 功能树只筛不导航 | `mode-surfaces.tsx:125` `cursor-default`；`:188` `Main: CodingSessionListMain` vs `:192` `Main: ChatAssetWorkbenchMain` | **确认** |
| §一 Chat 错误横幅缺 `role="alert"` | `asset-load-error.tsx` 前 40 行仅 `:20 <div>`、`:33 </div>`，无 `role` | **确认** |
| §一 Work P2 候选稿 = 最新 assistant 文本 | `work-artifact-extract.ts:12-22` `messages.toReversed()` 取首个非空 assistant 文本 | **确认** |
| §一 Work P3 preset 为 null 文案谎称从预设起草 | `work-artifact-panel.tsx:151` → `work.artifact.empty` | **确认** |
| Custom 空态已收窄（部分完成） | `custom-asset-catalog.ts:64` `CatalogStatus = "loading"\|"ready"\|"partial"\|"error"`；`:86-87` `showsEmptyState = status === "ready" && agentCount === 0` | **确认：三态模型已在 Custom 落地，跨模式未推广** |
| 台账引用 `:48 / :80 / :86 / :141 / :156` | 逐行读出，内容与审计 §三 一致；`:86` 已闭环但明确留残「仍缺：loading 骨架屏（状态已建模并返回，但只用于抑制空态提示）」 | **确认，S4 是接着 `:86` 做，非新立项** |
| Work 引擎延后 | `work-preset-launch.ts:20-21` 注释「真执行引擎 M2 立项后此函数替换为直接派发，不做假执行（No Cheating）」；`docs/plan/chat-m5-workflow-asset.md:35` 「不建设工作流执行引擎（归 Work 模式，延后）」、`:48` 表格「执行引擎 \| 延后，当前只做定义管理」 | **确认，属有文档的 deferral，本计划不动** |

**复核实测命令见 §8.0。** 审计 §六 自认的 4 项未验证边界中，「`--radius-*` 双定义谁是权威」已在本计划闭环；「圆角计数 47 vs 42 的 5 处差异」按值直方图口径消除（本次用 `border-radius: Npx` 直方图得 42，与审计口径一致）；「`session-todo-progress.tsx` 的 work 门控那一行」本计划不依赖该行，保持未读；「台账只读到 §3.2」已按需补读 `:48/:80/:86/:141/:156`。

### 0.4 明确**不动**的项（已有 owner / unlock，本计划不重开）

复用台账编号与 owner，不新建平行结论：

| 项 | 台账 | 不动的理由 |
| --- | --- | --- |
| Assistant `global\|project` scope 选择器 | `docs/technical-debt.md:48` | 已裁定归 Assistant 专项，unlock = 「Assistant 专项启动时」。**注意**：S9 只做「引用溯源 + 错误可见性」，不碰 scope 选择器 |
| `timeoutSeconds` 省略即无墙钟上限 | `docs/technical-debt.md:80` | 加默认值会静默截断合法长任务，属产品决策 |
| 资产 apply/delete 伪造 sessionID | `docs/technical-debt.md:141` | 已注「非安全缺陷」，unlock = 「下次资产端点改动时」 |
| Custom 停用判定靠英文文案子串 | `docs/technical-debt.md:156` | 根治需服务端写 `kind: "custom_mode_disabled"`；app 引任何传递依赖 `core/flag/flag.ts` 的模块会让 Web 构建白屏（见 `docs/technical-debt.md:156` 与 `packages/app` 边界），不能在本批解决 |
| Custom 快照面板硬编码调色板 | `docs/technical-debt.md:87` | 已有 owner |
| Work 真执行引擎 | `chat-m5-workflow-asset.md:35/:48` | 有文档的 deferral |
| `work.*` i18n 仅 en/zh/zht | `packages/app/src/i18n/parity.test.ts:4` | English fallback 是**既定约定**，非遗漏。**S8 不新增 locale** |

### 0.5 与审计的两处口径修正

1. 审计 §三 ① 说「既有 `--radius-*` 值完全对得上且已全局加载」——**「已全局加载」需要精确化**：`theme.css` 经 `packages/ui/src/styles/index.css:4` 与 `packages/ui/src/v2/styles/tailwind.css:2` 进入构建，`app` 侧经 `packages/app/src/index.css:1` → `@aigcfroge/ui/styles/tailwind` → `../index.css` 间接引入。S1 的第一步就是把这个导入链实测钉死，不靠推断。
2. 审计 §五-1 说「约 106 处零决策」——本次独立复算得 **107 处可无损映射 + 20 处孤儿值**（1px×3、3px×11、12px×3、9999px×3），与审计口径一致。

---

## 1. 强制协议、Skills 与事实源

| 类别 | 内容 |
| --- | --- |
| **强制协议** | `CLAUDE.md`（九荣九耻 / 极致减法 / 改完即审 7 步）、`AGENTS.md`（分支提交 / Effect / Schema / 测试）、`DESIGN.md`（Token / i18n / 无障碍）、`ARCHITECTURE.md`（包拓扑） |
| **命中 Skills** | `reuse-first-refactor`（本计划主线：复用→删除→归并→重构→新增）、`frontend-theming`（CSS 变量纪律；**注意其 `--v2-*` 规则范围是颜色，圆角不在其内**，审计 §八 已注）、`quality-to-pr`（门禁与交付） |
| **单一真源** | `docs/technical-debt.md`（技术债）、`docs/review/v2-five-mode-ux-audit.md`（本次事实来源） |
| **上游计划** | `docs/plan/five-mode-dogfood-remediation-2026-09-04.md`（S4 承接其 `:86` 残留）、`docs/plan/global-shell-remediation-2026-09-11.md`（同 Owner 区、同 TDD 格式） |
| **禁止** | 新建 `--v2-radius-*`（审计 §三 ① 已撤回）；新建平行 tri-state 模型（`custom-asset-catalog.ts:64` 已有）；新增 locale；`as any` / `@ts-ignore` / 吞异常 |

---

## 2. 已核验的根因

### 2.1 根因 1：非 Happy Path 被系统性地渲染成「没有」（命中 5/5）

| 模式 | 病 | 证据（实测） |
| --- | --- | --- |
| Chat | 资产列表 `createResource` 的 loading 未提升为 UI 态，`rows().length === 0` 直接落 `noAssets` | `asset-workbench.tsx:298-304`；数据源 `chat-assets.tsx:124` `createResource` 返回 `undefined` 时 `merged` 产出空 `assets` |
| Coding | 超时 / 流式卡住 → 无渲染分支 | 见 `five-mode-dogfood-remediation-2026-09-04.md` §2.3（已闭环 P1-TURN-STALL，但**空态与错误态的区分**未纳入） |
| Work | Artifact 只有 `applied / candidate / empty` 三分支，**无 loading** | `work-artifact-panel.tsx:144-209` |
| Assistant | `kb.get` 失败空 catch，无提示 | `message-timeline.tsx:372-375` |
| Custom | 空态判定**已收窄**（`status === "ready"`），但加载中仍走 `noAgents` fallback，无骨架 | `custom-asset-catalog.ts:86-87`、`custom-sidebar.tsx:236-242` |

**共同前提**：`createResource` 的 `loading` 未被提升为 UI 状态；`length === 0` 一个判断同时承担「空」「加载中」「失败」三种语义。

**已有 owner**：`custom-asset-catalog.ts:64` 的 `CatalogStatus = "loading" | "ready" | "partial" | "error"` + `:86` `showsEmptyState`。**三态模型已存在，只是范围限在 Custom。S4 是把它归并成共享 owner，不是新建。**

### 2.2 根因 2：B 区「一个原语 + 两个门 + 一个缺位消费者」

- 原语 `SessionRightPanel`：**4 个消费者**（chat / work / assistant / coding），采用率 4/5
- 缺位者：custom（`session-side-panel.tsx:380` 挂 `CustomSessionPanel`）
- 真正重复的是**门**：
  - coding：`session-side-panel.tsx:224` `<Show when={isDesktop() && mode.currentMode === "coding"}>`
  - 其余四模式：`session-side-panel.tsx:207-220` `modePanel()` + `:368-383` `contentPanelShown()`

### 2.3 根因 3：圆角没有按既有 owner 取值（不是「没有 token」，是「没复用既有 token」）

- `--v2-radius` 全仓 **0 命中**
- `packages/ui/src/v2` **42 处**硬编码 `border-radius: Npx`
- `packages/app` **85 处** Tailwind 任意值 `rounded-[Npx]` / `rounded-r-[6px]`
- 同一个浮层在三处各写一遍 `rounded-[10px]`：`session.tsx:2041`、`session-side-panel.tsx:214`、`session-right-panel.tsx:56`
- **既有 owner**：`theme.css:45-49` 定义 `--radius-xs/sm/md/lg/xl` = 2/4/6/8/10px，**正在被 10+ 处 `var(--radius-*)` 消费**
- **重复定义**：`tailwind/index.css:59-63` 的 `@theme` 块把同样 5 个值又写了一遍字面量

**结论：107 处可无损映射（零决策），20 处孤儿值需一次决策，双定义需归并。**

### 2.4 根因 4：能力已在服务端 / 已在别处，UI 没接

| 能力 | 已存在处 | UI 现状 |
| --- | --- | --- |
| KB 目录导入 | `kb-service.ts:113`（接口）、`:681`（实现） | 无入口 |
| workflow cancel / retry | `WorkflowRuntimePanel`（模式无关） | 只挂在 custom |
| Custom 资产三态模型 | `custom-asset-catalog.ts:64/:86` | 只服务 Custom |
| 会话列表骨架 / 会话列表主体 | `SessionSkeleton`（`sidebar-items.tsx:329`）、`HomeSessionSkeleton`（`home-shared.tsx:405`）、`CodingSessionListMain`（`mode-surfaces.tsx:188`） | Chat 未接 |
| KB scope 过滤 | `handlers/kb.ts:25-26`、`:95-98` | 硬编码 `"global"`（**归属 `technical-debt:48`，本计划不动**） |
| Work 真执行引擎 | **本身不存在** | 已声明延后，**不动** |

---

## 3. 根因收敛

### 面 A：三态语义被一个布尔判断吃掉（S4）

5 个模式各自用 `length > 0` 表达「有内容」，把「加载中」「空」「失败」压成一个 `fallback`。**收敛动作**：把 `custom-asset-catalog.ts` 已有的 `CatalogStatus` 提为共享 owner，5 个模式共同消费；skeleton 渲染复用既有的 `SessionSkeleton` / `HomeSessionSkeleton` 视觉语言，**不新建骨架组件家族**。

**收敛验收**：任一模式在 loading 期不再出现「还没有…」文案；error 期不再出现空态文案。

### 面 B：设计 token 有 owner 但被绕过（S1 + S2）

`--radius-*` 有 owner、有消费、有值，但 126 处硬编码绕过它，且它自己被复制成两份。**收敛动作**：先归并双定义（S1），再批量复用（S2）。

**收敛验收**：S2a 的 107 处无争议映射值一致；S2b 的 20 处孤儿值保持原样并进入后续裁决；S1 以构建物一致性而非文本重复作为最终判据。

### 面 C：能力在别处，接线缺失（S3 + S5a + S9b）

`WorkflowRuntimePanel`、`SessionRightPanel` 与既有错误呈现 owner 都已存在。**本批收敛动作**：接线、复用，不造新件；Chat 导航、空白创建与 KB 目录导入移出本批另行裁决。

**收敛验收**：本批每个「缺位」都由既有 owner 补齐，新增文件数 = 0。

---

## 4. 目标 owner 地图

| 关注点 | Owner（唯一） | 本计划触及 |
| --- | --- | --- |
| 圆角 token 定义 | `packages/ui/src/styles/theme.css:45-49`（`:root`，**权威**） | S1 归并 `tailwind/index.css:59-63` 指向它 |
| 右栏面板原语 | `packages/app/src/components/session-right-panel.tsx` | S5a 让 Custom 采用 |
| 模式面板门 | `packages/app/src/context/layout-helpers.ts`（`modeContentPanelShown()`） | 本批只读；S5b 取消 |
| 资产三态模型 | `packages/app/src/components/custom/custom-asset-catalog.ts:64/:86` | 先由行为测试判断是否共享；无证据不提取 |
| Workflow 运行时面板 | `packages/app/src/pages/session/workflow-runtime-panel.tsx` | S3 挂进 work |
| Work 右栏容器 | `packages/app/src/pages/work-artifact-panel.tsx`（`WorkSessionPanel`） | S3 挂载点、S4c loading |
| Chat 资产工作台 | `packages/app/src/components/chat/asset-workbench.tsx` | S4b 三态 |
| Chat 模式面 | `packages/app/src/components/mode-surfaces.tsx` | 本批只读；S7 移出 |
| 错误横幅 | `packages/app/src/components/asset-load-error.tsx` | S8a 无障碍 |
| Assistant 引用 | `packages/app/src/pages/session/timeline/message-timeline.tsx` | S4d 加载错误可见化 |
| Assistant 仪表盘 | `packages/app/src/pages/assistant-dashboard.tsx` | S9b mutation 错误可见化 |
| i18n | `packages/app/src/i18n/{en,zh,zht}.ts` | 所有新增文案（**不新增 locale**） |

---

## 5. 分阶段 TDD 工作流

### S0：冻结行为基线（不改生产代码）

**目标**：把本批要动的可观测行为钉成可执行断言，先证明现状。源码扫描只记录审计事实，不作为 TDD RED。

| 断言 | 层 | 基线判据 |
| --- | --- | --- |
| `packages/app/src` + `packages/ui/src/v2` 下 `rounded-[Npx]` + `border-radius: Npx` 计数 = 127，其中可无损映射 107 | 脚本（`script/` 下一次性探针，S0 提交） | 记录计数表 |
| `--radius-*` 定义出现次数 = 2（`theme.css`、`tailwind/index.css`） | 脚本 | 记录 |
| 慢加载 Chat 资产列表时出现「还没有保存的…」空态文案 | app 单测 / e2e | **红** |
| Work Artifact 在 `sync().status === "loading"` 时显示空态文案 | app 渲染测试 / e2e | **红** |
| `WorkflowRuntimePanel` 生产挂载数 = 1 | 脚本 | 记录（`custom-snapshot-panel.tsx:188`） |
| `SessionRightPanel` 生产消费者数 = 4，custom 分支消费者 = `CustomSessionPanel` | 脚本 | 记录 |

**产物**：`docs/review/v2-five-mode-ux-remediation-2026-09-22/baseline.md`，记录每条断言的初始输出、命令、基线 SHA。
**停止条件**：任一条「红得不对」（红因不是被测缺陷而是断言写错）→ 重写断言，不得进入 S1。

**门禁**：`bun --cwd packages/app typecheck`、`bun --cwd packages/ui typecheck`

---

### S1：`--radius-*` 双定义归并（归并）

**SPIKE（先于 RED）**：在临时工作树中把 `tailwind/index.css:59-63` 改为 alias，分别构建 app 和 UI 消费链，读取最终 CSS 与浏览器计算值。验收是 `getComputedStyle` / 构建产物中的 `--radius-*` 与 `theme.css:45-49` 数值一致。若 alias 只因后置字面量 cascade 才生效，则本项降级为“唯一字面量真源 + 构建产物一致性测试”，不宣称源码只出现一次。

**RED**：新增构建产物行为断言，证明 alias 方案在目标构建中与权威值一致。禁止用源码 `toContain` / 声明计数作为 RED。

**先决实测**（写入 S1 证据，不允许推断）：把 `theme.css` 的导入链钉死——`packages/app/src/index.css:1` → `@aigcfroge/ui/styles/tailwind` → `packages/ui/src/styles/tailwind/index.css:5` → `@import "../index.css"` → `packages/ui/src/styles/index.css:4` → `@import "./theme.css" layer(theme)`；另一条 `packages/ui/src/v2/styles/tailwind.css:2` → `@import "./theme.css"`。确认 `theme.css` 的 `:root` 组在两条链上都可达。

**GREEN**：spike 通过后，`packages/ui/src/styles/tailwind/index.css:59-63` 由复制字面量改为引用既有声明，**照抄同文件 `:65-73` 已有的 house 模式**（`--shadow-xs: var(--shadow-xs);` 等 8 行就是这么写的）：

```css
  /* Was a literal copy of theme.css:45-49. Referencing keeps one source for the
     value while still registering the radius namespace for `rounded-*`. */
  --radius-xs: var(--radius-xs);
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
  --radius-xl: var(--radius-xl);
```

**REFACTOR**：无（改动即最小）。

**门禁**：
- 构建产物中 `--radius-xs` 等仍出现在最终 CSS，且运行时计算值与 `theme.css` 一致
- `bun --cwd packages/app typecheck`、`bun --cwd packages/ui typecheck`
- `bun --cwd packages/ui test`（UI 组件样式契约）

**数据流复查**：`theme.css:45-49`（值）→ 构建 → `:root` 运行时 → `var(--radius-*)` 消费者（10+ 处）与 `rounded-*` 工具类（当前 0 使用，但 S2 开始会用）。**确认 S1 之后 S2 的替换目标确实生效**——若自引用导致工具类失效，S2 会全线失败，故 S1 必须先单独出绿证。

**风险**：Tailwind v4 `@theme` alias 的 cascade 语义必须由 spike 决定。若不能获得单一真源，回退方案 = 保留字面量并加入构建物等值检查，不把文本重复宣称为语义重复。

---

### S2a：圆角复用既有 token（107 处无争议映射）

**先决**：S1 spike 与绿证在手。

**RED**：选择至少一个 app 组件和一个 v2 组件，断言其计算圆角在映射前后保持 2/4/6/8/10px；源码计数只作为一次性覆盖审计。

**映射表**（107 处零决策；含 `rounded-r-[6px]`）：

| 现值 | token | app 写法 | v2 写法 | 处数 |
| --- | --- | --- | --- | --- |
| 2px | `--radius-xs` | `rounded-xs` | `var(--radius-xs)` | 1 + 6 = 7 |
| 4px | `--radius-sm` | `rounded-sm` | `var(--radius-sm)` | 15 + 17 = 32 |
| 6px | `--radius-md` | `rounded-md` | `var(--radius-md)` | 40 + 14 = 54 |
| 8px | `--radius-lg` | `rounded-lg` | `var(--radius-lg)` | 6 + 1 = 7 |
| 10px | `--radius-xl` | `rounded-xl` | `var(--radius-xl)` | 6 + 0 = 6 |
| **合计** | | | | **107** |

**S2b 孤儿值（20 处，移出本批，单独签字）**：

| 值 | 处数 | 建议 | 理由 |
| --- | --- | --- | --- |
| `3px` | 11（app 10 + v2 1） | 归并到 `xs`（2px） | 1px 差，视觉不可辨；避免为 3px 新建 token |
| `1px` | 3（app 3） | 归并到 `xs`（2px） | 同上 |
| `12px` | 3（app 3） | 归并到 `xl`（10px） | 同上 |
| `9999px` | 3（v2 3） | 保留原值，**改用 Tailwind 内置 `rounded-full` 或直接 `border-radius: 9999px`** | 全圆角语义与 radius 尺度无关；**先实测 `@theme { --*: initial }` 下 `rounded-full` 是否仍可用**，不可用则保留字面量并加注释 |

**GREEN**：只按 107 处表批量替换，`app` 用 Tailwind 工具类、`ui/src/v2` 用既有共享维度变量。3px/1px/12px/9999px 不动。**同一浮层三处重复的 `rounded-[10px]`**（`session.tsx:2041`、`session-side-panel.tsx:214`、`session-right-panel.tsx:56`）统一为 `rounded-xl`。

**REFACTOR**：`session-right-panel.tsx` 是浮层圆角的 owner，把「浮层用 `radius-xl`」这一决定收敛到该文件一处（若三处调用点都能接收 `class`，则优先由 `SessionRightPanel` 自带，调用点不重复声明）。

**门禁**：
- RED 断言转绿；107 处映射后的计算值一致，S2b 孤儿值仍保留
- `bun --cwd packages/app typecheck`、`bun --cwd packages/ui typecheck`、`bun --cwd packages/ui test`
- `bun run script/lint-changed.ts`（带 `LINT_BASE_REF=origin/main`）
- **视觉验证**：`bun --cwd packages/app test:e2e`（超时 ≥180s）+ 人工截图比对五模式浮层/卡片圆角

**数据流复查**：`theme.css` → `@theme` 命名空间 → `rounded-*` 工具类 → 组件 class；`theme.css` → `var()` → v2 CSS。两条链在 S1 之后指向同一值。

**规模提示**：本批 107 处替换，S2b 的 20 处另批。**按包拆提交**（`refactor(app)` / `refactor(ui)`），按目录分批回滚。

---

### S3：`WorkflowRuntimePanel` 挂进 work 分支（复用）

**RED**：断言「work 模式右栏在 workflow 会话中存在 `WorkflowRuntimePanel` 挂载」。现状 work 分支（`session-side-panel.tsx:370` → `WorkSessionPanel`）无此组件 → **红**。

**先决实测**：读 `packages/app/src/pages/work-artifact-panel.tsx:214+` 的 `WorkSessionPanel` 全体，确认它当前的 Tab 结构（`context` / `artifact`，`SessionRightPanel` 包装）。确认 `WorkflowRuntimePanel(props: { sessionID?: string; adapter?: WorkflowRuntimeAdapter })` 的接口只依赖 `sessionID`，不依赖 custom 上下文。

**GREEN**：在 `WorkSessionPanel` 的 Tab 结构中引入第三个位置承载 `WorkflowRuntimePanel`，**复用 `custom-snapshot-panel.tsx:188` 的同一调用形态**（`<WorkflowRuntimePanel sessionID={...} />`），不新增 wrapper、不改组件接口。

**待决策（写入 §12）**：新增独立 Tab（`workflow`）vs 挂在 `artifact` Tab 内部。建议**独立 Tab**——理由：`WorkflowRuntimePanel` 已有自己的状态与动作（cancel / retry / status），塞进 `artifact` 会让一个 Tab 承载两个 owner，违反「一个原语一个 owner」。**但 `SessionRightPanel` 的 Tab 集合变更会触及 `createActiveTabWriteback` 的允许值列表（`work-artifact-panel.tsx:220-224` 的 `context | artifact` 白名单），需同步扩展。**

**REFACTOR**：`WorkSessionPanel` 的 Tab 白名单（`activeTab` memo 与 `selectTab` 的双重校验）抽成一个具名常量，消除「同一约束写两遍」。

**门禁**：`bun --cwd packages/app typecheck`、`bun --cwd packages/app test`、e2e workflow 会话场景。
**数据流复查**：`WorkflowRuntimePanel` → `createWorkflowRuntimeAdapter(sdk().client)` → `runtime.get(sessionID)` → `sdk().directory` 事件刷新。确认 work 会话的 `sessionID` 与 `sdk().directory` 在该分支已 provide（与 custom 分支同源）。

---

### S4：三态契约（重构，跨 5 模式）

**先决**：这是本批最大的一项，**按模式拆子片**，每子片独立 RED→GREEN→门禁。`docs/technical-debt.md:86` 已明确「仍缺：loading 骨架屏（状态已建模并返回，但只用于抑制空态提示）」——本 Slice 是接着该条做，不新立项。

**S4a — 状态归属（先测试，后提取）**

`custom-asset-catalog.ts:64` 的 `CatalogStatus` 与 `:86` `showsEmptyState` 已在生产验证。先在 Chat/Custom 各自写出状态行为测试；只有两边确实共享同一决策函数时才提取 owner，并优先把现有 `catalogStatus`  generalize，而不是新建平行 `AsyncViewState`。若提取只能服务一次，保留在本地，不新增文件。

**S4b — Chat 资产列表（`asset-workbench.tsx`）**

- RED：慢加载时 `asset-workbench` 出现 `noAssets` → 红
- GREEN：先在 `ModeWorkspaceAssetContext` 暴露与 `chat-assets.tsx` 同一个 `list` resource 的 loading 状态；`props` 增加 `state`，`:298-304` 的 `<Show when={rows().length > 0}>` 改为三态分支：`loading` → 骨架（**复用 `SessionSkeleton` 的行骨架视觉**，不新建组件家族）、`error` → `AssetLoadError`、`ready && 空` → `noAssets`
- 注意 `chat-assets.tsx:124` 的 `list` 是 `createResource`，且注释说明「单个 endpoint 失败贡献空而非 reject」——`failed` 数组已存在，`error` 态直接由 `failed.length` 派生，**不要新造错误通道**
- 门禁：`bun --cwd packages/app test packages/app/src/components/chat/`

**S4c — Work Artifact（`work-artifact-panel.tsx`）**

- RED：`sync().status === "loading"` 且无 candidate 时仍出现 `work.artifact.empty` → 红
- GREEN：`:144-209` 前插入由 `sync().status` 决定的 loading 分支；候选内容本身仍是同步投影，不伪造额外异步状态。`partial` 至少不得显示 loading，complete + 无候选才走 empty
- 门禁：`bun --cwd packages/app test packages/app/src/pages/`

**S4d — Assistant 引用加载（`message-timeline.tsx:372-375`）**

- RED：`kb.get` 失败时无任何用户可见反馈 → 红
- GREEN：空 catch 改为把失败落入一个可见态（引用浮层内的错误行 + 可重试），**不吞异常**（`CLAUDE.md` Catch Everything）。错误文案走 i18n（en/zh/zht）
- 门禁：`bun --cwd packages/app test packages/app/src/pages/session/`

**S4e — Custom 加载骨架（`custom-sidebar.tsx`）**

- RED：`status === "loading"` 时列表区渲染 `noAgents` → 红
- GREEN：`custom-sidebar.tsx:236-242` 的 fallback 改为按 `status` 分支（`loading` → 骨架、`partial`/`error` → 保留现有横幅、`ready && 空` → `noAgents`）。`showsEmptyState`（`:86-87`）保持不变
- 门禁：`bun --cwd packages/app test packages/app/src/components/custom/`

**S4f — Coding 空/错/载区分**

- 先决实测：`five-mode-dogfood-remediation-2026-09-04.md` §2.3 的 P1-TURN-STALL 已闭环「stalled 出口」，本子片**只做空态与错误态的区分**，不重开该缺陷
- RED：`MessageTimeline` 在无输出 + 非 busy 时与加载中的渲染不可区分 → 红
- 若实测发现已被 §2.3 覆盖 → **本子片取消，写入 S4 证据说明「无需改动」**（诚实登记，不硬造改动）

**收敛验收**：5 个模式在 loading 期均不出现「还没有…」类文案。

---

### S5a：Custom 采用 `SessionRightPanel`（复用）

**先决实测**：读 `packages/app/src/components/custom/custom-snapshot-panel.tsx` 的 `CustomSessionPanel` 全体，判定它是「自建面板外壳」还是「纯内容」。这决定 S5a 是**换包装**还是**改内部**——不允许推断。

- 若是自建外壳 → GREEN = 用 `SessionRightPanel` 替换外壳，内容不动（纯复用）
- 若是纯内容 → GREEN = 在 `session-side-panel.tsx:372-380` 的 custom 分支外包一层 `SessionRightPanel`，`CustomSessionPanel` 不动

**RED**：行为断言 Custom 会话面板仍保留 `CustomDraftProvider` 数据链，同时具备 `SessionRightPanel` 的 review/file-tree 契约；源码消费者计数只作为一次性审计。

**GREEN**：按先决实测结论二选一。**不新建组件**。
**REFACTOR**：若 `CustomSessionPanel` 内有可下沉到 `SessionRightPanel` 的通用能力（如宽度持久化），下沉；否则不动。
**门禁**：`bun --cwd packages/app typecheck`、`bun --cwd packages/app test packages/app/src/components/custom/`、e2e custom 会话。
**数据流复查**：`CustomDraftProvider`（`session-side-panel.tsx:373-379`）仍必须包裹内容 —— `SessionRightPanel` 只替换**外壳**，不得打断 Provider 链。

---

### S5b：取消（原前提不成立）

`modeContentPanelShown()` 已是唯一门谓词（`layout-helpers.ts:85-86`），coding 的窄屏排除是带注释与回归测试的刻意决策（`layout.test.ts:139-145`）。原 B1 只是把同一条件换个写法，B2 则是撤销既有设计，均不属于本批收敛。

**后续 unlock**：若产品坚持让窄屏 coding 增加浮层入口，另立 ADR/设计评审并修改该谓词的所有消费者；本批不改。

---

### S6：延期待裁决（缺少空白资产创建契约）

当前没有独立的“空白创建 endpoint”；写入路径是 per-kind `Candidate` + `*.apply`，且不同 kind 的必填字段、权限与路径派生不同。先做产品/技术设计，明确七类资产的 blank Candidate 契约、apply/refetch 链与权限语义后再立项。

本批只保留现状 AI 起草路径；伪造 `sessionID` 的 `docs/technical-debt.md:141` 也不借机修改。

---

### S7：移出本批（Chat 导航专项）

`docs/architecture/pages/chat.md:13,40-41` 已规定：Session 导航归 `ChatFeatureSidebar`，主区继续由 `ChatAssetWorkbenchMain` 承载资产。原 S7a 把 `CodingSessionListMain` 放进 Main，会违反该 owner 边界，因此不在本批实施。

现有 Feature 控件已经是 `<button>` 且可键盘聚焦；`cursor-default` 只是视觉提示。在未确认“Feature 是筛选还是导航”之前，不应为了“可点”强行补路由。两项合并为 Chat 导航专项，先做信息架构裁决。

---

### S8：无障碍语义与空态文案

**S8a — `asset-load-error.tsx` 补 `role="alert"`**（`:20-38` 无 `role`）
- RED：断言横幅容器有 `role="alert"` → 红
- GREEN：加 `role="alert"`（错误横幅是 assertive 场景）；确认文案节点与动作按钮仍可被读屏访问
- 门禁：`bun --cwd packages/app test packages/app/src/components/`

**S8b — `work-artifact-panel.tsx` 无障碍语义 = 0**
- RED：断言该文件 `aria-` / `role=` 命中数 > 0 → 红
- GREEN：按 `DESIGN.md` 无障碍规范补齐——Tab 容器/触发器（若已用 `TabsV2` 则其语义由组件提供，**先实测，不重复加**）、预览区 `role`/`aria-label`、冲突 Dialog 已有 `Dialog` 语义（`:99`，实测确认）、加载/错误态的 `aria-live`
- 门禁：`bun --cwd packages/app test packages/app/src/pages/`、e2e + 键盘走查
- **禁止**：为凑计数加无意义 `aria-*`

**S8c — Work preset 空态：取消**。当前 `WorkArtifactContent` 没有 `preset` 输入或 preset 状态，原计划引用的前提不存在；真实三态由 S4c 处理。

---

### S9：Assistant 引用溯源 + 错误可见性

**范围声明**：**不碰 scope 选择器**（`technical-debt:48`，归 Assistant 专项）。

**S9a — 引用浮层补「打开笔记」（显式入口，本批移出）**
- 现状已自动 `openEntityPanel` 并用完整 `note.content` 展示 KB Tab；`KBNote.Note` 没有 `url/source/relativePath`，也不存在“外部原文 URL”契约
- 若后续做，只在浮层增加按钮，复用现有 `openEntityPanel({ kind: "kb", itemId: id })`；不改 core/schema，不以摘要冒充原文
- 本批先随 Chat/Assistant 导航裁决一起处理，避免新增无关产品动作


**S9b — 变更失败可见化（P1）**
- 现状：`assistant-dashboard.tsx:86/92/98/138/147/156/220/227` 一律 `.catch(console.error)`，页面只给通用 `loadError`
- RED：断言变更失败产生用户可见、可理解的反馈 → 红
- GREEN：统一到既有错误呈现 owner（`AssetLoadError` 或该页既有横幅），文案走 i18n；**禁止吞异常**
- 门禁：`bun --cwd packages/app test packages/app/src/pages/`

**S9c — 目录导入：延期到 KB 安全专项**
- `syncFromDirectory` 只有 core 服务（`kb-service.ts:113,681`），KB HTTP group 未暴露该操作
- 新增入口需要先定义允许目录、scope 授权、路径 containment、失败回滚与审计；不能作为 UI 接线直接实施


---

## 6. 文件变更范围（修订后）

| 包 | 文件 | Slice |
| --- | --- | --- |
| `packages/ui` | `src/styles/tailwind/index.css` | S1 |
| | `src/v2/**`（38 处无争议 `border-radius`） | S2a |
| `packages/app` | `src/**`（68 处无争议 `rounded-[Npx]`） | S2a |
| | `src/pages/session/session-side-panel.tsx` | S5a |
| | `src/pages/work-artifact-panel.tsx` | S3 / S4c |
| | `src/components/chat/asset-workbench.tsx` / `chat-assets.tsx` | S4b |
| | `src/pages/mode-workspace-context.ts` | S4b（暴露同一 resource 状态） |
| | `src/components/custom/custom-sidebar.tsx` | S4e |
| | `src/components/asset-load-error.tsx` | S8a |
| | `src/pages/session/timeline/message-timeline.tsx` | S4d |
| | `src/pages/assistant-dashboard.tsx` | S9b |
| | `src/i18n/{en,zh,zht}.ts` | S4d / S9b |
| `docs` | `technical-debt.md`（闭环与新增） | 全批 |

**新增文件上限：0 个**；只有 S4a 的行为测试证明 Chat/Custom 必须共享同一 owner 时，才允许提取一个状态 helper，并需在提交说明中记录复用证据。

## 7. 提交与 PR 切片

每个提交只承载一个可独立验证、可独立回滚的变更，消息体写「红在哪 / 为什么这么修」。

| 提交 | 内容 |
| --- | --- |
| `docs` | 第 2 版审批修订与基线记录 |
| `test(app)` / `chore(script)` | S0 行为基线 |
| `refactor(ui)` | S1 radius 真源归并（spike 通过后） |
| `refactor(app)` | S2a app 侧 68 处无争议圆角映射 |
| `refactor(ui)` | S2a v2 侧 38 处无争议圆角映射 |
| `feat(app)` | S3 WorkflowRuntimePanel 独立 Tab |
| `fix(app)` | S4b Chat 三态 |
| `fix(app)` | S4c Work Artifact loading |
| `fix(app)` | S4d Assistant 引用加载可见化 |
| `fix(app)` | S4e Custom 加载骨架 |
| `refactor(app)` | S5a Custom 采用 SessionRightPanel |
| `fix(app)` | S8a AssetLoadError `role="alert"` |
| `fix(app)` | S9b Assistant mutation 错误可见化 |
| `docs(debt)` | technical-debt 按实际闭环状态更新 |

**PR 边界**：本批只含无产品契约变更的 A 批；S2b、S5b、S6、S7、S8c、S9a、S9c 不进入本 PR。

## 8. 验证命令

### 8.0 本计划编制期已实跑的命令（复核证据）

```bash
git rev-parse HEAD; git rev-parse origin/main; git rev-list --left-right --count origin/main...HEAD; git rev-parse --abbrev-ref HEAD
grep -rn -- "--v2-radius" packages --exclude-dir=dist --exclude-dir=node_modules --exclude-dir=.git
grep -rhoE "rounded-\[[0-9]+px\]" packages/app/src --include='*.tsx' --include='*.ts' | sort | uniq -c | sort -rn
grep -rhoE "border-radius:\s*[0-9]+px" packages/ui/src/v2 --include='*.tsx' --include='*.ts' --include='*.css' | sort | uniq -c | sort -rn
grep -rn "var(--radius-" packages/app/src packages/ui/src packages/session-ui/src --exclude-dir=dist
grep -rnoE "rounded-(xs|sm|md|lg|xl)(\b|[^a-z])" packages/app/src packages/ui/src --exclude-dir=dist
grep -rn "WorkflowRuntimePanel" packages/app/src | grep -viE '\.stories\.|\.test\.|\bimport\b|function WorkflowRuntimePanel'
grep -rln "SessionRightPanel" packages/app/src --include='*.tsx' | grep -viE '\.stories\.|\.test\.'
grep -cE "aria-|role=" packages/app/src/pages/work-artifact-panel.tsx
sed -n '148,154p;144,209p' packages/app/src/pages/work-artifact-panel.tsx
sed -n '230,250p' packages/app/src/components/custom/custom-sidebar.tsx
sed -n '296,306p' packages/app/src/components/chat/asset-workbench.tsx
sed -n '108,135p;205,230p' packages/app/src/components/chat/chat-assets.tsx
sed -n '362,385p' packages/app/src/pages/session/session-side-panel.tsx
sed -n '200,232p' packages/app/src/pages/session/session-side-panel.tsx
sed -n '84,92p' packages/app/src/components/custom/custom-asset-catalog.ts
sed -n '450,462p' packages/app/src/pages/mode-workspace-slots.tsx
sed -n '120,130p;185,195p' packages/app/src/components/mode-surfaces.tsx
sed -n '1,40p' packages/app/src/components/asset-load-error.tsx
sed -n '130,134p' packages/app/src/pages/assistant-dashboard.tsx
sed -n '10,24p' packages/app/src/pages/work-artifact-extract.ts
sed -n '45,50p;59,66p' packages/ui/src/styles/theme.css
sed -n '55,74p' packages/ui/src/styles/tailwind/index.css
sed -n '1,8p' packages/app/src/index.css
for ln in 48 80 86 141 156; do sed -n "${ln}p" docs/technical-debt.md; done
```

### 8.1 逐 Slice 门禁命令

```bash
# 增量 lint —— 基线陷阱：本地 main 有未推送提交时必须显式给基线
LINT_BASE_REF=origin/main bun run script/lint-changed.ts

# 包级 typecheck（tsgo，不用 tsc；只跑本 slice 触达的包）
bun --cwd packages/ui typecheck
bun --cwd packages/app typecheck        # app 用 tsgo -b
bun --cwd packages/session-ui typecheck # 仅在触达 session-ui 时

# 包级测试（永不从根目录跑）
bun --cwd packages/ui test
bun --cwd packages/app test                    # 注意：app 的 test 脚本会吞掉 --timeout
bun --cwd packages/app test:unit:file src/components/chat/asset-workbench.test.tsx   # 单文件
bun --cwd packages/core test --timeout 30000   # 仅在触达 core 时

# e2e（超时 ≥180s）
bun --cwd packages/app test:e2e

# 协议引用检查（docs 改动后）
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
```

**已知基线失败（编制期未复跑，须在 S0 preflight 记录真值）**：`packages/cli` typecheck 的 `Effect.fn R=unknown`、`packages/app/happydom.ts` 的 lint error 在 `main` 即存在，非本批引入。S0 必须把这批基线红**完整记录命令 + 首个错误**，不得算作本计划绿证。

---

## 9. RED→GREEN 证据模板（每 Slice 必填）

```text
Slice: S<n> <名称>
基线 SHA: <origin/main 实测 SHA>

RED
  命令: <完整命令>
  输出: <首个失败断言 + 计数，原样粘贴>
  判定: 红的原因 == 被测缺陷（不是断言写错）

GREEN
  命令: <同一命令>
  输出: <通过计数>
  命令: <typecheck / lint 命令>
  输出: <rc 与计数>

REFACTOR
  动作: <做了什么 / 或 "无">
  复跑: <同 GREEN 命令，输出>

数据流复查
  链路: <从数据源到消费者的完整链，逐层写>
  确认: <每层的 Layer/Provider 已 provide；条件分支两端都有实际路径>

未做 / 偏离
  <诚实登记，不掩盖>
```

---

## 10. 停止条件与回滚

**停止条件（任一命中即停，不进入下一 Slice）**：

1. S1 alias spike 不能提供唯一字面量真源 → 保留双字面量 + 加构建物等值门禁，S2a 仍可继续，但不得宣称文本归并完成
2. S2a 任一无争议映射产生非预期计算值 → 停止该批，回查映射
3. S4 子片没有可观察状态窗口 → 记债，不造假状态
4. 任一 RED 使用源码字符串/声明计数替代行为 → 打回重写
5. e2e 出现非本批引入的失败 → 先记录基线，不得混算

**回滚**：每 Slice 一个独立提交，`git revert <sha>` 即可。S2a 按包 + 目录分批，可局部回滚。本批无跨包写入项。

---

## 11. Definition of Done

- [ ] S0 行为基线落盘，含完整命令与失败证据
- [ ] A 批 S1、S2a、S3、S4b–S4e、S5a、S8a、S9b 全部 RED→GREEN→REFACTOR
- [ ] S1 有 spike 结论：唯一字面量真源 + 构建物等值，或明确降级并登记债
- [ ] S2a 只替换 107 处无争议映射，S2b 的 20 处未混入
- [ ] 触及的 Chat、Work、Custom 在 loading 期不出现空态文案
- [ ] `SessionRightPanel` 生产消费者 = 5；`WorkflowRuntimePanel` 生产挂载 ≥ 2（custom + work）
- [ ] `asset-load-error.tsx` 有真实 `role="alert"`
- [ ] 无 core / aigcfroge 协议或 HTTP 变更
- [ ] 新增 locale = 0；新增 i18n 键仅落 en/zh/zht
- [ ] 新增文件 = 0，除非 S4a 有跨消费者复用证据
- [ ] `LINT_BASE_REF=origin/main bun run script/lint-changed.ts` 通过
- [ ] 触达包 typecheck rc=0
- [ ] 触达包 test 全绿并写出计数
- [ ] 相关 e2e 通过（宽屏 + 窄屏）
- [ ] `docs/technical-debt.md` 按实际闭环状态更新
- [ ] 复查结论按 `CLAUDE.md` 模板输出

---

## 12. 裁决记录（第 2 版）

| # | 事项 | 结论 | 状态 |
| --- | --- | --- | --- |
| G1 | 批次范围 | 只做修订后的 A 批；B 批拆出 | **批准** |
| G2 | S5b 门收敛 | 取消；现有唯一谓词与 coding 窄屏设计保留 | **关闭** |
| G3 | S6 Chat 空白创建 | 延期；先定义 per-kind blank Candidate + apply/refetch 契约 | **延期** |
| G4 | S2b 3px/1px/12px 视觉归并 | 不进入本批，单独设计签字 | **待决** |
| G5 | `9999px` 全圆角 | 当前构建已有 `.rounded-full`；本批不动，将来可保留字面量 | **关闭** |
| G6 | S3 承载方式 | Workflow 独立 Tab | **批准** |
| G7 | S9a 原文动作 | 不扩服务端字段；将来仅增加复用 `openEntityPanel` 的显式按钮 | **关闭/延期实施** |
| G8 | 本计划执行授权 | 批准第 2 版 A 批 | **批准** |

---

## 13. 方案对冲声明

### 13.1 简单实现 vs 健壮架构

| 项 | 简单实现（未采纳） | 采纳方案 | 为什么 |
| --- | --- | --- | --- |
| 圆角 | 新建 `--v2-radius-*` token 收敛 131 处 | 复用既有 `--radius-*` + 归并双定义 | 既有值完全对得上，新建即负债；审计 §三 ① 已撤回新建方案 |
| 三态 | 每个模式各写一套 tri-state | 提取 `custom-asset-catalog.ts` 既有模型为共享 owner | 该模型已在生产验证，提取是归并；平行实现违反「单一真源」 |
| Custom 右栏 | 为 Custom 写一个面板 | 采用既有 `SessionRightPanel` | 原语采用率 4/5，第 5 个应接线而非造件 |
| Workflow 面板 | 为 work 造运行时面板 | 挂既有 `WorkflowRuntimePanel` | 组件模式无关，零新增 |
| Chat 创建 | 新建创建流程 | 复用既有创建端点 + `refetch` 链 | 不新增写入路径 |

### 13.2 反向方案（**明确不采纳**及理由）

| 反向方案 | 为什么不采纳 |
| --- | --- |
| 新建 `--v2-radius-*` token | 「新增」不是「复用」；既有 token 值与加载链都对得上 |
| Custom 入口按 `ProductModePolicy` 统一谓词显隐 | `app` 引任何传递依赖 `core/flag/flag.ts` 的模块会让 Web 构建白屏（`technical-debt:156`），照做打挂构建 |
| 把 Work 执行引擎缺口当 P0 修 | 有文档的 deferral（`chat-m5-workflow-asset.md:35/:48`），不是未登记缺口 |
| 为凑 i18n parity 给 16 个 locale 补 `work.*` | English fallback 是既定约定（`parity.test.ts:4`），且 `CLAUDE.md` 记只维护 en/zh/zht |
| S4c 造一个假 loading 让分支数对齐 | `No Cheating`。无异步窗口就记债，不造假状态 |
| S8b 为凑 `aria-` 计数加无意义属性 | 无障碍语义要真实；`DESIGN.md` 禁止装饰性 ARIA |
| 顺手修 `technical-debt:141` 的伪造 sessionID | 该条 unlock = 「下次资产端点改动时」，本批不改资产端点 |

### 13.3 已知技术债（本计划**新引入**或**明确保留**）

| 债 | 来源 | 触发条件 |
| --- | --- | --- |
| S1 若 alias 不能独立成立，`--radius-*` 文本仍有双字面量 | S1 spike | Tailwind 主题合并机制变化或全仓 token 清理专项 |
| S2b 的 1px/3px/12px 视觉归并未做 | 本版范围裁决 | 设计确认视觉差异可接受时 |
| S5b coding 窄屏「换页非收栏」语义错位保留 | 现有刻意设计 | 窄屏 coding 交互设计定稿并立 ADR 时 |
| S6 仍只有 AI 起草路径 | 缺空白 Candidate 契约 | 七类 blank create 设计完成后 |
| S7 Chat Session 导航未做 | Owner 边界为 ChatFeatureSidebar | Chat 导航专项启动时 |
| S9a 浮层仍无显式“打开笔记”按钮 | 自动打开 KB Tab 已保底 | Assistant 导航专项启动时 |
| S9c 目录导入 UI 未做 | KB HTTP/security 契约缺失 | KB import ADR 通过时 |

---

## 附：与审计 §五的对照

| 审计 §五 序 | 动作 | 本计划 | 状态 |
| --- | --- | --- | --- |
| 1 | 硬编码圆角 → 既有 `--radius-*` | S2a 107 处；S2b 20 处另批 | S2a 执行，S2b 待决 |
| 2 | 合并 `--radius-*` 双定义 | S1 spike + 构建物等值 | 执行 |
| 3 | `WorkflowRuntimePanel` 挂进 work | S3 | 执行 |
| 4 | 三态契约 | S4b/S4c/S4d/S4e | 执行 |
| 5 | `ResizeHandle` 重构 | — | 已完成 |
| 6 | Custom 补 `SessionRightPanel`；两门收敛 | S5a 执行；S5b 取消 | 部分执行 |
| — | Chat 创建、Chat 导航、Work preset、目录导入 | S6/S7/S8c/S9c | 移出本批 |
| — | Assistant 引用显式打开 | S9a | 延期，现有自动打开保底 |
