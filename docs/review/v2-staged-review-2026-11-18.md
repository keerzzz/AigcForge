# V2 暂存差分审查 · 2026-11-18

最新状态见[续验收报告](v2-acceptance-continued-2026-11-18.md)与[机器索引](v2-acceptance-continued-2026-11-18.json)：严格GUI lint为234文件0诊断，canonical check为24/24类型任务成功；新增4个确认修复与最终产物验收均通过。下文保留原612文件分流和各轮历史结果，旧187诊断与旧覆盖状态按当时读取。

SC03混合触发合同已按用户授权确定为cron优先，原Schedule keeper增量和类型/lint通过；当前77项信用及暂存身份见[更新收据](/home/keer/.codex/outputs/2026-11-18/v2-acceptance-continued/sc03/final-index-receipt.json)。下文的原差分与运行凭据保持历史时点。

SC02和Custom Group精确恢复请求已由原keeper、真实Runner请求对象和最终串行完整两文件185/0/1632闭合；当前77文件358块与暂存身份见[本轮收据](/home/keer/.codex/outputs/2026-11-18/v2-acceptance-continued/session-boundaries/final-index-receipt.json)。下文及SC03收据按历史时点保留。

原暂存的612个产品、测试、配置与文档文件已完成风险分流。确认的12个finding均已修复并按所述合同复验；严格 `lint:changed HEAD` 仍为exit 1、187条诊断／29个文件。审查建议为 **CONDITIONAL**：可审阅当前暂存补丁，严格门禁和登记的验收项仍需按原owner关闭。

## 结论与范围

| 修复前优先级 | 已修复并复验 |
| --- | ---: |
| P1 | 2 |
| P2 | 10 |

