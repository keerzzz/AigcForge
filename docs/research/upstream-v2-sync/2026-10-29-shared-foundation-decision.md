# 统一底座与能力组合：架构决定及首节评审

日期：2026-10-29。状态：**首节GUI入口方案已获独立限定审批；总体代码族调查继续**。具体修改须由主调度正式派发。

本记录是[唯一现行计划](2026-10-25-v2-alignment-execution-plan.md)的架构附件，不另建实施计划或债务账本。完整范围继续为 P0–P6；本次只批准证据充分的小节，不以架构图代替全仓审计或产品验收。

2026-10-29 协议/路线更新：V2 独立首读见 [CLAUDE](../../../CLAUDE.md)、[架构入口](../../../ARCHITECTURE.md)、[设计入口](../../../DESIGN.md)及[验证入口](../../testing.md)。本附件保留设计原因与调查时点；批次调度见原总计划及[批次附件](2026-10-29-migration-batch-plans.md)。全模式行为版本冻结/显式采用新版归 B04 待设计，普通 fork 不视为重新冻结入口；已有 Custom 与允许池内 Agent/Model 选择保留。原 S1 实施/冻结/验收只引用[原 owner](../../review/v2-implementation-owner-2026-10-29.json)，本轮文本不转移其权限或宣称问题关闭。

## 顶级逻辑：万物皆智能体的电路板模型

用户最终明确的模型是：**OpenCode V2架构底座＝电路板；Chat资产＝可插拔元件；Custom＝装配空间；组合结果＝自定义智能体或脚手架。** dsh以插件为组织机制，本项目最终通过资产装配形成可定制的智能体系统，不能降格为仅插件列表，也不能偏移成每个工具/面板都必须套Agent类。

此前确认的“第一类单元、异构执行”在该模型中指明确的身份、版本、契约、生命周期和协作关系：Agent、Prompt、Skill、Command、MCP、Plugin、Workflow等元件保留真实类型，确定性执行、UI和人类交互通过已有接缝参与组合；并不要求每个元件调用LLM、拥有永久消息队列或另起调度循环。原始文件/参数/样式等数据不因口号而成为独立运行智能体。

用户同时确认：保留现有五模式；Creator候选审阅后保存并显式采用；Chat资产库存为空时，**Chat与Custom均可依靠底座运行，Custom提供明确标识的内置基础组合**。空库存不是损坏依赖，兜底不保证缺模型/凭据/服务或无权限时仍可完成对应动作。

该决定与“保留五模式”“Creator审阅后采用”同时成立：万物皆智能体是贯穿全部产品的组织模型，不是新增第六模式；Creator生成单元定义/候选，经校验、审阅确认、版本化保存与显式采用，不自动编译执行或热改旧会话。

<a id="platform-assembly-direction"></a>

### 2026-11-08 全平台可插拔与组合方向

状态：用户已确认的后续架构目标，具体设计待元智能体当前实施任务完成后讨论。

2026-11-09 接续：原定 Meta 范围已有最终接受，用户要求先形成并按 CLAUDE 审批会话 UI 对齐方案，以现有右侧栏作为统一、可插拔工作区。[右侧栏实施附件](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-09-unified-right-sidebar-implementation-plan.md)已完成减法修订并批准：一个管理扩展贡献五个 Panel，复用现 Panel/Slot/Dock 与数据 owner，区分界面显示与扩展/业务启停，验收按实际影响。全平台装配方向保留，Custom 明确的实际输出可直接复用同宿主；两个已运行用例只约束新共享抽象。

统一的可插拔、可替换、可启停、可组合逻辑覆盖整个平台的底座能力与工作界面。用户明确举例包括左侧项目树、会话列表、中间区域的 SSE 数据通道与交互模块、右侧侧边栏；模型、工具、工作流以及内部和外部智能体也纳入同一装配方向。

平台底座提供能力接缝，各模块沿真实类型与领域 owner 提供和消费能力。Custom 是面向用户的装配空间，通过选择、连接与组合这些能力和界面模块，形成自定义智能体或脚手架。插件启停是该装配逻辑的一部分，目标同时覆盖执行能力、通信能力和界面构成。

