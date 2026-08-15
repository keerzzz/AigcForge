# 4 模式页面归一化收尾执行提示词

> 对应计划：[mode-page-unification-v2.md](mode-page-unification-v2.md)
> 基线：`main` / `origin/main`，提交 `a4b0485aa435f7aaa957f796758fb5baeb077fa8`
> 生成日期：2026-08-15
> 用途：复制 `PROMPT START` 与 `PROMPT END` 之间的正文到新的执行对话。

<!-- PROMPT START -->

你是 AigcForge 仓库（`/media/win_data/aigcfroge`）的高级全栈工程师。你要执行
`docs/plan/mode-page-unification-v2.md`，但必须严格遵守该计划的 Gate、停止条件和仓库协议。
本任务是 App UI/架构归并，不是四模式业务语义重写。

## 0. 开工门禁

开始前执行并记录：

```bash
pwd
git branch --show-current
git status --short --branch
git log -1 --format='%H %ad %s' --date=iso main
git log -1 --format='%H %ad %s' --date=iso origin/main
```

基线必须仍为 `main`/`origin/main` 的 `a4b0485aa435f7aaa957f796758fb5baeb077fa8`。
不要切换、覆盖或回滚用户已有修改；如果工作树有脏改动，先隔离本任务文件。
每个 Phase 使用不超过三个短词、无 slash 的分支名，并独立提交；不要 push、不要开 PR，
除非用户另行批准。

测试不能从仓库根目录运行。App 测试从 `packages/app` 执行，其他包同理。
禁止 `git reset --hard`、`git checkout --`、`--no-verify`、`as any`、`@ts-ignore` 和
为了通过测试而复制生产逻辑。

## 1. 写代码前必须精读

按顺序读取：

```text
CLAUDE.md
AGENTS.md
ARCHITECTURE.md
CONTEXT.md
DESIGN.md
packages/app/AGENTS.md
.aigcfroge/skills/protocols/SKILL.md
.aigcfroge/skills/enterprise-code-standard/SKILL.md
.aigcfroge/skills/reuse-first-refactor/SKILL.md
.aigcfroge/skills/quality-to-pr/SKILL.md
.aigcfroge/skills/frontend-theming/SKILL.md
docs/plan/mode-page-unification-v2.md
docs/plan/mode-scoped-permission-overlay.md
docs/architecture/adr/ADR-11-product-mode-session-classification.md
docs/architecture/adr/ADR-12-product-mode-entry-routing.md
docs/architecture/adr/ADR-15-mode-workspace-main-area-slot.md
docs/architecture/adr/ADR-16-global-home-overview.md
docs/architecture/pages/home.md
docs/architecture/system-blueprint.md
```

然后读取本 Phase 的 owner、调用方、近邻测试和对应 Git 历史。新增 UI 组件前必须先查
Coding mode/现有 App owner；新增 helper 前必须留下复用候选、兼容性和拒绝理由。

## 2. 已确认事实，禁止重新臆测

### Owner 边界

- `ModeWorkspace` 和 `SecondarySidebar` 保持 render-all + `display:none`，不得改为
  `Dynamic`、keyed branch 或会导致模式切换 remount 的方案。
- Coding 的 `HomeProjectColumn` 负责 server/project/sandbox、多项目选择、项目操作、
  通知和 Coding 新建会话；不得替换成 `ModeLocationNewSession`。
- Work 与 Assistant 当前消费 `ModeLocationNewSession`。
- Chat 当前不是 `ModeLocationNewSession` 的消费者。`ChatFeatureSidebar` 自己拥有
  Location 行、新建/添加项目逻辑，并同时拥有 Chat feature tree/counts。不要在计划或报告中
  写“Chat/Work/Assistant 已统一 Location”。如果修改 Chat，必须证明 feature tree、计数、
  seed、新建和目录注册行为没有变化，并补测试。
- Assistant `global|project` scope 不在本任务实现。

### 共享范围

