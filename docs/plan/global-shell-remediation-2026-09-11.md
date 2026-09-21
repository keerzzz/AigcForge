# 全局壳顶部、底部与左侧导航修复 TDD 实施计划

> **状态**：IMPLEMENTED（2026-09-11）；代码与自动化用例已落地，最终五 project/性能门禁结果见 §13。
> **Owner**：App + UI
> **实施范围**：`packages/app` + `packages/ui` 的最小 Dialog/Popover 关闭生命周期契约；不扩散至其他包。
> **实施基线**：`origin/main` / `HEAD` = `ac334d85395f8c980683f7c799231db1b1ad9583`。
> **当前分支**：`global-shell-e2e`（符合最多三词、连字符、无类型前缀的分支规范）。
> **事实来源**：[`docs/review/global-shell-e2e-2026-09-10.md`](../review/global-shell-e2e-2026-09-10.md)、[`docs/technical-debt.md`](../technical-debt.md)。
> **协议依据**：[`CLAUDE.md`](../../CLAUDE.md)、[`AGENTS.md`](../../AGENTS.md)、[`DESIGN.md`](../../DESIGN.md)、[`ARCHITECTURE.md`](../../ARCHITECTURE.md)、[`packages/app/AGENTS.md`](../../packages/app/AGENTS.md)。
> **架构依据**：[`ADR-09`](../architecture/adr/ADR-09-mode-route-decoupling.md)、[`ADR-12`](../architecture/adr/ADR-12-product-mode-entry-routing.md)、[`ADR-14`](../architecture/adr/ADR-14-persistence-and-scope-strategy.md)、[`ADR-15`](../architecture/adr/ADR-15-mode-workspace-main-area-slot.md)、[`ADR-16`](../architecture/adr/ADR-16-global-home-overview.md)、[`mode-module-switching-completion.md`](mode-module-switching-completion.md)、[`global-home-overview.md`](global-home-overview.md)。
> **实施原则**：识别假设 → 追溯本源 → 重构方案 → 精简输出；复用 → 删除 → 归并 → 重构 → 新增。
> **TDD 规则**：每个 Slice 必须独立完成 RED → GREEN → REFACTOR → 包级门禁 → 数据流复查；当前 Slice 未绿不得进入下一 Slice。

---

## 0. 审批摘要

### 0.1 本计划解决什么

本计划收敛审计报告中与全局壳顶部、底部和左侧导航直接相关的已确认缺陷及产品改造项：

| ID      | 问题                                        | 等级      | 根因归属                                                              | 本计划出口 |
| ------- | ------------------------------------------- | --------- | --------------------------------------------------------------------- | ---------- |
| TOP-01  | 关闭后台标签会强制切换当前页面              | P2        | `TabsProvider.removeTab()` 不区分活动/后台标签                        | Slice 1    |
| TOP-02  | 脏 Draft 点击顶部 X 可能先删除、后确认      | P1 候选   | 关闭副作用先于 Dirty 确认；dirty 还是全局布尔值                       | Slice 1    |
| TOP-03  | 正式 Session 标签关闭按钮缺少一致 a11y 语义 | P3        | Draft/Session 标签关闭入口未归一                                      | Slice 1    |
| TOP-04  | `tab.close` 顶层/子标签所有权容易回归       | 工程债    | 顶层与 Session 子标签命令边界需继续钉住                               | Slice 1    |
| BOT-01  | 状态栏 “Open context tab” 是死按钮          | P2        | 状态栏自行重建 SessionStateKey，未复用 Session 页面权威 Layout handle | Slice 2    |
| BOT-02  | 非 Session 页面显示 `— — 0 —` 等会话伪指标  | P2        | 全局状态源没有区分连接态和 Session 态                                 | Slice 2    |
| BOT-03  | pinned metrics 直接写裸 `localStorage`      | P2 技术债 | 绕过 `Persist`/platform 存储边界                                      | Slice 2    |
| BOT-04  | 子代理统计由 message 启发式推断             | P2 技术债 | 未消费 delegation 的真实状态源                                        | Slice 2    |
| BOT-05  | 状态栏弹窗固定锚在整条状态栏                | 产品改造  | Popover 未传入本次点击位置的 `getAnchorRect`                          | Slice 3    |
| BOT-06  | DebugBar、Help、StatusBar 同占右下区域      | P2 技术债 | 三种不同层级没有空间与门禁隔离                                        | Slice 3    |
| LEFT-01 | 首页左侧顺序为“模式 → 项目”                 | 产品改造  | 信息架构顺序与工作上下文优先心智不一致                                | Slice 4    |
| LEFT-02 | 首页“新建会话”主入口随分组/空态变化         | 产品改造  | CTA 绑定在结果组，不是页面稳定操作                                    | Slice 4    |
| LEFT-03 | Chat Session 左栏的项目/功能/会话归属不稳定 | 产品改造  | 三块内容平铺且滚动、折叠、持久化边界不明确                            | Slice 5    |
| LEFT-04 | 左侧切换可能破坏既有 Mode 生命周期不变量    | 回归风险  | 改布局时容易误改 ADR-15 render-all 机制                               | Slice 5/6  |

### 0.2 根因收敛

不按按钮逐个打补丁，按四个共享根因修复：

1. **关闭事务缺失**：标签删除、持久化清理、导航和 Dirty 确认没有统一先后顺序。
2. **Session Layout 权威漂移**：状态栏从 server/directory 参数重新计算 key，Session 页面则使用 `useServerSDK().scope + useSDK().directory`。
3. **Router Shell 与 server scope 混淆**：顶层标签身份、leaf Session Layout 身份、连接状态、Session 指标和目标 server scope 没有由同一条已解析路由事实显式贡献。
4. **壳层状态未分型**：连接状态、Session 指标、开发诊断和帮助浮层被当成同一底部区域处理。
5. **导航语义未按层分开呈现**：全局 Mode 导航、首页模式筛选、Session 次级侧栏虽已有不同数据状态，但视觉结构和验收边界未完整落实。

### 0.3 已核验的现状，禁止重复造轮子

- 首页筛选已经是 `HomeOverview.state.modeFilter`，**不是** `ModeProvider.currentMode`；本计划只修视觉顺序、计数组合和新建 resolver，不新建首页筛选 Store。
- `MODE_DEFINITIONS` 已是 ModeSwitcher、ModeRoute、surface slot 的单一注册表；不得复制五模式常量。
- `ModeWorkspace` 已使用 render-all + `display:none`，隐藏 slot 通过 `ModeSlotActiveProvider/whenActive` 门控；不得改回 `Dynamic` remount。
- `openSessionContext()` 已被 timeline 的 “View context usage” 正常路径验证；状态栏必须复用它，不能另写打开 Context 的逻辑。
- `Popover` 把 Kobalte root props透传，Kobalte 已支持 `getAnchorRect`、`flip`、`slide`、`fitViewport` 和 `overflowPadding`；不得自建定位引擎。
- `Persist.global(..., legacy)` 已支持从裸 localStorage legacy key 迁移；不得新增状态栏 storage helper。
- `launchModeSessionOrRoute()` 已统一 generic mode 与 Custom 专属路由边界；首页和左栏新建入口必须复用。
- delegation 的真实列表链路已存在于 `AgentTaskHub`；状态栏不得继续用 assistant message 猜测，也不得复制一套独立轮询。

