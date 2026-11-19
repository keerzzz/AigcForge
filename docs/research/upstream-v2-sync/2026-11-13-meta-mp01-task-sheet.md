# MP01 实施任务单：Meta 能力、Task Operation 与公开合同

日期：2026-11-13。状态：用户已批准工程实施；真实模型验收暂不运行。
工作区：/home/keer/workspace/aigcfroge-v2。分支：v2-dev。
HEAD：0a09f6bccdb71f1234eea759eb99e8a336d1d4da。

本任务单是[完整方案1.2](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-13-meta-cross-mode-goal-schedule-closure-plan.md)的MP01执行附件，不改变审批选择、总范围或验收权威。后续MP02–MP07仍须完成；本片不冒称跨模式全链已完成。

## 1. 片内交付

- 同一个后端决定函数判定Meta主动协调；原Tool snapshot、share/new-root execute、HTTP与SessionIdentity投影消费它。
- 新Task Operation具有稳定身份、可信来源、请求digest、目标input ID及可查询状态，现Task claim只作在飞互斥。
- new_root/existing_root创建和准入提交边界；Custom调用原采用入口，保留普通child路径。
- 非Tool操作具有服务产生的operation来源，原Permission问询在锁外，批准后才创建目标和准入。
- session-instance.identity真实接线，Client Data同步/失效/迟到响应保护；新增Schema/Protocol/current事件正式生成。
- SessionCommunication的最小公开合同与原Share owner接缝固定；实际双向通信/终答回流由MP02完成。
- 本片退出仅AC01–04/07/33、AC06保存/重试子合同、AC08 pre-admission子合同；实际终答归属、在飞取消、A/B全文和重启恢复在MP02关闭。

## 2. 原始证据与决定函数

| 关系                                           | 真实决定处                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 原内置Agent可在五模式，用户Agent限Custom       | [ordinaryModes](/home/keer/workspace/aigcfroge-v2/packages/core/src/agent.ts:150)                                                                                                                      |
| 实际执行Agent选择与tool snapshot               | [SessionContext.select](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:174)                                                                                                    |
| Meta root合法归属                              | [assertOwner](/home/keer/workspace/aigcfroge-v2/packages/core/src/meta-agent/service.ts:332)                                                                                                           |
| AgentSelected写入与保留旧controller            | [switchAgent](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/session.ts:95)、[projector](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/projector.ts:585)                    |
| 当前share只做Permission检查，没有Meta gate     | [share execute](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/share.ts:58)                                                                                                           |
| 普通create重用Session ID                       | [Session.create](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:912)                                                                                                                   |
| Custom原子采用                                 | [startCustom](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:688)                                                                                                                      |
| 当前在飞claim保存与释放                        | [saveClaim](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/task.ts:489)、[releaseOwned](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/task.ts:514)                          |
| Task写锁与CAS／commit hook                     | [updateTask](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/task.ts:1260)                                                                                                                 |
| 身份projection已有，HTTP仍stub                 | [project](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/session-identity.ts:267)、[handler](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/session-instance-stubs.ts:69) |
| 现权限来源只有Tool                             | [Permission.Source](/home/keer/workspace/aigcfroge-v2/packages/schema/src/permission.ts:17)                                                                                                            |
| 原Task Tool权限拒绝不创建Task/Delegation/child | [既有keeper](/home/keer/workspace/aigcfroge-v2/packages/core/test/tool-task.test.ts:1923)                                                                                                              |
| 当前AgentSelected丢弃旧读取并更新消息          | [Client事件消费](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:813)                                                                                                              |

查询CodeGraph已确认V2未初始化，继续rg及精确读取；不为本片初始化全仓索引。

## 3. 文件合同

允许文件是待实施清单。实际开批生成逐文件before hash，编辑只限本片需要的hunk，保留其他WIP与index。

### 3.1 Schema／Protocol

- schema/src/session-task.ts：只读operation reference和operation公开合同；Task WriteInfo不接受内部来源/receipt。
- schema/src/permission.ts：新增服务持久operation来源变体，Tool变体原字段保持。protocol/src/groups/permission.ts与server/src/handlers/permission.ts的公开ask写入仍仅接受Tool来源；内部operation来源由服务构造并验证。
- schema/src/session-identity.ts：派生coordination availability、reason和selection身份；不把它当授权。
- schema/src/session-event.ts、event-manifest.ts、durable-event-manifest.ts：仅新增不可推导operation/communication事实，保持canonical identity和current/V1分类。
- 必要新增schema SessionCommunication叶模块；ID模块只在实际循环依赖需要时独立，避免一次使用的过早抽象。
- protocol/src/groups/session-instance.ts、groups/session.ts、client.ts：Task operation和identity合同、通信接缝及reachable group。
- generated OpenAPI、Client Promise/Effect API、namespace references：只用原generate修改。