第一性依据（设计推导，待后续实现验证）：模块之间实际交换的是请求、结果、事件和状态；把提供、消费与组合关系表达在明确接缝中，才能让执行能力、数据通道和界面模块独立组合。dsh 的能力接缝、插件配置与生命周期作为后续对照，具体归一化方案从 AigcForge 现有实现推导。

讨论顺序：先完成当前元智能体实施任务，再统一讨论模块划分、接口、启停与生命周期、组合绑定和页面布局。本次记录保留该方向，不派发对应源码实现；此前确认的 Custom 首页与会话详情页主任务继续保留。

### 新 Custom 的设计来源

用户追加明确：**现在的自定义模式不合理，不参考默认工作区旧Custom模式。** 新Custom只以V2通用底座、Chat资产生产/管理合同和本节已确认目标重新设计。默认旧Custom的PRD/ADR/UI、固定meta根、必须用户Agent、旧Profile/Builder/upgrade流程均不作为目标约束或搬迁模板。

复用的是Session/工具/权限/资产/存储/GUI等底座能力，不是旧模式产品。现有V2中已经迁入的Custom专属规则只作为待改接口/兼容影响的源码事实，不能反推新目标；历史会话/快照的数据读取与迁移另列，不因此删除数据，也不让旧数据形状绑架新架构。

### Meta 全量保留，不与旧 Custom 绑定

用户另行明确：**元智能体保留所有内容**。新Custom不参考旧Custom，不等于删除/弱化Meta。Meta的完整协议与指令、持久身份/记忆、意图分发、资产与CLI信息、子代理协议卡片、内部/外部协作、委派/任务/工作流、review/revision、结果通知与取消/恢复等已有内容全部进入B01保留矩阵；实际清单须逐入口/生产者/消费者核对，未查项不静默省略。

Meta作为平台重要能力可供基础组合与用户装配消费，保留它的完整业务职责和状态归属；这不自动恢复旧Custom的强制meta根策略，也不让Meta越过Permission/Location/Session边界。移植其内容/能力经V2现有owner与Instructions，不复制旧MetaAgentRuntime、System Context registry或第二模型循环。历史数据/兼容路径单列验收，不以重构为由删减。

### 入口、装配、边界与兜底闭环

这是目标架构合同，不是本轮生产实现。架构负责人负责接缝/数据/依赖/错误设计；仅产品行为存在实质歧义时询问用户，不把接口和类型方案转嫁给用户。

#### A. 唯一入口与职责

| 入口    | 职责                                                         | 禁止混入                                   |
| ------- | ------------------------------------------------------------ | ------------------------------------------ |
| Home    | 选择明确server/project、会话聚合与模式导航                   | 导航自动创建/恢复工作或隐式改执行位置      |
| Chat    | 使用内置能力对话，生产/编辑/导入/审阅七类资产                | 没有自建资产就不可用；保存后自动执行插件   |
| Custom  | 展示内置/自建元件、选择连接、预览诊断、保存Profile、确认启动 | 仅凭前端连线运行；将缺失引用替换成基础组合 |
| Session | 按保存的身份/Location/采用版本运行并消费真实结果             | 根据当前mode导航改旧组合或重新装载最新资产 |
| Desktop | 提供同源服务/存储/IPC/窗口与生命周期                         | 单独再建一套执行底座或接管现用服务         |

唯一装配链：内置基础能力＋可选用户资产 → 按类型/来源/版本/消费者显式绑定 → Plan预览与依赖/权限诊断 → 用户确认 → 原子创建Session与采用快照 → 同一V2执行与结果消费。Profile保存、组合采用、插件安装/授权/挂载、实际执行是不同动作，不由一次“保存”隐式完成。

#### B. 电路板插槽与权威

| 接缝             | 原owner与合同                                                    | 约束                                                          |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| 定义/资产        | Schema、typed asset owner、registry、CAS与来源revision           | 同名遮蔽/合并由统一owner决定，不复制缓存或资产文件            |
| 装配/绑定        | Profile、CompositionResolver、Plan、Snapshot及consumer绑定       | 共同机制与Custom策略分开；根/执行者/工具/资产的实际来源可解释 |
| 模型与确定性执行 | Core Session/Runner/AI、Tool、Job/Task/Workflow/Delegation       | 推理与确定性执行复用现有引擎，不为元件套第二循环              |
| 权限/运行环境    | Permission/Policy、Location、FS/process/PTY、MCP/Plugin生命周期  | 资产请求不授予权限，不替换全局身份/权限/存储/进程owner        |
| UI/人类交互      | App/GUI Contract/Command/Panel、Question/Permission与IPC storage | 消费同一真实状态；人类回复不因进入消息流而获得无限授权        |
| 状态/版本/结果   | Session投影、Instructions、采用快照、领域receipt与必要live事件   | 组合定义/实例/调用/结果分开；目录指纹不证明实现固定           |

