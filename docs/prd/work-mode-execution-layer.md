# PRD：Work 模式 - 非编程执行层

> 状态：v3 草案，待架构前置条件通过后评审
> 负责人：产品（范围与指标）/ Core（Artifact 契约）/ App（Work surface）
> 范围：`packages/app` + `packages/core` + `packages/aigcfroge`
> 关联：[ADR-11](../architecture/adr/ADR-11-product-mode-session-classification.md)、[ADR-12](../architecture/adr/ADR-12-product-mode-entry-routing.md)、[ADR-13](../architecture/adr/ADR-13-chat-work-mode-boundary.md)（提出）、[ADR-14](../architecture/adr/ADR-14-persistence-and-scope-strategy.md)（提出）、[ARCHITECTURE.md](../../ARCHITECTURE.md) §4.10、[CONTEXT.md](../../CONTEXT.md)
> 最后更新：2026-07-14

---

## 1. 三行摘要

- **做什么**：为非编程用户提供一个开箱即用的文档任务入口；M1 只支持引导生成 Markdown PRD/文档并只读预览。
- **为谁做**：希望通过对话完成结构化文档、但不需要代码编辑器或自动化工作流的产品与业务用户。
- **为什么现在做**：Product Mode 骨架已经完成，需要先验证“选择预设任务、执行、得到可查询产出”的最小闭环。

## 2. 问题与定位

现有 Coding 体验以代码和开发工具为中心。非编程用户需要的是明确的任务入口、必要的需求澄清和可检查的交付物，而不是自行选择 Agent、Skill、MCP 或配置执行环境。

> 用户任务：基于我提供的背景，帮我整理一份可评审的 PRD，并让我在应用前检查结果。

Work 是**非编程执行层**。它使用系统预设能力完成任务，但不要求用户先在 Chat 创建资产。该边界依赖仍处于“提出”状态的 ADR-13，接受前不得进入功能开发。

## 3. 架构前提

| 决策 | 当前状态 | 本 PRD 处理 |
|---|---|---|
| Product Mode 与 canonical Session route | ADR-11/12 已接受 | 直接遵循 |
| Chat/Work 边界 | ADR-13 提出 | 开发 Gate，不视为已接受协议 |
| 无项目全局工作区 | ADR-14 提出 | M1 要求用户选择现有 Location，不依赖全局默认目录 |
| Artifact 领域记录与投影 | 尚不存在 | M0 定义最小事件、投影和查询接口 |
| 可查询任务步骤模型 | 尚不存在 | M1 不展示任务进度；M2 前独立设计 |

`SessionProjector` 中的模型 Step 事件只描述消息生成过程，不等同于业务任务步骤。任何“任务进度”UI 必须等待独立领域模型。

## 4. 目标与非目标

### 4.1 M1 目标

- 提供一个系统预设“撰写 PRD/结构化文档”，用户无需理解 Skill 或 Agent。
- 元智能体只询问影响交付结果的必要信息，并生成 Markdown 候选稿。
- 用户在右栏只读预览完整候选稿，确认后应用到当前 Location。
- 成功应用后创建可查询 Artifact 记录；刷新或重启后仍能从 Session 找到产出。
- 所有文件写入使用 Location-scoped FileSystem、现有 Permission 和安全路径校验。

### 4.2 非目标

- M1 不做 HTML、原型、脑图、数据分析、营销文案、NL-to-SQL 或外部 MCP。
- M1 不做嵌入式编辑器、交互画板、“视图”tab 或结构化双向编辑。
- M1 不做任务步骤、甘特图、RACI、顾问三态、会诊或多 Agent 编排。
- M1 不执行 Shell、浏览器自动化、外部写回、发信、付款、删除或桌面 RPA。
- M1 不建设短期凭证、网络出口白名单、云容器、微虚拟机或全量审计基础设施。
- M1 不引入新的 Skill 路由器，也不把每个 Skill 注册为 System Context Source。
- 工作流归属在 ADR-13 接受前保持未决。

## 5. 用户故事

| 用户故事 | 验收结果 |
|---|---|
| 作为产品人员，我想从预设入口开始写 PRD，以便不用配置 Agent/Skill | 进入 Work 后一次明确操作即可创建 `mode=work` Draft |
| 作为需求发起人，我想先回答关键问题，以便产出不是空泛模板 | 缺少目标、受众或成功标准时系统先澄清，不直接写文件 |
| 作为审阅者，我想应用前查看全文，以便发现错误 | 未确认时 Location 中没有新增或覆盖文件 |
| 作为任务执行者，我想刷新后继续找到产出，以便后续复用 | Session 的 Artifact 查询返回已应用文件及状态 |

