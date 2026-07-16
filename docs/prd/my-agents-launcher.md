# PRD：我的智能体 - 用户 Agent 启动台

> 状态：v3 草案，待架构前置条件通过后评审
> 负责人：产品（范围与指标）/ Core（Agent provenance）/ App（启动台与 Draft 契约）
> 范围：`packages/app` + `packages/core`
> 关联：[ADR-09](../architecture/adr/ADR-09-mode-route-decoupling.md)、[ADR-11](../architecture/adr/ADR-11-product-mode-session-classification.md)、[ADR-12](../architecture/adr/ADR-12-product-mode-entry-routing.md)、[ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md)（提出）、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.4/§4.10
> 最后更新：2026-07-14

---

## 1. 三行摘要

- **做什么**：提供 `/my-agents` 启动台，列出来源明确的用户 Agent，并以选定的 Work 或 Coding 模式启动规范 Draft/Session。
- **为谁做**：已经配置一个或多个项目 Agent，希望快速找到、检查并使用它们的 AigcForge 用户。
- **为什么现在做**：Session 已能持久绑定 Agent，但公开 Agent 信息丢失来源，当前无法可靠回答“哪些是我的 Agent”。

## 2. 问题与定位

用户 Agent 与内置、配置合并和插件 Agent 汇聚到同一 registry。当前文件加载器内部拥有 `sourcePath`，但 `AgentV2.all()` 返回的公开 `Agent.Info` 不保留来源；按名称、目录猜测或排除内置 ID 都会误分类。

> 用户任务：我已经为这个项目配置了审查 Agent，希望从一个入口选择它，并用 Coding 模式开始新会话。

“我的智能体”是**启动台**，不是第五个 Product Mode，也不是新的 Session 工作区。它负责选择 Location、Agent 和目标 Product Mode；创建 Draft 后立即进入现有 `/new-session`，提交后进入 canonical Session route。

## 3. 架构前提

| 决策 | 当前状态 | 本 PRD 处理 |
|---|---|---|
| Product Mode 只有四类 | ADR-11 已接受 | 不新增 Custom mode，Session 只使用 Work/Coding |
| Session route 不编码 Mode/入口来源 | ADR-09/12 已接受 | 禁止 Custom Session route |
| Agent provenance | 公开 schema 不存在 | M0 扩展 registry producer 和公开 `Agent.Info` |
| Draft Agent 身份 | `DraftTab` 当前仅冻结 `mode` | M0 新增独立 `agent` 字段并做前端持久状态迁移 |
| 全局 Agent 路径与作用域 | ADR-14 提出且 loader 路径未统一 | M1 只支持当前 Location 中来源明确的项目文件 Agent |

当前 V2 文件 Agent loader 扫描 `.claude/agents/*.agent.md`；配置插件还会从配置文档合并 Agent。PRD 不将 `.aigcfroge/agents/` 或某个全局目录写成已支持能力。

## 4. 目标与非目标

### 4.1 M1 目标

- 用户可选择当前 server/Location，查看由 registry 明确标记为 `.claude/agents/*.agent.md` 项目文件来源的 Agent。
- 列表只展示非隐藏且可作为根执行 Agent 的定义；支持名称和描述搜索。
- Agent 详情只读展示来源、说明、执行角色、模型摘要、权限和可用性，不展示凭证或原始请求密钥。
- 启动时用户明确选择 `work` 或 `coding`；系统不得从 Agent 名称、工具或上次模式推断。
- Draft 持久冻结 Agent 和 Mode；首次提交创建的 Session 同时持久化二者。
- 最近会话按 `Session.agent` 查询，点击后始终进入 canonical Session route。

### 4.2 非目标

