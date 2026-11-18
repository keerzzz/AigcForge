# MC09 正式实施任务：完整产品消费者

2026-11-08 最终状态：**MC09Complete=true**。[Root 最终接受](/home/keer/.codex/outputs/2026-11-08/mc09-ui-closeout-root-v1/root-final-acceptance.json)已签收本任务原完整范围。最后零模型原Workflow UI与同次退出通过，全部自有资源已关闭；执行与错误验收前提的分轮证据见最终接受。下文保留原任务、调度及范围修订。

2026-11-08。**Root delegated decision：正式授权 MC09 完整工程与串行检查。** [MC04b 最终接受](/home/keer/.codex/outputs/2026-11-08/mc04b-runtime-root-v1/root-final-acceptance.json)已确认 MC04bComplete=true，真实17请求及同次退出收口；MC08接受保持。新工程聊天使用 `gpt-6.1-sol / max`，拥有本片源码写入和串行检查槽。实际仓 `/home/keer/workspace/aigcfroge-v2`，现 `v2-dev` / `9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`；默认 `/home/keer/workspace/aigcfroge` 只读。保留全部 WIP/staging/模式，无 Git 写入、依赖升级或现用服务操作。

首读本仓 CLAUDE 当前状态/核心、根与受影响包 AGENTS、ARCHITECTURE、DESIGN、docs/testing；[原 MC09](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-05-meta-next-session-prompts.md:333)、[本片发现](/home/keer/.codex/outputs/2026-11-08/mc09-stage-a-v1/findings.json)、MC08 Root 最终接受、上述 MC04b 最终接受及最终接口。UI 工作应用适合现有产品界面的设计技能并遵循本仓 DESIGN；Effect 工作读本仓技能。Codegraph未初始化结论复用，精准rg即可。

目标保留原完整 MC09：公开 Client/Data、Meta 状态/身份/关联与 memory、Hub、Task/decision/cache/产物 UI、Workflow 运行消费及正确 scope/重载/IPC/长标题/窄屏/明暗/键盘。Session协作视图是同一任务首个可验收增量；不以其成功关闭 MC09，也不自动将其余消费者移入 MC10。Root决定实际波次，勿新增编号或矩阵。

直接复用与实际工作：

1. Client `createSync`、SessionTask ACK/current/cache生命周期已存在。先在 `solid/data.ts` 与现 `SessionTaskPanel` 接真实 Delegation/participant/turn/receipt；保留现 CRUD/状态/digest。按ID区分同名participant，打开原内部child/Tool全文，外部thread不造child。用现 `useOpenSessionRoute` 和 Session identity；显示/操作来自当前owner，不由UI推断审批。interrupt/close/reconcile/retry沿现公开SDK。PATCH pending不能宣称继续执行。
2. Meta `get/sessions/stats`、公开 Controller 与项目 `MetaAgentMemory` 已存在。补真正缺的 canonical 读合同/Data/状态与项目memory消费者；统计保留 recorded-only/unknown。项目权限/来源沿当前owner。个人 Inspector 直接消费已接线的六个 Memory 管理HTTP，用真实pending/确认/编辑/删除ACK；与项目事实分开。原B08的默认/provenance/Session模型消费、Notes/KB/提醒由原owner衔接，不能拿个人表或一张Meta面板替代。
3. Hub复用 `SessionTask.listAll` 与 `/agent-task` 原合同；接通当前stub，按canonical Session Location筛可见任务，再接现Home/Work宿主。不得直接返回全库listAll或新增Hub注册表/状态树。任务显示真实归属、进度和结果导航；真实执行controls依原Task/Delegation/Workflow合同。
4. CacheDiagnostics已有Core与Protocol，handler仍stub。补owner接线/Data；复用Context已有token UI，补Session/Meta范围、confidence、逐step关联和实际耗时，不重复存完整prompt，不把unknown算零。旧Task/harness运行预算不是产品全局规则。
5. Workflow status/run/cancel/retry已公开实现。保留现声明候选保存UI，补真实定义运行、run/step/分支/跳过/失败/取消、当前revision控制、Task来源/结果跳转、重试/刷新/通知。复用MC08底层接受。events-off准确显示原不可用状态；原无日志恢复/规模条件保持，不重新复制执行器。
6. WorkArtifact.apply、FileMutation/LocationMutation及公开合同已存在，apply handler仍stub。补该接线与候选预览→明确apply/冲突→真实文件→现file viewer用户链。保持M1内存snapshot合同，冷加载按实际文件读回；不要新增产物数据库或把候选当已应用。