### 3.2 Core

- core/src/meta-agent/service.ts、session/context.ts：归属与真实selection能力出口；Tool snapshot和execute都使用，不能只过滤目录。
- core/src/session/task.ts及原SQL：lookup operation先于Task新revision检查；claim关联current operation，receipt保留。
- 拟新增core/src/session/task-operation.ts及SQL：领域数据属于原Task owner；不新建第二Task服务，不直接执行llm。
- core/src/session.ts、session/session.ts、projector.ts：必要提交接缝与Agent选择竞争，不在锁外跨await后靠一次旧selection准入。
- core/src/tool/plugin/task.ts：new/existing root新分支与普通child保留，Custom调用原startCustom。
- core/src/tool/plugin/share.ts：模型主动任意目标投递限Meta，可信actor与contentSource分开；用户手动/系统receipt不从该模型入口伪装。
- core/src/session/session-identity.ts：调用同能力条件投影。
- core/src/permission.ts：仅实际operation source读取与ask展示需要时修改。
- core/src/delegation/receipt.ts、service.ts、execution.ts、meta-agent/service.ts、workflow/execution.ts、session/verifier.ts、reference-checker.ts、doom-loop.ts：所有Permission.Source消费者检查variant；现Tool receipt/source关系不能被operation替换。
- database migration追加，schema.gen.ts/migration.gen.ts沿正式脚本；不得修改或重编号旧migration。

### 3.3 Server／Client

- server/src/handlers/session-instance-stubs.ts：identity从stub接SessionIdentityProjection；原requireSession路由Location检查保持。
- server/src/handlers/session.ts、routes.ts：只有本片新增合同需要的接线，现source/target认证与位置归属不可省。
- client/src/solid/data.ts：原Data内identity同步和selection失效；current SSE/Task operation同步与readback。
- client/script/build.ts及原generated reachability：使用canonical Schema；不导入Core runtime。
- 本片不写GUI按钮。MP03使用此capability，原Composer未提交selection与正式switchAgent由后继片处理。

## 4. 状态与提交次序

### 4.1 Operation基数与持久性

一个Task多operation；每operation固定input/target。追加followup使用新ID，旧正文/身份仍可读。单Task当前claim只指向一个在飞operation，释放claim不删历史。

Operation记录按sourceSessionID和operationID稳定判重，sourceTaskID为可选绑定，后续绑定Task不改变请求身份。无Task的new-root先保存reservation，Permission允许后才建立Task。已有Task才核revision并认领。记录保存source snapshot、requestDigest、inputID、target policy/identity、capture selection、permission来源、prepared input引用、phase、cancel intent和result/settlement引用。Task删除后的结果读取保留原授权/删除语义；索引与外键不得使删除Task级联抹掉审计记录。目标会话删除不伪造仍可读的全文。

已有在飞A时followup B先保存waiting和前驱ID，不取第二claim、不admit；A实际终态释放后B认领。该等待由原Task owner管理，不建立通用队列框架。

### 4.2 新入口次序

1. 解码、认证source访问，按operationID lookup，完整digest匹配后返回保存状态。重复返回不跑hooks、不再询问、不重新选择目标；改变请求typed conflict。
2. 对新请求核当前Meta能力；有Task时核其新revision与占用，在原Task锁内保存reservation/claim。锁内不等待Permission问询。
3. 锁外Permission.assert读取保存operation source；拒绝写终态并释放claim，目标/Inbox/provider均未发生。ask可显示准确来源；重复请求挂接原问询。
4. 允许后解析并冻结目标/prepare，按原Session create或Custom原采用提交。created/prepared属于原operation。
5. 同目标Inbox序列化边界准入固定inputID，同时推进admitted；同一提交边界裁决selection/cancel；仅resume不是false时advisory wake。MP01行为用admit-only路径证明创建/准入，实际结果/取消在MP02验证。
6. selection已变Build/Plan或cancel赢时不admit，保存准确blocked/cancelled。该条件在原AgentSelected/准入相容边界裁决，不能用陈旧读。
7. MP01不在目标已启动后用Session idle伪造receipt；相应终态字段只能由MP02输入membership和原结果producer填充。

### 4.3 兼容原child权限

