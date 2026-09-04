# 4 模式页面归一化收尾实施计划：首页底座 + 详情页底座 + 横切件

> **⚠️ Owner 仲裁（2026-09-01）**：本计划与 [five-mode-runtime-remediation-tdd-workflow-2026-08-30.md](five-mode-runtime-remediation-tdd-workflow-2026-08-30.md) 声明了重叠的 owner。裁决结果：**重叠切片归五模式修整计划**，本计划保留非重叠部分。
>
> 依据：`CLAUDE.md` 的极致减法 —— 两个 owner 抢同一件事本身就是双事实源（正是那份计划要修的 R1/R2 同类问题），协议答案是**归并**而非「选赢家让另一方 rebase」。证据不对称：本计划分支不存在、零产物；五模式计划已在 `five-mode-tdd` 落盘 4 个提交（`d24b7035a` / `74487f934` / `7a431619c` / `ad4f9ca7f`），含 9 条可复现 RED 与已实施的 D4-A + D5-A。
>
> 重叠明细见下表。开工前先读该计划 §5 owner 地图。
> **本计划让出**：`pages/mode-workspace.tsx` 与 `mode-workspace-slots.tsx` 的 ModeWorkspace owner（= 五模式计划 S6）。首页底座、详情页底座、横切件中不触及 ModeWorkspace 的部分仍属本计划。
>
> **注意**：五模式计划 S6 会改 Start/Upgrade 导航，而 `pages/mode-launch-contract.test.ts` 与 `pages/location-owner-contract.test.tsx` 曾用源码字符串把当前行为钉成契约，两个计划都会触及这两个测试文件。

> 状态：**main 基线复审修订版，待执行审批（2026-08-15）**
> 基线：`main` / `origin/main`，提交 `a4b0485aa435f7aaa957f796758fb5baeb077fa8`
> 范围：`packages/app` + `packages/storybook` Storybook runner（App-local shared UI stories）+ `docs/`；不动 `packages/core`、无 DB migration、无新 HTTP API
> 关联：[ADR-11](../architecture/adr/ADR-11-product-mode-session-classification.md)、[ADR-12](../architecture/adr/ADR-12-product-mode-entry-routing.md)、[ADR-15](../architecture/adr/ADR-15-mode-workspace-main-area-slot.md)、[ADR-16](../architecture/adr/ADR-16-global-home-overview.md)、[mode-module-switching-completion](mode-module-switching-completion.md)、[mode-scoped-permission-overlay](mode-scoped-permission-overlay.md)、[Chat PRD](../prd/chat-mode-creation-layer.md)、[Work PRD](../prd/work-mode-execution-layer.md)、[Assistant PRD](../prd/assistant-mode-personal-agent.md)、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.10
> 复审依据：`CLAUDE.md`、根 `AGENTS.md`、`DESIGN.md`、`packages/app/AGENTS.md`、`protocols`、`enterprise-code-standard`、`reuse-first-refactor`，以及 main 基线代码、测试和 Git 历史
> 修订说明：保留 Coding 项目树 owner；主列宽度改为“先测量、再决定是否可去条件分支”；移除不成立的统一搜索壳、二级侧栏注册表和过度参数化的会话列表组件；补齐删除 `home.tsx` 的全量影响面；修正 Chat 当前仍由 `ChatFeatureSidebar` 内联 Location 的事实，并锁定 Storybook story 的实际发现路径。

---

## 0. 执行 Gate

| Gate              | 决议                                                                                                                                                                                                          | 执行约束                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1 Owner 边界** | 以 main 代码为准：Coding 保留 `HomeProjectColumn` 项目树；Work/Assistant 当前消费 `ModeLocationNewSession`；Chat 当前由 `ChatFeatureSidebar` 同时拥有 Location、资产功能树和新建/添加项目动作，尚未消费该组件 | 不得把 Coding 项目树直接替换成 `ModeLocationNewSession`，也不得把 Chat 的 Location 事实写成已统一；若要让 Chat 改用共享组件，必须先保留功能树行为并补 owner/行为测试 |
| **G2 宽度语义**   | 源码存在 Chat/Work 的 `960px` 与 Coding/Assistant 的 `720px` track 分支；父容器为 `max-w-[1080px]`、`px-6`、`gap-8`、`280px` 侧栏，不能仅凭源码推断最终 computed width                                        | Phase 6 先记录四模式 desktop/narrow computed layout、overflow 和 scroll geometry；只有基线证明可等价时才删分支。若要实际 `960px` 主列，另立产品/视觉变更             |
| **G3 权限档位**   | `mode-scoped-permission-overlay.md` 是独立 P0 计划，当前仍未实施                                                                                                                                              | Phase 1-3 可在权限计划等待期执行；Phase 4-7 必须等待权限前置提交合入 `main` 并完成最终复审；两者永不进入同一 PR                                                      |
| **G4 计划状态**   | 本文曾使用未来日期的 owner PASS，已改为“工程证据已收敛，待用户/owner 执行确认”                                                                                                                                | 不得把文档中的工程裁决伪装成人类签字；执行提示词必须保留停止 Gate                                                                                                    |

