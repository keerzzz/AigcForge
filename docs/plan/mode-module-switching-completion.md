# Product Mode Module Switching Completion Plan

> 状态：APPROVED FOR IMPLEMENTATION
> 决策日期：2026-07-12
> Owner：App + Session Platform
> 采用方向：方案 C——模块入口路由 + 单一共享 ModeWorkspace；导航不隐式创建或恢复 Session
> 架构决策：[`ADR-11-product-mode-session-classification.md`](../architecture/adr/ADR-11-product-mode-session-classification.md)、[`ADR-12-product-mode-entry-routing.md`](../architecture/adr/ADR-12-product-mode-entry-routing.md)
> 取代：[`mode-unified-architecture.md`](mode-unified-architecture.md)、[`mode-switcher-implementation.md`](mode-switcher-implementation.md) 中的会话恢复语义

## 1. 三行摘要

1. 把 Chat / Coding / Work / Assistant 升级为可深链的 `/mode/:mode` 模块入口和可持久化、可查询的 Session 分类。
2. Home 卡片与全局 Icon 统一导航到一个参数化 `ModeRoute`，四个模块复用同一 `ModeWorkspace`，不复制页面骨架。
3. Session/Draft 保持现有 canonical URL；模块入口不自动创建或恢复工作，Session Mode 仍在创建时冻结并向子 Session/Fork 继承。

## 2. 问题与根因

当前实现同时存在三套不一致的语义：

- `ModeProvider.currentMode` 是产品模块选中态，但只有前端本地持久化。
- `activeSessionId[mode]` 把 Mode 误建模成“最近会话导航槽”，导致首页卡片承担隐式跳转和隐式创建职责。
- Session 数据、HTTP API、SDK 与同步缓存都没有产品 Mode 字段，因此 Home 和 Sidebar 无法可靠过滤。

内部用户反馈可归纳为：

> “我点击模块时，希望进入这个模块的页面；但不要替我打开旧会话或自动创建新会话。”

另一个根因是命名冲突：Agent 的 `mode: primary | subagent | all` 表示执行角色，不是产品模块。产品 Mode 不能从 Agent 或 Message 的 `mode` 继承。

## 3. 决策摘要

| 主题 | 决策 |
|------|------|
| 模块入口 | Home 卡片和全局 Icon 统一 `navigate(modeHref(mode))` 到 `/mode/:mode` |
| URL | Module URL 编码 Mode；Session/Draft canonical URL 不编码 Mode |
| 页面复用 | 单一 `ModeRoute` + `ModeWorkspace`；禁止复制四套共享骨架 |
| 产品域类型 | `chat | coding | work | assistant`，与 Agent execution mode 严格分离 |
| Session 归属 | 根 Session 取 Draft Mode；子 Session 取父 Session；Fork 取源 Session |
| 可变性 | 已创建 Session 的 Mode 本阶段不可变；Draft 可通过显式操作改归属 |
| 旧数据 | 数据库、历史事件、旧响应缺失 Mode 时统一解码为 `coding` |
| 项目归属 | Project/Workspace 跨 Mode 共享；只过滤其 Session 子项，不隐藏项目创建入口 |
| 搜索 | 默认只搜索当前 Mode；跨 Mode 搜索留作独立显式入口 |
| 最近会话映射 | 删除 `activeSessionId` 及其写入点，避免第二事实源 |
| 模块内容 | 四个 Mode 共享 Project/Session 架构，通过 typed slot 扩展专属 Agent/Viewport |

## 4. Goals / Non-Goals

| Goals | Non-Goals |
|-------|-----------|
| 四个 Mode 拥有可刷新、可分享、支持前进后退的入口 URL | 不恢复 `activeSessionId` 自动打开最近会话 |
| Home 卡片与全局 Icon 使用同一导航契约 | 不复制四套 Route/Page/Store |
| Session Mode 在数据库、事件、API、SDK、App 全链路一致 | 不把产品 Mode 写进 URL |
| Home、Sidebar、搜索、未读状态按当前 Mode 展示 | 不给 Project/Workspace 增加 Mode 归属字段 |
| Draft 创建时冻结 Mode，避免提交时漂移 | 不从 Agent `mode` 或 Assistant Message `mode` 推导产品 Mode |
| 历史数据库与旧事件无损兼容 | 不在本次实现 Chat/Work/Assistant 专属工作流引擎 |
| 提供完整单测、API 测试、E2E 与性能对比 | 不顺手重构 Session Store 或路由体系 |