缺少必要接缝时先证明现有owner无法表达，补最小公共身份/来源/绑定合同；既不能为了口号预建万能AgentNode，也不能用“禁止新增”拒绝空资产基础组合等真实需求。

#### C. 基础组合与错误边界

| 场景                                     | 目标行为                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| Chat库存为空                             | 平台默认能力仍能对话/产生资产；空态引导创建，不要求先有用户Agent                  |
| Custom未选用户元件/库存为空              | 提供显式标识的内置基础组合；Plan列出真实内置来源/能力/版本，确认后可启动          |
| 用户已选必需引用无效、版本冲突或依赖缺失 | 明确阻断该组合、定位元件；保留草稿/历史，可取消/修复/重新预览；不静默改用内置组合 |
| 旧快照内容仍在且精确运行依赖可用         | 经现有校验沿用；源资产变更不自动更新旧会话                                        |
| 旧快照所需实现/凭据/模型不可用           | 呈现具体缺失与可执行操作；不自动采用最新实现/其它模型，不隐藏改变权限或费用       |
| 权限拒绝或Custom被禁用/客户端不支持      | 保留typed拒绝/不支持，不通过底座fallback绕过校验或解码成Coding                    |
| 确认时CAS/来源变化                       | 拒绝旧预览、刷新并再确认；不无条件覆盖                                            |
| 取消/进程故障/未知副作用                 | 原owner结算与有界恢复，保留事实/输入/结果；不推导未执行、不可逆副作用不自动撤销   |

“默认基础组合”是明确输入策略，不是异常catch后的万能降级。基础能力不是伪造的Chat资产，不填假ID、不临时写虚构Agent文件；built-in定义与用户asset引用的typed区分、版本捕获、Plan/快照/重试都须在原owner内设计。

现有静态证据：`core/src/composition-resolver.ts:126`取平台meta，但用户Agent引用来自asset catalog；`core/src/session/composition.ts:444`拒绝空agents。因而Chat无资产可用与Custom内置基础组合是两个不同验收项；后者尚需B04.0设计，不能简单删除empty-agents guard或把新目标写成已实现。

#### D. 收口门禁

B01先建立电路板接缝/元件来源/装配/运行消费者与空态矩阵；B04.0先给基础组合与公共引用/绑定/版本合同，再由B03/B05/B06完成入口与装配纵链。最低场景为：零用户资产Chat、零用户资产Custom基础组合、混合内置/自建、确认时漂移、损坏引用不fallback、权限拒绝、取消/重载/恢复、显式新版采用、旧组合与跨位置隔离。全部行为须同时经过API/持久化/实际执行/桌面消费，不以一张组合画布或Schema通过代替。

### 1. 组织模型与承载实现分开

- **智能体单元**是对外组织、治理、组合与协作的一等对象，而不是给现有对象改名字。必须能回答：谁、哪个定义版本、提供何种契约、属于哪个scope、如何接受请求/返回结果、与谁协作、如何取消/回收、以何证据观察结果。
- **承载实现**保留V2 typed owner：推理执行沿Session/Runner/AI；确定性工具沿Tool/Permission/Location；长期工作沿Job/Task/Workflow/Delegation；UI和人类交互沿GUI Contract/Command/Panel/Question/Permission及真实宿主。复用它们实现智能体合同，不把本体目标降格为插件列表。
- **插件**可以是代码分发、安装、注册与生命周期载体，**Profile/Plan**是组合定义与解析，**Snapshot**是采用的版本/绑定事实，**事件**是执行事实，**产品模式**是领域工作面/默认组合体验；它们不替代智能体单元的业务身份。
- Prompt/文件/参数等数据不是因口号就运行自治循环；由资产管理、上下文或执行智能体拥有/消费。逻辑定义、运行实例、调用尝试、数据记录和UI展示投影必须区分。

