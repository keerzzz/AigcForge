# PRD：Chat 模式 - AI 驱动的资产创建层

> 状态：v3 草案，待架构前置条件通过后评审
> 负责人：产品（范围与指标）/ Core（资产契约）/ App（Chat surface）
> 范围：`packages/app` + `packages/core` + `packages/aigcfroge`
> 关联：[ADR-11](../architecture/adr/ADR-11-product-mode-session-classification.md)、[ADR-12](../architecture/adr/ADR-12-product-mode-entry-routing.md)、[ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md)（提出）、[ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md)（提出）、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.10、[CONTEXT.md](../../CONTEXT.md)
> 最后更新：2026-07-14

---

## 1. 三行摘要

- **做什么**：让用户通过对话创建、校验并应用可复用资产；M1 只打通项目级普通提示词模板。
- **为谁做**：需要沉淀提示词但不熟悉模板设计和文件规范的 AigcForge 用户。
- **为什么现在做**：Product Mode 骨架已经完成，但 Chat 尚无可验证的资产创建闭环；先验证单资产闭环，再扩展资产类型。

## 2. 问题与定位

用户目前可以让模型生成一段提示词，却无法在 Chat 内完成“预览、校验、确认应用、重新加载后可用”的闭环。直接把模型输出交给通用 Write 会绕过类型校验、覆盖确认和注册验证，失败时也没有可靠回滚。

> 用户任务：我想做一个可复用的客服回复提示词，但不知道应该包含哪些约束。

Chat 是**资产创建层**，不是通用执行层。Chat 负责把自然语言意图转成经过校验的资产；Work/Coding 负责使用资产完成任务。该边界依赖仍处于“提出”状态的 ADR-13，ADR-13 未接受前不得按该边界进入开发。

## 3. 架构前提

| 决策 | 当前状态 | 本 PRD 处理 |
|---|---|---|
| 四类 Product Mode 与 canonical Session route | ADR-11/12 已接受 | 直接遵循 |
| Chat/Work 职责边界 | ADR-13 提出 | 作为开发 Gate，不视为既定实现 |
| 全局/项目落盘策略 | ADR-14 提出 | M1 仅项目级，避免依赖未决全局工作区 |
| Prompt Asset registry 与 schema | 尚不存在 | M1 前完成最小技术设计并由 Core owner 接受 |

禁止将 PRD 中的目标能力写成“V2 已就绪”。实现必须以代码和已接受 ADR 为准。

## 4. 目标与非目标

### 4.1 M1 目标

- 用户可通过引导式对话生成一个**普通提示词模板**。
- 应用前展示名称、说明、模板正文和目标相对路径，并要求用户明确确认。
- 应用过程执行 typed validation、路径校验、原子写入、registry reload 和回读验证。
- 创建失败不得留下半写文件；覆盖已有文件必须二次确认，失败恢复旧内容。
- 创建后的模板在当前 Location 重新加载后可检索并插入 Composer。

### 4.2 非目标

- M1 不创建 Skill、MCP、Agent、工作流、斜杠命令或协议文件；Chat 功能导航可以展示这些分类及其现有注册项，但对应创建闭环仍属于后续里程碑。
- M1 不创建或修改 AGENTS.md、CLAUDE.md，也不把普通提示词注入 System Context。
- M1 不做全局资产、导入导出、归档、软删除、依赖图、版本管理或独立测试 Session。
- M1 不按资产类型分组 Session，不修改 `DraftTab.type`，不新增数据库 migration。
- M1 不提供表单编辑器；应用前只允许对话继续修订预览稿。
- 工作流归属在 ADR-13 接受前保持未决，不据此实现编排引擎。

## 5. 用户故事

| 用户故事 | 验收结果 |
|---|---|
| 作为提示词新手，我想描述目标后得到必要问题引导，以便生成可用模板 | 系统只追问影响输出的必要信息，并生成结构化预览 |
| 作为项目成员，我想在写入前看到目标路径和完整内容，以便避免误覆盖 | 未确认时文件系统无变化 |
| 作为模板使用者，我想创建后立即在 Composer 中找到它，以便复用 | registry reload 后搜索可见，插入内容与保存内容一致 |
| 作为失败恢复者，我想在校验或注册失败后保留原文件，以便项目不被破坏 | 新文件被清理或旧文件被原样恢复，并显示可操作错误 |