## 5. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Mode 入口导航正确率 | 100% | 四 Mode 的 Home 卡片/Icon 参数化 E2E |
| Mode 导航隐式创建/恢复 Session | 0 次 | API/Tab/Session 计数与路由断言 |
| 模块深链/刷新/前进后退成功率 | 100% | Router E2E |
| 新建 Session Mode 正确率 | 100% | 四 Mode 参数化 API + App 测试 |
| 子 Session / Fork 继承正确率 | 100% | Core/V1 Session service 测试 |
| 历史 Session 可读率 | 100% | 迁移前数据库 + 历史事件 fixture |
| 当前 Mode 列表串数据 | 0 条 | Home/Sidebar selector + E2E |
| SDK 契约漂移 | 0 | SDK regenerate 后 typecheck/snapshot |
| 首次导航性能回退 | 不超过基线 5% | `first-navigation-benchmark.spec.ts` 前后对比 |

## 6. 术语和不可破坏的关系

### 6.1 Product Mode

产品级模块分类：`chat | coding | work | assistant`。它决定 Session 在产品导航中的归属，不决定 Agent 的执行权限。

### 6.2 Agent Execution Mode

Agent 角色分类：`primary | subagent | all`。它控制 Agent 选择和可见性，与 Product Mode 正交。

### 6.3 关系不变量

- 一个 Session 恰好属于一个 Product Mode。
- 一个 Project/Workspace 可以包含多个 Product Mode 的 Session。
- 根 Session 的 Product Mode 在创建时确定。
- 子 Session 与 Fork 不得跨 Product Mode；分别继承父 Session 与源 Session。
- `/mode/:mode` 的已验证参数是模块入口的权威 Mode；`DraftTab.mode` 与 `Session.mode` 分别是 Draft/Session 路由的权威 Mode。
- `currentMode` 只保存最近有效 Mode，并从当前权威 route/work item 单向同步；它不得反向触发循环导航。
- 模块入口导航可以离开当前页面，但不得创建、恢复、选择或重分类 Session/Draft，也不得改变 Agent。
- Session/Draft URL 不包含 Product Mode；禁止 `/mode/:mode/server/...` 双重编码。

## 7. 用户故事与验收标准

### US-1：进入可深链的模块页面

作为用户，我希望点击 ModeSwitcher 或 Home 卡片后进入明确的模块 URL，以便刷新、分享并使用浏览器前进后退。

验收：

- 点击任一 Mode 导航到 `/mode/<mode>`。
- Home 卡片和 ModeSwitcher 复用同一个 `modeHref(mode)` 与 Mode registry。
- 刷新、直接打开、前进和后退均恢复正确模块页面。
- 导航不调用 `tabs.newDraft()`，不创建/恢复 Session，也不选择 Session Tab。

### US-2：按模块查看 Session

作为用户，我希望 Home 和 Secondary Sidebar 只显示当前 Mode 的 Session，以免四类工作混在一起。

验收：

- Home 最近列表、日期分组和搜索结果仅包含 `session.mode === currentMode`。
- Secondary Sidebar 每个 Workspace 的 Session 列表仅包含当前 Mode。
- Project/Workspace 导航仍保持可见，允许在空 Mode 中创建第一条 Session。
- 无匹配 Session 时显示包含 Mode 名称的空状态和显式“新建”动作。

### US-3：新建 Session 归入正确模块

作为用户，我希望从任意入口创建的新会话归入创建 Draft 时选中的 Mode。

验收：

