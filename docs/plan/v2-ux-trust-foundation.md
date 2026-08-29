# V2 UX 可信底座实施计划：首个执行切片

> **来源路线图**：[docs/roadmap/v2-ux-ui-roadmap.md](../roadmap/v2-ux-ui-roadmap.md)（2026-08-29，**有条件进入执行**）
>
> **范围**：路线图 §7「首个执行切片」6 项 = Phase 0 能力校准 · Phase 1 几何基线 · Phase 2 状态词汇与错误真实性 · Phase 3 Token 迁移试点 · Review gate。
>
> **明确不在本计划内**：Phase 4 五模式核心闭环、Phase 5 高级能力、Phase 6 Custom M2 编排画布、Phase 7 持续质量门禁矩阵。**不做**玻璃/粒子/渐变、Auto-Review、Thought Canvas、Skill Budget Gauge、DAG 画布、全仓 Token codemod。**不改任何服务端或 core 代码**（归 [v2-architecture-governance-slice-0-3.md](v2-architecture-governance-slice-0-3.md)）。
>
> **分支**：`v2-ux-foundation`　**工作区**：`.worktrees/v2-ux`　**并行伙伴**：`v2-lifecycle-owner`
>
> **状态**：草案，待人类批准开工。§4.3 的 `data-status` 命名裁决与 §4.1 的双信号合成规则需要产品/设计确认。

---

## 0. 开工 Gate 与实测基线

### 0.1 工程基线（本计划撰写时实测）

| 项 | 实测结果 |
| --- | --- |
| 分支基线 | `main@eeaec64f2`，与 `origin/main` 零差异 |
| typecheck | app / ui / session-ui + core / schema / aigcfroge / desktop **7 包全 PASS** |
| 增量 lint | `Incremental lint passed: no changed JavaScript or TypeScript files`（命令必须带 `LINT_BASE_REF=origin/main`） |
| 协议引用 | 32/32 OK |

### 0.2 路线图统计的重新扫描（**以本节为准，不以旧快照为准**）

路线图 §3 的数字来自 `2026-08-28 / main@f21cb4be5` 快照。逐文件在 `f21cb4be5` 与 `HEAD` 上分别重算 `var(--` 非 v2 引用，两次结果**完全相同** ⇒ 下列差异全部是**口径差异，不是代码漂移**。

| 项 | 路线图 | 实测 | 判定 |
| --- | --- | --- | --- |
| v2 组件 `.tsx`（`packages/ui/src/v2/components`） | 51 | **51**（其中 24 个是 story ⇒ 真正组件 **27**） | ✅ 一致 |
| v1 组件 `.tsx`（`packages/ui/src/components`） | 68 | **68**（33 story ⇒ 组件 **35**） | ✅ 一致 |
| 主题 JSON（`packages/ui/src/theme/themes`） | 37 | **37** | ✅ 一致 |
| 旧 Token 引用 | ui 580 / app 55 / session-ui 266 | **ui 534 / app 100 / session-ui 484**（口径：剔除 `**/styles/**` 定义层与 `*.stories.tsx`） | ❌ 口径不同，**本计划采用实测口径** |
| App 直接导入旧组件入口的源文件 | 约 60 | **76** | ❌ 偏低 |
| 旧组件入口的**路径形式** | `@aigcfroge/ui/components/...` | 该形式**在 exports map 里不存在**；真实是 `@aigcfroge/ui/<name>`（`packages/ui/package.json:7-8`：v1 = `"./*": "./src/components/*.tsx"`，v2 = `"./v2/*"`） | ❌ 需更正 |
| syntax / markdown / diff / input 语义 Token | 视为「缺失，需补齐」 | **四组全部已存在**：syntax 19 + markdown 14 + diff 11 + input 6，位于运行时主题生成层 `packages/ui/src/theme/v2/{syntax-markdown,diff,mapping}.ts` | ❌ **前提错误**，真实缺口见 §3.4 |
| 11 个状态「统一现有命名」 | 隐含都已存在 | `refreshing` 全仓 **0 次**；`stale` 只作缓存变量名/注释（**无 UI 语义**）；`recovery` 只有 `workflowRuntime.status.recovery_required` 一个枚举值 | ⚠️ 3 个是**净新增**，不是统一 |

**可复现基线命令**（固定这一组口径，写进 PR）：

```bash
git rev-parse HEAD                                                                   # eeaec64f2
find packages/ui/src/v2/components -name '*.tsx' -not -name '*.stories.tsx' | wc -l  # 27
find packages/ui/src/components    -name '*.tsx' -not -name '*.stories.tsx' | wc -l  # 35
find packages/ui/src/theme/themes  -name '*.json' | wc -l                            # 37
for p in ui app session-ui; do printf "%-11s " $p; rg -o --no-filename \
  'var\(--(?!v2-)[a-zA-Z0-9-]+' --pcre2 -g '*.tsx' -g '*.ts' -g '*.css' \
  -g '!*.stories.tsx' -g '!**/styles/**' packages/$p/src | wc -l; done               # 534 / 100 / 484
rg -l 'from "@aigcfroge/ui/(?!v2/|context|hooks|theme|i18n/|styles|storybook/|icons/|fonts/|audio/)' \
  --pcre2 packages/app/src | wc -l                                                   # 76
rg -o '^\s*(--v2-[a-z0-9-]+)\s*:' -r '$1' --pcre2 packages/ui/src/v2/styles/*.css | sort -u | wc -l   # 228
rg -o '^\s*--color-(v2-[a-z0-9-]+):' -r '$1' packages/ui/src/styles/tailwind/colors.css | wc -l       # 50
```

### 0.3 开工前置

1. 人类批准本计划，并确认 §4.3 的 `data-status` 属性命名与 §4.1 的双信号合成规则。
2. 已读：[DESIGN.md](../../DESIGN.md)（全文，尤其 §CSS Conventions / §Components / §Text And I18n / §Accessibility / §Verification）、[CLAUDE.md](../../CLAUDE.md)、[AGENTS.md](../../AGENTS.md) §Style Guide / §Imports、[docs/testing.md](../testing.md) §4 与 §10、`.aigcfroge/skills/frontend-theming/SKILL.md`。
3. 确认并行分支的所有权矩阵（§2.2），特别是「**永不跑 SDK 生成器**」。

### 0.4 产品承诺禁令（路线图 §9.2）

交付物中**不得**出现：「100% 纯 V2」、Approval Center 具备自治 Auto-Review、Thought Canvas、`2% Skill Budget Gauge`、DAG 画布/断点/单步、以及任何把 `unsupported` / `disabled` / 网络错误渲染成空列表的实现。

---

## 1. 目标与非目标

| 编号 | 目标 | 对应路线图 | 退出条件 |
| --- | --- | --- | --- |
| G1 | 模式入口的可见性/可用性/不可用原因来自**同一份** capability-aware registry | Phase 0 · 切片 1 | `enabled` / `disabled` / `unknown` 三态可解释；ModeSwitcher、Home 筛选、ModeRoute 不再各自枚举模式 |
| G2 | 几何冲突用 computed geometry 事实解决 | Phase 1 · 切片 2 | desktop/narrow 无横向溢出；列宽结论有可重复的 e2e 记录；`960px` 死数字被删除且行为等价 |
| G3 | 11 个状态成为共享语义层 + i18n key | Phase 2 · 切片 3 | 五模式不再各自命名/着色同一状态；每个阻塞状态有原因+影响+下一步 |
| G4 | Custom 资产列表不再把失败渲染成空 | Phase 2 · 切片 4 | 网络失败、加载中、真空态三者可区分且有重试 |
| G5 | v1→v2 迁移方法被两条路径证明可复用 | Phase 3 · 切片 5 | 迁移账本成形；试点路径 light/dark + 键盘 + 中英文行为一致；新改动不增加 legacy 引用 |
| G6 | 形成第一份真实 V2 UX 基线报告 | 切片 6 | §0.2 口径的数字 + 几何记录 + 状态矩阵截图齐备 |

**非目标**：不承诺 legacy Token/组件清零；不做 codemod 全仓替换；不补 e2e 的 dark/i18n/keyboard 矩阵（那是 `docs/technical-debt.md` §4 已登记的独立专项，实测当前 dark 0/18、i18n 0/18、keyboard 2/18，本计划不承担）；不动 `SessionRightPanel` 的窄屏形态（它不在 `/mode/:mode` 链路上，见 §3.3）；不新增服务端端点。

---

## 2. 并行执行契约（与 `v2-lifecycle-owner` 共享，两份计划逐字一致）

> 本节是「两个工作区同时进行、分别开 PR、合并无冲突」的机械保证。**任何一方越界即视为破坏契约，PR 打回。**

### 2.1 工作区创建（`.worktrees` 已在 `.gitignore:3`，不会污染工作树）

