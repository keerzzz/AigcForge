# MC06 首片精确任务单：Codex app-server 前台 Task 与权限桥

2026-11-06：**MC06 已按本次正式绑定的 app-server 能力与其它 transport 的明确拒绝边界闭环。** [R4真实接受](/home/keer/.codex/outputs/2026-11-06/mc06-r4/root-runtime-acceptance.json)与[同次结果独审](/home/keer/.codex/outputs/2026-11-06/mc06-r4/runtime-v2-result-review.md)确认：显式 sdk 配置的一次正式 Task 在领域准入前返回准确 unavailable；完整127字符错误进入第二父请求，父终答说明不可用。两个 DeepSeek Flash/high 请求均 complete200 且观察到 SSE 终结。无外部请求、Codex启动、领域Task/Delegation/Delivery/child记录或成功receipt。controller/runner、Electron/gateway均退出0，自有Source结束、三端口释放；Source数字退出仍unknown。

[MC06范围裁定](/home/keer/.codex/outputs/2026-11-06/mc06-r4/root-mc06-supported-scope-decision.json)复用前台首片、R1持久结果恢复、R2后台、R3a同turn steer、R3b忙时queue的既有接受，并按原提示词允许的实际能力拒绝完成R4。R4Complete=true、MC06Complete=true；该状态仅指已绑定的app-server功能与准确不可用边界。SDK/ACP/JSONL成功执行、SDK续接/完整结果恢复未交付，沿原owner/unlock登记；不能解释为全部CLI能力完成。MC07Unlocked=true、MC07Started=false，由Root派发后继独立小节。以下早期状态按历史时点理解。

本任务原首片与四类后继的限定接受分别由范围裁定中的原收据关联。R4只补正式消费者拒绝测试和仓外验收修复，没有新SDK执行接线。所有旧失败、超额及退出unknown保持。

2026-11-06：**MC06-R3b忙时后台append的工程、真实链及七文档已闭环。** [真实接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/root-runtime-acceptance.json)与[同次结果独审](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/runtime-v3-result-review.md)确认：原后台running ACK后，显式append与默认append各准入一条queued输入；queued ACK不带未来native turn。三个独立Task claim沿同participant/thread依次产生三个native turn，各自一次准确once；92／106／106字符的原生终答完整进入各自synthetic.output，三条完整通知经父P5/P6/P7的user-role消费，P7含全部三条正文。只有三条准确Delivered Meta receipt，原ACK不变，没有第二Tool.Success或伪child。

[工程接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/root-engineering-acceptance.json)独立保存四文件受影响组155 pass／0 fail／1459 expects及Core type、定向工程检查；受控恢复／Scope测试与真实运行分开，原RED/type失败保留，分轮tally不相加。

R3bFunctionalAccepted=true；R3bComplete=true，MC06Complete=false、MC07Started=false。 前台首片与R1/R2/R3a接受保持；本片任务见[原R3b任务](v2-implementation-task-2026-11-06-mc06-r3b-busy-queue.md)，实际余额0／0／3／3／0／0和恢复债务见[唯一账本](../technical-debt.md)。后继仅为R4实际能力范围；下方各早期首片和后继状态仍按历史时点理解。

2026-11-06：**MC06-R3a 同一活动 Codex turn 的前台 steer 已闭环。** [真实接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3a/root-runtime-acceptance.json)与[同次结果独审](/home/keer/.codex/outputs/2026-11-06/mc06-r3a/runtime-v5-result-review.md)确认：原后台 ACK 后，同 Task 新输入复用同 participant/thread/native turn 和原 Permission Scope；一次原审批 once、唯一命令 exit0，130 字符原生终答完整进入正式前台 Tool 输出，完整 Tool 文本由父 P3 消费。旧 claim 不产生后台通知，只有一条准确 foreground Meta receipt。

本次真实切口为首个外部响应完整结束、原命令审批仍挂起时的 steer；不扩称流中抢占后的完整续答均已验。工程、原失败、CLI ultra/wire xhigh 的分别核验及 Source/Rust native 数字退出 unknown 均保留。MC06Complete=false、MC07Started=false；下一项为原 R3b busy queue，再按实际能力处理 R4。以下早期状态按其历史时点理解。

2026-11-06：**MC06-R2 后台外部 Task 已闭环，R2Complete=true。** [最终接受](/home/keer/.codex/outputs/2026-11-06/mc06-r2/root-final-acceptance.json)与[同次结果独审](/home/keer/.codex/outputs/2026-11-06/mc06-r2/runtime-result-review.md)确认：单个后台 attended Task 先持久返回 running ACK，父 idle 后一次精确 once；原命令 exit0，实际 91 字符终答完整进入 synthetic.output，整个 505 字符通知进入最后父模型 user-role 请求。只有一条实际 InboxDelivered Meta receipt，原 ACK 不变，无第二 Tool.Success 或伪 child。

本轮 Source／父／外部／总请求／Codex／Native 消耗为 3／3／2／5／1／1，五请求均 complete200；累计 12／12／10／22／8／9，本包余额0，不退款、不重置、不自动重跑。CLI ultra 与 wire xhigh 分别验证。controller／runner、Electron、gateway、官方 Node launcher 均退出0；Source／Codex native 数字退出仍 unknown，自有进程已结束、三端口释放。工程与离线测试、真实范围及历史审计错误分开保存在接受收据中。

MC06Complete=false，MC07Started=false。Root 继续原 R3 忙时 steer／queue 与 R4 有实际能力依据的其它 transport；复用原 Job／Delegation／Session／Permission owner，具体实施和有限运行另行冻结。以下早期状态与预算按对应历史时点理解。

2026-11-06：MC06-R1 已完成限定工程、原生持久结果读取及文档闭环，见[最终接受](/home/keer/.codex/outputs/2026-11-06/mc06-r1/root-final-acceptance.json)与[唯一账本](../technical-debt.md)。R1Accepted=true，MC06Complete=false，MC07Started=false；后继由Root按原计划推进R2/R3/R4。原前台fixture失败、旧预算及退出unknown保留。