## 6. M1 产品流程

1. 用户进入 `/mode/chat`，显式点击“新建提示词”；进入 Draft/Session 后 `mode=chat`。
2. 元智能体根据创建 guidance 询问受众、输入、输出和约束，生成候选模板。
3. 右栏显示只读预览：名称、描述、正文、Location 和相对路径。
4. 系统运行 schema、文件名、路径边界和冲突检查；失败时留在预览态。
5. 用户点击“应用”；若目标已存在，显示差异并要求明确覆盖确认。
6. Core 资产服务执行临时文件写入与原子替换，随后 reload registry 并回读比对。
7. 成功后显示“已应用”并提供“插入到输入框”；失败则回滚并显示重试入口。

不得由模型直接调用通用 Write 完成第 6 步。模型负责生成候选内容，资产服务拥有持久化边界。

## 7. 数据与接口契约

### 7.1 Prompt Asset

M1 新增一个由 Core owner 管理的 typed Prompt Asset 契约，最小字段如下：

| 字段 | 约束 |
|---|---|
| `kind` | 固定为 `prompt` |
| `name` | Location 内唯一、用户可读 |
| `description` | 简短用途说明 |
| `template` | 普通用户提示内容，不具备 System Context 权限 |
| `relativePath` | 相对当前 Location；规范化后不得越界 |

项目级默认目录为 `<Location.directory>/.aigcfroge/prompts/`。这是 M1 的 Prompt Asset owner 目录，不代表 ADR-14 的全局路径已获接受。

### 7.2 身份与真源

- canonical identity 为 `(Location, relativePath)`；M1 不引入独立数据库资产 ID。
- registry/文件系统是资产当前状态真源；Session transcript 只记录用户可见的创建结果。
- M1 不新增 `AssetCreated`/`AssetModified` EventV2。需要跨 Session 资产审计时，必须先提交独立事件与投影设计。
- `DraftTab.type` 保持联合类型判别值 `"draft"`；若未来需要草稿资产分类，新增独立 `assetKind` 字段并执行前端持久状态迁移，不称为数据库 migration。

### 7.3 写入事务

- 先解析 typed schema，再使用安全文件名和规范化相对路径。
- 写入同目录临时文件，成功后原子替换；不得暴露半写文件。
- 覆盖前保存旧内容；reload 或回读失败时恢复旧内容。
- registry 必须再次解析最终文件；仅“文件存在”不算成功。
- 错误信息不得包含完整提示词、用户文件内容或敏感值。

## 8. 页面与交互

Chat 复用 ADR-12 的 `ModeRoute`/`ModeWorkspace`、Project/Workspace 导航、Session 列表和 canonical Session route，不复制 Coding 页面。

### 8.1 Mode 首页

- Chat 复用 Coding 工作台结构，但二级侧栏将项目树替换为功能分类：提示词、Skills、MCP、命令、智能体。
- 紧凑的“新建提示词”主操作、搜索和 `mode=chat` Session 列表；新建动作必须进入绑定 `chat-orchestrator` 的 Draft。
- M1 只有提示词分类提供资产创建闭环；其余分类展示已有注册项或既有管理能力，不展示虚假的创建成功动作。
- 空、加载、错误和无 Location 状态均提供明确下一步。

### 8.2 Session 详情

- 中栏复用消息流和 Composer。
- 右栏仅包含“预览”和“上下文”两个 tab；没有资产树和测试 tab。
- 应用按钮只在候选内容校验通过时可用；写入期间尺寸稳定并禁用重复提交。
- 用户可见文本走 i18n；键盘焦点、错误提示、窄屏溢出和明暗主题遵循 `DESIGN.md`。

## 9. 成功指标与埋点

