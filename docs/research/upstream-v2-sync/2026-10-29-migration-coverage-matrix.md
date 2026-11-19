# 默认新增能力与 V2 承载调查矩阵

2026-11-03 §53 MC03离线续进与DeepSeek再次暂停：已接受的MC01、MC02与MC03子范围保持。取消见证复用四个既有runner用例，删除过时Permission替身后4/0、17断言；完整runner回归263/0、1335断言，Core类型/格式/lint/diff通过。publication/readiness新候选只完成离线准备，未派发模型。原来源/目录场景v7沿原Writer User显式resume再次上游503，实际累计5/8（Source2＋Writer3），旧失败和请求不重置。本轮暂停后新增API请求0；等待用户允许恢复与具体任务/预算重新绑定，不自动探活或重试。完整MC03仍开放，MC04a不放行，原owner/unlock及S1保持。

日期：2026-10-29。状态：**Git 历史与代表实现取证版；完整范围、Meta 优化与迁移路线尚未闭环。** 本文件是[唯一总计划](2026-10-25-v2-alignment-execution-plan.md)的调查附件，不是第二实施计划、账本或生产开工令。总计划顶部的暂停门禁继续有效；[批次计划](2026-10-29-migration-batch-plans.md)及[提示词](2026-10-29-migration-session-prompts.md)的最近架构补充仍待复审。

## 1. 目标与来源边界

- Meta沿用V2 Agent底座，选中时负责统筹，全部内容与能力保留；Build/Plan/Meta正常并列，默认按既有default_agent解析，普通根无需Meta关联。
- V2架构是电路板，Chat资产是可插拔元件，新Custom装配智能体/脚手架。默认旧Custom不作为新设计参考；历史代码族可识别，但不复刻其产品规则。排除旧Custom不等于删除Meta、其它功能或用户数据。
- 保留五模式、Creator审阅确认后版本化保存/显式采用、零用户库存Chat/Custom有明确基础能力；损坏已选依赖不静默fallback。这里只记录用户目标，不能宣称这些已在V2实现。
- 默认参考：`main@edbe67383d830aa40269ddf453c7f5617c940b46` 与当前相关WIP。目标：`v2-dev@9e2c6577ef6dd65c8f01ff94d46da0142bcb877c` 与既有WIP。固定OpenCode V2基准 `4617210822bdbb31e5749751afbfb4584ccedac8` 不变。
- Git核对：HEAD可达1333提交、first-parent210；初始裁剪导入为`c51269f7e7`（2026-06-25）。虽然仓库整体为浅克隆，HEAD可达提交没有shallow marker，主线自该初始导入至今可见；导入前来历不由这份历史还原。现代本地upstream refs没有可见merge-base，不能直接用它们推断所有自研增量。
- 初始导入5226个路径；与HEAD比较的5269个变化路径包含改名、裁剪、文档/测试、生成和依赖，不是5269个功能。当前名称不存在于初始树不证明当时没有对应旧名能力。
- 本地缓存origin/main额外两提交为`03e8fcb431`（v0.0.8版本更新）和`d11d3c7c16`（合并）；不纳入本次工作树参考，未fetch，不代表远端实时状态。

Git操作均只读；代表SHA/日期来自实际命令及历史调查，部分代表diff/源码由主会话再次核对。以下不是手写的完整提交清单，也不是全仓逐行审计。

## 2. 功能族目录与现状

每族可能包含多项独立能力；18行不等于18个功能。HEAD接线/默认条件是静态源码事实，历史测试和本轮运行验收分开。V2“已核”限已读生产边界，“待核”不能当作缺失或完成。