2026-11-06 MC06 首片功能链由监督Root签收：[功能接受](/home/keer/.codex/outputs/2026-11-06/mc06-foreground-closeout/root-functional-acceptance.json)、[v8结算](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v8/root-result-accounting.json)、[同一结果复审](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v8/result-review.json)。v8于2026-11-05 23:28–23:31（Asia/Shanghai）完成：原两次前台外部Task、同delegation/participant/thread的两turn、两次精确once204、两条命令exit0及canary拒写成立；正式Tool.Success原文均进入最后父模型请求，父3/外4共7请求完整200，CLI ultra/wire xhigh分别验证。后继只读核验23项通过，不并入产品测试数。第二条自然语言回答多一个末尾句点，父模型如实拒报成功；原严格fixture失败和controller/runner1、closed=false保留。依据人类最新“无需再问、自主按第一性原理完成并继续”的active goal，Root仅豁免该句点对功能签收的影响，不放宽命令、权限、身份、模型或持久化合同，不重跑已证明的前台链。

同次cleanup收据证明自有资源关闭：Electron/gateway/两官方launcher退出0，全部已知PID结束且三端口free；Source/Codex native数字退出仍unknown。runner在outcome失败后的finally完成清理且不发close action回复，controller等待已退出runner导致closed=false；旧值不改写，后继复用同次cleanup收据避免重复清理请求。v8本轮消耗3/3/4/7/2/1，累计Source/父/外/总/Codex/Native9/9/8/17/6/8，原数值额度余0；本地fixture HTTP1另列，不退款、不重置。后续由Root在新具体小节中按最新自主授权安排有限运行范围，不视为无限额度或重放许可。

MC06FirstSliceFunctionalAccepted=true，MC06Complete=false，MC07Started=false。MC06余项仍归原执行Root：先外部完整结果在父Tool.Success前的持久恢复，再后台外部Task、忙时steer/queue及有真实能力依据的其它transport；复用原Delegation/Job/Session/Permission owner，不造第二执行循环或注册表。各片限定工程/真实验收并同步唯一账本后，按实施计划进入MC07等后续；四类余项不因首片签收自动关闭。Git写、安装升级、用户现用服务接管仍不在本轮动作内。

2026-11-05 MC06 本地权限边界已取证并完成最小工程修复：[本地结算](/home/keer/.codex/outputs/2026-11-05/mc06-permission-probe-v1/root-result-accounting.json)、[结果复核](/home/keer/.codex/outputs/2026-11-05/mc06-permission-probe-v1/result-review.json)、[工程接受](/home/keer/.codex/outputs/2026-11-05/mc06-local-permission-fix-v1/root-engineering-acceptance.json)。按人类授权重绑定原剩余1次Codex启动，实际1个Codex、1次本地固定SSE、1条审批、0 accept；明确decline后interrupt并退出，真实provider/Source/Native新增均0。实际kind=command、environmentId=local、cwd匹配；命令哈希精确匹配/bin/bash -c新私有脚本。固定0.162.1官方Environment::local/is_remote及保留ID校验证明local为本机环境；shell检测可重新选择路径，但本次命中passwd/PATH/fallback哪支仍unknown。原v7只从旧日志补证客户端Decline往返，原RPC参数未恢复，不把本次字段倒补成v7原值或宣称人类拒绝。

本片只修改codex-app-server.ts一个判定，使null及保留local进入原onPermission；其他环境继续拒绝，原owner/request绑定、权限与取消流程保持。复用wirePeer新增local用例，RED actual1（0pass/1fail/12filtered/6expects）保留；修复后整文件13pass/0fail/91expects，Core类型、格式、lint、AST与tracked diff actual0，AST runtime resolver fallback警告保留。untracked test的no-index diff检查actual1且无诊断单列，不伪报0。仓外命令候选只将两条精确资源改为/bin/bash -c，真实ShellParse/PermissionEffective检查4/0，裸脚本和旧/usr/bin形式仍deny；不修改scanner或增设匹配回退，也不修改旧v7包。独立工程复审无问题，候选尚未绑定新的真实运行产物。

本地driver/官方launcher退出0；Codex native数字退出仍unknown，所属进程组为空、9418无监听、脚本目标未创建，无Root追加信号。累计Source/父/外/总/Codex/Native为6/6/4/10/4/7，已批上限7/7/6/13/4/7，余1/1/2/3/0/0；本地fixture HTTP1单列，历史失败/取消不退款、不重置。Owner仍为监督Root；解除条件为将本次已接受源码与精确资源冻结到原前台两Task验收包，再按具体差额预算获得启动授权。当前无下一次CLI/Native/真实请求授权，不自动重跑。首片两成功Task/两once/同thread续接与完整退出仍待真实验收，MC06后继4类及原owner/unlock保持；MC06Complete=false、MC07Started=false。

2026-11-05 MC06 v7已完成授权运行及失败结算：[结算](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v7/root-runtime-failure-accounting-v7.json)、[同一独审](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v7/root-runtime-result-review-v7.json)。identity SSE修复在本次真实链通过：父2/外部2共4请求均200且观察到协议终结，实际响应编码头均缺省；CLI ultra、wire xhigh分别保留。第一外部Task正式completed，输出为审批被拒、命令未执行，该正式Tool原文已到父模型；父Session succeeded，但仅1 Task、成功命令/once/第二Task均0，验收TwoRealCompletedExternalTaskCallsRequired失败，不混同两个状态。实际rollout的脚本、shell、login:false、cwd与冻结输入相符；原审批RPC未留存，观察器过滤缺字段或不匹配command，空rpc日志及rejected by user文案均不能证明具体拒绝分支或人类点击拒绝。源码initialize已启用experimentalApi；不猜缺字段、不放宽权限。Owner为监督Root；后继先补审批边界的安全取证并用原协议/客户端做零模型核对，具体根因证明前不追加真实运行包。本次消耗Source2/父2/外2/总4/Codex1/Native1，累计6/6/4/10/3/7，已批上限7/7/6/13/4/7，余1/1/2/3/1/0；失败不退款、不重置。自有PID均结束、三端口free，Electron/gateway/官方Node launcher退出0，Source与Codex native数字unknown；controller/runner1、closed=false与cleanupControllerError保留。首片仍待两次成功命令、两once、同thread续接及完整退出文档；MC06后继4类与原owner/unlock保持，MC06Complete=false，MC07Started=false。