## 6. M1 产品流程

1. 用户进入 `/mode/work`，显式选择“撰写 PRD/文档”，创建 `mode=work` Draft。
2. 系统加载一个预设 Skill guidance；Skill 仍由 SkillV2 管理，不注册成新的 Context Source。
3. 元智能体澄清目标、受众、范围、指标和约束，生成 Markdown 候选稿。
4. 右栏显示安全渲染的只读预览、建议文件名和目标相对路径。
5. 用户点击“应用到当前项目”；冲突时显示差异并明确确认覆盖。
6. Core Artifact 服务校验路径、原子写入、回读并记录 Artifact。
7. 成功后提供“打开文件”和“继续通过对话修订”；修订仍重复预览与确认流程。

模型不能直接把候选稿标记为正式产出。只有文件事务成功且 Artifact 投影可查询时，任务才进入“已产出”状态。

## 7. 数据与接口契约

### 7.1 Artifact Record

M0 新增最小 Artifact 领域契约；它记录产出引用，不复制文件正文：

| 字段 | 约束 |
|---|---|
| `id` | 稳定 Artifact ID |
| `sessionID` | 所属 Work Session |
| `kind` | M1 固定为 `document` |
| `title` | 用户可读标题 |
| `mediaType` | M1 固定为 `text/markdown` |
| `relativePath` | 相对 Session Location，规范化后不得越界 |
| `status` | `available` 或 `missing`；归档等状态后置 |
| `createdAt` / `updatedAt` | 持久时间戳 |

- Artifact 内容真源是 Location 文件；投影保存身份与引用。
- M0 必须明确记录事件、Session 投影更新和查询接口；不得从聊天文本或工具日志反推。
- 外部修改后预览读取最新文件；文件缺失时返回 `missing`，不静默删除记录。
- EventV2 事件名、Schema 和桥接方式由独立 Artifact 技术设计确定后实现，PRD 不假装当前已经存在。

### 7.2 任务步骤

M1 不新增 Task/Step Schema。消息中的计划、Todo 或 provider Step 仅用于对话展示，不作为业务进度真源。M2 若需要任务进度，必须定义步骤 ID、状态迁移、重试、取消、父子关系和投影恢复语义。

### 7.3 Skill 与 System Context

- Skill 是按需加载的 playbook；System Context 只承载当前已有的 skill guidance 等上下文来源。
- M1 使用现有 `SkillV2.list()`/加载行为，不宣称已实现 Frontmatter-only discovery。
- 渐进式披露若要优化 token，作为 SkillV2 独立改造，并同时验证 list/load API 与兼容性。

## 8. 页面与交互

Work 复用 ADR-12 的共享 `ModeWorkspace`，不复制 Coding 页面或创建第二套路由。

### 8.1 Mode 首页

- 一个主预设“撰写 PRD/文档”、搜索和 `mode=work` Session 列表。
- 任务列表按进行中/历史展示，不新建 Project/Workspace 实体。
- M1 不展示尚不可用的原型、数据分析或营销入口。

### 8.2 Session 详情

- 中栏复用消息流和 Composer。
- 右栏只包含“产出”和“上下文”tab，不展示任务进度导航或“视图”tab。
- 产出 tab 显示 Artifact 列表、Markdown 只读预览、缺失/外部修改状态和应用操作。
- Markdown 渲染禁用原始 HTML 或进行严格清洗；外部链接有明确提示，不自动加载远程资源。
- UI 遵循 `DESIGN.md`：稳定尺寸、v2 token、i18n、键盘可达、明暗主题和窄屏无重叠。

## 9. 安全边界

M1 采用现有能力可实现的窄安全边界：

- 预设执行不开放 Shell、浏览器、外部 MCP 或网络写操作。
- 读取和写入限制在当前 Location，路径规范化并验证符号链接边界。
- 写入前 Permission + 用户明确确认；覆盖失败恢复旧内容。
- 预览不执行脚本，不自动请求远程资源，不信任生成 Markdown。
- 日志和产品埋点不记录文档正文、用户文件内容或凭证。

“临时凭证、网络出口白名单、沙箱分型、物理销毁、追加审计日志”属于独立基础设施计划。相关 ADR 和实现未完成前，不得在 M2/M3 中启用外部执行能力。