- `DraftTab` 持久化 `mode`。
- 所有 `newDraft` 入口显式传入 `currentMode`。
- 首次提交使用 Draft 的 Mode 调用 `session.create({ mode })`，不读取提交瞬间的 `currentMode`。
- 历史 Draft 缺失 Mode 时迁移为 `coding`。

### US-4：离开模块时保留当前工作

作为用户，我希望从 Session/Draft 进入另一个模块页面后，原工作仍保留在 Tab 和持久化 Composer 中，以便随时返回。

验收：

- 点击全局 Mode Icon 导航到目标 `/mode/:mode`，不修改原 Session/Draft。
- 原 Session Tab、Draft Tab 和未提交 Composer 状态保持可恢复。
- 返回 Session 时有效 Mode 来自 `Session.mode`；返回 Draft 时来自 `DraftTab.mode`。
- 已创建 Session 不因模块入口导航而改变 Mode。

### US-5：兼容历史和非 App 客户端

作为现有用户或 CLI/ACP 客户端，我希望升级后旧 Session 仍可用。

验收：

- 数据迁移将旧行回填为 `coding`。
- 历史 `session.created/updated` 事件缺失字段时解码为 `coding`。
- Create API 的 `mode` 对旧客户端可省略，服务端默认 `coding`。
- List API 的 `mode` 可选；省略时保持现有全量行为。

## 8. 目标数据流

### 8.1 Mode 切换

```text
ModeSwitcher / HomeModeCards
  -> modeHref(target)
  -> navigate("/mode/:mode")
  -> ModeRoute validates ProductMode
  -> persisted currentMode follows route (one-way)
  -> shared ModeWorkspace renders mode-aware data and slot
  -> no Draft/Session create, restore, select, or mutation
```

### 8.1.1 Route authority

```text
/mode/:mode                    -> validated route mode
/new-session?draftId=...       -> DraftTab.mode
/server/:serverKey/session/:id -> Session.mode
/                              -> persisted last mode (presentation default only)
```

禁止通过 `currentMode` effect 反向纠正权威路由，避免导航循环。

### 8.2 Draft 到根 Session

```text
New Session action
  -> tabs.newDraft({ server, directory, mode: currentMode })
  -> DraftTab 持久化 mode
  -> 首次提交读取 DraftTab.mode
  -> POST /session { mode }
  -> Session service 创建根 Session
  -> session.mode 持久化并随事件/API/SDK 返回
```

### 8.3 子 Session / Fork

```text
create({ parentID }) -> load parent -> mode = parent.mode
fork(sourceID)       -> load source -> mode = source.mode
```

调用者传入的 UI Mode 不得覆盖父/源 Session 的归属。

### 8.4 Mode 列表加载

```text
currentMode + directory
  -> GET /session?directory=...&mode=...
  -> server filters SessionTable.mode
  -> ServerSync merges entities by Session ID
  -> mode-scoped root index / metadata
  -> Home + Sidebar selectors
```

## 9. Schema、数据库和事件设计

### 9.1 Canonical Schema

在 `packages/schema` 定义唯一的 Product Mode 字面量 Schema，并由 Session V1/V2 Schema 复用。命名必须避免与 Agent `mode` 混淆。

```ts
ProductMode = "chat" | "coding" | "work" | "assistant"
DefaultProductMode = "coding"
```

`Session.Info.mode` 在领域类型中必填。为了兼容旧事件编码，Schema 的 encoded side 允许缺失并使用当前 Effect v4 的 `Schema.withDecodingDefaultKey(Effect.succeed("coding"))` 解码为必填值。

App 不另建平行 union；Mode registry 使用生成 SDK 的 `Session["mode"]`（或生成的命名别名）做 `satisfies` 约束。

### 9.2 SQLite

`session` 表新增：

```text
mode TEXT NOT NULL DEFAULT 'coding'
```

新增面向真实查询形状的索引：

```text
session_project_mode_time_updated_idx(project_id, mode, time_updated)
session_directory_mode_time_updated_idx(directory, mode, time_updated)
```

迁移必须使用 TypeScript migration，并同步：

