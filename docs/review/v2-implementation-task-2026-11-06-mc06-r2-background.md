# MC06-R2 后台外部 Task 实施任务单

2026-11-06：**MC06-R2 后台外部 Task 已闭环，R2Complete=true。** [最终接受](/home/keer/.codex/outputs/2026-11-06/mc06-r2/root-final-acceptance.json)与[同次结果独审](/home/keer/.codex/outputs/2026-11-06/mc06-r2/runtime-result-review.md)确认：单个后台 attended Task 先持久返回 running ACK，父 idle 后一次精确 once；原命令 exit0，实际 91 字符终答完整进入 synthetic.output，整个 505 字符通知进入最后父模型 user-role 请求。只有一条实际 InboxDelivered Meta receipt，原 ACK 不变，无第二 Tool.Success 或伪 child。

本轮 Source／父／外部／总请求／Codex／Native 消耗为 3／3／2／5／1／1，五请求均 complete200；累计 12／12／10／22／8／9，本包余额0，不退款、不重置、不自动重跑。CLI ultra 与 wire xhigh 分别验证。controller／runner、Electron、gateway、官方 Node launcher 均退出0；Source／Codex native 数字退出仍 unknown，自有进程已结束、三端口释放。工程与离线测试、真实范围及历史审计错误分开保存在接受收据中。

MC06Complete=false，MC07Started=false。Root 继续原 R3 忙时 steer／queue 与 R4 有实际能力依据的其它 transport；复用原 Job／Delegation／Session／Permission owner，具体实施和有限运行另行冻结。以下早期状态与预算按对应历史时点理解。

2026-11-06：本片工程已按[限定接受](/home/keer/.codex/outputs/2026-11-06/mc06-r2/root-engineering-acceptance.json)签收。原独审P1已修复并由同一审查者确认；192/0和修复后97/0分轮保留，Core类型与定向工程检查通过。真实后台链与同次退出仍待验，R2Complete=false、MC06Complete=false、MC07Started=false。

Owner：Root；2026-11-06。R1 已签收并完成六文档同步，见前片 root-final-acceptance.json 与 root-document-closure.json。本任务正式派发工程，真实运行由 Root 在工程完成后另行冻结有限包。

## 目标与边界

同一 Codex 0.162.1/app-server external Task 支持调用时 background=true：原 Tool 先返回准确 running 回执，原 Job 独立持有执行及权限等待；完成结果只经稳定 synthetic 通知进入父会话及 Meta 的原 receipt 统计。同一 participant 后续 Task 从原结果续接原 thread。不把 ACK 当最终成功，不新增执行循环、CLI registry、全文 KV 或内部 child Session。

沿用原配置 backgroundEnabled；关闭时行为对齐现有 Task 说明。attended 不删减：原 source 是身份，权限逐次断言；后台停用原 invocation progress，但保留原 Permission/FileAccess/ShellParse 桥。普通父 Session interrupt 沿用现有含义，不扩大成取消所有后台；participant interrupt、delegation close、parent deletion 仍为正式停止入口。

## 复用决定

Binding 增加可选 background，旧记录缺省前台。Job.metadata 使用真实父 sessionID，以复用原删除 fence；必要时保留其他消费者实际使用的字段。原 Job Scope 负责执行，已有 Execution Scope 只监督结果观察。稳定 notificationID 根据已有 inputID 和 parentTaskID 算法派生；不新增 child-shaped Job.Recovery，冷恢复仍归既有 Binding 扫描。

运行中与已经完成两种 start/background 交错都消费同一 Job，不重跑。原 Job.output 是 live 全文；冷读是 R1 readResult 原准确 turn，4096字符字段继续只作领域摘要。最终通知复用 SessionNotification.inspect 和 Session.synthetic(resume:false)，入库之后才 wake；消费/取消后不再读 CLI 或重复通知。ACK 不写 metadata.externalReceipt，避免终态先到时误计 receipt。

冷开原 call 仍 running：复用 R1 恢复原 Tool 的路径，不再发终答通知；原 call 已是本 Binding 的后台 ACK：只补稳定终答通知。结果暂不可读保留待协调，后台缺口不阻断父无关工作；不自动探活或重执行。waitExternal 同时复用原 completed Tool 与原后台通知完整结果（含已有 ToolOutput 文件读取），准确 Output 身份校验不放宽。

Meta 后台统计复用 materialize/原表，在原 InboxDelivered 投影后核 synthetic。只认稳定通知ID、原 durable Tool.Called 来源及当前对应 ACK、Binding、Task版本与实际终态 Delivery、Meta owner；假通知/ACK/重复投影不得获得终态 receipt。不补发第二个 Tool.Success。统计要求来自专项 M07 与 §5.7；实现复用原 materialize 和同一投影事务，receipt 不能增加逻辑 StepCount。

## 候选文件

生产：packages/core/src/tool/plugin/task.ts、delegation/receipt.ts、delegation/execution.ts；Meta 最小接线为 meta-agent/service.ts、session/projector.ts（Root 已核定纳入本片）。测试：现有 tool-task、delegation-execution、meta-agent-integration 文件。接口、schema生成、Job通用恢复 union、UI 与其他engine暂不触碰。范围外发现交回 Root。

## 验收与职责

1. Root先在真实 Task/Job/Delegation 图建立 RED：外部终态被 Deferred 门控时能返回running准确locators；无child，Task仍in_progress。attended 在 ACK 后出现准确ask，一次once后继续；pending取消撤销且迟到答复不恢复执行。
2. 完整结果超过4096且含尾标，终态通知只有一次，父后继 TestLLM 请求消费完整正文；Meta只在真实投递后有准确receipt。快速完成早于ACK、通知未wake、已消费/取消重入各按原机制验证。
3. 同库冷开分别覆盖ACK已存和ACK未存；调用只readResult，绝无start/resume/turn或命令/模型。未知与身份错配不成功；同participant正常续接保持原thread。
4. participant interrupt、delegation close、父删除使用生产入口取消Job及Permission，另一父不受影响；Task取消/修订在结算前胜出不产生新成功信用。验证历史foreground与R1受影响路径。
5. Root独占包内定点测试、Core type、格式/lint/AST，子智能体负责限定文件实现和一次独审；不运行全仓矩阵、不重跑已接受Native读取。固定Bun1.4.2，保留WIP，禁止git暂存/提交/推送/reset/clean、依赖升级或改用户现用配置。
6. 工程绿后Root签有限真实后台验收包；父DeepSeek Flash/high，外部cc-switch + gpt-6.1-sol，CLI ultra和wire xhigh分别验。本任务当前阶段尚无新模型或CLI/Native执行；原累计9/9/8/17/7/8保留。实际资源/数值与cleanup按新包冻结，失败计账且不自动重试。

R2闭环后继续R3/R4，MC06全部完成再进入MC07；不以本草案或登记账本代替交付。

## 调度

mc06_prompt_prepare 只写上述5个生产文件，完成实现后交Root检查；Root写/跑3个现有测试文件。原测试资源槽不转移。先由Root保留后台ACK/attended RED，再开始生产写入；子智能体在Root发明确“RED已保留”前只做实施定位。一个独审者在绿色候选后复核。不得把方案简化成永久拒绝后台attended，也不得移交原应交付的R2行为到MC07。

简单方案的剩余边界：外部后台持久恢复归Binding扫描，不进入内部child-shaped Job.pendingBackground枚举；不新增跨进程fencing或after hook exactly-once；沿原Session interrupt语义及已核实际provider能力。后续R3/R4继续承担忙时交付和其他transport，前台手动转后台不因调用时background支持而宣称已验证。