---

## 1. 审批前必须确认的裁决

本计划按以下决策编写。Owner 审批即表示接受；如有一项不接受，应先改计划再实施。

### D1. 标签关闭采用“请求关闭 → 确认 → 提交关闭”两阶段事务

- 关闭后台标签：只删除目标标签；若它恰好是 `recent`，只重选右 → 左有效邻居或清空 `recent`，绝不导航。
- 关闭 route-active 标签：提交关闭后按右侧 → 左侧 → `/` 选择后继，并把 `recent` 指向后继。
- Dirty 目标：Stay、Escape、overlay、Dialog 被替换均按取消处理，零副作用；Leave 后才删除标签、清内存/持久化并导航。
- 正式 Session 关闭只关闭视图，不删除服务端 Session。
- `removeTab()` 产生一次性 focus handoff；Titlebar 作为 DOM Owner 在后继标签渲染后聚焦。唯一标签关闭后聚焦 Home 控件，后台关闭和 Stay 不改变焦点。

**拒绝方案**：继续让 `removeTab(index)` 先删除，再依赖 Dirty Guard 路由回跳。该方案无法保证 Stay 恢复 Prompt、tab memory、URL 和持久化。

### D2. Dirty 与活动标签按 canonical 顶层 Tab identity 管理

实施后统一复用 `tabKey()`，但明确区分两个身份层级：

```text
Draft 顶层关闭/Dirty identity       -> draft:<draftID>
Session 顶层关闭/Dirty identity     -> server + placement.rootID
Session Layout contribution identity -> server + route leafID + scope + directory
```

- Session route 的 `params.id` 可以是 child/leaf，禁止用它猜顶层标签；已解析 placement 的 route Owner 必须贡献 `activeTopLevelTabKey`。
- `SessionPage` 与 `NewSessionPage` 以 `usePrompt().dirty()` 为唯一事实源，按顶层 key 登记；卸载只清本 Owner 的登记。
- 顶部关闭、`mod+w` 与 `useBeforeLeave` 都读取同一个 key，不读取当前页面的全局布尔值。
- active 判定只看 Router Shell 的 canonical route contribution，不比较完整 href。当前 `pathname + search + hash` 仅用于“后台关闭不得改变 URL”的保真断言；`?insert` 和 `#message-*` 不改变顶层身份。

### D3. 新增一个非持久化 Router Shell route contribution Owner

不得把目标 Session contribution 注册进当前 selected-server 的 `LayoutProvider`。新增最窄的 `RouteContributionProvider`（建议文件 `packages/app/src/context/route-contribution.tsx`），在 Router root 内包住 `DirtyDraftGuard`、`TabsProvider`、`Layout` 和 route children：

```ts
type RouteContribution = {
  routeIdentity: string
  activeTopLevelTabKey?: string
  session?: {
    key: SessionStateKey
    server: ServerConnection.Key
    scope: ServerScope
    directory: string
    leafID: string
    openContext: () => void
  }
}
```

- `register(value)` 返回带 registration token 的 disposer；旧 route cleanup 不得清除新 route contribution。
- Session route 将已解析 placement（含 `rootID`）作为 props 下传至目标 `ServerSDKProvider`/`SDKProvider` 子树；由同一个最深 Session Owner 原子注册完整 contribution（root tab key、leaf ID、scope、directory、`SessionStateKey` 与现有 `openSessionContext()` 闭包），禁止 placement Owner 和 Session Page 双注册/last-writer-wins。
- Draft route 只贡献 draft 顶层 key，不伪造 Session Layout。
- `current()` 必须与当前 canonical route identity 匹配；Home/Mode/离开 route 后返回 `undefined`。
- 这是瞬时 Router Shell 协调信息，不写 Persist，不复制 model/messages/delegation 数据，也不改变 server-scoped `LayoutProvider` 的所有权。

### D4. 非 Session 页面底部只保留连接信息

- Home、Mode、Draft：只显示有意义的连接状态；本批不新增 Draft 指标。
- Session：模型、真实可用的 pinned metrics、Context 和标题按 contribution 出现。
- 不用 `—` 或 `0` 冒充不可用数据；布局稳定通过固定容器尺寸和条件渲染完成。

### D5. 子代理指标本批先删除错误推断，不复制 AgentTaskHub 请求

本批删除 message-agent 启发式统计和对应可用指标。只有实施时证明 AgentTaskHub 已暴露可直接复用的共享 delegation resource，才可接入真实状态；否则登记“共享 delegation projection”技术债后结束，不允许为了保住三个数字重复发请求。

### D6. Help 占位删除；Debug 与 Popover 关闭契约归一

- 删除 `HelpButton` 的 Layout 挂载和仅此用途的占位文件。
- `DebugBar` 继续由 `import.meta.env.DEV` 门禁并移到状态栏上方；生产构建用 production-build smoke 证明不存在。
- `packages/ui` 为确定的最小改动范围：Dialog replacement 必须调用一次关闭回调；Popover 新增默认保持兼容的 outside-close focus policy。App 显式请求 Escape/outside 后恢复原 trigger，trigger 已卸载时安全跳过。

### D7. 首页保持 ADR-16 全局聚合语义

- `/` 保持独立全局 Home，继续隐藏 ModeSwitcher；筛选不导航 `/mode/:mode`，不建立平行 ModeWorkspace Owner。
- 左侧顺序改为“项目 → 模式筛选”；创建/打开继续复用共享链路。
- Home 只保留一个 `openNewSession()` Owner，并把同一 action 传给固定 CTA、空态、分组标题和项目行。
- resolver 明确为 `modeFilter === "all" ? mode.currentMode : modeFilter`；Custom 走 Builder，其余走 `launchModeSessionOrRoute()`。
- 本计划不修订 ADR-16。

### D8. Chat Session 左栏只重排既有能力，不建立平行 Sidebar

继续使用 `SecondarySidebar`、`ChatFeatureSidebar`、`ChatSessionList` 和既有项目树。三区只是可访问区块壳、折叠状态及独立滚动边界：

- Session Sidebar 跨 route 可以卸载；恢复由 `Persist` 保证，不错误套用 ADR-15 的 ModeWorkspace no-remount 约束。
- Chat 区以 route contribution 的目标 `scope + directory` keyed 挂载；只有 active Chat Session 才创建 Persist/resource。
- `ChatFeatureSidebar`/`ChatSessionList` 必须位于显式 active gate 下；隐藏 Mode 不得读写 storage 或发 network/SDK 请求。

## 2. 范围与非目标

### 2.1 本计划内

- 顶部多标签关闭、Dirty 关闭前确认、关闭按钮 a11y、`tab.close` 回归。
- 状态栏 Context 操作、Session/非 Session 展示边界、pinned metrics 持久化。
- 状态栏点击虚拟锚点、碰撞处理、焦点恢复。
- Debug/Help/StatusBar 层级隔离。
- 首页项目/模式筛选顺序及固定新建 CTA。
- Chat Session 左栏项目/功能/会话三区的折叠、滚动和持久化。
- 相关单测、Playwright、性能基线、文档和技术债回写。