- `packages/core/src/session/sql.ts`
- `packages/core/src/database/schema.gen.ts`
- `packages/core/src/database/migration/<timestamp>_session_product_mode.ts`
- `packages/core/src/database/migration.gen.ts`
- `packages/core/schema.json`

### 9.3 Projection 和 Adapter

以下映射必须全部透传 `mode`：

- V1 `fromRow` / `toRow` / `createNext`
- V2 `SessionSchema.Info` / `SessionV2.create`
- `SessionProjector.sessionRow`
- `v2InfoToV1`
- `session.created` / `session.updated` / `session.deleted` 事件

禁止把 Assistant Message 的 `mode` 或 Agent Info 的 `mode` 映射到 Session Product Mode。

## 10. Service、HTTP 与 SDK 契约

### 10.1 Create

```text
POST /session
body.mode?: ProductMode
response.mode: ProductMode
```

规则：

1. 根 Session：`input.mode ?? "coding"`。
2. 子 Session：读取父 Session 并继承；忽略 UI currentMode。
3. Fork：继承源 Session。
4. 幂等重用已有 Session ID：已有 Session 事实胜出，不重分类。

### 10.2 List

```text
GET /session?mode=chat
```

- `mode` 可选；省略保持原行为。
- V1 `Session.ListInput`、V2 `SessionV2.ListInput`、HTTP `ListQuery` 与 handler 同步扩展。
- 条件与 project/directory/workspace/search/roots 组合，继续由 Session service 负责，handler 只解码和转发。

### 10.3 SDK

执行 `./packages/sdk/js/script/build.ts`，确认以下生成契约：

- `Session.mode`
- `SessionV2Info.mode`
- `SessionCreateData.body.mode?`
- `SessionListData.query.mode?`

## 11. App 状态与 UI 设计

### 11.1 ModeContext 减法

保留：

- `currentMode`
- `setCurrentMode`
- `secondarySidebarOpen`
- `toggleSecondarySidebar`

删除：

- `activeSessionId`
- `setActiveSessionId`
- `ModePlacement`
- `app.tsx` 和 `submit.ts` 中的 placement 写入
- Home 卡片的 active/idle placement badge

`mode-view` 持久化迁移只保留合法 `currentMode`；非法/缺失值回退为 `coding`。

`currentMode` 是最近有效 Mode 的持久化镜像，不是路由权威源。`ModeRoute`、`DraftRoute`、`SessionRoute` 分别从 route param、Draft、Session 单向激活 Mode；禁止 `currentMode` 与 router 互相监听形成回路。

### 11.2 Mode Definition Registry

Mode ID、`/mode/:mode` href、Icon、label key、description key、empty-state key 和 content slot 归一到一个 UI registry。ModeSwitcher、HomeModeCards 和 ModeRoute 复用该 registry，禁止各自维护平行映射。

### 11.3 Module Route and Shared Workspace

新增一个参数化路由，不创建四个复制页面：

```text
Route /mode/:mode
  -> ModeRoute (decode + activate)
  -> ModeWorkspace (shared composition)
     -> Project/Workspace navigation
     -> mode-scoped Session list/search/load/unread
     -> shared loading/empty/error surfaces
     -> typed Mode content slot
```

- Coding 通过 adapter 接入现有能力，不保留永久特殊路由分支。
- Chat、Work、Assistant 首先复用共享 Session 架构，后续只替换其 owned slot。
- 非法 Mode 参数进入普通 not-found/fallback，不得静默创建任意 Mode。
- Session 与 Draft 继续使用 `/server/:serverKey/session/:id` 和 `/new-session?draftId=...`。

### 11.4 Draft Mode

- `DraftTab` 新增必填 `mode`。
- tabs 持久化 migrate 为旧 Draft 补 `coding`。
- 所有 11 个 `newDraft` 入口通过一个 mode-aware owner API 创建，避免遗漏。
- 未提交 Draft 可提供显式“移动到当前 Mode”操作；不自动改变。

### 11.5 Home

