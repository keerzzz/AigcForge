# 4 模式页面归一化收尾执行提示词（v3，权限档位已合入版）

> 对应计划：[mode-page-unification-v2.md](mode-page-unification-v2.md)
> 基线：`main` / `origin/main` @ `42cf6d950563c0fc9acadcf04ae3fa39cab21438`（PR #32 权限档位合入后）
> 生成日期：2026-08-17
> 用途：复制 `PROMPT START` 与 `PROMPT END` 之间的正文到新的执行对话。
> v3 修订：G3 权限 Gate 已通过（`mode-scoped-permission-overlay.md` 已实施完成并合入 main），Phase 4-7 不再等待；基线更新为最新 main。

<!-- PROMPT START -->

你是 AigcForge 仓库（`/media/win_data/aigcfroge`）的高级全栈工程师。你要执行
`docs/plan/mode-page-unification-v2.md`，但必须严格遵守该计划的 Gate、停止条件和仓库协议。
本任务是 App UI/架构归并，不是四模式业务语义重写。

## 0. 认知加载（写任何代码前必须精读）

按顺序读完以下文件：

```text
CLAUDE.md                                              （根目录 — 八荣八耻、四大拒绝、门禁、改完即审）
AGENTS.md                                              （根目录 — 分支提交、Effect/Schema/测试规范、代码风格）
ARCHITECTURE.md                                        （根目录 §2/§3/§4.10 — 系统全景、包拓扑、Product Mode）
CONTEXT.md                                             （根目录 — 术语与关系不变量）
DESIGN.md                                              （根目录 — 产品性格、v2 token、布局、模式切换）
packages/app/AGENTS.md                                 （App 包规范）
.aigcfroge/skills/protocols/SKILL.md                   （协议与引用检查）
.aigcfroge/skills/enterprise-code-standard/SKILL.md    （实现基线）
.aigcfroge/skills/reuse-first-refactor/SKILL.md        （复用优先重构）
.aigcfroge/skills/quality-to-pr/SKILL.md               （交付门禁）
.aigcfroge/skills/frontend-theming/SKILL.md            （v2 token 强制）
docs/plan/mode-page-unification-v2.md                  （本计划全文，321 行，唯一任务真源）
docs/plan/mode-scoped-permission-overlay.md            （权限档位计划 — 已实施完成并合入 main，本任务只读上下文）
docs/architecture/adr/ADR-11-product-mode-session-classification.md
docs/architecture/adr/ADR-12-product-mode-entry-routing.md
docs/architecture/adr/ADR-15-mode-workspace-main-area-slot.md
docs/architecture/adr/ADR-16-global-home-overview.md
docs/architecture/pages/home.md
docs/architecture/system-blueprint.md
```

读完才能开始写代码。

## 1. 目标与非目标

### 1.1 目标

1. 删除已经没有页面外壳职责的 `packages/app/src/pages/home.tsx`，把共享 Session 构件迁入明确 owner（Phase 1）。
2. 保留 Coding 项目树，明确它与 Work/Assistant 共享 Location 控件、Chat 功能侧栏内联 Location 的边界（Phase 2）。
3. 将详情页真正重复的拖拽 Tab 机制、Diff 渲染和 Tab 回写逻辑提取为带 slots/variants 的共享模块（Phase 3）。
4. 将首页会话列表复用收敛到"纯数据管线 + 纯展示组件"（Phase 4）。
5. 仅在 computed-layout baseline 证明等价时清理主列宽度条件分支（Phase 6）。
6. 统一文档、测试和架构索引，`home.tsx` 删除后无失效 owner 引用（Phase 1/7）。

### 1.2 非目标

- 不把 Coding 项目树改造成 `ModeLocationNewSession`。
- 不实现 Assistant 的 `global|project` 知识库 scope 选择器。
- 不把 Coding 项目搜索、Chat 资产/文件搜索和 Session 搜索合成一个领域组件。
- 不把 `secondary-sidebar.tsx` 改成第二套 mode registry。
- 不改变 `MODE_SURFACES` 对外契约、路由、Session mode、权限、数据库、HTTP API 或资产事务。
- 不迁移无关的 star/alias import 和全仓技术债。