### 2.2 明确非目标

以下均来自同一审计报告，但不与本批全局壳根因共享，禁止顺手扩 scope：

- “添加项目”可视化文件夹浏览器及 desktop IPC/server 枚举能力。
- 项目颜色编辑异常复现与修复。
- 新建会话页水印、权限档位、Agent 选择器、Git 分支/worktree 展示和 Mode 切换原子重算。
- 首页切 Mode 后 `Cannot connect to API` 的专项链路调查。
- Chat 资产行详情、跨资产搜索泄漏、14 次重复请求、虚拟化、插件稳定 identity、空态文案。
- ConnectionGate desktop 主进程测试挂点。
- 真实链路三个 404 和 Solid ownerless warning 专项。
- Core/schema/server/SDK/DB/API 变更。
- 新增任意字符串 Mode、修改 Custom 创建契约或 Session URL 编码。

### 2.3 架构影响判断

- 不改持久数据 Schema、HTTP API、SDK 和 Session V2 协议。
- 不改变 ADR-09/12/14/15/16 的已接受决策。
- 不新增 ADR。若实现中发现必须引入跨包公开 Shell Contribution 协议，停止该 Slice，先补 ADR 并重新审批。

---

## 3. 复用与删除清单

| 候选                                  | 证据/现有 Owner                                  | 决策                                 | 禁止事项                             |
| ------------------------------------- | ------------------------------------------------ | ------------------------------------ | ------------------------------------ |
| `TabsProvider`                        | 顶层标签 Store、recent、memory、持久化清理均在此 | 扩展为关闭事务唯一 Owner             | Titlebar 自己算后继标签              |
| `tabKey/tabHref/currentRoute`         | 已定义 canonical 标签/路由 identity              | 复用活动判断                         | 按对象引用或 pathname 子串判断       |
| `usePrompt().dirty()`                 | Prompt 真实 dirty 事实源                         | Session/Draft 按 tabKey 登记         | 读取 DOM 文本猜 dirty                |
| `DirtyDraftGuard` 文案与 Dialog       | 已有 Stay/Leave i18n 和 Dialog                   | 抽取共享确认动作；保留非标签路由兜底 | 再造第二套确认文案                   |
| `useSessionLayout/openSessionContext` | timeline 正常工作的 Context 路径                 | Session contribution 直接闭包复用    | 状态栏重建 SessionStateKey           |
| `Persist/persisted`                   | app/desktop 统一存储与 legacy 迁移               | 迁移 pinned metrics、左栏折叠        | 裸 localStorage                      |
| `Popover + Kobalte getAnchorRect`     | 已支持虚拟 rect、flip、slide                     | 直接透传点击 rect                    | 手写 absolute 定位/碰撞算法          |
| `MODE_DEFINITIONS`                    | 五模式 registry                                  | 继续唯一真源                         | 手写五项数组                         |
| `HomeOverview.state`                  | modeFilter/projectFilter 已独立                  | 保留并调整布局                       | 新建 home mode context               |
| `launchModeSessionOrRoute`            | generic/Custom 新建边界                          | 所有首页/左栏入口复用                | 直接 `tabs.newDraft()` 绕过 resolver |
| `SecondarySidebar`                    | Session 左栏唯一壳                               | 在原组件内分区                       | 新建 Chat 专属平行壳                 |
| `HelpButton`                          | 仅 Layout 使用，内容是占位                       | 删除                                 | 保留 Lorem ipsum 隐藏债务            |

---

## 4. Slice 0：冻结基线与补 RED 证据

### 4.1 入口条件与工作区保护

- 本计划已审批。
- 先记录并保留当前三个未跟踪交付物：本计划、原始审计和 `global-shell.spec.ts`；不得覆盖审计复现事实。
- 当前分支只做本地实施和验证；commit、push、PR 仍需 Owner 另行明确授权。
- 文本权限统一为 `0644`；不重启或杀掉用户已有 app/server 进程。

### 4.2 基线动作

1. 记录 `git status --short --untracked-files=all`、`git ls-files --others --exclude-standard`、`git rev-parse HEAD`、`git rev-parse origin/main`。
2. 先确认当前壳 spec 的既有基线，固定单 worker、无 retry：

```bash
bun --cwd packages/app test:e2e -- e2e/regression/global-shell.spec.ts \
  --project=chromium --workers=1 --retries=0
```

3. `AIGCFROGE_PERFORMANCE_TRACE_DIR=/tmp/aigcfroge-global-shell-baseline bun --cwd packages/app test:bench` 采集现有 production-build Session tab benchmark；前后在同机串行运行并保存原始 `BENCHMARK` 与 Chrome trace，不把机器相关数字设成硬阈值。
4. 五 Mode remount/网络副作用通过确定性 E2E 计数建立基线；Chat Sidebar 仅采集 trace/long-task 相对数据，不宣称 `test:bench` 已覆盖不存在的场景。
5. 截图/展示矩阵分别保留 desktop/light/en、dark、zh、zht、narrow；不得在 locale/narrow spec 中调用 `pinEnglishUI` 或 `pinDesktopViewport`。

### 4.3 RED 用例与证据格式

先写失败断言，不先改生产代码。英文文案/desktop geometry 用例可留在 `global-shell.spec.ts`；locale-independent、narrow 与 production-build 用例拆到不覆盖 project 初始状态的 spec：

- TOP-01：看 C，关闭后台 A，完整 `pathname + search + hash`、标题和焦点仍为 C；Home/Mode 分别关闭 recent/non-recent 只维护 recent，不导航。
- TOP-02：脏 Draft 点 X，Stay/Escape/overlay 后 tab、URL、Prompt、Persist 均保留；Leave 后才关闭；同 key 合并、不同 key 串行。
- TOP-02 child：child Session route 的 dirty key 映射到 root 顶层标签；root/child/另一 child 快切不串 key。
- BOT-01：canonical、legacy、child Session 的状态栏 Context 与 timeline 操作同一个 Context tab。
- BOT-02：Home/Mode/Draft 不显示 Session metrics 和 Context。
- BOT-05：Popover 左/中/右点击锚点、键盘 fallback、Escape/outside focus restore、trigger 卸载安全跳过。
- LEFT-01：项目 DOM/Tab 顺序先于模式筛选，筛选不导航。
- LEFT-03：三区标题、独立折叠、New Session 归属、低高度滚动、跨 server/workspace 恢复、隐藏区无副作用。

RED 命令固定为：

```bash
bun --cwd packages/app test:e2e -- e2e/regression/global-shell.spec.ts \
  --project=chromium --workers=1 --retries=0
bun --cwd packages/app test:e2e -- e2e/regression/global-shell-presentation.spec.ts \
  --project=chromium-zh --project=chromium-zht --project=chromium-narrow \
  --workers=1 --retries=0
```

每个 RED 记录：审计 ID、失败测试全名、断言 diff、为何是目标行为缺失。selector、fixture、mock、冷编译或 timeout 失败必须先修测试，不计 RED。生产改动后用完全相同命令转 GREEN。

### 4.4 退出门禁