| 功能族                              | 代表历史来源（2026年）与默认实现                                                                                                           | HEAD接线/启用条件                                                                                            | V2承载与未核范围                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Meta分析/路由/协议卡                | `f1b35110e8` 06-30；`aigcfroge/src/tool/delegation-protocol.ts`、Agent/protocol cards、Core PROMPT_META                                    | 协议工具在入口registry真实构造注册；Meta指令含分析未知、分类、路由、约束提取、委派与综合；不是只有intent正则 | 已核Meta短模板/注册/模型消费；内置协议工具/卡片与完整行为文本未完整承载；历史采样：默认Agent选择不保证Meta；按最新裁决保留，不作为缺口     |
| Meta持久身份/项目记忆               | `2406d7f830` 08-09；`core/src/meta-agent/`、`core/src/agent/meta/memory.ts`                                                                | 身份/Session关联/step/事实工具有owner；record要求附着Meta，自动memory注入另有opt-in                          | 已核服务与工具存在，未找到create/attach/writeStep的生产调用；默认Meta权限隐藏memory工具，当前Instructions没有接入旧memory源                |
| Meta纠错/引用/验证/doom loop        | `00464481e7` 08-10；`core/src/session/{correction-store,correction-extractor,verifier,verification-router,reference-checker,doom-loop}.ts` | Location提供，V2 runner真消费纠错/工具前后检查；Verifier有意图/工具/包路径条件；升级单独默认关闭             | 已核文件存在但未接入已读根层/runner/工具链；当前内置Instructions仅日期/环境；不能标为功能已迁移                                            |
| Meta持久委派/审查/恢复/Judge        | `3bc6d6a45b` 09-09；`core/src/delegation/`、`session/task-driver-fill.ts`、Judge                                                           | 多参与者、Turn/投递、revision/review、通知与恢复；持久委派/恢复flags默认关闭，Judge为显式执行类型            | 内部Delegation/task→child Session→inbox/wake/结果已有实线，依retained Bus；external-cli/judge/attended明确拒绝；review写入生产者未完整核到 |
| Chat七资产/提案/编辑导入/删除       | `fd14ad437e` 07-28；`core/src/import-parser.ts`、七族Schema/owner、App工作台/右栏                                                          | prompt/skill/mcp/command/agent/workflow/plugin，ChatAsset默认开启；后续有去重/删除/冲突修复                  | 有若干历史后端/GUI子链；完整管理入口、placement、普通消费、编辑导入/引用删除与旧数据须逐类核验，不用保存成功代替安装/执行                  |
| Work交付物与Review                  | `173eddb4f3` 10-07；`core/src/session/work-review-service.ts`                                                                              | durable状态/读回、artifact身份与内容版本、CAS、生命周期/UI；不是早期纯状态机                                 | 目标仍有work-artifact占位边界；完整WorkReview生产者/消费者与对等行为待核                                                                   |
| Task/Workflow/Agent Hub             | `94dc624b6f` 08-20；`core/src/workflow/workflow-runner.ts`、Task/Hub                                                                       | 分支/跳过/重试/取消/恢复有实现；Task与决策/进度后续统一                                                      | Task面板→Client Data→HTTP有实线；Workflow HTTP限当前Custom根/冻结workflow/retained事件，工具与专属GUI未齐；Agent Hub list仍not_implemented |
| Assistant个人记忆/Notes/知识库      | `facab763d2`、`d3568b7804` 08-12；`core/src/session/{personal-memory,kb-service}.ts`                                                       | confirm-first记忆、wikilinks、FTS5、反链/悬空检测、目录同步、API与面板；个人与Meta记忆不合并                 | 全部生命周期对等与真实用户消费待核；不能把Assistant替换为剪贴板页或仅Meta memory                                                           |
| Assistant提醒/调度/投递             | `4f8632bb9b` 08-12；`core/src/session/schedule-service.ts`                                                                                 | HTTP根真装配Schedule/Delivery daemon；含到期、租约、事务投递、重试/离线补投/Inbox，非仅测试                  | 完整默认时区、到期执行、取消/已读/恢复与跨位置消费待核；Work Task调度不是同一业务                                                          |
| Home/模式导航/身份/作用域/状态栏    | `2b226155dc` 09-14及后续路由/隔离演进；`core/src/session/session-identity.ts`、App                                                         | server/directory/mode/Draft/Session来源、只读身份投影/API/UI；已有独立Home及模式工作台                       | Home筛选/普通create已有局部交付；完整模式工作台/全局入口/状态栏仍未闭环，成本leaf/family及连接来源不能直接替换                             |
| 权限/审批/Scoped Grant/Break-glass  | `c4973fa2ff` 08-16；`core/src/permission/effective.ts`                                                                                     | V1/V2共享有效权限owner；档位/值守/拒绝/临时授权/谱系保护有产品增量；不能只保留selector                       | V2基准与部分权限修复已核；完整展示、租约回收、已决允许差异与执行权限对等仍待逐链验证                                                       |
| Coding工具与安全增量                | 路径边界/符号链接、FileMutation、grep/glob约束、Unicode恢复等多轮修复                                                                      | 既有工具上的安全/正确性增量；另有凭据扫描、输出转义、doom loop等                                             | 逐工具/文件/命令/模型输出边界待核；不把已存在上游能力重复实现，也不只搬新文件                                                              |
| 图表/HTML交付物渲染                 | `08956408b0` 08-07、`b718587666` 08-08；`session-ui/src/components/`                                                                       | Mermaid→sanitized SVG；HTML iframe/srcdoc、sandbox/CSP/库内联，后续主题/高度/候选持久链                      | 渲染/候选/存储/权限/主题的V2对等待核；不能遗漏这类不在七资产名称中的能力                                                                   |
| LLM/模型/协议/流式错误              | `d0adc5e63e` 10-12及deadline/endpoint发现演进；`llm/src/protocols/`                                                                        | AI SDK默认，原生LLM opt-in；包括不完整EOF、模型能力、分页/额度/重试、协议与方言                              | 按V2 AI/Model/Provider逐能力映射；原生/SDK路径与当前接口语义不同，不能把整个旧LLM栈照搬或直接删能力                                        |
| 桌面/服务/打包/发布/更新            | `d9d6ea28b9` 09-27及签名/sidecar生命周期演进；`script/src/release.ts`、Desktop                                                             | 生产发布/unsigned显式许可及跨端生命周期规则存在；不表示本轮已运行发布或安装验收                              | V2自有bundled CLI/managed service闭包保留；最终同源产物、平台、更新与旧库迁移尚待验，不恢复旧sidecar架构                                   |
| 内部分享/同步/SSE                   | `37bbb0b692` 07-08及后续SSE旧请求取消；`core/src/session/share-v2.ts`                                                                      | reference/output/full、上下文投递/恢复与EventV2/SSE消费；不等同旧公网分享                                    | 跨Session工具有子范围；分享链接授权撤销、摘要、sync/control等完整消费者仍待核                                                              |
| 外部CLI/SDK/ACP/app-server          | `813b229fb8`、`5b7f89d6ff` 08-06及惰性resume修复；`core/src/tool/cli-adapter.ts`                                                           | 多transport/恢复ID、真实可选control、配置与权限边界；不能宣称全部CLI具有同等控制或callback                   | task入口仍明确拒绝external-cli；实际接入、续接、权限callback、review/revision与恢复是Meta能力保留矩阵的缺口                                |
| 插件/Meta与Tool Hooks/缓存诊断/品牌 | Meta/Tool Hooks、cache-shape与scheme04品牌分多轮新增                                                                                       | 扩展接口与部分tool生命周期真消费；intent/adapter扩展不能因接口存在就称完整；品牌派生物不重复计功能           | 生命周期/扩展/诊断及品牌与GUI接缝对等待核，不为统一概念造AgentNode/第二bus                                                                 |