```bash
# 前置：批次 0 的文档基线已提交，否则两个工作区看不到路线图与本计划
git -C /media/win_data/aigcfroge worktree add .worktrees/v2-arch -b v2-lifecycle-owner main
git -C /media/win_data/aigcfroge worktree add .worktrees/v2-ux   -b v2-ux-foundation  main

# 每个工作区必须各自装依赖：node_modules 不随 worktree 共享（.gitignore:2）
cd /media/win_data/aigcfroge/.worktrees/v2-arch && bun install
cd /media/win_data/aigcfroge/.worktrees/v2-ux   && bun install
```

> **软链隐患**：仓库另有位于 `/media/keer/办公/aigcfroge/.worktrees/` 的历史 worktree，而 `/media/keer/办公` 是指向 `/media/win_data` 的软链。新建工作区请一律用 `/media/win_data/aigcfroge/...` 绝对路径。

### 2.2 包级所有权矩阵（唯一写权限）

| 包 / 路径 | 架构计划（`v2-lifecycle-owner`） | UX 计划（`v2-ux-foundation`） |
| --- | --- | --- |
| `packages/core/**` | ✅ 独占 | ⛔ |
| `packages/schema/**` | ✅ 独占 | ⛔（只读 import，如 `schema/product-mode`） |
| `packages/aigcfroge/**` | ✅ 独占 | ⛔ |
| `packages/desktop/**` | ✅ 独占 | ⛔ |
| `packages/sdk/js/**`（生成物） | ✅ 独占，**只有架构计划可跑生成器** | ⛔ 永不跑 `packages/sdk/js/script/build.ts` |
| `packages/app/**` | ⛔ | ✅ 独占 |
| `packages/ui/**` | ⛔ | ✅ 独占（含 i18n 字典、v2 token、v2 组件） |
| `packages/session-ui/**` | ⛔ | ✅ 独占 |
| `packages/storybook/**` | ⛔ | ✅ 独占 |
| `packages/llm`、`packages/tui`、`packages/plugin`、vendor 两包 | ⛔ 双方均不动 | ⛔ |

### 2.3 文档所有权矩阵

| 文档 | 架构计划 | UX 计划 |
| --- | --- | --- |
| `ARCHITECTURE.md` | ✅ 独占 | ⛔ |
| `DESIGN.md` | ⛔ | ✅ 独占 |
| `specs/v2/todo.md` · `system-blueprint.md` · 新建 ADR-22/23/24 | ✅ 独占 | ⛔ |
| `docs/technical-debt.md` §4 表 | ✅ **只在表体第一行之前插入** | ✅ **只在表体最后一行之后追加** |
| `docs/technical-debt.md` 其他节 | ⛔ | ⛔ |
| 两份 `docs/plan/*.md` | 各自独占自己那份 | 同 |

§4 表体现有 **21 行**，首尾相距远超 git 三方合并所需的 3 行上下文 ⇒ 机械可合并。

### 2.4 两条接缝（Seam）：为什么可以先后任意顺序合并

**接缝 S1 · 服务端能力读路径**

- **已存在、可复用、双方都不必新建**：端点 `/experimental/capabilities` 早已挂载（路径常量 `groups/experimental.ts:95`，定义 `:112-121`，响应 Schema `CapabilitiesResponse` `:28-34` 含 `customMode?` / `productModes?` / `customCompositionVersion?`），**SDK 也已生成**（`packages/sdk/js/src/v2/gen/sdk.gen.ts:868`、`:1429` `get capabilities()`；类型 `types.gen.ts:2498-2500`）。请求头协商同样已端到端接通（常量 owner `packages/schema/src/product-mode.ts:18-19`，App 在 `packages/app/src/utils/server.ts:37` 为**每个** SDK client 无条件注入，服务端 30+ 处读取）。
- **缺口**：该端点的 `customMode` 是**硬编码 `false`**（`handlers/experimental.ts:45`，不读 kill switch），`productModes` 也是硬编码数组（`:46`）；且 **App 侧消费点为零**（唯一消费者是 TUI `packages/tui/src/context/sync.tsx:444`）。
- **架构计划负责**：把 `customMode` 改为读 `ProductModePolicy.isCustomModeEnabled()`、`productModes` 改由 `ProductMode.ID` 派生，并在 custom 停用分支写入结构化 `InvalidRequestError.kind = "custom_mode_disabled"`（该可选字段**已在别处启用**：`handlers/session.ts:502/512`、`middleware/workspace-routing.ts:199`、`middleware/schema-error.ts:31`）。
- **UX 计划负责**：`CapabilityPort` 端口 + 三态渲染 + 双信号合成（见 §4.1），默认适配器读上述已生成的 SDK 方法。**不改服务端。**
- **合并后集成门**（在 `main` 上跑）：把 Custom 的 `disabled` 判据从「双信号合成」收敛为「只读 `kind`」，字符串匹配降级为兼容旧服务端的兜底。十行量级的收尾提交。

**接缝 S2 · 恢复状态**

- **架构计划负责**：`server-dead` 与 `recovery_required` 的**产生**（schema 取值、持久化、事件/SSE 投递、desktop 主进程可观测性）。
- **UX 计划负责**：状态词汇表里的 `recovery` 语义位与渲染骨架；**在后端尚未投递真实状态前不伪造按钮**（路线图 Phase 2 明文停止条件）。
- **禁止**：任一方为了自测方便在对方包里塞 mock 数据源。

### 2.5 冲突自检（每次 push 前，两个工作区都要跑）

```bash
git diff --name-only origin/main...HEAD | grep -E '^packages/' | cut -d/ -f2 | sort -u
comm -12 \
  <(git diff --name-only origin/main...v2-lifecycle-owner | sort) \
  <(git diff --name-only origin/main...v2-ux-foundation  | sort)
git merge-tree $(git merge-base v2-lifecycle-owner v2-ux-foundation) \
  v2-lifecycle-owner v2-ux-foundation | grep -c '^<<<<<<<' || echo "0 conflicts"
```

第 2 步输出非空且不在 §2.3 允许清单内 ⇒ **停止 push**。

---

## 3. 五层代码追踪（执行前必读，行号为本计划撰写时实测）

### 3.1 能力链路：模式被**四处独立枚举**，无一处做能力判断

```
packages/app/src/context/mode.tsx:6-47      MODE_DEFINITIONS（5 项 × 6 字段）  ← 唯一像真源的东西
        │
        ├─→ mode-switcher.tsx:39            <For each={MODE_DEFINITIONS}>  无 filter / 无 Show / 无 disabled
        ├─→ app.tsx:563 (ModeRoute)         isMode(params.mode) ? ... : undefined → :573 fallback <Navigate href="/">
        ├─→ mode-workspace.tsx:16           ALL_SLOTS = ["chat",...,"custom"]  ← 手写重复数组，与上无编译期关联
        └─╳  home-overview.tsx:345-351      手写 ["all","coding","chat","work","assistant"]  ← custom 被排除
```

关键实测：

- `ModeContext` 类型（`mode.tsx:76-81`）只有 `currentMode` / `setCurrentMode` / `secondarySidebarOpen` / `toggleSecondarySidebar` —— **没有可用模式列表，也没有能力查询**。`MODE_DEFINITIONS` 的 6 个字段（`id`/`href`/`icon`/`labelKey`/`descriptionKey`/`surface`）全是 id 的机械派生，由 `mode.test.ts:24-28` 钉死；其中 `descriptionKey` 是**死字段**（除自身测试外全仓无消费者）。
- `ModeSwitcher` 唯一的条件渲染是 assistant 的 pending 徽标（`:55`）。每项是 `TooltipV2` → `IconButtonV2`（`:44-54`，Kobalte `Button` ⇒ 原生 `<button>`，Tab + Enter/Space 可用），但**没有** `role="tablist"/"tab"`、`aria-current`、roving tabindex、方向键，也没有 `data-*` 测试钩子。
- 非法 mode 的处理是**重定向首页**（`app.tsx:573`），不是静默回退 coding。静默回退 coding 在**另外三处**：`mode.tsx:90-93`（持久化 migrate 把未知值收敛为 coding）、`layout/helpers.ts:48-50`、`home-overview-model.ts:7`（把 `mode === undefined` 当 coding）。
- 首页**没有模式卡片**（全仓无 `modeCard` / `MODE_CARDS`），是一行筛选 chip；`countByMode`（`home-overview-model.ts:4-10`）**确实统计 custom**，但筛选行不展示它 ⇒ custom 会话计入 `all` 总数却无独立入口。
- `ModeSwitcher` 的显隐依赖 `pages/layout.tsx:36` 的 `<Show when={location.pathname !== "/"}>`，而该文件（`layout.tsx:2`）只 import 了 `useNavigate, useParams` —— 这里的 `location` 是**全局 `window.location`**，因此该判断**非响应式**。
- **App 不能从 `@aigcfroge/core` 引入 `product-mode-policy`**：它传递依赖 `core/flag/flag.ts`，后者在模块求值期读 `process.env`，会让 Web 构建白屏。这正是能力常量放在 `packages/schema/src/product-mode.ts` 的原因（该文件 `:12-17` 的注释写明了这条）。`packages/app/src` 已有 18 个文件 import `@aigcfroge/schema/*`，但 **`packages/app/package.json` 未声明 `@aigcfroge/schema`**（仅靠 workspace 解析）—— 本计划 B0 顺手补声明。

