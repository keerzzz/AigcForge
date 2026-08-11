# Global Home Overview — 全局聚合首页实施计划

> 状态：Draft（待评审）
> 关联：ADR-15（ModeWorkspace slot）、ADR-12（模式入口路由）、CLAUDE.md 行为准则
> 目标读者：实施者（AI 代理或人类工程师）
> 范围：packages/app（UI）、packages/ui（icon）、docs（ADR）；SDK/core/server/DB **零改动**（已确认会话 `mode`/`project_id` 已落库并暴露于 SDK，见 §3.1）

## 1. 背景与目标

### 1.1 问题

1. **无全局首页**：`/` 直接重定向到 `/mode/coding`（app.tsx `HomeRedirect`），会话入口只存在于 coding 模式首页；chat/work 模式首页为资产/预设视图，跨模式会话发现困难。
2. **记忆缺失**：`global.lastSession` 仅记录最近项目目录（`context/global.tsx:22-33`），无"最后活跃会话"级记忆，退出时在某个会话中，下次进入无法直达。
3. **入口缺失**：顶栏（Titlebar）左侧无主页按钮，rail 仅含 4 个模式按钮（mode-switcher.tsx），从会话页/模式页回首页无快捷方式。
4. **宽度不一致**：ModeWorkspace 三模式网格（mode-workspace.tsx:140-145）：chat `minmax(0,1fr)` 全宽、work 960、coding 720。

### 1.2 目标（产品已确认）

```
/            → 全局聚合首页（会话列表 + 筛选 + 记忆置顶），不再重定向
/mode/:mode  → 各模式首页（路由不变，coding 入口与 chat/work 一致保留）
顶栏左侧     → 主页 icon 按钮（href `/`），全局可见
rail         → 纯模式切换，不新增按钮
首页点击会话 → 跳转会话详情页，并同步 currentMode = 会话 mode
```

### 1.3 非目标

- 不解决会话列表 icon 与项目 icon 的 "C" 差异问题（另立议题，暂缓）
- 不做任务列表/定时列表/个人助手统计（首页预留区块位，后续开闸）
- 不改 ModeWorkspace 的 slot 机制（首页为独立路由组件，见 §4 决策）

## 2. 现状实证（接口已核，禁止猜测）

| 能力 | 现状位置 | 结论 |
|---|---|---|
| 路由 | app.tsx:564-577：`/`→HomeRedirect、`/mode/:mode`→ModeRoute、`/server/:key/session/:id`→TargetSessionRoute | `/` 改为渲染 HomeOverview，删除 HomeRedirect |
| `/` 隐藏 rail | layout.tsx:36-38 `Show when={location.pathname !== "/"}` | 首页天然无模式切换，无需改 |
| 首页隐藏次级侧栏 | layout.tsx:24 `showSecondarySidebar = open && route.type === "session"` | 首页不受影响 |
| 会话聚合管道 | `buildHomeSessionRecords`（pages/home.tsx:73-97）+ `groupSessions`（home.tsx:760-784）+ `filterSessionsByMode`（pages/layout/helpers.ts:37-44） | 直接复用 |
| 会话行/搜索/分组头 | `HomeSessionRow`/`HomeSessionSearch`/`HomeSessionGroupHeader`/`HomeSessionSkeleton`（pages/home.tsx） | 直接复用 |
| 项目列 | `HomeProjectColumn`/`HomeProjectRow`/`HomeProjectAvatar`（pages/home.tsx:111-400） | 首页左列项目维度复用其行组件 |
| 打开会话 | `CodingSessionListMain.openSession`（pages/mode-workspace-slots.tsx:287-305）：`sessionPlacement.set` → `projects.open/touch` → `tabs.addSessionTab + select` | 提取为共享函数（§6.5），首页复用 |
| 模式上下文 | `useMode()`：`setCurrentMode`（context/mode.tsx:102-104）；`isMode` 收窄（mode.tsx:47-49）；`MODE_DEFINITIONS.labelKey` 本地化文案 | 跳转同步 + 徽标复用 |
| 会话 mode 类型 | SDK `ProductMode = "chat" \| "coding" \| "work" \| "assistant"`（sdk/js/src/v2/gen/types.gen.ts:160）；`Session.mode?` 已落库 | 无需 SDK/后端改动 |
| 最近目录记忆 | `global.lastSession`（context/global.tsx:22-33），写入点 `sessionPlacement.onSet`（global.tsx:34-38） | 扩展为会话级记忆（§6.3） |
| 图标集 | 手写 SVG 字典 `packages/ui/src/v2/components/icon.tsx`（`icons` record，16x16 stroke 风格） | **无 home 图标**，需新增 |
| i18n | 18 语言文件 + `parity.test.ts` 强制 key 集合一致 | 新 key 必须全语言补齐，否则 parity 测试红 |
| 测试基座 | `packages/app` 用 `bun:test`；现有风格 = 纯函数断言（home.test.ts）+ 文件/导出存在性断言（mode-workspace.test.tsx） | 新测试对齐此风格 |