## 2. 基线已确认事实（执行前 grep 复核，禁止重新臆测）

开工门禁：

```bash
pwd
git branch --show-current
git status --short --branch
git log -1 --format='%H %ad %s' --date=iso main
git log -1 --format='%H %ad %s' --date=iso origin/main
```

基线必须为 `main` / `origin/main` 的 `42cf6d950` 或其后续（PR #32 权限档位合入后）。不要切换、
覆盖或回滚用户已有修改；如果工作树有脏改动，先隔离本任务文件。

### Owner 边界（已核实，执行时仍须复核）

- `ModeWorkspace` 和 `SecondarySidebar` 保持 render-all + `display:none`，不得改为 `Dynamic`、keyed branch 或导致模式切换 remount 的方案。
- Coding 的 `HomeProjectColumn` 负责 server/project/sandbox、多项目选择、项目操作、通知和 Coding 新建会话；不得替换成 `ModeLocationNewSession`。
- Work 与 Assistant 当前消费 `ModeLocationNewSession`（`mode-workspace-slots.tsx:516` 等）。
- Chat 当前不是 `ModeLocationNewSession` 的消费者。`ChatFeatureSidebar` 自己拥有 Location 行、新建/添加项目逻辑，并同时拥有 Chat feature tree/counts。不得在计划或报告中写"Chat/Work/Assistant 已统一 Location"。
- Assistant `global|project` scope 不在本任务实现。

### 宽度与 Storybook（已核实）

- `mode-workspace.tsx` 当前存在 Chat/Work `960px` 与 Coding/Assistant `720px` 的 track 条件（`:148-151` 附近）。不能仅凭 `max-w-[1080px]` 推断最终 computed width。
- Phase 6 必须先测量四模式 desktop/narrow 的 computed grid track、主区 bounding box、overflow、滚动区域和侧栏宽度。只有证明确实等价才可删条件；不等价就保留分支并记录"无安全可删分支"。
- `packages/storybook/.storybook/main.ts` 当前收集 `../../ui/src/**/*.stories.*`、`../../session-ui/src/**/*.stories.*` 和 `../../app/src/**/*.stories.*`（`:25-28`）。App-local shared UI stories 应 colocate 在 `packages/app/src/**/*.stories.tsx`（当前 app 内无 stories 文件，Phase 3 需新增），通过 `bun --cwd packages/storybook build` 验证；不要把 story 写到不存在的 `packages/storybook/**/*.stories.tsx` 目录。

### 五层代码验证（每个 Phase 开始前 grep）

```bash
# L1 首页 owner
grep -n "buildHomeSessionRecords\|HomeSessionSearch\|groupSessions\|HOME_SESSION_LIMIT" packages/app/src/pages/home.tsx
rg -n 'from "@/pages/home"|pages/home.tsx' packages/app/src packages/app/e2e

# L2 槽位与侧栏
grep -n "HomeProjectColumn\|ModeLocationNewSession" packages/app/src/pages/mode-workspace-slots.tsx
grep -n "960px\|720px\|max-w-\[1080px\]" packages/app/src/pages/mode-workspace.tsx

# L3 详情页
grep -rn "SessionRightPanel" packages/app/src/pages/session/ packages/app/src/components/chat/ | head
ls packages/app/src/pages/session/ | grep -iE "file-tab|text-diff"   # Phase 3 前应为空或仅 file-tabs.tsx
```

## 3. Gate

### G1 Owner

Phase 1 可以迁移 `home.tsx` 的共享 Session 构件和 Coding 项目 owner。
Phase 2 必须明确记录 Coding、Work/Assistant、Chat 三种真实 owner，不得通过源码注释伪造统一状态。

### G2 Width

Phase 6 以 computed-layout baseline 为真源。产品若要求实际 960px 主列，停止该 Phase，另开 PRD/视觉变更。