- `buildHomeSessionRecords`、`filterSessionsByMode`、`groupSessions` 是纯数据/分组能力，
  可以复用；每个页面自己的查询、prefetch、lastActive、mode filter、实体高亮、空态和
  preset/workflow 生命周期必须留在页面 owner。
- Session 搜索、Coding 项目搜索、Chat 资产/文件搜索是三个不同领域，不要合成一个搜索组件。
- Chat/Coding 的文件 Tab 只共享拖拽/列表机制；leading tab、preview/context/review、
  active fallback、文件树和业务内容继续由各自 owner 提供。
- Diff 可共享行计算/结构，但必须用 variant 保留 Chat 与 Work 的视觉和密度。
- 不新增第二套 mode registry；`MODE_SURFACES` 契约不变。

### 宽度与 Storybook

- `mode-workspace.tsx` 当前存在 Chat/Work `960px` 与 Coding/Assistant `720px` 的 track
  条件。不能仅凭 `max-w-[1080px]` 推断最终 computed width。
- Phase 6 必须先测量四模式 desktop/narrow 的 computed grid track、主区 bounding box、
  overflow、滚动区域和侧栏宽度。只有证明确实等价才可删条件；不等价就保留分支并记录
  “无安全可删分支”，不得为了源码整洁制造 UI 回归，也不得宣称实现 960px 主列。
- `packages/storybook/.storybook/main.ts` 当前收集：
  `../../ui/src/**/*.stories.*`、`../../session-ui/src/**/*.stories.*` 和
  `../../app/src/**/*.stories.*`。App-local shared UI stories 应 colocate 在
  `packages/app/src/**/*.stories.tsx`，然后通过 `bun --cwd packages/storybook build`
  验证；不要把 story 写到不存在的 `packages/storybook/**/*.stories.tsx` 目录。

## 3. Gate

### G1 Owner

Phase 1 可以迁移 `home.tsx` 的共享 Session 构件和 Coding 项目 owner。
Phase 2 必须明确记录 Coding、Work/Assistant、Chat 三种真实 owner，不得通过源码注释
伪造统一状态。

### G2 Width

Phase 6 以 computed-layout baseline 为真源。产品若要求实际 960px 主列，停止本计划该
Phase，另开 PRD/视觉变更，重新评审窄屏、Assistant 密度、滚动和容器宽度。

### G3 Permission

`docs/plan/mode-scoped-permission-overlay.md` 是独立 P0 计划。Phase 1-3 可以在它等待
期间执行；Phase 4-7 必须等权限计划前置提交已经合入 `main` 并完成最终复审。
两个计划不得进入同一 PR。无法证明 G3 时，立即停止并报告。

### G4 Human confirmation

计划里的工程结论不是 owner 人类签字。不要把“待执行审批”写成“已批准”。
每个 Phase 完成后输出复查结论并停下，等待用户批准下一 Phase。

## 4. 实施顺序

推荐顺序：`Phase 1 -> Phase 2 -> Phase 3 -> G3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7`。
Phase 3 可以与 Phase 1/2 并行，但不能共享未验证的半成品 owner。

### Phase 1：拆除 `home.tsx`

分支：`home-shared-extract`

目标：

- 新建 `packages/app/src/pages/home-shared.tsx`，迁移 Home Session 类型、纯数据函数、
  搜索/分组/行/骨架屏/相关常量。
- 新建 `packages/app/src/pages/coding-project-column.tsx`，迁移
  `HomeProjectColumn` 及其 server/project 行组件，明确它是 Coding owner。
- 更新 `mode-workspace-slots.tsx`、`assistant-dashboard.tsx`、`home-overview.tsx`、
  `pages/layout/helpers.ts` 和读取 `home.tsx` 源码的测试。
- 同步 ADR-16、`docs/architecture/pages/home.md`、`docs/architecture/system-blueprint.md`
  和仍描述当前 owner 的计划文档。历史记录可以保留历史路径，但当前 owner 表不能漂移。

红/绿/重构要求：

