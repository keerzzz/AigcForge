# MC06-R3a 同一活动 Codex turn 的 steer

2026-11-06：**MC06-R3a 同一活动 Codex turn 的前台 steer 已闭环。** [真实接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3a/root-runtime-acceptance.json)与[同次结果独审](/home/keer/.codex/outputs/2026-11-06/mc06-r3a/runtime-v5-result-review.md)确认：原后台 ACK 后，同 Task 新输入复用同 participant/thread/native turn 和原 Permission Scope；一次原审批 once、唯一命令 exit0，130 字符原生终答完整进入正式前台 Tool 输出，完整 Tool 文本由父 P3 消费。旧 claim 不产生后台通知，只有一条准确 foreground Meta receipt。

[工程接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3a/root-engineering-acceptance.json)保留：四受影响文件173 pass/0 fail/1525 expects，Core类型及定向工程检查通过。仓外v3等待门离线7/0/34、v4新输入4/0/21分轮记账；v5只修夹具派生身份/hash并重绑未耗额度，未重跑产品测试或重建。

本轮3/3/3/6/1/1，累计23/23/19/42/12/13，余额0；controller/runner、Electron/gateway/官方Node launcher为0，同次自有资源结束、三端口free。[本轮账本](/home/keer/.codex/outputs/2026-11-06/mc06-r3a/runtime-candidate-v5/root-runtime-accounting.json)及原v1–v4失败均保留；v3有一次被拒外部本地attempt，使当轮外/总各超原上限1，不回填授权，v4六项消耗均0。

本次真实切口为首个外部响应完整结束、原命令审批仍挂起时的 steer；不扩称流中抢占后的完整续答均已验。工程、原失败、CLI ultra/wire xhigh 的分别核验及 Source/Rust native 数字退出 unknown 均保留。MC06Complete=false、MC07Started=false；下一项为原 R3b busy queue，再按实际能力处理 R4。以下早期状态按其历史时点理解。

2026-11-06；Owner：Root。状态：待独立任务复审，尚未授权生产修改。R2 已按[最终接受](/home/keer/.codex/outputs/2026-11-06/mc06-r2/root-final-acceptance.json)与七文档闭环签收。工程完成后再冻结有限真实运行包；当前真实模型、Codex、Source、Native 新额度均为0。原累计 Source／父／外／总／Codex／Native 为12／12／10／22／8／9，不退款、不重置、不重跑R2。

## 目标与现有规则

只交付固定 Codex/app-server 同一活动原生 turn 的 foreground steer，复用原 Job、同实例 adapter、原连接与 Permission Scope。R3b 仍负责 busy queue；其它 transport 归 R4。原外部前台、后台及终态后同 participant 续接保持。

工作树仅 /home/keer/workspace/aigcfroge-v2；首读本仓 CLAUDE.md、AGENTS.md、ARCHITECTURE.md、packages/core/src/tool/AGENTS.md 和 .aigcfroge/skills/effect/SKILL.md。本仓不存在 CONTEXT.md 或 packages/core/AGENTS.md，不能误用默认仓库的同名规则。codegraph 此仓未初始化；沿前片决定使用定点 rg／源码读取，不初始化索引。固定 script/bun 1.4.2；保留全部 WIP，不 stage/commit/push/reset/clean，不安装升级、不改现用配置或服务。

调查复用 [R3研究](/home/keer/.codex/outputs/2026-11-06/mc06-r2/r3-reuse-plan.md)和[草案](/home/keer/.codex/outputs/2026-11-06/mc06-r2/r3a-task-draft.md)；当前基线为 [baseline.json](/home/keer/.codex/outputs/2026-11-06/mc06-r3a/baseline.json)。以下是 Root 对草案 D1/D2 的具体裁决，复审后生效。

1. D1 保留现有领域准入。task.ts:637/674 与 SessionTask.append/updateTask 决定每次 Task 的父 Task、领域 Turn／Delivery 与 revision 行为。省略 parent_task_id 创建新 Task；指定则沿原 patch／CAS。新增领域输入仍有完整 durable Tool.Called prompt/source，各自结算；可以共用原生 thread/turn 和 Job。禁止 ACK-only 省去领域记录，也禁止将同一原生 turn 冒充两个原生执行。
2. 仅接有效 background=false 的 command=steer，必须明确已有 delegation_id/participant_id，不允许新 participant、新 delegation、内部 child/task locator、model/judge override 或 Custom parent。有效 background+busy 的 queue 不在本片，不得因 command 名字静默改为 steer。
3. 原 Job 的 attended 与 onPermission 回调保持。steer 输入省略 attended，继承原工作权限 Scope；显式 attended 在本片拒绝并解释不能通过 steer 更换审批模式。新 Tool 仍按新 source 完成 Task 权限准入；后续原生审批仍绑定原工作 source。该规则不改变普通新建外部 Task 的 attended 行为。

## 生产白名单与 owner

仅允许 packages/core/src/tool/plugin/task.ts、packages/core/src/delegation/execution.ts、packages/core/src/tool/codex-app-server.ts。可调整同文件的内部输入类型与执行条目，但不新建公共 API、第二 registry、第二执行循环、全文 KV 或假 child。receipt.ts／Meta／Schema／Protocol／HTTP／SDK／SessionTask／fold 默认只读；确有阻塞时交 Root 定点审定，不能默增范围。

Root 为唯一测试、类型、构建及真实运行执行者，并负责四个已有测试文件：tool-task、delegation-execution、codex-app-server、meta-agent-integration。生产写者只修改上述三文件，不能与 Root 写同文件。独审者只读候选。任何角色不得额外启动 CLI、服务、模型或独立付费探测。