**核心结论**：归一化底座已经存在：首页是 `ModeWorkspace` render-all + typed slots，详情页是 `SessionRightPanel` A/B 壳。本文只归并真实重复的 owner 内实现，不做四模式语义大统一。

---

## 1. 目标与非目标

### 1.1 目标

1. 删除已经没有页面外壳职责的 `pages/home.tsx`，把共享 Session 构件迁入明确 owner。
2. 保留 Coding 的项目/服务器树，明确它与 Work/Assistant 共享 Location 控件、Chat 功能侧栏内联 Location 的边界。
3. 将详情页真正重复的拖拽 Tab 机制、Diff 渲染和 Tab 回写逻辑提取为带 slots/variants 的共享模块。
4. 将首页会话列表复用收敛到“纯数据管线 + 纯展示组件”，不让一个组件接管 Coding、Work、Assistant、Global Home 的全部生命周期。
5. 仅在 computed-layout baseline 证明等价时清理主列宽度条件分支；若不等价则保留分支并记录证据，始终保持当前实际渲染宽度和响应式行为。
6. 统一文档、测试和架构索引，使 `home.tsx` 删除后不存在失效 owner 引用。

### 1.2 非目标

- 不把 Coding 项目树改造成 `ModeLocationNewSession`。
- 不实现 Assistant 的 `global|project` 知识库 scope 选择器；该能力仍由 Assistant 独立计划负责。
- 不把 Coding 项目搜索、Chat 资产/文件搜索和 Session 搜索合成一个领域组件。
- 不把 `secondary-sidebar.tsx` 改成第二套 mode registry；保留现有 render-all + `display:none`。
- 不改变 `MODE_SURFACES` 对外契约、路由、Session mode、权限、数据库、HTTP API 或资产事务。
- 不迁移无关的 star/alias import 和全仓技术债。

---

## 2. main 基线已核实事实

| 领域               | main 基线事实                                                                                                                                         | 本计划处理                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| ModeWorkspace      | `mode-workspace.tsx` 同时挂载四个 slot，使用 `display:none` 保持状态                                                                                  | 保持不变                                                                                                   |
| 主列宽度           | 源码写有 `960px`/`720px` 两种 track；父容器 `max-w-[1080px]`、padding、gap 使最终 geometry 不能只由源码推断                                           | 先记录四模式 computed-layout baseline；等价才删条件，不声称实现 960px                                      |
| Home owner         | `home.tsx` 已无 `Home` 页面，仅保留共享导出和 Coding 项目树                                                                                           | 拆为 `home-shared.tsx` + Coding 专属 owner                                                                 |
| Coding 项目树      | `HomeProjectColumn` 负责 server/project 列表、项目操作、通知和多项目选择；`CodingSelectionCtx` 负责主区联动                                           | 保留，不并入三模式 Location                                                                                |
| 非 Coding Location | Work/Assistant 当前复用 `ModeLocationNewSession`；Chat 的 `ChatFeatureSidebar` 内联等价的目录、新建和添加项目逻辑，并额外承载资产功能树               | 保留 Chat 功能树 owner；是否抽取更低层 Location primitive 必须以行为等价测试为前置，不把 Chat 误报为已复用 |
| 首页 Session 管线  | Coding、Work、Assistant、Global Home 共享 `buildHomeSessionRecords` 等基础函数，但各自有预取、筛选、置顶、badge、高亮和空态差异                       | 提取纯展示组件，查询/筛选生命周期留在页面 owner                                                            |
| 详情页 Tab         | Chat 与 Coding 共享文件 Tab 基础设施，但 leading tabs、review、preview、打开文件按钮和 active fallback 不同                                           | 只抽拖拽/列表基础层，保留 mode slots                                                                       |
| Diff               | Chat 与 Work 都调用 `diffTextLines`，但容器、背景色、边框和密度不同                                                                                   | `TextDiffView` 必须有 variant，保持视觉契约                                                                |
| 侧栏 Session       | Chat/Work/Assistant 都使用 `sortedRootSessions` + mode filter + `SessionItem`，但 Work 有维度 tabs，Assistant 有实体树，Chat 有独立 Location/加载语义 | 共享纯函数，保留三侧栏视图 owner                                                                           |
| 搜索               | Home 是 Session 搜索；Coding 是项目搜索；Chat 右栏是 `.aigcfroge` 文件树搜索                                                                          | 不做跨领域合并                                                                                             |
| 新建会话           | 普通入口、Chat seed/import、Work preset/workflow、Assistant、资产选择器有不同 Draft 字段和初始 prompt                                                 | 只提取带 options 的安全启动 helper                                                                         |