### G3 Permission ✅ 已通过

`docs/plan/mode-scoped-permission-overlay.md`（会话级权限档位）**已实施完成并合入 main（PR #32，2026-08-17）**。
Phase 4-7 不再需要等待权限计划，全部 Phase 可顺序执行。但两者仍不得混入同一 PR——本任务与权限计划无依赖交集。

### G4 Human confirmation

计划里的工程结论不是 owner 人类签字。不要把"待执行审批"写成"已批准"。
**执行节奏：全部 Phase 连续执行，每 Phase 完成且验证通过后直接进入下一 Phase，不逐 Phase 停下等审批。**
只在 Phase 之间切换分支/提交时输出简短复查结论供跟踪；全部 Phase 完成后统一输出完整报告，由用户一次性审批整体结果。
遇到 §7 的停止条件（事实不符、门禁失败、测试失败等）时才必须立即停下回报。

## 4. TDD 强制循环（每 Phase 必走）

```text
1. 读取本 Phase owner、调用方、近邻测试、协议和计划小节
2. 建立 reuse table：candidate / evidence / compatibility / decision / reason
3. 红：先写最小红测试并运行确认失败
4. 绿：写最小实现使测试变绿；不顺手重命名所有历史符号
5. 重构：清理重复逻辑，保持测试绿；不扩张范围
6. 命令验证（见下表）
7. 运行 check-refs.sh、git diff --check，重读变更和调用链
8. 按 CLAUDE.md §改完即审输出简短复查结论，git commit，直接进入下一 Phase
```

命令规则：

| 用途         | 命令                                                     |
| ------------ | -------------------------------------------------------- |
| App 单元测试 | `bun --cwd packages/app run test:unit`                   |
| App 类型检查 | `bun --cwd packages/app typecheck`                       |
| App E2E      | `bun --cwd packages/app run test:e2e <受影响 spec>`      |
| App 性能     | `bun --cwd packages/app run test:bench`（只在此包执行）  |
| Storybook    | `bun --cwd packages/storybook build`                     |
| 增量 lint    | `bun run script/lint-changed.ts`                         |
| 协议引用     | `bash .aigcfroge/skills/protocols/scripts/check-refs.sh` |
| 差异检查     | `git diff --check`                                       |

## 5. 实施步骤（推荐顺序：Phase 1 → 2 → 3 → 4 → 5 → 6 → 7；Phase 3 可与 1/2 并行，但不能共享未验证的半成品 owner）

每个 Phase 使用不超过三个短词、无 slash 的分支名，独立提交；**连续执行全部 Phase 后统一推送并报告，由用户一次性审批整体结果**；不得在全部 Phase 完成前自行 push 或开 PR。

### Phase 1：拆除 `home.tsx`，建立明确 owner

分支：`home-shared-extract`

- 新建 `packages/app/src/pages/home-shared.tsx`，迁移 `HOME_SESSION_LIMIT`、`HomeSessionRecord`、`HomeSessionGroup`、`buildHomeSessionRecords`、`matchesHomeSessionSearch`、`homeSessionSearchKey`、`HomeSessionLeading`、`HomeSessionSearch`、`HomeSessionSearchResultRow`、`HomeSessionGroupHeader`、`HomeSessionRow`、`HomeSessionSkeleton`、`groupSessions` 和它们所需的纯展示常量。
- 新建 Coding 专属 owner `packages/app/src/pages/coding-project-column.tsx`，迁移 `HomeProjectColumn` 及其 server/project 行组件；如保持兼容名称，必须在文件注释中说明它是 Coding owner，不再是 Home 页面 owner。
- 更新全部真实消费方：`mode-workspace-slots.tsx`、`assistant-dashboard.tsx`、`home-overview.tsx`、`layout/helpers.ts`，以及所有读取 `home.tsx` 源码契约的测试。
- 更新 ADR-16、`docs/architecture/pages/home.md`、`docs/architecture/system-blueprint.md` 和仍描述当前实现的计划文档；历史记录可保留历史路径，但当前 owner 表必须指向新文件。
- 用 `rg` 同时检查 import、源码读取和文档 owner 引用，不能只检查 `pages/home"`。