## 同一 owner 与受理顺序

CliAdapter.resolve 每次 forCommand 创建新实例；codex-app-server.ts:455 的 activeTurnsByThread 属于该实例。steer 必须经原 externalJobs 取得同实例控制能力，不能重新 resolve 并回退新 connection。原工作必须有准确后台 ACK、活动原生 thread/turn 和未终止 Job。

Task 边界负责当前调用、Task 权限和领域准入；Execution owning boundary 负责 parent／Location／agent／Meta／原 Binding、唯一活动 owner、新输入 Binding 与 Task claim；adapter 只负责本机 active record 与准确原生 expectedTurnId/返回 turnId。校验不跨层复制。缺 active record 或 expected turn 不符直接拒绝，连接工厂不再兜底 steer。

active record 必须在 onTurn 释放 ready 前注册，并有已安装的原 Scope 清理。新 steer 注册与原 Job 终态结算使用已有 delegation 锁；不持该锁等待需要同锁完成的原 Job。原生 steer ACK 返回同 turn 后，才确认新 Binding 已受理。每个已受理 Binding 有自己的领域 Turn、source、Task revision，真实 externalThreadID/externalTurnID可共享。

原 Job 的完整物理结果供各已受理领域输入结算。每个 Task claim 单独 CAS；一个过期／取消 claim 不得令同一原生成功结果或其它有效 claim 一并失败。显式链接原工作 Task 会按原规则增加 revision，使旧 claim 失效；不能回滚 revision、重绑旧 claim 或用其 CAS 错误取消整个原生 Job。前台 steer 等待自己的真实终答；只有仍有效的 claim 才可产生对应后台通知或前台成功结果，各自 Tool.Success/after 不重复。失效原后台 claim 沿 R2 的 revision 检查跳过通知和成功 receipt，不要求为它新增通知或放宽 Meta 验证。

## D2：拒绝、未知与取消

先做能在现有 Task／Execution owning boundary 确认的活动 owner 与模式检查。不能把新输入的拒绝套进原新-execute补偿而取消原 Job。

fold.ts:683–758 决定 DeliveryFailed 会连带 participant/delegation failed；DeliveryCancelled 不改变 participant phase。因此，已准入但明确未受理的 steer 只取消该新 Delivery、明确保存拒绝原因，并按新 Task claim 结算；原 participant、Job、其它 Task 不因该输入拒绝而 failed。前置检查在新领域准入前拒绝时不造新记录。

RPC 已发而 ACK／受理事实未知时，将该新输入保留为 recovery_required，记录未确认事实，不把完整旧终答当作已受理新输入的结果，不自动重发、不 start/resume、新建连接或重跑。该协调状态可以显式反映在原 delegation 中，但不得凭未知输入取消仍在工作的原 Job。未知与明确拒绝按实际可证明的边界区分；当前 RPC pump 丢失 error response 阶段事实的地方在原 adapter 内修复，不用错误文案猜远端是否受理。

Job.cancel 会等待原 Scope.close。若共享终态结算使用 delegation 锁，原 close／interrupt 入口必须先在原锁内提交停止 fence，再释放锁后 cancel／等待，不能持锁等待需要同锁结算的 Job。只调整现有 owning entry，不引入新锁层或通用取消框架。

明确已受理的输入可沿现有 R1 准确 Binding/readResult 恢复原完成结果；未确认输入没有这项成功信用。原关闭／父删除取消归原 Job Scope，所有已受理输入分别保留正确终态。用户修改或取消的 Task 不被晚到结果覆盖。

## 验收与先后顺序

Root 先保留直接对应 guard／active connection 缺口的 RED，再正式放行生产写者；未收到 Root 的“RED已保留，开始生产修改”前只读定位。

- Task 路径：原后台 Task ACK 后，准入同 participant 的 foreground steer；新领域 Turn／Delivery/Task准确，同一原生 turn、同一次 execute/connection，完整新 prompt到一次 steer RPC。
- adapter：onTurn ready 即可 steer；缺 owner/expected mismatch 零新连接；固定原生响应 turnId严格相同，迟到终态/断线无 start/resume fallback。
- 结算：多个已受理领域输入共享完整终答，各自 source/revision/Tool结果准确；复用既有大输出fixture证明完整文件/正文不截断，原任务或一个 claim取消不覆盖其它有效claim。
- D2：拒绝只影响新输入；送达未知不伪造受理、不重发；原 Job仍能正确结束。指定parent_task_id后的旧claim失效按真实CAS验证。
- 权限和Meta：原Job Permission Scope保持，steer显式attended拒绝；每个真实终态receipt匹配自身Binding/source，running ACK不新增终态receipt，逻辑模型step不虚增。close/父删除、迟到once及前台/后台既有路径按影响面回归。

测试使用现有生产实现、TestLLM、wirePeer、Deferred／Bus readiness；不用sleep等待竞态，不把受控模型算真实provider。工程稳定后只跑受影响组、Core type及必要格式/lint/AST/diff；不重跑全仓或已接受R2真实链。一个非写者独审后，Root冻结单次真实场景、具体数值预算和退出观察。

最小方案为在原 Job 和原 map 中保留同实例控制与已受理输入引用，复用既有领域事实／结果读取。更重的跨turn通用队列／执行器／新registry无当前必要，不引入。保留技术债：busy queue属R3b；未确认steer的精确恢复由Root在可验证原生受理事实与独立任务成立后处理；外部计费仍unknown。R3a通过不关闭R3、MC06或启动MC07。