1. 先为新 owner/import/source-contract 写最小红测试。
2. 最小迁移使测试变绿；不顺手重命名所有历史符号。
3. `HomeSessionRecord` 的类型 owner 与 `openSessionRecord` 的调用方向必须保持清楚，
   不产生循环 import。

验收：

```bash
rg -n 'from "@/pages/home"|pages/home.tsx|read\("../pages/home.tsx"' \
  packages/app/src packages/app/e2e
bun --cwd packages/app run test:unit
bun --cwd packages/app typecheck
bun run script/lint-changed.ts
```

### Phase 2：锁定 Coding/Location owner

分支：`location-owner-boundary`

目标：

- 保留 Coding 项目树，确认 server/project/sandbox 操作和新建会话。
- 确认 Work/Assistant 仍使用 `ModeLocationNewSession`。
- 确认 Chat 仍由 `ChatFeatureSidebar` 持有 Location + feature tree/counts；除非能证明
  行为等价，否则不要把 Chat 改成 `ModeLocationNewSession`。
- 增加 source-contract 和浏览器回归，测试应断言真实 owner，而不是理想化架构。

必须回归：

- Coding server 切换、项目切换、多选注册、关闭/编辑项目、新建会话。
- Chat Location、feature tree/counts、添加项目、普通新建、seed/import。
- Work/Assistant Location 和普通新建。

### Phase 3：归并详情页真实重复机制

分支：`right-panel-shell-merge`

只共享：

- `SessionFileTabStrip`：DragDrop surface、`SortableProvider`、`SortableTab`、
  `DragOverlay`、`createFileTabListSync` 和拖拽状态。
- `TextDiffView`：old/new text + `variant: "chat" | "work"`，保留现有边框、背景、
  颜色、行高、滚动和加减号结构。
- `SessionRightPanel` 的默认 fileTree（只在 `fileTree` 未传入时），Coding changes/all
  tree 与 Chat `.aigcfroge` tree 仍显式传入。
- 参数化 Tab 回写 helper，必须包含 `enabled`、`activeTab`、`fallbackTab`、`setActive`，
  不得把 Chat/Work tab 集合写死。

不能共享：

- Chat preview/context/asset apply；
- Coding review/diff tree/open file；
- Work artifact/context/preset；
- Assistant entity tabs；
- Chat/Coding/Work/Assistant 的查询或权限状态。

验收测试必须覆盖：

- 拖拽排序、Context 打开/关闭、Coding review、Chat preview、Work artifact、
  Assistant tabs、默认 fileTree 和窄屏。
- `session-right-panel`、`session-file-tree`、`work-artifact-panel`、
  `chat/asset-workbench` 近邻测试。
- 新增 `packages/app/src/**/*.stories.tsx` stories，并运行：

```bash
bun --cwd packages/app run test:unit
bun --cwd packages/app typecheck
bun run script/lint-changed.ts
bun --cwd packages/storybook build
bun --cwd packages/app run test:bench
```

基准必须来自 `packages/app/e2e/performance` 的现有 session tab switch/flash 场景，
串行运行，不添加机器相关硬阈值。

### Phase 4：主区 Session 展示

前置：G3 通过。

- 默认直接复用 `HomeSessionRow`、`HomeSessionGroupHeader`、`HomeSessionSkeleton`、
  `groupSessions`，不要先创建 `ModeSessionListSection`。
- 只有 diff 证明至少两个 owner 的 JSX 结构完全一致时，才允许 display-only wrapper；
  wrapper 不能持有 `useQuery`、`loadSessions`、prefetch、lastActive 或 mode selection。
- Global Home 的 pinned/filter/badge、Work 空态和 preset/workflow、Assistant entity
  highlight、Coding prefetch 继续由页面 owner 控制。
- Work preset card 留在 `mode-workspace-slots.tsx`，不提升成跨模式 card。

### Phase 5：保留显式 SecondarySidebar 分发

前置：G3 通过。

- 不新增第二个 mode registry。
- 为四种 render-all 分支补 source-contract；保留 ChatFeatureSidebar 双实例的 ADR-15
  解释。