## 3. 分层影响面（上下游 5 层）

| 层 | 改动 | 说明 |
|---|---|---|
| UI（packages/app） | 新增 HomeOverview 页 + 路由 + 记忆 + 模式同步 + 宽度对齐 | 主体 |
| UI（packages/ui） | icon.tsx 新增 `home` 图标 | 1 个 SVG 条目 |
| SDK（packages/sdk） | 无 | `Session.mode`/`time.updated`/`projectID` 已暴露 |
| Core（packages/core） | 无 | 会话/项目数据已齐 |
| Server/DB（packages/aigcfroge） | 无 | `project.list`、`session.list`（loadSessions）已够；无 migration |

## 4. 关键决策记录

- **D1 首页为独立路由组件，非 ModeWorkspace slot**：首页无 rail、无模式 slot 语义，放进 ModeWorkspace 的 4-slot 机制反而违反"slot 即模式"契约；独立路由天然共享 AppLayout 外壳（Titlebar/StatusBar 已挂 router root）。不违反 ADR-15"No Mode may copy the shared workspace"——首页不复制 workspace，只复用其导出组件。
- **D2 记忆用显式持久化，不依赖 `time.updated`**：会话"只看不聊"不保证刷新时间戳，`sessionPlacement.onSet`（view/send/home 导航均触发）已是覆盖最广的活跃信号，扩展为会话级记录。
- **D3 模式徽标语义**：`mode === undefined`（历史无分类会话）归 coding 显示（与 `filterSessionsByMode` 语义一致，helpers.ts:42）。
- **D4 宽度对齐取分级而非同值**：chat 收敛到 work 同级（1080/960）；coding 保持 720（会话列表窄阅读宽度，拉宽无益）。
- **D5 多 server 聚合收敛**：首页按 focusedServer（当前 server，`CodingSessionListMain.focusedServer` 同逻辑）聚合，多 server 聚合为后续项，不阻塞本期。

## 5. 组件与文件清单

### 5.1 新增

| 文件 | 内容 |
|---|---|
| `packages/app/src/pages/home-overview-model.ts` | 纯函数：`countByMode`、`pinLastActive`（§6.2/§6.4） |
| `packages/app/src/pages/home-overview.tsx` | `HomeOverview` 主组件（左筛选列 + 右会话列表 + 置顶组） |
| `packages/app/src/components/session-mode-badge.tsx` | 行内模式徽标（chat/work/coding 彩色小标签 + labelKey） |
| `packages/app/src/pages/home-overview-model.test.ts` | 纯函数测试（红→绿） |
| `packages/app/src/pages/home-overview.test.tsx` | 文件/导出存在性断言（对齐 mode-workspace.test.tsx 风格） |
| `docs/architecture/adr/ADR-16-global-home-overview.md` | 修订 ADR-15 Home 语义（§8） |

### 5.2 修改