### 3.2 几何：`960px` 是一个永不可达的死数字（算术已核实）

`packages/app/src/pages/mode-workspace.tsx` 真实字符串：

| 行 | 元素 | class |
| --- | --- | --- |
| `:166` | 网格基础 | `mx-auto grid h-full w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-4 px-3 pb-3 lg:grid-rows-1 lg:px-6 lg:pb-16 lg:gap-8` |
| `:168` | chat 追加 | ` max-w-[1080px] lg:grid-cols-[280px_minmax(0,960px)]` |
| `:170` | work 追加 | ` max-w-[1080px] lg:grid-cols-[280px_minmax(0,960px)]` ← 与 chat **逐字符相同**（三元冗余） |
| `:171` | 其余追加 | ` max-w-[1080px] lg:grid-cols-[280px_minmax(0,720px)]` |
| `:175` | Sidebar 槽容器 | **无 class**（宽度完全由 280px 轨道决定） |
| `:188` | Main 槽 | `min-h-0 min-w-0 flex-1 flex flex-col` + `aria-label="Main content"` |

换算依据：`--spacing: 0.25rem`（`packages/ui/src/styles/tailwind/index.css:12`）、`--breakpoint-lg: 64rem` = 1024px（`:17`）、根字号未被覆盖 ⇒ 1rem = 16px、`box-sizing: border-box` 全局生效（`packages/ui/src/styles/base.css:8-16`）⇒ `max-w` **包含** padding。

| 量 | 值 |
| --- | --- |
| `max-w-[1080px]` 边框盒 | 1080 |
| `lg:px-6` 双侧 | 6 × 4px × 2 = **48** |
| 可用内容宽 | 1080 − 48 = **1032** |
| `lg:gap-8` | **32** |
| chat/work 声明需求 | 280 + 32 + 960 = **1272**（超 240） |
| chat/work **实解** | 1032 − 280 − 32 = **720** |
| coding/assistant/custom 需求 | 280 + 32 + 720 = **1032** = 可用宽，精确闭合 |

⇒ **三个分支在任何达到 max-width 的视口下几何完全一致**；`960px` 从未生效。视口阈值：ModeSwitcher `w-16`（`mode-switcher.tsx:37`）64px + 外壳 `m-2` 双侧 16px ⇒ 网格触顶需视口 ≥ **1160px**（e2e 的 1440 满足）。`< lg` 时无 `grid-cols`，退化为单列，且外壳的 `overflow-hidden` 也随 `lg:` 前缀消失。

**附带冲突**：`mode-workspace-slots.tsx:725`/`:746` 用 `md:grid-cols-2 xl:grid-cols-3`，`:806`（Custom Builder）用 `grid-cols-1 xl:grid-cols-2` —— `xl` = 1280px 是**视口**断点，而它们所在的 Main 列**恒为 720px**。mode-workspace 链路上零 `@container`。

### 3.3 `SessionRightPanel` 不在 `/mode/:mode` 链路上（范围裁剪依据）

`packages/app/src/components/session-right-panel.tsx`（85 行）：宽度是 JS 驱动的 inline px（`:36-40`：未开 `0px` / review 开 `auto` / 否则 `${layout.fileTree.width()}px`），折叠 = 宽度 0 + `inert` + `aria-hidden`（`:49-63`），`ResizeHandle` clamp 200–480（`session-file-tree.tsx:42-52`），`DEFAULT_FILE_TREE_WIDTH = 200`（`context/layout.tsx:27`）。**无任何 `sm:/md:/lg:` 前缀、无 Drawer/Sheet、无 Tabs** ⇒ 窄屏仍占 200–480px。四个消费者都是 session 页面板（`session-side-panel.tsx:172`、`chat-right-panel.tsx:219`、`work-artifact-panel.tsx:240`、`assistant-session-panel.tsx:151`）。而 mode-workspace 只有 2 列（280 + main），**不含右栏**。三套几何互不共享常量（mode-workspace 1080/280、home-overview `max-w-[1200px] grid-cols-[220px_minmax(0,1fr)]`（`home-overview.tsx:42`）、右栏 200–480）。⇒ **右栏窄屏化不在本切片**，路线图 §5.1 那一行留给 Phase 4。

### 3.4 状态：不是「命名不统一」，而是四族并存 + 属性名被占用 + 一条吞噬路径

**同义不同名**（以「空」为例，i18n key 层面四族并存）：`*.empty`/`*Empty`（app 46 key）· `*.noXxx`（约 20 key）· `*.none`（5 key）· `*.unavailable`（2 key）。同一路径上甚至并存两族：`custom.sidebar.emptyStarter` 与 `custom.sidebar.noAgents` 描述同一个空集。loading 族同样分裂（`common.loading` / `*.loading` / `*.loadError` / `*.checking` / `*.applying` / `*.downloading` / `*.retrying` / `workspace.error.stillPreparing`）。

**`data-state` 已被交互态占用**：v2 组件用它表 `hover`(12) / `pressed`(11) / `disabled`(8) / `focus`(2)（定义在 `packages/ui/src/v2/components/{button-v2,icon-button-v2,inline-input-v2,text-input-v2,field-v2,line-comment-v2}.css`）；而 app / session-ui 把**领域态**（`pending` / `in_progress` / `completed` / `cancelled` / `scheduled` / `failed` / `timeout` / `hiding`）挤进同一属性（`packages/app/src/index.css:122-239,464`、`packages/session-ui/src/components/message-part.css:1391,1395`）。⇒ §4.3 必须做命名裁决。

**内联实现规模**：渲染内联空态的**生产**文件 50 个、loading 30 个、error 41 个。共享件只有 `Card`（`packages/ui/src/components/card.tsx`，variant error/warning/success/info/normal，但 accent 硬编码 **v1** token `var(--icon-critical-base)` 等，`:43-46`，仅 4 个消费者）、`List`（`:38-39,243-253,322-323`，内建 `emptyMessage`/`loadingMessage` + `data-slot="list-empty-state"`）、`ToolErrorCardV2`（`packages/session-ui/src/v2/components/tool-error-card-v2.tsx`，已纯 v2，error+loading 双态 + `aria-busy` + Collapsible）、`HomeSessionSkeleton`（`packages/app/src/pages/home-shared.tsx:448`）。**`packages/ui/src/v2/components/` 下没有 callout / banner / empty / skeleton / alert 任何一个。**

**唯一现成的「状态 → 色彩档位」归一化**：`packages/app/src/pages/session/workflow-runtime-model.ts:72,174-184` 的 `WorkflowStatusTone = "neutral" | "info" | "warning" | "success" | "danger"` + `workflowStatusTone(status)` + `workflowStatusKey(status)`；消费者 `workflow-runtime-panel.tsx:214-224` 把 tone 映到 `--v2-state-*`，与 v2 token 的 4 档语义 1:1。**只被这一个面板使用，未提升为共享。**

**Custom 侧的吞噬路径**（`packages/app/src/components/custom/custom-sidebar.tsx`，三层吞噬 + 完全没有 error/loading 分支）：

```
:30  createResource(props.dirSdk, async (sdk) => {
:31    if (!sdk) return { agents: [], workflows: [], prompts: [], skills: [], commands: [] }   ← L0
:33    const [...] = await Promise.all([
:34-38   sdk.client.<kind>Asset.list().catch(() => ({ data: { assets: [] } })),   ← L1 × 5
:42-46   ... ?? []                                                                ← L2 × 5
:48-50 } catch { return { 五个空数组 } }                                           ← L3
```

下游误报点：计数 `(0)` 在 `:182/:189/:196/:203/:210`；「没有」文案在 `:226`（`custom.sidebar.noAgents`）/`:284`/`:329`/`:394`/`:440`；零态引导卡 `:478-485`。组件**从未读取** `discovered.error` 或 `discovered.loading` ⇒ **加载中同样渲染成「没有」**。

