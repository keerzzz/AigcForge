# DeepSeek Harness 四模式借鉴与 AigcForge 自定义模式思维风暴

> 状态：研究与产品讨论草案，不是已接受 ADR 或实施计划
> 日期：2026-08-16
> 外部参考：`/home/keer/Documents/web/deepseek-harness-master`
> 当前产品裁决：把“自定义模式”作为 AigcForge 第五个大模式继续设计
> 调度裁决：Custom 根会话固定由 `meta` 元智能体拥有；用户创建的 Agent 是 `meta` 在该组合内可调度的执行 Agent。Coding（即 Code 模式）保留 `meta` 与 `build` 互补的特殊关系。
> 冲突提示：本裁决候选修订 ADR-11 的“四种 Product Mode”封闭集合，以及 `docs/prd/my-agents-launcher.md` 中“不是第五个 Product Mode”的旧结论。实施前必须通过新 ADR 明确取代关系，不能静默改写历史决策。
> 统一底座提案：详见 [ADR-17](../../architecture/adr/ADR-17-custom-mode-composition-platform.md)，产品范围见 [Custom PRD](../../prd/custom-mode-composition-platform.md)，交付阶段见 [Custom 路线图](../../roadmap/custom-mode-roadmap.md)。

## 1. 已保存的调研结论

DeepSeek Harness 内置四个 Agent preset：

| Preset | 核心作用 | 对 AigcForge 的主要启发 |
|---|---|---|
| `standard` | 完整编码工具、计划、压缩、子代理、工作流 | 用稳定能力组合装配 Agent，而不是只配置名称和提示词 |
| `code` | 底层能力不变，模型只看到 `run_code`，通过 TypeScript SDK 编排工具 | 把工具能力、有效工具集和模型工具呈现拆成三层 |
| `minimal` | 固定提示词，只暴露持久 Bash 与编辑器 | 为专用 Agent 提供可验证的最小能力面 |
| `cordis` | 在完整编码能力上增加运行时检查、自修改和 preset 创作 | 提供 inspect、propose、validate、apply 的 Agent 创作体验，但不要直接执行不受控的模型代码 |

AigcForge 已有对应基础：

- `build`、`meta` 和 Product Mode 已覆盖完整 Agent 与产品职责分区。
- `chat-orchestrator`、`work-orchestrator`、`assistant-orchestrator`、`explore` 已实践最小权限 Agent。
- `ToolRegistry.materialize()` 已按 Permission 与 Intent 生成有效工具集。
- Chat 资产工作室已支持 Prompt、Skill、MCP、Command、Agent、Workflow、Plugin 七类资产。
- `propose_*_asset -> review -> apply` 比模型直接修改运行时更符合当前安全边界。
- Session V2、EventV2、Context Epoch 和 durable Session classification 已具备冻结与恢复组合状态的基础。

最值得继续落地的顺序：

1. 增加 Tool Presentation 层，支持 Native 与未来 Code Presentation。
2. 把 Agent 的 Prompt、Permission、Tools、Skills、子代理和工作流能力正式组织成可解析的组合。
3. 标准化最小能力 preset，不增加第二套编辑工具语义。
4. 增强 Meta Agent 的 inspect、propose、validate 能力，继续保留用户审批和事务落盘。

## 2. 第五个大模式的第一性定义

### 2.1 要解决的问题

现有四种 Product Mode 都由产品预先规定任务边界：

- Chat：创建和管理资产。
- Coding：执行软件开发工作。
- Work：按预设或工作流交付结构化成果。
- Assistant：处理个人提醒、记忆、笔记与知识库。

用户创建 Agent、Skill、Prompt、MCP、Command、Workflow 和 Plugin 后，仍缺少一个统一消费场所，让用户自己决定“由谁工作、带哪些资产、拥有哪些能力、用什么方式运行”。

自定义模式解决的不是“再提供一个内置专家”，而是：

> 用户在一个受约束、可预览、可恢复的运行空间中，为 `meta` 选择可调度的自建 Agent 和其他资产，形成一次会话的执行环境。

### 2.2 推荐定义

新增稳定 Product Mode：

```text
chat | coding | work | assistant | custom
```