### 2. 每个第一类单元的最小逻辑合同

| 维度       | 必须可表达与核验                                             | 不可据此推导                                      |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------- |
| 身份与定义 | 稳定领域身份、来源/版本、单元类别、作用域与定义/实例归属     | 为每个函数/Token/行数据创建新Agent记录            |
| 契约       | typed请求/结果/命令/事件、提供者与消费者、失败和取消边界     | 所有业务共享一份Any输入或万能接口                 |
| 组合/协作  | 显式绑定、依赖诊断、直接消费/调用/委派/人类审批关系          | 只登记接口/名字就是可运行能力                     |
| 权限       | 所请求能力与实际授权分开，审批者/目标/版本绑定               | Human单元或Manifest可绕过当前Permission           |
| 生命周期   | 资源owner、启动/激活/失效/回收、异步generation与迟到响应保护 | 每个单元都需要永久fiber/queue/LLM loop            |
| 版本采用   | 定义更新、当前组合、实例与精确实现来源，显式采用新版         | 目录指纹等于实现固定、普通fork自动重新冻结        |
| 可观察结果 | 在现有Session/Job/领域事实中关联调用/结果/状态/原因          | 新建第二轨迹库、持久化所有临时流或泄露prompt/秘密 |

统一的是组织与治理维度，异构的是执行/生命周期与具体业务契约。可以建立必要的公共身份/治理接缝，但必须先有表达缺口、真实消费者与复用决定；不预造平行AgentKernel/registry，也不能以“禁止抽象”为由拒绝目标所必需的最小合同。

### 3. 五模式与智能体单元的关系

Coding、Chat、Work、Assistant、Custom共用智能体组织/组合与V2执行底座。模式仍是持久产品分类和领域体验，不直接等同运行实例或修改Draft的动作；内置模式在已决策略下消费默认单元组合，Custom向用户开放受约束的定义选择/绑定/预览。不能把当前Custom的meta根约束无条件推广给Coding，也不能保留“Coding/build是所有业务不可替代owner”的过度解释。

Coding是基线能力与回归来源，SessionRunner是模型执行owner。共同组合机制和领域策略须分离；多个推理智能体可复用各自child Session的同一执行机制，确定性与交互单元不为形式统一多调用模型。

### 4. 从 V2 底座到新装配目标的真实差距

新Custom不以默认旧Custom的ADR/PRD/源码作为参考。需要从V2通用Session、Asset、Agent、Tool、Permission、GUI等owner核对接缝/来源/绑定/版本表达；当前V2 `schema/src/composition.ts` 的引用类别、`orchestrator|agents/<id>`消费者、Custom专属选择和工具目录/实现身份只说明当前限制，不是新产品的强制结构。不能宣称零资产基础组合、所有资产装配、显式采用新版已经通用实现。

B01首先产出**智能体单元/业务能力→定义/提供者/消费者→真实owner/版本/生命周期→缺口/验收**矩阵；B04.0先审公共组织合同与现有承载表达，再决定必要的最小提取。B03可继续独立导航/宿主调查；依赖新单元合同的功能不能先在页面硬编码。后续批次沿相同矩阵完善全部功能，不另建一套运行系统。

本节是用户目标与逻辑合同决定，不是已实现声明，也不授予生产开工、运行模型、安装/挂载插件或更改原S1的权限。具体生产任务仍需当前源证据、实际文件范围、门禁和正式派发。

## Context

DeepSeek Harness追加研究见[对齐附件](2026-10-29-deepseek-harness-alignment.md)：本轮用户明确强化现有五模式、Creator候选审阅后保存并显式采用，不新增第六模式或自动编译/挂载。dsh可组合性用于定义/提供者/消费者、来源版本、生命周期和可观察性检查，不把其可替换agent-loop或生成原文的UniversalAgentContract移植为V2架构；本文组合/执行/授权边界保持。

默认工作区已将 Home、模式工作区、Draft 和 Session 分开；当前 V2 已有公共 Session/Client/GUI 扩展底座，但尚未完成模式工作区、资产管理入口、全局导航与状态栏迁移。七类候选被接入 Session 标题区域，实际桌面标题被挤占。根因属于入口职责和宿主映射，不能靠缩短文案、换图标或放宽几何断言解决。

