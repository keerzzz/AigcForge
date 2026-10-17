# 智能体交互与 UI TDD 计划审批记录

> 日期：2026-09-30
>
> 审批对象：[TDD 实施方案 R2](/home/keer/workspace/aigcfroge/docs/plan/agent-interaction-ui-tdd-implementation.md)
>
> 状态：**APPROVED_FOR_SCOPED_IMPLEMENTATION**（限定技术审批通过；首次仅放行 B1，须先通过 S00 的执行门禁）

## 1. 审批范围与用户决定

本次是实施计划的技术审批，不是系统运行权限开关，也不是产品实现、测试通过或生产发布批准。

用户最新明确决定：**开发阶段不做旧客户端、旧服务端、旧数据格式的兼容代码；实施必须从真实仓库的本地 main 创建新分支。** 因此 R1 的保留旧流/旧SDK外观/旧格式默认补全/兼容窗口不再适用。本次被替代的路径应直接删除，当前仓库内生产者和消费者同批改齐。

同时必须区分：

- 当前仍活跃的默认运行时、Mode、CLI/TUI不是“旧版本客户”，不能按目录名删除。
- 不做旧数据格式兼容，不等于允许清空用户开发库、覆盖未提交改动或删除历史工作。
- 审查通过后，执行提示词只允许先完成 B1（S00+S01）；后续每批须用户转交本聊天复审并明确放行。

## 2. 使用的约束与证据

- [CLAUDE 第一性原理与改完即审](/home/keer/workspace/aigcfroge/CLAUDE.md:11)、[AGENTS](/home/keer/workspace/aigcfroge/AGENTS.md)、[架构](/home/keer/workspace/aigcfroge/ARCHITECTURE.md)、[DESIGN](/home/keer/workspace/aigcfroge/DESIGN.md)。
- [测试规范](/home/keer/workspace/aigcfroge/docs/testing.md:7)、[quality-to-pr 工作流](/home/keer/workspace/aigcfroge/.aigcfroge/skills/quality-to-pr/workflows/end-to-end-pr.md)。
- [M7/Todo-Task 方案](/home/keer/workspace/aigcfroge/docs/plan/todo-task-system-upgrade.md:407)、[ADR-22](/home/keer/workspace/aigcfroge/docs/architecture/adr/ADR-22-meta-agent-persistent-delegation.md)、[S9A 批准契约与未交付项](/home/keer/workspace/aigcfroge/docs/plan/s9a-work-review-lifecycle-contract.md:85)。
- 当前源码，而非旧方案中的“已落地”文字：Task facade/发布关系、Review纯规则、SessionInfo读取、Authorization与SessionLocation各自职责。
- 两个并行子智能体：一个独立检查真正的计划阻断；一个编写有边界的执行提示词。其输出由主审整合，不当作未经验证的自动批准。

没有声称调用未提供的专用 Bugbot/系统审批开关；这里采用项目协议审查和独立子智能体复核。

## 3. 主审发现与修订

以下是**方案缺口/冲突**，不是宣称现有产品已经存在可利用漏洞。

### A01 · [P1] 与用户单版本决定冲突

R1要求保留SessionTodo、旧投影、旧格式及旧版本互读，已不符合本次用户决定。

**修订**：R2 §0.3、§2.1、S01和X03明确Task单契约切换；取消在线`session_todo`/`todo.updated`、双源时间戳与picker保留要求；同步所有当前调用方，禁止alias/adapter/fallback作为退役借口。当前默认运行时须实测，不擅自整体删除。

决定关系的实际源码：[SessionTodo.update](/home/keer/workspace/aigcfroge/packages/core/src/session/todo.ts:92)、[publishBoth](/home/keer/workspace/aigcfroge/packages/core/src/session/task.ts:426)、[pickProgressTodos](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/timeline/session-todo-progress-model.ts:293)。它们证明原来为何有兼容路径，不是新范围中必须保留它们的理由。

### A02 · [P1] Review并发版本与对象身份不够收敛

R1将并发版本放到`metadata.workReviewVersion`旁路，且Review本体只有内容revision，不能完整表达“批准的是哪个artifact”。同内容hash的新产物不应被默认继承旧批准。

**修订**：直接升级唯一`WorkReview.Review`，新增必需`revision`和`artifactID`；不维护旁路版本字段，不补旧格式默认值。`isVerdictCurrent`同批成为比较artifact身份与内容revision的唯一关系函数。submit/re_review/reopen的绑定变化、其他动作的目标一致性、CAS和重放负例均落到S06-R13/R14。