路径表内省略 `packages/`；默认/V2上下文分别注明。表格是有证据的功能族索引，尚非每个离散功能/字段/测试都已覆盖的完整矩阵。

## 3. 当前 HEAD 启用边界

已对照默认源码，不使用历史“默认已翻转”的叙述：

- `aigcfroge/src/effect/app-runtime.ts:95`：`AIGCFROGE_V2_RUNTIME` 只在env为true时开启，默认false。
- `core/src/product-mode-policy.ts:102`：Assistant/旧Custom强制选择V2，其它随全局flag；旧Custom自身另有默认关闭的kill switch。这里只说明当前源事实，不沿用旧Custom目标。
- `aigcfroge/src/effect/runtime-flags.ts:44-64`：持久委派、委派恢复、原生LLM默认关闭；Chat资产默认开启，显式配置可关闭。
- `core/src/session/verifier.ts:99-105`：Verifier默认开启，但仅code_modification、指定mutating工具和可识别package路径触发；`verification-router.ts:7`升级默认关闭。
- `aigcfroge/src/server/routes/instance/httpapi/server.ts:348-359`：ScheduledJob/Assistant Schedule/Delivery daemon、PersonalMemory与KB启动服务真实装配；装配存在不证明所有到期/故障场景通过。

“全部内容保留”不等于强制全部功能默认开；功能存在、生产接线、启用策略、历史通过与本轮验收必须分栏。