- M1 不新增 Product Mode，不进入全局四模式切换栏。
- M1 不使用 `mode=chat` 承载用户 Agent 工作，也不让 Chat/Custom 重复显示同一 Session 集合。
- M1 不创建、编辑、导入、导出或删除 Agent；创建与生命周期能力属于后续 Chat 资产计划。
- M1 不支持全局 Agent、插件 Agent、内置 Agent、跨项目聚合或 Agent 组合。
- M1 不新增 `/my-agents/:agentId/session/:id` 或任何第二套 Session URL。
- M1 不复制 Coding/Work Session 页面，不创建新的 Session identity 或 Session 表字段。

## 5. 用户故事

| 用户故事 | 验收结果 |
|---|---|
| 作为项目用户，我想只看到自己项目中的 Agent，以便不被内置 Agent 干扰 | 列表完全由 provenance 过滤，不使用 ID/名称启发式 |
| 作为安全敏感用户，我想在启动前查看 Agent 权限，以便选择正确模式 | 详情显示权限摘要和来源，但不暴露秘密 |
| 作为多模式用户，我想明确选择 Work 或 Coding，以便 Session 分类正确 | 未选择模式时不能启动，系统不设置默认推断 |
| 作为刷新后的用户，我想保留选定 Agent，以便首次提交不会跑错 Agent | Draft 恢复后 Agent 与 Mode 均来自持久 `DraftTab` |
| 作为历史用户，我想从最近会话继续工作 | 点击最近项进入 `/server/:serverKey/session/:id` |

## 6. M1 产品流程

1. 用户从 Home 的“我的智能体”入口进入 `/my-agents`；全局模式栏保持四项不变。
2. 用户选择现有 server/Location；若没有 Location，显示项目选择/打开入口，不创建隐式工作区。
3. App 查询该 Location 的 Agent registry，并按 provenance、`hidden` 和执行角色过滤。
4. 用户选择 Agent，查看只读详情和权限摘要。
5. 用户点击“开始”，必须在 Work/Coding 分段控件中明确选择一种模式。
6. App 创建带 `mode`、`agent`、server 和 directory 的 DraftTab，导航到 `/new-session?draftId=...`。
7. Composer 从 DraftTab 初始化 Agent；用户显式切换 Agent 时同步更新 DraftTab，而不是写全局默认。
8. 首次提交调用 `session.create({ mode, agent })`，并用同一 Agent 发送首条 prompt；随后进入 canonical Session route。

如果 Agent 在第 3 至第 8 步之间被删除或变为不可用，提交必须失败并保留 Draft，提示用户重新选择；不得静默回退默认 Agent。

## 7. 数据与接口契约

### 7.1 Agent provenance

公开 `Agent.Info` 增加非空 provenance，覆盖所有 producer。最小来源联合类型如下：

| `kind` | 必要字段 | 用途 |
|---|---|---|
| `builtin` | 内置定义 ID | 系统内置 Agent |
| `plugin` | plugin ID | 插件贡献的 Agent |
| `file` | `scope`、安全相对路径、`format` | Markdown 或配置文档贡献的 Agent |

- `file.scope` 为 `project` 或 `global`；路径相对已知配置根或 Location，不向客户端泄漏任意绝对路径。
- `file.format` 至少区分 `claude-agent-md` 与 `config-agent`，不得只用相同的 `file` kind 混淆不同 loader 契约。
- provenance 记录有序贡献链：第一个创建该 Agent ID 的来源为 `origin`，后续合并为 `overlays`。用户文件覆盖内置 Agent 不会把内置 Agent 重新分类为“我的”。
- registry 的 builtin、config、plugin 和 file producer 都必须登记来源；`AgentFileLoader.sourcePath` 不得在汇入 `Agent.Info` 时丢失。
- M1 “我的智能体”判定固定为 `origin.kind=file && origin.scope=project && origin.format=claude-agent-md`，来源路径必须位于 `.claude/agents/` 且以 `.agent.md` 结尾；同时要求 `hidden=false`、Agent 执行角色不是 `subagent`。
- 同一 Agent ID 的来源冲突、覆盖顺序和失效行为必须由 M0 registry 测试锁定，UI 不自行解析文件来补来源。