---

## 3. 不变量与契约

### 3.1 架构不变量

- `ModeWorkspace`、`SecondarySidebar`、`SessionSidePanel` 的 render-all + `display:none` 不得改成 `Dynamic`/keyed branch。
- Product Mode 仍由 route、Draft 或 Session 权威来源驱动，不创建第二套 Session 身份或 mode 推断。
- Coding 的 `HomeProjectColumn` 保留多 server、多项目、sandbox 和项目操作语义。
- Work/Assistant 的 `ModeLocationNewSession` 只负责 active directory、注册地址和新建入口；Chat 的 `ChatFeatureSidebar` 在相同 Location 行为之外还负责资产功能树和计数，不承载 Coding 项目树。
- 共享模块只拥有真实重复的行为；查询、权限、资产状态、实体选择和模式专属空态仍由现有 owner 持有。
- 所有 UI 颜色、间距、圆角、阴影继续使用现有 v2 tokens；新增共享 UI 必须补 Storybook story。

### 3.2 禁止归一化清单

| 模式        | 必须保留                                                                           |
| ----------- | ---------------------------------------------------------------------------------- |
| coding      | 项目/服务器树、跨 server 选择、项目操作、markdown 预取、review/diff 树             |
| chat        | 资产 propose/apply/overwrite 状态机、资产工作台、文件树搜索和 preview tab          |
| work        | artifact apply/overwrite、trade/taskSet/agent tabs、preset/workflow 分类和失败降级 |
| assistant   | 实体导航树、动态实体 tabs、提醒/投递/记忆/KB 区块和来源会话高亮                    |
| global home | all/mode/project 筛选、lastActive 置顶、mode badge 和全量 Session 搜索             |

---

## 4. Phase 详细计划

### Phase 1：拆除 `home.tsx`，建立明确 owner

分支：`home-shared-extract`

1. 新建 `packages/app/src/pages/home-shared.tsx`，迁移 `HOME_SESSION_LIMIT`、`HomeSessionRecord`、`HomeSessionGroup`、`buildHomeSessionRecords`、`matchesHomeSessionSearch`、`homeSessionSearchKey`、`HomeSessionLeading`、`HomeSessionSearch`、`HomeSessionSearchResultRow`、`HomeSessionGroupHeader`、`HomeSessionRow`、`HomeSessionSkeleton`、`groupSessions` 和它们所需的纯展示常量。
2. 新建 Coding 专属 owner 文件 `packages/app/src/pages/coding-project-column.tsx`，迁移 `HomeProjectColumn` 及其 server/project 行组件；如保持兼容名称，必须在文件注释中说明它是 Coding owner，不再是 Home 页面 owner。
3. 更新全部真实消费方：`mode-workspace-slots.tsx`、`assistant-dashboard.tsx`、`home-overview.tsx`、`layout/helpers.ts`，以及所有读取 `home.tsx` 源码契约的测试。
4. 更新 ADR-16、`docs/architecture/pages/home.md`、`docs/architecture/system-blueprint.md` 和仍描述当前实现的计划文档；历史记录可保留历史路径，但当前 owner 表必须指向新文件。
5. 用 `rg` 同时检查 import、源码读取和文档 owner 引用，不能只检查 `pages/home"`。