| 文件 | 改动 |
|---|---|
| `packages/app/src/app.tsx` | Routes：`/` → `<HomeOverview />`（删除 `HomeRedirect` 组件及其引用） |
| `packages/app/src/components/titlebar.tsx` | V2 分支 JSX 开头（`titlebar-tabs` 之前，约 :494）插入主页按钮：`IconButtonV2` + `IconV2 name="home"`，`onClick={() => navigate("/")}`，pathname 为 `/` 时隐藏；aria-label 用新 key |
| `packages/app/src/components/mode-switcher.tsx` | **不改**（rail 保持 4 模式按钮） |
| `packages/app/src/context/global.tsx` | 新增 `lastActiveSession` persisted store + `sessionPlacement.onSet` 内写入（§6.3） |
| `packages/app/src/utils/session-placement.ts` | `onSet` 类型签名 `(server, directory)` → `(server, directory, leafID)`，`set` 内传参（session-placement.ts:32）；8 处 `sessionPlacement.set` 调用点零改动（`set` 入参已含 `leafID`） |
| `packages/app/src/pages/layout/helpers.ts` | 新增 `openSessionRecord` 共享函数（§6.5）；`filterSessionsByMode` 不变 |
| `packages/app/src/pages/mode-workspace-slots.tsx` | `CodingSessionListMain.openSession` 改为调用共享 `openSessionRecord`（行为不变，回归）；`WorkPresetCatalogMain.openWorkSession` 同（可选） |
| `packages/app/src/pages/mode-workspace.tsx` | :140-145 chat 网格加 `max-w-[1080px] lg:grid-cols-[280px_minmax(0,960px)]` |
| `packages/ui/src/v2/components/icon.tsx` | `icons` 字典新增 `home`（16x16，stroke 风格与现有一致） |
| `packages/app/src/i18n/*.ts`（18 个） | 新增 key（§7），parity 测试绿 |

## 6. 实现细节（函数级）

### 6.1 HomeOverview 组件结构

```
HomeOverview（pages/home-overview.tsx）
├─ 数据：focusedServer / focusedServerCtx（复用 CodingSessionListMain:169-190 逻辑）
│         projects = focusedServerCtx?.projects.list() ?? layout.projects.list()
│         projectDirectories = 全部 projects（worktree + sandboxes），左列选中项目时收窄
│         sessionLoad = useQuery([..."/home","overview-sessions",...dirs]) → 并发 loadSessions(limit: HOME_SESSION_LIMIT)
│         allRecords = buildHomeSessionRecords(...)
│         筛选态：modeFilter（"all" | Mode）+ projectFilter（目录 | undefined）
├─ 左列 HomeOverviewSidebar
│   ├─ 模式筛选：全部 / coding / chat / work（countByMode 计数，点击 = 仅过滤首页列表，不改路由）
│   ├─ 分隔线
│   └─ 项目维度（可折叠）：复用 HomeProjectRow（pages/home.tsx:312），点击 = projectFilter
├─ 右列
│   ├─ HomeSessionSearch（复用，跨项目全量搜索；结果行带项目名已有）
│   ├─ 置顶组「继续上次」（pinLastActive 命中时）：HomeSessionGroupHeader + HomeSessionRow
│   └─ groupSessions 分组（今天/昨天/更早）：HomeSessionGroupHeader + HomeSessionRow
└─ 行内：SessionModeBadge（会话行标题后）
```

网格：`mx-auto grid h-full max-w-[1200px] grid-cols-[220px_minmax(0,1fr)]`（右列内部列表仍用现有时分组样式）。

### 6.2 countByMode（纯函数）

```ts
// home-overview-model.ts
export function countByMode(records: ReadonlyArray<{ session: { mode?: ProductMode } }>) {
  const count = { coding: 0, chat: 0, work: 0 }
  for (const r of records) {
    const m = r.session.mode
    if (m === "chat" || m === "work") count[m] += 1
    else count.coding += 1 // undefined 归 coding（D3）
  }
  return count
}
```