- 既有基线结果已记录，不把当前 10/10 GREEN 误称为新行为的 RED。
- TOP-01、TOP-02、BOT-01、BOT-02、BOT-05、LEFT-01、LEFT-03 均有稳定、可重复的目标行为 RED。
- presentation/production 额外用例有各自明确命令，不被全局 English/desktop 初始化覆盖。

**建议提交**：`test(app): capture global shell regressions`

## 5. Slice 1：顶部标签关闭事务与 Dirty 边界

### 5.1 生产改动

#### A. `packages/app/src/context/chat-workspace.tsx`

将全局布尔 dirty 收敛为按 canonical 顶层 `tabKey` 的登记和**全局串行**确认服务：

```ts
type DirtyRegistry = {
  set: (key: string, value: boolean, token: symbol) => void
  has: (key: string) => boolean
  clear: (key: string, token?: symbol) => void
  confirmLeave: (key: string) => Promise<boolean>
}
```

执行契约：

1. clean key 立即返回 `true`。
2. 同 key 同一时间只创建一个请求，所有调用者共享同一 Promise。
3. 不同 key 进入 FIFO；任何时刻最多一个 Dirty Dialog，禁止 `dialog.show()` 替换未决确认。
4. Leave 清 key 后 resolve `true`；Stay、Escape、overlay、Dialog replaced、Provider unmount 均 resolve `false`。
5. 每个请求只 settle 一次；队列推进和 Tabs `closing` 都在 `finally` 释放，Promise 不得悬挂。
6. 最小修改 `packages/ui/src/context/dialog.tsx`：`show()` dispose 旧 Dialog 前按一次取消语义执行旧 `onClose`，normal close/replacement 均不重复回调。

`DirtyDraftGuard` 改为 Router `useBeforeLeave`：dirty 时同步 `preventDefault()`，确认 Leave 后调用该事件的 `retry(true)`；取消则不 retry。它不再监听已变化的 pathname，也不导航回跳。顶部关闭和 route leave 复用确认服务，但各自只提交自己的事务，关闭触发的 navigate 使用 force/bypass token，禁止同一次导航再次消费 Dirty。

#### B. `packages/app/src/app.tsx`、Session/Draft route 与页面

- placement 已解析后把 `rootID` 下传给最深 Session Owner；该 Owner 原子注册 `activeTopLevelTabKey = tabKey({server, sessionId: rootID})` 与 Session contribution。Session Page 禁止直接用 leaf `params.id`，外层 route Owner 不单独注册第二份 contribution。
- Draft route 注册自己的 `draft:<draftID>` key。
- `SessionPage`/`NewSessionPage` 在 `prompt.ready()` 后用 `usePrompt().dirty()` + registration token 登记；cleanup 只删除自身 token，旧页面 cleanup 不能清新页面同 key。
- child/root/另一 child 切换时，顶层 dirty identity 保持 root key；Session Layout identity 仍使用当前 leaf key。

#### C. `packages/app/src/context/tabs.tsx`

`removeTab(index)` 保持唯一公共关闭入口并返回可观察的关闭结果：

```text
requestClose(index)
  -> 快照 tabKey
  -> closing 去重
  -> dirty.confirmLeave(key)
  -> false: cancelled，零副作用
  -> true: commitRemove(key, routeContribution.activeTopLevelTabKey)
  -> { removedKey, routeActive, successorKey?, home }
```

`commitRemove` 规则：

1. await 后按 key 重新定位，防止 index 漂移。
2. route-active 只取 Router Shell contribution；不得从 leaf URL 猜 root，也不得比较带 `?insert`/hash 的完整 href。
3. route-background 永不 navigate，当前 URL 原样保持；若目标是 `recent`，只按右 → 左有效邻居更新或清空 recent。
4. route-active 先快照右/左后继，再删除、清 memory/Draft Persist；更新 recent；force navigate 右 → 左 → `/`。
5. 正式 Session 不调用 server delete/archive。
6. `removeSessions()` 与 `removeTab()` 复用相同 active/recent/后继纯函数，避免归档路径保留第二套算法。
7. destructive action 已确认后的 bypass 只有 RED 证明需要才增加带原因的窄 API，不预设通用 `force`。

#### D. `packages/app/src/components/titlebar.tsx`

- X 和 `mod+w` 只调用统一关闭 API；Session/Draft 按钮统一 `common.closeTab`、Tooltip、focus ring 和命中区。
- Titlebar 保存 `tabKey -> HTMLElement` refs，消费一次性 focus handoff：活动关闭聚焦后继；唯一标签聚焦 Home 控件；后继未渲染/加载失败时落到稳定 titlebar 导航控件。
- Stay、Escape、overlay 和后台关闭不改变当前焦点。

### 5.2 单元/组件 RED → GREEN

覆盖：活动右/左/Home；background 无导航；route-active 与 recent 独立；Home/Mode 关闭 recent/non-recent；await 后 index 漂移；same-key coalesce；different-key FIFO；Stay/Escape/overlay/replaced/unmount 都 settle false；cleanup token 隔离；`removeSessions()` 共用决策；focus handoff 成功和 fallback。

### 5.3 E2E GREEN

- A/B/C active/background 矩阵及 URL `pathname + search + hash` 保真。
- Home/Mode 关闭 recent/non-recent 不导航。
- Dirty X 与 browser back/Home/Mode：Stay、Leave、Escape、overlay；不会弹两次。
- child Session：root 顶层关闭、dirty Stay/Leave、child Context、child→root/另一 child 快切。
- Context 子标签打开时 `mod+w` 先关子标签；无子标签时关顶层。
- 活动关闭焦点交接、唯一标签 Home fallback、后台/Stay 焦点不动。

### 5.4 退出门禁

```bash
bun --cwd packages/ui test --timeout 30000
bun --cwd packages/ui typecheck
bun --cwd packages/app test:unit:file -- ./src/context/tabs.test.ts ./src/context/chat-workspace.test.ts
bun --cwd packages/app typecheck
bun --cwd packages/app test:e2e -- e2e/regression/global-shell.spec.ts e2e/regression/tab-close-owner.spec.ts --project=chromium --workers=1 --retries=0
```

**建议提交**：`fix(app): make tab closing transactional`

## 6. Slice 2：底部状态源与 Session Layout 权威归一

### 6.1 生产改动

#### A. Router Shell contribution，不修改 Layout Store 所有权

实现 D3 的 `RouteContributionProvider`，在 Router root、`TabsProvider` 和 App Layout 共同可见的位置挂载。它是非持久化、server-agnostic 的瞬时 owner：

- `register(value)` 返回 token-aware disposer；A cleanup 不得清 B。
- `current()` 校验 contribution 的 `routeIdentity` 与当前 canonical Router identity。
- canonical Session 的目标子树新增目标 server-scoped `LayoutProvider`，位置在目标 `ServerSDKProvider` 内、`TargetSessionPage`/`SessionProviders` 外；因此 `useSessionLayout()`、`layout.tabs()`、`layout.view()` 的持久化 Owner 与目标 `scope/directory` 一致，不再解析到 selected-server 的 AppLayout。
- placement `rootID` 下传到这个目标 Layout 子树；同一个最深 Session Owner 一次性注册完整 contribution（root tab key + leaf Layout key + openContext），不允许两个完整对象 registration。
- 顶层 tab key 使用 placement `rootID`；Context/Layout 使用当前 `leafID`，禁止混用。
- `openContext` 必须闭包复用 timeline 已验证的 `openSessionContext({ layout, tabs, view })` 对象链；不复制 Session Layout 状态。