- 卡片点击导航到 registry 提供的 `/mode/:mode`。
- 最近 Session、搜索、日期分组按 Mode 过滤。
- Project 列保持稳定，Project 是跨 Mode 资源。
- 空状态文案包含当前 Mode，并提供显式新建按钮。
- 删除预期 guard path 上的 `console.warn`；在按钮可用性和空状态层阻止无 server/directory 调用。

### 11.6 Secondary Sidebar

- Project/Workspace 树保持稳定尺寸和顺序。
- Session 子列表、Load more、搜索结果和未读计数按当前 Mode。
- 未读计数由匹配 Session ID 的 `notification.session.unseenCount` 聚合；“全部已读”只处理当前 Mode Session，不能清除其他 Mode。

### 11.7 Global Icon Navigation and Work Preservation

- 全局 Icon 在所有页面统一导航到 `/mode/:mode`，不隐式恢复最近 Session。
- 从 Session/Draft 离开时保留对应 Tab 和持久化 Composer，返回后继续工作。
- Session route 激活 `Session.mode`；Draft route 激活 `DraftTab.mode`，因此不再需要 mismatch 状态。
- 导航保持键盘焦点落点可预测，并为当前模块设置正确 `aria-current`；不使用 `aria-pressed` 表达页面导航。

## 12. ServerSync 缓存策略

现有缓存按 directory 组织，不能简单把一次 mode 查询结果覆盖 `store.session`，否则切换 Mode 会删除其他 Mode 的实体和关联缓存。

采用“单一实体集 + Mode 索引/加载元数据”：

- Session 实体仍按 ID 合并到 directory child store。
- query key 与 load metadata 使用 `(serverScope, directory, mode)`。
- mode 查询只替换该 Mode 的 root ID 集，不删除其他 Mode 的实体。
- child Session 始终跟随父 Session Mode，不单独进入另一个 bucket。
- trim 按已加载 Mode 的保留上限处理，不能让大量 Coding Session 挤掉 Chat Session。
- `session.created/updated/deleted` reducer 根据 `info.mode` 更新对应索引。
- 模式切换只切 selector，不清空 message/diff/todo/permission cache。

需要先写纯函数测试再接入 Solid store：

- `mergeModeSessions`
- `sessionsForMode`
- `trimSessionsByMode`
- mode event index update

## 13. 实施里程碑

### Phase 0 — Contract and Baseline

- 固化 ADR-11、ADR-12、术语和 UI 行为。
- 记录 App 首次导航与 Session 列表基线 benchmark。
- 为现有 Mode 行为补失败测试：Home 卡片/全局 Icon 尚未导航到 `/mode/:mode`、导航仍可能触发 Session 生命周期副作用、列表尚未过滤。

退出条件：协议无冲突，路由入口与 Session/Draft canonical URL 边界明确，基线结果入实施记录。

### Phase 1 — Domain and Persistence

- 增加 Product Mode Schema。
- 扩展 Session V1/V2 Info、SQL row、projector 和 adapter。
- 添加 migration、schema.gen、migration.gen、schema snapshot。
- 实现历史事件 decoding default。

退出条件：旧数据库与旧事件 fixture 均解码为 Coding，无数据丢失。

### Phase 2 — Services, API and SDK

- 扩展 create/list 输入与继承规则。
- 扩展 HTTP query/payload/handler。
- 重新生成 SDK。
- 覆盖根、子、Fork、list filter 和省略 mode 的兼容测试。

退出条件：Core/AigcForge/SDK typecheck 与相关测试通过。

### Phase 3 — Draft and Mode Context

- DraftTab 冻结 Mode 并迁移旧持久化数据。
- 统一所有 newDraft 入口。
- 删除 activeSessionId 第二事实源。
- 新增 Mode registry 与 `modeHref(mode)`，由 Home 卡片、全局 Icon 和 ModeRoute 共享。
- 新增 `/mode/:mode` 参数化路由、ModeRoute decode/activate 逻辑和共享 ModeWorkspace 壳层。
- Home 卡片与全局 Icon 点击统一导航到 `/mode/:mode`，但不得创建/恢复 Draft 或 Session。

退出条件：任何模块入口点击均进入正确 `/mode/:mode`，无 Draft/Session/Agent 副作用；新 Draft Mode 正确。