验收：

```bash
rg -n 'from "@/pages/home"|pages/home.tsx|read\("../pages/home.tsx"' packages/app/src packages/app/e2e
bun --cwd packages/app run test:unit
bun --cwd packages/app typecheck
bun run script/lint-changed.ts
```

红/绿/重构要求：先为新 owner/import/source-contract 写最小红测试；最小迁移使测试变绿；
`HomeSessionRecord` 的类型 owner 与 `openSessionRecord` 的调用方向必须保持清楚，不产生循环 import。

### Phase 2：锁定 Coding/Location owner 边界

分支：`location-owner-boundary`

- 不把 `CodingProjectColumnSidebar` 替换为 `ModeLocationNewSession`；只更新 import/注释/测试，使 Coding owner 关系显式。
- 记录并测试当前事实：Work/Assistant 使用 `ModeLocationNewSession`；Chat 使用 `ChatFeatureSidebar` 内联的 Location + 新建/添加项目逻辑，并额外承载 Chat feature tree/counts。
- 不让 `ModeLocationNewSession` 读取 `CodingSelectionCtx` 或自行创建第二套 server/project selection。若要把 Chat 改为消费它，必须先证明 `ChatFeatureSidebar` 的功能树、计数、seed、目录注册和新建行为全部保持，并在同一 Phase 内完成 source-contract 与浏览器回归。
- 在本文和 ADR-15 附录记录 Location 决策；增加 source-contract 测试，断言真实 owner，不得用"Chat 已复用 ModeLocationNewSession"作为断言。

必须回归：Coding server 切换、项目切换、多选注册、关闭/编辑项目和新建会话；Chat Location/功能树/计数/添加项目/新建会话；Work/Assistant Location 和普通新建。
若本 Phase 未改变 Chat 实现，不得把"Chat Location 统一"写入完成报告。

### Phase 3：详情页重复机制归并

分支：`right-panel-shell-merge`

只共享（新建 `packages/app/src/pages/session/file-tab-strip.tsx`、`packages/app/src/pages/session/text-diff-view.tsx`）：

- `SessionFileTabStrip`：DragDrop surface、`SortableProvider`、`SortableTab`、`DragOverlay`、`createFileTabListSync` 和拖拽状态。最小契约：`openedTabs`、`contextOpen`、`onClose`、`onMove`、`renderLeading`、`renderTrailing?`、`renderOverlay`、`children`。
- `TextDiffView`：old/new text + `variant: "chat" | "work"`，保留现有边框、背景、前景色、行高、滚动和加减号布局。
- `SessionRightPanel` 的默认 fileTree（只在 `fileTree` 未传入时提供与当前 Work/Assistant 完全一致的内容）；Coding changes/all tree 与 Chat `.aigcfroge` tree 仍显式传入。
- 参数化 Tab 回写 helper，必须包含 `enabled`、`activeTab`、`fallbackTab`、`setActive`；不得把 Chat/Work 的 tab 集合写死在共享模块。

不能共享：Chat preview/context/asset apply；Coding review/diff tree/open file；Work artifact/context/preset；Assistant entity tabs；各模式查询或权限状态。

验收：更新 `session-right-panel.test.tsx`、`session-file-tree.test.tsx`、`work-artifact-panel.test.ts`、`chat/asset-workbench.test.ts`，新增 `file-tab-strip`/`text-diff-view` contract tests；覆盖拖拽排序、Context 打开/关闭、Coding review tab、Chat preview tab、Work artifact tab、默认 fileTree 和窄屏行为。新增 `packages/app/src/pages/session/*.stories.tsx`（或同等 app 内 stories 路径），运行：

```bash
bun --cwd packages/app run test:unit
bun --cwd packages/app typecheck
bun run script/lint-changed.ts
bun --cwd packages/storybook build
bun --cwd packages/app run test:bench
```

