# MC06-R3b 忙时外部 Task 队列

2026-11-06：**MC06-R3b忙时后台append的工程、真实链及七文档已闭环。** [真实接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/root-runtime-acceptance.json)与[同次结果独审](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/runtime-v3-result-review.md)确认：原后台running ACK后，显式append与默认append各准入一条queued输入；queued ACK不带未来native turn。三个独立Task claim沿同participant/thread依次产生三个native turn，各自一次准确once；92／106／106字符的原生终答完整进入各自synthetic.output，三条完整通知经父P5/P6/P7的user-role消费，P7含全部三条正文。只有三条准确Delivered Meta receipt，原ACK不变，没有第二Tool.Success或伪child。

[工程接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/root-engineering-acceptance.json)独立保存四文件受影响组155 pass／0 fail／1459 expects及Core type、定向工程检查；受控恢复／Scope测试与真实运行分开，原RED/type失败保留，分轮tally不相加。 仓外readiness修复的[原RED](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/approval-readiness-fix-v1/red.json)和[GREEN](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/approval-readiness-fix-v1/green.json)另存，未并入产品tally。

本轮Source／父／外／总／Codex／Native为7／7／6／13／3／1，十三请求complete200，实际三个exec均无需wait。累计38／38／31／69／19／16，余额0／0／3／3／0／0，见[v3账本](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/runtime-candidate-v3/root-runtime-accounting.json)；旧失败和R3a v3外／总各一次本地超额attempt保留，不退款、不重置、不自动再跑。CLI ultra、wire xhigh分别核验。 同次controller/runner、Electron/gateway/三official Node launcher均退出0，自有资源关闭、三端口释放。真实native完成与launcher关闭观察先于后继启动预留；直接Effect Scope观察、Source/Rust native数字退出、远端抵达/代理内部请求及物理硬上限仍unknown。 [v1失败接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/root-runtime-v1-failure-acceptance.json)与[v2失败接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/root-runtime-v2-failure-acceptance.json)仍保留；v1 HTTP200/SSE failed的上游具体原因unknown，v2只确认两once/两命令/两完整通知，第三项清理取消、没有P7信用。v2观察器缺省/矛盾混同已作共同readiness修复，原失败具体子条件仍unknown，不倒填失败快照。

R3bFunctionalAccepted=true；R3bComplete=true，MC06Complete=false、MC07Started=false。 [最终接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3b/root-final-acceptance.json)记录本片最终状态及七份文档实际字节。后继仅R4，三个恢复债务按[唯一账本](../technical-debt.md)原owner/unlock继续开放。以下为本任务派发前合同、历史授权和原额度，最新状态以上述接受为准；正文目标与白名单保持。

2026-11-06；Owner：Root。R3a 已按[最终接受](/home/keer/.codex/outputs/2026-11-06/mc06-r3a/root-final-acceptance.json)完成工程、真实链与七文档闭环。本任务先独立复审，再由 Root 保留可信 RED，随后放行单一生产实施者。当前没有 R3b 生产写入或真实运行授权。

原累计 Source／父／外／总／Codex／Native 为23／23／19／42／12／13，余额0；R3a 的历史失败、v3 本地超额和退出 unknown 保留。R3b 真实模型、CLI、Source、Native 新预算均为0；工程完成后再冻结单次有限运行包。测试、类型、构建和真实运行由 Root 独占。

## 目标与复用

只交付已有 busy Codex/app-server participant 的后台 append 队列：持久准入后立即返回 queued ACK，准确前序物理 Job 成功完成后，沿同 participant/thread 启动本项新的原生 turn。复用现有 Delegation、Task、Job、adapter.execute、Permission、Inbox 与 Meta receipt。