### 6.3 lastActiveSession 记忆（context/global.tsx）

```ts
const [lastActiveStore, setLastActiveStore] = persisted(
  Persist.global("lastActiveSession", ["last-active-session.v1"]),
  createStore({} as Record<string, { directory: string; sessionID: string }>),
)
const lastActiveSession = {
  get(scope: ServerScope) { return lastActiveStore[scope] },
  set(scope: ServerScope, value: { directory: string; sessionID: string }) {
    setLastActiveStore(scope, value)
  },
}
// sessionPlacement.onSet 内追加：
lastActiveSession.set(server.scope(serverKey), { directory, sessionID: leafID })
```

写入信号：`sessionPlacement.onSet(serverKey, directory, leafID)`——打开会话（首页/模式首页/搜索）、发送、导航均经此。**注意：`onSet` 现状签名仅 `(server, directory)`（session-placement.ts:9,32），需先改 `utils/session-placement.ts` 的类型与传参（`input.leafID` 在 `set` 内可用），再改 `global.tsx` 回调**；8 处 `sessionPlacement.set` 调用点（app.tsx / mode-workspace-slots.tsx / titlebar.tsx / secondary-sidebar.tsx / submit.ts / directory-layout.tsx）零改动，实施时逐一核对。tab 栏纯切换（不重开会话）不写——可接受，置顶反映"最后打开的会话"。

### 6.4 pinLastActive（纯函数）

```ts
export function pinLastActive<T extends { session: Session }>(
  records: ReadonlyArray<T>,
  lastActive: { directory: string; sessionID: string } | undefined,
): { pinned?: T; rest: T[] } {
  if (!lastActive) return { rest: [...records] }
  const idx = records.findIndex(
    (r) => pathKey(r.session.directory) === pathKey(lastActive.directory) && r.session.id === lastActive.sessionID,
  )
  if (idx === -1) return { rest: [...records] } // 已归档/不存在 → 无置顶
  return { pinned: records[idx], rest: records.filter((_, i) => i !== idx) }
}
```

### 6.5 openSessionRecord 共享函数（helpers.ts）

```ts
export function openSessionRecord(input: {
  record: HomeSessionRecord
  conn: ServerConnection.Any            // 已解析的 focusedServer 连接（现有 openSession 语义）
  server: ServerConnection.Key
  global: ReturnType<typeof useGlobal>
  tabs: ReturnType<typeof useTabs>
  projects: { open: (d: string) => void; touch: (d: string) => void }
  projectByID: Map<string, LocalProject>
  setMode?: (mode: Mode) => void        // 首页传入 useMode().setCurrentMode
}) {
  const { session } = input.record
  const project = projectForSession(session, input.projects.list(), input.projectByID)
  const directory = project?.worktree ?? session.directory
  const ctx = input.global.ensureServerCtx(input.conn)
  input.global.sessionPlacement.set({ server: input.server, leafID: session.id, rootID: session.id, directory: session.directory })
  input.projects.open(directory)
  input.projects.touch(directory)
  if (input.setMode && isMode(session.mode)) input.setMode(session.mode)  // 模式同步（关键新增）
  void startTransition(() => {
    const tab = input.tabs.addSessionTab({ server: input.server, sessionId: session.id })
    input.tabs.select(tab)
  })
}
```

> 签名以 `mode-workspace-slots.tsx:287-305` 现有 `openSession` 为准逐行对照迁移（`projects.list` 仅用于 `projectForSession`，随 `projects` 传入或内部求值）。`CodingSessionListMain.openSession` 迁移后行为必须不变（回归测试覆盖）。

### 6.6 SessionModeBadge

```tsx
// components/session-mode-badge.tsx
export function SessionModeBadge(props: { mode?: ProductMode }) {
  const language = useLanguage()
  const m = props.mode && isMode(props.mode) ? props.mode : "coding" // D3
  return (
    <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-px text-[9px] leading-none text-v2-text-text-muted">
      {language.t(modeDefinition(m).labelKey)}
    </span>
  )
}
```