工作区 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`，HEAD `0a09f6bccdb71f1234eea759eb99e8a336d1d4da`。本轮没有新增提交。对照范围为原暂存差分相对HEAD及本轮修复增量；`origin/main` 已核对为 `d11d3c7c16f0bcf318a0197bfb647c3cf81b06fd`，浅克隆merge-base未取得，完整分支相对main的审查仍需另行绑定。原暂存tree `b0984199fec45942c22b2c8020d0d65a9c53c812`，证据整理后tree `97790e5b5b16853605646c30c98a1fbd5bd2fde8`。最终暂存tree、numstat、补丁与工件SHA由仓外 `final-index-receipt.json` 记录，避免索引嵌入自身哈希。

| 原分配范围 | 文件 | 审阅方式 |
| --- | ---: | --- |
| Frontend | 250 | changed hunks、owning contracts；Root接审20 tests/specs，7项unit/component差分、4项完整case、9项selected E2E合同 |
| Platform | 83 | owning boundary差分；大型generated采用正式canonical字节比较 |
| Session／Schema／AI／Protocol／Server | 261 | 182差分、2生成合同、77表层风险分流；6782 hunks全部分类 |
| Root文档 | 18 | 计划绑定；连同相关包文档共24文件、1493个本地链接目标核对 |
| 合计 | 612 | 文件完成分流不授予逐行全文审计或全套运行通过 |

## 确认finding与修复

### SR-01 · P2 · 已完成前轮与下一轮准入之间退出会搁置 active Goal

定位：[goal.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/goal.ts:1367)。状态：已修复并复验。

- **fact**：原Bus／SQLite恢复探针中，Goal仍active且未达条件，automaticState为completed、Inbox为空，recover未返回Session；人工advance立即准入下一轮。修后同探针返回该Session，保持1个pending输入、2轮且重复advance仅报告waiting。

- **hypothesis**：前轮完成事实持久化与runner下一次advance之间退出，使未完成Goal失去后继准入入口。

- **inference**：goal.ts:1367旧recover排除completed；restart.ts:215消费recover返回的parent，input-result.ts:138判定已完整结算的completed。修后进入原advance，保留准入锁、预算和去重裁决。

- **recommendation**：允许completed沿原recover→advance恢复后继轮次，其余条件和预算仍由原owner裁决。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/session-review.md)；逐项红绿工件与具体命令见机器索引。

### SR-02 · P1 · Retry hooks replacing decision are discarded by the prepared-request bridge

定位：[model-request.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/model-request.ts:466)。状态：已修复并复验。

- **fact**：retry hook以替换对象返回新decision；原bridge新增connection后复制事件，却未回写返回值。四个实际hook用例先红，修后原hooks17/0/111与原七文件508/0/3183通过。

- **hypothesis**：hook能修改替换事件，但runner持有原事件，导致决策丢失。

- **inference**：model-request.ts:466用产生该attempt的connection触发hook；runner/llm.ts:408仍调用原prepared.retry。两个对象之间仅需回写updated.decision。

- **recommendation**：只回写decision，保留producing connection和原fallback／retry预算。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/session-review.md)；逐项红绿工件与具体命令见机器索引。

### SR-03 · P1 · Synchronous Task self-target waits on an input that only its own blocked runner can promote

定位：[task.ts](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/task.ts:720)。状态：已修复并复验。

- **fact**：同步Task向当前existing_root准入queued输入后等待结果；原runner仍active而输入pending，无法idle。修后准入前拒绝同步自等待，原异步及admit-only场景通过。

- **hypothesis**：当前Tool等待queued输入执行，而该Session须先结束当前Tool才能提升输入，形成互等。

- **inference**：task.ts:721 guard与task.ts:763真实等待分支一致：background=true或resume=false直接返回admitted，其余同步等待Task operation。

- **recommendation**：只拒绝当前Session的同步自目标；保留异步自排队和admit-only。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/session-review.md)；逐项红绿工件与具体命令见机器索引。

### FR-01 · P2 · Btw 未限制 Chat 可用智能体

定位：[model.ts](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/btw/model.ts:330)。状态：已修复并复验。

- **fact**：Core 创建 Chat consultation；旧候选仅检查 role/hidden，实际 createBtw 三场景验证请求中的 agent。

- **hypothesis**：Custom-only 源智能体进入 Chat 候选，产生模式冲突。

- **inference**：可用关系由 Agent.ordinaryModes（core/src/agent.ts:150）和 createConsultation（core/src/session.ts:1686）共同决定。

- **recommendation**：复用 ordinaryModes 筛选 Chat 候选。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/frontend-review.md)；逐项红绿工件与具体命令见机器索引。

### FR-02 · P2 · Meta 两张表单用代理对象比较 owner 身份

定位：[meta-coordination.tsx](/home/keer/workspace/aigcfroge-v2/packages/gui-extensions/src/session-management/meta-coordination.tsx:160)。状态：已修复并复验。

- **fact**：createLatest 经 Solid createStore 返回结果；两张实际表单共六个 owner 比较在六场景内存组件回放中验证。

- **hypothesis**：代理包装使同一原始 owner 的严格相等失效，选项不能正确匹配。

- **inference**：包装由 sdk/reactive.ts:148 决定，生产表单用 unwrap 恢复用于身份比较的实体。

- **recommendation**：六处复用 unwrap；SDK 身份合同作为既有维护债保留。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/frontend-review.md)；逐项红绿工件与具体命令见机器索引。

### FR-03 · P2 · 暂离 catalog 的保存模型在模式切换后丢失标签

定位：[selection.tsx](/home/keer/workspace/aigcfroge-v2/packages/app/src/providers/models/selection.tsx:587)。状态：已修复并复验。

- **fact**：真实选择 provider 的 Build→Plan→Build 回放验证已保存模型标签。

- **hypothesis**：当前 catalog 无模型时重新构造 selection 会丢弃既有 modelLabel。

- **inference**：key.ts:33 sameKey 决定同一 provider/model 关系，selection.tsx 保留该关系下的保存标签。

- **recommendation**：复用 sameKey 下的 modelLabel。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/frontend-review.md)；逐项红绿工件与具体命令见机器索引。

### FR-04 · P2 · 直接模型与模型组 picker 键碰撞

定位：[select-dialog.tsx](/home/keer/workspace/aigcfroge-v2/packages/app/src/providers/models/select-dialog.tsx:51)。状态：已修复并复验。

- **fact**：provider=group、model ID为带引号的route、groupID=route 时，旧 production picker hover direct 后 Enter 选中了组；修后四项 E2E通过。

- **hypothesis**：直接模型编码和组编码进入同一候选键空间。

- **inference**：key.ts:39 selectionKey 用带 model/group 标签的 JSON 数组决定身份；picker 当前候选、组和直接模型须同用此编码。

- **recommendation**：四处复用现有 selectionKey；保留 production 碰撞 keeper。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/frontend-review.md)；逐项红绿工件与具体命令见机器索引。

### PR-01 · P2 · HTTP/SSE 水合按下标合并工具，丢失 B 并重复 C

定位：[data.ts](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:3783)。状态：已修复并复验。

- **fact**：HTTP [text,B,C] 与实时 [text,C] 原合并结果为 [text,C,C]；实际 Data keeper修后8/0/68，browser三文件197/0/1098。

- **hypothesis**：相同数组下标被当成工具身份。

- **inference**：mergeMessageSnapshot 决定合并关系；assistant.content 中的字符串 Tool ID 才能对齐 B/C。

- **recommendation**：仅在真实 assistant.content 按 Tool ID 对齐；metadata负控保持原数组合同。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/platform-review.md)；逐项红绿工件与具体命令见机器索引。

### PR-02 · P2 · TUI 明确 CLI variant 被保存偏好覆盖

定位：[local.tsx](/home/keer/workspace/aigcfroge-v2/packages/tui/src/context/local.tsx:280)。状态：已修复并复验。

- **fact**：合法 provider/chat#high 在原 LocalProvider 回放中丢失high，修后保留。

- **hypothesis**：preferredSelection 先消费保存偏好而未优先处理明确CLI variant。

- **inference**：local.tsx preferredSelection 决定variant优先级。

- **recommendation**：明确CLI variant优先；未指定时保留原规则。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/platform-review.md)；逐项红绿工件与具体命令见机器索引。

### PR-03 · P2 · TUI/ACP 普通 Agent 与 Executor 菜单缺少持久模式资格

定位：[config-option.ts](/home/keer/workspace/aigcfroge-v2/packages/cli/src/acp/config-option.ts:65)。状态：已修复并复验。

- **fact**：旧Coding/Work列表包含Custom-only authored；修后实际TUI/ACP回放按Session.mode与ordinaryModes过滤。

- **hypothesis**：role/hidden 过滤不能表示服务端模式资格。

- **inference**：core/src/agent.ts:150 决定可用关系；TUI与ACP消费者应读取持久ProductMode和原ordinaryModes。

- **recommendation**：沿现有菜单筛选读取服务端投影。Mini对应菜单仍待真实回放。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/platform-review.md)；逐项红绿工件与具体命令见机器索引。

### PR-04 · P2 · ACP 重建物理 defaultSelection 时丢弃 variant

定位：[catalog.ts](/home/keer/workspace/aigcfroge-v2/packages/cli/src/acp/catalog.ts:156)。状态：已修复并复验。

- **fact**：原有效defaultSelection包含物理variant，ACP重建投影遗漏该字段；config-option keeper修后21/0/79。

- **hypothesis**：用provider/model两字段重造选择导致物理variant丢失。

- **inference**：catalog.ts:156 原完整selection是默认物理选择的归属源。

- **recommendation**：保留有效默认selection的完整物理variant。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/platform-review.md)；逐项红绿工件与具体命令见机器索引。

### PR-05 · P2 · 正式 OpenAPI 漏 Model Group 路由

定位：[generate-openapi.ts](/home/keer/workspace/aigcfroge-v2/packages/protocol/script/generate-openapi.ts:14)。状态：已修复并复验。

- **fact**：原OpenAPI没有/api/model/group；保护WIP后正式生成及check:generated通过，canonical字节全等。

- **hypothesis**：已修改HttpApi源未被完整重新生成到OpenAPI产物。

- **inference**：generate-openapi.ts:14 精确比较产物与当前API生成结果，决定生成一致关系。

- **recommendation**：暂存正式生成的完整差额：新增路径、4个原路径、20个新schema与27个变化schema。

证据：[领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/platform-review.md)；逐项红绿工件与具体命令见机器索引。

## 夹具与生成合同

Core原七项native／opaque metadata用例已接回真实 `LLMClient → RequestExecutor → HttpClient.make → HttpClientResponse.fromWeb`，通过Schema/SSE传输；native checkpoint沿原Responses parser。HTTP observation由生产owner生成，未手写providerContext或deployment observation。Hosted孤儿工具重放真实 `boundary.durable.seq` 前缀，并在resume前断言仍running。AST逐项比较为原28断言、当前body30、删除／改写0，另七个共享transport断言。新增的session-wire为测试fixture，provider各wire grammar仍归AI原protocol keeper。

[独立Core复核](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/frontend-core-independent-review.md)与[独立AST比较](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/frontend-core-assertion-cross-check.json)保存生产observer及safe prefix证据。

Server旧Delegation fixture在Coding中创建用户agent，原12文件81/1；复用原builtin general后用例推进到purge，旧历史全等拒绝活跃assistant合法新增取消终态，定向0/1/50。原历史字段现在仍通过toMatchObject逐值核对，并新增唯一活跃assistant、cancelled／aborted／completed断言；定向1/0/56、最终12文件82/0/1645。授权、完整结果、重试attempt、关闭与purge的原断言保留。

TUI原fixture仅等首帧和textarea focus。等待实际selected model/provider/variant metadata后，精确Build/Plan2/0/8，原正常30文件494/2skip/0；原正常492/2skip/2timeout和isolate493/2skip/1timeout分开保留。Bun idleTimeout诊断没有与该失败的因果trace，未据此修改服务参数。两个原footer test.skip分别登记owner/unlock。

App Agent归一化、Session引用编码、CLI implicit effort label沿原映射更新fixture，保留variant、来源字段与wire Ref合同。安全空白修复41文件、42文件AST/词法/注释一致，另两处EOF空行清理不改变代码。Protocol生成差额按完整canonical产物记录，Client11个产物/manifests只读比较0差异。

## 验证与历史失败

所有产品测试从包目录、通过仓库script/bun运行；测试／构建槽串行、E2E workers=1/retries=0。具体完整命令、cwd、exit、tally、时间和源码身份见机器索引。

| 最终验证 | exit | 实际结果 | 工件 |
| --- | ---: | --- | --- |
| Core原七文件 | 0 | 508 pass / 0 fail / 3183 expects / 7文件 | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/core-session-keepers-wire-fixed.log) |
| Core transport七项 | 0 | 7 pass / 0 fail / 37 expects | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/core-session-wire-seven-fixed.log) |
| App全包unit | 0 | 814 pass / 0 fail / 2394 expects / 108文件 | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/app-unit-frozen.json) |
| App browser | 0 | 172 pass / 0 fail / 1827 expects / 38文件 | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/app-browser-frozen.json) |
| TUI原30文件 | 0 | 494 pass / 2 skip / 0 fail / 103752 expects | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/platform-tui-readiness-normal-final.log) |
| Server原12文件 | 0 | 82 pass / 0 fail / 1645 expects | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/server-staged-twelve-green.json) |
| App production E2E | 0 | 4 passed：SC07 legacy BTW、两持续侧root、MP03保存目标、model/group碰撞 | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/app-e2e-green.json) |
| App／E2E类型 | 0 | 各自exit0；App原类型收据另列机器索引 | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/app-e2e-types-frozen.json) |
| Client browser三文件 | 0 | 197 pass / 0 skip / 0 fail / 1098 expects | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/platform-client-browser-normalized.log) |
| CLI四文件 | 0 | 57 pass / 0 fail / 352 expects | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/platform-cli-final.log) |
| canonical check | 0 | 1346 warnings / 0 errors；类型24/24成功 | [收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/repository-check-final.json) |
| strict lint:changed HEAD | 1 | 187 diagnostics / 29 dirty / 227 GUI changed files | [失败收据](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/repository-lint-changed-final.json) |


App unit日志有ECONNRESET辅助输出，但runner exit0、0 fail。Btw三场景与Meta六场景为实际组件内存传输回放，production E2E为上表独立四项。重叠测试组不相加；本报告没有全仓测试全绿或代码覆盖率百分比的可执行工件。

桌面退出中断的check日志没有退出码与最终收据，保存在[中断记录](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/repository-check-interrupted.json)，不计成功。重启后599项冻结源码／依赖SHA相同，再运行canonical check得到上表结果。Core的前轮typecheck exit来自exec完成结果及领域记账；最终canonical类型收据再次覆盖冻结源码。

历史失败完整保留：模型picker第一轮case在候选不可见阶段失败，属于fixture诊断；正式有效红证为hover direct后Enter误选组。Core最初native／metadata失败和早期typecheck错误保留；最终prefix已用真实Tool.Called边界与running断言复验。Server与TUI各轮红绿按命令独立记账。

## 影响面与历史上下文

引用清点由[原始rg清单](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/final-reference-inventory.json)生成：mergeMessageSnapshot在Client1文件2匹配行；selectionKey在App4文件9匹配行；assertOrdinaryMode在Core5文件10匹配行；goals.recover在restart1匹配行；dispatchTask在2文件2匹配行。计数包含声明或词法使用，语义调用者总数未验证。关键关系由各finding列出的比较／准入／等待函数决定。

大型差异采用SURGICAL策略，优先准入、权限、重试、恢复、生成和身份。CodeGraph在显式V2工作区未初始化，已降级为rg、精确源码与暂存diff；未使用默认工作区索引代替。原Git历史与各领域变更记录保存在领域报告；本轮没有新commit timeline。全分支main merge-base尚未绑定。

## 未闭环项与后续执行

严格lint的187条是诊断数，不能写成确认运行缺陷数。原187条合同分流为91开放JSON、42owner类型复用、14断言合同、40风格；仅在本轮数量仍187时沿该分流，具体条目见[合同分流](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/frontend-lint-contract-triage.json)。根普通lint的warn-level退出规则与strict门禁规则不同，strict由script/lint-changed.ts:29–43判定。

唯一状态由[技术债账本](../technical-debt.md)持有，逐项owner/unlock和原事实在[机器索引](v2-staged-review-index-2026-11-18.json)：简体27／繁体66新键English fallback；SDK owner代理身份合同；Skill候选键、跨chip选区、隐藏target额外请求、旧历史physical model fallback四个待红证候选；完整组件／几何／性能回放；HTTP text snapshot watermark；Mini持久mode菜单；两footer skip；SC-02锁与取消、SC-03初次dueAt合同、SC-04删除洞排序候选；VG-03旧库／全HTTP／Schema；77文件逐断言深审；两条失效/tmp证据。SC-05 OpenAPI已由正式生成闭环，未作为开放候选登记。

先清偿已知严格门禁条目，再按原keeper推进已登记运行候选；确认运行症状前不增加推测式生产防御。真实模型／隔离桌面最终链仍归原AC36／PMF-ACCEPT用户暂停状态，等待解除与有限预算；本轮真实provider请求0。

## 方法、技术债与交付身份

本轮按fact／hypothesis／inference／recommendation分层，复杂修复以实际红证、原owner裁决、最小增量和外部工件闭环。对简单低风险空白修改压缩假设识别／本源／方案三步：风险依据是AST、token和注释一致；验证不省略。

方案对冲：简单方案复用advance、decision字段、现有key编码、Tool ID和原fixture；通用恢复协调器、全JSON合并框架、统一provider模拟层会增加当前无第二个已运行用例的抽象。本轮选择简单方案；保留text snapshot排序水位、SDK身份合同和generic SSE fixture的真实技术债，由原owner与解除条件控制。

按用户批准从PR暂存移除13048个历史证据文件，共1594102186字节；本地原文件与完整tar.gz保留，逐文件缺失／SHA差异0。压缩档585173652字节，SHA256 `d5a19988bcae287d3e4c37c20f9ac0dbc57a1877f37a5b5b7ad4dcc7500ec13c`。路径／原字节SHA在[证据索引](v2-staged-evidence-index-2026-11-18.json)，[备份校验](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/evidence-archive-verification.json)保存外部档案身份。

新增本轮报告／机器索引、证据索引与Core fixture，修复按显式NUL pathspec暂存；最终暂存/工作树diff check和HEAD身份在final-index-receipt.json。默认工作区原有修改保持；现用App／服务／预览保持。本轮未提交、推送或创建PR。

## 附录

[Frontend完整领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/frontend-review.md) · [Platform完整领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/platform-review.md) · [Session完整领域报告](/home/keer/.codex/outputs/2026-11-18/v2-pr-review/session-review.md) · [文件清单、事实、命令与缺口](v2-staged-review-index-2026-11-18.json)。
