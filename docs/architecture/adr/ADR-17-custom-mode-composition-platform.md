# ADR-17: Custom Mode Composition Platform

> 状态：Accepted for M0/M1 implementation v1.2（2026-08-18；用户授权 AI 代理代行 Product / Core / App / Security / Schema+SDK 技术审批）；生产运行时仍保持四值，直至 M0 Phase B 合入
> 日期：2026-08-18
> 关联：ADR-11、ADR-12、ADR-14、ADR-15、[Custom PRD](../../prd/custom-mode-composition-platform.md)、[Custom 路线图](../../roadmap/custom-mode-roadmap.md)、[Custom 研究稿](../../research/agent/DeepSeek-Harness四模式借鉴与自定义模式思维风暴.md)

## 背景

AigcForge 已有 Chat、Coding、Work 和 Assistant 四个 Product Mode，以及 Prompt、Skill、MCP、Command、Agent、Workflow、Plugin 七类资产。资产已经分别拥有 Schema、Location 作用域、typed registry、revision、文件 watcher 和 apply/delete 事务，但还缺少一个统一的消费层：用户无法在一个明确的模式中自由选择资产，将它们装配为可运行的 Agent 环境，并在启动前理解最终 Prompt、工具、权限和依赖。

外部 DeepSeek Harness 的 preset 设计证明了“能力组合”和“工具呈现”具有独立价值。AigcForge 的元智能体调度架构进一步确定：根会话由 `meta` 负责理解和编排，模式专用 Agent 或用户 Agent 作为受限执行者；Coding 保留 `meta` 与 `build` 互补的产品特例。

如果直接把资产作为可执行插件互相嵌套，会产生四类问题：资产声明可能被误当成权限授予；插件加载可能污染进程级服务；资产删除或修改可能破坏正在运行的 Session；UI 可能因每种资产自行注册页面而失去统一布局、生命周期和安全边界。

## 决策

### 1. 增加第五个固定 Product Mode

Product Mode 从四值扩展为：

```text
chat | coding | work | assistant | custom
```

`custom` 是稳定的产品入口、Session 分类和共享工作区 slot。它不是任意字符串模式，也不是“每个用户 Agent 一个模式”。用户可以创建多个 Custom Profile，但所有 Profile 都在 `mode=custom` 下运行。

Custom 根会话固定由 `meta` 拥有。Profile 中的用户 Agent 是 `meta` 可调度的执行 Agent，而不是根会话的替代 Agent。Custom 不改变 Chat 作为资产创建和管理中心的职责。

### 2. 采用四层积木模型

```text
Platform Foundation
  -> Composition Profile
      -> Asset Blocks
          -> Session Composition Snapshot
```

#### 2.1 Platform Foundation：平台底座

用户不能通过资产替换底座。底座由产品固定提供：

- `ModeRoute` / `ModeWorkspace` / `SessionSidePanel` / `SessionComposer` 的共享页面外壳。
- Product Mode、Location、Session V2、EventV2、Session Execution 和 canonical Session route。
- Permission、Policy、ToolRegistry、FileSystem、Process、MCP 和 Plugin 的安全边界。
- v2 UI tokens、主题、图标、i18n、可访问性和响应式布局。
- `meta` 根编排器、子 Agent 委派、取消、任务状态和审计事件。

底座允许注册 typed slot、资产类型和工具 presentation，但不允许用户资产直接接管全局 Layout、Session identity、权限服务或进程生命周期。

#### 2.2 Composition Profile：组合配置

Profile 是用户可保存和复用的装配说明。作为第八类资产 `custom-profile`，由 Chat 管理、Custom 消费：

- 存储位置固定为项目级目录：`.aigcfroge/custom-profiles/*.yaml`。
- 采用结构化 YAML + Effect Schema 解码（使用独立的 `CustomProfile` `Schema.Class`；`ConfigAgent.Info` 仅用于解码 `AgentAsset.config`，严禁与 `CustomProfile` 混用；不使用脆弱的字符串正则截断 frontmatter）。
- 拥有独立的 AssetKind owner、规范路径、Schema、revision、CAS、registry、watcher、invalid/health 投影、apply/delete 事务和反向引用查询。
- 严禁把 Profile 塞入 Agent Asset 作为附属字段，也严禁复制现有资产事务代码实现平行 owner。

最小语义：