### 6.7 路由（app.tsx）

```tsx
// 删除 HomeRedirect；替换为：
<Route path="/" component={HomeOverview} />
```

`/mode/:mode` 不变；`layout.route()` 对 `/` 的 type 已为 "home"（titlebar matchRoute 已处理 `route.type === "home"` return，titlebar.tsx:284），无连锁改动。

## 7. i18n 新增 key（18 语言文件全量补齐，parity.test.ts 校验）

```
home.overview.title          // 首页
home.overview.continue       // 继续上次
home.overview.all            // 全部会话
home.overview.modeFilter     // 模式筛选（左列分组标题）
home.overview.projectFilter  // 项目（左列分组标题）
```

翻译策略：zh/zht 正常翻译；其余语言可先用英文原文占位（与现有新增 key 惯例一致，parity 只校验 key 集合）。实施后运行 `bun --cwd packages/app test parity` 确认。

## 8. ADR-16 要点（docs/architecture/adr/ADR-16-global-home-overview.md）

- Amends ADR-15 §对齐（Home 语义）：`/` 恢复为真实页面 = **全局聚合首页**（独立路由组件，非 ModeWorkspace slot、非"Home 自绘伪四区"）
- 合规声明：不复制共享 workspace（复用导出组件）；无 slot remount 闪烁（首页为路由级组件，进入/离开 remount 属路由正常语义）；Chat 功能树无重复实例化
- 新增契约：顶栏左侧为全局主页入口；rail 语义锁定为"模式切换"；`/mode/:mode` 为模式首页唯一权威路由
- 后续开闸：任务列表/定时列表/助手统计以首页区块或独立 slot 扩展（对齐 ADR-15 typed slot 范式）

## 9. 测试计划

| 测试 | 位置 | 断言 |
|---|---|---|
| `countByMode` | home-overview-model.test.ts | chat/work/undefined→coding 计数正确 |
| `pinLastActive` | 同上 | 命中置顶/未命中全量回落/归档后无置顶/目录 pathKey 归一 |
| `openSessionRecord`（可选，若提取为可测纯函数） | helpers.test.ts | 模式同步仅在 isMode 时触发；placement 参数正确 |
| HomeOverview 存在性 | home-overview.test.tsx | 导出 `HomeOverview`、`HomeOverviewSidebar`、`SessionModeBadge` 于预期文件（对齐 mode-workspace.test.tsx 风格） |
| 回归 | 现有 home.test.ts / mode-workspace.test.tsx | 保持绿（openSession 迁移不改行为） |
| i18n parity | packages/app test parity | 新 key 全语言一致 |

运行：`bun --cwd packages/app test --preload ./happydom.ts ./src`（新增/改动测试的首次运行；**不要用 `--only-failures`，否则新文件不会执行**）；日常回归：`bun --cwd packages/app run test:unit`（脚本即 `bun test --only-failures --preload ./happydom.ts ./src`）。类型：`bun --cwd packages/app typecheck`（tsgo -b）。

## 10. 实施步骤（TDD 循环，小步提交）

### TDD 工作流约定（每步强制）

每步执行 `RGR` 循环：**R（Red）写/改测试并确认失败 → G（Green）最小实现 → R（Refactor）重构**。进入每小节前先完成「协议阅读」（阅读清单见各小节），输出中引用所读文档结论（对齐 CLAUDE.md：以认真查询为荣、以跳过验证为耻）。

前置阅读（Step 0，必读）：
- `CLAUDE.md`（四绝八耻）、根 `AGENTS.md`（分支/提交/Effect/Schema/测试约定）、`packages/app/AGENTS.md`（测试与 dev 约束）
- `ARCHITECTURE.md` §4.10（ModeWorkspace 架构）、ADR-11/12/13/14/15（模式演进链）