2026-11-05 MC06 第六轮真实验收已按首错停止并结算：[v6失败与退出](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v6/root-runtime-failure-accounting-v6.json)及[同一独审](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v6/root-runtime-result-review-v6.json)接受失败记账，未接受完整链。Native初始化32项通过，新User与第一Task入参准确；实际CLI turn_context为ultra、wire为xhigh，已通过该档位谓词。第一父请求HTTP200但网关记录client-cancelled；随后外部本地请求被429拒绝，上游external转发0，成功Task/once均0。决定条件是forward-ledger.reserve对先前非response-complete结果停止准入，gateway把该undefined统一写成slots-consumed；实际父/外/总预留仅1/0/1，上限3/4/7，不能归因为额度耗尽。父正式历史有tool-calls及session.step.streamed，取消的实际发起方与原因仍未证明；未留上游响应头/终结字节，不能把HTTP200或该语义记录改写成传输成功。每个已发本地请求均占额度：本次Source1/父1/外本地尝试1/总2/Codex1/Native1，累计4/4/2/6/2/6，已批累计上限6/6/5/11/3/6，余2/2/3/5/1/0；旧拒绝和取消保留，retry-limit文案不证明额外尝试。Electron0、gateway0、官方Node launcher0，Source/native数字退出unknown；全部已知自有PID结束、三端口free，controller/runner1与closed=false/cleanupControllerError保留。Owner仍为监督Root；解除条件是先零模型复现源流完成与传输取消的具体差异，再按必要最小修复验证和明确新运行授权推进。当前不改停止规则、不重放旧User、不创建下一运行包或追加真实请求。首片仍待完整两Task/两once/父消费及退出文档闭环；后台Task、忙时steer/queue、其它transport和外部已执行未提交父结果的完整崩溃重建仍属原MC06后继。MC06Complete=false，MC07Started=false。

2026-11-05 MC06 第五轮真实验收已结算：[v5 失败与同次退出](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v5/root-runtime-failure-accounting-v5.json)。Permission Client 修正后已到第一项真实external Task，父模型首请求complete200且Task入参准确；Codex启动后向本地网关请求Responses，被403拒绝，无外部上游转发、命令完成或once。隔离CLI配置及turn_context均ultra，实际wire为xhigh；原wire-ultra谓词存在确定冲突，未保存拒绝响应头，不能排除其它拒绝条件或宣称普遍等价。人类已选[CLI ultra／wire xhigh分别验证](/home/keer/.codex/outputs/2026-11-05/mc06-engineering-v1/runtime-model-selection-v3.json)，仅用于准备，未授权新启动或扩额。本轮Source/父各2，第二个父请求为Tool-error后正常后续请求并被清理取消200；外部本地被拒尝试1、Codex启动1、Native1。按失败也占预算，保守扣除该本地403尝试；原网关账本仍准确保留仅Source转发2、external转发0，不改写。累计Source3/父3/外部尝试1/总尝试4/Codex1/Native5，剩1/1/3/4/1/0；拒绝与取消均不退款。Electron0、gateway0，Codex官方Node launcher实际0但Rust native数值unknown；Source单SIGTERM结束但数字unknown，所有已知自有PID结束、三端口free，controller/runner1及closed=false/cleanupControllerError保持。Owner为监督Root；后继仅在原两Task范围分离并验证CLI与wire等级，完成冻结、复审和具体差额额度批准再执行。当前无第六次Native或新请求/启动额度。MC06Complete=false，MC07Started=false。

2026-11-05 MC06 第四轮真实验收已结算：[v4 失败与同次退出](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v4/root-runtime-failure-accounting-v4.json)。单行原请求逐字匹配、Native ACK200 与真实 User 晋升已通过；outcome 验收器随后因不存在的 api.session.permission 入口报 TypeError。实际 generated Promise Client 使用顶层 api.permission，list 已解包为数组；[离线复现](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v4/root-client-permission-contract-diagnosis-v1.json)的错误消息 SHA 与真实失败一致，正确 list/once reply 的内存传输检查通过，不取得真实 Permission 信用。修复候选只统一这组入口与数组消费，产品源码、权限规则与逐字门禁保持。实际本轮 Source准入1、父请求1、总请求1、Native1；累计 Source1/父1/总1/Native4，外部请求0、Codex启动0。唯一 forward 为 client-cancelled 且 requestCreated=true，上游状态与到达仍unknown，取消不退款。会话终态interrupted，无Task/once/外部线程。Electron0、gateway0、Source单SIGTERM后结束但数字unknown，四个已知进程消失且三端口free；controller/runner1、closed=false与cleanupControllerError保留。Owner为监督Root；后继仅收敛当前验收器Client/Schema消费并完成离线核对。原剩余额度为Source2/父2/外4/总6/Codex2，Native余0；完整原两Task新包所需Source3/父3/外最多4/总最多7/Native1，须明确补足差额并冻结绑定，不隐式扩额或重置账本。当前无第五次Native或新增Source/父/总额度授权。MC06Complete=false，MC07Started=false。

2026-11-05 MC06 第三轮真实验收已结算：[v3 失败与同次退出](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v3/root-runtime-failure-accounting-v3.json)。Native 初始化 32 项检查通过，实际 canonical preload 与产物双 SHA 一致，更新后的 Source 清理路径也在本轮生效；随后 submitHeld 报 NativePromptTextMismatch。数据库只保留一个 Work/Meta 会话创建事件，没有 User 准入、消息、Task 或外部线程。Native 累计 3/3，Source 准入、父/外部/总模型请求及 Codex 启动均为 0。Electron 实际退出 0；Source 原流程单次 SIGTERM 后结束，数字退出仍 unknown，三端口释放；controller/runner 实际 1、closed=false 与 cleanupControllerError 保留，不能因清理完成改写成成功。提示词历史比冻结输入少一个 LF（3410/3411 字节），完整拦截请求体未留存，见[文本差异](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v3/root-prompt-history-difference-v3.json)。Owner 仍为监督 Root；后继仅准备复用 MC03 单行输入的原两 Task 验收，不修改多行编辑器或削弱逐字门禁。解除条件为单行包冻结与复审、明确追加 1 次 Native（累计上限 4）及原未耗 Source3/父3/外4/总7/Codex2 重绑定后完成真实链与退出。当前没有第四次启动授权；多行 fill 路径未获验证，若需产品修复须由 Root 独立复现并另行分派。MC06Complete=false，MC07Started=false。