### 7.2 Draft 与 Session

`DraftTab` 增加 `agent?: string`，与现有 `type: "draft"`、`mode` 正交：

- 现有 Draft migration 将缺失 `agent` 保持为 `undefined`；普通新建流程行为不变。
- 从启动台创建的 Draft 必须同时写入 `mode` 和 `agent`。
- Draft route 是首次提交前的权威值；全局 Agent 选择状态不能覆盖它。
- 首次提交将 `DraftTab.mode` 和 `DraftTab.agent` 一起传入 Session create；Session 响应中的 durable `mode`/`agent` 成为后续真源。
- Session 内显式切换 Agent 继续使用现有 Agent switch 事件，不回写已消费的 Draft。

`agent` 是前端持久状态字段，不是数据库 migration；Session 已有持久 `agent` 字段，无需增加 Session schema。

### 7.3 查询与路由

- `/my-agents` 只拥有启动台页面状态，不拥有 Session 详情。
- Draft URL 保持 `/new-session?draftId=...`。
- Session URL 保持 `/server/:serverKey/session/:id`，必须使用现有 `sessionHref()`。
- 最近会话按当前 server/Location、`Session.agent` 和 `mode in (work,coding)` 查询；不通过 URL 或 transcript 猜 Agent。

## 8. 页面与交互

### 8.1 启动台

- 使用安静、紧凑的列表或网格，包含搜索、Location 选择、加载/空/错误状态。
- Agent 是可重复项，可使用单层卡片；不嵌套卡片，不使用营销 Hero 或装饰性背景。
- 选中 Agent 后显示只读详情区域；开始操作使用明确的 Work/Coding 分段控件和命令按钮。
- 空状态区分“当前项目没有用户 Agent”和“Agent registry 加载失败”，前者提供返回 Chat/配置文档的入口，后者提供重试。

### 8.2 Agent 详情

- 展示名称、描述、项目来源相对路径、模型摘要、执行角色、权限摘要和最近会话。
- 不展示 provider headers、request body 中的秘密、MCP token 或完整敏感系统提示；M1 系统提示只显示“已配置/未配置”。
- Agent 文件被删除时从新启动列表移除；已有 Session 保持可打开，并显示“Agent 当前不可用”，不得改用默认 Agent。

所有 UI 文本走 i18n；使用现有 icon 字典、v2 token、稳定尺寸、键盘焦点和明暗主题，窄屏不得重叠。

## 9. 安全与边界

- 服务端根据 provenance 执行过滤；客户端过滤仅用于展示，不能作为权限边界。
- 启动前重新解析 Agent 可用性和权限，防止列表加载后的 TOCTOU 变化。
- 相对来源路径必须经过规范化；不得向远程客户端返回宿主机任意绝对路径。
- Agent 权限仍受现有 Permission/Policy 约束；启动台不提升权限，也不提供“信任此 Agent 后全部允许”。
- 产品分析事件不记录系统提示、权限资源详情、文件正文或凭证。

## 10. 成功指标与埋点

上线前用包含 builtin/plugin/file/config 覆盖的 50 个 registry fixture 建立正确性基线，并进行 30 次内部启动流程：

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 用户 Agent 分类正确率 | 100% | fixture 期望集合与 provenance 查询集合一致 |
| 启动台加载成功率 | ≥99% | 成功返回可判定列表 / 有效加载次数 |
| Draft 到 Session 启动成功率 | ≥95% | durable mode+agent 一致的 Session / 启动确认次数 |
| 选择到启动转化率 | ≥40% | 选择有效 Agent 后成功创建 Session 的用户占比 |
| 7 日再次启动率 | ≥25% | 首次启动后 7 日内再次从启动台创建 Session 的用户占比 |
| Agent/Mode 一致率 | 100% | Draft、create input、Session 响应三者一致 |
| canonical route 使用率 | 100% | 启动/最近会话均进入 `sessionHref()` |
| 静默默认 Agent 回退 | 0 | 指定 Agent 不可用时创建默认 Agent Session 的次数 |