验收：

- `rg -n 'from "@/pages/home"|pages/home.tsx|read\\("../pages/home.tsx"' packages/app/src packages/app/e2e` 无 live code/test 残留。
- `bun --cwd packages/app run test:unit`、`bun --cwd packages/app typecheck`、`bun run script/lint-changed.ts` 通过。
- `home-overview`、`mode-workspace`、`assistant-nav-tree`、`layout/helpers` 相关测试覆盖新 owner。

### Phase 2：锁定 Coding/Location owner 边界

分支：`location-owner-boundary`

1. 不把 `CodingProjectColumnSidebar` 替换为 `ModeLocationNewSession`；只更新 import/注释/测试，使 Coding owner 关系显式。
2. 记录并测试当前事实：Work/Assistant 使用 `ModeLocationNewSession`；Chat 使用 `ChatFeatureSidebar` 内联的 Location + 新建/添加项目逻辑，并额外承载 Chat feature tree/counts。
3. 不让 `ModeLocationNewSession` 读取 `CodingSelectionCtx` 或自行创建第二套 server/project selection。若要把 Chat 改为消费它，必须先证明 `ChatFeatureSidebar` 的功能树、计数、seed、目录注册和新建行为全部保持，并在同一 Phase 内完成 source-contract 与浏览器回归。
4. 在本文和 ADR-15 附录记录 Location 决策：Coding 保留项目树；Work/Assistant 复用现有 Location owner；Chat 的 Location 仍由功能侧栏 owner 持有，是否继续抽取更低层 primitive 不在本 Phase 强制决定；Assistant `global|project` scope 不在本计划实现。
   - **执行记录（Phase 2，2026-08-17）**：Coding 项目树已由 Phase 1 迁入 `coding-project-column.tsx`（`HomeProjectColumn`/`HomeProjectRow`，兼容名称 + Coding owner 注释）；Work/Assistant 仍消费 `ModeLocationNewSession`；Chat 的 `ChatFeatureSidebar` 内联 Location + 新建/添加项目 + 7 类 feature tree/counts，未消费 `ModeLocationNewSession`。Location 决策已记入 ADR-15 附录 A，并新增 `location-owner-contract.test.tsx` source-contract 测试断言真实 owner（不得以"Chat 已复用 ModeLocationNewSession"为断言）。
5. 增加 source-contract 测试，证明 Coding 仍使用 Coding owner、Work/Assistant 仍使用 `ModeLocationNewSession`、Chat 仍挂载 `ChatFeatureSidebar`；测试不得用“Chat 已复用 `ModeLocationNewSession`”作为断言。

验收：Coding server 切换、项目切换、多选注册、关闭/编辑项目和新建会话手工回归；Chat Location/功能树/计数/添加项目/新建会话回归；Work/Assistant Location 回归；相关 App tests/typecheck/lint 通过。若本 Phase 未改变 Chat 实现，不得把“Chat Location 统一”写入完成报告。

### Phase 3：详情页重复机制归并

分支：`right-panel-shell-merge`

#### 3a `SessionFileTabStrip`

新模块只拥有 DragDrop surface、`SortableProvider`、`SortableTab`、`DragOverlay`、`createFileTabListSync` 和拖拽状态。它不得拥有 Chat/Coding 的 leading tab、active fallback、review 内容或文件树业务。

最小契约：

```ts
type SessionFileTabStripProps = {
  openedTabs: Accessor<readonly string[]>
  contextOpen: Accessor<boolean>
  onClose: (tab: string) => void
  onMove: (from: string, to: string) => void
  renderLeading: () => JSX.Element
  renderTrailing?: () => JSX.Element
  renderOverlay: (tab: string) => JSX.Element
  children: JSX.Element
}
```

Chat/Coding 各自保留 TabsV2 内容和 active state，只消费这个 surface。

#### 3b `TextDiffView`

提取到 `packages/app/src/pages/session/text-diff-view.tsx`，接收 `oldText`、`newText` 和 `variant: "chat" | "work"`。两个 variant 必须保留现有边框、背景、前景色、行高、滚动和加减号布局。

#### 3c 默认 fileTree