2026-11-05 MC06 第二轮真实验收已结算：[v2 失败与补充退出](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v2/root-runtime-failure-accounting-v2.json)。Source 已完成注册、归属及鉴权检查，原 JSX 启动故障未再出现；验收停于 LoadedPreloadUnavailable，尚未提交 User/Task。Native 累计 2/2，父模型、外部模型、Source 准入和 Codex 启动均为 0。原 cleanup 的旧 CLI 路径期望拒绝关闭 Source；Root 已按完整记录身份单次 SIGTERM 关闭，三端口释放，Source 数字退出仍 unknown；原 failed/closed=false 记录保留。v3 只修仓外取证与清理路径绑定：canonical preload 目标和冻结 sourceHostRoot；清理真实 OS 进程夹具通过 1/0、11 断言。Owner 仍为监督 Root；解除条件为修复包冻结、明确追加 1 次 Native（累计上限 3）及原未耗额度重绑定后完成原真实链与退出。当前没有第三次启动授权，MC06Complete=false，MC07Started=false。

2026-11-05 MC06 首轮真实验收在 `renderer-sidecar-header-readiness` 失败，尚未提交新 User 或执行 Task。[本轮记账](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v1/root-runtime-failure-accounting-v1.json)：Native 已耗 1/1；父模型 0/3、外部 0/4、Source 准入 0/3、Codex 启动 0/2。controller/runner 实际退出 1，Electron 实际退出 0，Source 数字 unknown；自有资源清理与原 closed=false 分开保留。根因是新 Source 外部加载 TUI TSX 时遗漏现有 Solid 预载。[新桥模块验证](/home/keer/.codex/outputs/2026-11-05/mc06-runtime-v2/root-checks/source-solid-preload-v2-receipt.json)已复现原 JSX 错误并在复用预载后通过；仅仓外运行候选变化，已接受生产工程不重开。Owner 仍为监督 Root。解除条件：修复包冻结并获追加 1 次 Native、原未耗额度重绑定后完成真实链及退出；当前没有第二次启动授权，不退款、不重置。MC06Complete=false，MC07Started=false。下文旧预算/状态均按对应历史收据理解。

2026-11-05最新状态：监督 Root 已[正式签收首片工程](/home/keer/.codex/outputs/2026-11-05/mc06-engineering-v1/review/supervisor-mc06-limited-engineering-acceptance-v1.json)，SHA256 `43b3d84b545d40e95dd4bfb7775df17b9af7b6f86a5ff57be355c975e669e456`。同一独审确认 R1/R2 闭合，修复受影响组56 pass /0 fail /500 expects及类型、格式、lint、Effect AST检查通过；原128/0证据保留，不相加。当前source为freeze-v2（SHA256 `7c2a121662093d11a3eac7fe8c51063ba15802a82dd2c93fc139a7465bd12bcb`）。用户已选择cc-switch与gpt-6.1-sol/ultra，仅用于运行包准备；父模型仍DeepSeek Flash/high。工程接受不授予实际执行额度，真实CLI/provider/Native预算及调用仍0/0/0，MC06Complete=false。执行会话连续宿主限流后，监督Root接管文档和唯一检查/构建槽，runtime helper仅写新MC06仓外目录；[交接与用户选择记录](/home/keer/.codex/outputs/2026-11-05/mc06-engineering-v1/supervisor-runtime-preparation-handoff-v1.json)。下文待审、路线未选与原资源槽描述保留为历史。 最终精确模型选择见[用户更正记录](/home/keer/.codex/outputs/2026-11-05/mc06-engineering-v1/runtime-model-selection-v2.json)。

日期：2026-11-05，Asia/Shanghai。当前状态：**监督 Root 已在本会话正式派发下列13文件上限的首片工程及必要零模型检查。** 唯一生产/测试写者现为 `/root`（实施子智能体宿主限流后接回；接回前只有已核 RED 新测试，生产文件全部与原基线相同），本 Root 单写本任务单和仓外协调/运行准备产物，独占测试、类型、格式和构建资源槽；冻结后一次独审由非写者执行，监督 Root 验收。13文件是上限，不要求每个文件必改。真实 CLI/provider/Native 预算均为0；原 S1 owner 不转移。文中调查时点的未授权/未运行记录保留为历史，不覆盖本段正式派发。

## 目的、范围与依赖

选定 `codex` engine / `app-server` transport，绑定本机 npm 安装描述的 **Codex CLI 0.162.1**。首片用户链：普通 Work/Meta 的正式前台 Task → 同一 Delegation 的外部 implementer participant → 实际 external thread/turn → 增量与完整工具结果 → 第二次 Task 明确指定原 participant，resume 同 thread → 父模型消费两次正式 Tool 结果；另用受控 keeper 验证权限拒绝、取消、关闭和迟到消息。外部 implementer 不冒充 reviewer。

首片包括该 transport 的 attended Permission 桥、准确资源/调用绑定及有限正常续接。不交付其它 engine/transport、后台 external Task、忙时 external steer/queue、review/revision/barrier/fanout 治理、Workflow/Judge、PGE、Hub/UI 或全域恢复。相关外部选项必须明确拒绝，不能静默改为前台、换 engine 或降级 transport。内部已接受语义保持；不重开 MC00、MC01–MC05，不自动实施 MC07。

MC05 绑定收据：`/home/keer/.codex/outputs/2026-11-05/mc04a-mc05-engineering-v1/mc05/root-original-exit-and-document-closure-v1.json`，SHA256 `8b8e674680e9d3694cdbbf18461f3e44f37cdc2531fad521df7e9e0a12ce385f`。本次实际核验 MC05Complete/MC06Unlocked=true，五份 documentsAfter 的实际字节全部匹配；这只满足依赖，不授予本片生产/运行权限。启动提示词 SHA256 `72853c2205dfef2c86f1f799104f26b4609f2f67bf067d127f5a8b51450722b1` 匹配。

现场：`/home/keer/workspace/aigcfroge-v2`，`v2-dev@9e2c6577ef6dd65c8f01ff94d46da0142bcb877c`；暂存区空。精确展开 `git status --porcelain=v1 -z --untracked-files=all` 为 208 个 tracked modified、13950 个 untracked 文件；启动时默认折叠口径为 826 个 untracked 项，两个口径不能相加。全部 WIP 保留，默认 `/home/keer/workspace/aigcfroge` 只读。调查与候选文件基线在 `/home/keer/.codex/outputs/2026-11-05/mc06-readonly-task-v1/`。

