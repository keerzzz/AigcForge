# ADR-16: 全局聚合首页（Global Home Overview）

> 状态：Accepted（2026-08-10，全权 owner 授权 AI 代理 Gate 1+5 签字；见接受记录）
> Date: 2026-08-10
> Amends: [ADR-15 §对齐](ADR-15-mode-workspace-main-area-slot.md)
> 关联：[ADR-12 §2/§4](ADR-12-product-mode-entry-routing.md)（导航控件与 canonical route 契约）、[ADR-13](ADR-13-chat-work-mode-boundary.md)（模式定位表）、[ADR-11](ADR-11-product-mode-session-classification.md)
> 实现计划：[`docs/plan/global-home-overview.md`](../../plan/global-home-overview.md)

## 背景

ADR-15 将 Home 概念迁移为 "ModeWorkspace 在 persisted mode 下的呈现"，`/` 仅作一次性落地点选择（redirect 到 `/mode/<persistedMode>`），并禁止 "Home 自绘伪四区"。该形态解决了模式切换 remount 闪烁，但产生新的产品缺口：

1. **无全局会话入口**：跨模式会话发现只能逐个进入模式首页；chat/work 模式首页主区为资产/预设视图，会话不在主位。
2. **记忆缺失**：`global.lastSession` 只记录最近项目目录，无"最后活跃会话"级记忆，退出时在某个会话中，下次进入无法直达。
3. **入口缺失**：顶栏左侧无全局主页入口，从会话页/模式页回聚合首页无快捷方式。

## 决策

### 1. `/` 恢复为真实页面：全局聚合首页

`/` 不再重定向，渲染**独立路由组件** `HomeOverview`（全局聚合首页）：跨项目会话列表 + 模式筛选 + 项目筛选 + 「继续上次」置顶 + 会话搜索。它**不是** ModeWorkspace slot、**不是** ADR-15 禁止的 "Home 自绘伪四区"：

- 不复制共享 workspace：会话列表/搜索/分组头/项目行**复用** `home-shared.tsx` 导出组件（`HomeSessionRow`/`HomeSessionSearch`/`HomeSessionGroupHeader`/`HomeSessionSkeleton`，原 `home.tsx` 拆除后的共享 Session owner）与 `coding-project-column.tsx`（`HomeProjectRow`，Coding 项目树 owner）；打开会话走共享 `openSessionRecord`（helpers.ts），与 Coding 模式首页行为逐行一致。
- 普通新建会话走 `launchModeSession`（`pages/layout/helpers.ts`），只复用项目 open/touch 生命周期；mode 专属初始 prompt、agent 和 Draft 字段仍由页面 owner 组装。
- 无 slot remount 闪烁：首页为路由级组件，进入/离开 remount 属路由正常语义（同 session/draft 路由），不涉及模式 slot 切换。
- Chat 功能树无重复实例化：`ChatFeatureSidebar` 等模式专属组件仅在 `/mode/:mode` 的 ModeWorkspace 内存在，首页不实例化任何模式专属组件树。

### 2. 顶栏左侧为全局主页入口

V2 顶栏（Titlebar）左侧的既有 home 切换按钮（`grid-plus` icon，`tabs.toggleHome`，指向首页 tab）即为全局主页入口，**不新增独立按钮**——避免出现两个指向 `/` 的重复 icon（实施期修订，2026-08-10：原契约新增 `IconV2 name="home"` 按钮，评审发现与既有 toggleHome 按钮重复后撤销；`home` 图标条目与 i18n key 中除侧栏 aria-label 外不再使用）。

### 3. rail 语义锁定为"模式切换"

全局 icon rail（ModeSwitcher）保持纯模式切换，**不新增按钮**。rail 与 Home 卡片沿用 ADR-12 §2 导航控件契约：点选 navigate 到 `/mode/:mode` 模块入口，不创建/恢复 Session、不选择 Tab、不重分类。

### 4. `/mode/:mode` 为模式首页唯一权威路由

`/mode/:mode` 路由不变，仍渲染共享 ModeWorkspace（ADR-15 契约完整保留）；模式首页（coding 会话列表 / chat 资产工作台 / work 预设 + 会话）继续以 typed slot 承载。首页点击会话跳转 canonical `/server/:serverKey/session/:id`（ADR-12 §4 不变），并按 Session.mode 单向同步 persisted currentMode（ADR-12 §4 "route/work item 为权威，persisted currentMode 单向跟随"）。

### 5. 会话级记忆（lastActiveSession）

`global` 新增 persisted `lastActiveSession`（按 ServerScope 记录 `{ directory, sessionID }`），写入信号为 `sessionPlacement.onSet`（view/send/home 导航均触发）。首页「继续上次」置顶组由 `pinLastActive` 纯函数产出：未命中（归档/不存在）无置顶、不静默丢 rest。

## 对齐