基准必须来自 `packages/app/e2e/performance` 的现有 session tab switch/flash 场景，串行运行，不添加机器相关硬阈值。

### Phase 4：主区 Session 展示归并

前置：G3 已通过（无等待项）。分支：`session-list-unify`

- 默认不新增 `ModeSessionListSection` 大组件；先直接复用 `HomeSessionRow`、`HomeSessionGroupHeader`、`HomeSessionSkeleton` 和 `groupSessions`，只把重复的数据/展示调用点迁到 Phase 1 的 owner。
- 只有 Phase 4 的 diff 证明同一段列表结构在至少两个 owner 中完全相同，才允许新增 display-only wrapper；其最小契约只能接收已分组 records、server 信息、打开回调和可选 badge/highlight/new-session callback，不得持有 `useQuery`、`loadSessions`、prefetch、lastActive 或 mode selection。
- Global Home 的 pinned 区、Work 空态/预设、Assistant 高亮和各页面查询生命周期继续由页面 owner 控制。
- `buildHomeSessionRecords`、`filterSessionsByMode`、`groupSessions` 作为纯数据 owner 复用，不新增覆盖四种查询生命周期的"大组件"。
- Work 的三个卡片变体只在 `mode-workspace-slots.tsx` 内抽取 `WorkPresetCard`，不提升为跨页面通用卡片；不抽取 `PanelSectionHeader`。

验收：Coding 预取、Work 空态隐藏、Assistant 高亮、Global Home 置顶/筛选/徽标均保持；受影响测试、unit、typecheck、lint 通过。

### Phase 5：保留显式 SecondarySidebar 分发

前置：G3 已通过。本 Phase 不再注册表化。`MODE_SURFACES` 和 `SecondarySidebar` 的职责不同，新增第二个 registry 会制造新的 mode source of truth。

仅执行：

1. 为四种 render-all 分支补 source-contract 测试。
2. 在 `ChatFeatureSidebar` 双实例处保留 ADR-15 解释。
3. 侧栏三种 Session 查询只复用 `sortedRootSessions`/mode filter 纯逻辑，保留 Chat/Work/Assistant 各自的 Location、tab、实体树和加载行为。
4. 不把 `HomeSessionSearch` 用作项目搜索或资产/文件搜索底座。

验收：`secondary-sidebar`、`work-secondary-sidebar`、`assistant-nav-tree` 相关 tests/typecheck/lint 通过。

### Phase 6：测量后清理宽度条件

分支：`mode-width-cleanup`

1. 先在四模式分别记录 desktop/narrow viewport 的 computed `grid-template-columns`、主区 bounding box、容器 overflow、滚动区域和侧栏宽度；记录命令、viewport、浏览器和原始结果，作为 Phase 6 baseline。
2. 只有 baseline 证明 Chat/Work/Coding/Assistant 的可见几何和滚动行为可等价时，才删除 `mode-workspace.tsx` 中重复的 mode 宽度三元分支；若 computed geometry 不同，则保留分支并把本 Phase 结论改为"无安全可删分支"，不得为了源码整洁制造布局回归。
3. 保留当前 `max-w-[1080px]` 和响应式规则，不宣称主列变为 960px；不修改 `MODE_DEFINITIONS` 或 `context/mode.tsx`。
4. 如产品需要真正 960px 主列，停止本 Phase，另开 PRD/视觉变更并重新评审窄屏、Assistant 密度和容器宽度。

验收：baseline 与变更后 computed-layout 结果逐项对比；只有全部适用几何保持才允许标记"清理完成"，否则以"分支保留且有证据"完成；typecheck/lint 通过。

### Phase 7：带 options 的新建会话 helper + 文档收尾

分支：`mode-launch-helper`