原账本：`AUDIT-V2-MODE-META` / `V2-VALIDATION` 的 MC06 外 CLI/attended 子范围，`V2-C-DELEGATION`、`V2-C-DELEGATION-LIFE`；映射 B07.3/B09.3、P4/P5。Owner 仍为主智能体及原 Core/Permission/Task/Delegation/Meta/validation owner。本任务不是第二功能账本，也不关闭原条目。

## 选型实证与复用决定

本地安装描述：`/home/keer/.nvm/versions/node/v24.15.0/lib/node_modules/@openai/codex/package.json` 为 0.162.1，真实 launcher 为该目录 `bin/codex.js`。Core 实际解析的 `@openai/codex-sdk` 为 0.146.0，`@anthropic-ai/claude-agent-sdk` 为 0.3.220，ACP SDK 为 0.21.0；安装描述不证明鉴权、模型可达或实际 CLI 成功。本轮没有启动它们。已存在的 Codex 配置仅选择性读取 model/provider/wire-api/endpoint hostname：gpt-6-astra/custom/responses/127.0.0.1；未读 auth 文件，此配置事实不是新模型授权。

官方版本来源为 `openai/codex` 的 `rust-v0.162.1`：`app-server-protocol/schema/typescript/v2/ThreadStartParams.ts`、`TurnStartParams.ts`、`TurnSteerParams.ts`、`Turn.ts`、`ServerRequest.ts` 等实际返回内容证明真实 thread/turn 与 expectedTurnId，以及服务器审批请求。已保存的官方源字节和失败请求单独记在仓外 `official-codex-0.162.1/sources.json`。`codex-rs/cli/src/main.rs:571–595` 明确支持 `--stdio`，因此**不把当前 argv 的 --stdio 误报为缺陷**。Context7 的 `/openai/codex` 主干只作补充，不当作已安装版本证明。OpenAI 实时开发者页面本轮 DNS/403 不可取；部分版本化源请求超时，见未知点。

选择 app-server 是因为当前首片需要真实 turn 身份、同 thread 续接和服务器审批往返。现有 Codex SDK adapter 只用 `run`/`finalResponse`，既不传 sandboxMode 也没有权限回调（`tool/codex-sdk.ts:40–64`）；不能把 approvalPolicy=never 称为只读。Claude SDK 已有 canUseTool 接缝（`tool/claude-code-sdk.ts:55–82`），但当前实现不提供所需真实 turn 控制/增量，且裁掉 callback 的第三参数。此处只记录排除依据，不同时改造它们。JSONL/ACP 及其消费者不在本片。

复用现有 `cli-adapter.ts` 作为唯一 descriptor/选择 owner，Task/Delegation/Job/Permission/Session 作为既有执行与结果 owner；不新建 Driver、通用 transport 框架、全局授权 callback 或第二模型循环。配置按父 Session 保存的 Location 读取，`Config.latest(entries, "cli_agents")` 仍决定选择。只加载本片 `codex/app-server` 实现；配置覆盖须留在当前 Location/调用的解析结果，不能把一个 Location 的配置和权限闭包写进全局 Map。**现 `registerConfigCliAdapters` 会写全局 Map，禁止从每个 Location 调用它安装配置；registry 只放静态 descriptor，当前配置解析为调用值。** 描述符与 live 连接/审批分别持有；live 资源归本次调用及既有执行 Scope。

简单方案为在现有 Core owner 内增加一个外部分支。新增架构方案会扩大所有 transport、公共 HTTP 和恢复面，本片没有这个需要。**技术债明确保留**：后台/忙时 steer、其它 transport、精确在飞崩溃结果重建和外部计费未知；本片只证明已提交父工具结果的正常冷读/同 thread 后继输入，不能宣称任意副作用可重放。

## 当前决定函数与已存在缺口

以下路径均相对目标工作区；行号来自本轮实际源码，不是未来行号。

- `tool/cli-adapter.ts:120–154`：Map、register/get/list 和 `registerConfigCliAdapters` 是当前选择 owner；精确字符串检索未找到其配置加载生产调用方。配置 transport 必须匹配已提供 built-in，不能暗降 JSONL。
- `tool/codex-app-server.ts:296` 的 `negotiateCapabilities` 硬匹配 `/0.150.`；`:342` 的 negotiated wrapper 可 fallback。首片显式 app-server 路径不能经该自动降级。`:266` connection 只有 request/notification/close；`:826` pump 把有数字 id 的消息当 response，未区分服务器 request；`:616` execute 不接 canUseTool/onProgress。这些是真缺口，非已执行 RED。
- 同文件 `initializeConnection :389`、`execute :616`、`makeCodexAppServerProcessConnection :781`：需核完整 initialize/initialized 握手、服务器 request/reply、终态/EOF、子进程 Scope；`:415`/`:508` 各自短 Scope 的 startThread/startTurn 不能拼成保持活连接的执行链。`:387` 全局 activeTurns 和 `cancel :590` 的 cwd 扫描不能承载跨父调用授权/取消。
- `tool/plugin/task.ts:241` 和 `:259` 当前拒绝 external-cli/attended；`source :156`、权限断言 `:373`、`response :520` 可复用。必须先完成 target/transport/权限/身份检查再修改准入，不能只删 guard。
- `delegation/service.ts:396` 的 `participantExecutorError` 限 Meta participant 为 internal；`requireBinding :270` 对 externalThread 只核同 Delegation 冲突；`addParticipant :459` 比较 provider/target/role/context/child/thread，`bindParticipant :495` 禁止改绑。所选路径须补跨 parent/Location/meta 的归属校验，不能凭名字或最近 thread 采用。
- `delegation/service.ts:553` 的 appendTurn 与 `delegation/fold.ts:209` 的 deliveryKey、`:25` 的 inputID 决定同 aggregate 准入及完整 attempt 身份；原规则复用。`DelegationExecution.dispatch :537`/`:575` 只接受 internal；`wait :350`、`writeback :277` 依赖真实 child/SessionInputResult；`interrupt :1017` 只处理 child。共享根因是缺外部 producer/consumer 分支。
- `schema/src/delegation.ts:10` 的公共 Receipt 强制 childSessionID；`schema/src/delegation-event.ts:158` 的 Started 不带 externalTurnID，`:174` 的 Completed 仅有可选 externalTurnID 与最多4096字符摘要；`delegation/fold.ts:651` 折叠完成事实。外部不能伪造 child Session、input result 或以摘要替代全文。
- `meta-agent/service.ts:453–532` 按父 Tool.Success、准确 receipt/source、child controller 与 Delivery 验证内部 receipt；需同 owner 的外部分支。已有统计聚合不重写，不从外部 result 推算 provider 请求数。
- `permission.ts:311/328/364/420` 的 request/create/assert/reply 是真实 Permission waiter owner：source 取父 `{type:"tool", messageID, id}`，assert 捕获本 Location 的 pending Deferred 并在中断后清除，迟到 reply 为 NotFound。registry 不拥有此授权。
- 正式 Question 工具在 `tool/plugin/question.ts:48–97` 使用 **Form.Service**；`form.ts:152` 的 ask 等待实际 Deferred，取消沿本 owner。不得另接 legacy QuestionV2 作为假 UI 通道。首片只承诺 Permission 请求；未接的 user-input/MCP elicitation/额外权限类型必须协议级拒绝并给 typed 原因。