### Phase 4 — Mode-Aware Sync and Surfaces

- 实现 ServerSync Mode bucket 合并策略。
- ModeWorkspace、Home、Sidebar、搜索、Load more、未读状态按 Mode。
- 将 Coding 现有共享能力通过 adapter 接入 ModeWorkspace；Chat/Work/Assistant 先复用统一 Session 架构和空状态。
- 增加 Session/Draft mismatch 提示和空状态。
- 补齐 18 语言 i18n 与 parity。

退出条件：四 Mode 数据无串流，切换不丢缓存、不移动当前工作。

### Phase 5 — Verification and Rollout

- 运行 lint、受影响包 typecheck/test、API tests、App E2E。
- 复跑首次导航 benchmark，回退不超过 5%。
- 手工检查桌面/窄屏、键盘、英文/中文溢出、亮/暗主题。
- 更新 schema changelog 和完成状态文档。

退出条件：全部门禁通过，计划状态改为 COMPLETE。

## 14. 测试矩阵

| Layer | Required Tests |
|-------|----------------|
| Schema | 四个合法值、非法值、缺失字段 decoding default |
| Migration | 旧 session 行回填 Coding；索引存在；重复启动幂等 |
| Core V2 | root explicit/default、child inheritance、list mode composition |
| V1 Session | create/fork/fromRow/toRow/listByProject/listGlobal |
| Projector | created/updated event mode round-trip；旧事件 replay |
| HTTP | create body、list query、invalid mode 400、missing mode compatibility |
| SDK | generated request/response types include Product Mode |
| Tabs | old persisted Draft migration；new Draft captures mode |
| ModeContext | old activeSessionId state migration；invalid mode fallback |
| ServerSync | per-mode merge/trim/event update/cache preservation |
| Router | `/mode/:mode` valid/invalid params；reload/back/forward；route authority one-way sync |
| Home | card navigates to `/mode/:mode` without work lifecycle side effects；list/search/empty state/current project behavior |
| Global Icon Rail | icon navigates to `/mode/:mode`；`aria-current`；focus preservation；no Session restore/create |
| Sidebar | filtered roots/load-more/unread/mark-viewed |
| ModeWorkspace | shared shell renders all Modes；Coding adapter；non-Coding empty/session surfaces |
| Session UI | mode mismatch prompt；keyboard and i18n |
| E2E | 四 Mode module route round trip、reload persistence、deep link mismatch、remote server error |

按仓库协议执行：

```bash
bun run lint
bun --cwd packages/schema typecheck
bun --cwd packages/core typecheck
bun --cwd packages/core script/migration.ts --check
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge typecheck
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/sdk/js typecheck
bun --cwd packages/app typecheck
bun --cwd packages/app test --timeout 30000
```

测试不得从仓库根目录运行；根目录只运行 lint 和全仓 typecheck。

## 15. 文件影响清单

### Domain / Storage

- `packages/schema/src/product-mode.ts`（新增 canonical schema）
- `packages/schema/src/index.ts`
- `packages/schema/src/session.ts`
- `packages/core/src/v1/session.ts`
- `packages/core/src/session/sql.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session/projector.ts`
- `packages/core/src/database/schema.gen.ts`
- `packages/core/src/database/migration/*.ts`
- `packages/core/src/database/migration.gen.ts`
- `packages/core/schema.json`

### Server / API / SDK