- 一个稳定名称、描述和 profile revision。
- 一个用户 Agent allowlist，供 `meta` 调度。
- Prompt、Skill、MCP、Command、Workflow、Plugin 的显式引用。
- 每个引用的作用域、revision 和消费者绑定。
- Tool Presentation，首发只支持 `native`，未来支持 `code`。
- 可请求但不可授予的能力声明。

M1 对上述长期模型做严格裁剪：`agents` 长度固定为 1，只开放 Prompt/Skill 引用与 `native` presentation；MCP、Command、Workflow 执行、Plugin runtime 和 Code Presentation 分别留在 M2-M5。

Profile 不内嵌资产正文，不复制资产文件；它保存规范引用和解析约束。Profile 自身删除不会删除被引用资产，只会让依赖它的后续启动不可用。

#### 2.3 Asset Blocks：资产积木

资产按“主干、枝干、叶子”理解，但运行时按能力和生命周期分类，不按视觉层级直接执行：

| 积木层     | 资产                               | 作用                                                 |
| ---------- | ---------------------------------- | ---------------------------------------------------- |
| 主干       | Agent、Profile、Workflow           | 定义谁编排、谁执行、步骤如何连接                     |
| 枝干       | Skill、MCP、Command                | 为某个 Agent 或流程添加可发现的能力                  |
| 叶子       | Prompt、参数、数据源引用、工具调用 | 为一次执行提供具体输入或局部规则                     |
| 高风险扩展 | Plugin                             | 扩展 Host/Client/runtime，必须经过独立信任和审批流程 |

“主干”不能自动获得所有“枝叶”：引用关系必须显式、可解析、可预览。Skill 不能授予工具权限，Prompt 不能改变权限，Workflow 不能提高子 Agent 上限，Plugin 不能通过声明提升自身权限。

#### 2.4 Session Composition Snapshot：会话运行快照

Draft 阶段允许用户装配和修改。首次提交前，Composition Resolver 将 Profile 和所有引用解析为不可变快照，并在服务端原子创建 Session 时持久化至独立的 `session_composition_snapshot` 数据表：

- `mode=custom`。
- 根 Agent=`meta`。
- Profile id/revision，或临时组合的 composition id/digest。
- 用户 Agent allowlist、来源和 revision。
- 每类资产的规范引用、消费者绑定和 revision。
- 最终 Prompt/Skill 组合顺序及 digest。
- 有效工具目录的稳定 `ToolRegistrationFingerprint`（最小 4 字段：`placement`、`name`、规范化 `definition / schema digest`、`installationVersion`）。
- 独立的 `ToolCatalogDigest`（有效工具全量目录聚合摘要）。
- 运行时在每次 Provider Turn 前由 `ToolRegistry` 同时重验 `ToolRegistrationFingerprint` 与 `ToolCatalogDigest`，发生任何不匹配时 **fail-closed** 阻断执行。
- 有效权限摘要、Location policy 和 approval facts 的 digest。
- 缺失、冲突、降级和外部凭证引用的诊断结果。

快照由 Session 独立拥有且不可变，是 Session 恢复和模型可见输入的真源之一。资产文件后来变化，不改变已有快照。

**真源隔离原则**：

1. `session_composition_snapshot` 拥有独立 typed owner 与数据表，**严禁**写入 `session.metadata` 杂项字段或自由文本 transcript 中。
2. 快照**不替代** Session V2 Context Epoch：Composition Snapshot 保存组合、版本、绑定和能力事实，Context Epoch 保存实际展示给模型的完整系统上下文。权限摘要或 digest 只用于审计，每次工具执行仍由当前 canonical `PermissionV2` 逐次判定。

#### 2.5 经协议复核确认的核心架构裁决