## 外部收据的具体边界（监督核对后澄清）

“Core 私有”指 codec 与语义 owner，不表示其 JSON 字节不出 Core，更不表示它可冒充公共 `Delegation.Receipt`。本片采用以下明确边界；如工程证据不能满足，则调整 owning 公共合同并交监督重定范围，不以“禁止改 Schema”强保私有方案。

- 内部 Task 的 `metadata.receipt` 继续严格使用 `schema/src/delegation.ts:10` 的既有 Receipt，`DelegationExecution.Receipt` 也保持内部别名。外部路径只写独立的 **`metadata.externalReceipt`**，由 `delegation/receipt.ts` 的一个 Core codec 编解码；不向 `metadata.receipt` 写外部变体，不填虚构 childSessionID/inputID。当前调用分支须保留内外返回类型的明确区分，不把 external union 扩散成公共 Receipt 的同名替代。
- `tool/plugin/task.ts:87` 的工具 Output 与 `response :520` 是 Core 本地工具合同；现执行调用把 childSessionID 填入必需的 sessionID，并输出 `<task id>`。**外部必须有独立输出形状，不能用 parentID 或 external thread 伪填 child/sessionID/<task id>。** 外部分支携带准确 parentSessionID、Delegation/participant/turn 与 externalThreadID/externalTurnID；内部输出原形保持。外部 metadata 不填给 child 导航使用的 `sessionID`，续接用 delegation_id+participant_id；正文照常作为 Tool content 返回。
- `session/runner/publish-llm-event.ts:579–594` 原样发布标准 Tool.Success content/metadata；公开 `schema/src/session-event.ts:569–578` 与 `session-message.ts:153–158` 已用 `Record<string, Json>` 承载工具自有元数据。因此 externalReceipt 会经过正常公开消息传输，但不经过公共 internal Receipt codec。`protocol/src/groups/delegation.ts:14–19` 的公开 State 只组合 Info/ParticipantInfo/TurnInfo；appendTurn 返回 TurnInfo（`:98`），没有 Receipt 响应需要绕开。
- `meta-agent/service.ts:453–532` 的现有 internal verifiedReceipt 分支只读 `metadata.receipt`；新增 external 分支只读 `metadata.externalReceipt`，按父 Tool.Success 的 assistantMessageID/callID、现有 Delegation/participant/attempt/thread/turn 与执行绑定验证。两个分支不互相 fallback；结果写 provenance.externalReceipt，原 provenance.receipt 保持内部含义。SQL provenance 本来是 JSON（`meta-agent/sql.ts:55`）。原 `stats` 不借此生成不存在的外部计费事实。
- `session/runner/to-llm-message.ts:125–139` 从 canonical content 生成父模型 ToolResult，模型消费不依赖任何 Receipt codec。当前 `session-ui/src/tools/tool-renderer.tsx:1440–1446`/`:1846–1858` 的 child 导航读取的是 `subagent` 的 metadata.sessionID；外部 Task 不伪造该字段。此片继续使用既有通用工具正文展示，不冒称外部线程导航 UI 已交付。

必要 keeper 增量是同一次真实 Task 执行的标准 Tool.Success/消息投影能承载 externalReceipt、internal Receipt 分支不误读它、Meta 只接受准确外部绑定，以及父模型收到真实正文；不是新增第二套公开事件或收据 API。

## 拟写白名单与单写者

**以下13文件上限已由监督在本会话正式派发，未列文件仍受保护。** 所有生产/测试文件由 `/root` 一人写；Root 和研究者不并行修改它们。旧 WIP 用仓外 `candidate-file-baseline.json` 和 before-files 保留。

1. `packages/core/src/tool/cli-adapter.ts`：唯一 descriptor 注册/按 Location 配置解析；仅补本 transport 需要的 typed 身份、审批、进度接缝。全局对象不得保存父 Permission/Form/回调。
2. `packages/core/src/tool/codex-app-server.ts`：按 0.162.1 已核协议修实际连接、审批往返、同连接完整 turn、准确 resume/cancel/cleanup、预期 typed 错误；禁止启动时探模型或自动换 transport。
3. `packages/core/src/delegation/receipt.ts`（新文件）：仅共享上述 externalReceipt 的 Core codec，供 Execution、Task 编码与 Meta 验证复用；保留公共 internal Receipt 原形。必要性是跨模块复用且避免 Meta→Execution→DelegationService→Meta 的运行时环；不放执行器或独立 registry。
4. `packages/core/src/delegation/execution.ts`：同一 dispatch/wait/interrupt/close 的外部分支；复用 Job 和 KV、稳定 Delivery/attempt、Task CAS 写回。通过现有 Instance.provide(parent) 取得保存 Location，不能把 Tool 服务全局化。
5. `packages/core/src/delegation/service.ts`：仅所选外部 Meta participant 准入、跨父/Location/thread 不可改绑及当前生命周期必要拒绝。保留内部 executor、review/barrier 和 retained-event 合同；未支持外部管理动作不得产生假 accepted。
6. `packages/core/src/tool/plugin/task.ts`：本 engine/transport 的明确路由、前置权限与参数拒绝、当前 invocation 持有审批桥、外部结果编码及准确身份。既有内部 task_id 仍是 child Session ID；外部续接用 delegation_id+participant_id，不把 threadId 冒充 Session ID。
7. `packages/core/src/meta-agent/service.ts`：只增加私有外部 receipt 来源验证/记录；按父/meta/participant/Delivery/attempt/source/thread/turn 全部核对，原内部 stats/模型统计不变。
8. `packages/core/test/codex-app-server.test.ts`（新文件）：现 connectionFactory 接缝的零模型协议/生命周期 keeper；使用 scoped 受控 JSON-RPC peer，不能启动实际 codex。
9. `packages/core/test/cli-config-adapter.test.ts`：扩唯一 registry/配置选择、两 Location 隔离、缺方法不降级；现有 JSONL factory 用例原样保留。
10. `packages/core/test/tool-task.test.ts`：扩所选路径准入、父 Permission/调用身份、完整结果及不支持选项零副作用；原内部 guard 矩阵只改已交付分支。
11. `packages/core/test/delegation-execution.test.ts`：外部 Delivery/Job/cancel/close、跨父隔离与正常冷读；复用内部已接受 keeper。
12. `packages/core/test/delegation-service.test.ts`：Meta 外部准入、跨 parent/Location 重绑拒绝、保留同 aggregate 与未知副作用合同。
13. `packages/core/test/meta-agent-integration.test.ts`：复用现有 TestLLM/真实 Tool/Delegation 图，新增两次前台外部 Task 与根模型消费，不复制模型循环或手写成功收据。