**同文件另外两个真实缺陷**（本计划顺手修，属同一根因「失败不可见」）：`:149` 的 `common.refresh` 与 `:175` 的 `common.all` **两个 i18n key 在 en/zh/zht 三份字典里都不存在**（各 0 命中），`@solid-primitives/i18n` 的 translator 对缺失 key 返回 `undefined` ⇒ `:175` 按钮**文字为空**、`:149` 的 `aria-label` **不存在**；`:295`/`:406` 使用未定义 token `outline-v2-border-border-active`（见 §3.5）。

**Custom 的 disabled/unsupported 判定**（`custom-preview-column.tsx`）：`:49` `DISABLED_MESSAGE_MARKER = "Custom mode is disabled"`，`:51-57` `classifyPlanFailure` 用 `msg.includes(...)` 认停用态，且 **404 分支排在 disabled 之前**（`:54`），`unsupported` 的兜底文案是**硬编码英文**（未走 i18n）。`canStart`（`:107-114`）有 5 个否决位，`disabled || unsupported` 是其中一个。已有 6 个用例 + 一条漂移哨兵（`custom-preview-column.test.ts:8`），债登记在 `docs/technical-debt.md:130`。

### 3.5 Token：四组语义 Token **已存在**，真实缺口是「静态基线 + Tailwind 暴露 + 零消费」

`packages/ui/src/v2/styles/` 三文件齐全（`colors.css` 原语 12 档色阶 × 11 色系；`theme.css` 441 行，语义组 Background(10)/Text(7)/Icon(6)/Border(5)/Overlay(10)/State(12)/Project avatar(19)/Elevation(9)/Illustration(3)，三段作用域 `:root` / `[data-theme="light"]` / `[data-theme="dark"]`；`tailwind.css` 只有两行 `@import`）。静态层共 **228** 个 `--v2-*` 声明。

而 `syntax` / `markdown` / `diff` / `input` 在**运行时主题生成层**：`packages/ui/src/theme/v2/syntax-markdown.ts` 产出 19 个 `v2-syntax-*` + 14 个 `v2-markdown-*`；`diff.ts` 产出 11 个 `v2-diff-*`；`mapping.ts:68-74,143-149` 产出 6 个 `v2-input-*`（× light/dark）+ 4 个 `v2-button-*`。装配 `theme/v2/resolve.ts:137-145`，序列化 `themeV2ToCss()` `:154-158`，注入 `theme/context.tsx:138,169` 与 `theme/loader.ts:40-41`。

**三个真实缺口**：

1. **静态基线缺口**：不在 `v2/styles/*.css`，只有 `ThemeProvider` 挂载后才存在。
2. **Tailwind 暴露缺口**：`packages/ui/src/styles/tailwind/colors.css` 只把 **50** 个 v2 token 映射成 `--color-v2-*` 工具类（state 12 / overlay 10 / background 10 / text 7 / icon 6 / border 5）；syntax / markdown / diff / input / elevation / avatar / illustration **全部没有工具类**。对照 v1 侧 `--color-syntax-*` 19 个、`--color-markdown-*` 14 个、`--color-input-*` 6 个工具类**都有** —— 这才是「视觉断层」在代码渲染层的具体形态。
3. **零消费**：`rg -c "v2-(syntax|markdown|diff|input)-"` 在生成器之外命中 **0**。

**另有 5 个「被使用但未定义」的 v2 工具类根，共 9 处样式静默失效**（Tailwind v4 不会为不存在的 theme 变量产出类）：

| 未定义 token 根 | 使用位置 |
| --- | --- |
| `v2-border-border-active` | `status-bar.tsx:45,85` · `custom/custom-sidebar.tsx:295,406` · `custom/custom-builder-main.tsx:282` |
| `v2-border-border-faint` | `session/workflow-runtime-panel.tsx:131,189,219` · `custom/custom-snapshot-panel.tsx:221` |
| `v2-border-weak` | `approval-center.tsx:319,360` |
| `v2-background-bg-hover` | `status-bar/status-bar.tsx:126` |
| `v2-icon-icon-interactive-base` | `secondary-sidebar.tsx:840` |

注意 `workflow-runtime-panel.tsx:219` 正是 tone = `neutral` 那一支 ⇒ **中性档目前无色**。

**v2 组件自身仍引用 v1 token**（迁移试点的最高杠杆）：`menu-v2.css` 12 · `accordion-v2.css` 11 · `avatar-v2.css` 5 · `switch-v2.css` 3 · `radio-v2.css` 3 · `session-ui/v2/components/tool-error-card-v2.css` 8 · `basic-tool-v2.css` 6。

### 3.6 验证能力边界（决定测试放哪一层）

- **App 没有 solid-testing-library，单测从不渲染组件**：`bunfig.toml` root `./src` + preload `happydom.ts`；`grep -rn "^import.*\brender\b" src --include=*.test.*` **零命中**。所谓「组件测试」是 `fs.readFileSync` + `toContain` 的**源码字符串契约**（约定被写进 `work-secondary-sidebar.test.tsx:5-7` 的注释）。
- **happy-dom 不做布局** ⇒ `getBoundingClientRect()` 恒返回 0 ⇒ **几何无法在单测层验证，只能 e2e**。
- **e2e 里已经有一份几何采集器**：`packages/app/e2e/performance/mode-layout-baseline.spec.ts`（73 行）已按 `modes × viewports`（`["chat","coding","work","assistant"]` × `desktop 1440×900` / `narrow 640×900`）跑 `page.evaluate(readGeometry)`，`readGeometry`（`:39-72`）取 computed `gridTemplateColumns` + 4 个节点的 `x/y/width/height/overflowX/overflowY/scrollWidth/scrollHeight/clientWidth/clientHeight`，节点靠结构定位（`workspace.firstElementChild`、`grid.firstElementChild`、`section[aria-label="Main content"]`）。**但它只 `report(...)` 到 benchmark 日志，唯一 `expect` 是 `:36` 的 `toHaveLength(8)` —— 不断言任何几何值、不断言 overflow；`modes` 里也没有 custom。**
- **而且它默认不跑**：`packages/app/playwright.config.ts:12` 的 `testIgnore` 在 `AIGCFROGE_PERFORMANCE !== "1"` 时排除整个 `performance/**`。
- regression 层现状：20 个 spec，8 处单次 `setViewportSize`（多为设桌面尺寸），**断言 overflow 的 0 处**，断言 computed style 的 1 处（`session-todo-progress.spec.ts:434`）。`playwright.config.ts:43-48` 只有单个 `chromium` project。
- `e2e/utils/` 三个文件（`waits.ts` / `errors.ts` / `mock-server.ts`）**没有** computed-style 或视口切换 util。`/mode/custom` 的装配范例在 `e2e/regression/builder-mcp-health.spec.ts:99-140`（含「必须先访问 session 让 `directory()` 落地」的前置，注释 `:130-136`）；`mock-server.ts` 未覆盖 `/experimental/capabilities`，会落到兜底 `:146` `json(route, {})`。

---

## 4. 设计决策与方案对冲

### 4.1 D1（**需产品确认**）：能力三态与「双信号合成」

`ModeDefinition` 扩展为携带 `capability` 语义，`useMode()` 暴露 `availability(mode): "enabled" | "disabled" | "unknown"`。三态判据：

| 态 | 判据 | UI 行为 |
| --- | --- | --- |
| `enabled` | 能力端点报该模式可用 | 正常入口 |
| `disabled` | 能力存在但被策略/配置关闭 | 入口可见但 `aria-disabled` + 说明原因与开启方式，**不静默隐藏** |
| `unknown` | 端点不可达 / 404 / 旧服务端 | **入口按可用处理**（fail-open），失败在动作时以结构化错误呈现 |

**双信号合成规则（针对 custom，过渡期专用）**：`disabled` 仅当「能力端点的 `customMode === false`」**且**「`classifyPlanFailure` 也判定 disabled」时成立；两者不一致 ⇒ 落 `unknown`。

理由：端点当前硬编码 `false`（`handlers/experimental.ts:45`），若单信号信任它，用户开了 `AIGCFROGE_CUSTOM_MODE` 也会被错误地锁在入口外 —— **误判 disabled 会直接把用户挡死，误判 enabled 只是多一次带结构化原因的失败**，所以在不一致时必须 fail-open。架构分支的 A0-5 落地后，该规则收敛为「只读端点 + `kind`」（§2.4 接缝 S1 的合并后集成门）。

### 4.2 D2：几何——先证据，后减法；**移动**已有采集器而不是新建

三步，顺序不可换：