1. **第八类资产**：`custom-profile` 确立为第八类配置资产，统一由 `.aigcfroge/custom-profiles/*.yaml` 承载，复用现有 `AssetKind` 框架与 `FileMutation` 事务。
2. **M1 拓扑**：运行拓扑固定为 `meta` 根 Session + exactly one 当前 Location 用户 Agent 委派目标，不是“用户 Agent 直接接管根会话”。
3. **作用域约束**：M1 只解析当前 Location 的项目资产；全局资产、跨项目引用和隐式全局工作区均不开放。
4. **扩展边界**：M1 完全不运行 Runtime Extension；M4 才开放已安装、验证、审批、版本固定且可停止/隔离/回滚的 Trusted Extension。
5. **恢复与漂移**：删除 Profile 后历史 Session 与 Snapshot 始终可查看；是否继续执行取决于冻结内容和精确运行依赖，缺失时必须阻断，升级必须通过 fork/new Session 并生成新 Snapshot。
6. **审批模型**：应用级审批入口属于 M3；入口可跨页面发现请求，但授权事实只能明确绑定 once、Session 或 Location，不能默认为应用级永久信任。
7. **客户端协商与兼容**：引入 `x-aigcfroge-capabilities: product-mode-custom-v1` 请求头协商。旧客户端访问 `custom` 模式 Session 时由服务端返回 typed unsupported 错误响应，**严禁 fallback 解码为 Coding**。
8. **V2-Native 运行策略**：Custom 模式由统一的 Runtime Policy Owner 强制路由至 Session V2-native 路径，全仓禁止散落 `AIGCFROGE_V2_RUNTIME || mode === "custom"` 临时判断。
9. **双层安全门禁**：在 `task` 工具执行点与子 Session 创建点进行双层 Snapshot allowlist 校验，彻底阻断越权委派。

### 3. 增加 Composition Resolver，而不是第二套运行时

新增的核心能力应是 `CompositionResolver` / `CustomComposition` owner service，职责是：

1. 按 Location 解析 Profile 和资产引用。
2. 校验 provenance、revision、作用域、依赖、循环和消费者绑定。
3. 将资产能力请求与 Agent、Permission、Location policy 求交集。
4. 生成预览用的 `CompositionPlan`。
5. 用户确认后生成 Session 用的 `CompositionSnapshot`。
6. 在 Profile/资产 watcher 变化时发布健康状态和版本漂移通知。

它不执行工具、不替代 `ToolRegistry`、不直接加载任意 Plugin 代码、不成为第二套权限判断器。工具定义物化通过统一签名 `ToolRegistry.materialize({ permissions, intent, allowlist? })` 过滤，工具执行仍经当前 canonical ToolRegistry settlement，用户审批仍经当前 Permission/Policy。

推荐数据流：

```text
Location asset registries
  -> CompositionResolver
      -> CompositionPlan (可预览、可诊断)
          -> Permission/Policy evaluation
              -> CompositionSnapshot
                  -> SessionV2 / Meta dispatch / ToolRegistry.materialize({ permissions, intent, allowlist })
```

### 4. 统一页面底座和 Custom typed slot

Custom 使用现有共享页面架构，不复制一套 Custom 页面：

```text
/mode/custom
  -> ModeRoute
      -> ModeWorkspace
          -> shared navigation / status / notifications / session lists
          -> custom typed main slot
          -> shared Session route
```

Custom 主区的核心对象是“组合”，不是普通 Session 列表。建议主区包含：

- Profile 列表：最近使用、已保存、草稿和健康状态。
- Composition Builder：按 Agent、Prompt、Skill、MCP、Command、Workflow、Plugin 分组选择。
- Composition Preview：最终指令、能力、权限、依赖和诊断。
- Recent Custom Sessions：按 Location 和 `mode=custom` 过滤。

统一布局必须继续复用：

- `ModeSwitcher`、`SecondarySidebar`、`StatusBar`、Titlebar、通知和错误/加载/空状态。
- `ModeWorkspace` 的稳定尺寸、共享 Provider、资源提升和 slot 切换不 remount 约束。
- `SessionSidePanel` 的 typed slots：Custom 可增加 Composition、Dependency、Run History 面板，但不能改变 Session timeline/composer 的所有权。

Custom Builder 的布局建议为三列：

```text
左：资产目录与筛选
中：组合画布/层级清单
右：解析预览、权限和诊断
```

窄屏变为单列导航：资产目录抽屉 -> 组合清单 -> 预览抽屉。不得把三列压缩到互相遮挡，也不使用卡片嵌套卡片的营销式布局。

### 5. 组合画布采用显式连接，不允许隐式全局注入

用户可以像搭积木一样拖入资产，但每一块必须有明确的连接关系：

```text
meta
  -> dispatches -> user-agent/security-reviewer
  -> loads     -> skill/security-checklist
  -> calls     -> workflow/release-gate
  -> exposes   -> command/check-release
```

UI 的视觉连接最终必须落成结构化 `bindings`，而不是仅存在于前端内存：

