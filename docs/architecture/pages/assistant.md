# Assistant Mode 架构

> 状态：**IMPLEMENTED / M1 PARTIAL（2026-09-20）**
> 事实源：`packages/app/src/components/mode-surfaces.tsx`、`packages/app/src/pages/assistant-dashboard.tsx`、`packages/app/src/components/assistant-*`、`packages/app/src/pages/session/assistant-*`、`packages/core/src/session/session-identity.ts`、[Assistant PRD](../../prd/assistant-mode-personal-agent.md)、[Assistant 路线图](../../roadmap/assistant-mode-roadmap.md)。
> 本页是该模式的独立页面文档。此前的 `custom-assistant.md` 已标记 SUPERSEDED 并指向 Custom，**不能**作为 Assistant 的事实源。

## 1. 定位与职责

Assistant 是带个人上下文与主动触达能力的模式，不是常驻 Session：

- `/mode/assistant` 复用共享 `ModeWorkspace` typed slot（`app.tsx` 的 `/mode/:mode`，`MODE_DEFINITIONS` 第五档之前为 assistant）。
- 主区是 `AssistantDashboardMain`（`pages/assistant-dashboard.tsx`），职责是提醒 / 投递 / 记忆 / 笔记 / Session 的聚合面板。
- 左栏是 `AssistantSidebar`（`components/assistant-feature-sidebar.tsx`），负责实体树与选择。
- Session 细节仍走 canonical Session page；Session 内的 KB tab 由 `pages/session/assistant-kb-tab.tsx` 提供。
- 主动性来自持久 Scheduler 在到期时创建幂等投递，而不是 Session 常驻（见 PRD §2）。

## 2. 当前组件与数据流

```text
ModeRoute(/mode/assistant)
  -> ModeWorkspace
     -> AssistantSidebar (components/assistant-feature-sidebar.tsx)
        -> assistant-nav-tree / assistant-nav-model
        -> entity selection -> AssistantSelectionCtx
     -> AssistantDashboardMain (pages/assistant-dashboard.tsx)
        -> ReminderList / DeliveryList / MemoryInspector
           (components/assistant-entity-lists.tsx)
        -> KB notes (assistant-note-editor)
        -> mode=assistant Session 列表 (pages/home-shared.tsx)
  -> canonical Session page
     -> assistant-kb-tab / assistant-session-panel
     -> assistant-citation-model
```

## 3. Owner 边界

| Owner                               | 职责                                                     | 禁止替代方案                                |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| Core Schedule / Delivery owners     | 提醒的持久化、到期投递、inbox                            | App 内存定时器冒充调度真源                  |
| Core Personal Memory / KB owners    | 记忆与笔记的持久化与链接                                 | 页面内私有 localStorage 副本                |
| `SessionIdentityProjection`（core） | assistant 的 scope/reminders/memory/knowledge capability | 由 UI 从 URL、Agent 名或 Session store 推断 |
| `AssistantDashboardMain`            | 实体聚合面板的编排与导航                                 | 在首页复制 timeline / Composer              |
| canonical Session page              | 消息、工具、权限、context                                | Assistant 首页内嵌执行链                    |

## 4. current / target / verified

| 维度              | current（代码事实）                                       | target                                 | verified（证据）                                                                                                             |
| ----------------- | --------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 路由与 slot       | `/mode/assistant` + ModeWorkspace typed slot              | 不变                                   | `mode-surfaces.tsx:198-201`、`MODE_DEFINITIONS`                                                                              |
| 提醒 / 投递（M1） | 已实现，投影在 schedule + delivery owner 就绪时报 `ready` | 时区 / DST / 重启补投全绿              | identity `session-identity.ts:195-203`；core `schedule*.test.ts`、`scheduled-job*.test.ts`；E3 `assistant-dashboard.spec.ts` |
| 记忆（M2）        | **投影显式 `degraded`**：`assistant-memory-m2-pending`    | M2 交付后转 ready                      | `session-identity.ts:204-206`；schema 断言 memory 贡献 degradation                                                           |
| 知识库（M2）      | **投影显式 `degraded`**：`assistant-kb-m2-pending`        | M2 交付后转 ready                      | `session-identity.ts:207-209`；core `kb-service.test.ts`、`kb-link.test.ts`                                                  |
| scope             | 投影固定 `{ kind: "personal" }`                           | Personal/Project 双 scope 需服务端合同 | `session-identity.ts:215`；schema `assistant personal scope decodes without a project`                                       |
| Session 面板      | KB tab + citation 已实现                                  | 不变                                   | `pages/session/assistant-*`（10 个单测文件）                                                                                 |
| E4（真实后端）    | 未在本机跑通                                              | 需要真实 Scheduler + 投递链路的 E4     | 无本机证据；登记在 manifest 的 `identity-e4-cross-server-and-historical`                                                     |

## 5. 当前未闭环项

1. **M1 的 E4**：提醒创建 → 到期 → 投递 → inbox 的真实后端闭环尚无 E4 证据（本机 FUSE 无法重复跑 E4）。
2. **M2 状态与批准边界**：Memory/KB 目前是 typed `degraded`，不得在任何发布说明里写成已实现。
3. **scope 合同**：Personal/Project 双 scope 需要服务端合同；在此之前投影只能声明 personal。
4. **时区 / DST / 重启补投 / 取消去重**：属于 §7 验收第 5 项，未逐条取证。
5. **主动触达的取消与去重**：需真实时间 cohort，见 `docs/technical-debt.md` §6。

## 6. 验收门禁

- capability reason code 是协议，不随文案翻译；Memory/KB 的 `degraded` 不得被 UI 静默提升为 ready。
- 提醒的创建 / 取消 / 到期投递在真实后端可重复取证，失败可恢复且不重复投递。
- 页面不复制 Session runtime；实体选择只做导航。
- scope 扩展必须先有服务端合同，再改投影与 UI。