保护：白名单以外全部文件。特别是 `AGENTS.md`、`CLAUDE.md`、原计划/账本/owner；所有 public Schema/Protocol/Server/Client/generated、SQL/migration/旧库/旧 receipt；`Permission`/`Form`/`Tool.Service`/`Instance`/SessionRunner/Inbox/Instructions/claim；全部 App/GUI/Desktop/S1；其它 adapters、依赖和 lockfile。正式任务若发现白名单不足，交具体拥有者与必要差异给监督，不能自行扩大。无 Git 写、换分支/worktree、安装/升级、用户配置/凭据或现用服务修改。

2026-11-05监督范围修订：补入第14文件 `packages/core/src/tool/cli-discovery.ts`，仅 `list` 参数一行改为 `readonly CliAdapter.CliAdapterValue<Error>[]`。保留 registry 完整对象，不改 discovery 逻辑。原WIP基线已另存 `mc06-readonly-task-v1/discovery-scope-amendment.json`。

## 执行与结果合同

- 准入前一次检查所选 engine/transport/真实 descriptor、父 Session 与 Location、当前 Agent/权限和已有 participant binding。未知 engine/方法/版本、无可用 CLI/凭据给稳定 typed 原因；不使用 which 或目录卡作为可用性/授权证明。现有 events-off 持久 Delegation 拒绝保持。
- 父 Session 的已持久 Tool.Called input 是完整 prompt 来源；已有 Job.output 保留本次结果直至父工具返回，最终完整结果归父 Session 的 Tool.Success content。KV 只存准确 source、TaskLink、版本/Location/thread/turn 与 Delivery+attempt 绑定，不再复制整份 transcript。4096摘要只用于既有领域摘要。失败/断线时未发布父 Tool.Success，不补写虚构成功；跨崩溃若失去全文，保留外部事实并返回 reconciliation-required，禁止自动重放。实际进程已完成但父结果未提交是本片明确技术债。
- 使用本 transport 真正返回的 threadId/turnId；记录到相应 external binding 后才消费该身份的事件。`turn/started` 或响应与早到 delta 的顺序需 keeper 覆盖；晚消息不能串到下一 attempt。正常第二次 Task 先读原绑定，resume 精确 thread，再得到新 turn；不能根据 cwd、最近会话或旧 Permission 回复选 owner。
- Parent Permission 桥只在当前 Task invocation/Scope 中存活。父 session/agent/message/call 与 Delegation/participant/attempt 来自现有产品调用；external thread/turn/item、JSON-RPC request id 仅取所选协议实际字段。回调捕获本次连接及已解码请求/待批 item，收到答复后只回复仍存活的同一请求；连接关闭或调用中断后不迁移该回调。不新增协议 generation、内容 revision 或审批版本字段。禁止 acceptForSession、持久外部 allow-rule 或根目录 blanket grant；不从旧回复授权新动作。
- 命令权限复用 `ShellParse.scan`/FileAccess 与当前 `shell` action/resources（参考 `tool/plugin/shell.ts:117–145`）；文件审批复用当前 `edit`/路径边界。缺命令/目标路径/待批 item 内容时拒绝，不能用 `*` 猜资源。transport 底层 sandbox/approvalPolicy 也必须显式设置并核返回，不能继承用户 bypass/danger-full-access。无回调或未经映射的能力拒绝执行；声明只读不能当执行约束。
- Permission decline 的 defect tunnel、CorrectedError、Effect interruption 均按现 owner 保留；原生 callback 通过本 Scope 的 Effect bridge 返回协议拒绝/取消并保留父调用失败，不宽 catch 成普通成功。退出清理只取消本次 Job/turn/审批；close 先沿原 owner 关闭准入，再释放子资源。未知副作用不删除、不猜未执行、不重跑。
- 按上述实际消息边界，当前无需修改公共 Schema/HTTP，故不安排 Client generate。这是当前复用结论，不是强制设计目标；如真实实现必须改变公共 typed 形状，先交监督调整 owning 合同、白名单和正式生成门禁，不能靠私有变体绕过。原 first-admission-wins、durable inbox 先 wake、每 Physical Attempt 显式模型流、Instructions 和有界 claim 恢复不变。

## 必要 RED/GREEN 与资源槽

本轮已存在的可信缺口是上述生产 guard/消费者与 protocol pump 分支；**未执行任何 RED，不声称测试失败或通过**。工程派发后先用生产路径 keeper 证明：正式 Task 仍拒绝所选请求；服务器 request 被误当 response；准确 same-thread 后继与外部 receipt 不被当前 internal 分支接受。不得破坏源码造红。

新增断言只覆盖本片：完整正文超过4096仍逐字到父 Tool；同 participant 两 Task 同 thread/不同 turn；两父/两 Location 与迟到 response 不交叉；实际 command/file 审批请求的 Permission allow/deny/cancel 与断线清理；握手与配置不调用模型；协议坏帧/缺方法/EOF/失败退出 typed；并发通知早于启动响应不丢归属；取消清理无残余 waiter/Job，pending 不被冒充已执行；父结果已提交的冷读不再发模型。外部崩溃未知窗口只验证明确拒绝/保留。不存在于所选协议的内容版本/额外审批机制不设计、不测。