首读本仓 CLAUDE.md、AGENTS.md、ARCHITECTURE.md、packages/core/src/tool/AGENTS.md 和 .aigcfroge/skills/effect/SKILL.md。实际仓为 `/home/keer/workspace/aigcfroge-v2`；默认工作区只读。本仓 codegraph 未初始化，沿既有决定使用定点 rg／源码读取，不初始化索引。固定 `script/bun` 1.4.2；保留分支及全部 WIP，不 stage/commit/push/reset/clean，不安装升级或修改现用服务／用户配置。

复用[R3b草案](/home/keer/.codex/outputs/2026-11-06/mc06-r3a/r3b-task-draft.md)、[测试复用](/home/keer/.codex/outputs/2026-11-06/mc06-r3a/r3b-test-reuse.md)。以下为 Root 的正式合同，覆盖草案中的可选方案。

- 触发仅为 append（含现有默认 append）＋有效 background＋已有 busy Codex/app-server participant。保持当前配置开关、Task 权限和现有 participant/Location 校验；不新增 command=queue。普通前台追加、R3a foreground steer、闲置后的正常续接保持原语义。
- 选择立即 queued 准入 ACK，保持 kind=external-cli、status=queued。它只证明本次领域输入和 Task 已持久准入，Task 仍 in_progress。不得填入未来 native turn、旧 turn 或空串；已有 participant 的真实 thread 可沿原绑定引用。
- 每项保留自己的领域 Turn／Delivery、完整 Tool.Called prompt/source、Task claim/revision 和独立 Job。队列项不加入 R3a 的共享物理结果 inputs 集合。

## 生产白名单

1. `packages/core/src/tool/plugin/task.ts`：busy append 选择、准入、逐调用权限/source 与 queued ACK。
2. `packages/core/src/delegation/execution.ts`：现有 external dispatch owner 内的独立 pending Job、物理前序、启动、完整 Binding、取消、恢复与结果通知。
3. `packages/core/src/delegation/receipt.ts`：明确区分准入 ACK、已启动原生结果及尚未启动的取消/恢复表示；共用身份判定，不伪造 native turn。
4. `packages/core/src/meta-agent/service.ts`：仅同一外部收据在 notification 入口的预解码及 `verifiedExternalReceipt` 的 owning 验证分支，接受本片准确的 queued ACK 后继及未启动终态表示。其余 Meta 逻辑只读。

第四文件是 Root 根据实际消费者作出的定点范围决定：notification 入口约428行先解码 `DelegationReceipt.External`，约570行再进入 owning 验证；两者当前只接受完整 native thread/turn，而 queued 项在开始前取消时不存在 native turn。两处复用同一严格的“完整结果／准入终态”codec；保留原 External 的完整身份要求。新增表示必须仍以准确 source/input/attempt、原 Task claim 与 durable Delivery 事实验证，不能降低已完成原生结果的完整 Binding 要求。

测试写入只由 Root 操作现有 `packages/core/test/meta-agent-integration.test.ts` 和 `packages/core/test/delegation-execution.test.ts`。确需其它文件时先给 Root 具体决定函数和必要差异；实施者不得扩白名单。Job、adapter、Schema/Protocol/HTTP/SDK、数据库事件与迁移、Session runner、其它 transport、UI、依赖和锁文件保持只读。

## 启动与队列顺序

领域准入复用 `appendTurn` 与已有 delivery=queue。按现有 Turn.seq 形成队列，区分准确物理前序和后来准入但未开始的项；不能沿当前 dispatch 的“最新 delivery 必有完整 native Binding”假设读取 pending 项。

每个队列输入用现有 Job.start 建立独立 Scope，在锁外等待准确前序 Job.wait。只有前序准确 completed 且物理结果成功，才重核本项当前 Task claim、parent/Location/Meta/participant、command/thread、close fence 与队首身份，再调用现有 execute/resumeId。前序 Task claim 失效不等于其物理工作失败；本项不得靠旧 claim 的 waitExternal 成功条件取得启动资格。