## 4. 当前 WIP：不属于上述已提交历史

已读相关diff和未跟踪测试，未运行：

- `app/src/app.tsx`：ServerShell不再另建QueryProvider，让Sync与路由消费者共享基础QueryClient。
- `app/src/context/server-sync.tsx`：迟到root列表不抹掉请求开始后新创建/采用的root；仍尊重删除/归档和下一次权威快照，保留mode merge/子Session/缓存清理合同。
- `app/src/components/session/session-identity-query.test.tsx`：取消/刷新、迟到响应、同ID跨server隔离、弃用target、失败与Suspense/周边UI连续性。
- `app/e2e/regression/route-suspense-stability.spec.ts`：真实浏览器SSE/首发读回、resolved节点连续性与迟到root快照；用受控后端数据，不是live Core/模型证明。文件明确当前Coding/Work部署默认legacy，不能把其message.part合同搬为V2当前合同。
- 其它fixture/model形状、coverage manifest与debt新增条目为相应测试/证据范围，不合并成已验收功能；无关数据文件未读取。

## 5. 退役、改名与基线噪音

- `9e655cee38` 删除旧cache-warmth与Meta pipeline/fanout；不得作为还需搬回的功能实现。新的durable Workflow独立核对用户目标。
- `b410869a91` 裁剪旧云/web/独立CLI等产品面；V2桌面依赖闭包与独立发布形态分开，不以旧删除记录授权删V2必需CLI。
- opencode→aigcfroge等改名、upstream provider port、文档/依赖/生成不按文件数算新功能；真实行为修复即使触及generated，也不能简单滤掉。
- 已删除权限selector不等于删除有效权限能力；旧Custom不再作为新产品参考不等于可以purge历史数据。

## 6. 为什么路线仍未闭环

现有批次只是骨架，Meta职责/全量保留和优化应作为前置，不应等到后段才核对。以下仍未完成：

1. 将各族拆为离散用户能力，逐项给默认源码身份、决定函数/生产者/消费者、持久数据、权限、取消/重试/恢复和现有测试；未读边界须显式登记。
2. Meta完整统筹流程分别核普通问答、资产生产/采用、内部Build＋外部review；区分现有正确能力、重复/缺陷、默认策略与未接线。
3. 审查Meta路由/协议/权限、项目memory/纠错/验证、长期多参与者/审查与恢复的优化取舍；内容保留不等于复制全部旧实现缺陷。
4. 新Custom从V2电路板＋Chat元件目标设计基础组合/接口/版本/显式采用/错误边界，不参考默认旧Custom。
5. 为每条拟实施用户链给V2 owner、允许差异/未决裁决、具体文件/任务提示词、单一实施者/资源槽和真实桌面/数据验收；只有完成这些才可修订顺序、解除对应暂停门禁。

功能状态只归[唯一账本](../../technical-debt.md)。本矩阵中的研究族和待查描述不自动创建/关闭功能ID，也不把未知归为缺失。本文不承诺全部源码已理解、不作为发布验收；本轮没有产品测试、生成、构建、模型/服务、commit/push或远程操作。

2026-10-31补充澄清：“CPU”仅为说明Meta统筹职责的架构比喻，不是产品术语或实现类别。UI只显示智能体/模型/Meta，代码与注释使用Agent、Meta、Session、Delegation等真实领域名称；不得据比喻新增CPU类型、字段、执行规则或模型入口。文中历史CPU用语仅解释旧讨论，不构成当前命名指令。