1. **提取**：把 `mode-layout-baseline.spec.ts:39-72` 的 `readGeometry` 抽到 `packages/app/e2e/utils/geometry.ts`（`e2e/utils/` 目前没有任何 computed-style util，这是它的第一个成员）。
2. **搬家 + 加断言**：在 `packages/app/e2e/regression/mode-workspace-geometry.spec.ts` 建**带断言**的基线（`modes` 补上 `custom`；断言 `scrollWidth <= clientWidth`、断言 `gridTemplateColumns` 的实际解算值）。**必须放 `regression/`**：`playwright.config.ts:12` 的 `testIgnore` 让 `performance/**` 在默认 `test:e2e` 下整体不跑，留在原处等于没有门禁。原 performance 采集器保留（它面向趋势记录，不是门禁）。
3. **减法**：几何测试转绿后，删掉 `mode-workspace.tsx:168`/`:170` 的 `960px` 分支 —— 实解与 `:171` 的 720 完全一致（§3.2 算术），且 chat 与 work 两支字符串逐字相同，属**行为等价的三元冗余**。这是纯删除，不是视觉改动。

> **明确不做**：不因为「感觉窄」而调 `max-w-[1080px]`。若产品要真正的 960px 主列，那是宽度/密度的产品变更，需另开 PRD（`docs/technical-debt.md` §2 已把「实际 960px 主列」登记为待产品提出的延后项）。

### 4.3 D3（**需设计确认**）：领域态改用 `data-status`，把 `data-state` 留给交互态

现状是同一属性承载两套语义（§3.4）。裁决：**交互态继续用 `data-state`（`hover`/`pressed`/`focus`/`disabled`，保持 v2 组件既有 `:is(伪类, [data-state="..."])` 双写约定不变）；领域态一律改用 `data-status`。** 本切片只为**新增**的共享状态组件确立该约定，不批量迁移既有的 `session-todo-progress-node` / `task-tool-status`（登记为债）。

### 4.4 D4：状态词汇落在 `packages/ui/src/v2/`，且靠**提升**而非新建

- 新建 `packages/ui/src/v2/state.ts`：11 值词表（`empty` `loading` `refreshing` `invalid` `unsupported` `disabled` `error` `stale` `applied` `conflict` `recovery`）+ `stateTone(state): "neutral" | "info" | "warning" | "success" | "danger"` + `stateKey(state)`。
- **tone 函数是提升，不是发明**：`packages/app/src/pages/session/workflow-runtime-model.ts:174-184` 已有一份 1:1 映到 `--v2-state-*` 的 tone 实现，只被一个面板使用。把它上提到 `ui/v2/state.ts`，app 侧改为消费（保留 workflow 专有的状态名映射，只共享 tone 词表）。
- 新建 `packages/ui/src/v2/components/callout-v2.tsx` + `.css`：承载 `empty` / `invalid` / `unsupported` / `disabled` / `error` / `stale` / `recovery` 的行内呈现，API 形状抄 `Card`（variant → 自动图标，`packages/ui/src/components/card.tsx:23-29,41-48`）但 accent **一律 `--v2-state-*`**（`Card` 现在硬编码 v1 token，正是要避免的）。
- 复用而非重写：`refreshing` 用既有 `TextShimmerV2`；`loading` 骨架把 `HomeSessionSkeleton`（`packages/app/src/pages/home-shared.tsx:448`，已是 v2 token）上提为 `SkeletonV2`；`error` 的可展开诊断照 `ToolErrorCardV2` 的形状。
- **必须先补齐 3 个净新增语义的定义**（`refreshing` 全仓 0、`stale` 目前只是缓存变量名、`recovery` 只有一个 workflow 枚举值）：它们的文案必须表达「状态 + 原因 + 影响 + 下一步」，`recovery` 的按钮在架构分支投递真实状态前**不渲染**（§2.4 接缝 S2）。

### 4.5 D5：i18n 落点与顺带修复

- 状态文案进 `packages/ui/src/i18n/{en,zh,zht}.ts`（**3 个必改**；其余 15 个 locale 冻结，英文兜底已内建于 `packages/app/src/context/language.tsx:100,104`）。`parity.test.ts` 对 zh/zht 做 **双向** key 集合 + 占位符校验，缺 key 或多 key 都会红。
- 顺带修 `common.all` / `common.refresh` 两个**代码在用但字典里没有**的 key（§3.4）。注意 **parity 测不出这类反向缺口**（它只比对 en↔zh/zht 三方，不检查 key 是否被使用）⇒ 本计划在 `packages/app/src/i18n/` 加一个**反向存在性**测试：扫 `packages/app/src` 里 `t("...")` 的字面量 key，断言都存在于 `en` 字典。
- Storybook **不挂 `I18nProvider`**（`packages/storybook/.storybook/preview.tsx` 只有 Meta/Font/Theme/Dialog/Marked），story 走 `en[key] ?? key` 兜底（`packages/ui/src/context/i18n.tsx:22-28`）。新组件的 story 必须在这个前提下仍然可读。

### 4.6 D6：Token 迁移试点的选路（按杠杆排序，不按文件数排序）

| 顺序 | 路径 | 为什么先做 |
| --- | --- | --- |
| 1 | **修 5 个未定义 v2 工具类根**（9 处失效样式，7 个文件，§3.5） | 这些是**已经坏了**的样式，不是迁移；包含 tone=neutral 无色这一条 |
| 2 | **补 Tailwind 暴露**：把 `syntax`/`markdown`/`diff`/`input` 四组已存在的 v2 token 映射进 `packages/ui/src/styles/tailwind/colors.css` | token 已存在（§3.5），只差暴露；v1 侧对应工具类都有，这是断层的直接成因 |
| 3 | **修 v2 组件自身的 v1 引用**（7 个文件共 38 处：`menu-v2.css` 12 / `accordion-v2.css` 11 / `avatar-v2.css` 5 / `switch-v2.css` 3 / `radio-v2.css` 3 / `tool-error-card-v2.css` 8 / `basic-tool-v2.css` 6） | v2 组件引用 v1 token 是系统内部矛盾，改它不影响任何业务页面 |
| 4 | **shared 高频路径**：ModeSwitcher + Home 筛选行 | 与 B0/B1 同文件，触面已经打开，边际成本最低 |
| 5 | **session-ui 路径**：`tool-error-card-v2` 链路 | 已是纯 v2 组件，改的是它的 css 依赖 |

**明确不做**：`session-ui/src/components/message-part.css`（158 处 v1 引用，单文件最大热点）与 `ui/src/context/marked.tsx`（64 处）—— 它们要整条 markdown/syntax 渲染链一起迁，属独立切片。

### 4.7 方案对冲

| | 简单实现（本计划采用） | 健壮架构（不在本计划） |
| --- | --- | --- |
| 能力 | 消费已有端点 + 双信号合成 + fail-open | 服务端 typed capability 契约 + 客户端声明式能力协商 |
| 几何 | e2e computed geometry 断言 + 删死分支 | 容器查询（`@container`）重构，让主列宽度自适应而非视口断点 |
| 状态 | 词表 + tone + CalloutV2 + 新组件用 `data-status` | 全量迁移既有领域态属性；状态机化 |
| Token | 5 项按杠杆排序的定点迁移 | 三层 Token 体系全量落地 + codemod |
| **申报的债** | 既有 `data-state` 领域态未迁；`message-part.css` 未迁；e2e 明暗/三语/键盘矩阵未补；37 主题只抽样 | —— |

---

## 5. 分阶段实施（红 → 绿 → 重构；批次之间可独立提交）

> **测试落点铁律**（由 §3.6 的能力边界决定）：**行为**断言只能放在纯函数单测或 e2e；**几何**只能放 e2e；源码字符串断言只允许用于「组件已挂载在某处」这类**结构契约**，绝不能用来代替行为（`docs/testing.md` §10 红线 3，违者打回）。

### 批次 B0 · Capability-aware mode registry（估算 2–3 天）

