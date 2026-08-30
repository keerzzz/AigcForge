# Home 页面架构

> 状态：草案 v4.0，企业级架构文档
> 代码基线：packages/app/src/pages/home-overview.tsx（全局聚合首页，ADR-16）+ packages/app/src/pages/home-shared.tsx（共享 Session 构件 owner）+ packages/app/src/pages/coding-project-column.tsx（Coding 项目树 owner）
> 路由：/（HomeOverview，ADR-16）；/mode/:mode（ModeWorkspace，ADR-12/15）
> 历史：v1-v3 描述 `pages/home.tsx` 单体 Home；该文件已按 `docs/plan/mode-page-unification-v2.md` Phase 1 拆除，共享构件迁入 `home-shared.tsx`，Coding 项目树迁入 `coding-project-column.tsx`。

---

## 1. 定位与职责

- `/` 渲染 `HomeOverview`（全局聚合首页）：跨模式会话列表 + 模式筛选 + 项目筛选 + 「继续上次」置顶 + 会话搜索（ADR-16）。
- `/mode/:mode` 渲染共享 `ModeWorkspace`，各模式首页（Coding 会话列表 / Chat 资产工作台 / Work 预设 + 会话 / Assistant 实体 + 会话）通过 typed slot 承载（ADR-15）。
- `home-shared.tsx` 是所有模式会话列表的共享数据管线与纯展示组件 owner，不持有页面外壳。
- `coding-project-column.tsx` 是 Coding 项目/服务器树 owner（保留 `HomeProjectColumn`/`HomeProjectRow` 兼容名称，不再是 Home 页面 owner）。

---

## 2. 上游入口链路

```
URL: /
  -> app.tsx Routes: <Route path="/" component={HomeOverview} />
  -> HomeOverview 直接渲染
  -> 已通过 ConnectionGate 门禁
  -> 无需额外 SDK/Sync Provider (使用全局 ServerSync)

URL: /mode/:mode
  -> ModeRoute 校验并激活 currentMode
  -> ModeWorkspace render-all slots（display:none 保持状态，ADR-15 §4）
```

---

## 3. Owner 边界

| Owner                 | 文件                        | 职责                                                                                                                                                                                                                  |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global Home 页面      | `home-overview.tsx`         | all/mode/project 筛选、lastActive 置顶、badge、全量 Session 搜索、查询生命周期                                                                                                                                        |
| Home Session 共享构件 | `home-shared.tsx`           | `HOME_SESSION_LIMIT`、`HomeSessionRecord/Group`、`buildHomeSessionRecords`、`matchesHomeSessionSearch`、`homeSessionSearchKey`、`groupSessions`、`HomeSessionLeading/Search/SearchResultRow/GroupHeader/Row/Skeleton` |
| Coding 项目树         | `coding-project-column.tsx` | `HomeProjectColumn`/`HomeProjectRow` + server/project 行、多 server/多项目选择、项目操作、通知、Coding 新建会话                                                                                                       |
| 页面 owner 内联       | `mode-workspace-slots.tsx`  | Coding 预取/搜索状态、Work 预设、各模式查询生命周期                                                                                                                                                                   |

`home-shared.tsx` 不再拥有 Coding 项目树；`coding-project-column.tsx` 不是 Home 页面 owner，也不得替换为 `ModeLocationNewSession`（Work/Assistant 才消费后者；Chat 的 Location 由 `ChatFeatureSidebar` 内联持有）。

---

## 4. 页面布局与组件树（HomeOverview）

```
HomeOverview
├── 左列
│   ├── ModeFilter        — 模式筛选（all/mode）
│   └── ProjectFilter     — 项目维度（复用 HomeProjectRow 点击过滤）
├── 主列
│   ├── HomeSessionSearch — 全量 Session 搜索（home-shared）
│   ├── ContinueGroup     — 「继续上次」置顶（pinLastActive）
│   ├── SessionGroup[]    — HomeSessionGroupHeader + HomeSessionRow（home-shared）
│   └── Empty/Loading     — HomeSessionSkeleton / 空态 + 新建按钮
```

## 5. 数据流架构