- **ADR-12 §2**：rail/Home 卡片为导航控件契约**不变**；顶栏主页入口由既有 home 切换按钮（toggleHome → 首页 tab）承载，导航目标是 `/`（独立路由），不改变模式入口导航语义。
- **ADR-12 §4 + ADR-15**：canonical session/draft 路由不变；`/mode/:mode` 仍为模式首页唯一权威路由；persisted `currentMode` 单向跟随权威来源。首页为 `mode === undefined` 的历史会话显示 coding 徽标（D3，与 `filterSessionsByMode` 语义一致），点击跳转不强制改当前模式（避免与 ADR-12 §4 单向同步冲突）。
- **ADR-13 模式定位表**：首页聚合只读会话/项目数据，不改变各模式核心对象与职责边界；无新 DB migration、无 SDK/后端改动。
- **ADR-15 §1/§3**：typed slot 机制与 "No Mode may copy the shared workspace" 均保留；首页只复用导出组件，不复制 workspace 结构。

## 结果

### 正向影响

- 跨模式会话有统一发现入口，模式首页回归纯模式职责（coding=会话列表、chat=资产、work=预设+会话）。
- 「最后活跃会话」记忆直达，减少重复导航。
- 顶栏全局主页入口符合 desktop 应用导航惯例，rail 语义清晰。

### 代价

- `/` 从 redirect 改为真实页面，用户首次进入落在聚合首页而非上次模式首页（presentation-default 语义变更，产品已确认）。
- 多 server 聚合本期按当前 server（focusedServer）收敛，跨 server 合并为后续项（计划 D5）。

## 明确不决定

- 任务列表/定时列表/助手统计等首页区块（后续开闸，以首页区块或独立 slot 扩展，对齐 ADR-15 typed slot 范式）。
- 会话列表 icon 与项目 icon 的 "C" 差异问题（另立议题）。
- 多 server 聚合的跨 server records 合并（D5 后续项）。

## 接受条件

1. 首页复用 home-shared.tsx/coding-project-column.tsx 导出组件与共享 `openSessionRecord`，无第二实现（计划红线 1；`home.tsx` 已按 `mode-page-unification-v2.md` Phase 1 拆除为 `home-shared.tsx` + `coding-project-column.tsx`）。
2. SDK/core/server/DB 零改动（计划 §3 分层表）。
3. i18n 新增 key 全语言补齐，parity 测试绿。
4. `ARCHITECTURE.md` §4.10 Decisions 补引本 ADR。

## 接受记录（2026-08-10）

### 评审轨迹

- **初审**（owner agent 代审）：对照 ADR-12 §2/§4、ADR-15 §对齐、ADR-13 模式定位表逐条核验 —— 导航控件契约不变、canonical route 不变、typed slot 机制保留、无模式专属组件在首页重复实例化。计划 §12 审批记录（2026-08-10）已锁定 A 类修正（A-1/A-2/A-3）与 B 类决策（B-1/B-2/B-3）。
- **复审**（owner agent）：A-2 测试命令修正核对通过；A-3 `openSessionRecord` 显式 `conn` 参数以 mode-workspace-slots.tsx:287-305 逐行对照迁移，行为不变。
- **实施期修订**（2026-08-10，产品走查反馈）：①撤销 §2 新增顶栏 home 按钮（与既有 toggleHome 按钮重复指向 `/`，保留既有按钮）；②首页网格补 `w-full`（`main` 为 `flex-col items-start`，缺宽时 grid 宽度由内容驱动 → 左右列随标题长度/滚动条变化、行 hover 背景超出滚动条）；③首页空态与首分组头新增「新建会话」按钮指引（复用 `HomeSessionGroupHeader.onNewSession`，与 coding 模式同款）。

### Gate 核对

| Gate | 状态 | 证据 | 签字 |
|---|---|---|---|
| 1. ADR 一致 | PASS | Amends ADR-15 §对齐；对齐 ADR-12 §2/§4、ADR-13 定位表；不冲突 ADR-11（不编 mode 进 Session URL）| Core owner ✓ |
| 2. 框架契约 Core 评审 | PASS | 首页为独立路由组件（非 slot）；记忆为显式持久化（onSet 信号，不依赖 time.updated）；SDK/DB 零改动 | Core owner ✓ |
| 3. 安全评审 | PASS | 无新 migration；无新网络/权限面；复用现有 sessionPlacement 持久化通道 | Security ✓ |
| 4. 指标/埋点 | N/A | 本 ADR 不涉及指标 | - |
| 5. App 评审 | PASS | 复用 home-shared.tsx/coding-project-column.tsx 导出组件 + 共享 openSessionRecord；组件测试对齐 mode-workspace.test.tsx 存在性断言风格 | App owner ✓ |

### 签字

**全权 owner 授权 AI 代理签字**（2026-08-10）：Gate 1+5 证据齐全，文档层 ACCEPT。

> 注：本签字由用户（全权 owner）授权 AI 代行，非真人 owner 手签。如需真人 owner 复核，可在上表签字列追加签字行。

## 实现参考

[`docs/plan/global-home-overview.md`](../../plan/global-home-overview.md)（步骤 1–10，含 §12 审批约束）。