| 步 | 类型 | 动作 |
| --- | --- | --- |
| B0-1 | 红 | 扩展 `packages/app/src/context/mode.test.ts`（现成的 registry 契约测试，3 例）：断言每个 `ModeDefinition` 都能解析出 `availability`，且 `resolveAvailability(caps, mode)` 是**纯函数**、对端点缺失返回 `unknown`、对 `customMode:false` + plan 判定 disabled 才返回 `disabled`（§4.1 双信号）。预期红：符号不存在 |
| B0-2 | 绿 | `packages/app/package.json` 补 `"@aigcfroge/schema": "workspace:*"`（**已有 18 个文件在用但未声明**）。**不要**引入 `@aigcfroge/core` 的 `product-mode-policy`（会经 `core/flag/flag.ts` 在模块求值期读 `process.env`，Web 构建白屏；能力常量的正确来源是 `@aigcfroge/schema/product-mode`） |
| B0-3 | 绿 | 新建 `packages/app/src/context/capability.ts`：`CapabilityPort` 接口 + `resolveAvailability` 纯函数 + 默认适配器（调**已生成**的 SDK 方法 `client.experimental.capabilities()`，见 `packages/sdk/js/src/v2/gen/sdk.gen.ts:1429`）。端口可注入 ⇒ 单测用假端口，不 mock `globalThis` |
| B0-4 | 绿 | `mode.tsx`：`ModeDefinition` 加 `capability` 字段；`ModeContext`（`:76-81`）加 `availability(mode)`。保持 `mode.test.ts:24-28` 钉的「6 字段全为 id 机械派生」约定 —— 新字段也必须是可推导或显式常量，不引入隐式魔法 |
| B0-5 | 绿 | 三个消费点改为读同一真源：`mode-switcher.tsx:39`（加 `aria-disabled` + Tooltip 说明原因，**不隐藏入口**）· `app.tsx:563` 的 `ModeRoute`（`disabled` 时渲染说明页而非 `<Navigate href="/">`）· `home-overview.tsx:345-351`（手写数组改为从 registry 派生，**并把 custom 纳入筛选行** —— `countByMode` 本来就统计它，只是没有入口） |
| B0-6 | 重构 | `mode-workspace.tsx:16` 的 `ALL_SLOTS` 手写数组改为从 `MODE_DEFINITIONS` 派生（消掉「删改模式不会有编译错误」这个隐患）。顺手删死字段 `descriptionKey`**或**给它接上消费点（二选一，别留着） |
| B0-7 | 绿 | e2e：`packages/app/e2e/regression/mode-capability.spec.ts`。`mock-server.ts` 需新增 `/experimental/capabilities` 路由（当前未覆盖，会落到兜底 `:146` 返回 `{}`）。三态各一条；`/mode/custom` 的装配抄 `builder-mcp-health.spec.ts:99-140` |
| B0-8 | 门禁 | `bun --cwd packages/app test:unit` · `bun --cwd packages/app typecheck` · `bun --cwd packages/app test:e2e e2e/regression/mode-capability.spec.ts` · `LINT_BASE_REF=origin/main bun run script/lint-changed.ts` |

### 批次 B1 · Geometry baseline（估算 1.5–2 天，依赖 B0 的入口契约）

| 步 | 类型 | 动作 |
| --- | --- | --- |
| B1-1 | 绿 | 抽取 `readGeometry` 到 `packages/app/e2e/utils/geometry.ts`（源：`e2e/performance/mode-layout-baseline.spec.ts:39-72`，逐字搬，不改语义） |
| B1-2 | 红 | 新建 `packages/app/e2e/regression/mode-workspace-geometry.spec.ts`：`modes = 五模式`（**补 custom**）× `viewports = desktop 1440×900 / narrow 640×900`。断言 ① 每个节点 `scrollWidth <= clientWidth`（无横向溢出）② 桌面下三个分支解算出的主列宽**相等**（这条会把 §3.2 的算术钉死）③ 窄屏下导航与主区骨架仍在。预期红：断言②当前会通过而断言①在 narrow 下可能红，先跑一次拿真实结果 |
| B1-3 | 红 | 补状态维度：loading / error / 长中文标题 / 长英文标题 / 计数变化 / 模式切换后。用 `mock-server.ts` 造这些状态 |
| B1-4 | 绿 | 按 B1-2/B1-3 的红证据修**溢出**问题（只修溢出，不动 `max-w`） |
| B1-5 | 重构 | 几何测试全绿后，删 `mode-workspace.tsx:168`/`:170` 的 `960px` 分支（§4.2 第 3 步）。断言②在删除前后必须都绿——这就是「行为等价」的证明 |
| B1-6 | 门禁 | app typecheck + `test:e2e e2e/regression/mode-workspace-geometry.spec.ts`；把 computed geometry 的实际数值贴进 PR |

### 批次 B2 · 状态词汇与错误真实性（估算 3–4 天）

| 步 | 类型 | 动作 |
| --- | --- | --- |
| B2-1 | 红 | `packages/ui/src/v2/state.test.ts`：11 值词表完整性 + `stateTone` 对每个值有 tone + `stateKey` 生成的 key **在 `ui/src/i18n/en.ts` 里真实存在**（这条会同时守住「加了状态忘了加文案」）。预期红 |
| B2-2 | 绿 | 新建 `packages/ui/src/v2/state.ts`（词表 + tone + key），tone 实现从 `packages/app/src/pages/session/workflow-runtime-model.ts:174-184` **上提**（§4.4） |
| B2-3 | 绿 | 文案进 `packages/ui/src/i18n/{en,zh,zht}.ts`（3 个必改），每条表达「状态 + 原因 + 影响 + 下一步」。跑 `bun --cwd packages/ui test src/i18n/parity.test.ts` 确认 zh/zht 双向对齐 |
| B2-4 | 绿 | 新建 `packages/ui/src/v2/components/callout-v2.tsx` + `callout-v2.css`：`data-component="callout-v2"` + `data-variant`（tone）+ `data-status`（§4.3 裁决）；CSS 只引 `--v2-state-*`（已有 12 个 Tailwind 工具类）；遵循 `:is(伪类, [data-state="..."])` 双写约定（见 `button-v2.css:31,75,81,87` 与 `icon-button-v2.tsx:12-31`） |
| B2-5 | 绿 | 上提 `SkeletonV2`（源 `packages/app/src/pages/home-shared.tsx:448`，已是 v2 token，3 个消费者跟着改） |
| B2-6 | 绿 | Storybook：`packages/ui/src/v2/components/callout-v2.stories.tsx` + `skeleton-v2.stories.tsx`。**照现有 27 个 v2 story 的统一约定**：`title: "UI V2/<PascalName>"` + `id: "components-<kebab>-v2"` + `tags: ["autodocs"]` + `docs` 模板六段（Overview / API / Variants and states / Behavior / Accessibility / Theming-tokens），范例见 `badge-v2.stories.tsx`（54 行）与 `button-v2.stories.tsx`。注意 Storybook **不挂 `I18nProvider`**，story 走 en 兜底 |
| B2-7 | 绿 | 对齐既有表面：Permission / Approval Center / Composer Dock / `session-ui` message parts 的状态表达改用共享词表。**范围限制**：只改「状态命名与着色」，不改交互逻辑 |
| B2-8 | 门禁 | `bun --cwd packages/ui test` · `bun --cwd packages/session-ui test` · 三包 typecheck · `bun --cwd packages/storybook build`（注意 `docs/technical-debt.md` §3.1 记录过 Storybook 构建 OOM，若复现则按该条处理，**不要**为它改动无关代码） |

### 批次 B3 · Custom 错误真实性（估算 1–1.5 天）

| 步 | 类型 | 动作 |
| --- | --- | --- |
| B3-1 | 红 | 抽纯函数 + 单测：`packages/app/src/components/custom/custom-discovery.ts` 的 `classifyDiscovery(results)` → 每个资产类别独立的 `{ status: "loading" \| "empty" \| "error", items, error? }`。预期红：符号不存在 |
| B3-2 | 红 | e2e `packages/app/e2e/regression/custom-sidebar-errors.spec.ts`：让 5 个资产端点之一返回 500，断言该类别显示错误 + 重试按钮，且**其余四类不受影响**；再断言加载中不显示「没有」。预期红（当前三层吞噬，见 §3.4） |
| B3-3 | 绿 | 重写 `custom-sidebar.tsx:30-50`：删掉 5 个 per-call `.catch`（`:34-38`）与外层 `catch {}`（`:48-50`），改为 `Promise.allSettled` + 逐类别状态；渲染消费 `discovered.loading` / `discovered.error`（当前**从未读取**）。空态与错误态分别用 B2 的 `CalloutV2` |
| B3-4 | 绿 | 修同文件两个真实缺陷：补 `common.all` / `common.refresh` 两个缺失 i18n key（`:175` 按钮当前**无文字**、`:149` `aria-label` **不存在**）；`:295`/`:406` 的未定义 token `outline-v2-border-border-active` 一并在 B4-1 修 |
| B3-5 | 绿 | 新增反向存在性测试 `packages/app/src/i18n/usage.test.ts`：扫 `packages/app/src` 中 `t("literal")` 的字面量 key，断言都在 `en` 字典里（parity 测不出这类反向缺口，§4.5） |
| B3-6 | 门禁 | app `test:unit` + typecheck + 两条 e2e；确认 `custom-preview-column.test.ts` 的 6 个既有用例与漂移哨兵仍绿 |

### 批次 B4 · Token 迁移试点（估算 2–3 天）