`SessionRightPanel` 仅在 `fileTree` 未传入时提供与当前 Work/Assistant 完全一致的默认 `FileTree` 内容；Coding 的 changes/all tree 和 Chat 的 `.aigcfroge` tree 仍显式传入。

#### 3d Tab 回写 helper

提取一个纯 helper 或小型 effect factory，参数必须包含 `enabled`、`activeTab`、`fallbackTab`、`setActive`；不得把 Chat/Work 的 tab 集合写死在共享模块。

验收：

- 更新 `session-right-panel.test.tsx`、`session-file-tree.test.tsx`、`work-artifact-panel.test.ts`、`chat/asset-workbench.test.ts`，并新增 `file-tab-strip`/`text-diff-view` contract tests。
- 覆盖拖拽排序、Context 打开/关闭、Coding review tab、Chat preview tab、Work artifact tab、文件树默认值和窄屏行为。
- 运行 App unit/typecheck/lint，并运行受影响的 Playwright regression。
- Story colocate 在 `packages/app/src/pages/session/*.stories.tsx` 或同等 `packages/app/src/**/*.stories.tsx` 路径；`packages/storybook/.storybook/main.ts` 当前通过 `../../app/src/**/*.stories.@(...)` 发现 App stories，不得把验收路径写成不存在的 `packages/storybook/**/*.stories.tsx`。
- 运行 `bun --cwd packages/storybook build`，确认 story 可被 Storybook 收集并在 light/dark 主题下可渲染。
- 按 `packages/app/AGENTS.md` 记录 session UI 性能基线，至少复跑 session tab switch/flash benchmark。

### Phase 4：主区 Session 展示归并

前置：G3 通过；分支：`session-list-unify`

1. 默认不新增 `ModeSessionListSection` 大组件；先直接复用 `HomeSessionRow`、`HomeSessionGroupHeader`、`HomeSessionSkeleton` 和 `groupSessions`，只把重复的数据/展示调用点迁到 Phase 1 的 owner。
2. 只有在 Phase 4 的 diff 证明同一段列表结构在至少两个 owner 中完全相同，才允许新增 display-only wrapper；其最小契约只能接收已分组 records、server 信息、打开回调和可选 badge/highlight/new-session callback，不得持有 `useQuery`、`loadSessions`、prefetch、lastActive 或 mode selection。
3. Global Home 的 pinned 区、Work 空态/预设、Assistant 高亮和各页面查询生命周期继续由页面 owner 控制。
4. `buildHomeSessionRecords`、`filterSessionsByMode`、`groupSessions` 作为纯数据 owner 复用，不新增覆盖四种查询生命周期的“大组件”。
5. Work 的三个卡片变体只在 `mode-workspace-slots.tsx` 内抽取 `WorkPresetCard`，不提升为跨页面通用卡片；不抽取 `PanelSectionHeader`。

验收：Coding 预取、Work 空态隐藏、Assistant 高亮、Global Home 置顶/筛选/徽标均保持；受影响测试、unit、typecheck、lint 通过。

### Phase 5：保留显式 SecondarySidebar 分发

本 Phase 不再注册表化。`MODE_SURFACES` 和 `SecondarySidebar` 的职责不同，新增第二个 registry 会制造新的 mode source of truth。

仅执行：

1. 为四种 render-all 分支补 source-contract 测试。
2. 在 `ChatFeatureSidebar` 双实例处保留 ADR-15 解释。
3. 侧栏三种 Session 查询只复用 `sortedRootSessions`/mode filter 纯逻辑，保留 Chat/Work/Assistant 各自的 Location、tab、实体树和加载行为。
4. 不把 `HomeSessionSearch` 用作项目搜索或资产/文件搜索底座。

前置：G3 通过。验收：`secondary-sidebar`、`work-secondary-sidebar`、`assistant-nav-tree` 相关 tests/typecheck/lint 通过。

### Phase 6：测量后清理宽度条件

分支：`mode-width-cleanup`