| 步骤 | 协议阅读（该小节必读） | 测试先行（红） | 实现（绿） | 重构/验证 |
|---|---|---|---|---|
| 1. ADR-16 | ADR-15 §对齐、ADR-12 §2/§4（导航控件与 canonical route 契约）、ADR-13 模式定位表 | —（文档交付物，无测试） | 撰写 ADR-16 | 与 ADR-12 §2「rail/Home 卡片为导航控件」契约逐条对照 |
| 2. i18n | `packages/app/src/i18n/parity.test.ts`（key 集合校验机制） | 先给 en.ts 加新 key，跑 parity 确认**红**（其余语言缺失） | 18 文件补齐 | `bun --cwd packages/app test --preload ./happydom.ts ./src/i18n` 绿 |
| 3. icon home | `packages/ui/src/v2/components/icon.tsx`（现有图标风格：16x16 stroke） | —（纯资产，无测试先例；手动验证渲染） | 新增 `home` 条目 | 与 `mode-chat` 等 stroke 风格对照 |
| 4. 纯函数 | `packages/app/src/pages/home.test.ts`（现有纯函数测试风格）、`helpers.ts:37-44`（mode 过滤语义） | `home-overview-model.test.ts`：`countByMode`（chat/work/undefined→coding）、`pinLastActive`（命中/未命中/归档/pathKey 归一）→ **红** | `home-overview-model.ts` 最小实现 | 断言对照 D3 语义；并入测试运行范围 |
| 5. 记忆 | `utils/session-placement.ts`（onSet 签名）、`context/global.tsx:22-38`（lastSession 模式）、`Persist.global` 用法 | 若 extract 可测：onSet 签名变更契约测试（可选）；否则以步骤 4 纯函数 + 步骤 7 组件测试覆盖 | `session-placement.ts` onSet 扩 leafID → `global.tsx` `lastActiveSession` + 写入 | 8 处调用点 grep 核对零改动；`bun --cwd packages/app typecheck` |
| 6. 共享函数 | `mode-workspace-slots.tsx:287-305`（现有 openSession 逐行） | 无独立测试先例（依赖 Solid 组件）；以**迁移后 coding 模式回归**为红绿灯（mode-workspace.test.tsx + 手动） | `helpers.ts` `openSessionRecord`；`CodingSessionListMain.openSession` 改调 | 行为对照：placement/tab/transition 逐行一致；typecheck |
| 7. 首页组件 | `pages/home.tsx`（HomeSessionRow/Search/GroupHeader/HomeProjectRow props 契约）、`mode-workspace-slots.tsx:169-305`（focusedServer/数据管道参考）、`components/work-secondary-sidebar.tsx`（左侧栏模式匹配先例） | `home-overview.test.tsx` 存在性+导出断言 → **红**；左列项目行契约（B-2）先写进测试 | `home-overview.tsx` + `session-mode-badge.tsx` | 手动走查（§11 验收清单）；回归现有测试 |
| 8. 路由与顶栏 | `app.tsx:564-577`（Routes/HomeRedirect）、`layout.tsx:36-38`（`/` 隐藏 rail）、`titlebar.tsx:283-306`（route type "home" 处理） | —（路由/外壳，组件测试覆盖弱；以手动验收为绿） | app.tsx `/` → `<HomeOverview/>`；titlebar V2 分支插主页按钮 | `layout.route()` 对 `/` 为 `{type:"home"}`（app.tsx:126 已实证）；手动：会话页点 home 回 `/` |
| 9. 宽度对齐 | `mode-workspace.tsx:140-145`（三模式网格现状） | —（纯样式） | chat 网格 `max-w-[1080px] lg:grid-cols-[280px_minmax(0,960px)]` | 手动三模式切换目检 |
| 10. 验证 | 全量回归清单（§9） | `bun --cwd packages/app test --preload ./happydom.ts ./src` + `typecheck` | — | 手动走查（backend 4096 + app 4444）：聚合/置顶/筛选/跳转模式同步/顶栏 home/chat 宽度 |

提交规范（根 AGENTS.md）：分支 ≤3 词（如 `global-home`），commit 用 `feat(app): ...` 前缀，每步独立提交。