上线前先用内部 50 次有效创建尝试建立基线；Beta Gate 使用以下目标：

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 创建闭环成功率 | ≥95% | 成功 reload 并回读一致 / 用户确认应用次数 |
| 首次产出时间 | P50 ≤5 分钟 | 新建 Draft 到首次成功应用 |
| 创建后可发现率 | ≥99% | 成功应用后 registry 搜索命中 |
| 失败回滚正确率 | 100% | 故障注入后无半写文件且旧内容一致 |
| 7 日复用率 | ≥30% | 创建后 7 日内至少一次插入 Composer |
| 未确认写入 | 0 | 应用确认前发生文件变化的次数 |

产品分析事件与 EventV2 领域事件分离。至少记录 `chat_prompt_draft_started`、`chat_prompt_preview_ready`、`chat_prompt_apply_requested`、`chat_prompt_applied`、`chat_prompt_apply_failed` 和 `chat_prompt_inserted`；不得记录模板正文。

## 10. 里程碑与优先级

| 阶段 | 范围 | 准入/退出条件 |
|---|---|---|
| **M0 契约** | 接受 ADR-13；完成 Prompt Asset schema、registry、原子写入设计 | Core owner 审批，故障注入测试方案完成 |
| **M1 提示词闭环** | 引导、预览、确认、项目级应用、reload、Composer 插入 | 指标埋点可用，Beta Gate 全部通过 |
| **M2 生命周期** | 对话修改、归档、恢复、全局作用域 | ADR-14 已接受；资产审计方案获批 |
| **M3 扩类型** | Skill、Command，再评估 Agent/MCP | 每种类型单独通过 schema、安全和注册验收 |
| **M4 编排** | 工作流定义与执行 | 独立编排 ADR/PRD，不由本 PRD 自动继承 |

按 WSJF，M1 优先于新增资产类型：它验证核心价值并复用后续公共写入事务；六类并行会同时放大 schema、权限和回滚风险。

### 10.1 成本收益假设

| 假设 | 验证方式 |
|---|---|
| 单一提示词闭环能验证用户是否愿意沉淀并复用资产 | 观察首次产出时间、7 日复用率和创建后可发现率 |
| 主要工程成本集中在 Prompt Asset 契约、原子写入和 registry，而非页面数量 | M0 记录 Core/App 实际工作量，作为 M2 扩类型估算基线 |
| 公共写入事务可降低后续 Skill/Command 的边际实现与故障成本 | M3 立项前比较复用比例；若需要重写事务，则重新评估扩类型收益 |

若 Beta 的 7 日复用率低于 15%，或创建闭环成功率连续两周低于 90%，停止扩展资产类型，优先修正发现、质量或目标用户假设。

## 11. 灰度、回滚与监控

- 使用 Chat Prompt Asset feature flag；先内部用户，再 10% Beta，再全量。
- 关闭 flag 后保留已创建文件的读取能力，隐藏创建入口，不删除用户资产。
- 若 24 小时创建成功率低于 90%、出现路径越界、未确认覆盖或回滚不一致，立即停止灰度。
- 回滚应用代码不得回滚用户文件；对单次失败只恢复该事务修改前的内容。
- Dashboard 按版本监控成功率、错误 tag、耗时和 registry reload 失败，不采集正文。

## 12. 验收与测试

- 正常创建、中文名称、同名冲突、用户取消、覆盖确认和连续点击。
- `..`、绝对路径、符号链接越界、非法文件名和超限模板。
- 写入失败、原子替换失败、registry parse 失败、reload 失败和回读不一致。
- 故障后新文件不存在或旧文件字节一致；重启后资产仍可检索。
- Session 保持 `mode=chat`，Session URL 只使用 canonical route。
- 桌面/窄屏、键盘操作、明暗主题、中文/英文溢出、空/加载/错误状态。
- 文档实现后运行受影响包 typecheck/test；测试不得从仓库根目录执行。

## 13. 批准 Gate

以下条件全部满足后，本 PRD 才可从 Draft 转为 Approved：

1. ADR-13 状态与 `ARCHITECTURE.md` 一致并正式接受。
2. Prompt Asset schema、owner module、目录和原子写入事务通过 Core 架构评审。
3. 安全评审覆盖路径边界、覆盖确认、日志脱敏和失败回滚。
4. 产品、Core、App 三方负责人确认指标、埋点和 Beta Gate。