### 5.1 会话数据流（各页面 owner 共享 `home-shared` 纯管线）

```
ServerSyncProvider.children()
  -> projectDirectories createMemo
    -> layout.project.byDirectory -> projects createMemo
      -> buildHomeSessionRecords(sync, projects, ...)   (home-shared)
        -> homeSessionRecords createMemo
          -> filterSessionsByMode(...) (页面 owner)      -> groupSessions(...) (home-shared)
            -> For 组件渲染分组列表
```

查询/预取生命周期由页面 owner（Coding/Work/Assistant/HomeOverview）各自持有，共享模块不持有 `useQuery`、prefetch 或 lastActive。

### 5.2 搜索流

```
query signal（用户输入）
  -> 页面 owner 过滤（mode/project）
  -> matchesHomeSessionSearch(record, query)  (home-shared)
    -> HomeSessionSearch 展示结果（home-shared）
```

Coding 项目搜索、Chat 资产/文件搜索为各自领域 owner，不复用 HomeSessionSearch。

### 5.3 路由跳转流

```text
点击 Session 卡片
  -> openSessionRecord（helpers.ts）
  -> navigate("/server/:serverKey/session/:rootID")
  -> URL 中不编码 Mode (ADR-09)
  -> TabsProvider.addSessionTab() 自动添加
  -> TargetSessionRoute 解析 placement
```

普通新建入口通过 `launchModeSession`（`pages/layout/helpers.ts`）复用项目 open/touch 生命周期；页面 owner 仍负责 mode、初始 prompt 和 Draft overrides，资产选择器保留自己的资产 prompt 生命周期。

### 5.4 Product Mode 模块入口流

```text
点击 ModeSwitcher / Home 模式卡片
  -> modeHref(mode)
  -> navigate("/mode/:mode")
  -> ModeRoute 校验并激活 currentMode
  -> ModeWorkspace / SecondarySidebar 使用 mode-scoped selectors
  -> 不调用 tabs.newDraft()，不创建/恢复 Session，不选择 Tab，不改变 Agent
```

---

## 6. 错误与边界处理

| 场景                              | 处理                                               |
| --------------------------------- | -------------------------------------------------- |
| 无项目                            | 引导 UI — 打开项目的提示                           |
| 搜索为空                          | "No results found" 反馈                            |
| Session 加载中                    | createResource loading 状态（HomeSessionSkeleton） |
| 当前 Mode 无 Session              | Mode-scoped 空状态 + 显式新建入口，不自动创建      |
| 当前 route Session 与 Mode 不一致 | 保留当前 Session，显示紧凑归属提示                 |
| 服务器断开                        | ConnectionGate 401 门禁                            |
| settings 开关关闭                 | showStatus / showFileTree 隐藏对应 UI              |

## 7. 性能考虑

- sessions 列表 createMemo 缓存，仅依赖变化时重算
- buildHomeSessionRecords 含去重逻辑
- groupSessions 过滤空组，避免空 header 渲染
- filteredRecords memo 中仅匹配 name/directory，非深搜
- render-all + display:none 保持模式 slot 状态（ADR-15 §4），切换不 remount

## 8. 上下游文件索引

| 层级              | 文件                                                               |
| ----------------- | ------------------------------------------------------------------ |
| 路由定义          | app.tsx (Routes -> <Route path="/" component={HomeOverview} />)    |
| 全局首页          | pages/home-overview.tsx                                            |
| 共享 Session 构件 | pages/home-shared.tsx                                              |
| Coding 项目树     | pages/coding-project-column.tsx                                    |
| 项目数据          | context/layout.tsx (useLayout)                                     |
| 数据同步          | context/server-sync.ts (useServerSync)                             |
| Session 构建      | pages/home-shared.tsx (buildHomeSessionRecords, groupSessions)     |
| 打开会话          | pages/layout/helpers.ts (openSessionRecord, openProjectNewSession) |
| 目录选择器        | components/directory-picker.tsx (useDirectoryPicker)               |
| 对话框            | components/dialog-settings.tsx                                     |
| 持久化            | context/settings.tsx + utils/persist.ts                            |