- 只复用 `sortedRootSessions`/mode filter 的纯逻辑；保留 Chat/Work/Assistant 各自的
  Location、tab、实体树和加载行为。
- 不把 `HomeSessionSearch` 当项目搜索或资产/文件搜索底座。

### Phase 6：测量后清理宽度条件

前置：G3 通过。分支：`mode-width-cleanup`

1. 先记录四模式 desktop/narrow computed grid track、主区 bounding box、overflow、
   scroll geometry、侧栏宽度。
2. 只有所有适用 geometry 和滚动行为等价时，才删除宽度三元分支。
3. 若不同，保留分支并在报告中给出原始 baseline 和原因。
4. 不修改 `MODE_DEFINITIONS` 或 `context/mode.tsx`。

### Phase 7：带 options 的新建会话 helper

前置：G3 通过。分支：`mode-launch-helper`

- 优先扩展 `openProjectNewSession` 的回调/option 契约，不创建第二套项目打开逻辑。
- 只有 helper 真正拥有 `tabs.newDraft` 生命周期时才把 `tabs` 放入 input；否则保持
  project open 与调用方的 tabs/modeDraft/prompt 组装分离。
- 必须保留普通入口、Chat seed/import、Work preset/workflow 的 agent、
  `presetCategoryId` 和初始 prompt。资产选择器不强行迁移。
- 审计全部 `tabs.newDraft`/`openProjectNewSession` 调用点，逐一证明 Draft 字段不丢失。
- 更新当前 owner 文档路径；不重写无关历史计划。

## 5. 每 Phase 的 TDD 与交付循环

每个 Phase 必须完整执行：

```text
1. 读取本 Phase owner、调用方、近邻测试、协议和计划小节
2. 建立 reuse table：candidate / evidence / compatibility / decision / reason
3. 先写最小红测试并运行确认失败
4. 写最小实现使测试变绿
5. 重构重复逻辑，保持测试绿；不扩张范围
6. 运行受影响包 test、typecheck、lint；UI 运行 Playwright/Storybook/benchmark
7. 运行 check-refs.sh、git diff --check，重读变更和调用链
8. 输出“复查结论”，提交该 Phase，停止等待审批
```

命令规则：

- App 单元测试：`bun --cwd packages/app run test:unit`
- App 类型检查：`bun --cwd packages/app typecheck`
- App E2E：`bun --cwd packages/app run test:e2e <受影响 spec>`
- App 性能：`bun --cwd packages/app run test:bench`，只在 `packages/app` 执行
- Storybook：`bun --cwd packages/storybook build`
- 增量 lint：`bun run script/lint-changed.ts`
- 协议引用：`bash .aigcfroge/skills/protocols/scripts/check-refs.sh`
- 差异检查：`git diff --check`

## 6. 必须停止并报告的情况

- `main` 中的 live consumer、Location owner、Draft 字段或宽度事实与计划不符；
- 需要改变 Coding 项目树、Assistant scope、Session mode、权限、资产事务、路由、API、
  DB 或 core；
- 共享组件需要超过计划定义的 slots/variants 才能保持行为；
- G3 未满足；
- 单元测试、typecheck、lint、Playwright、Storybook build 或 benchmark 失败；
- 只能靠 `as any`、忽略错误、任意 sleep/timeout、假 mock 或跳过 hook 才能继续。

遇到停止条件，报告已读文件、证据、失败命令、已尝试方案和需要的 owner 决策，不要自行
猜测或跨 Gate 施工。

## 7. 完成报告模板

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

| 项 | 值 |
|---|---|
| 复制范围 | `PROMPT START` 到 `PROMPT END` |
| 计划真源 | `docs/plan/mode-page-unification-v2.md` |
| 基线 | `main` / `origin/main` @ `a4b0485aa` |
| 阶段节奏 | 每 Phase 独立分支/提交，报告后停下等审批 |
| 权限 Gate | Phase 4-7 需要权限计划先合入 `main` 并完成复审 |
| UI 验证 | App unit/typecheck/lint + 受影响 Playwright + Storybook build + 适用 benchmark |