若实现发现这个 Router Shell contribution 必须成为跨包公开协议，停止 Slice，先补 ADR 并重新审批。

#### B. `current-session-source.ts` 与状态栏类型

- 删除 `ServerScope.fromServerKey`、placement lookup、`SessionRouteKey.fromRoute`、`SessionStateKey.from`、directory base64 等二次推导。
- `openContext` 仅调用匹配 route 的 contribution；缺失或 stale 时不渲染按钮。
- source 分成永远可用的 connection，以及仅 Session route 可用的 label/model/真实 metrics/context。
- 无数据不渲染 `—/0` 占位；删除 message-agent 启发式 subagent 类型和三项指标。只有现成共享 delegation resource 可直接消费时才允许接入。

#### C. pinned metrics Persist 迁移

使用 `Persist.global("status-bar.pinned-metrics", ["aigcfroge:pinned_metrics"])` 与 target `migrate` 归一：非数组/非字符串回默认、未知 ID 过滤、去重、最多 20。Desktop 异步 storage 必须等 `ready()` 后才开放写操作。迁移沿用现有 Persist 语义：归一值交给 current storage 后清 legacy；若底层同步 storage 写失败并进入 fallback，legacy 仍可能被删除，这是现有通用边界，本 Slice 不承诺事务性迁移，也不为单一状态栏修改通用 Persist。

### 6.2 单元 RED → GREEN

- contribution：原子单注册、route identity、root/leaf 分层、目标 LayoutProvider 跨 server 隔离、旧 disposer 不清新注册、A→B 快切、route 离开后 unavailable。
- current source：Home/Mode/Draft 只有 connection；Session contribution 匹配/失配；canonical/legacy/child Context 同一 tab store。
- pinned metrics：sync/desktop async ready、legacy 迁移、非法值、未知 ID、去重、20 上限、storage failure 使用 Persist 现有 fallback；不断言失败时保留 legacy。

### 6.3 E2E GREEN

- canonical、legacy、child、跨 server Session 的状态栏 Context 打开真实 Context tab；与 timeline 交替操作同一 store。
- Home、五 Mode、Draft 无 Session label/metrics/Context；Session 无数据时无伪指标。
- 刷新恢复 pinned metrics；legacy 自动迁移；异步恢复期间用户不能写入并被旧值反向覆盖。

### 6.4 退出门禁

```bash
bun --cwd packages/app test:unit:file -- ./src/context/route-contribution.test.ts ./src/components/status-bar/current-session-source.test.ts ./src/components/status-bar/pinned-metrics.test.ts
bun --cwd packages/app typecheck
bun --cwd packages/app test:e2e -- e2e/regression/global-shell.spec.ts --project=chromium --workers=1 --retries=0
```

**建议提交**：`fix(app): unify status bar session state`

## 7. Slice 3：底部虚拟锚点与浮层隔离

### 7.1 状态栏 Popover 与共享 close-focus policy

修改 App 状态栏：pointer 激活时冻结本次 `clientX/clientY` 的零尺寸 AnchorRect；Enter/Space 清 pointer rect 并回退到 trigger rect。向现有 Kobalte 透传 `getAnchorRect`、`flip`、`slide`、`fitViewport`、`overflowPadding`，依赖 Floating UI auto-update，除非 RED 证明缺失，否则不手写 resize 定位器。

最小修改 `packages/ui/src/components/popover.tsx`：新增默认兼容的 close-focus policy/content callback。App 显式选择 Escape 和 outside click 均恢复原 trigger；trigger 已卸载/不可聚焦时安全跳过并落到稳定状态栏 trigger。Context 按钮阻止 metrics Popover，保持独立动作。

### 7.2 Debug/Help/StatusBar 隔离

- `pages/layout.tsx` 删除 Help mount；StatusBar 保持文档流底部 band；DebugBar 仅 DEV 挂开发诊断槽。
- 删除唯一用途的 `help-button.tsx`，不留 Lorem ipsum 或注释占位。
- Debug offset 使用现有 spacing/token/safe-area，跨过状态栏且不拦截左/中/右点击。

### 7.3 自动化 GREEN

- mouse 左/中/右、最左/最右/narrow、移动鼠标后锚点冻结、resize 碰撞均有效。
- keyboard、Escape、outside 恢复焦点；trigger 卸载安全跳过。
- dev E2E 证明 Debug 与 Status/Popover 不重叠；production-build smoke 通过性能 Playwright 配置的 build+serve 环境证明无 DebugBar。
- 无 Lorem ipsum、无 Help 占位。

### 7.4 退出门禁

```bash
bun --cwd packages/ui test --timeout 30000
bun --cwd packages/ui typecheck
bun --cwd packages/app typecheck
bun --cwd packages/app test:e2e -- e2e/regression/global-shell.spec.ts --project=chromium --workers=1 --retries=0
bun --cwd packages/app test:e2e --config e2e/performance/playwright.config.ts e2e/performance/global-shell-production.test.ts --project=chromium --workers=1 --retries=0
```

production smoke 文件必须遵守性能目录协议：仅断言 build 场景完成和 DebugBar 缺失，不增加机器阈值，保留原始产物。

**建议提交**：`fix(app): anchor status popovers to clicks`

## 8. Slice 4：首页左侧信息架构与固定新建入口

### 8.1 单一 Home action Owner

在 `home-overview.tsx` 内只保留一个 `openNewSession()`，把同一 action 传给固定 header CTA、空态、分组标题和项目行，删除现存重复 resolver。它继续复用项目选择逻辑与 `launchModeSessionOrRoute()`：

1. 有选中项目用该 worktree；无选中项目但有项目用现有 current/recent project；无项目走既有可操作错误/项目入口，不静默 return。
2. `resolvedMode = modeFilter === "all" ? mode.currentMode : modeFilter`。
3. Custom 导航 Builder；generic mode 创建相应 Draft；不新增 `lastNewSessionMode` 状态。
4. Home 筛选保持 `/`、不导航、不创建 Draft，符合 ADR-16 的独立全局聚合 owner。

### 8.2 项目优先信息架构

真实 DOM 从“模式 → 项目”改为“项目 → 模式”，使视觉、屏幕阅读器和 Tab 顺序一致，不用 CSS `order`。项目选择不清 modeFilter，模式选择不清 projectFilter；mode count 以当前项目过滤后的 records 计算，项目 count 仍以 mode 过滤前集合计算；全部项目才聚合全部记录，五 Mode 顺序继续由 `MODE_DEFINITIONS` 驱动。

### 8.3 RED → GREEN 与门禁

- model/unit：项目 × mode 组合、全部项目、零计数、Custom resolver。
- E2E：DOM/Tab 顺序、筛选组合/计数、六筛选与空/非空均见固定 CTA、所有入口调用同一 action、generic/Custom/all resolver、Home 无 ModeSwitcher 且 URL 不变。