- `packages/aigcfroge/src/session/session.ts`
- `packages/aigcfroge/src/server/routes/instance/httpapi/groups/session.ts`
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session.ts`
- `packages/aigcfroge/src/server/routes/instance/httpapi/handlers/session-adapter.ts`
- `packages/sdk/js/src/v2/gen/*`（生成）

### App

- `packages/app/src/context/mode.tsx`
- `packages/app/src/context/tabs.tsx`
- `packages/app/src/context/server-sync.tsx`
- `packages/app/src/context/global-sync/*`
- `packages/app/src/components/prompt-input/submit.ts`
- `packages/app/src/components/mode-switcher.tsx`
- `packages/app/src/components/secondary-sidebar.tsx`
- `packages/app/src/components/titlebar.tsx`
- `packages/app/src/pages/home.tsx`
- `packages/app/src/pages/session.tsx` 或其相邻 mode context surface
- `packages/app/src/pages/layout/helpers.ts`
- `packages/app/src/i18n/*.ts`

实际实施前必须用 codegraph impact/调用链确认最终 blast radius，不凭本清单盲改。

## 16. Rollout / Compatibility

- 数据库变更是 additive；不删除或重写历史 Session。
- 旧客户端省略 create/list mode 时继续得到 Coding/全量行为。
- App 读取缺失 `session.mode` 时临时按 Coding 收窄，支持升级窗口；该兼容分支在最低服务端版本提升后删除。
- 非 Coding Mode 连接不支持 Mode 字段的旧远端服务时，显示可恢复的“升级服务端”错误，不静默把 Session 写入 Coding。
- 不增加长期 feature flag；通过分阶段提交和契约测试控制风险。

## 17. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Product Mode 与 Agent mode 混用 | 错误权限/归属 | 独立类型、命名、负类型测试、协议术语 |
| mode 查询覆盖 directory store | 丢失其他 Mode Session 缓存 | 单实体集 + Mode bucket，不整表替换 |
| 提交瞬间读取 currentMode | Draft 归属漂移 | Draft 创建时冻结 Mode |
| 子 Session/Fork 跨 Mode | 树关系不一致 | 服务端继承，不信任调用方 |
| 旧事件缺字段无法 replay | 启动/投影失败 | Schema decoding default + replay fixture |
| 大量 Coding 数据挤掉其他 Mode | 空列表假象 | per-mode retention/limit metadata |
| Mode 切换后当前 Session 不匹配 | 用户认知混乱 | 紧凑 mismatch 提示，不静默重分类 |
| 未读清除跨 Mode | 丢失提醒 | 按匹配 Session ID 聚合与 markViewed |

## 18. 已解决问题

| Question | Resolution |
|----------|------------|
| 点击 Mode 是否导航？ | 是。Home 卡片和全局 Icon 导航到 `/mode/:mode`；Session/Draft 路由不编码 Mode |
| 没有 Session 是否自动建 Draft？ | 否，只展示空状态和显式按钮 |
| Project 是否属于 Mode？ | 否，Project/Workspace 共享 |
| Session Mode 是否从 Agent/Message 继承？ | 否，两者语义不同 |
| 历史 Session 属于哪个 Mode？ | Coding |
| Session Mode 能否修改？ | 本阶段不可变；只有未提交 Draft 可显式移动 |
| activeSessionId 是否保留？ | 删除，避免第二事实源 |
| 专属 Agent/Viewport 是否属于本次？ | 不属于；本次完成模块分类、切换、创建、过滤和兼容闭环 |

## 19. Definition of Done

- [ ] ADR-11、ADR-12 与协议文档一致，无旧计划继续声明自动恢复最近 Session 或自动创建 Draft。
- [ ] Session Mode 全链路可见且只有一个 canonical schema。
- [ ] 四 Mode 入口点击导航到 `/mode/:mode`，但不创建/恢复 Session，不选择 Tab，不改变 Agent。
- [ ] Home 卡片、全局 Icon 和 ModeRoute 共享同一 registry/href，不维护平行映射。
- [ ] 四 Mode 通过单一 ModeRoute/ModeWorkspace 渲染；除 Coding adapter 外不得复制共享页面骨架。
- [ ] Home/Sidebar/Search/Unread 按 Mode 正确隔离。
- [ ] Draft、root Session、child Session、Fork 继承规则通过测试。
- [ ] 旧数据库、旧事件、旧 Draft 和省略字段的客户端兼容。
- [ ] SDK 已重新生成且无手改 generated code。
- [ ] 受影响包 typecheck/test、lint、E2E、性能门禁全部通过。
- [ ] 桌面/窄屏、键盘、亮暗主题、英文/中文均完成验证。