```yaml
bindings:
  orchestrator:
    prompts: [prompt/release-policy]
    skills: [skill/review-guidelines]
  agents/security-reviewer:
    skills: [skill/security-checklist]
    mcp: [mcp/vulnerability-db]
  shared:
    workflows: [workflow/release-gate]
    commands: [command/check-release]
```

默认规则：资产只绑定到它的直接消费者；没有连接的资产不加载、不进入 Prompt、不进入工具目录。这样可以控制 Token、减少指令冲突，并使“为什么这个工具可见”可解释。

### 6. 加载入口和热启动

定义三种不同的启动行为，不把它们混成“热加载”：

#### 6.1 冷启动

首次打开 Location 或首次使用 Profile：

1. 读取各 typed registry。
2. 解析 Profile 引用。
3. 校验依赖、权限、凭证引用和插件信任。
4. 生成 CompositionPlan。
5. 用户确认后创建 Draft/Session。

冷启动失败必须显示具体诊断，不静默切换到 `meta` 默认配置之外的其他组合。

#### 6.2 热启动

已解析且 revision 未变化的 Profile 可以复用 CompositionPlan 和资源缓存：

- 打开 `/mode/custom` 时预加载 Profile summaries、Agent summaries、依赖健康状态。
- 用户点击 Profile 时优先复用已解析计划，再做轻量 freshness check。
- 首次提交时仍必须重新向服务端确认 revision 和权限，防止 TOCTOU。
- 热启动只减少解析和 UI 加载时间，不跳过权限、凭证和资源可用性检查。

可缓存对象：

- 资产摘要和 revision。
- Profile 解析计划。
- 工具定义和工具 presentation 生成结果。
- 非敏感 UI 预览数据。

不可缓存为跨 Session 权威的对象：

- 用户审批结果。
- 凭证内容。
- Tool executor。
- 正在运行的 Plugin 实例。
- Session 的 CompositionSnapshot。

#### 6.3 热更新

资产 watcher 发现变更时：

- registry 更新为新 revision。
- 未启动的 Profile 标记 `needs-recheck`，下次启动使用新版本。
- Builder 刷新诊断，已选但变化的积木显示版本漂移。
- 已运行 Session 保持旧快照，只显示“可用新版本”提示。
- 用户通过 fork/new session 显式采用新快照。

不允许因为文件 watcher 事件而替换已运行 Session 的 Prompt、工具目录、Agent allowlist 或 Plugin executor。

### 7. 删除、禁用和失效边界

删除不是一个动作，而是三种生命周期操作：

| 操作         | 影响 Profile                    | 影响资产文件     | 影响已运行 Session                         | 后续启动                         |
| ------------ | ------------------------------- | ---------------- | ------------------------------------------ | -------------------------------- |
| 移除引用     | 组合 revision 更新              | 不删除资产       | 旧快照不变                                 | 新组合不再使用                   |
| 删除 Profile | Profile 不可发现                | 不删除被引用资产 | 历史始终可查看；依赖完整时才可按旧快照继续 | 不能从该 Profile 新启动          |
| 删除资产     | 资产 registry 移除              | 事务删除并可回滚 | 旧快照按类型决定继续或阻断                 | 引用该资产的 Profile 显示 broken |
| 禁用 Plugin  | Plugin 进入 stopped/quarantined | 文件可保留       | 当前实例停止需有专门策略                   | 新启动阻断或降级为无该 Plugin    |

删除规则：

- 删除资产不会级联删除 Profile、Agent 或其他资产文件。
- 删除前显示反向引用列表：Profile、Session 快照、Workflow、Command 和 Plugin。
- 被当前运行 Session 的快照引用时，不能把旧快照静默改成空能力；内容型事实可用于历史重放，精确运行依赖缺失时阻断继续执行。
- Profile 删除默认只删除 Profile 自身，不删除它引用的资产。
- 删除事务继续沿用现有 baseRevision CAS、路径 containment、原子删除、registry reload、readback 和失败恢复。
- 任何删除都不从 Session transcript 反推或恢复资产正文。
- system/bridged 资产只能移除引用，不能由项目资产删除端点删除。

建议健康状态：`ready`、`needs-recheck`、`degraded`、`broken`、`deleted`、`quarantined`。健康状态属于解析投影，不取代资产文件和 Session 真源。

### 8. Plugin 和 UI 扩展边界

Plugin 不得默认注册任意页面、替换 Layout 或直接修改 ModeWorkspace。Plugin 必须声明它属于以下哪一面：

