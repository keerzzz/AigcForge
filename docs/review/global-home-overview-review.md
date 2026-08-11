# Global Home Overview — 验收记录

> 计划：[`docs/plan/global-home-overview.md`](../plan/global-home-overview.md)（§12 有条件通过）
> 分支：`global-home`（基线 `main` e4e93d76f）
> 日期：2026-08-10
> 范围：packages/app + packages/ui（icon.tsx）+ docs；SDK/core/server/DB 零改动

## 1. 提交列表（步骤 → commit）

| 步骤 | commit | 说明 |
|---|---|---|
| 1 | `291b81ac7` | docs: add ADR-16 global home overview |
| 2 | `9c212c8fc` | feat(app): add global home overview i18n keys across 18 locales |
| 3 | `979e42e15` | feat(ui): add home icon |
| 4 | `d4dbd40d3` | feat(app): add home overview model with countByMode and pinLastActive |
| 5 | `ade58ddac` | feat(app): track last active session via sessionPlacement onSet |
| 6 | `1690d4d7a` | feat(app): share openSessionRecord across home and mode pages |
| 7 | `750cd3820` | feat(app): add global home overview page with sidebar and mode badge |
| 8 | `4c0032406` | feat(app): render home overview at / and add titlebar home button |
| 9 | `e4c241fa4` | feat(app): align chat mode grid width with work mode |
| 10a | `8ea2a92b8` | fix(app): make home overview mode filter counts reactive（走查发现：`filters` 需 `createMemo`，否则计数随数据加载不更新；同提交清理 `openSessionRecord` 未用变量 `ctx`） |
| 10b | `a1655a990` | docs: record global home overview acceptance review（本记录 + ARCHITECTURE §4.10 补引 ADR-16） |
| 10c | `0853f34c7` | docs: track global home overview plan and tdd prompt（审批条件 F-1 闭环） |

## 1a. 实施期修订（产品走查反馈，2026-08-10）

| # | 反馈 | 处理 | commit |
|---|---|---|---|
| R-1 | 会话页顶栏出现「主页」（grid-plus toggleHome）与「首页」（新 home 按钮）两个 icon 指向同一地址 | 移除手写新增的 home 按钮，保留既有 toggleHome 作为全局主页入口；`icon.tsx` 的 `home` 条目随之删除（grep 确认无其他引用）；ADR-16 §2 契约同步修订 | 本轮 |
| R-2 | 会话行 hover 背景宽度超过滚动条；首页左右列宽度随内容变化 | 根因：`main`（layout.tsx:42）为 `flex flex-col items-start`，首页 grid 缺 `w-full` → grid 宽度由内容驱动（右列随标题长度/滚动条状态伸缩），行 `w-full` 背景随之超出可视区。修复：`OVERVIEW_GRID` 补 `w-full`（对齐 ModeWorkspace 的 self-stretch + w-full 模式），`minmax(0,1fr)` + 右列 `min-w-0` 保持宽度稳定 | 本轮 |
| R-3 | 首页是否需要新建会话按钮指引 | 需要（首页为全局入口，可能无已打开项目）。空态与首时间分组头复用 `HomeSessionGroupHeader.onNewSession`（与 coding 模式同款），目录解析复用 `newSessionDirectory` 逻辑（选中项目 → lastSession 目录 → 首个项目），draft 模式跟随 `currentMode` | 本轮 |

## 2. 五层 grep 核对（§4 命令输出摘要）

- **L1 UI**：`export function HomeProjectRow`（home.tsx:313，本次新增导出）、`HomeSessionSearch`(:430)、`HomeSessionRow`(:705) 复用对象在位；`CodingSessionListMain.openSession`(:287) 与 `WorkPresetCatalogMain.openWorkSession`(:563) 均改调 `openSessionRecord`（helpers.ts）；`onSet` 签名已扩 `(server, directory, leafID)`（session-placement.ts:9,32）。
- **L2 路由/外壳**：`HomeRedirect` 已删除，`<Route path="/" component={HomeOverview} />`（app.tsx:569）；`layout.tsx:36` `location.pathname !== "/"` 未改（首页天然无 rail）；`titlebar.tsx:284` `route.type === "home"` 处理未改。
- **L3 SDK 只读**：`ProductMode`（types.gen.ts:160）、`Session.mode?`（:182）只读验证，零改动。
- **L4/L5 Core/Server 只读**：`server-sync.tsx` `loadSessions`（:350）未改；无 migration、无 SDK 改动。
- **`sessionPlacement.set` 调用点**：5 处（app.tsx:115、titlebar.tsx:564、submit.ts:406、mode-workspace-slots.tsx:293/568）**零改动**；secondary-sidebar / directory-layout 仅用 `get`/`inherit`。

## 3. 测试与类型