至少记录 `my_agents_opened`、`my_agents_location_selected`、`my_agents_agent_selected`、`my_agents_launch_requested`、`my_agents_launch_succeeded` 和 `my_agents_launch_failed`；不记录 Agent prompt 或来源绝对路径。

## 11. 里程碑与优先级

| 阶段 | 范围 | 准入/退出条件 |
|---|---|---|
| **M0 来源与 Draft 契约** | provenance producer、公开 schema、Draft agent 持久化、首次提交透传 | Core/App 架构评审和 registry/Draft 测试通过 |
| **M1 项目 Agent 启动台** | Location 选择、列表、搜索、详情、Work/Coding 启动、最近会话 | Beta Gate 全部达标 |
| **M2 生命周期入口** | 跳转 Chat 创建/对话修改；评估全局 Agent | ADR-14 与 Chat Agent Asset 契约通过 |
| **M3 迁移与组合** | 导入导出、依赖检查、多 Agent 组合 | 独立包格式与编排设计通过 |

按 WSJF，provenance 和 Draft Agent 先做：两者既是启动台正确性的根，也能消除 registry 和首次提交中的隐藏身份问题。

### 11.1 成本收益假设

| 假设 | 验证方式 |
|---|---|
| 用户需要独立入口发现并启动项目 Agent，而不是只在 Composer 中选择 | 观察启动台访问到启动的转化率、最近会话回访和 7 日再次启动率 |
| 主要成本是 provenance 完整性和 Draft Agent 身份，不是新 Session 页面 | 记录 M0 Core/App 工作量，并验证 Session UI 零复制 |
| provenance 能同时改善调试、来源展示和未来 Agent 生命周期能力 | M2 立项前统计其在诊断与过滤中的实际复用点 |

若 Beta 从有效 Agent 选择到 Session 启动的转化率低于 20%，或 7 日再次启动率低于 15%，停止导入导出与组合扩围，先复核独立启动台是否必要。

## 12. 灰度、回滚与监控

- 使用 My Agents Launcher feature flag；先内部，再 10% Beta，再全量。
- 关闭 flag 仅隐藏 Home 入口和 `/my-agents` 导航，不影响 Agent registry、既有 Draft/Session 或 canonical 路由。
- provenance schema 对旧客户端保持可解码；旧 Draft 缺失 `agent` 时维持普通新建行为。
- 若出现误分类、跨 Location 泄漏、Agent/Mode 不一致或静默默认回退，立即停止灰度。
- Dashboard 监控加载错误、来源冲突、不可用 Agent、启动失败和路由异常，不采集敏感内容。

## 13. 验收与测试

- builtin、plugin、项目文件、全局文件、配置文档、覆盖内置 ID 和同 ID 多来源合并。
- hidden/subagent 排除、文件删除/变更、registry reload 和加载期间失效。
- 普通 Draft 无 Agent 的兼容迁移；启动台 Draft 的刷新恢复和显式切换 Agent。
- 首次提交同时持久化 mode/agent；Agent 不存在时保留 Draft且不回退。
- Work/Coding 两种选择、Session mode 过滤、最近会话和 canonical route。
- 来源路径脱敏、权限摘要、日志/埋点不包含系统提示或凭证。
- 桌面/窄屏、键盘、明暗主题、中英文溢出以及空/加载/错误状态。
- 实现后运行受影响包 typecheck/test；App 路由、Draft migration 和 Core registry 均需覆盖。

## 14. 批准 Gate

1. Agent provenance schema、producer 登记和覆盖优先级通过 Core/插件兼容性评审。
2. Draft `agent` 的持久化、迁移、Composer 初始化和 Session create 透传通过 App 评审。
3. 所有启动路径均使用 ADR-09/12 canonical Draft/Session route。
4. 产品、Core、App、安全负责人确认过滤定义、指标、隐私和 Beta Gate。
