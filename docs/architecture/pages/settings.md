# Settings System 架构

> 状态：草案 v3.0，企业级架构文档
> 代码基线：packages/app/src/context/settings.tsx + components/settings-v2/

---

## 1. 定位与职责

Settings 系统管理用户偏好设置的持久化、读取和 V2 UI。架构：Effect persisted store -> SettingsProvider context -> V2 对话框组件。所有设置都是 Accessor + setter 对，变更即持久化。

---

## 2. 上游入口链路

```
AppInterface (app.tsx)
  -> SettingsProvider (context/settings.tsx)
    -> persisted("settings.v3", createStore(defaultSettings))
      -> 所有子组件通过 useSettings() 消费

UI entry:
  SettingsButton -> dialog.show(<DialogSettings />)
    -> DialogSettings (components/settings-v2/dialog-settings-v2.tsx)
      -> TabsV2 (vertical, defaultValue="general")
```

---

## 3. Settings Schema (与代码严格对齐)

```ts
// context/settings.tsx:21
interface Settings {
  general: {
    autoSave: boolean
    releaseNotes: boolean
    followup: "queue" | "steer"
    showFileTree: boolean
    showNavigation: boolean
    showSearch: boolean
    showStatus: boolean
    showTerminal: boolean
    showReasoningSummaries: boolean
    shellToolPartsExpanded: boolean
    editToolPartsExpanded: boolean
    showSessionProgressBar: boolean
    showCustomAgents: boolean
    mobileTitlebarPosition: "top" | "bottom"
  }
  appearance: {
    fontSize: number
    mono: string // 等宽字体
    sans: string // UI 字体
    terminal: string // 终端字体
  }
  keybinds: Record<string, string>
  permissions: {
    autoApprove: boolean
  }
  notifications: NotificationSettings
  sounds: SoundSettings
}
```

---

## 4. V2 Settings UI 组件树 (5 tabs)

```
DialogSettings (dialog-settings-v2.tsx:20)
  TabsV2 defaultValue="general"
  Section: Desktop
  ├── Tab: general    -> SettingsGeneralV2 (general.tsx)
  │     ├── general preferences: autoSave, releaseNotes, followup
  │     ├── visibility toggles: fileTree/search/status/terminal/navigation/progress/customAgents
  │     ├── display toggles: reasoning summaries, shell/edit tool part expansion
  │     ├── appearance rows: fontSize, mono, sans, terminal
  │     ├── permissions: autoApprove
  │     ├── notifications / sounds
  │     └── mobileTitlebarPosition selector (mobile only)
  └── Tab: shortcuts  -> SettingsKeybinds (settings-keybinds.tsx)
        ├── command search
        └── keybinding recorder

  Section: Server
  ├── Tab: servers    -> SettingsServersV2 (servers.tsx)
  │     ├── server list
  │     ├── add server
  │     └── delete server
  ├── Tab: providers  -> SettingsProvidersV2 (providers.tsx)
  │     ├── provider list
  │     └── connect provider
  └── Tab: models     -> SettingsModelsV2 (models.tsx)
        ├── provider model list
        └── model enable/disable
```

---

## 5. 数据流架构

### 5.1 读取

```
useSettings() -> settings.general.showFileTree()
  -> withFallback(store.general?.showFileTree, default)
    -> store.general.showFileTree ?? defaultSettings.general.showFileTree
    -> 返回 createMemo Accessor<boolean>
```

### 5.2 写入

```
settings.general.setShowFileTree(true)
  -> setStore("general", "showFileTree", true)
    -> persisted() 拦截器 -> localStorage.setItem()
    -> 所有 memo 自动 recompute
```

### 5.3 默认值

```
withFallback(read, default):
  store 有值 -> 读取 store
  store 无值 -> 回退 default
  非 prod channel: 部分功能默认开启
```

---

## 6. Visibility 子系统

```
settings.visibility = {
  fileTree: showFileTree
  search: showSearch
  status: showStatus
  customAgents: showCustomAgents
}
// V2 模式下直接透传 preferences
```

---

## 7. Keybindings 系统

```
settings.keybinds: Record<string, string>
  -> command.id -> key combo (e.g. "mod+shift+s")
  -> SettingsKeybinds: 命令搜索 + 按键录制
  -> useCommand().keybind("command.id"): 读取绑定
  -> TooltipKeybind: 在 Tooltip 中渲染快捷键
```

---

## 8. 持久化

| 要素   | 说明                                     |
| ------ | ---------------------------------------- |
| Key    | "settings.v3"                            |
| 存储   | localStorage (同步) + 工作区文件 (异步)  |
| 格式   | JSON, Schema 版本化                      |
| 默认值 | withFallback + utils/settings-default.ts |

---

## 9. 错误边界

| 场景                | 处理                       |
| ------------------- | -------------------------- |
| Store 读取失败      | withFallback 回退默认值    |
| localStorage 不可用 | persisted() 内部 try/catch |
| 无效设置值          | Schema decode + fallback   |

---

## 10. 上下游文件索引

| 层级          | 文件                                          |
| ------------- | --------------------------------------------- |
| Provider 实现 | context/settings.tsx                          |
| 持久化        | utils/persist.ts                              |
| V2 UI 入口    | components/settings-v2/dialog-settings-v2.tsx |
| V2 General    | components/settings-v2/general.tsx            |
| V2 Keybinds   | components/settings-keybinds.tsx              |
| V2 Servers    | components/settings-v2/servers.tsx            |
| V2 Providers  | components/settings-v2/providers.tsx          |
| V2 Models     | components/settings-v2/models.tsx             |
| SettingsRowV2 | components/settings-v2/parts/row.tsx          |
| i18n          | i18n/en.ts (settings 小节)                    |
