# AigcForge V2 架构入口

本文件按职责导航，不替代源码合同、[V2 规格](specs/v2/README.md)或[共享底座决定](docs/research/upstream-v2-sync/2026-10-29-shared-foundation-decision.md)。执行首读见 [CLAUDE.md](CLAUDE.md)，工程边界见 [AGENTS.md](AGENTS.md)，产品职责见 [DESIGN.md](DESIGN.md)，验证见 [docs/testing.md](docs/testing.md)。

## 当前事实与目标分开

2026-10-29 文档核验：根 [package.json](package.json) 使用 `packages/*`，当前工作树有25个包，Bun 1.4.2、Effect 4.0.1。清单包含未提交/未跟踪的恢复内容；包存在、类型通过与干净检出可构建不是同一事实。精确运行身份由批次冻结记录决定，不把本页版本当作长期钉住的依赖。

当前已存在共同 Session 执行、Client 数据层、App Shell 和 GUI 扩展宿主；完整模式工作台、全模式行为版本冻结和产品生命周期仍未闭环。具体未交付状态只维护在[唯一账本](docs/technical-debt.md)。

## 包职责清单

下表为当前 manifest 与入口的职责索引，不代表全部实现已审计或发布形态已批准。

| 包 | 职责 |
| --- | --- |
| [schema](packages/schema) | browser-safe 公共 wire/storage 合同、ID 与事件 |
| [protocol](packages/protocol) | 公共 HTTP 操作和传输合同 |
| [ai](packages/ai) | 模型请求、provider 路由、传输与规范化输出 |
| [core](packages/core) | Session、权限、工具、资产、组合、Task/Delegation/Workflow 与持久化 |
| [server](packages/server) | 将 Protocol 操作连接 Core 和主机服务 |
| [client](packages/client) | 生成 Promise/Effect API、服务连接及 Solid 数据消费 |
| [cli](packages/cli) | 命令入口、服务进程与桌面内置 CLI 闭包 |
| [desktop](packages/desktop) | Electron 窗口、IPC、存储、内置服务和打包/更新 |
| [app](packages/app) | Shell、Home、Draft、Session、路由、数据与窗口扩展宿主 |
| [gui-extensions](packages/gui-extensions) | 通过 SDK 贡献桌面/Web 功能和主进程能力 |
| [session-ui](packages/session-ui) | 会话内容与共享渲染 |
| [ui](packages/ui) | 组件、样式、字体、图标、i18n 等共享 UI 原语 |
| [theme](packages/theme) | 主题定义与相关合同 |
| [tui](packages/tui) | OpenTUI 交互与终端功能宿主 |
| [plugin](packages/plugin) | 插件合同与接入能力 |
| [plugin-browser](packages/plugin-browser) | 浏览器侧插件接缝 |
| [codemode](packages/codemode) | CodeMode 执行能力 |
| [latex](packages/latex) | LaTeX 渲染/插件能力 |
| [merman](packages/merman) | 图形渲染/插件能力 |
| [simulation](packages/simulation) | 接入现有领域的受控模拟能力 |
| [httpapi-codegen](packages/httpapi-codegen) | 从 HttpApi 编译客户端合同与代码 |
| [http-recorder](packages/http-recorder) | HTTP 记录/回放测试基础设施 |
| [script](packages/script) | 构建、发布等共用脚本 |
| [storybook](packages/storybook) | 组件/宿主展示与相应验证入口 |
| [util](packages/util) | 通用与主机基础设施 |

当前 workspace 清单没有旧 `packages/sdk/js` 包；这不证明没有嵌入式 SDK 消费者，也不授权删除 `sdks/` 或其它入口。Desktop 的工作区依赖列在 devDependencies，仍可成为打包运行闭包的一部分。

## 三类关系不能混写

- **模块依赖**：以各包 manifest 和实际 imports 分别核对。Core 声明依赖 AI/Schema/Plugin/PluginBrowser/CodeMode/Util；Protocol 依赖 Schema；Server 依赖 Core/Protocol/Schema/Simulation/Util；Client runtime 依赖 Schema/Protocol；App 依赖 Client/Schema/GUI extensions/Session UI/UI/Util。TUI 的直接 Core 依赖不能用 Client 的边界规则误删。
- **HTTP 消费**：App/GUI → Client 请求 → Server handler → Core owner。客户端不因调用后端而运行时导入 Server/Core。
- **生成依赖**：[Client build](packages/client/script/build.ts) 编译 `ClientApi`，经 httpapi-codegen 生成 Promise/Effect API；不是 SDK runtime 反向导入服务器。Schema/Protocol 改动沿正式生成边界传播。