2026-11-03 §50项目memory来源与有效目录工程有限接受：新record允许同项目可核实来源Session，包括另一Meta；提供SourceStep时核真实running/completed发生的事件或准确Started Assistant origin投影，缺证据的新引用拒绝，旧历史保留。来源Step用其历史provenance/meta/root及关联证明，不以来源Session当前controller重新判归属；step-only仅内部核Session，省略的source_session_id仍存NULL。无controller的A/B多关联writer拒绝这次新写入，已有显式Meta选择可恢复确定归属，旧事实与关联保持。record仍为原事务；Permission/MemoryTool/Bus/查询删除与注册机制保持。SessionContext.select一次捕获现有effectiveRules供工具、registered Skill、MCP视图与Meta目录消费，冻结成员与child/parent限制保持；定义cards不作为权限授予。目录新keeper1/0/13、整文件26/0/273；memory整文件17/0/93、integration整文件19/0/191，最后品牌/绑定修正定向2/0/23，分轮记账。Core类型、最终格式/lint/AST与精确diff检查actual0；新源码静态独审12/0不合并为测试数，integration独审单记。目录两轮RED、来源RED0/2/3、首轮类型actual2、格式actual1和ASTactual1均保留；AST runtime resolver fallback警告保留。本轮真实模型与Source/Electron启动均0；私有同Source public-resume宿主仅完成最小finalizer顺序修复、syntax/helper类型actual0与独审，不取得真实压缩、重开、resume、退出或来源消费信用。完整MC03仍开放，MC04a不放行，MC06/B04/S1和原owner/unlock保持。

工程身份与接受：[目录接受](/home/keer/.codex/outputs/2026-11-03/mc03-effective-directory-v1/root-engineering-acceptance-v1.json)、[来源接受](/home/keer/.codex/outputs/2026-11-03/mc03-record-origin-implementation-v1/root-engineering-acceptance-v1.json)。原执行收据保留在 `/home/keer/.codex/outputs/2026-11-03/mc03-cold-trigger-recovery-v1`；实际最终源码各自pin/snapshot/delta固定，Git stage/commit/branch与默认工作区写入0。

2026-11-03 §51原P1冷压缩项目memory实际消费者有限接受：原Work/Meta真实record2次、manual compaction1次后，同DB inode与同Session闲置重开；旧37条事件、原User及memory保留，新权限事件单列。原轮因harness全事件相等断言过界在outcome失败exit1，自有清理完成；同原库与共享账本续接两个未消费host operations，禁止重放record/compact，不补新User。safe修改仅声明的私有fact fixture与time_updated，当前memory_search ask经新once204后把精确revision与普通Synthetic/user数据送入一个primary请求，模型输出MEMORY_DATA_OK teal；unsafe公共fixture另经新ask/once204后在新LLM前InvalidFactError，新增physical/Step/User/capsule均0，安全历史保留，终态idle failed与真实execution.failed同id/error关联。实际物理4/8（2 primary record＋1 compaction＋1 safe primary）均HTTP200/high/enabled，无人工token上限或generic重试；原3不重置，续接新增1、unsafe0。同Source facade的两次私有声明resume共用唯一Context/Scope，模型窗无原type=user，triggerMetadata指原真实UserID，20个canonical live tails分别为空，continuation controller/runner/gateway/Electron实际0且端口free；Source均结束但数字exit仍unknown。首轮Root verifier27/2 actual1保留；只读补证v2核原历史前缀＋新增准确权限/typed idle，30/0 actual0，未新增模型或SQL写入；结果独审不合并为测试数。仅本原P1消费者由Root接受，不给Source数字exit、在飞崩溃、全部来源/默认目录真实消费、完整隐私/UI/模式/计费信用。完整MC03保持开放，MC04a不放行；后继限原来源/有效目录消费者与原取消/Bus publication/public resume余项，MC06/B04/S1及原owner/unlock保持。