1. 先在四模式分别记录 desktop/narrow viewport 的 computed `grid-template-columns`、主区 bounding box、容器 overflow、滚动区域和侧栏宽度；记录命令、viewport、浏览器和原始结果，作为 Phase 6 baseline。
2. 只有 baseline 证明 Chat/Work/Coding/Assistant 的可见几何和滚动行为可等价时，才删除 `mode-workspace.tsx` 中重复的 mode 宽度三元分支；若 computed geometry 不同，则保留分支并把本 Phase 结论改为“无安全可删分支”，不得为了源码整洁制造布局回归。
3. 保留当前 `max-w-[1080px]` 和响应式规则，不宣称主列变为 960px；不修改 `MODE_DEFINITIONS` 或 `context/mode.tsx`。
4. 如产品需要真正 960px 主列，停止本 Phase，另开 PRD/视觉变更并重新评审窄屏、Assistant 密度和容器宽度。

#### Phase 6 执行记录（2026-08-17）

命令：`cd packages/app && bunx playwright test --config e2e/performance/playwright.config.ts mode-layout-baseline.spec.ts`

浏览器：Chromium。Viewport：desktop `1440x900`、narrow `640x900`。测量 spec：`packages/app/e2e/performance/mode-layout-baseline.spec.ts`。原始结果中的 `x/y/width/height` 单位均为 CSS px，scroll 值为 `scrollWidth x scrollHeight`：

| Mode      | Viewport | Grid columns  | Workspace box / overflow / scroll             | Sidebar box         | Main box               |
| --------- | -------- | ------------- | --------------------------------------------- | ------------------- | ---------------------- |
| chat      | desktop  | `280px 720px` | `(73,45) 1358x822`, hidden/hidden, `1358x822` | `(236,45) 280x758`  | `(548,45) 720x758`     |
| coding    | desktop  | `280px 720px` | `(73,45) 1358x822`, hidden/hidden, `1358x822` | `(236,45) 280x758`  | `(548,45) 720x758`     |
| work      | desktop  | `280px 720px` | `(73,45) 1358x822`, hidden/hidden, `1358x822` | `(236,45) 280x758`  | `(548,45) 720x758`     |
| assistant | desktop  | `280px 720px` | `(73,45) 1358x822`, hidden/hidden, `1358x822` | `(236,45) 280x758`  | `(548,45) 720x758`     |
| chat      | narrow   | `534px`       | `(73,45) 558x822`, visible/visible, `558x822` | `(85,45) 534x346.5` | `(85,407.5) 534x431.5` |
| coding    | narrow   | `534px`       | `(73,45) 558x822`, visible/visible, `558x822` | `(85,45) 534x116`   | `(85,177) 534x662`     |
| work      | narrow   | `534px`       | `(73,45) 558x822`, visible/visible, `558x822` | `(85,45) 534x93`    | `(85,154) 534x685`     |
| assistant | narrow   | `534px`       | `(73,45) 558x822`, visible/visible, `558x822` | `(85,45) 534x271.5` | `(85,332.5) 534x506.5` |

结论：**无安全可删分支**。desktop 的 computed 主轨虽最终均为 `720px`，narrow 的 sidebar/main 高度和纵向滚动几何随模式明显不同；保留当前条件分支、`max-w-[1080px]` 和响应式规则，不宣称主列为 `960px`。

前置：G3 通过。验收：baseline 与变更后 computed-layout 结果逐项对比；只有全部适用几何保持才允许标记“清理完成”，否则以“分支保留且有证据”完成；typecheck/lint 通过。

### Phase 7：带 options 的新建会话 helper + 文档收尾

前置：G3 通过；分支：`mode-launch-helper`

1. 在 `packages/app/src/pages/layout/helpers.ts` 附近优先扩展已有 `openProjectNewSession` 的回调/option 契约，或新增 `launchModeSession(input)`；不得创建第二套项目打开逻辑。
2. 只有当 helper 真的拥有 `tabs.newDraft` 生命周期时才把 `tabs` 放入 input；否则保持 `projects`/server/directory 的项目打开逻辑与调用方的 `tabs`、`modeDraft`、prompt 组装分离，避免把 UI context 强塞进纯 helper。
3. 需要抽取时，input 至少能表达 `mode`、`projects`、`server`、`directory`，以及可选 `initialPrompt`、可选 `draftOverrides`；普通入口使用默认 `modeDraft(mode)`，Chat seed/import、Work preset/workflow 必须保留原有 agent、presetCategoryId 和 prompt；资产选择器不强行迁移。
4. 审计所有 `tabs.newDraft`/`openProjectNewSession` 调用点，逐一证明 Draft 字段和初始 prompt 未丢失。
5. 更新 ADR-16、`docs/architecture/pages/home.md`、相关 plan 的当前 owner 路径；在 CLAUDE.md 技术债表中记录/销账时保留证据。