比较对象：默认 `/home/keer/workspace/aigcfroge` 的 `edbe67383d830aa40269ddf453c7f5617c940b46` 加现有 WIP（只读）；实施 `/home/keer/workspace/aigcfroge-v2` 的 `9e2c6577ef6dd65c8f01ff94d46da0142bcb877c` 加 WIP；固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。不更换固定上游。

协议加载：默认 `CLAUDE.md`、`AGENTS.md`、`ARCHITECTURE.md` §4.1/4.4/4.6/4.10、`CONTEXT.md`、`DESIGN.md`；仓库 `protocols`、`enterprise-code-standard`、`reuse-first-refactor`、`quality-to-pr`；目标 V2 根与受影响包 AGENTS；ADR-11–17 的相关产品职责和实际调用链。默认运行协议与固定 V2 存在时点差异，按现行计划 §1 的已确认 V2 目标执行；不回植旧 exact-payload retry、旧 System Context registry 或旧 provider loop。

## 已明确的人类决定

- 全平台复用 V2 底座，Coding 也作为该底座的消费者。所有构成智能体或脚手架的能力通过明确接缝逐步组合化。
- 2026-10-29 原问题：Agent、工具、指令、MCP 等行为能力更新后，已有会话如何处理？用户选择：**会话保持原版本，变更后新建或分叉，沿用冻结机制**。
- 冻结组合定义不等于冻结授权。当前权限仍逐次判定；也不能由该答复推导删除允许池内的 Agent/Model 执行选择。当前小节不改这些 selector。
- Home 未筛选时保留当前服务器全部会话，包括未打开项目；现有模式/项目筛选及其他可见性规则不变。
- Session 标题不出现任何资产按钮；资产管理与会话候选审阅各归自己的工作面。
- 主对话负责调研、架构、评审、任务单与真实桌面验收。辅助对话只修改明确小节并执行包级检查。实施期间主对话可继续只读研究下一节；下一实施节必须等待本节桌面验收通过。

## Decision

### 1. 协议稳定，领域能力通过既有 owner 接入

共同底座持有 Session identity、Location、持久输入、执行调度、权限与事件语义；资产或 UI 插件不能接管这些权威。平台实现可在协议约束下替换，但普通资产装配不授予进程或权限服务的控制权。

保留明确的模块类型：模型适配、工具、Instructions/上下文来源、资产、工作流/委派、UI 扩展。公共接入信息覆盖身份、版本、来源、依赖、作用域与生命周期；各类模块保留各自的类型化调用契约。没有证据要求新增万能 AgentNode、统一消息总线或每能力一个模型循环。

### 2. 组合与执行分开

组合负责引用解析、消费者绑定、依赖/权限请求诊断和冻结；Session V2 负责执行。当前 `packages/core/src/session/execution.ts:89` 的 drain 经第98行调用 SessionRunner；`packages/core/src/session.ts:392` 的 startCustom 先 freeze 并在 Created commit 回调写快照。Custom 不是另一套模型执行器。

目标是让内置模式的通用装配机制与用户组合共用 owner；先识别现有 Composition 中 `custom`、`meta` 根和特定策略的约束，再决定提取。不能把当前 Custom schema 无条件推广给全部普通 Session。模式仍是产品分类，预设是默认能力组合，页面是领域工作面。

### 3. 定义、计划、快照、活实例与事件各自归属

- 资产/Profile 定义可修订；Plan 是某次解析的可预览结果。
- Session Snapshot 固定实际采用的定义、版本和绑定；资产更新不回写旧快照。
- Scope/执行器持有活资源；回收资源不撤销已完成的文件或网络副作用。
- Session 事件记录执行事实；Instructions 的持久状态继续由现有 Session owner 管理。
- 缺少精确依赖时明确阻断继续执行。历史可读、状态可恢复不能宣称模型及外部副作用可确定性重执行。

### 4. 统一 UI 宿主，不混合数据 owner

Home、模式页、Draft、Session 共用窗口与导航机制，但各自保留身份和数据范围。Default ModeSwitcher 的 navigate、Draft 的自身 mode、Session 的持久 mode 是三个不同输入。模式入口不创建工作、不隐式切 Agent。