原Task Tool child分支仍在Permission批准后创建Task/Delegation/child，旧拒绝keeper不改成允许创建。新operation/UI路径可以先保存未授权operation；如果沿原已有Task只认领它，拒绝后释放，不创建目标。模型调用不存在原Task时不能在原child path抢先落Task；new-root path的独立operation reservation与是否新增Task明确区分，不能用泛化helper把两路径写入顺序混成一个。

新增schema沿原包装暴露，原child、Workflow/Judge、external receipt继续Tool source和原效果；改source union后不能仅通过类型编译就宣布旧语义保持。

## 5. 验收owner与可执行命令

全命令在V2工作区，使用script/bun且一次一个包；工程验证由Root占用唯一串行槽，逐轮保存exit、tally和输入身份，真实模型请求预算为0。

| 合同                          | 原最强keeper／实施用例                                                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task claim首写/回滚/竞争/释放 | [session-task-service.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-task-service.test.ts:85)：anchors append claim、one competing source、only captured source/revision release、automatic edit/delete/reorder保护                                   |
| 原child权限拒绝               | [tool-task.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/tool-task.test.ts:1923)：asks before creating Task/Delegation/child；零模型                                                                                                                         |
| 原多轮child和旧result来源     | [tool-task.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/tool-task.test.ts:1908)、[tool-share.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/tool-share.test.ts:309)：旧完整result和exact retry不被later output替换                           |
| Meta-only share/API/root      | 扩core tool-share/tool-task/meta-agent-service与server session-task；Build/Plan/child/旧root不获权，Meta切换后的旧Tool snapshot执行被拒                                                                                                                                      |
| identity实际projection        | [session-identity.test.ts](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-identity.test.ts:218)：Layer.mock纯投影合同；真实selected Agent／owner、旧controller保留另由session-create.test.ts:1301/1348和Server原Location graph验证，Custom catalog沿原采用测试 |
| HTTP Location/auth/CAS        | [session-task.test.ts](/home/keer/workspace/aigcfroge-v2/packages/server/test/session-task.test.ts:530)和session-create；新增identity/operation调用真实generated client                                                                                                      |
| SSE公开消费                   | [session-task.test.ts](/home/keer/workspace/aigcfroge-v2/packages/server/test/session-task.test.ts:421)：persisted Task/runtime progress authenticated SSE；新增operation事件属于当前manifest                                                                                |
| Client迟到selected读取        | [solid-data.test.ts](/home/keer/workspace/aigcfroge-v2/packages/client/test/solid-data.test.ts:998)：held model/agent-family read；扩identity请求旧selection弃读                                                                                                             |
| Canonical编码                 | schema/session-task和session-identity tests、codegen/generate.test.ts；optional/brand/union/identity与current事件                                                                                                                                                            |

新domain行为不存在等价keeper时允许一个owning test文件，避免在各包复制同一业务判断。直接跑生产服务/真正SQLite与原Effect helper，不写test-only生产出口。

命令按文件限制，示例经当前manifest核对：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core test test/session-task-service.test.ts test/session-identity.test.ts test/tool-task.test.ts test/tool-share.test.ts --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core typecheck
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/schema test test/session-task.test.ts test/session-identity.test.ts --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/schema typecheck
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/server test test/session-task.test.ts test/session-create.test.ts --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/server typecheck
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/client generate
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/client test --conditions=browser test/solid-data.test.ts --timeout 30000
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/client typecheck
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/protocol typecheck
```

Core script/test.ts透传process.argv到隔离Bun test，保留包bunfig preload；不得裸root test。Client test默认5000ms，需使用其确切unit/browser条件，不拿SSR skip统计当浏览器通过。新operation/request测试case需注册实际测试名字和report，不靠help exit0计数。

生成后检查本片前后generated差异，与原WIP逐hunk区分；check:generated会改文件且在当前脏树可能包含历史diff。保留raw exit和差异归属，不能把历史diff被覆盖当零漂移。

## 6. 退出与交接

退出需要本片case report、source hash、类型和公开生成合同、真实HTTP/SSE消费与声明，且所有本片新增defined/provider/consumer齐全。

MP02交接列出：operation states、target/input/selection、原Permission来源、所有已保存/待准入边界、结果字段目前尚待实现的producer、前台/后台route、原claim与历史是否保留。尚无终答不得返回completed，不用技术债隐藏核心后续。

本任务单只准备执行，不是用户批准记录。完整方案与审批页在用户回应后更新实际授权时间和预算；本片开始前冻结新现场，若WIP/HEAD变化先重核影响，不重复询问已批准范围。