1. 在 `packages/app/src/pages/layout/helpers.ts` 附近优先扩展已有 `openProjectNewSession` 的回调/option 契约，或新增 `launchModeSession(input)`；不得创建第二套项目打开逻辑。
2. 只有当 helper 真的拥有 `tabs.newDraft` 生命周期时才把 `tabs` 放入 input；否则保持 `projects`/server/directory 的项目打开逻辑与调用方的 `tabs`、`modeDraft`、prompt 组装分离，避免把 UI context 强塞进纯 helper。
3. 需要抽取时，input 至少能表达 `mode`、`projects`、`server`、`directory`，以及可选 `initialPrompt`、可选 `draftOverrides`；普通入口使用默认 `modeDraft(mode)`，Chat seed/import、Work preset/workflow 必须保留原有 agent、presetCategoryId 和 prompt；资产选择器不强行迁移。
4. 审计所有 `tabs.newDraft`/`openProjectNewSession` 调用点，逐一证明 Draft 字段和初始 prompt 未丢失。
5. 更新 ADR-16、`docs/architecture/pages/home.md`、相关 plan 的当前 owner 路径；在 CLAUDE.md 技术债表中记录/销账时保留证据。

验收：逐场景验证普通新建、Chat 新建/导入、Work preset/workflow、Assistant 新建、Coding 新建；unit/typecheck/lint/Playwright 通过。

## 6. 回滚与安全

- 每 Phase 独立 commit（`refactor(app): Phase N — <description>`），可 `git revert` 单步回滚。
- 禁止 `git reset --hard`、`git checkout --`、`--no-verify`、`as any`、`@ts-ignore` 和为了通过测试而复制生产逻辑。
- 测试不能从仓库根目录运行。App 测试从 `packages/app` 执行，其他包同理。
- **DESIGN.md 合规**：稳定尺寸无位移 / v2 token / 明暗主题 CSS 变量自适应 / 键盘 focus / 中英文溢出 truncate。
- 每个 Phase 完成后必须重新阅读 CLAUDE.md 全文。
- 阻塞问题：先向用户报告现状和已试方案，请求决策。

## 7. 必须停止并报告的情况

遇到以下任一情况必须**立即**停止并回报，不得自行猜测、跳过门禁或跨 Gate 施工；除此之外按 G4 连续执行，不再逐 Phase 等审批：

- main 基线中 `home.tsx` 的 live consumer、ModeWorkspace width、Location owner 或 Draft 字段与计划/本文不符；
- 需要改变 Coding 项目树、Assistant scope、Session mode、权限、资产事务、路由、API、DB 或 core；
- 共享组件需要超过计划定义的 slots/variants 才能保持行为；
- 单元测试、typecheck、lint、Playwright、Storybook build 或 benchmark 失败；
- 只能靠 `as any`、忽略错误、任意 sleep/timeout、假 mock 或跳过 hook 才能继续。

报告需包含：已读文件、证据、失败命令、已尝试方案和需要的 owner 决策。

## 8. 完成报告模板

```text
复查结论:
- Phase / 基线 / 分支:
- 影响文件:
- reuse table 摘要:
- 保留的 owner 与不变量:
- 安全门禁: Catch Everything / No Null Pointer / Security First
- 工程门禁: No Cheating / Reusability / Clean Logs
- UI/Storybook/性能验证:
- 已运行命令:
- 提交:
- 剩余风险:
- 是否允许进入下一 Phase:
```

<!-- PROMPT END -->

## 使用说明

| 项           | 值                                                                             |
| ------------ | ------------------------------------------------------------------------------ |
| 复制范围     | `PROMPT START` 到 `PROMPT END`                                                 |
| 计划真源     | `docs/plan/mode-page-unification-v2.md`（需先合入 PR #34）                     |
| 基线         | `main` / `origin/main` @ `42cf6d950`（PR #32 权限档位合入后）                  |
| G3 权限 Gate | ✅ 已通过，Phase 4-7 可直接执行                                                |
| 阶段节奏     | 每 Phase 独立分支/提交，**连续执行不逐 Phase 等审批**，全部完成后统一审批      |
| UI 验证      | App unit/typecheck/lint + 受影响 Playwright + Storybook build + 适用 benchmark |