不把上述关系画成覆盖全部包的理想无环分层图。源码隐式构建、manifest runtime、dev/build、动态加载和通信分别记录。

## 状态与执行权威

- Session identity、Location、inbox、消息投影、Instructions 状态、claim/结果属于现有 Core Session owner；Window/GUI 不持有第二真源。
- SessionExecution 进程级按 Session ID 协调，runner、模型、权限、工具与文件服务按保存的 Location 解析。领域任务复用 child Session/Job，不自行循环调用模型。
- Judge Task复用现Delegation/child与SessionTask：每个实际模型独立fresh Delegation、participant和worker Task，worker通过原parentID指向aggregate Task；各自receipt结算后再对aggregate执行原revision CAS，完整结果仅经父Tool正文交付。模型意见不承担治理批准权。
- Judge的可选仲裁/摘要复用同一child与receipt执行链，Task负责产出实际结果和一次aggregate结算。原share Tool负责确切保存结果的引用、一次权限叶判定和边界解码，将收窄后的正文交给Session share owner；后者复用Notification的准入与唤醒。增强输入沿receipt读取保存User，目标消费以实际请求为据。完整合同见[Tools规格](specs/v2/tools.md)。
- 资产定义、候选审阅、Plan、Session snapshot、Workflow run 的冻结值与 Task/source 绑定、活资源与事件事实各自归属。WorkflowRun 的冻结消费与正式 Task 交付合同见 Session/Tools 规格。冻结声明/目录不等于授权或完整实现身份固定。
- Home 查询筛选、共享工作位置、Draft 保存的来源与已有 Session 的 Location 分开。查看已有 Session 不改变共享工作位置。
- GUI SDK 的 MountedSession 与 Session screen 生命周期不同；使用 live getter，不复制进更长生命周期的缓存。桌面 storage 必须等待 IPC 加载。

### 会话内容挂载与咨询归属（目标合同）

2026-11-10的[SC00任务单](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-10-session-surfaces-task-sheet.md)固定拟新增SDK接缝与咨询操作；当前实现由各片源码及工件接受。

- 拟新增`SessionTargetRef`只描述已注册live ServerRef上的稳定Session及其实际Location，不要求Shell tab。真实`MountedSession`和`SessionScreen`继续持有source布局；target内容从该server现有Data与参数化会话解析读取。跨server key沿`${server.id}\n${session.id}`；挂载不写parentID、controller、fork或执行claim。
- 同server所有目标共享现ServerRuntime、SharedEvents与Data。可见/持有目标各自水合及重连重读；旧API响应在原Data owner弃读。草稿寿命在原Composer/Tab memory owner补多视图持有，存储沿既有target键，视图不复制第二份历史或草稿。
- 拟新增`Session.createConsultation`采用明确两阶段：Created与不可编辑咨询归属在同目标aggregate事务提交，普通prompt hook可读取该Session；prepare结束后附服务参考/provenance，再以原InboxEnqueued事务准入首问并更新归属。参考在咨询row或实际pending/User.files中保存，取消carrier时同事务转回row；取消首问后新输入ID重新携带保存参考，首问终态保持。重试先核target及咨询owner，匹配时不加载活源；阶段B使用target实际Location。提交后仅pending首问可以补advisory wake，HTTP重试不重启已promoted/cancelled首问，唯一准入owner拒绝咨询已取消firstID复活。

## 按任务读取

| 改动 | 必读入口/决定边界 |
| --- | --- |
| Session/Instructions/恢复 | [Session contract](specs/v2/session.md)、`core/src/session/`、根 AGENTS |
| 工具/权限/插件 | [Tools contract](specs/v2/tools.md)、[Tool guide](packages/core/src/tool/AGENTS.md)、Core owning modules |
| AI/provider | [AI guide](packages/ai/AGENTS.md)、Core model-request/model-transport；不把 Session 责任搬到 AI |
| 公共 API/生成 | [Schema guide](packages/schema/AGENTS.md)、Protocol/Server handlers、Client build、httpapi-codegen |
| Home/模式/Draft/Session | App shell/routes、shell/state、new-session、session resolution、Client Solid data |
| Panel/扩展/状态栏 | [GUI guide](packages/gui-extensions/AGENTS.md)、App runtime/extension、Desktop main extension |
| 桌面/存储/服务 | [Desktop guide](packages/desktop/AGENTS.md)、[CLI guide](packages/cli/AGENTS.md)、Client service |
| 产品范围与迁移差异 | [代码族调查](docs/research/upstream-v2-sync/2026-10-29-code-family-review.md)、总计划 B01、唯一账本 |