已授权首增量为 `packages/client/src/solid/data.ts`、`packages/app/src/session/tasks/session-task-panel.tsx`、`packages/app/src/session/tasks/session-task-panel.css`、`packages/app/src/runtime/i18n/en.ts`、`packages/client/test/solid-data.test.ts` 和 `packages/app/e2e/regression/session-header.spec.ts`。后继原目标在同一任务内继续；其余是两现Server handler的必要动作、缺公开结果字段/正式依赖注入、现Home/Context/file/Memory宿主的必要leaf消费者。公共合同变化只走正式Client generate。App本次新增文案只加英文源，语言回退复用。S1冻结的panels/registries/README/side-panels keeper优先公共API复用；确需改共享文件由Root移交。候选路径不授权无关清理。

验证复用最强owner：现Client solid-data、App session-header、Server delegation/workflow/memory和artifact实际keeper，新增接线只扩实际改变的合同。先RED证明缺消费者/错误scope/迟到或动作结果，再最小GREEN。重点为sameID跨server、canonical Location/Session、同名participant、冷IPC/重载、失效/删除、操作ACK后read失败、CAS拒绝刷新及原全文结果。不要重复测试未变更底层绿组。单包走 `/home/keer/workspace/aigcfroge-v2/script/bun` 与当前scripts；Client/Server/App定向测试/类型，App另 `typecheck:e2e`。测试/生成/production benchmark只在Root串行资源槽执行；Session代码改前后基准与真实隔离Electron由Root安排。

工程阶段模型/Source/Native/gateway预算0。冻结源码/依赖/产物后Root准备本轮有限真实消费者与预算；沿既有授权推进，不重复问已决定范围，不把旧请求额度迁移或扩为产品框架。交付before/after、最小diff、真实命令/cwd/exit/tally、失败/未验、当前权限/来源/结果/controls证据及独审。只有原MC09完整消费者和必要前置实际满足才交Root总签收；完整目标未满足时继续此任务，不以窄增量切到MC10。


## 执行与交付接续

工程输出统一在 `/home/keer/.codex/outputs/2026-11-08/mc09-engineering-v1`。Root 已保存首增量六文件的 before、当前 Git index/status。每个后继实际编辑文件在首次修改前记录现有字节和模式；保留同文件旧 WIP。主智能体是唯一源码写者，可并行委派只读 owner/界面/测试范围调查与最终差额独审。先做可运行消费者，复用已有组件、SDK 与服务；不要新增计划框架或为既定实现反复申请同范围许可。

上述剩余 owner 接线、对应已有测试和新 leaf 消费者属于原 MC09 已授权工程；公共字段、依赖注入和组件文件按已证明的实际接缝做最小修改并记录。遇到实质产品语义冲突或确需修改 S1 共享冻结文件，向 Root 提供具体触发与最小差额；其它独立消费者继续。已通过部分在新改动没有影响时直接复用，未完成的原 MC09 项继续推进。

每个可验收增量回报实际完成项、关键命令/cwd/exit与剩余事实，继续完成原任务；只有需要 Root 接管构建/真实运行或完成全部工程时才交回检查槽。最终交付精简的 after/delta、实际通过和失败收据及独审，达成条件即停止源码写入，不为成稿追加检查。

后续隔离 Native 验收由 Root 绑定具体模型/资源/额度并签发。复用运行器时使用已修正的 Node 环境清理链：`/home/keer/.codex/outputs/2026-11-08/mc04b-runtime-root-v1/future-cleanup/wiring.md`。本片工程真实模型/Source/Native/gateway/产品 Codex 启动预算均为0。


## Root 调度补充：独立 leaf 并行实施

2026-11-08，Root delegated decision。依据当前 `increment-status.json` 的具体文件分工，原“整个 MC09 唯一源码写者”调整为“每个文件单一写者”。个人 Memory Inspector、Workflow run 面板、Work artifact 面板的六个独立文件可分别交给三个子智能体实现；工程主智能体负责指派与集成。精确文件及首次写入前状态见 `/home/keer/.codex/outputs/2026-11-08/mc09-engineering-v1/root-parallel-leaf-dispatch.json`。共享 Data、英文源、Home/Session 宿主、Server/Core 接线和既有 E2E 由工程主智能体统一写，测试/类型/生成/构建仍串行。

变更依据是文件集合实际互不重叠；需要避免的风险是同一文件并发覆盖，由精确文件归属解决。各子智能体复用现有类型、SDK、UI和权限结果，接口接点由工程主智能体根据实际 owner 一次约定；不得为并行实现另建通用抽象。完成后交回文件所有权，再由主智能体统一集成验证。原 MC09 完整范围、S1 共享归属及真实运行预算保持任务已定内容。