TTL 已由 `permission.ts:392–404` 的现有 assert 与 ApprovalPresence 持有；`test/permission-ask-bounds.test.ts:437–456` 已有 typed expiry keeper。本片不新增 TTL 参数/计时器或重复 TTL 算法测试；只在新桥确实影响错误传播时验证现有 AskExpiredError 不被转成 allow。未支持审批类型只按实际收到的协议请求拒绝，不建立通用审批类型矩阵。

资源槽唯一为本 Root。cwd 统一 `/home/keer/workspace/aigcfroge-v2`，测试必须经实际包 wrapper；实施者不自行运行检查。拟命令：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core test --timeout 30000 test/codex-app-server.test.ts test/cli-config-adapter.test.ts
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core test --timeout 30000 test/tool-task.test.ts test/delegation-execution.test.ts test/delegation-service.test.ts
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core test --timeout 30000 test/meta-agent-integration.test.ts --test-name-pattern MC06
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core typecheck
```

每条串行、分别记录 actual exit/pass/fail/filtered/expect 与源码/依赖身份。现 Core typecheck 脚本实际为 `tsgo -b tsconfig.json tsconfig.tests.json`。格式/lint 对最终变更文件定向使用已安装 prettier/oxlint 与仓内 Effect AST 规则；不运行根产品 test，不直接 tsc，不每片全仓/全模式重跑。公共生成、App/E2E 类型、构建和 Native 在本候选中均不需要；未来具体验收包有新授权才安排。受控 JSON-RPC peer/TestLLM 不计真实 CLI/provider 通过。

复用未受影响的 MC05 三 Task 真结果及已接受统计/取消/通知信用，不重跑取得新 tally。实现必要组绿后冻结，仅做一次非写者独审；修复回同片并补受影响检查，不叠加审查层。

## 未知点、解除条件与交回

1. `CommandExecutionRequestApprovalParams`、`ThreadResumeParams` 等0.162.1官方个别文件下载超时，实时开发者页面不可取。工程仅在对应 codec 首次实现前补读该版本文件或本机官方协议描述；不凭主干例子推接口、不把 timeout 当能力缺失。本轮已足以选择 transport，未宣称全部方法核完。
2. 实际 CLI 认证、平台 sandbox 有效性、provider 路由/模型可达及 physical 请求数量均未验证。当前 model 配置不改变人类已有 DeepSeek Flash 父模型要求；外部 Codex 模型/路由需在未来具体包明确冻结并获预算，不假定兼容、不换模型探活。
3. 根已核真实 Permission waiter；本片只接实际 command/file 审批到准确 action/resource 的映射，需上述定向 RED/GREEN。对官方已存在但尚未接入的 user-input、MCP elicitation、权限扩展请求明确拒绝；不新增其机制或内容版本合同，不宣称所有 attended 类型完成。
4. 后台/忙时 steer、其它 transport、外部完整 crash reconstruction、review/revision/fanout/Judge/UI、全模式与平台保持原账本、原 owner。解除由对应后继 MC06 片/MC07–MC10 的具体任务和验收决定；不由本片成功一并关闭。

**真实 CLI/provider/Native 当前新预算分别为0/0/0；本轮实际调用亦为0/0/0。** 未运行 CLI健康探测、模型探活/重试、Native、测试/类型/构建/生成。两名子智能体只读：adapter研究连续两次宿主限流后停止，Root接手关键核对；消费者研究提供 owner/复用候选。没有调换模型或继续层层分派。

工程完成后由监督决定验收包：唯一用户链、明确 CLI/engine/transport/版本/模型、物理请求与 Native 上限、源码/依赖/产物冻结、实际入口依赖解析、隔离 Home/config/DB/user-data/端口、自有 PID/cleanup、首错停止与实际 code/signal。复用 MC05 运行布局，不造新证据框架；不人为限制输出 tokens，失败/取消/503计预算，unknown不补0。

调查出口的任务单已获监督有限架构核对与工程派发；本片现在按上述单写者/检查槽实施，不代表工程接受。先可信红绿、必要检查、冻结和一次独审，再准备具体真实验收包；真实调用仍需新预算。MC06 原范围完成仍需原用户链真实验收、原退出签收和明确分配的文档同步。完成首片交回，不向其他聊天发消息、不创建或实施 MC07。

## 2026-11-05 首片工程冻结检查点

本段记录本任务后续工程结果；前文“未测试/未授权”等调查语句是历史时点。首片工程候选已冻结，实际修改13文件，批准上限为原13文件加cli-discovery精确一行。源码不再修改，等待监督安排唯一独审。

- `final-transport`：actual exit 0；23 pass / 0 fail / 106 expects。
- `final-regression`：actual exit 0；99 pass / 0 fail / 876 expects。
- `final-consumer`：actual exit 0；6 pass / 0 fail / 80 expects；20 filtered。
- Core类型、格式、lint、Effect AST均actual exit0；所有早期红轮保留。

冻结：`/home/keer/.codex/outputs/2026-11-05/mc06-engineering-v1/freeze-v1/freeze.json`，SHA256 `69593dda5e592cadd1d49a22c006a159a206814e791d5c480800c0b4b025aca7`。交回说明：`/home/keer/.codex/outputs/2026-11-05/mc06-engineering-v1/engineering-handoff.md`。原WIP、branch/HEAD、空暂存区及保护哈希保持；真实CLI/provider/Native预算与调用仍0/0/0。MC06Complete=false，不启动MC07。

## 2026-11-05 唯一独审修复冻结v2

正式独审发现MC06-R1（终态撤销待批权限）和MC06-R2（Started与Job接管间取消）。两项已用真实Permission/Bus边界受控keeper复现，0/4 actual exit1；修复后受影响组56/0/500断言，类型/格式/lint/Effect AST/diff均actual exit0。仅修改原范围内2生产+1测试文件，不新增审查层，原freeze-v1及128/0证据不变。

当前冻结`/home/keer/.codex/outputs/2026-11-05/mc06-engineering-v1/freeze-v2/freeze.json`，SHA256 `7c2a121662093d11a3eac7fe8c51063ba15802a82dd2c93fc139a7465bd12bcb`；逐项修复交回`/home/keer/.codex/outputs/2026-11-05/mc06-engineering-v1/review-fix-v1/repair-handoff.json`。等待同reviewer差异确认及监督签收，engineeringAccepted=false、MC06Complete=false；真实预算与调用仍0/0/0，不启动MC07。