```bash
bun --cwd packages/app test:unit:file -- ./src/pages/home-overview-model.test.ts
bun --cwd packages/app typecheck
bun --cwd packages/app test:e2e -- e2e/regression/global-shell.spec.ts e2e/regression/home-mode-ownership.spec.ts --project=chromium --workers=1 --retries=0
```

**建议提交**：`fix(app): stabilize home navigation actions`

## 9. Slice 5：Chat Session 左栏三区归一

### 9.1 结构：重排既有能力，不复制数据源

在现有 `SecondarySidebar` 内构造三个可访问 section：Project、Feature、Session。每区为 heading/collapse button + 折叠摘要 + 独立 scroll viewport；Session heading 固定包含 New Session，折叠只隐藏列表。继续复用现有项目树、`ChatFeatureSidebar`、`ChatSessionList`，不创建 Chat 平行壳。

### 9.2 动态 scope 与 Persist Owner

外层 Sidebar 不能从 selected-server `useServerSDK()` 猜目标 Session scope。它从 D3 route contribution 读取 canonical server、目标 `scope + directory`，仅在 `route.type === session && mode.currentMode === "chat"` 时，以 `${scope}\0${directory}` keyed 挂载 `ChatSidebarStateOwner`：

```ts
Persist.serverWorkspace(scope, directory, "sidebar.secondary.chat-sections")
// { project: boolean, feature: boolean, session: boolean }
```

- keyed Owner 销毁旧 persisted target 后再创建新 target；A→B→A 不允许旧异步 storage 回写 B。
- `ready()` 前折叠按钮 disabled/只读，禁止用户写入被恢复值覆盖；storage failure 使用默认三块展开并保持 UI 可用。
- 旧 `sidebar.secondary.projectCollapsed` 继续只负责项目树行，不混入三区状态。
- `ChatFeatureSidebar` 和 `ChatSessionList` 置于显式 active gate；inactive 时不创建 Persist/resource、不发 network/SDK。离开 Session route 后 Sidebar 可以卸载，返回时依赖 Persist 恢复。
- ADR-15 no-remount 只验证 `ModeWorkspace`，不要求 Session `SecondarySidebar` 跨路由常驻。

### 9.3 交互与 a11y

真实 button 提供 i18n name、`aria-expanded`、`aria-controls`、Enter/Space、统一 focus ring/chevron/motion。折叠 Project 仍可看到当前项目和切换入口；Feature 保留资产摘要；Session 保留摘要和 New Session。低高度时标题/New Session 可达，滚动条不跨区。

### 9.4 测试与退出门禁

- 真实 DOM 组件测试：三区顺序、ARIA、keyboard、折叠摘要/New Session、ready 前不可写、失败 fallback。
- E2E：跨 server、A→B→A、两窗口、refresh、storage failure；Session→Mode→Session 通过 Persist 恢复而非 no-remount；隐藏 Chat 区 network/SDK/storage 计数为零。
- ADR-15 的五 Mode no-remount 仍仅由既有 `mode-surface-wiring`/fallback spec 钉住。

```bash
bun --cwd packages/app test:unit:file -- ./src/components/secondary-sidebar.test.ts
bun --cwd packages/app typecheck
bun --cwd packages/app test:e2e -- e2e/regression/global-shell.spec.ts e2e/regression/mode-surface-wiring.spec.ts e2e/regression/mode-slot-fallback-a11y.spec.ts --project=chromium --workers=1 --retries=0
```

**建议提交**：`fix(app): structure chat session sidebar`

## 10. Slice 6：全量验证、差异审查与文档闭环

### 10.1 包级与目标行为门禁

不得在仓库根运行 `bun test`，不得直接调用 `tsc`：

```bash
bun --cwd packages/ui test --timeout 30000
bun --cwd packages/ui typecheck
bun --cwd packages/app test --timeout 30000
bun --cwd packages/app test:unit:file -- ./src/i18n/parity.test.ts
bun --cwd packages/app typecheck
bun --cwd packages/app test:e2e -- e2e/regression/global-shell.spec.ts e2e/regression/tab-close-owner.spec.ts e2e/regression/home-mode-ownership.spec.ts e2e/regression/mode-surface-wiring.spec.ts e2e/regression/mode-slot-fallback-a11y.spec.ts --project=chromium --workers=1 --retries=0
```

目标行为全绿后执行 Linux CI 同构的完整五 project（不指定 spec，运行所有非性能 E2E）：

```bash
bun --cwd packages/app test:e2e:local \
  --project=chromium \
  --project=chromium-dark \
  --project=chromium-zh \
  --project=chromium-zht \
  --project=chromium-narrow
```

维护态 locale 为 `en/zh/zht` parity，其余 locale 使用英文 fallback；不得写“18 locale parity”。英文文案 spec 才 `pinEnglishUI`，locale-independent/narrow spec 保留 project 的真实 locale/viewport。

### 10.2 Production 与性能门禁

```bash
AIGCFROGE_PERFORMANCE_TRACE_DIR=/tmp/aigcfroge-global-shell-final bun --cwd packages/app test:bench
bun --cwd packages/app test:e2e --config e2e/performance/playwright.config.ts e2e/performance/global-shell-production.test.ts --project=chromium --workers=1 --retries=0
```

- benchmark 前后同机串行，保留原始 `BENCHMARK`/trace；自动化只断言场景完成和指标采集，不设 10%、50ms 等机器相关阈值。
- 现有 Session tab benchmark 做前后对比；异常由 Owner 查看原始证据决定，不伪造绿色数字。
- Mode remount/网络请求采用确定性 E2E 计数。Sidebar 本批没有既有 benchmark 场景，不设置性能放行项；只允许在手工 Chrome Performance trace 中记录观察值，不把它宣称为自动 Gate。
- production smoke 证明 DebugBar 缺失和壳可用。

### 10.3 UI/a11y 手动矩阵

| 维度           | 必测值                                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| Route          | Home、五 Mode、Draft、canonical/legacy/child/cross-server Session              |
| Viewport/theme | desktop、390×844、低高度；light/dark                                           |
| Locale/input   | en、zh、zht 长文案；mouse、keyboard-only                                       |
| Data           | loading、empty、无指标、offline/reconnecting、storage failure                  |
| Tab            | active/background/recent/non-recent、single/multiple、clean/dirty、search/hash |
| Popover        | 左/中/右、边缘、resize、Escape、outside、trigger unmount                       |
| Sidebar        | 三区、refresh、server/workspace/route 往返、两窗口                             |

可自动化的 focus/ARIA/DOM 顺序不能只靠手工矩阵放行；手工只补视觉溢出和碰撞证据。

### 10.4 变更集、lint 与协议门禁

未跟踪文件不受普通 `git diff --check` 覆盖，必须先清点：

```bash
git status --short --untracked-files=all
git ls-files --others --exclude-standard
git diff --check
LINT_BASE_REF=origin/main bun run script/lint-changed.ts
bun run lint
bash .aigcfroge/skills/protocols/scripts/check-refs.sh
bun typecheck
```

三份初始未跟踪文件均属于本任务交付候选：计划、原始审计、`global-shell.spec.ts`。未获 commit 授权时不暂存；获授权后只能 `git add <精确路径...>`，禁止 `git add .`，再执行：