## Root 调度补充：既有 WIP 的静态检查范围

2026-11-08，Root delegated decision。`lint:changed main` 实际扫描 2147 个文件、报告 2003 项；其中 327 项位于 MC09 修改文件，310 项为可读性空行规则。该命令的基线覆盖本分支累积 WIP，不能直接作为本片新增问题数。原命令与 exit 1 保留在工程目录的 `root-lint-changed-final.json`、日志及诊断清单。

冲突点是 `script/lint-changed.ts` 的“碰一文件就整文件清零”与本任务明确要求保留原 WIP、只处理本片差额。影响范围限定本次 MC09：以首次修改前保存的同文件 before 与最终字节比较，处理新增行和新文件的规范问题；继承诊断按原样记录。已验证的风险是全分支基线会把旧 WIP 清理带入本片，因此不将全量 2003 或 327 项清零设为退出条件。该规则协调事项登记于本任务，供 Root 与既有 lint owner 修订切片使用说明；不新增 lint 框架。

已有类型、生成、lint 实际差额和消费者验证继续执行。格式化的原始 JSX AST 差异只作为诊断，先核实具体节点；以现有类型检查和必要的格式化后消费者回放裁定本片行为，不另建等价证明门槛。


## Root 调度补充：同 Session 来源导航修复与原会话尾段

2026-11-08，Root delegated decision。v4 的首条真实 User 已完成 3 个 Flash/high 请求（父2、build1），记忆操作、普通 Task、child/父最终正文、Artifact Apply200、冲突409、实际文件查看/重载及公开/UI完整结果已通过。[同次部分收据](/home/keer/.codex/outputs/2026-11-08/mc09-runtime-root-v4/root-runtime-v4-partial-accounting.json)保留随后原 Tool 定位失败及全部退出；此前 v3 取消的1个已发请求另计，累计模型4、Native4、Source4、gateway2。已完成首链不重跑。

[独立来源导航审查](/home/keer/.codex/outputs/2026-11-08/mc09-consumer-review-v1/native-tool-source-review.md)确认组内 Task 展开后应渲染原 locator；同 Session 复用 view，而 virtualizer 的 reveal target 仅在微任务读取，现有 effect 未同步订阅该变化。原工程聊天 `01a1b77e-f272-7e01-805f-1d353a635823` 仅重新接手 `packages/app/src/session/timeline/virtualizer.tsx` 和 `packages/app/e2e/regression/session-header.spec.ts`：在一条既有 compact 协作用例中补同 Session、点击前 Used/context group 折叠、点击后分组自动展开、原 Tool ID 可见及存储输入对应的 RED；随后只把 target 读取移入 effect 同步体，再 GREEN。保留原 Tool locator，不能以手动展开替代来源导航。

Root 根据[后继 renderer 独审](/home/keer/.codex/outputs/2026-11-08/mc09-consumer-review-v1/native-tool-disclosure-review.md)撤回曾追加的内层 disclosure 打开和 ACK 正文可见要求。冲突点：普通 task 回落到 `GenericTool`，其在 `packages/session-ui/src/components/basic-tool.tsx:398` 只展示调用输入，没有详情 children，也不接收 open/output；现有展开 key 两端一致。影响仅限这两项新增断言，不新增 task renderer、alias 或详情 UI。原 Tool 不存在的 RED 与后继错误 disclosure 前提的 exit1 分别保留；完整结果沿已接受的侧栏正文和实际父 Tool wire 证据验收。

[新 before](/home/keer/.codex/outputs/2026-11-08/mc09-navigation-fix-v1/before.json)保存两文件当前 WIP与模式。本轮只跑该 keeper、受影响 App/App E2E类型、实际差额lint和原5场景单样本基准；原 MC09 after 基准复用为本次before，不重跑无关绿组。Root 的初始 Tool/wire 结算已完成，串行检查槽已交给原工程聊天；真实启动和模型预算0。

Root 同时准备原 v4 root/DB/HOME/Location/Native profile 的尾段，新的 config/ledger/evidence 放在独立 runtime 子目录。尾段只补来源 reveal、child/cache、close后结果、Meta/cache、Hub A/B、Memory、一次实际 Workflow User及退出，最多父2+Workflow step1共3模型，Native/Source/gateway各1，Codex0。此前全部账本保留；已有模型累计授权10不重置，具体尾段和新增启动仍由Root完成绑定后签发。