`custom` 是第五个固定产品模式，不是任意字符串模式注册系统。用户可以创建任意多份“自定义配置”，但这些配置都在 `mode=custom` 下运行。

这样同时满足：

- 全局模式栏拥有明确的第五入口。
- Session 仍有封闭、可索引、可迁移的 Product Mode。
- 用户配置数量不膨胀 Product Mode 枚举、路由和 Session 分类。
- 每个自定义配置可以拥有不同 Agent 和资产组合。

### 2.3 “自由使用”的准确含义

“自由”应表示：

- 用户可以发现和选择自己拥有的资产。
- 用户可以组合兼容资产，不受内置业务流程限制。
- 用户可以保存组合并重复启动。
- `meta` 可以根据用户意图调用组合中明确授权的自建 Agent、工作流和其他能力。
- 用户可以在启动前看见最终 Prompt、工具、数据源和权限摘要。

“自由”不表示：

- 绕过 Location、Permission、沙箱或用户审批。
- 让资产声明自行扩大宿主权限。
- 在会话运行中静默替换 Agent、工具或插件版本。
- 直接执行未验证的模型生成插件代码。
- 自动把项目资产提升为全局资产或跨 Location 读取。

## 3. 核心产品模型

### 3.1 三个正交概念

```text
Product Mode: custom
Custom Profile: 用户选择并保存的一份资产组合
Root Orchestrator: 固定为 meta
```

Product Mode 决定 Session 分类和页面归属。Custom Profile 决定该 Session 可使用哪些用户 Agent 和资产。`meta` 固定拥有根会话、理解意图、选择执行者并汇总结果。

不要把 Custom Profile 继续塞进 Agent Asset。Agent 资产描述一个可执行角色，Profile 描述 `meta` 本次可以调度哪些角色以及为它们装配什么。两者职责不同。

### 3.2 五种模式的智能体关系

| Product Mode | 根会话入口 | 专用执行者 | 关系 |
|---|---|---|---|
| Chat | `meta` | `chat-orchestrator` | `meta` 判断资产任务并委派给 fail-closed 资产执行者 |
| Work | `meta` | `work-orchestrator` | `meta` 判断交付任务并委派给预设驱动的文档执行者 |
| Assistant | `meta` | `assistant-orchestrator` | `meta` 理解个人事项并委派给提醒、记忆、笔记和知识库执行者 |
| Custom | `meta` | Custom Profile 中的用户 Agent | `meta` 只能在已冻结的用户 Agent 池内选择执行者 |
| Coding | `meta` 或 `build` | `build`、`explore`、`plan` 等 | 特例：`meta` 负责路由与复杂编排，`build` 是可直接使用的编码执行者，两者互补而非只有上下级关系 |

目标架构是“除 Coding 特例外，由 `meta` 统一拥有根对话并调度模式执行者”。当前代码存在一处漂移：`ProductModeAgentPolicy.resolvePrimaryAgent()` 仍让 Assistant 默认使用 `assistant-orchestrator`。后续 ADR 和实施计划需要决定何时把它收敛到本表；本研究稿只记录目标，不在本次文档提交中修改运行时代码。

### 3.3 Custom Profile 推荐结构

```yaml
kind: custom-profile
name: 发布审查团队
description: 检查版本、文档与安全风险
version: 1

agents:
  - ref: agents/security-reviewer.md
    revision: <sha256>
  - ref: agents/docs-reviewer.md
    revision: <sha256>

assets:
  prompts: []
  skills: []
  mcp: []
  commands: []
  workflows: []
  plugins: []

presentation: native

permissions:
  requested: []
```

字段只是讨论草案，关键语义是：

- `meta` 是隐含且不可被 Profile 替换的根编排者，不需要写入 Profile。
- `agents` 是 `meta` 在该 Profile 中可调度的用户 Agent allowlist，而不是根会话 Agent 候选。
- M1 至少选择一个用户 Agent；后续可以选择多个，但都只能通过明确的委派工具运行。
- 其他资产均为显式引用，不从名称或 Prompt 猜测依赖。
- 每个引用带 revision，启动时解析为不可变快照。
- `presentation` 初期只支持 `native`，未来可增加 `code`。
- Profile 可以请求权限，但不能授予权限。

### 3.4 资产绑定与上下文控制