```bash
git diff --cached --check
git diff --cached --stat
git diff --cached
```

人工搜索确认：无状态栏 `SessionStateKey.from` 二次推导、无 legacy pinned key 生产写入、无 message-agent 指标、无 Help/Lorem、无 Mode 手写数组、无隐藏 slot 无门控 effect、无非英文新增代码注释。

### 10.5 文档闭环

- 原始审计逐 ID 追加 CLOSED/DEFERRED、实际 commit（如有）和测试证据，不改原始复现事实。
- `docs/technical-debt.md` 关闭已解决项；若无共享 delegation projection，登记延后项。
- `docs/architecture/pages/sidebar.md` 更新三区、dynamic scope、Persist ready 与 active gate。
- `docs/architecture/pages/mode-switcher.md` 只在行为事实变化时更新；ADR-15/16 正常不修订。
- 本计划状态更新为 Implemented，记录实际 SHA、完整 Gate 结果和残余风险。

**建议提交**：`docs: close global shell remediation`

## 11. 文件级实施清单

### 11.1 生产文件

| 文件                                                                           | 动作                                                           | Slice |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----- |
| `packages/app/src/app.tsx`                                                     | Router Shell provider；rootID 下传；目标 server LayoutProvider | 1/2   |
| `packages/app/src/context/route-contribution.tsx`                              | 新增瞬时 route contribution/token lifecycle                    | 1/2/5 |
| `packages/app/src/context/chat-workspace.tsx`                                  | keyed Dirty、FIFO 确认、`useBeforeLeave`                       | 1     |
| `packages/app/src/context/tabs.tsx`                                            | 两阶段关闭、active/recent/后继共享决策                         | 1     |
| `packages/app/src/pages/session.tsx`、`new-session.tsx`                        | Prompt dirty token；Session Layout contribution                | 1/2   |
| `packages/app/src/components/titlebar.tsx`                                     | a11y、DOM refs、focus handoff                                  | 1     |
| `packages/ui/src/context/dialog.tsx`                                           | replacement 触发一次取消回调                                   | 1     |
| `packages/app/src/components/status-bar/current-session-source.ts`、`types.ts` | 删除 key 猜测/伪指标；Persist                                  | 2     |
| `packages/app/src/components/status-bar/status-bar.tsx`                        | 条件展示、virtual anchor                                       | 2/3   |
| `packages/ui/src/components/popover.tsx`                                       | 可控 close-focus policy                                        | 3     |
| `packages/app/src/pages/layout.tsx`、`debug-bar.tsx`                           | Help/Debug/Status 分层                                         | 3     |
| `packages/app/src/components/help-button.tsx`                                  | 删除                                                           | 3     |
| `packages/app/src/pages/home-overview.tsx`、`home-overview-model.ts`           | 单一 action、项目优先、组合计数                                | 4     |
| `packages/app/src/components/secondary-sidebar.tsx`                            | 三区、keyed Persist owner、active gate                         | 5     |
| `packages/app/src/i18n/{en,zh,zht}.ts`                                         | 新可见文案 parity；其他 locale fallback                        | 1/4/5 |

`packages/app/src/context/layout.tsx` 默认不新增 contribution API；`app.tsx` 复用现有 `LayoutProvider` 在目标 Session server 子树建立正确持久化 Owner，同时保留 selected-server AppLayout 的原有 Owner。

### 11.2 测试文件

| 文件                                                                    | 覆盖                                     |
| ----------------------------------------------------------------------- | ---------------------------------------- |
| `packages/app/src/context/chat-workspace.test.ts`                       | FIFO/settlement/`useBeforeLeave`         |
| `packages/app/src/context/tabs.test.ts`                                 | active/recent/后继/关闭事务              |
| `packages/app/src/context/route-contribution.test.ts`                   | root/leaf/cross-server/token lifecycle   |
| `packages/app/src/components/status-bar/current-session-source.test.ts` | Session/非 Session/Context               |
| `packages/app/src/components/status-bar/pinned-metrics.test.ts`         | async ready/migrate/failure              |
| `packages/app/src/pages/home-overview-model.test.ts`                    | 项目 × Mode 组合/创建 resolver           |
| `packages/app/src/components/secondary-sidebar.test.ts`                 | 真实 DOM/ARIA/keyed Persist              |
| `packages/app/src/i18n/parity.test.ts`                                  | en/zh/zht parity                         |
| `packages/app/e2e/regression/global-shell.spec.ts`                      | 英文 desktop 顶部/底部主链路             |
| `packages/app/e2e/regression/global-shell-presentation.spec.ts`         | locale-independent/narrow/中文           |
| `packages/app/e2e/performance/global-shell-production.test.ts`          | production build Debug smoke             |
| 既有 owner/mode E2E                                                     | `mod+w`、Home、ADR-15 no-remount/no-wire |
| `packages/ui` Dialog/Popover 测试                                       | replacement settlement、focus policy     |

### 11.3 禁止改动

不改 SDK 生成文件、migration、schema、server route；不新建 Mode 注册表、平行 Chat Sidebar、第二套 Layout store 或独立网络轮询。

---

## 12. 验收清单

### 顶部

- [ ] root/child Session 顶层 identity、leaf Layout identity 明确且不串用。
- [ ] 后台关闭 URL（含 search/hash）和焦点不变；关闭 recent 仅修复 recent，不导航。
- [ ] route-active 关闭按右 → 左 → Home，焦点交给后继或稳定 Home fallback。
- [ ] Dirty Stay/Escape/overlay/replacement/unmount 零副作用且 Promise 必完成；Leave 后才提交。
- [ ] 同 key 合并、不同 key FIFO；route guard 与 close 不重复确认。
- [ ] `mod+w` 子标签优先；Session 关闭不删服务端数据；X 有一致可访问名称。

### 底部

- [ ] contribution 来自目标 route/server，旧 disposer 不清新值；不污染 selected-server Layout。
- [ ] canonical/legacy/child/cross-server Context 与 timeline 操作同一 store。
- [ ] Home/Mode/Draft 仅连接信息；无 Session 伪指标或启发式子代理统计。
- [ ] pinned metrics 等 Persist ready、迁移/失败边界正确。
- [ ] Popover virtual anchor/碰撞/resize/keyboard/outside/Escape/focus restore 通过。
- [ ] production 无 Debug；Debug/Status 不重叠；Help 占位已删除。

### 左侧

- [ ] Home DOM/Tab 顺序为项目 → 模式 → 结果；组合筛选和项目化计数正确。
- [ ] 单一创建 action 覆盖固定 CTA/空态/分组/项目行；all/generic/Custom resolver 正确。
- [ ] Home 保持 ADR-16 独立聚合语义，筛选不导航、不创建 Draft。
- [ ] Chat 三区顺序、独立滚动、折叠摘要/New Session、ARIA/keyboard 正确。
- [ ] dynamic scope 在跨 server、A→B→A、两窗口、failure 下恢复正确；ready 前不写。
- [ ] Session Sidebar 通过 Persist 跨 route 恢复；ADR-15 no-remount 只约束 ModeWorkspace。
- [ ] inactive Chat 区不发 network/SDK、不读写 Persist。