V2 GUI 已有 Extension.compose/Contract、Command、MenuItem、Panel、Slot 与 SettingsPage。首节复用这些现有接缝，不能先为“统一”新增 AppInterface 插槽或另一套侧栏。资产库存、Session 候选、冻结运行依赖是不同业务状态，不因 UI 相似而合并缓存。

## 当前证据与复用决定

| Candidate                                  | 调用/决定函数与测试证据                                                                                             | 兼容性                                          | 决定及原因                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| SessionExecution / SessionRunner           | V2 `core/src/session/execution.ts:89/98`；inbox matches/reconcile/promote；core Session tests                       | 已承载普通和 Custom 的共用执行入口              | 复用；不新建 AgentKernel/循环                          |
| CompositionResolver / SessionComposition   | V2 `core/src/session.ts:392/403/432`；`session/context.ts:150`；Custom tests                                        | 有冻结机制，仍含 Custom 专属选择                | 保留 owner，继续核对后渐进提取；首节不改               |
| PermissionEffective / Permission           | V2 `core/src/permission/effective.ts:56` 决定规则；context 消费                                                     | 单一决策点含显式模式策略                        | 复用；不能用组合声明直接授予权限                       |
| AppRoutes / Session resolution             | V2 `app/src/shell/routes/routes.tsx:43/86`，`session/session-resolution.ts:37`                                      | 已有共同 Shell 与规范会话解析；缺模式工作区路由 | 保留；模式宿主作为下一节调查                           |
| Default ModeWorkspace / modeSurface        | 默认 `app/src/components/mode-surfaces.tsx:208`、`pages/mode-workspace.tsx:74/126`；路由/模式 keeper                | 领域职责可迁移；旧资源/缓存不可机械复制         | 移植行为到 V2 owner，不复制旧运行壳                    |
| Default SessionRightPanel / ChatRightPanel | 默认 `session-side-panel.tsx:222/377`、`chat-right-panel.tsx:225/263`                                               | 候选审阅属于共享会话右栏                        | 作为职责依据；不把资产库存搬入 Session 标题            |
| V2 SideRegion / MenuItem / Panel           | `app/src/runtime/extension/side-region.tsx:38/72`；`gui-extensions/src/file/renderer.tsx:368`；side-panels keeper   | 现有侧栏“+”菜单和 Panel 开启/恢复路径可用       | 首节复用；移除七个 header 注册，保留候选业务           |
| GUI skill-proposals extension              | `gui-extensions/src/skill-proposals/renderer.tsx:119` 起七个 header Slot 与 side Panel；panel/parser/request/keeper | 当前候选已能保存插入；入口错误                  | 原位调整登记；不扩成资产管理中心                       |
| ChatAssetsProvider / mergeAssets           | 默认 `chat-assets.tsx:83/211/217/243`；`asset-workbench.tsx:147` 以 kind+name 决定项目遮蔽系统项                    | 库存与计数已有共同 owner；V2管理页缺完整映射    | 后续复用业务语义；不为侧栏计数建第二缓存               |
| Default delete / V2 AssetLocation          | 默认 mode-workspace-slots 使用占位Session ID；V2 `server/src/handlers/asset-location.ts:27/43` 查真实归属           | 直接复制不兼容                                  | 后续研究Location管理mutation；首节不改校验/造假Session |

路径在表中省略 `packages/` 前缀；默认/V2 已明确标注。附加生命周期证据及完整调查范围见[代码族调查](2026-10-29-code-family-review.md)。表中测试是覆盖定位，不自动表示本轮新执行。

## Consequences 与边界

简单做法是只删除标题按钮；会留下可发现性缺口。选择的首节方案是在同一既有扩展中改用 SideRegion 的 MenuItem，保留 Command、Panel ID、移动入口、候选状态与读写链。它不要求新底座模块，且能单独验证。

首节不交付模式工作区、全局图标栏、底部状态栏、资产库存 CRUD、全模式组合预设化、同Session组合热切换、旧库兼容或发布。这些不是被删除的范围，继续归现有 `AUDIT-V2-MODE-META`、`AUDIT-V2-GLOBAL-PARITY`、`AUDIT-V2-ASSET-CONSUMER`、Custom 与 `V2-VALIDATION` 条目，由主对话调查并按依赖下发。