## 10. 成功指标与埋点

上线前使用内部 50 次有效任务建立基线；Beta Gate 目标如下：

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 产出闭环成功率 | ≥90% | Artifact 可查询的成功任务 / 用户开始的有效任务 |
| 首次预览时间 | P50 ≤8 分钟 | 新建 Draft 到首个完整预览 |
| 应用成功率 | ≥95% | 文件回读一致且 Artifact 投影成功 / 应用确认次数 |
| 重启可恢复率 | 100% | 重启后 Artifact 查询与文件状态一致 |
| 7 日再次使用率 | ≥25% | 完成首个任务后 7 日内再次创建 Work 任务 |
| 未授权写入/脚本执行 | 0 | 安全审计与故障注入 |

至少记录 `work_task_started`、`work_preview_ready`、`work_artifact_apply_requested`、`work_artifact_applied`、`work_artifact_failed` 和 `work_artifact_opened`；不采集正文。

## 11. 里程碑与优先级

| 阶段 | 范围 | 准入/退出条件 |
|---|---|---|
| **M0 契约** | 接受 ADR-13；定义 Artifact 事件、投影、查询和原子写入 | Core owner 与安全评审通过 |
| **M1 文档闭环** | 单一预设、澄清、Markdown 预览、应用、Artifact 恢复 | Beta Gate 达标，路径/回滚测试通过 |
| **M2 任务模型** | 可查询 Task/Step；再增加调研等纯文本预设 | 独立 Task ADR 接受 |
| **M3 扩展产出** | HTML/图形只读预览 | 每种 renderer 完成内容安全评审 |
| **M4 外部执行** | MCP、数据分析、交互编辑、外部写回 | 安全基础设施 ADR 和编辑器技术设计均通过 |

按 WSJF，单一文档闭环优先：它以最小安全和工程成本验证 Work 的核心价值，并为后续 Artifact 类型提供公共契约。

### 11.1 成本收益假设

| 假设 | 验证方式 |
|---|---|
| 单一文档预设足以验证非编程用户是否需要独立 Work surface | 观察产出闭环成功率、首次预览时间和 7 日再次使用率 |
| 主要成本是 Artifact 契约和安全写入，Markdown 只读 renderer 成本可控 | M0/M1 记录 Core/App 实际工作量和 renderer 安全缺陷 |
| Artifact 契约可被后续 HTML/图形产出复用 | M3 立项前验证新增类型无需重建身份、投影和恢复模型 |

若 Beta 的 7 日再次使用率低于 15%，或有效任务产出闭环成功率连续两周低于 80%，停止扩充预设和 renderer，先复核 Work 独立入口的产品价值。

## 12. 灰度、回滚与监控

- 使用 Work Document feature flag；内部用户后按 10% Beta 灰度。
- 关闭 flag 时隐藏新建入口，但保留已有 Session 和 Artifact 的只读访问。
- 若应用成功率低于 90%、出现投影丢失、路径越界、未确认覆盖或预览脚本执行，立即停止灰度。
- 回滚应用版本不得删除用户文件或 Artifact 记录；旧客户端应忽略未知 Artifact 事件。
- Dashboard 监控成功率、错误 tag、耗时、Artifact 缺失率和 renderer 错误，不采集内容。

## 13. 验收与测试

- 新建 Work Draft、Session mode 冻结、canonical Session route 和 mode 过滤。
- 信息不足时澄清、用户取消、重复确认、覆盖冲突和继续对话修订。
- 原子写入、回读失败、投影失败、进程重启、文件外部修改和文件删除。
- 路径穿越、绝对路径、符号链接越界、超大文件、恶意 Markdown/HTML 和远程图片。
- Permission 拒绝时不写文件、不创建 Artifact；日志不包含正文。
- 桌面/窄屏、键盘路径、明暗主题、中文/英文溢出以及空/加载/错误状态。
- 实现后运行受影响包 typecheck/test；测试不得从仓库根目录执行。

## 14. 批准 Gate

1. ADR-13 正式接受并与 `ARCHITECTURE.md` 状态一致。
2. Artifact 事件、投影、查询和失败恢复技术设计通过 Core 评审。
3. M1 tool allowlist、Markdown 渲染、路径边界和日志策略通过安全评审。
4. 产品、Core、App 三方负责人确认指标、埋点和 Beta Gate。