本片身份与接受：[原生接受](/home/keer/.codex/outputs/2026-11-03/mc03-cold-memory-continuation-provider-route-v1-ee623d6f52a14bf0/root-native-acceptance-v1.json)、[结果独审](/home/keer/.codex/outputs/2026-11-03/mc03-cold-memory-continuation-provider-route-v1-ee623d6f52a14bf0/native-result-review-v1.json)、[最终核验](/home/keer/.codex/outputs/2026-11-03/mc03-cold-memory-continuation-provider-route-v1-ee623d6f52a14bf0/continuation-result-verification-v2.json)。原失败及请求账本均保持，所属资源已关闭；七文档同步不启动模型/服务或Git操作。

2026-11-03 §52原MC03零模型进度：受控readiness keeper使用实际SessionStep/Bus/SessionProjector/DB和Deferred信号，在pending Snapshot期间interrupt/join，late release不生成完成事件；正常对照仅一次Completed，投影完成id/seq与回调一致。最终1 pass/0 fail/5 filtered/23 expects、actual exit0，Core类型、格式、lint与diff通过；首轮缺cost.cache失败保留。仅新增既有session-step.test.ts一个keeper，无本轮生产修改、新registry或模型循环。见[keeper接受](/home/keer/.codex/outputs/2026-11-03/mc03-readiness-root-v2/root-engineering-acceptance-v1.json)。私有publication/readiness宿主改为在声明resume时取current Location Snapshot，并捕获实际Source Scope供既有FiberSet runtime；首次缺Scope的type exit2/TS2345与后继exit0分开保留，独审及[工程准备接受](/home/keer/.codex/outputs/2026-11-03/mc03-publication-readiness-source-root-v3/root-engineering-preparation-acceptance-v1.json)不取得真实publication/public resume/cancellation信用。

原来源/有效目录场景仍用同DB、同Source/Writer及原账本：旧Source slot1取消保留；无startup sweep的显式Source resume产生slot2 complete200/high，真实User、Started/Ended/Completed和meta_step owner/root/provenance准确关联，Source tails为空，仅[正常Source子范围接受](/home/keer/.codex/outputs/2026-11-03/mc03-source-directory-continuation-root-v5/root-source-native-acceptance-v1.json)。无证据legacy row只作负面夹具，不取得来源信用。v3/v4在模型前的断言失败新增请求0；决定函数BrowserConnection.grant/release（packages/plugin-browser/src/connection.ts:30）解释Native临时browser/\*/allow，权限匹配由PermissionEffective.evaluate（packages/core/src/permission/effective.ts:36）决定，精确browser action不匹配memory；原raw deny→effective ask及三owning once门禁保持。v5首次Writer Native ACK200，但编辑器填入文本仅丢一个换行，harness精确文本期望失败；旧memory_record在未答复ask后取消，memory0，slot3虽complete200仍不接受工具。v6保留完整旧User/eventprefix，以明确的新Native单行输入重验，释放前新id/正文/hash均核对；ACK200与slot4上游503分别记录，provider.internal、idle failed、claim清空、工具/新ask/once/记忆新增均0。全场景实际4/8（Source2＋Writer2），v5/v6 command/controller/runner exit1保留，取消不退款、无generic retry或人工token限制。见[provider暂停结算](/home/keer/.codex/outputs/2026-11-03/mc03-source-directory-continuation-root-v6/root-provider-pause-disposition-v1.json)。用户明确暂停DeepSeek后Root关闭自有网关，final close成功：Electron0、gateway0、Source进程结束但数字exit仍unknown，三端口free；不以HTTP200/目录暴露/空Assistant代替真实工具消费。

未完成项继续登记原MC03 owner：来源/有效目录的新三次调用与owning ask/once204、step_unverified、成功record/search模型消费，以及真实checkpoint publication失败→public resume与pending readiness取消/正常尾项。用户暂停真实模型期间只做零模型工程/文档核对；解除条件为用户允许恢复模型验收、路由可用且具体有限任务重新绑定/复审，不自动重试、重置账本或重播已接受TTL/CRUD/P1。原Inbox publication失败、Location decline、并行Session及必要恢复仍按§46与债务账本逐项核证，不能用checkpoint切口覆盖。CLI执行归MC06、全模式执行绑定归B04，个人Inspector/UI/整体在飞恢复保留原B08/MC09/MC10 owner/unlock，S1归属不转移。MC03Complete=false、MC04aUnlocked=false；默认工作区只读、Git写未授权，旧WIP/历史失败均保留。