把所有资产正文一次性塞给 `meta` 和每个用户 Agent，会造成上下文膨胀、指令冲突和权限含混。Profile 应允许资产绑定到明确消费者：

```yaml
bindings:
  orchestrator:
    prompts: []
    skills: []
  agents/security-reviewer.md:
    prompts: []
    skills: []
    mcp: []
  shared:
    workflows: []
    commands: []
```

- `meta` 默认只看到 Agent 和资产的目录、描述、健康状态及调度规则，不自动加载所有正文。
- `orchestrator` 绑定影响根会话中的 `meta`。
- Agent 绑定在创建对应子会话时物化，并记录进入子会话的资产 revision。
- `shared` 表示可被多个执行者选择，不表示自动注入，也不授予额外权限。
- Skill 仍按需加载；MCP、Command、Workflow 和 Plugin 仍需经过各自的注册、验证和权限边界。

### 3.5 临时组合与可复用组合

推荐同时支持两条路径：

1. 临时组合：用户在 Custom 首页选择 Agent 和资产，直接启动一次 Draft。
2. 保存组合：把已经验证的临时组合保存为 Custom Profile 资产，后续一键启动。

这避免用户在第一次使用前必须理解配置文件，也避免每次重复选择同一批资产。

## 4. 资产在自定义模式中的角色

| 资产 | 运行角色 | 关键约束 |
|---|---|---|
| Agent | `meta` 可选择的用户执行者 | 只能从 Profile allowlist 委派；不自动继承 `meta` 或父 Session 的更高权限 |
| Prompt | 追加任务或领域指令 | 顺序显式；冲突可见；内容进入可恢复的模型上下文 |
| Skill | 按需加载的操作规程 | 只进入目录不等于已执行；Skill 本身不能授予工具权限 |
| MCP | 提供外部工具和数据源 | 需要 Session 或 Location scoped 注册设计、凭证引用和健康检查 |
| Command | 用户显式触发的快捷流程 | 不能在加载时自动执行；参数 Schema 必须验证 |
| Workflow | 可复用编排定义 | 定义可选，执行仍受并发、子 Agent 和权限上限约束 |
| Plugin | 扩展宿主或客户端能力 | 高风险；必须签名/来源/审批/作用域明确，不能直接热执行任意代码 |

### 4.1 推荐首发范围

最终需求覆盖七类资产，但不应假装它们当前具有相同的运行成熟度。

建议分层开闸：

- M1：`meta` + 一个用户执行 Agent + Prompt + Skill，完成 Custom Product Mode、委派闭环、组合预览和 durable snapshot。
- M2：多个用户 Agent + Command + Workflow，补齐选择、并行编排和进度展示。
- M3：MCP，先完成 Session/Location scoped canonical tool registration、凭证引用和断线恢复。
- M4：Plugin，建立受信任来源、能力声明、用户审批、Host/Client 分面与回滚后再开放。
- M5：Code Presentation，在不改变底层有效工具集的前提下提供 `run_code`。

## 5. 有效能力计算

自定义模式不能让 Profile 成为新的权限系统。推荐使用交集模型：

```text
Effective Capabilities
  = Custom Mode ceiling
  ∩ Meta orchestration permissions
  ∩ Selected executor permissions
  ∩ Selected asset requested capabilities
  ∩ Location policy
  ∩ Session permission policy
  ∩ User approval decisions
```

规则：

- 任何一层 deny 都必须保留。
- 资产只能声明需要什么，不能声明自己已经获准。
- 用户允许某个 MCP 或 Plugin，不等于允许它的所有未来版本。
- 子 Agent 权限不能高于父 Session 与自身规则交集。
- `meta` 只能委派给 Composition Snapshot 中的 Agent allowlist；不能因为注册表中存在另一个 Agent 就调用它。
- 工具是否展示给模型和工具是否获准执行必须分开。
- 启动预览展示“请求能力、有效能力、被拒绝能力”三列，不使用模糊的“可信”开关。

## 6. Tool Presentation

自定义模式很适合承接 DeepSeek Harness Code Mode 的经验，但它不应与第五 Product Mode 绑定死。

```text
Registered Tools
  -> Effective Tool Set
  -> Tool Presentation
       -> native: 多个原生工具定义
       -> code: 一个 run_code + 生成的 SDK
```