依据：[现有Review schema](/home/keer/workspace/aigcfroge/packages/schema/src/work-review.ts:19)、[现有状态机](/home/keer/workspace/aigcfroge/packages/core/src/session/work-review.ts:59)、[现有有效性比较](/home/keer/workspace/aigcfroge/packages/core/src/session/work-review.ts:97)。新增字段/签名是获本轮技术审查的设计增量，不是当前已实现能力。

### A03 · [P1] 把Location路由和角色授权混称

R1写“Location/授权取中间件”以及reviewer actor，容易被实现者理解为现有SessionLocation已提供用户角色鉴权。

**修订**：R2 §3.3区分API认证、Session定位、artifact归属及内容版本；沿用当前Session管理API的操作者信任边界，不虚构reviewer RBAC或“只有人类可批准”。认证启用时必须有401负例；跨scope负例验证混用资源身份，不臆造不存在的ACL。

依据：[Authorization](/home/keer/workspace/aigcfroge/packages/server/src/middleware/authorization.ts:11)、[SessionLocationMiddleware](/home/keer/workspace/aigcfroge/packages/server/src/middleware/session-location.ts)。后者从Session表取得placement，不决定操作者角色。

### A04 · [P1] 产物并发写入与审批的故障语义不明确

单说“文件成功→写metadata”不能证明并发apply/approve不会得到互相矛盾的成功结果；文件系统与DB不是同一事务。

**修订**：S06-R16及§3.5要求在原FileMutation/WorkArtifact协调边界下验证目标一致性。两项无法同时完成时必须显式冲突或unavailable/stale，不能假装两个都成功且仍显示有效批准。不新造文件访问旁路，不自动回滚/删除用户文件。

依据：[WorkArtifact.apply](/home/keer/workspace/aigcfroge/packages/core/src/session/artifact.ts:101)。本轮补的是必须证明的实现约束，不预先声称并发已安全。

### A05 · [P2] “拒绝旧三字段”可能误伤规范创建

规范Task创建允许服务端生成ID。把所有三字段输入一概判为旧格式，会构造一个错误RED，迫使实现破坏合法创建。

**修订**：S01-R08只拒绝已退休的`todos`包装/端点及非法状态；规范创建仍可生成ID，规范更新使用稳定身份/并发规则。形状相似不等于兼容代码。

依据：[SessionTask.WriteInfo](/home/keer/workspace/aigcfroge/packages/core/src/session/task.ts:25)、[规范taskwrite](/home/keer/workspace/aigcfroge/packages/core/src/tool/taskwrite.ts:10)。

### A06 · [P2] 新读字段曾被写成“继续提供”

当前`fromRow`没有workReview读取。R1的措辞可能误导执行者只接UI、跳过真正的producer/mapper。

**修订**：R2明确为现有session.get**新增**可选workReview，并要求producer、持久化、当前读取路径、Schema/SDK同步验收。新API/identifier只作为设计值，须经生成和真实调用证明。

依据：[SessionInfo.fromRow](/home/keer/workspace/aigcfroge/packages/core/src/session/info.ts:20)。

### A07 · [P1] 独立复核：stale open 缺少恢复迁移

独立审查发现：submit(A)后编辑/覆写得到B，Review仍为open；旧绑定已过期，approve/request_changes不能合法使用B，原状态机又不允许open直接re_review或再次submit，可能永久卡在open。

**修订**：R2 §3.4明确增加既有re_review动作的stale open→open自转换，检查expectedReviewRevision、真实B及过期条件，重新绑定并增revision。新S06-R17覆盖submit(A)→apply(B)→re_review(B)→approve(B)、旧A拒绝和fresh-open拒绝。无第五态，不新增兼容分支；S9A必须同步该明确的设计增量。

关系依据仍是 [WorkReviewMachine.transition](/home/keer/workspace/aigcfroge/packages/core/src/session/work-review.ts:59)，不是UI按钮或变量名。

## 4. 独立复核

独立子智能体 Singer 对 R2 检查后提出 A07；主审补充受约束的 stale open → open 迁移与 S06-R17，再由同一审查者聚焦复核，结论为：**“原 stale-open 阻塞已关闭（实施计划层面），无该项残留阻断。”**

另一子智能体 Sartre 编写执行提示词并补充用户本地 main 分支约束；主审负责最终计划、提示词、源文件/基线与审批哈希的一致性。独立审查不等于已测试未来实现；分支与哈希核验由主审实际命令负责，不转嫁为子智能体背书。

主审结论：A01–A07 已在 R2 设计/测试要求中闭合，可按下列边界进入实施。任何未来代码审查/测试失败仍须返修，不能凭本文件自证产品通过。

## 5. 审批边界与执行放行

### 5.1 冻结审批对象与本地 main 起点