- `bun --cwd packages/app test --preload ./happydom.ts ./src`（首次全量，非 --only-failures）：**736 pass / 0 fail**（含 i18n parity 5 pass、home-overview-model 11 pass、home-overview.test.tsx 存在性断言）。
- `bun --cwd packages/app typecheck`（tsgo -b）：通过。
- `bun typecheck`（全仓 turbo，18 tasks）：通过。
- `bunx oxlint`（本任务 8 个改动文件）：0 warnings / 0 errors。

## 4. 手动验收（dev 双起 backend:4096 + app:4444，浏览器自动化走查）

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | `/` 渲染聚合首页（不再跳 /mode/coding）；刷新停留 | ✅ | localhost:4444/ 渲染 HomeOverview；reload 后 pathname 仍为 `/` |
| 2 | 左列模式筛选计数正确、点击过滤右侧；项目行点击过滤、菜单可管理 | ✅ | 计数 全部3/编程2/对话0/工作1 与数据一致；chat 筛选→空态；项目行含「新建会话/更多选项」菜单；添加项目按钮在位 |
| 3 | 「继续上次」置顶组 | ✅ | 打开会话后回首页：置顶组「继续上次」+ 该会话置顶第一，其余入「最近会话」；未命中/归档分支由单测覆盖（pinLastActive 未命中/归档用例） |
| 4 | 点击会话（含跨模式）→ 会话详情页，次级侧栏匹配模式 | ✅ | 首页点 work 会话 → `/server/…/session/ses_…`；次级侧栏渲染 work「产物」面板，无 mismatch 提示；tab 建立 |
| 5 | 顶栏主页入口：既有 grid-plus（toggleHome）回首页；不新增重复按钮（R-1 修订后） | ✅ | 会话页/模式页 grid-plus 在位（aria-label「主页」），点击回首页 tab；已移除手写 home 按钮，无重复 icon |
| 6 | chat 模式首页不再全宽 | ✅ | /mode/chat 网格 computed max-width 1080px（`max-w-[1080px] lg:grid-cols-[280px_minmax(0,960px)]`） |
| 7 | 会话行模式徽标；搜索跨项目带项目名 | ✅ | 行内「编程」「工作」徽标；搜索 "New session" 结果行带项目名 "aigcfroge" |

走查中发现并修复 1 个实现缺陷（见 §6 偏离/问题）。

## 5. 未决项 / 待审批者代验

- 全部可自动化验收项均已实测；无「待审批者代验」项。
- 旧会话 mode=undefined 的视觉徽标（D3 归 coding）已由单测覆盖（countByMode undefined→coding），未在真实数据中目验（本地 DB 无 undefined-mode 会话）。
- 多 server 聚合（D5）不在本期，未验证跨 server 行为。

## 6. 与计划的偏离点（禁止静默偏离，逐一说明）

1. **HomeProjectRow 需导出**（home.tsx:312→313）：B-1 要求首页复用 `HomeProjectRow`，但其原为文件内私有函数；§5.2 修改清单未列 home.tsx，本次仅追加 `export` 关键字（无行为变化）。
2. **HomeSessionRow 增加可选 `badge?: JSX.Element` prop**：计划 §6.1「行内 SessionModeBadge」无注入位；在共享行组件标题后增加可选插槽（首页传入徽标；coding/work 列表不传，行为不变），避免新增第二份行实现。
3. **`openSessionRecord` 未调用 `ensureServerCtx`**（计划 §6.5 含 `const ctx = input.global.ensureServerCtx(input.conn)`）：所有调用方（coding/work/home）在调用前均已持有并传入 `ctx.projects`，该行成为未使用变量（oxlint warning）；删除后行为逐行一致，计划 A-3 的「以 mode-workspace-slots.tsx:287-305 逐行对照」目标不受影响。
4. **`pinLastActive` 泛型约束放宽**为 `T extends { session: { id: string; directory: string } }`（计划为 `T extends { session: Session }`）：结构最小约束使纯函数测试无需构造完整 Session 对象；`HomeSessionRecord`（session: Session）天然满足，无运行时差异。
5. **`countByMode` 计数口径**：assistant-mode 会话按计划 §6.2 归入 coding 计数，但 `filterSessionsByMode("coding")` 不含 assistant（helpers.ts:42 语义），即「编程」计数可能略高于实际可过滤数；系计划原样实现，建议产品后续评审（§1.3 未决项之外的新观察）。
6. **会话列表计数默认展示 `allRecords`（projectDirectories 已随项目筛选收窄）**：左列选中项目后计数/列表均收窄到该项目，符合直觉。

## 7. 测试数据说明

- 手动验收使用本机 dev 双起（backend:4096 连接 `aigcfroge-local.db`，app:4444），项目种子写入浏览器 localStorage（临时）；为验证跨模式跳转，经 `POST /session` 创建 1 个 work 测试会话，验收后已 `DELETE /session/:id` 清理（DB 复核 0 残留）。
- dev server 已停止（端口 4096/4444 已释放），未触碰用户常驻进程。