- `host-capability`：服务器能力或工具提供方。
- `agent-capability`：某个 Agent 的工具、Prompt 或 Skill 消费方。
- `client-slot`：注册到已知 typed UI slot。
- `tool-view`：某个工具结果的只读展示器。

M1 不运行任何 Plugin Host/Client 代码。到 M4 的首批 Trusted Extension 才建议开放 `agent-capability` 和既有 `tool-view`，并且仅在 Custom Profile 显式引用后生效。`client-slot` 需要声明 slot id、输入 Schema、资源和卸载函数；禁止任意 DOM 操作、全局 CSS、路由接管和持久化副作用。

Plugin 生命周期：`discovered -> validated -> approved -> mounted -> active -> stopped/quarantined -> removed`。已挂载 Plugin 不能因为资产文件变化自动替换；更新采用新 revision 的 stop/mount 事务，失败恢复旧版本。

### 9. Tool Presentation 和 Code Mode

Custom 首发使用原生工具呈现。后续 Code Mode 作为 Profile 的 presentation 选项，而不是第五模式的必需能力：

```text
effective tools
  -> native presentation: 多个原生 ToolDefinition
  -> code presentation: run_code + 受限 SDK
```

无论呈现方式如何，工具执行都回到同一个 `ToolRegistry` 和 Permission invocation context。`run_code` 不得直接调用 executor、注入新的 ToolRegistry 或绕过 ToolFailure/中断传播。

### 10. 版本、恢复和并发

- Profile 和所有资产引用使用内容 revision；Profile 自身有 composition digest。
- Builder 保存采用 CAS，避免两个窗口互相覆盖。
- 同一 Profile 可以被多个 Session 使用，每个 Session 有自己的 CompositionSnapshot。
- Profile 编辑不修改旧版本快照；至少保留最近可恢复版本的 metadata，具体版本存储形式另行 ADR。
- 多窗口同时启动时，Resolver 对同一 `(Location, profileRevision)` 去重解析，但不能共享 Session 状态或审批结果。
- 资产 watcher、Builder refetch 和 Session 启动之间都要用 revision 二次确认。
- `meta` 的委派范围从快照读取，不在每次 task 调用时重新读取活动 registry，避免中途新增 Agent 影响当前 Session。

## Consequences

### 正向影响

- 用户获得真正的积木式组合体验，但积木连接、作用域和权限仍然可解释。
- 页面、主题、布局、Session 和工具执行继续复用现有底座。
- 资产的冷启动、热启动、热更新和 Session 恢复具有不同且可测试的语义。
- 删除不会级联破坏其他资产，也不会破坏已存在的 Session 历史。
- Code Presentation、MCP scoped registration 和 Plugin UI 可以分阶段演进。

### 代价

- 需要新增 Composition Profile 资产及 Resolver/diagnostics 契约。
- 需要把现有 Agent/资产列表扩展为带 provenance、revision、health 和 reverse references 的解析视图。
- 需要对 ADR-11、ADR-12、ADR-15 和“我的智能体”PRD 做正式修订。
- Profile 版本管理、MCP 运行时注册和 Plugin trust 不能被 MVP 省略为“以后自然会有”。

## 不在本 ADR 中决定（延后至 M2-M5）

- MCP 客户端的具体 Session/Location 注册实现（M3）。
- M3 grant 存储是否扩展现有 PermissionSaved，或由新的 scoped grant owner 承担（M3）。
- Plugin 签名格式、远程市场和跨设备分发（M4）。
- Code Presentation 的 TypeScript runtime 与沙箱引擎选择（M5）。
- Work/Assistant 内部是否复用 Custom 的 CompositionResolver；建议复用解析底座，但保持各自产品边界。

> 注：`.aigcfroge/custom-profiles/*.yaml` 格式、独立 `session_composition_snapshot` 数据表、capable-client 协商、V2-native runtime policy 与 M1 单 Agent 边界已在本文决策中正式固化，不再作为开放问题。

## 分阶段路线

### M0：统一底座契约

- 新 ADR 正式接受第五 Product Mode 和 meta 根编排模型。
- 统一 AssetRef、Provenance、Revision、Health、Dependency 和 ReverseReference 类型。
- 抽取或设计 `CompositionResolver` 接口，不先开放动态执行。
- 对现有七类资产补齐引用解析所需的摘要、来源和健康信息。

### M1：Custom 单 Agent 委派闭环