Custom Profile 可以选择 presentation，但安全判断基于同一个 Effective Tool Set。`run_code` 内部调用仍经过 canonical `ToolRegistry` settlement，不能直接持有工具 executor 或绕过 Permission。

首发保持 `native`。等 Session scoped tool registration 和快照契约稳定后再增加 `code`，降低同时引入两种新抽象的风险。

## 7. Session V2 持久化与恢复

### 7.1 启动时冻结

Custom Draft 在首次提交前可以自由修改选择。首次提交创建 Session 时冻结：

- `mode=custom`
- Custom Profile id 和 revision，可为空表示临时组合
- 根会话 Agent 固定为 `meta`
- 允许委派的用户 Agent id、来源和 revision
- 每类资产的规范引用和 revision
- 资产到 `meta` 或具体用户 Agent 的绑定关系
- Tool Presentation
- 有效工具目录 digest
- 有效权限摘要或 policy digest
- 模型可见 Prompt/Skill/运行时上下文的已记录输入

### 7.2 运行中不静默换装

Session 产生第一条 durable input 后，不允许直接替换 Profile。用户修改组合时提供：

- 新建 Session
- 从当前 Session fork，并明确采用新版组合
- 继续使用当前冻结组合

不要让资产文件热更新改变正在运行的 Session。否则历史工具调用、Prompt Cache、恢复和审计会失去一致性。

### 7.3 资产变化后的恢复

恢复时必须比较 revision：

- 内容型资产已有冻结快照时，继续使用会话快照。
- 工具/插件型资产缺失或版本不匹配时，不静默升级，返回可解释的阻断状态。
- 用户可选择“按原版本恢复”“迁移到新版本并 fork”“取消”。
- 凭证只保存引用，不进入 Session 日志或快照。

这遵循“model-visible 必须可从日志重建”的仓库规则。

## 8. 自定义模式页面构想

### 8.1 模式首页 `/mode/custom`

核心对象不是普通 Session 列表，而是“可运行组合”：

- 最近使用的 Custom Profile
- 新建临时组合
- 已保存组合
- `mode=custom` 最近会话
- 组合健康状态：可运行、缺失资产、权限变化、版本漂移

### 8.2 组合构建器

推荐工作流：

1. 选择 Location。
2. 选择至少一个供 `meta` 调度的用户 Agent。
3. 可选继续添加其他用户 Agent，并查看每个 Agent 的职责与权限。
4. 按类型添加 Prompt、Skill、MCP、Command、Workflow、Plugin。
5. 查看组合解析结果、冲突、工具目录和权限差异。
6. 选择模型与 Tool Presentation，前提是 Agent 允许覆盖。
7. 直接启动，或保存为 Custom Profile 后启动。

### 8.3 预览与解释

启动前提供四个检查视图：

- Instructions：系统 Prompt、资产 Prompt、Skill 目录的最终顺序。
- Capabilities：最终工具、MCP、命令、工作流和委派 Agent。
- Permissions：allow、ask、deny 及来源。
- Diagnostics：缺失依赖、重名、版本漂移、不可用凭证、插件风险。

用户不应该靠试运行才知道某项资产未生效。

## 9. 与其他四种模式的边界

| 模式 | 核心对象 | 与 Custom 的关系 |
|---|---|---|
| Chat | 资产生命周期 | 创建、编辑、导入和管理 Custom 使用的资产与 Profile |
| Coding | 内置完整编码体验 | 提供开箱即用的稳定编码组合；不要求用户装配 |
| Work | 结构化交付和官方预设 | 提供受引导的业务执行；Custom 面向用户自选能力组合 |
| Assistant | 个人事项和主动触达 | 保持提醒、记忆、知识库的专属安全语义 |
| Custom | `meta` 调度用户资产的自由装配与运行 | 消费已创建资产，保存和复用组合，不取代资产管理中心 |

Custom 不应吞并其他模式。即使用户能在 Custom 中组合出类似 Coding 或 Work 的能力，内置模式仍提供稳定默认、专属 UI、明确安全边界和无需配置的体验。

## 10. 与现有决策的冲突和修订建议

### 10.1 必须修订

