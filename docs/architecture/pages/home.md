# Home 页面架构

> 状态：草案 v3.0，企业级架构文档
> 代码基线：packages/app/src/pages/home.tsx
> 路由：/

---

## 1. 定位与职责

Home 是应用入口页面——项目发现、Session 搜索、最近会话快速恢复的聚合中枢。所有路由均需经过 Home 确认活跃服务器连接。

---

## 2. 上游入口链路

```
URL: /
  -> app.tsx Routes: <Route path="/" component={Home} />
  -> Home 组件直接渲染
  -> 已通过 ConnectionGate 门禁
  -> 无需额外 SDK/Sync Provider (使用全局 ServerSync)
```

---

## 3. 页面布局与组件树

```
Home
├── Header
│   ├── SearchInput          — 搜索 Sessions (searchQuery signal)
│   └── ServerPicker         — 服务器选择器
│
├── ProjectSection
│   ├── ProjectCard[]        — 已打开项目列表
│   │   ├── ProjectAvatar    — 项目图标/缩写
│   │   ├── ProjectName      — 项目名称
│   │   └── DirectoryPath    — 本地路径
│   └── OpenProjectButton    — chooseProject() 触发
│
├── SessionSection
│   ├── TodayGroup           — 今天创建的 Sessions
│   │   └── SessionCard[]    — Session 卡片 (名称/时间/预览)
│   ├── YesterdayGroup       — 昨天创建的 Sessions
│   └── OlderGroup           — 更早的 Sessions
│
└── BottomBar
    └── SettingsButton       — gear 图标 -> DialogSettings
```

---

## 4. Context 依赖图

| 层级 | Context | 用途 |
|------|---------|------|
| 全局 | useServerSync | 服务器 children() 目录列表 |
| 全局 | useServer | 活跃服务器 + 连接列表 |
| 全局 | useLayout | 项目元数据 (byDirectory / byID) |
| 全局 | useTabs | Session Tab 生命周期 |
| 全局 | useGlobal | sessionPlacement 缓存 |
| 全局 | useDialog | 模态对话框堆栈 |
| 全局 | usePlatform | 平台检测 (desktop/web/mobile) |
| 全局 | useCommand | 键盘快捷键注册 |
| 全局 | useLanguage | i18n 翻译 |
| 全局 | useMarked | Markdown 渲染 |

---

## 5. 数据流架构

### 5.1 项目数据流

```
ServerSyncProvider.children()
  -> projectDirectories createMemo
    -> layout.project.byDirectory -> projects createMemo
      -> buildHomeSessionRecords(sync, projects, ...)
        -> homeSessionRecords createMemo
          -> buildHomeSessionGroups -> sessionGroups createMemo
            -> For 组件渲染分组列表
```

### 5.2 搜索流

```
searchQuery signal (用户输入)
  -> filteredRecords memo (query.trim().toLowerCase() 模糊匹配)
    -> 搜索模式: 搜索框下方展示结果
    -> 无结果: empty message
```

### 5.3 路由跳转流

```
点击 Session 卡片
  -> navigate("/server/:serverKey/session/:rootID")
  -> URL 中不编码 Mode (见 docs/architecture/adr/ADR-09-mode-route-decoupling.md)
  -> TabsProvider.addSessionTab() 自动添加
  -> TargetSessionRoute 解析 placement
```

---

## 6. 项目选择生命周期

```
用户点击 Open Project
  -> useDirectoryPicker().chooseProject()
    -> directory-picker.tsx UI
    -> onSelect(directory)
      -> layout.project.open(directory)
      -> ServerSync 加载新目录
      -> projectSelections store 更新
```

---

## 7. 错误与边界处理

| 场景 | 处理 |
|------|------|
| 无项目 | 引导 UI — 打开项目的提示 |
| 搜索为空 | "No results found" 反馈 |
| Session 加载中 | createResource loading 状态 |
| 服务器断开 | ConnectionGate 401 门禁 |
| settings 开关关闭 | showStatus / showFileTree 隐藏对应 UI |

---

## 8. 性能考虑

- sessions 列表 createMemo 缓存，仅依赖变化时重算
- buildHomeSessionRecords 含去重逻辑
- sessionGroups 过滤空组，避免空 header 渲染
- filteredRecords memo 中仅匹配 name/directory，非深搜

---

## 9. 上下游文件索引

| 层级 | 文件 |
|------|------|
| 路由定义 | app.tsx (Routes -> <Route path="/" component={Home} />) |
| 组件实现 | pages/home.tsx |
| 项目数据 | context/layout.tsx (useLayout) |
| 数据同步 | context/server-sync.ts (useServerSync) |
| Session 构建 | pages/home.tsx (buildHomeSessionRecords, buildHomeSessionGroups helpers) |
| 目录选择器 | components/directory-picker.tsx (useDirectoryPicker) |
| 对话框 | components/dialog-settings.tsx |
| 持久化 | context/settings.tsx + utils/persist.ts |