## 11. 风险与未决项

- **tab 纯切换不写置顶**：置顶反映"最后打开/发送的会话"，tab 栏纯切换（已打开会话间切换）不更新——可接受，如需覆盖则补写点在 useTabs.select，标注后续
- **旧会话 mode=undefined**：聚合页显示为 coding 徽标（D3），点击跳转不强制改模式（§6.5）
- **多 server**：本期按当前 server 聚合（D5）；后续开闸需遍历 `global.servers.list()` 合并 records
- **i18n 18 语言**：占位英文可过 parity，翻译留待产品确认
- **icon 一致性 "C" 问题**：不在本期（§1.3）
- **useChatDirectory 无 provider 依赖**（mode-workspace-context.ts:39-54，纯 hook，消费 global/server/lastSession）——跳转 chat/work 会话后 SecondarySidebar 对应分支渲染安全，已实证，非风险

## 12. 审批记录（Review，2026-08-10）

> 审批人：高级全栈开发顾问。依据：CLAUDE.md 四绝八耻（认真查询/主动测试/遵循规范）、根 AGENTS.md（TDD/Effect/提交规范）、packages/app/AGENTS.md（happydom 测试基座）、ADR-12/15、ARCHITECTURE §4.10、SDK/Core/Server 五层代码实证。

### 结论：有条件通过（Conditional Approve）

### A 类 — 必须修正（已修订进正文）

| # | 问题 | 修正 |
|---|---|---|
| A-1 | §6.3 声称"onSet 已能拿到 leafID，仅改回调签名"——错误：`utils/session-placement.ts:9,32` 的 `onSet` 类型签名是 `(server, directory)`，需改该文件类型与传参（`set` 入参含 `leafID` 可用），且 §5.2 修改清单**漏列 session-placement.ts** | 已加清单行 + 修正 §6.3 |
| A-2 | §9 测试命令错误：packages/app 的 test script 为 `test:unit`（`bun test --only-failures --preload ./happydom.ts ./src`），`--only-failures` 不执行新文件，且组件测试需 happydom preload | 已修正为首次全量 + 回归两条命令 |
| A-3 | §6.5 `openSessionRecord` 签名含糊（`ensureServerCtx(...)` 未定参） | 已改为显式 `conn: ServerConnection.Any`，以 mode-workspace-slots.tsx:287-305 逐行对照迁移 |

### B 类 — 实施前必须明确的决策（已写入步骤 7 红绿灯）

| # | 问题 | 决策 |
|---|---|---|
| B-1 | 首页左列项目行复用 `HomeProjectRow`（home.tsx:312）会携带全套菜单（edit/close/clearNotifications/new session），首页仅需"点击过滤" | **复用 HomeProjectRow 全量**（项目管理菜单与 coding 模式左列能力对齐，避免双份项目行实现）；`openNewSession`/`editProject` 等 props 由首页按 CodingProjectColumnSidebar 同款逻辑提供（mode-workspace-slots.tsx:67-109） |
| B-2 | 首页搜索复用 `HomeSessionSearch` 的 `bindFocus` | 首页传空函数（同 mode-workspace-slots.tsx:351 先例） |
| B-3 | chat 网格宽度取值 | 收敛至 work 同级 1080/960（D4）；coding 720 保持，标注产品可再评审 |

### C 类 — 工作流强化（已并入 §10）

- 全步骤升级为 RGR（红→绿→重构）循环，每小节前置"协议阅读"清单并输出引用结论
- 步骤 2/4/6/7 显式红绿灯（parity 红、纯函数红、回归红、存在性红）
- 提交规范（分支 ≤3 词、`feat(app):` 前缀、每步独立提交）已并入

### 批准范围

自步骤 1（ADR-16）起按 §10 顺序执行；A 类修正已生效；B 类决策按上表执行；若实施中发现与本文档不符的接口事实，遵循 CLAUDE.md「以诚实无知为荣」，停下核实并更新本记录。