#### Phase 7 执行记录（2026-08-17）

- 新增 `launchModeSession` 于 `packages/app/src/pages/layout/helpers.ts`，复用 `openProjectNewSession` 作为唯一项目 open/touch owner；input 表达 `mode`、`projects`、`server`、`directory`，并支持 `initialPrompt` 与 `draftOverrides`。
- 普通 Coding/Chat/Work/Assistant/Home/Titlebar/SecondarySidebar/Legacy redirect 入口已迁移；Chat seed/import 保留初始 prompt，Work workflow/preset 保留 `WORK_ORCHESTRATOR`、`presetCategoryId` 与 prompt。
- 资产选择器保留自己的 `tabs.newDraft` 与资产 prompt 生命周期；session 内无 `ProjectActions.touch` 的命令/归档 fallback 保留直接 `newDraft`，并由 `mode-launch-contract.test.ts` 锁定其 mode/prompt 字段。
- 当前 owner 文档路径已指向 `home-shared.tsx` 与 `coding-project-column.tsx`；未新增第二套项目打开逻辑、API、DB 或 Core 依赖。

验收：逐场景验证普通新建、Chat 新建/导入、Work preset/workflow、Assistant 新建、Coding 新建；unit/typecheck/lint/Playwright 通过。

### Phase 8：Session Permission Tier

不属于本文实施范围。按 [mode-scoped-permission-overlay](mode-scoped-permission-overlay.md) 自身 Gate 执行，且不得与本文任何 Phase 混 PR。

---

## 5. 依赖与执行顺序

```text
Phase 1 (owner extraction)
   └─> Phase 2 (Coding/Location boundary)
Phase 3 (right-panel duplicate mechanisms) ── may run in parallel with Phase 1/2
Phase 4 (main Session presentation) ── G3 passed, consumes Phase 1
Phase 5 (secondary sidebar cleanup) ── G3 passed, after Phase 4 review
Phase 6 (width branch cleanup) ── G3 passed, independent of Phase 4/5
Phase 7 (launch helper + docs) ── G3 passed, after Phase 1
Phase 8 (permission tier) ── independent P0 plan
```

推荐顺序：`1 → 2 → 3 → G3 → 4 → 5 → 6 → 7`。每个 Phase 独立提交，Phase 4-7 在 G3 未通过时必须停止。

---

## 6. 影响范围

| 文件                                                                                  | Phase | 动作                                                                              |
| ------------------------------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------- |
| `packages/app/src/pages/home.tsx`                                                     |     1 | 删除 legacy owner                                                                 |
| `packages/app/src/pages/home-shared.tsx`                                              |     1 | 新建 Home Session 共享 owner                                                      |
| `packages/app/src/pages/coding-project-column.tsx`                                    |     1 | 新建 Coding 项目树 owner                                                          |
| `packages/app/src/pages/layout/helpers.ts`                                            |   1/7 | 类型 owner、启动 helper                                                           |
| `packages/app/src/pages/mode-workspace-slots.tsx`                                     | 1/4/7 | import、展示组件、Work card、启动 options                                         |
| `packages/app/src/pages/assistant-dashboard.tsx`                                      |   1/4 | 共享展示组件                                                                      |
| `packages/app/src/pages/home-overview.tsx`                                            |   1/4 | import、pinned/filter 行为保留                                                    |
| `packages/app/src/components/assistant-nav-tree.test.tsx`                             |     1 | 更新源码契约路径                                                                  |
| `packages/app/src/pages/session/session-side-panel.tsx`                               |     3 | 消费 FileTabStrip                                                                 |
| `packages/app/src/components/chat/chat-right-panel.tsx`                               |   3/7 | 消费 Tab/Diff helper，保留 Chat 语义                                              |
| `packages/app/src/pages/work-artifact-panel.tsx`                                      |   3/4 | 消费默认 fileTree/Diff variant                                                    |
| `packages/app/src/pages/session/assistant-session-panel.tsx`                          |     3 | 消费默认 fileTree                                                                 |
| `packages/app/src/components/secondary-sidebar.tsx`                                   |     5 | 保留显式 render-all，补 contract test                                             |
| `packages/app/src/pages/mode-workspace.tsx`                                           |     6 | 先做 computed-layout baseline；仅在等价时删除宽度分支                             |
| `packages/app/src/pages/session/file-tab-strip.tsx`                                   |     3 | 新建详情页 Tab surface                                                            |
| `packages/app/src/pages/session/text-diff-view.tsx`                                   |     3 | 新建 variant Diff view                                                            |
| `packages/app/src/pages/session/*.test.*`、`packages/app/src/components/*.test.*`     |   1-7 | 近邻行为/契约测试                                                                 |
| `packages/app/src/pages/session/*.stories.tsx` 或 `packages/app/src/**/*.stories.tsx` |   3/4 | 新增 App-local shared UI stories；由 `packages/storybook/.storybook/main.ts` 收集 |
| `packages/storybook/.storybook/main.ts`                                               |   3/4 | 仅在 story 发现路径或 mock 需要变化时修改，不为新增 story 盲目新增第二套配置      |
| `docs/architecture/adr/ADR-16-global-home-overview.md`                                |   1/7 | 更新 Home shared owner 路径                                                       |
| `docs/architecture/pages/home.md`                                                     |   1/7 | 更新当前路由/owner/data flow                                                      |
| `docs/architecture/system-blueprint.md`                                               |   1/7 | 更新代码基线索引                                                                  |