### 工程门禁

- [ ] App/UI 单测、typecheck、目标 E2E、production smoke 全绿。
- [ ] en/zh/zht、dark、narrow、keyboard 五 project 门禁通过。
- [ ] benchmark 保留原始数据，无机器相关硬阈值；确定性副作用断言通过。
- [ ] untracked/staged 清点、incremental lint、diff check、协议引用、全仓 typecheck 通过。
- [ ] 审计、技术债、Sidebar 架构和计划状态已闭环。

---

## 13. 风险与回滚

| 风险                                         | 预防/检测                                                    | 回滚单位  |
| -------------------------------------------- | ------------------------------------------------------------ | --------- |
| Dialog replacement/卸载留下 pending Promise  | FIFO + once-settle + UI replacement callback tests           | Slice 1   |
| child leaf 被误当 root tab                   | placement contribution + child matrix                        | Slice 1/2 |
| close navigation 与 guard 二次消费           | force retry/bypass token + single-dialog E2E                 | Slice 1   |
| route/server contribution 或 Layout 串 scope | 原子 registration + 目标 LayoutProvider + cross-server tests | Slice 2   |
| async storage 回写错误 workspace             | keyed Owner + ready gate + A→B→A tests                       | Slice 5   |
| Popover focus policy影响共享消费者           | 默认兼容 API + UI regression tests                           | Slice 3   |
| Home 多 resolver 再次漂移                    | 单一 action Owner + E2E                                      | Slice 4   |
| Sidebar 改动误套 ADR-15                      | 分离 Session Persist 恢复与 ModeWorkspace no-remount         | Slice 5   |

每个 Slice 是独立回滚单位；建议提交只是审批后的切分建议。未获用户明确授权不得 commit、push 或创建 PR。

---

## 14. 内部复审结论与 Owner 审批模板

本版已吸收四路只读复审的有效阻断：root/leaf identity、Router Shell Owner、前置 Dirty Guard、确认并发/取消、focus handoff、dynamic Persist scope、Popover/UI 契约、ADR-15/16 边界、RED 可审计性、真实 presentation/production/performance/diff Gate。内部结论：**APPROVED / READY FOR OWNER REVIEW**（架构、可实施性、测试交付、Bugbot 四路最终复审均无阻断），但不等同于 Owner 批准，也不授权实施或 Git 操作。

```text
审批结论：APPROVED / APPROVED WITH CHANGES / REJECTED

D1 关闭事务与 focus handoff：
D2 root/leaf Dirty identity：
D3 Router Shell contribution：
D4 状态栏分型：
D5 删除启发式子代理指标：
D6 Help/Debug + UI Dialog/Popover 最小改动：
D7 ADR-16 Home 语义：
D8 Chat 三区与 dynamic Persist scope：

默认 Chat 三区：三块展开 / 其他
允许实施到：仅本地代码与测试 / 允许 commit / 允许 push+PR
```

## 13. 实施记录（2026-09-11）

- Slice 1–5 已实施：关闭事务/focus handoff、route contribution、状态栏数据边界与 virtual anchor、Home 项目优先/统一新建 action、Chat Project→Feature→Session keyed Persist owner。
- 已通过：`packages/ui` 10 tests + typecheck；`packages/app` 1006 unit + 3 virtualizer（前一稳定轮）及增量目标测试；App typecheck；production build；增量 lint；`git diff --check`。
- 已新增：route contribution token lifecycle 单测、顶部活动/唯一标签 focus E2E、locale/narrow presentation spec、production Debug smoke。
- 首轮五 project 755-test 运行与后续目标 E2E 发生并发产物竞争，并且运行期间源码变化触发 Vite/Babel HMR 污染；该轮失败不归类为产品回归。源码冻结后的最终独立复跑与 benchmark 仍是合并前硬门禁，未通过不得提交/PR。
- Git：未提交、未推送、未创建 PR。

### 13.1 审批后跟进：脏草稿关闭用例根因与加固（2026-09-11）

**失败事实**：`global-shell.spec.ts` 的 "closing a dirty draft confirms before removing it" 在干净串行复跑中稳定失败：点 X 后要么不出现确认框（断言 `toBeVisible` 超时），要么 Stay 之后 draft 标签消失、`/new-session?draftId=` 主体空白。

**根因（插桩证据，非产品缺陷）**：这是**规格自身与路由过渡的竞态**。点击 "New session" 会立即登记 draft 标签并启动导航，但该导航在 transition 中渲染；用例没有等待 draft 路由就继续操作。插桩日志显示失败运行中 `CLICKING_X url=<session 路由>`、`dirty.set {session key, value: true}`（`fill` 落在了仍然挂载的 session composer 上）、`removeTab {routeActive: false}`、`confirmLeave {has: false}`：draft 页面从未挂载，因此没有页面级登记，X 关闭被正确判定为后台关闭（只移除标签、不导航）；随后延迟的 draft 导航落在标签已被移除的路由上，页面自然空白。前一版探针之所以总是通过，是因为它多了一条 `toHaveURL(/new-session?draftId=/)` 等待——这正是缺失的同步点。

**规格修复**：`global-shell.spec.ts` 在点击 "New session" 后先等待 draft 路由生效，再进行输入与关闭；注释说明该窗口内 session 页面仍挂载。

**同路径加固（产品，覆盖真实存在但未在本例触发的竞态族）**：

1. dirty 改为**实时来源**登记（`dirty.register(key, () => prompt.dirty(), token)`），关闭/离开判定时求值，不再依赖 effect 刷入的快照——消除"点击早于 effect 落盘"的窗口；
2. 身份登记与 `prompt.ready()` 解耦、并加所有权 token，旧页面 cleanup 不能清掉新页面的同 key 登记；
3. `tabs.tsx#removeTab` 在发起关闭时快照 route-active 判定，await 后按 key 重新定位并重算后继（确认框是模态的）；
4. 确认调度抽为 `context/dirty-confirm.ts`（FIFO/合并/一次性结算），关闭决策抽为 `context/tab-close.ts`（后继/recent/remaining）。

**测试**：`context/dirty-confirm.test.ts`（6 例）与 `context/tab-close.test.ts`（8 例）。RED/GREEN：把回归点还原为"await 后读取身份"时，专项断言 `navigateCalls` 为空；修复后通过。注意该 RED 针对的是加固项 3，不针对规格竞态本身——规格竞态的验证只能由 e2e 承担（见下）。

**测试基建边界**：provider 级渲染测试在本仓库不可行——`bun test` 未启用 `--isolate`，`mock.module` 进程级生效，`./src` 全量运行会双向污染（实测：mock `./server` 导致 `server.test.ts` 报 `Export named 'resolveServerList' not found`）。已登记 `docs/technical-debt.md` §7。

**本次跟进验证**：`packages/app` 全量单测（含新增 14 例）与 App typecheck 已复跑；目标 e2e 复跑结论见 `docs/review/global-shell-e2e-2026-09-10.md` §8.2。

**本次跟进验证**：`packages/app` 全量单测（含新增 14 例）与 App typecheck 已复跑；目标 e2e 复跑结论见 `docs/review/global-shell-e2e-2026-09-10.md` §8.2。