```text
status: APPROVED_FOR_SCOPED_IMPLEMENTATION
planVersion: R2
planSha256: 23ee8ddcc012a76fe72540ccbda0e5178cd2130c4e3c0db4daa8151dcee657c5
repositoryRoot: /home/keer/workspace/aigcfroge
mainRef: refs/heads/main
mainBaseCommit: 260e8275b9b0af9d0b445e5acfb6f4d3545eac7b
implementationBranch: agent-ui-tdd (new; existence must be checked)
firstAuthorizedBatch: B1 = S00 + S01
observedSourceHead: 5097f185ddb9bbbe6e09fb674e69f04dd9a22b4b
```

- 当前源目录分支 `local-cli-discovery` 只用于审查取证，不是实施父分支；历史 HEAD `e23b4561...` 也不是起点。使用本地 main 的冻结提交创建新分支，创建瞬间 HEAD 必须等于 mainBaseCommit，后续批次延续该分支。不得以 `origin/main`、当前 HEAD、另一副本或自动拉取的新提交替代。
- 当前源目录还有未跟踪文档/既有工作，不允许原地切换携带这些文件。实施使用遵守宿主工具规则的隔离工作树，或先请用户确认安全方式；原目录文件保持原样。获批文档可从源目录只读，不能把全部脏树复制为实施起点。
- 计划保持冻结；执行进度写独立账本。开工及每批核对 planSha256、mainBaseCommit、新分支与 ROOT；漂移或必须依赖当前分支未合并功能时，停止交回复核，不自改审批值。差分/lint 以冻结 mainBaseCommit 为基线。
- 基线静态核对：历史审计 39 个样本在当前源目录/外部参考中仍全部同哈希；其中 27 个已跟踪仓库样本在 main 上 26 个相同，唯一差异是 ARCHITECTURE 的 CLI SDK/discovery 段，已逐差分核对；另一个研究稿本为未跟踪文件，不在 main。额外核对计划以绝对路径引用的 33 个已存在 packages 文件，其内容均与 main 相同。**这只是明确范围内的静态一致性，不是全仓一致或 main 测试通过。** 未合并的 CLI discovery、SDK 生成物等差异不带入本实施分支；S00 必须在新 checkout 重跑当前家族基线。
- 本轮没有实际创建分支或工作树，也没有修改 main；本节批准的是未来实施流程。

### 5.2 批次和操作边界

- 放行对象是精确版本的计划，不是未知未来实现。计划实质变更须重新审查。
- 单版本直接升级不包含自动清库、丢弃脏改动、迁移其他业务或全仓legacy清理。
- 当前权限链、Task核心语义、Scope、Side Panel/Mode边界与V2 admission/runner不变量继续有效。
- 新Task契约必须先证明所有当前调用方可同批切换；需要扩到非目标runtime时交回，不用兼容桥凑GREEN。
- B4的Review数据/鉴权修改独立交回；B5的E4/环境或V2已有缺口不能靠skip、mock或自降范围放行。
- 执行者每批交证据后停止，不可自行批准后续批次，不主动给其他聊天发消息。
- Git提交、推送、PR及发布须另有用户明确授权；本轮没有授予。

## 6. 验证口径

本次运行的是文档/合同核对、现有引用/命令/行为ID/代码块校验及源文件哈希核对，不是新实现的RED/GREEN或E3/E4。

历史274项测试属于之前的旧合同基线；R2会主动移除/改写旧兼容用例，不能拿该数字证明新契约实现已经通过。

文档检查：S00–S09 共 10 张施工卡；63 个需求用例 ID，63 个唯一值；全部本地 Markdown 链接/引用行号、Bash 代码块语法与尾随空白经过校验。完整计数和哈希见 [审批校验数据](/home/keer/workspace/aigcfroge/docs/review/agent-interaction-ui-tdd-approval-evidence-2026-09-30.json)。拟新增路径只作为将来写集，不冒充当前文件；命令代码块仅做 `bash -n`，未执行未来测试。

主审运行了文档校验、`git rev-parse`、`git show`/差分和 SHA-256 核对；`git diff --exit-code HEAD --` 与 `git diff --check` 均退出 0。未跟踪文档另作链接/语法/空白验证，不把 tracked diff 的空白输出当成文档验证。未运行产品 RED/GREEN、包测试、E3/E4、生产 benchmark 或发布流程。

**复查结论**：影响仅本次研究/计划/审批/交接文档；命中协议路由、文档协作与 quality-to-pr 门禁。安全边界：没有数据删除、用户工作搬移、Git 提交/推送或服务操作；工程边界：技术计划有明确 owner、C/R/X、失败恢复和分批交回。剩余风险是未来实现/真实环境与既有运行时依赖，必须由对应批次实证关闭，不以“技术审批通过”替代。
