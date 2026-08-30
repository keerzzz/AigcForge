# Server Connection Management 架构

> 状态：草案 v3.0，企业级架构文档
> 代码基线：packages/app/src/context/server.tsx + utils/server-scope.ts + utils/server-health.ts

---

## 1. 定位与职责

Server 管理系统负责多服务器连接的注册、选择、健康检查和路由分发。支持本地 sidecar 和远程 HTTP 服务器。所有路由需通过 ConnectionGate 健康门禁。

---

## 2. 上游入口链路

```
AppInterface (app.tsx)
  -> ServerProvider (props: defaultServer, canonicalLocalServer, servers)
    -> GlobalProvider -> SettingsProvider
    -> ConnectionGate (健康检查门禁)
      -> TabsProvider -> ...
```

---

## 3. 组件与 Provider 树

```
ServerProvider
├── server.key: Accessor<Key>         — 当前活跃
├── server.current: ServerConnection   — 连接详情
├── server.list: ServerConnection[]    — 全部已注册
├── server.setActive(key): void        — 切换活跃服务器
└── server.add(conn): void             — 注册新连接

ConnectionGate
├── 阻塞模式 (blocking)
│   ├── Splash 动画
│   └── checkServerHealth() 轮询
├── 后台模式 (background)
│   ├── ConnectionError UI
│   ├── 其他服务器列表
│   └── 自动重试 (每 1s)
└── 通过 -> 渲染子组件

ServerKey (门禁组件)
  -> Show when={server.key} keyed -> 子组件

SelectedServerProviders
  -> ServerKey -> ServerSDKProvider -> ServerSyncProvider
```

---

## 4. ServerScope 与 Key 体系

```
ServerScope = "local" | string-brand

fromServerKey(key, canonicalLocalServer):
  "sidecar" 或 canonicalLocalServer -> "local"
  其他 -> 完整 URL

SessionRouteKey.fromRoute(dir, sessionID): SessionRouteKey
SessionStateKey.from(scope, route): SessionStateKey
SessionStateKey.scope(key): ServerScope
SessionStateKey.route(key): SessionRouteKey

完整 Key: "local\0home/keer/project/session-123"
分隔符: \0 (NUL byte)
```

---

## 5. 数据流架构

### 5.1 健康检查

```
ConnectionGate
  -> checkServerHealth(server.http)
    -> HTTP: fetch health endpoint -> { healthy: bool }
    -> 非 HTTP: 无限重试 (10s timeout fallback)
  -> blocking 状态: Splash 动画
  -> background 状态: 错误 UI + 每 1s 自动重试
  -> 用户可切换到其他服务器
```

### 5.2 Session Placement 解析

```
TargetSessionRoute
  -> requireServerKey(params.serverKey)
  -> ServerSDKProvider + ServerSyncProvider
  -> global.sessionPlacement.get(key, id)
    -> 缓存命中 -> 直接用 placement
    -> 缓存未命中 -> createResource:
      -> sdk.client.session.get({ sessionID })
      -> rootSession() 递归查根
      -> global.sessionPlacement.set({ server, leafID, rootID, directory })
```

### 5.3 服务器切换

```
DialogSelectServer.onSelect(conn)
  -> controller.select(conn)
  -> server.setActive(key)
  -> navigate("/")
  -> GlobalProvider + SettingsProvider 重新初始化
```

---

## 6. Context 依赖图

| 层级   | Context              | 用途                  |
| ------ | -------------------- | --------------------- |
| 全局   | ServerProvider       | 服务器连接生命周期    |
| 全局   | GlobalProvider       | sessionPlacement 缓存 |
| 全局   | SettingsProvider     | 持久化设置            |
| 全局   | ServerSDKProvider    | 服务器级 SDK 客户端   |
| 组件内 | ServerKey            | 服务器门禁            |
| 组件内 | ConnectionGate       | 健康检查门禁          |
| 工具   | ServerScope/StateKey | 数据隔离命名空间      |

---

## 7. 持久化

| Key                                            | 用途               |
| ---------------------------------------------- | ------------------ |
| Persist.global("servers")                      | 已注册服务器列表   |
| Persist.global("server")                       | 当前活跃服务器 Key |
| Persist.serverScoped(scope, dir, session, key) | 服务器级隔离数据   |

---

## 8. 错误边界

| 场景             | 处理                          |
| ---------------- | ----------------------------- |
| 服务器不可达     | ConnectionError UI + 自动重试 |
| HTTP timeout     | 10s 超时 -> background 模式   |
| Session 解析失败 | ErrorPage (Sentry capture)    |
| 无可用服务器     | ConnectionError + 引导添加    |
| 重复连接         | controller.select 去重        |

---

## 9. 上下游文件索引

| 层级          | 文件                                                         |
| ------------- | ------------------------------------------------------------ |
| Provider 实现 | context/server.tsx                                           |
| 全局状态      | context/global.tsx                                           |
| Key 体系      | utils/server-scope.ts                                        |
| 健康检查      | utils/server-health.ts                                       |
| 服务器选择 UI | components/dialog-select-server.tsx                          |
| 路由容器      | app.tsx (ConnectionGate, ServerKey, SelectedServerProviders) |
| SDK Provider  | context/server-sdk.tsx                                       |
| 同步 Provider | context/server-sync.tsx                                      |
