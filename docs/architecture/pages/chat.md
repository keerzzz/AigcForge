# Chat Mode 架构

> 状态：**IMPLEMENTED / PARTIAL PRODUCT CLOSURE（2026-09-13）**
> 事实源：`packages/app/src/pages/mode-workspace.tsx`、`mode-workspace-slots.tsx`、`packages/app/src/components/chat/`、[Chat PRD](../../prd/chat-mode-creation-layer.md)、[ADR-13](../adr/ADR-13-chat-work-mode-boundary.md)、[全局壳 E2E 报告](../../review/global-shell-e2e-2026-09-10.md)。
> 本页取代“当前代码库无实现 / 6 大资产 PLANNED”的旧描述；当前实现已有七类资产，但完整真实业务闭环仍为 PARTIAL。

## 1. 定位与职责

Chat 是资产创建与治理层，不是第二套 Session runtime：

- `/mode/chat` 复用共享 `ModeWorkspace` typed slot；模式切换保持 render-all + `display:none`，不复制路由外壳。
- 主区管理 Prompt、Skill、MCP、Command、Agent、Workflow、Plugin 七类资产。
- 左栏按 Project → Feature → Session 组织；Session 列表只导航到 canonical Session，不在 Chat 首页复制 timeline/Composer。
- 资产创建、导入和“插入会话”复用标准 Draft/Session、权限和事务边界。
- Workflow 定义归 Chat；执行归 Work（ADR-13 Amendment-1）。

## 2. 当前组件与数据流

```text
ModeRoute(/mode/chat)
  -> ModeWorkspace
     -> ChatFeatureSidebar
        -> Location / project action
        -> seven asset kinds + counts
        -> recent Chat Sessions
     -> ChatAssetWorkbenchMain
        -> shared project asset resource
        -> system asset merge
        -> create / import / delete / insert-to-session
```

`ModeWorkspace` 在 Chat 首次激活前不加载七类资产；激活后保留资源以维持 ADR-15 的 no-remount 语义。项目资产和系统资产在工作台合并；任一资产端点失败应显示局部错误与 Retry，不得让整个 ModeWorkspace 白屏。

## 3. Owner 边界

| Owner                         | 职责                                           | 禁止替代方案                          |
| ----------------------------- | ---------------------------------------------- | ------------------------------------- |
| Core/Schema 各 Asset service  | 资产 schema、revision、路径、事务和权限        | App localStorage/内存对象冒充资产真源 |
| `ModeWorkspace` asset context | Chat 首次激活 gate、七类资源共享、系统资产合并 | Sidebar/Main 各自无界重复抓取         |
| `ChatFeatureSidebar`          | Location、Feature、Session 导航与折叠展示      | 新建平行 Session sidebar/runtime      |
| `ChatAssetWorkbenchMain`      | 当前资产类型的列表与动作编排                   | 在首页内嵌完整 Session 执行链         |
| canonical Session page        | timeline、Composer、tool、permission、context  | Chat 首页复制消息和工具状态           |

## 4. current / target / verified

| 维度                         | current（代码事实）                                                                                                                                      | target                                          | verified（证据）                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 路由与 slot                  | `/mode/chat` + `ModeWorkspace` typed slot；切模式 render-all + `display:none`，不 remount                                                                | 不变                                            | `mode-workspace.tsx`；`mode-slot-active.ts`                                                                      |
| 七类资产                     | prompt / skill / mcp / command / agent / workflow / plugin 七类均可列出                                                                                  | 每类有明确 create/read/update/delete 或只读边界 | core 各 Asset service 测试；`chat-asset-categories.spec.ts`                                                      |
| 资产工作台                   | 项目资产与系统资产在工作台合并；失败显示局部错误 + Retry，不白屏                                                                                         | 不变                                            | `components/chat/`；局部 load error 用例                                                                         |
| inactive gate                | 首次激活前不请求七类资产；隐藏 slot 不发请求                                                                                                             | 不变                                            | `mode-slot-active.ts`；`hidden-panel-request-and-remount` 已闭合                                                 |
| Session 导航                 | 只导航到 canonical Session，不在 Chat 首页复制 timeline/Composer                                                                                         | 不变                                            | `openSessionRecord`；`home-shared.tsx`                                                                           |
| 资产计数投影                 | 七类 assetCounts 进入 SessionProductIdentity projection；Header 渲染七行且计数各自不同                                                                   | 不变                                            | `session-identity.ts:162-173`；core `session-identity.test.ts` 11 passed；`session-product-header.spec.ts:40-51` |
| 真实 provider turn（E4）     | **已 landed**：`session-turn.spec.ts` 有 chat 模式用例（浏览器 submit → 真实 provider turn → 投影 parts → reload），与无 mode 的 coding 用例同一读者 A/B | 不变                                            | manifest `modes.chat.e4`；2 passed (7.0m)                                                                        |
| 七类资产 CRUD 的真实后端闭环 | **未取证**：现有覆盖以 E3 mock contract 为主                                                                                                             | 需 E2/E4                                        | 无本机证据                                                                                                       |

**未闭环**：七类资产的跨项目隔离、revision 冲突、真实导入不受信内容与失败恢复仍无 E4；不得据 E3 mock 断言发布级闭环。

## 5. 已实现与证据边界

已实现：七类资产列表，创建/导入/删除入口，资产插入会话，Project→Feature→Session 左栏，inactive-slot 网络 gate，局部 load error，canonical Session 导航。

现有 Playwright 主要是 E3 mock contract；它不能证明真实 provider turn、全部七类资产 CRUD、跨项目隔离、revision 冲突、导入不受信内容和失败恢复已达到发布级 E4。最新发布判定与缺口以 E2E 报告 §19–§20 为准。

## 5. 当前未闭环项

1. 资产行必须进入真实详情/编辑流程；未实现时不得保留伪按钮语义。
2. 搜索条件应按资产类型隔离或在切换时明确清空。
3. Sidebar counts 与 Main list 应共享单一资源 owner，避免冷启动重复七类请求。
4. “使用资产”必须按资产类型提供明确语义，并保留 revision、来源和失败反馈。
5. Reviewer/comment/resolved 生命周期、跨项目 scope、CAS 冲突和真实导入安全需 E2/E4 证据。
6. Session Header 与 capability gate 应消费统一只读投影，不能从当前 Feature、URL 或 Agent 名称推断。

## 6. 验收门禁

- 七类资产各有 create/read/update/delete 或明确只读边界，并覆盖 conflict/permission/invalid input。
- 首页状态恢复不重复抓取，不复制 Session runtime。
- 跨 server/project/directory 不串资产、筛选、右栏或会话。
- 导入内容按不受信输入处理，路径和日志不泄漏敏感正文。
- E3 UI contract 与 E4 real-backend happy/failure-recovery 均有证据，才能把 PARTIAL 改为 CLOSED。