页面/包架构按批次调查并记录其完整消费者链；不因更新本入口就宣称25包全部架构已经审批。规格不放待办；批次计划与任务提示词是唯一总计划的执行附件，不能另设领域权威。

## DeepSeek Harness 研究接入

[研究对齐附件](docs/research/upstream-v2-sync/2026-10-29-deepseek-harness-alignment.md)区分用户原文、官方文档与待实现目标。采纳能力定义/提供者/消费者配套、声明依赖/来源版本、受控生命周期、事实与live事件分开及可观察诊断的检查方法；全部映射V2现有owner，不引入Cordis、SAP、AgentNode、独立轨迹库或每能力一个模型循环。

用户确认的最终模型为V2电路板＋Chat资产元件＋Custom装配，形成智能体/脚手架。治理身份/版本/typed接缝/生命周期，但不把每个工具或UI面板都套新Agent类。保留五模式、审阅后显式采用；空用户库存Chat/Custom均有底座入口，失效必需依赖不fallback。

2026-11-08 用户补充：可插拔、可替换、可启停、可组合逻辑覆盖全部底座能力与工作界面，包括项目树、会话列表、SSE 数据通道和侧边栏，共同支撑 Custom 装配自定义智能体或脚手架。完整目标与讨论顺序见[全平台装配方向](docs/research/upstream-v2-sync/2026-10-29-shared-foundation-decision.md#platform-assembly-direction)：先完成当前元智能体实施任务，再讨论具体架构与布局。

2026-11-09 用户要求以会话详情页已有右侧栏作为统一模块底座。[右侧栏实施附件](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-09-unified-right-sidebar-implementation-plan.md)已按[第一性审批](/home/keer/workspace/aigcfroge-v2/docs/review/v2-implementation-approval-2026-11-09-unified-right-sidebar.md)完成减法修订并批准：复用 Extension Host/Panel/createRegion/SideRegion，一个管理扩展贡献任务、协作、Meta、工作流和产物五个独立 Panel；文件树保留辅助 Slot，终端保留 DockRegion。显示、标签布局、扩展启禁和业务执行分别归原 owner；Custom 的明确实际输出可直接复用同宿主，不设置两输出前置。具体功能接受与后继项见原账本。

新Custom从V2通用owner与电路板目标重新设计，默认旧Custom不作参考；现有目标仓Custom专属规则是待重构源码事实，不定义目标。基础组合/内置与用户引用/装配绑定/采用快照合同先由B04.0设计，旧会话数据保护另列，不以旧格式绑架新模式。

2026-11-08 已验证接缝：显式 builtin root/source/revision、Location Profile 保存/CAS/完整读回、Plan digest 确认与原子 Session/快照采用，以及同一 Session 执行与结果消费，见 [Profile 接受](/home/keer/.codex/outputs/2026-11-08/b06-profile-runtime-root-v1/root-final-acceptance.json)。后续按用户当前优先级完善底层统一来源/consumer 绑定/行为冻结与显式升级；完整装配界面留待后继。

### 2026-10-31 Agent选择合同

普通根按显式Agent/default_agent，Build/Plan/Meta并列；选中Meta时启用其统筹能力。注册Agent/Model/Tool独立，执行共用Session/Runner。当前修正未验收，见[专项§13](docs/research/upstream-v2-sync/2026-10-29-meta-cpu-closure-plan.md#13-2026-10-31-agent选择裁决与当前修正)。注册公共化仅为后续Custom调查，不另建注册表。

2026-10-31补充澄清：“CPU”仅为说明Meta统筹职责的架构比喻，不是产品术语或实现类别。UI只显示智能体/模型/Meta，代码与注释使用Agent、Meta、Session、Delegation等真实领域名称；不得据比喻新增CPU类型、字段、执行规则或模型入口。文中历史CPU用语仅解释旧讨论，不构成当前命名指令。
