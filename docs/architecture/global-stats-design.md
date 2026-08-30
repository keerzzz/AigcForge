# Global Stats & MetaAgent Design

> 状态：DRAFT — 等待实现
> 范围：Status Bar 底部全局统计 + MetaAgent 独立实体 + 项目全量统计

---

## 1. Status Bar

### 1.1 定位

Layout 底部固定 24px 全局度量栏，始终挂载，不随路由切换卸载。

插入点：`packages/app/src/pages/layout.tsx` 的 `LayoutContent`，`main` 区域之下、`DebugBar` 之上。

### 1.2 类型

```ts
type ConnectionState = "online" | "offline" | "reconnecting"

type StatusBarSource = {
  readonly label: () => string
  readonly connection: () => {
    readonly state: ConnectionState
    readonly serverName: string
    readonly serverKey: string
  }
  readonly model: () =>
    | {
        readonly providerID: string
        readonly modelID: string
        readonly variant?: string
        readonly displayName: string
      }
    | undefined
  readonly tokens: () =>
    | {
        readonly input: number
        readonly output: number
        readonly reasoning: number
        readonly cacheRead: number
        readonly cacheWrite: number
        readonly totalCost: number
      }
    | undefined
  readonly context: () =>
    | {
        readonly used: number
        readonly limit: number
        readonly usagePercent: number
      }
    | undefined
  readonly terminals: () => number | undefined
  readonly onDetail: () => void
}
```

### 1.3 视图规则

- 所有字段为 `undefined` 时显示 `—`
- 连接状态用颜色圆点：绿色 online / 红色 offline / 灰色 reconnecting
- 点击任意位置展开详细统计面板（`onDetail`）
- v2 token，不抖动布局

### 1.4 CurrentSessionSource（第一阶段）

数据链：

```
useParams() → serverKey + sessionID
  → global.sessionPlacement.get(serverKey, sessionID) → directory
  → ensureServerCtx(conn).sync.child(directory) → Session
  → Session.tokens / Session.model / Session.cost
  → global.servers.health → connection
```

依赖 Context：`GlobalProvider`、`ServerProvider`、`ModelsProvider`（Layout 层已存在），不新增 Provider。

> StatusBarView 消费 `StatusBarSource`，Layout 注入 `CurrentSessionSource`。MetaAgentSource 就绪后替换注入即可。

---

## 2. MetaAgent 独立实体

### 2.1 设计决策

| 决策               | 选择                                                      | 理由                             |
| ------------------ | --------------------------------------------------------- | -------------------------------- |
| MetaAgent 怎么存？ | **独立实体**（B），不是特殊 Session                       | 不产生产生回复，概念独立         |
| 子会话怎么关联？   | **新增关联表**（C），不复用 parent_id                     | 支持多对多、role 区分            |
| 工作目录？         | 运行时不持久化，从 Chat Mode 的 CurrentSessionSource 获得 | 对齐 chat 模式初始项目文件夹设计 |

### 2.2 ID Schema

`packages/schema/src/meta-agent-id.ts`：

```ts
export const ID = Schema.String.check(Schema.isStartsWith("mag")).pipe(
  Schema.brand("MetaAgentID"),
  withStatics((schema) => ({
    create: () => schema.make("mag_" + descending()),
    descending: (id?: string) => (id === undefined ? create() : schema.make(id)),
  })),
)
```

### 2.3 Info Schema

`packages/schema/src/meta-agent.ts`：

```ts
export const Info = Schema.Struct({
  id: ID,
  title: Schema.String,
  agent: Agent.ID,
  model: Model.Ref,
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    archived: DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}).annotate({ identifier: "MetaAgent.Info" })
```

无 `project_id` 无 `directory`，全局唯一。

### 2.4 SQL 表

`packages/core/src/meta-agent/sql.ts`：

MetaAgentTable —— 元智能体自身记录。
MetaAgentSessionTable —— 元智能体与 session 的多对多关联，含 role 字段（`orchestrator` / `worker` / `tool`）。

### 2.5 core/public 接口

```ts
export interface CreateInput {
  readonly id?: ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly title?: string
}

export interface AttachInput {
  readonly metaAgentID: ID
  readonly sessionID: Session.ID
  readonly role?: "orchestrator" | "worker" | "tool"
}

export interface StatsInput {
  readonly metaAgentID: ID
  readonly includeArchived?: boolean
}

export interface Stats {
  readonly sessionCount: number
  readonly activeSessionCount: number
  readonly totalCost: number
  readonly tokens: { input; output; reasoning; cacheRead; cacheWrite }
  readonly models: Array<{ providerID; modelID; count; tokens }>
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly attach: (input: AttachInput) => Effect.Effect<void, NotFoundError | SessionAlreadyAttachedError>
  readonly detach: (metaAgentID: ID, sessionID: Session.ID) => Effect.Effect<void, NotFoundError>
  readonly sessions: (metaAgentID: ID) => Effect.Effect<Session.Info[], NotFoundError>
  readonly stats: (input: StatsInput) => Effect.Effect<Stats, NotFoundError>
}
```

---

## 3. 项目全量统计

不占用 Status Bar，作为独立入口（项目设置/Status Bar 展开面板）。

### 3.1 接口

```ts
export interface Interface {
  readonly get: (input: { readonly projectID: string }) => Effect.Effect<Stats>
}
```

### 3.2 实现

直接 `SELECT SUM(cost), SUM(tokens_input), ... FROM session WHERE project_id = ?`，无需新表。

---

## 4. 数据流总览

```
用户操作 → Session（普通对话）
  → projector.ts 累加 tokens/cost 到 SessionTable
  → ServerSync 事件流 → 前端 store.session

MetaAgent 派发任务
  → MetaAgent.attach(sessionID) → 关联表写入
  → StatusBar MetaAgentSource
    → Query 关联表 → 反查 SessionTable → 聚合 Stats

项目统计
  → SessionTable WHERE project_id = ? → 聚合
```

---

## 5. 实现优先级

| 阶段 | 内容                                  | 说明                                            |
| ---- | ------------------------------------- | ----------------------------------------------- |
| P0   | StatusBar 组件 + CurrentSessionSource | 纯 UI + 当前路由 session 数据，不依赖 MetaAgent |
| P1   | 项目全量统计接口                      | 纯 SQL 聚合，不依赖 MetaAgent                   |
| P2   | MetaAgent 表 + 关联表 + core 接口     | P0/P1 完成、独立                                |
| P3   | MetaAgentSource + StatusBar 切换      | 依赖 P2 + MetaAgent 引擎就绪                    |

P0 和 P1 可同时开工，不影响现有代码。

---

> 相关文档：`status-bar.md`（底部栏规划）、`chat.md`（MetaAgent 编排模型）、`mode-switcher.md`（模式切换）
> 首次起草：2026-06-29