总体架构仍未闭环。Workflow/Delegation 恢复扩展内部状态机、全部资产引用消费者、模型/插件全生命周期、跨平台与发布尚未穷尽；不能用首节审批覆盖这些范围。

组合调查还发现必须继续核对的实现身份边界：当前工具目录指纹校验与执行闭包分开，目录形状不变的插件实现更新可能不触发目录冲突。因此当前内容快照不能直接作为“工具执行实现已固定版本”的证据。全模式组合公共化需先确定该版本来源与生命周期合同；GUI首节不修改这些模块，也不宣称该缺口已解决。

## 首节验证与评审状态

前置fixture独立复审：两文件与交接 hash、patch 和12份日志均匹配；主对话重跑 fixture 为 **5 pass / 0 fail / 13 assertions**。辅助方 App/E2E typecheck、格式和原始增量 lint 的最终 exit 均为0，初次失败保留。该结果仅关闭fixture修复的限定检查，不关闭 P2.2T。

新的生产基准已执行：40条历史、40次delta、CPU throttle=1、minimal=true，3次完成；源码指纹3197项及记录保存在 `/home/keer/task-backups/shared-foundation-review-20261029/`。minimal未采集视觉/几何，不能作为标题无挤占证据。实施后同条件比较；不声称3次样本证明统计性能改善。

独立首节调查/评审已核实MenuItem→SideRegion→layout.open→既有Panel与tab复用链，生产修改限定renderer足够。评审要求已写入[具体任务单](../../review/v2-implementation-task-2026-10-29-proposal-entry.md)：MenuItem无enabled字段，采用响应式可用性登记；动作重新读取当前Session；窄屏沿原mobile菜单；标题断言只限定标题区域。既有窄屏Command选择首Panel的风险单独登记，不能冒称已通过。

辅助交付后冻结源码，主对话真实 Electron + DeepSeek Flash 验收；失败留在同一节修复。模式宿主、全局导航/底栏和组合实现身份等下一节研究继续，但不提前实施。

### 2026-10-29 共享工作位置的人类裁决

所有模式共用明确的服务器与项目选择；打开或切换已有Session不自动改变工作区位置。Home未筛选项目时仍显示当前服务器全部会话。后续实现须区分“库存/新建使用的当前位置”与“Home列表查询筛选”，不能因复用字段而意外耦合两种语义；复用现有selection/ServerCtx/Project owner，禁止从lastSession推断。原始裁决见[机器记录](p1-shared-location-decision-2026-10-29.json)。该裁决只确定产品语义，不提前授权下一实施节。

### 2026-10-31 Agent注册公共接缝建议

新裁决：普通根保留Build/Plan/Meta并列及default_agent，选中Meta时启用其统筹能力；旧全根固定Meta废止。当前修正确实Agent/Model/提交链，Meta完整目标保持。

注册闭环公共化为后续新Custom插拔的可行调查方向，未授权新框架。优先复用Agent.Info→Agent.Service/State.transform→PluginHost、Config Agent、AgentAssetBridge、CompositionResolver、SessionContext和Runner；定义、实时候选、采用快照和活资源仍由各自owner持有。

公共接缝应解释身份、贡献来源、采用revision、Location/scope、依赖、碰撞与注册/卸载。Agent.update有序覆盖与资产拒绝同名策略不得归成无条件覆盖。State.revision是失效计数，插件reload不证明Session冻结了执行实现；先由真实Custom消费者证明缺口，再提取最小合同，不建第二注册表、AgentRuntime或万能输入。

模型、Session、委派绑定与权限分开；目录可见或采用不授予权限。新Custom依据V2底座与装配目标，不沿用默认旧Custom产品规则。

2026-10-31补充澄清：“CPU”仅为说明Meta统筹职责的架构比喻，不是产品术语或实现类别。UI只显示智能体/模型/Meta，代码与注释使用Agent、Meta、Session、Delegation等真实领域名称；不得据比喻新增CPU类型、字段、执行规则或模型入口。文中历史CPU用语仅解释旧讨论，不构成当前命名指令。