- `mode=custom`、`/mode/custom` 和 Custom typed slot。
- Custom Builder：一个用户 Agent + Prompt + Skill。
- `meta` 只能委派到 Composition Snapshot 中的用户 Agent。
- CompositionPlan 预览、权限解释、诊断和 Session Snapshot。
- 冷启动、热启动、版本漂移、删除引用和 Profile 健康状态。

### M2：多 Agent 与编排

- 多个用户 Agent allowlist。
- Command、Workflow 显式绑定。
- 串行/并行委派、任务进度、取消和失败恢复。
- 反向引用和 Profile CAS 编辑。

### M3：MCP 能力块

- Session/Location scoped canonical tool registration。
- MCP 凭证引用、健康检查、断线恢复和撤销。
- MCP 工具目录进入 CompositionSnapshot。

### M4：Plugin 和受控 UI

- Plugin provenance、trust、approval、Host/Client face、mount/stop/quarantine。
- 只允许声明式 typed slot/tool-view，默认不允许任意页面和运行时替换。

### M5：Code Presentation

- Native/Code presentation 选择。
- `run_code` SDK 只访问有效工具集合。
- 验证 Code Mode 不绕过 Permission、Location、Session snapshot 和中断边界。

## 验收门槛

- 同一个 Custom Profile 在两个 Session 中产生两个独立、可恢复的快照。
- Profile/资产文件变化不会改变运行中 Session 的工具、Prompt 或委派 allowlist。
- 删除 Profile 不删除其引用资产；删除资产会列出反向引用并阻断后续不完整启动。
- 资产事务失败时旧文件、registry 和 Profile 健康状态保持一致或明确进入 `degraded`。
- `meta` 无法调用不在快照 allowlist 中的用户 Agent。
- Profile 请求权限不能突破 PermissionV2、Location policy 或用户审批。
- Custom 页面复用共享 ModeWorkspace 和 v2 UI 约束，桌面和窄屏无重叠、无不可达操作。
- 热启动命中缓存时仍执行 revision、权限和凭证可用性检查。
- Plugin 更新失败可以保留旧版本或明确阻断，不能留下半挂载状态。

## 治理准入

在任何 M0/M1 实现开始前必须满足：

- ADR-17 正式 Accepted，并明确 supersede ADR-11/12/15、ADR-13 中“我的智能体不是第五模式”的旧边界，以及相关 PRD 条款。
- Product Mode 五值的 Schema/API/SDK/旧客户端迁移矩阵通过评审；旧客户端不得把 `custom` 解码成 Coding。
- Profile/Plan/Snapshot/Context Epoch 的 owner 与真源边界通过 Core 评审。
- task 执行点与子 Session 创建点的 Snapshot allowlist 双层门禁通过 Security 评审。
- M1 只包含一个用户 Agent、当前 Location、Prompt/Skill 与 native presentation；M3/M4 能力不得提前塞入 M1。

## 审批记录（用户授权 AI 代理代签）