当前 adapter 的 Effect.scoped 先完成原生连接 finalizer，再进入 Execution 结算，Job.settle 最后发布 completed。因此成功路径复用 Job.wait 足够，不新增 Job 公共 API、通用 generation join 或第二执行循环。Job.cancel 提前发布 cancelled 不能作为资源关闭证明；cancelled、error、recovery_required、missing、timedOut 前序均停止自动推进，本项以 recovery_required 保留协调事实且不启动。后台通知 observer 的结束不作为后继原生启动门槛。

准入 ACK 返回必须释放现有 delegation 锁；不得持锁等待需要同锁完成的前序或本项 Job。至少两个 queued 项应按先后关系逐项运行，不能同时等待首个原 Job 后一起启动。新项的 Permission 和 attended 复用普通新 Task 合同，绑定本次 source；不得继承前序的 once。只有真实 onTurn 后保存完整 native Binding，新 native turn 与旧 turn分开。

## 结算、取消与恢复

完整输出沿 R1/R2 的 Job 输出、Task CAS、原生准确读取与正式通知路径。每个有效 claim 独立结算；原 queued ACK 保持原文，后继结果通过一次准确通知及 Meta receipt 送入父模型，不补第二 Tool.Success 或重复 after。共享 codec/helper 决定 queued ACK 与后继完整 Binding 的同一输入关系，禁止在调用方各写一份相似判定。

未启动取消只 fence 本项并停止其 Scope/claim，不能取消前序物理 Job或原审批。显式本项取消沿现有 Job.cancel(id)；Task 状态/revision 变更沿既有 CAS 在启动和结算边界判定，不新增全局 Task 变化监听。close/父删除停止所属 pending 输入，已开始项沿原 owner 取消；锁内 fence、释锁后取消。未启动的失败/取消/恢复表示只证明准入及其终态，不声称已有 native turn、外部执行或模型成功。

冷 pending 准入不等于自动恢复执行：重开后保留准确准入/ACK/source/claim，进入 recovery_required，不调用 execute，不读取前序正文补成本项结果。明确开始后的完整 Binding 沿 R1/R2 读取其准确 thread/turn 结果；原 queued ACK仍须验证。已发送 native start 但 ACK/onTurn 未知时保留未知事实，不重发、不借旧 turn认领成功。

## 最小验收与调度

Root 先复用真实生产路径保留 busy background append 缺口的 RED；未收到 Root“RED已保留，开始生产修改”前，生产实施者只读定位。

- 立即 queued ACK/queued Delivery，未来 native turn 缺省；前序未成功完成时无本项 execute。两个 queued 按 Turn.seq 逐项续接同 thread、不同 native turn，启动观察证明原 adapter finalizer 已完成。
- 本项取消/claim 变更不伤前序；非 completed 前序和 close 阻止自动启动。原 Task 人工修改不被晚到成功覆盖。
- 真正换 Scope/数据库后的 pending 不重发；有准确完整 Binding 时恢复本项完整输出，重复恢复不重复读取/提交/通知。
- 使用现有大正文 fixture 验证 queued 终答完整进入 synthetic.output及父模型 user-role 请求；按该项 source/input/Task 核唯一 Meta receipt。未启动取消/恢复记录保持准确身份，没有伪造执行信用。

使用现有 externalSetup／externalRecoveryFixture、TestLLM、实际 DB/Bus/Permission/Job 和 Deferred/readiness；不另造测试框架，不 sleep 等竞态。工程稳定后运行受影响文件、Core type及定向格式/lint/AST/diff；不重跑全仓、已接受 R3a 真实链或扩大故障矩阵。只安排一次非实施者代码独审，修复后仅补受影响验证。

本片选择最小的进程内队列：复用已有 Job 与领域事实，没有跨重启自动调度。技术债 Owner 为 Root/DelegationExecution：取消或失败前序后的自动推进、pending 重启自动启动、未知 start 的准确受理恢复，均待独立可核事实与具体任务解除。R4、其它平台/transport 与计费不在本片；R3b 通过后仍须原 R4 才能评估完整 MC06。当前 R3bComplete=false、MC06Complete=false、MC07Started=false。