2026-11-03 §53原MC03离线续进：三个partial text/reasoning/tool-input取消用例及blocked-local-tool用例，复用实际消费/工具开始信号，补原始session.step.completed.1缺失与Assistant completion引用缺失断言，blocked工具投影重放后仍无完成引用。首轮4个用例共享30秒超时（0 pass/4 fail/259 filtered、零断言、约121秒）保留；仓外诊断首次import解析失败也保留。实际fixture的signal与drain Exit竞争定位到Permission.effectiveRules的UnimplementedError，发生在SessionContext.select（packages/core/src/session/context.ts:235）。删除仅本runner fixture的过时Permission mock replacement，复用真实Permission.node与Permission.effectiveRules→PermissionEffective.effectiveV2/childRules（packages/core/src/permission.ts:194、232），共享test/lib/permission.ts不变，不复制权限算法。最终focused4 pass/0 fail/259 filtered/17 expects，整套runner263 pass/0 fail/1335 expects；两者重叠，不相加。Core typecheck、格式、lint、diff actual exit0，只有session-runner.test.ts断言/fixture变更，无新增永久用例或生产代码。见[离线工程接受](/home/keer/.codex/outputs/2026-11-03/mc03-offline-cancel-witness-v1/root-engineering-acceptance-v1.json)。仓外诊断不是产品测试，不增加测试数。

publication/readiness fresh single-Root候选v4沿既有Native生命周期与已接受Source Scope/current Location Snapshot宿主准备；独立有限账本maximum3，publication失败前0请求、checkpoint resume1、pending取消1、正常resume1，当前providerValidationAllowed=false且无Root dispatch。观察器复用实际renderFacts逐行JSON格式，核普通user role及精确事实、ticket/forward身份；实际producer源码片段与实际observer callback的有限离线兼容检查4/0，syntax/AST/controller收包preflight13/0，均不等于Native验收。失败checkpoint消息身份由SessionMessageUpdater的SessionMessage.ID.fromEvent决定（packages/core/src/session/message-updater.ts:169），回滚seq可由后继Execution.Failed的合法Idle复用，按event/message身份核缺失而不排除整个seq。checkpoint投影核id/seq/完整text/metadata/origin；pending无新事实仍允许合法空receipt（packages/core/src/session/correction-store.ts:709），取消/恢复比较完整receipt集合防重复。有限响应观察只记录实际结果与窗口，不吞IO错误或强制要求upstream完流。仍待真实checkpoint publication→public resume、pending readiness取消及正常尾项；不把该切口当作Inbox publication、在飞恢复或全MC03完成。见[私有候选](/home/keer/.codex/outputs/2026-11-03/mc03-publication-readiness-native-root-v4/task.json)。

原来源/目录场景v7仍是同DB、同Source/Writer与原账本，只声明resume原Writer第二条User，无新User/Source模型请求；新增slot5 primary/high/enabled上游503，provider.internal/failed、claim空、工具/新ask/once/memory新增0。v7 controller/runner actual exit1、close成功，原Electron/gateway退出0、Source进程结束但数字exitunknown与三端口free均按清理收据分账。实际累计5/8（Source2＋Writer3），余3；原“三次新工具调用＋终答”正常需4新增physical，未来任务须显式解决预算，不能默默提原8上限、重置或退款。见[v7暂停结算](/home/keer/.codex/outputs/2026-11-03/mc03-source-directory-continuation-root-v7/root-provider-pause-disposition-v1.json)。用户再次要求等待DeepSeek彻底稳定后再测试，当前仅离线工程/复审，暂停后provider0、无自动探活/重试/换模型/监控。原MC03来源/目录、checkpoint/Inbox publication、Location decline、并行Session及必要恢复余项保留原owner；恢复须用户允许、路由可用、具体有限任务/预算重新绑定及独审。MC03Complete=false、MC04aUnlocked=false，MC04a/b仅既有授权只读调查；MC06/B04/B08/MC09/MC10与S1原owner/unlock不变，默认工作区只读、Git写未授权。