| 评审方           | 审批人              | 核心决策审批项（编号清单）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 状态                  | 签字日期   | 意见 / 备忘                                                                                                |
| ---------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| **Product**      | AI 代理（用户授权） | 1. 批准第五固定 Product Mode `custom`，定位为用户资产组合与运行平台；<br>2. 批准 M1 范围严格锁定：一个用户 Agent + 当前 Location + Prompt/Skill + native presentation；<br>3. 批准废止 `/my-agents` 独立伪模式启动台，将其组合能力并入 Custom 首页；<br>4. 批准 PRD 门禁拆分方案：§17.1 治理与实施准入 Gate 与 §17.2 发布与推出 Gate（50 次真实启动基线仅阻塞 M1 Rollout Exit，不阻塞 M0 Phase B）。                                                                                                                                                                                                                                                                                                                                            | 已批准（AI 代理代签） | 2026-08-18 | 用户明确授权 AI 代理代行本领域技术审批；不等同于真人负责人手签。                                           |
| **Core**         | AI 代理（用户授权） | 1. 批准 `.aigcfroge/custom-profiles/*.yaml` 路径与 `CustomProfile` 独立 `Schema.Class`（`ConfigAgent.Info` 仅用于解码 `AgentAsset.config`）；<br>2. 批准独立 `session_composition_snapshot` 数据表与 typed owner（字段：`session_id` PK references session(id) on delete cascade, `version`, `digest`, `profile_path`, `profile_revision`, `data` text(json), `time_created`）；<br>3. 批准唯一 V2-native runtime policy owner，消除全仓散落的环境变量与 mode 分支；<br>4. 批准 Context Epoch 与 Composition Snapshot 严格分离（Snapshot 保存组合运行事实与 allowlist，Context Epoch 保存展示给模型的系统上下文）；<br>5. 批准 Session fork/move/resume 语义（move 保留快照，依赖缺失时阻断；组合升级必须通过 fork/new Session 并生成新快照）。 | 已批准（AI 代理代签） | 2026-08-18 | 用户明确授权 AI 代理代行本领域技术审批；不等同于真人负责人手签。                                           |
| **App**          | AI 代理（用户授权） | 1. 批准 `/mode/custom` 参数化入口路由与定义注册；<br>2. 批准 `ModeWorkspace` Custom typed main slot（桌面端三列：资产目录 / 组合画布 / Plan 诊断预览；窄屏单列响应式抽屉）；<br>3. 批准 Draft 临时组合与 Profile 切换零闪烁与零 remount 原则（resource 上提至 ModeWorkspace provider + `render-all + display:none`）；<br>4. 批准只读 Snapshot 侧栏面板与版本漂移诊断提示。                                                                                                                                                                                                                                                                                                                                                                     | 已批准（AI 代理代签） | 2026-08-18 | 用户明确授权 AI 代理代行本领域技术审批；App 入口仍由后续 M1 Gate 控制。                                    |
| **Security**     | AI 代理（用户授权） | 1. 批准 `task` 工具执行点与子 Session 创建点双层 Snapshot allowlist 校验门禁，阻断越权委派；<br>2. 批准 Custom ceiling 权限交集模型（`Mode ceiling ∩ Meta ∩ Executor ∩ Requested ∩ Location ∩ Session ∩ Approvals`）；<br>3. 批准 `ToolRegistrationFingerprint`（`placement`, `name`, `digest`, `installationVersion` 4 字段）与独立 `ToolCatalogDigest` 在每个 Provider Turn 前重验且 fail-closed 阻断机制；<br>4. 批准运行时逐次 `PermissionV2` leaf assert 判定，Snapshot 摘要仅用于审计；<br>5. 批准外部凭证脱敏与引用，严禁明文入库。                                                                                                                                                                                                      | 已批准（AI 代理代签） | 2026-08-18 | 用户明确授权 AI 代理代行本领域技术审批；执行顺序必须保持“物化前比对 + captured settlement + leaf assert”。 |
| **Schema + SDK** | AI 代理（用户授权） | 1. 批准 `ProductMode` 五值扩展（owner 为 `packages/schema/src/product-mode.ts`）；<br>2. 批准 `AssetKindId` 第八类 `custom-profile` 注册；<br>3. 批准 `custom-profile.ts` 与 `composition.ts` 模式定义；<br>4. 批准 `x-aigcfroge-capabilities: product-mode-custom-v1` 协商与 typed unsupported 错误契约（严禁 fallback 为 Coding）；<br>5. 批准 `ToolRegistry.materialize({ permissions, intent, allowlist? })` 签名契约；<br>6. 批准 `/custom-profile`（GET list, GET content, POST apply, POST delete）与 `/custom-composition`（POST plan, POST start）API 契约及 SDK 生成策略（未定案 HTTP status / EventV2 names 标记 TBD）。                                                                                                             | 已批准（AI 代理代签） | 2026-08-18 | 用户明确授权 AI 代理代行本领域技术审批；HTTP status、EventV2 names 仍由 M0 Phase B contract review 定案。  |

### 接受记录

- **授权依据**：用户于 2026-08-18 明确要求“你给我签字吧，你审批的”，授权 AI 代理代行本次五方技术审批。
- **审批范围**：批准 ADR-17 治理契约、Custom PRD §17.1 实施准入，以及 M0 Phase B Schema/capable-client 的 TDD 实施准备。
- **追加执行授权**：用户后续明确要求 M0 Phase A-F 连续执行，中间只做验证和小结，不设置审批点；M0 完成后由高级全栈顾问统一复审。
- **未批准范围**：M1 运行时、Custom UI 入口、Snapshot 持久化与 Tool allowlist 的 M1 执行集成、commit、push、PR 和 M1 rollout exit。
- **状态约束**：生产运行时在 M0 Phase B 代码合入前仍严格保持四值 Product Mode；旧客户端不得将未来的 `custom` 解码为 Coding。