---

## 7. 验收清单

### 架构与复用

- [ ] `home.tsx` 不再是 live owner；Home Session 和 Coding 项目树各有明确 owner。
- [ ] Coding 项目树没有被错误并入三模式 Location 控件。
- [ ] 没有新增第二套 mode registry；render-all 不变量保持。
- [ ] Session 查询生命周期没有被塞进一个通用“大组件”。
- [ ] 搜索按领域保留：Session、项目、资产/文件各自 owner。
- [ ] `MODE_SURFACES` 契约未变；无新 API/DB/core 依赖。

### 行为

- [ ] Phase 1-7 不改变现有产品语义；Phase 6 只有在 baseline 等价时才删除分支，且不改变实际渲染宽度；若不等价，保留分支并记录证据。
- [ ] Coding server/project/sandbox 操作和新建会话回归通过。
- [ ] Chat preview/context/file tabs、Work artifact、Coding review、Assistant entity tabs 回归通过。
- [ ] Global Home 的 all/mode/project filter、lastActive pin、badge 回归通过。
- [ ] Chat seed/import、Work preset/workflow、Assistant 新建 Draft 字段完整保留。

### 工程与 UI

- [ ] 每个 Phase：`bun run script/lint-changed.ts`、受影响 package typecheck、受影响测试。
- [ ] App UI 改动完成桌面/窄屏、键盘焦点、加载/空/错误态、明暗主题和中英文溢出检查。
- [ ] Session/Tab 改动有 benchmark baseline 与结果对比。
- [ ] 新增 App-local shared UI 有 colocated Storybook stories，并通过 `bun --cwd packages/storybook build`。
- [ ] `bash .aigcfroge/skills/protocols/scripts/check-refs.sh`、`git diff --check` 通过。
- [ ] Phase 4-7 的 G3 权限 Gate 已满足，且无跨计划混 PR。

---

## 8. 每 Phase 改完即审模板

```text
复查结论:
- 基线/影响文件:
- 命中 skills:
- 保留的 owner 与复用证据:
- 安全门禁: Catch Everything / No Null Pointer / Security First
- 工程门禁: No Cheating / Reusability / Clean Logs
- UI/性能验证:
- 已运行命令:
- 剩余风险:
- 是否允许进入下一 Phase:
```

---

## 9. 执行前停止条件

执行智能体遇到以下任一情况必须停止并回报，不得自行猜测：

- main 基线中 `home.tsx` 的 live consumer、ModeWorkspace width、Location owner 或 Draft 字段与本文不同；
- 需要改变 Coding 项目树、Assistant scope、Session mode、权限或资产事务；
- 共享组件需要超过本文定义的 slots/variants 才能保持行为；
- G3 权限计划未达到前置合入与最终复审条件；
- 受影响测试、typecheck、lint、Playwright 或 benchmark 失败。

本文只在执行前事实复核、Gate 满足、测试矩阵明确后进入代码施工。