- ADR-11：Product Mode 从四值扩展为五值。
- ADR-12：`/mode/:mode` 解码加入 `custom`，共享 ModeWorkspace 加入 typed Custom slot。
- ADR-15：主区 slot 和右侧 Canvas slot 加入 Custom 核心对象定义。
- `docs/prd/my-agents-launcher.md`：从“独立启动台，不是第五模式”调整为 Custom 首页中的 Agent/Profile 启动能力。
- Assistant PRD §21.2：撤销“不新增第五种 Product Mode 硬编码”的旧扩展结论。

### 10.2 应继续保留

- Session 和 Draft URL 不编码 Product Mode。
- 切换模式入口不自动创建或恢复 Session。
- Project/Workspace 跨模式共享，Session 按 mode 分类。
- Session.mode 创建后不可变。
- Chat 继续作为资产管理中心。
- 所有模式复用 ModeRoute、ModeWorkspace 和 canonical Session route。

## 11. 主要风险

| 风险 | 后果 | 控制方式 |
|---|---|---|
| 资产组合变成第二套权限系统 | 用户资产可提权 | 请求与授权分离，所有能力取交集 |
| Session 中途资产升级 | 无法恢复历史执行环境 | 创建时冻结 revision，升级通过 fork |
| MCP/Plugin 进程级注册 | 多会话串扰和名称冲突 | 先设计 Session/Location scoped canonical registration |
| Prompt/Skill 顺序不明确 | 行为不可解释 | 显式排序和最终 Prompt 预览 |
| 多 Agent 没有所有者 | 最终回答、取消和权限继承混乱 | 根会话固定由 `meta` 拥有，用户 Agent 均为 delegate |
| 自定义模式吞并其他模式 | 产品心智和 UI 失焦 | Custom 定位为组合容器，内置模式保留专属体验 |
| “自由”被理解为默认全允许 | 安全事故 | 默认继承现有策略，危险能力逐项 ask |
| Profile 引用跨 Location 资产 | 路径泄漏和不可移植 | M1 只允许当前 Location，后续以明确 provenance 开全局资产 |

## 12. 推荐的最小可行闭环

MVP 不从“七类资产全部动态运行”开始，而从可验证闭环开始：

```text
进入 Custom
  -> 选择当前 Location
  -> 为 meta 选择一个用户执行 Agent
  -> 添加 Prompt / Skill
  -> 查看最终指令与权限
  -> 创建 mode=custom Draft
  -> 首次提交冻结 Composition Snapshot
  -> 运行并恢复同一组合
  -> 可选保存为 Custom Profile
```

MVP 验收标准：

- Custom 是第五个可导航、可持久分类的 Product Mode。
- 根 Session 的 Agent 始终是 `meta`，且不能被 Custom Profile 替换。
- `meta` 只允许委派来源明确、当前可用且已冻结进组合的用户 Agent。
- Draft、Session、子 Session 与恢复路径中的 Agent allowlist 和资产 revision 一致。
- Profile 不得提升 Agent、Location 或 Session 权限。
- 资产缺失、冲突或变化必须显式失败，不回退默认 Agent。
- 当前 Session 的组合在资产文件更新后保持不变。
- Custom Session 使用 canonical Session route。
- Chat 创建的 Agent、Prompt、Skill 可在 Custom 中完成一次真实消费闭环。

## 13. 协议复核后的裁决

2026-08-16 按 `CLAUDE.md`、`protocols`、Accepted ADR、Session/Tool/Permission 协议、Custom PRD 和路线图复核后，范围收敛为：

1. Custom 根会话固定使用 `meta`；M1 只有一个用户 Agent 委派目标，零个或多个都阻断，多 Agent 留到 M2。
2. `custom-profile` 作为第八类资产的方向成立，但必须等待 ADR-17 Accepted，并拥有独立 AssetKind/typed owner/事务/registry 契约。
3. Draft 阶段可修改组合；首次提交冻结 Snapshot，运行后只能通过 fork/new Session 采用新组合。
4. M1 只开放当前 Location 的 Agent + Prompt + Skill 与 native presentation；全局资产、MCP、Command、Workflow 执行、Plugin runtime 和 Code Presentation均后置。
5. M1 完全不执行 Runtime Extension；M4 才允许已安装、验证、审批、版本固定且可停止/隔离/回滚的 Trusted Extension，禁止模型代码即时执行。
6. 删除 Profile 后历史与 Snapshot 始终可查看；继续执行取决于冻结内容与精确运行依赖，缺失时明确阻断，不能静默使用默认 Agent 或最新版本。
7. 统一审批入口属于 M3：应用级可见，授权事实限定 once/Session/Location，并包含 Agent、revision、过期和撤销语义；应用级入口不等于应用级永久授权。
8. Prompt/Skill 提供明确默认消费者绑定并允许启动前改绑；未连接资产不加载，不做全员自动注入。