| 步 | 类型 | 动作 |
| --- | --- | --- |
| B4-1 | 绿 | 修 5 个未定义 v2 工具类根（§3.5 表，9 处失效样式）：要么在 `packages/ui/src/styles/tailwind/colors.css` 补映射，要么改用已定义的近义 token。**含 `workflow-runtime-panel.tsx:219` 的 tone=neutral 无色** |
| B4-2 | 红 | 新建 `packages/ui/src/styles/tailwind/v2-exposure.test.ts`：断言「被使用的 `(text\|bg\|border\|outline\|...)-v2-*` 工具类根」⊆「`colors.css` 已定义的 `--color-v2-*`」。预期红（当前 5 个根未定义），B4-1 后转绿，并**永久防止**再出现同类静默失效 |
| B4-3 | 绿 | 补 Tailwind 暴露：把 `syntax`(19) / `markdown`(14) / `diff`(11) / `input`(6) 四组**已存在**的 v2 token 映射进 `colors.css`（对照 v1 侧同名工具类已齐备）。注意它们由运行时主题层产出（`packages/ui/src/theme/v2/{syntax-markdown,diff,mapping}.ts`），暴露工具类不改变产出方式 |
| B4-4 | 重构 | 修 v2 组件自身的 v1 引用（7 文件 38 处，§4.6 第 3 项）。每个文件改完立刻在 Storybook 里对照 light/dark 截图 |
| B4-5 | 重构 | shared 路径：ModeSwitcher + Home 筛选行（与 B0 同文件）改为纯 v2 token |
| B4-6 | 绿 | 建**迁移账本** `docs/plan/v2-token-migration-ledger.md`：文件 · 旧引用数 · 目标 Token · 风险 · Owner · 验证命令 · 删除条件。用 §0.2 的可复现命令产出前后数字 |
| B4-7 | 门禁 | ui / session-ui / app 三包 test + typecheck；`bun --cwd packages/storybook build`；用 §0.2 命令复算三个包的 legacy 计数并记入账本 |

### 批次 B5 · Review gate（估算 0.5–1 天）

| 步 | 动作 |
| --- | --- |
| B5-1 | `git diff --stat origin/main...HEAD` + `git diff --check`；跑 §2.5 三条冲突自检 |
| B5-2 | legacy 趋势：用 §0.2 命令复算 ui/app/session-ui 三个数字与 76 个旧组件入口，记录 delta |
| B5-3 | 手工矩阵（本切片只覆盖**试点路径**，不承诺全仓）：light/dark 各一遍 · 键盘走查 ModeSwitcher 与 CalloutV2 的重试按钮 · 中英文长文案 · desktop/narrow |
| B5-4 | 产出 `docs/review/v2-ux-baseline-2026-XX.md`：§0.2 数字 + B1 的 computed geometry 实测值 + 状态矩阵截图 + 未闭环项 |
| B5-5 | 全量门禁：`bun --cwd packages/app test:unit` · `test:virtualizer` · `bun --cwd packages/ui test` · `bun --cwd packages/session-ui test` · 三包 typecheck · `bun --cwd packages/app test:e2e`（全量 regression）· `bun --cwd packages/storybook build` |

---

## 6. 测试策略

### 6.1 层级归属（由 §3.6 的能力边界决定，不可换层）

| 要验证的东西 | 层级 | 位置 | 理由 |
| --- | --- | --- | --- |
| `resolveAvailability` 三态判定 | 纯函数单测 | `packages/app/src/context/mode.test.ts` | 可注入端口，能真测行为 |
| `classifyDiscovery` 逐类别状态 | 纯函数单测 | `packages/app/src/components/custom/custom-discovery.test.ts` | 同上 |
| `stateTone` / `stateKey` / 文案存在性 | 纯函数单测 | `packages/ui/src/v2/state.test.ts` | 同上 |
| i18n 双向对齐 | 既有门禁 | `packages/{ui,app}/src/i18n/parity.test.ts` | zh/zht 双向 + 占位符 |
| i18n **反向**存在性（代码用了字典没有） | 新增单测 | `packages/app/src/i18n/usage.test.ts` | parity 测不出，§4.5 |
| v2 工具类根已定义 | 新增单测 | `packages/ui/src/styles/tailwind/v2-exposure.test.ts` | 防止再出现静默失效样式 |
| **几何 / overflow / 断点** | **只能 e2e** | `packages/app/e2e/regression/mode-workspace-geometry.spec.ts` | happy-dom 不做布局，`getBoundingClientRect()` 恒 0 |
| 能力三态的真实渲染 | e2e | `e2e/regression/mode-capability.spec.ts` | app 无 solid-testing-library |
| 资产失败不伪装成空 | e2e | `e2e/regression/custom-sidebar-errors.spec.ts` | 同上 |
| 组件已挂载在某路由 | 源码字符串契约（**仅此一种允许**） | 既有 `*.test.tsx` 风格 | 只能断结构，不能代替行为 |
| 视觉（light/dark、状态矩阵） | Storybook + 手工截图 | `packages/storybook` | 仓库无自动对比度审计 |

### 6.2 命令

```bash
bun --cwd packages/app test:unit                    # bun test --only-failures --preload ./happydom.ts ./src
bun --cwd packages/app test:virtualizer
bun --cwd packages/ui  test
bun --cwd packages/session-ui test
bun --cwd packages/app typecheck && bun --cwd packages/ui typecheck && bun --cwd packages/session-ui typecheck
bun --cwd packages/app test:e2e e2e/regression/<spec>.spec.ts
bun --cwd packages/app test:e2e                     # 全量 regression（默认排除 performance/**）
bun --cwd packages/storybook build
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
```

> **命令形态陷阱**：`bun --cwd <pkg> run <script>` 会打印 `bun run` usage、**什么都不执行且 exit 0**。正确形式是 `bun --cwd <pkg> <script>`（`docs/testing.md` §0 已记录）。

### 6.3 已知噪声（不要误判成本分支回归）

- `packages/app/e2e` **不在 typecheck 项目内**（`app/tsconfig.json` 的 `include` 只有 `["src"]`），且实测带 **29 个存量类型错误**。新写 e2e 时 `tsgo` 不会替你把关。
- Storybook `bun run build` 在 `main` 上即可能 OOM（`docs/technical-debt.md` §3.1）。
- Playwright 只有单个 `chromium` project；`performance/**` 默认被 `testIgnore` 排除。
- 全仓 Prettier 基线漂移（`origin/main` 上即如此）。**不要**在本分支批量格式化。

---

## 7. 文件清单

### 7.1 新增

`packages/ui/src/v2/state.ts` · `state.test.ts` · `v2/components/callout-v2.{tsx,css,stories.tsx}` · `v2/components/skeleton-v2.{tsx,css,stories.tsx}` · `styles/tailwind/v2-exposure.test.ts`
`packages/app/src/context/capability.ts` · `src/components/custom/custom-discovery.{ts,test.ts}` · `src/i18n/usage.test.ts`
`packages/app/e2e/utils/geometry.ts` · `e2e/regression/{mode-capability,mode-workspace-geometry,custom-sidebar-errors}.spec.ts`
`docs/plan/v2-token-migration-ledger.md` · `docs/review/v2-ux-baseline-2026-XX.md`

### 7.2 修改（全部在本计划所有权范围内）

`packages/app/src/`：`context/mode.tsx` · `context/mode.test.ts` · `components/mode-switcher.tsx` · `app.tsx`（仅 `ModeRoute`）· `pages/home-overview.tsx` · `pages/mode-workspace.tsx` · `pages/home-shared.tsx` · `components/custom/custom-sidebar.tsx` · `components/custom/custom-preview-column.tsx` · `pages/session/workflow-runtime-model.ts` + `workflow-runtime-panel.tsx` · `components/status-bar/status-bar.tsx` · `components/approval-center.tsx` · `components/secondary-sidebar.tsx` · `components/custom/{custom-builder-main,custom-snapshot-panel}.tsx` · `e2e/utils/mock-server.ts` · `package.json`（补 schema 依赖）
`packages/ui/src/`：`i18n/{en,zh,zht}.ts` · `styles/tailwind/colors.css` · `v2/components/{menu,accordion,avatar,switch,radio}-v2.css`
`packages/session-ui/src/`：`v2/components/{tool-error-card-v2,basic-tool-v2}.css` · message parts 的状态命名
文档：`DESIGN.md`（Product Mode Switching 段落对齐五模式现状 + 新增状态词汇与 `data-status` 约定）· `docs/technical-debt.md` §4 表**尾**追加

---

## 8. 风险与缓解

| 风险 | 表现 | 缓解 |
| --- | --- | --- |
| 端点硬编码 `false` 导致错误 disabled | 用户开了 flag 仍被挡在入口外 | §4.1 双信号合成 + 不一致时 fail-open；架构分支 A0-5 落地后收敛 |
| 删 `960px` 被当成视觉改动打回 | Review 质疑 | B1-5 要求删除前后几何断言都绿，PR 里贴 computed 数值 |
| 状态词汇成为第二套并行体系 | 既有 `data-state` 领域态与新 `data-status` 长期并存 | §4.3 明确只约束新增组件；旧的登记为债并写明触发条件 |
| Token 迁移扩面失控 | 主题回归 | 按 §4.6 顺序、每项独立提交；明确排除 `message-part.css` 与 `marked.tsx` |
| Storybook OOM 阻断视觉证据 | 拿不到截图门禁 | 已知既有问题；若复现按 `docs/technical-debt.md` §3.1 处理，不为它改无关代码 |
| e2e 无 typecheck 兜底 | 新 spec 写错类型不报错 | 新 spec 用 `e2e/utils/` 的类型化 helper；PR 里贴 e2e 真实运行输出 |
| 与并行架构分支冲突 | 合并冲突 | §2.5 三条自检 |

---

## 9. 验收标准（映射路线图 §8 指标）

| 指标 | 本计划的验收证据 | 是否本切片关闭 |
| --- | --- | --- |
| 模式入口可信度 | 三态 e2e 全绿；custom 进入首页筛选行；无静默回退 coding（`mode.tsx:90-93` 等三处的行为写成显式断言） | ✅ |
| 空间稳定性 | desktop/narrow 无横向溢出（e2e 断言）；computed geometry 有可追溯记录；`960px` 死分支已删且等价 | ✅ |
| 恢复成功率 | 资产失败逐类别可见 + 可重试；输入不丢 | ⚠️ 只关闭资产侧；`recovery` 依赖架构分支投递真实状态 |
| 审批负担 | 不在本切片 | ❌ |
| 资产可追溯 | `invalid` / `conflict` / `applied` 进入共享词表并在 Chat/Custom 表面一致 | ⚠️ 词表关闭，全模式对齐留给 Phase 4 |
| 可访问性 | icon-only 有 label；焦点可见；试点路径键盘走查记录 | ⚠️ 试点路径关闭，全仓矩阵是独立专项 |
| 迁移健康度 | 账本成形；§0.2 口径的三个数字有 delta 记录；`v2-exposure.test.ts` 永久防止未定义工具类 | ✅ |

---

## 10. 技术债声明

1. **既有领域态未迁到 `data-status`**：`session-todo-progress-node`（`packages/app/src/index.css:122-239,464`）与 `task-tool-status`（`packages/session-ui/src/components/message-part.css:1391,1395`）仍用 `data-state`。触发条件：下次改动这两个组件时。
2. **`message-part.css`（158 处 v1 引用）与 `ui/src/context/marked.tsx`（64 处）未迁**：需整条 markdown/syntax 渲染链一起做，属独立切片。
3. **e2e 明暗/三语/键盘矩阵未补**：实测 dark 0/18、i18n 0/18、keyboard 2/18，配置层也只有单个 chromium project。根治方式是在 `playwright.config.ts` 加 project（会一次照亮全部既有 spec，需配套修复预算），已在 `docs/technical-debt.md` §4 登记，本计划不承担。
4. **37 个主题只抽样检查**：未做逐主题对比度与零白闪全量验证。
5. **`Card`（v1）仍硬编码 v1 accent token**（`packages/ui/src/components/card.tsx:43-46`）：本计划新建 `CalloutV2` 而不改 `Card`（只有 4 个消费者，留给后续按需替换）。
6. **`unsupported` 兜底文案仍是硬编码英文**（`custom-preview-column.tsx:54`）：i18n 化需与 §2.4 接缝 S1 的 `kind` 改判同批做。
7. **desktop 的 i18n 目录（16 locale）无 parity 测试**，且用相对路径 import app 字典。不在本计划范围（`packages/desktop` 归架构分支）。
8. **`packages/app/e2e` 未纳入 typecheck 且带 29 个存量类型错误**。

---

## 11. 分支、PR 与合并流程

- **批次 0（预分支）**：见架构计划 §11.1 —— 两份路线图 + 两份计划 + 协议事实校准先在 `main` 上落一次文档-only 提交，两个工作区才能看到它们。
- 分支：`v2-ux-foundation`（≤3 词、连字符、无类型前缀）
- 提交：`type(scope): summary`，scope 用 `app` / `ui` / `session-ui`；建议一批次一提交（B0–B5 各一）
- `.husky/pre-push` 跑全仓 `bun typecheck`；最后一次 push 前必须让它真跑
- PR 用 `.github/pull_request_template.md`。模板明写「若粘贴大段明显 AI 生成的描述，PR 可能被忽略或关闭」⇒「How did you verify」必须是**真实命令 + 真实数字**；UI 改动**必须附截图/录屏**（模板有专门小节，且 `docs/testing.md` 的 App/UI 边界要求 narrow/desktop、light/dark、keyboard、i18n overflow、empty/loading/error 证据）
- 标题建议：`feat(app): make mode entries capability-aware and states truthful`
- PR 描述必含：§0.2 的口径更正表（说明为什么数字与路线图不同）、§4.1/§4.3 两条待确认裁决的落定结果、§10 全部技术债、几何 computed 实测值
- 合并顺序：与 `v2-lifecycle-owner` **任意顺序**；两者都合并后由双方作者完成 §2.4 的接缝收尾

---

## 12. 执行提示词（交给实施 agent 时整份粘贴）

```text
你在 /media/win_data/aigcfroge/.worktrees/v2-ux（分支 v2-ux-foundation）执行
docs/plan/v2-ux-trust-foundation.md。

硬约束：
1. 只允许改 packages/{app,ui,session-ui,storybook} 与该计划 §7 列出的文档。
   碰 packages/{core,schema,aigcfroge,desktop,sdk} 任一文件即违约，立即停下。
   永远不要跑 packages/sdk/js/script/build.ts。
2. 不要从 packages/app 引入 @aigcfroge/core 的 product-mode-policy 或任何传递依赖
   core/flag/flag.ts 的模块——会让 Web 构建白屏，且 typecheck 与单测都测不出来。
   能力常量的正确来源是 @aigcfroge/schema/product-mode。
3. 几何只能用 e2e 验证（happy-dom 不做布局，getBoundingClientRect 恒 0）。
   新几何 spec 必须放 e2e/regression/，不能放 e2e/performance/（后者默认被 testIgnore 排除）。
4. 行为断言必须放纯函数单测或 e2e。源码字符串断言只允许用于"组件挂载在某处"这类结构契约，
   不得代替行为（docs/testing.md §10 红线 3）。
5. 颜色一律 --v2-* token，文案一律 i18n；新组件遵循 data-component / data-variant
   与 :is(伪类, [data-state="..."]) 双写约定；领域态用 data-status 而非 data-state。
6. 新 story 照 packages/ui/src/v2/components/badge-v2.stories.tsx 的六段 docs 约定。
7. §0.2 的数字是本计划的口径基线；如与路线图 §3 的旧快照不符，以 §0.2 为准并在 PR 里说明。
8. 每次 push 前跑 LINT_BASE_REF=origin/main bun run script/lint-changed.ts
   + 受影响包 typecheck + 受影响包 test；跑门禁时不要并行跑其他重任务。
9. 输出 CLAUDE.md §改完即审 的「复查结论」七项。
```

---

## 13. 关联文档

- 路线图：[v2-ux-ui-roadmap.md](../roadmap/v2-ux-ui-roadmap.md) · 并行架构路线图 [v2-architecture-roadmap.md](../roadmap/v2-architecture-roadmap.md)
- 并行计划：[v2-architecture-governance-slice-0-3.md](v2-architecture-governance-slice-0-3.md)
- 协议：[DESIGN.md](../../DESIGN.md) · [CLAUDE.md](../../CLAUDE.md) · [AGENTS.md](../../AGENTS.md) · [ARCHITECTURE.md](../../ARCHITECTURE.md) §4.10 · [docs/testing.md](../testing.md)
- ADR：[ADR-11](../architecture/adr/ADR-11-product-mode-session-classification.md) · [ADR-12](../architecture/adr/ADR-12-product-mode-entry-routing.md) · [ADR-15](../architecture/adr/ADR-15-mode-workspace-main-area-slot.md) · [ADR-16](../architecture/adr/ADR-16-global-home-overview.md) · [ADR-17](../architecture/adr/ADR-17-custom-mode-composition-platform.md)
- 模式专线：[custom-mode-roadmap.md](../roadmap/custom-mode-roadmap.md) · [assistant-mode-roadmap.md](../roadmap/assistant-mode-roadmap.md) · [work-mode-roadmap.md](../roadmap/work-mode-roadmap.md)
- 债：[docs/technical-debt.md](../technical-debt.md)（§2 的 960px 延后项、§3.1 的 CustomSidebar 空态与 Storybook OOM、§4 的 E2E 矩阵与 `kind` 信号）
- 技能：`.aigcfroge/skills/frontend-theming/SKILL.md` · `.aigcfroge/skills/quality-to-pr/references/delivery-gates.md`