## 14. 当前推荐结论

采用“第五 Product Mode + 任意多个 Custom Profile”的双层模型：

```text
custom = 稳定的产品入口、Session 分类和共享工作区 slot
meta = Custom 根会话的固定编排者和最终回答所有者
Custom Profile = meta 可调度的用户 Agent 池及其可保存、可版本化、可检查的资产组合
Composition Snapshot = 每个 Session 创建时冻结的运行真值
```

这比“每个 Agent 一个模式”更可控，也比“我的智能体只是启动台”更完整。它真正覆盖用户提出的目标：用户在一个独立大模式中选择自己创建的智能体并组合其他资产，由 `meta` 统一理解、调度和汇总，同时保持 AigcForge 的权限、Location、Session V2 和资产审批边界。Coding 保留 `meta` 与 `build` 互补的产品特例，不强行套入单一委派模型。

## 15. 升级方向已收敛

第五模式不直接把资产当作任意可执行代码，而采用四层平台模型：

```text
Platform Foundation
  -> Composition Profile
      -> Asset Blocks
          -> Session Composition Snapshot
```

- **Platform Foundation**：复用现有 ModeWorkspace、Session V2、Permission、ToolRegistry、Location、v2 UI 和 Plugin 安全边界；用户资产不能替换这些底座。
- **Composition Profile**：新增的第八类资产，保存 Agent allowlist、资产引用、绑定关系、presentation 和 revision；由 Chat 管理、Custom 消费。
- **Asset Blocks**：Agent/Workflow 是主干，Skill/MCP/Command 是枝干，Prompt/参数/数据引用是叶子，Plugin 是高风险扩展；所有连接必须显式。
- **Composition Snapshot**：首次提交时冻结 Profile 和资产解析结果；当前 Session 不因 watcher 或文件变化而热替换执行环境。

加载生命周期分为三种：

1. 冷启动：完整解析、依赖检查、权限计算和用户预览。
2. 热启动：复用未过期的解析计划和非敏感缓存，但仍重新确认 revision、权限和凭证可用性。
3. 热更新：更新 registry 和未启动 Profile 的健康状态；运行中 Session 只收到版本漂移提示，通过 fork/new session 采用新版本。

删除也分为移除引用、删除 Profile、删除资产和禁用 Plugin，不做隐式级联删除。删除前显示反向引用，删除资产后已有 Session 按快照继续或进入明确阻断状态，后续不完整组合不得静默回退。

页面上继续使用共享 `ModeWorkspace` 外壳和 Custom typed slot。Custom 主区围绕“组合”组织为资产目录、组合清单/画布、解析预览三部分；Session 仍使用 canonical Session route，Plugin 只能接入声明式 typed slot 或既有 tool-view，不能任意接管页面。

推荐实施顺序：

```text
M0 统一 AssetRef/Revision/Health/Dependency/ReverseReference 和 CompositionResolver 契约
M1 custom + meta + 一个用户 Agent + Prompt/Skill + Snapshot
M2 多 Agent + Command/Workflow + 进度/取消/恢复
M3 MCP 的 Session/Location scoped 工具注册和凭证生命周期
M4 Plugin trust、审批、Host/Client 分面和受控 UI
M5 Native/Code Tool Presentation 与 run_code SDK
```

具体平台边界和生命周期规则以 [ADR-17](../../architecture/adr/ADR-17-custom-mode-composition-platform.md) 为准，产品范围与验收以 [Custom PRD](../../prd/custom-mode-composition-platform.md) 为准，阶段依赖与交付顺序以 [Custom 路线图](../../roadmap/custom-mode-roadmap.md) 为准。
