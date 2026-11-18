# P1 领域用户合同预检：Meta、Assistant、导入、Work、Custom、Global、分享

取证日期：2026-10-25 UTC；Asia/Shanghai 为 2026-10-26。机器记录时间：2026-10-25T19:53:25.786865+00:00。状态：只读取证与文档交付，未实施、未运行验证。

取证者 `/root/p03_fd_final_review`；实施/审批 Owner `/root`。目标 `/home/keer/workspace/aigcfroge-v2`、`v2-dev`、取证起始 HEAD `251c0fe38041a326e624db464d1ee0efd1522881`，含主线 WIP。旧产品只读参考 `/home/keer/workspace/aigcfroge` 的 `main` `edbe67383d830aa40269ddf453c7f5617c940b46` 及 WIP。主线模式创建运输独立推进，本报告不覆盖其实现或审批。

仅新建本 MD/JSON，不改 packages、plan、debt、已有报告或 final-source-*。源码哈希只覆盖本报告引用输入，不是完整不可变工作树快照；来源改变后由主线判断相关范围重验。没有测试/build/typecheck/lint/acceptance/server/索引执行，没有新 green tally，没有复现 product red，不重跑或累加历史日志。

工作令与范围依据：[当前 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:5](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:5)；[当前 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:132](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:132)；[当前 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:160](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:160)；[当前 docs/technical-debt.md:74](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:74)。

## 分类与保留原则

- **已有**：仅列明子范围有真实入口、owner 和消费者；不代表整领域验收完成。
- **部分接线**：已有存储、服务、工具或部分 HTTP/UI；完整用户链还有明确缺口。
- **待迁移**：明确保留的用户要求尚未定位完整当前入口/消费者；已有邻近能力不能代替。
- **待裁决**：存在具体规则冲突或未确定的产品边界；列出处与 Owner，不猜规则。

本清单由同一 JSON 生成，共 17 个合同项；分类计数：部分接线 12、待迁移 3、已有 2。另有 7 项具体待裁决记录。该计数是文档项，不是功能完成数或运行 tally。

- 现行计划是工作令；旧 M7 只保留四态、进度、关闭后更新、导航和历史等功能要求，布局/尺寸/动画以 V2 宿主为准。
- 继续使用 V2 Session/AI/Model/Provider/Instructions；不回植旧 MetaAgentRuntime、TaskDriver、System Context registry 或第二 provider loop。
- Meta 项目事实与个人长期记忆分开；Assistant Schedule/Delivery 与 Work Task 调度分开；内部 synthetic 分享与公开 URL 分享分开。
- 服务、Schema、daemonNode 或 helper 测试的存在不能证明生产启动与用户消费。stub 保持 fail closed，不能改成空成功。
- 保留 V2 Todo 及当前 Task 桥接的核对要求，不用旧 Todo/Task 树替代 V2 实现。
- 已关闭 V2-C-SHARE、V2-C-TASK-HTTP、V2-C-TASK-DECISION、V2-D-COMMAND 子范围不因本次盘点重开；未交付产品范围继续开放。

## 完整合同清单

### META-IDENTITY · Meta 持久身份、Session 关联与步骤 · 部分接线

**用户入口**：保留 Meta 统一入口、持续协作、持久身份与可查看步骤。当前 builtin meta 是可选择 Agent；持久 Meta 配置管理及 create/attach 用户入口未定位。 **输入/输出**：MetaAgentService.create 输入 title/agent/model(id/providerID/variant)，输出 MetaAgent.Info；attach 输入 metaID/sessionID/role/effort；sessions/stats/writeStep/updateStep 输出关联、统计及步骤。

**Session/持久 owner**：MetaAgentTable、MetaAgentSessionTable、MetaAgentStepTable 由 MetaAgentService 管理；findBySession 查询实际关联表，选择 Agent=meta 不会自动创建关联。

**Agent**：builtin meta 为 primary，保持与 ProductMode 正交；配置中的 agent 字段不等于已绑定 Session 的实际执行选择。 **模型**：Meta 配置记录 canonical Model.Ref；实际 provider 使用当前 Session 的 Agent/Model 解析，create 配置本身不证明运行消费。 **Instructions**：当前 SessionContext 对选中 meta 调用 renderMetaSystem；持久身份、步骤与资产/记忆的自动 Instructions producer 未定位完整链。 **工具**：已有 task/delegation、memory_record/search、list_assets 注册入口；不能将这些工具存在计作 create/attach 已接线。

**权限**：保留 meta deny-first 和当前叶工具/Session 权限；身份 create/attach/remove 的公共授权与角色可见域待核。 **取消**：service 有 detach/remove；它们不等于取消 active Session/Delegation。身份删除与历史/记忆保留策略待核。 **重试**：create 生成新 Meta ID；attach 是关联插入；调用级去重、重复 attach 及多 Meta 关联选择合同待核，不默认幂等。 **恢复**：真实 SQLite 行可读取；缺失关联不能从 builtin 名称猜 Meta ID。冷重载、fork/compaction 后身份使用需用户链证明。

**消费者**：已定位 MetaAgentMemory.record 使用 findBySession；未定位生产 create/attach 管理入口。步骤事实进入产品视图及当前请求未证。 **旧数据**：保留旧 meta_agent/meta_agent_session/meta_agent_step 及其真实关联。缺失或冲突关系不得臆造、自动绑定或重跑外部步骤。

**验收（待执行）**：真实用户创建身份→attach 当前 Session→record/query→重载/fork/compaction→步骤查看及当前 Instructions 消费；验证 detach/remove 对活动执行及历史的明确合同。 **Owner**：Meta/Core/App；产品边界由产品 Owner 与 /root 裁决。

**待核字段**：create/attach 公共入口与角色权限；每 Session 关联基数；身份删除保留；自动 Instructions 的确切 producer。

**决定函数/入口证据**：[当前 packages/core/src/meta-agent/service.ts:94](/home/keer/workspace/aigcfroge-v2/packages/core/src/meta-agent/service.ts:94)；[当前 packages/core/src/meta-agent/service.ts:178](/home/keer/workspace/aigcfroge-v2/packages/core/src/meta-agent/service.ts:178)；[当前 packages/core/src/meta-agent/service.ts:216](/home/keer/workspace/aigcfroge-v2/packages/core/src/meta-agent/service.ts:216)；[当前 packages/core/src/session/context.ts:159](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:159)；[当前 packages/core/src/plugin/agent.ts:182](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/agent.ts:182)；[旧 docs/prd/meta-agent-orchestrator.md:67](/home/keer/workspace/aigcfroge/docs/prd/meta-agent-orchestrator.md:67)。

**已有夹具（只定位、未运行）**：[当前 packages/core/test/meta-agent-service.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/meta-agent-service.test.ts:1)；[当前 packages/core/test/meta-agent-integration.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/meta-agent-integration.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### META-MEMORY-ASSETS · Meta 项目事实、资产/CLI 信息与当前请求 · 部分接线

**用户入口**：保留跨 Session 的项目经验检索、资产发现和可用代理/CLI 信息。当前已注册 memory_record/search 和 list_assets；自动注入及完整管理 UI 未证。 **输入/输出**：memory_record 接收四类项目事实、content 与来源 Session/Step，Tool 内容上限 2000 字符；search 返回记录。list_assets 当前返回 kind/name/path，采用目录文件名扫描，没有 canonical revision/health/source 信息。

**Session/持久 owner**：MetaAgentMemoryTable 按 projectID 保存，并通过当前 Session 的 Meta 关联记录 metaAgentID；query/search 的决定 predicate 是 projectID。

**Agent**：保留 builtin meta 与当前子代理池；写入要求真实 attach，读取按项目；不将其改名为 Assistant 用户记忆。 **模型**：工具内容沿当前 Tool/SessionRunner 进入模型；无需第二模型执行器。 **Instructions**：renderMetaSystem 具有 assets 参数，但当前 SessionContext 的调用未传资产；自动事实/资产 producer 未定位。工具输出可用不等于当前 Instructions 自动已注入。 **工具**：memory_record/search、list_assets 已在 internal plugins 注册；CLI discovery 另见外部续接项。

**权限**：已知写入 attach guard 和当前 Location.project；工具可见性沿现有 snapshot。memory_record 未见独立 Permission.assert；跨 Meta/Mode 读域与授权需核定。 **取消**：memory.remove 删除事实；活动 Session/任务取消仍由其执行 owner 负责。 **重试**：service record 在调用方给固定 id 时 onConflictDoNothing；Tool 输入未携带该 id，不能外推重复事实调用无重复。 **恢复**：事实有来源 Session/Step 与时间，可重读；不能以缺日志猜事实或外部步骤已完成。当前请求重载/fork/compaction 的消费待验。

**消费者**：memory_search 的真实 content；list_assets 的文件名级内容；完整 canonical 资产信息、自动 Instructions 和管理 UI 缺口开放。 **旧数据**：Meta 事实保留 project/meta/source 身份；不自动混入 PersonalMemory、Notes 或确认队列。

**验收（待执行）**：同项目跨 Session 真实 record/search 与不同项目隔离；缺 attach 拒绝；原始来源与重试身份保留；canonical 资产信息→当前请求；禁止只测旧 System Context。 **Owner**：Meta/Core/Asset/App；记忆可见域由产品 Owner 裁决。

**待核字段**：自动 producer；Mode/Role 读写策略；事实语义去重；canonical 资产 revision/来源信息的消费合同。

**决定函数/入口证据**：[当前 packages/core/src/agent/meta/memory.ts:87](/home/keer/workspace/aigcfroge-v2/packages/core/src/agent/meta/memory.ts:87)；[当前 packages/core/src/agent/meta/memory.ts:115](/home/keer/workspace/aigcfroge-v2/packages/core/src/agent/meta/memory.ts:115)；[当前 packages/core/src/tool/memory.ts:74](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/memory.ts:74)；[当前 packages/core/src/tool/list-assets.ts:58](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/list-assets.ts:58)；[当前 packages/core/src/plugin/agent.ts:31](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/agent.ts:31)；[当前 packages/core/src/plugin/internal.ts:335](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/internal.ts:335)。

**已有夹具（只定位、未运行）**：[当前 packages/core/test/meta-agent-memory.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/meta-agent-memory.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### ASSISTANT-PERSONAL-MEMORY · 个人长期记忆与 Memory Inspector · 部分接线

**用户入口**：保留对话提议→人类确认/拒绝、Inspector 查看/编辑/删除。旧 dashboard/session panel 有真实调用；当前 MemoryHandler 六端点全部 fail closed。 **输入/输出**：内容、explicit/derived 来源、trust/sensitivity、来源 Session/Message、创建者/时间；propose 返回 pending Info，confirm/reject/edit/remove 返回持久状态。适用模式字段尚待核。

**Session/持久 owner**：PersonalMemoryTable 是用户级记录，PersonalMemory.propose 固定 pending；listConfirmed 只读 confirmed；删除保留 deleted 审计行。它不使用 Meta 项目事实表。

**Agent**：沿当前 Session 选择 Agent；单选 assistant 产品模式不能隐式改 Agent。 **模型**：AI 仅提议；实际运行使用 V2 Model/Provider。人工确认前不得作为长期上下文生效。 **Instructions**：当前 Core 仅定位 listConfirmed 定义，未定位默认 Instructions 调用；确认后自动/按需消费必须接到现行 Instructions，不能恢复旧 registry。 **工具**：propose_memory 已注册；公共 memory list/pending/confirm/reject/edit/remove 未接 service。

**权限**：旧 PRD 要求明确写入授权、来源/信任/敏感等级与可见审计，不信任外部网页/工具消息。Core telemetry marker 只带 memoryID；完整日志/错误正文边界及适用 Mode 可见域仍待核。 **取消**：pending 可 reject；pending/confirmed 可 edit；remove 软删除。不能将 rejected/deleted 自动恢复为可注入记忆。 **重试**：confirm/reject 条件更新只针对 pending；重复操作返回 undefined 的 HTTP/UI 语义待接，不能默认再创建提议。 **恢复**：持久查询应在重载/重连/fork/compaction 后保留确认状态；目前 service 存储不证明实际模型消费。

**消费者**：旧 Inspector；当前 propose_memory 与 service 已有，当前公共 CRUD/UI/confirmed Instructions 链未完成。 **旧数据**：保留 provenance、trust/sensitivity、confirmedAt 与终态审计；缺授权或来源不能猜为 confirmed；不得把敏感原文写日志。

**验收（待执行）**：真实提议→pending HTTP→确认/拒绝/编辑/删除→当前请求，证明未确认不注入、删除不再可见、重载及可见域隔离；拒绝/敏感来源留明确状态。 **Owner**：Assistant/Core/Server/App；模式与用户可见域由产品 Owner 裁决。

**待核字段**：适用 Mode/用户隔离、confirmed producer、公共操作重复语义与前端授权展示。

**决定函数/入口证据**：[当前 packages/core/src/session/personal-memory.ts:90](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/personal-memory.ts:90)；[当前 packages/core/src/session/personal-memory.ts:158](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/personal-memory.ts:158)；[当前 packages/core/src/session/personal-memory.ts:171](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/personal-memory.ts:171)；[当前 packages/server/src/handlers/assistant-stubs.ts:20](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/assistant-stubs.ts:20)；[当前 packages/core/src/plugin/internal.ts:338](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/internal.ts:338)；[当前 packages/core/src/session/context.ts:225](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:225)；[旧 docs/prd/assistant-mode-personal-agent.md:211](/home/keer/workspace/aigcfroge/docs/prd/assistant-mode-personal-agent.md:211)；[旧 packages/app/src/pages/assistant-dashboard.tsx:116](/home/keer/workspace/aigcfroge/packages/app/src/pages/assistant-dashboard.tsx:116)；[旧 packages/app/src/pages/session/assistant-session-panel.tsx:120](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/assistant-session-panel.tsx:120)。

**已有夹具（只定位、未运行）**：[当前 packages/core/test/personal-memory.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/personal-memory.test.ts:1)；[当前 packages/schema/test/personal-memory.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/schema/test/personal-memory.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### ASSISTANT-NOTES-DAILY · Notes、Daily Notes 与 Studio 产物 · 待迁移

**用户入口**：保留对话 propose_note→审查/修改/拒绝→确认写入、笔记编辑器、日期命名 Daily Notes、会议/周报/读书/每日回顾模板、URL→webfetch→草稿、版本 diff/回滚及源锚定引文。旧日记页要求不能遗漏。 **输入/输出**：title/content/scope/tags/format；Schema 接受七种 format。当前 propose_note 只返回候选 exists/nameConflict/dangling，不落盘；日期生成、模板、版本和引文输入输出待核。

**Session/持久 owner**：确认后的普通 Note 可复用 KBService/KBNote owner；Daily 日期页、模板与每次 update 的旧版本 owner 本轮未定位，不默认用一个普通 Note 当作全部实现。

**Agent**：当前 Session 所选 Agent；专用 Assistant/Studio prompt 的真实消费者待核。 **模型**：生成发生在当前有限 SessionRunner；源锚定回答需基于真实 Notes/Memory 检索。 **Instructions**：当前候选 content 与 kb 工具可用；七类模板、引文约束和真实当前请求的消费者尚未证明。 **工具**：propose_note、kb_create/search/read/update/delete/list_dangling 已注册；propose_note output 未附 metadata，同源候选事实的持久 UI 消费需沿现有 Tool.Success 处理。

**权限**：propose_note/kb 工具有叶 Permission.assert；笔记正文应明确人类确认、外部剪藏保留不信任来源、路径由 KB owner 决定。 **取消**：候选取消/拒绝前无文件写入；编辑、版本回滚及草稿取消不修改已确认版本的合同待落地。 **重试**：候选与修改后的内容需严格配对，不能沿用缺失/default facts；重复打开同日期、重复确认及回滚去重待核。 **恢复**：要求恢复未提交草稿、历史版本与引文来源；service Note 重读不证明 Daily/Studio 恢复。

**消费者**：旧 Assistant note editor/dashboard/KB tab 可作合同参考；当前无已定位 Notes/日记/Studio 用户入口，不能搬旧 Shell 几何。 **旧数据**：保留标题/aliases/tags/format、源数据锚点、旧版本与 Markdown；Daily 日期时区和重名规则待核。

**验收（待执行）**：真实候选→确认→HTTP/文件→读回/引文；日期命名生成、七种 format、模板/剪藏、旧版本 diff/rollback、取消和重载；确认前零落盘。 **Owner**：Assistant/Notes/Core/Server/App；日期和版本策略由产品 Owner 核定。

**待核字段**：Daily 日期时区/重名、模板和版本存储、七类 Studio renderer、来源锚定及引文 payload；M3+图谱/闪卡/记忆关系边/导出继续按旧阶段保留待盘点，不计本项已交付。

**决定函数/入口证据**：[当前 packages/core/src/tool/propose-note.ts:59](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/propose-note.ts:59)；[当前 packages/core/src/tool/propose-note.ts:81](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/propose-note.ts:81)；[当前 packages/schema/src/kb-note.ts:24](/home/keer/workspace/aigcfroge-v2/packages/schema/src/kb-note.ts:24)；[当前 packages/core/src/tool/kb-tools.ts:59](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/kb-tools.ts:59)；[旧 docs/prd/assistant-mode-personal-agent.md:258](/home/keer/workspace/aigcfroge/docs/prd/assistant-mode-personal-agent.md:258)；[旧 docs/prd/assistant-mode-personal-agent.md:488](/home/keer/workspace/aigcfroge/docs/prd/assistant-mode-personal-agent.md:488)；[旧 packages/app/src/pages/assistant-dashboard.tsx:171](/home/keer/workspace/aigcfroge/packages/app/src/pages/assistant-dashboard.tsx:171)；[旧 packages/app/src/pages/session/assistant-kb-tab.tsx:25](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/assistant-kb-tab.tsx:25)。

**已有夹具（只定位、未运行）**：[当前 packages/core/test/kb-service.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/kb-service.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### ASSISTANT-KB · KB 文件、索引、双向链接与检索 · 部分接线

**用户入口**：保留全局/项目 Notes、层级标签、aliases、FTS5、wikilinks/backlinks/dangling 与引文跳转；旧 KB tab 真调用这些读 API，当前八个公共 KB handler 全 fail closed。 **输入/输出**：KBNote.Note(id/title/content/scope/tags/aliases/format/times)、Link 与 DanglingLink；create/update/remove/get/list/search/backlinks/dangling。中文检索与实际引文结果待验。

**Session/持久 owner**：KBService 管理 KBNote/Link/FTS；有 baseDir 时写 <config>/knowledge-base 或 <directory>/.aigcfroge/knowledge-base。list 当前仅按 scope 标签过滤；项目隔离单元仍需实际核对。

**Agent**：沿当前 Agent 权限与 Session 选择；Notes 不授予执行能力。 **模型**：kb_search/read 的内容可进入当前 Tool 流；检索型回答与引用需实际请求证明，不称已完整 RAG。 **Instructions**：不默认把全部库注入 Instructions；检索和引文 producer/消费合同待接。 **工具**：六个 kb 工具已注册并自断言权限；HTTP adapter 必须提供真实 scope/baseDir，不能把 DB-only 调用当 Markdown 已落盘。

**权限**：Title schema 拒路径分隔/parent 引用；服务 mirror containment；Scope/同名跨项目/外部编辑信任边界必须保留真实验证。 **取消**：删除和写入回滚由现有 KB owner 处理；真实 UI 冲突、取消、跨文件/索引失败后恢复待验。 **重试**：scope+title 唯一、链接解析依当前 scope/aliases；并发写/重命名/重复操作不能复制第二套比较规则。 **恢复**：syncFromDirectory 可重建索引；生产文件 watcher、外部 Obsidian 编辑、文件消失及重启重建的真实接线待核。

**消费者**：当前 kb 工具；旧 KB tab 的 search/backlinks/dangling/链接装饰；当前公共 UI/HTTP、生产 watcher 与跨项目正确性开放。 **旧数据**：Markdown 内容和稳定 Note ID/title/aliases/links 保留；索引重建依据原文件；无 scope/source 的历史项不猜归属。

**验收（待执行）**：同 source owner 的 HTTP→文件/索引→查询→当前回答/引文；同名不同 scope/Location、aliases、悬空转正常/删除再悬空、外部编辑、中文搜索及失败回滚。 **Owner**：KB/Core/Server/App；Scope/历史缺失归属由产品 Owner 与 Core 核定。

**待核字段**：项目隔离键、生产 watcher、中文 FTS 行为、引文来源结构与版本历史。

**决定函数/入口证据**：[当前 packages/core/src/session/kb-service.ts:167](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/kb-service.ts:167)；[当前 packages/core/src/session/kb-service.ts:270](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/kb-service.ts:270)；[当前 packages/core/src/session/kb-service.ts:273](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/kb-service.ts:273)；[当前 packages/core/src/session/kb-service.ts:375](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/kb-service.ts:375)；[当前 packages/core/src/tool/kb-tools.ts:45](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/kb-tools.ts:45)；[当前 packages/server/src/handlers/assistant-stubs.ts:30](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/assistant-stubs.ts:30)；[旧 docs/prd/assistant-mode-personal-agent.md:480](/home/keer/workspace/aigcfroge/docs/prd/assistant-mode-personal-agent.md:480)；[旧 packages/app/src/pages/session/assistant-kb-tab.tsx:81](/home/keer/workspace/aigcfroge/packages/app/src/pages/session/assistant-kb-tab.tsx:81)。

**已有夹具（只定位、未运行）**：[当前 packages/core/test/kb-service.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/kb-service.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### ASSISTANT-REMINDERS · 单次提醒、Delivery inbox 与离线补投 · 部分接线

**用户入口**：保留自然语言→展示内容/绝对时间/IANA 时区/离线语义→人类确认→创建、列表/取消、近期投递和已读。旧 dashboard/session panel 真调用；当前 Schedule/Delivery HTTP 全 fail closed。 **输入/输出**：confirmed content/dueAt/timezone，持久 Schedule.Info 与 deliveryKey；Delivery 包含 schedule/session/content/deliveredAt/caughtUp/read。简单到期路径要求 0 LLM/工具调用。

**Session/持久 owner**：ScheduleTable/DeliveryTable 由 ScheduleService/DeliveryService 管理，非 TaskTable。AssistantScheduler.trigger 将 claim、去重 delivery 与 settle 放同事务；daemonNode 定义未在检查生产 roots 找到启动调用。

**Agent**：创建发生在当前有限 Session；到期简单提醒不选择执行 Agent。 **模型**：仅自然语言候选解析使用当前模型。模型生成日报属于后续阶段，必须另经 durable input/普通有限 Drain，不能混入 M1 提醒。 **Instructions**：Tool 描述要求确认时间；真实确认展示/evidence 和到期产品触达仍需接线。 **工具**：reminder_create/update/cancel 已注册；create 验 IANA/未来绝对时间，deliveryKey 由 Session+dueAt+内容 digest 决定。

**权限**：叶 Permission.assert，cancel 验当前 Session 归属；新提醒开关关闭后的查询/取消/已有 pending 投递合同保留，不丢数据。 **取消**：cancel 与事务 trigger 条件决定胜负，取消成功不误投；公共返回、运行中取消、终态展示需真实 UI 验证。 **重试**：固定 deliveryKey 去重；事务失败/next_attempt/backoff 的 UI 与生产行为需同 owner 回归，不从工具说明外推无重复。 **恢复**：daemon 有 startupSweep/caught_up 与 stale claim 恢复；定义不等于生产启动。离线期间不承诺 OS 后台运行，下次启动补投。

**消费者**：当前创建/更新/取消工具与存储；daemon 开机接线、真实 Delivery HTTP/UI 与已读同步未完成。 **旧数据**：保留 pending/terminal 状态、lease/retry/deliveryKey 和 caughtUp；不得将历史提醒转换成 Work Task 或丢弃 flag-off 数据。

**验收（待执行）**：真实确认→创建→查询→生产启动/到期→唯一 inbox→已读；停机逾期补投、取消/认领竞争、重复确认/重启/故障回滚；证明简单到期不调用模型/工具且日志无正文。 **Owner**：Assistant/Schedule/Core/Server/App/Desktop runtime；时间和拓展阶段由产品 Owner 核定。

**待核字段**：生产 daemon root、确认 evidence/通知 surface、flag-off 真实闭环；Cron/模型日报与 Work recurrence 的拓展合同另列。

**决定函数/入口证据**：[当前 packages/core/src/tool/reminder-create.ts:34](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/reminder-create.ts:34)；[当前 packages/core/src/tool/reminder-create.ts:77](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/reminder-create.ts:77)；[当前 packages/core/src/tool/reminder-create.ts:108](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/reminder-create.ts:108)；[当前 packages/core/src/tool/reminder-cancel.ts:56](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/reminder-cancel.ts:56)；[当前 packages/core/src/session/schedule-service.ts:533](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/schedule-service.ts:533)；[当前 packages/core/src/session/schedule-service.ts:697](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/schedule-service.ts:697)；[当前 packages/core/src/session/schedule-service.ts:714](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/schedule-service.ts:714)；[当前 packages/core/src/plugin/internal.ts:283](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/internal.ts:283)；[当前 packages/server/src/handlers/assistant-stubs.ts:42](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/assistant-stubs.ts:42)；[旧 docs/prd/assistant-mode-personal-agent.md:51](/home/keer/workspace/aigcfroge/docs/prd/assistant-mode-personal-agent.md:51)；[旧 docs/prd/assistant-mode-personal-agent.md:130](/home/keer/workspace/aigcfroge/docs/prd/assistant-mode-personal-agent.md:130)；[旧 packages/app/src/pages/assistant-dashboard.tsx:259](/home/keer/workspace/aigcfroge/packages/app/src/pages/assistant-dashboard.tsx:259)。

**已有夹具（只定位、未运行）**：[当前 packages/core/test/schedule-service.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/schedule-service.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### IMPORT-ASSET-CONFIG · 跨工具资产/配置导入与审阅 · 部分接线

**用户入口**：保留 paste/file/folder、选中文件、解析预览 warnings/errors、返回修改、AI-assisted fallback 和明确导入意图。旧 handleImport 只调用 onImport，不能从按钮名推断已写资产。 **输入/输出**：当前 ImportParser 输入 content，输出 candidates(kind/name/description/template)、warnings/errors；纯文本/代码块提取与大小界限已有。外部配置 vendor/version/秘密/源路径字段矩阵待核。

**Session/持久 owner**：Parser 只提取，不写资产。实际写入仍归选中 AssetService/CAS/安全 Location；public parse 在 assistant-stubs fail closed，七资产用户 apply 另见首资产预检。

**Agent**：确定性 parse 不选 Agent；AI fallback 使用当前有限 Session，不自动创建或改 mode/Agent。 **模型**：纯 Parser 无 LLM；AI fallback 保留原始导入内容的 untrusted 边界，不能自动当 system Instructions。 **Instructions**：外部内容必须与可信执行指令区分；旧 wrapImportContent 仅是输入格式参考，不替代授权/来源/实际当前请求验证。 **工具**：现有 proposer/AssetService 与兼容配置 discovery 可复用；compatibility source 能读某格式不等于已经完成导入转换。

**权限**：parse 的 Authorization、写入的实际 Session/Location/路径/秘密边界与显式确认分开；Client 不能导入 Core/Server。 **取消**：选择/解析/预览/返回/关闭前不 apply；部分失败不伪装整体成功。 **重试**：解析可重复读取；apply 用真实 proposal facts/revision，覆盖需人类确认；重复导入和多候选部分结果需真实合同。 **恢复**：输入/选择/候选与来源需可审阅恢复；不能由扫描文件数量宣称全部导入。

**消费者**：旧 ChatImportDialog；当前 parser service/Schema 已有，HTTP/UI/write→runtime consumer 未完成。 **旧数据**：保留原文件、vendor/version、路径和不支持项目的显式 warning/error；凭据不复制进公开 candidate 或日志。

**验收（待执行）**：真实选源→parse HTTP→预览→确认→AssetService→原生注册/当前 Session 消费；非法/大输入/秘密/路径/重复/冲突/取消/局部失败与 reload。 **Owner**：Import/Asset/Core/Server/App；源格式/version/秘密策略由 Import/产品 Owner 核定。

**待核字段**：各工具配置格式矩阵、字段映射/秘密剥离、源身份、批量事务与恢复策略。

**决定函数/入口证据**：[当前 packages/core/src/import-parser.ts:252](/home/keer/workspace/aigcfroge-v2/packages/core/src/import-parser.ts:252)；[当前 packages/core/src/import-parser.ts:348](/home/keer/workspace/aigcfroge-v2/packages/core/src/import-parser.ts:348)；[当前 packages/schema/src/import-parser.ts:19](/home/keer/workspace/aigcfroge-v2/packages/schema/src/import-parser.ts:19)；[当前 packages/protocol/src/groups/import-parser.ts:11](/home/keer/workspace/aigcfroge-v2/packages/protocol/src/groups/import-parser.ts:11)；[当前 packages/server/src/handlers/assistant-stubs.ts:52](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/assistant-stubs.ts:52)；[旧 packages/app/src/components/chat/chat-import-dialog.tsx:104](/home/keer/workspace/aigcfroge/packages/app/src/components/chat/chat-import-dialog.tsx:104)；[旧 packages/app/src/components/chat/chat-import-dialog.tsx:234](/home/keer/workspace/aigcfroge/packages/app/src/components/chat/chat-import-dialog.tsx:234)；[旧 packages/app/src/components/chat/chat-import-dialog.tsx:262](/home/keer/workspace/aigcfroge/packages/app/src/components/chat/chat-import-dialog.tsx:262)；[当前 docs/research/upstream-v2-sync/p1-first-asset-preflight-2026-10-25-skill.md:1](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/p1-first-asset-preflight-2026-10-25-skill.md:1)。

**已有夹具（只定位、未运行）**：[当前 packages/core/test/import-parser.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/import-parser.test.ts:1)；[当前 packages/core/test/import-parser-size-warnings.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/import-parser-size-warnings.test.ts:1)；[当前 packages/core/test/import-parser-redos.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/import-parser-redos.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### IMPORT-EXTERNAL-HISTORY · 外部会话历史转换与 canonical Session transfer · 待迁移

**用户入口**：保留跨工具历史导入、来源可查、旧消息/工具/模型数据正确呈现；它不等于 Chat 资产文本 import，也不等于外部 live thread 续接。真实 App 入口与支持源版本本轮未定位。 **输入/输出**：现有 canonical SessionTransfer 是 info+settled messages，export 可 sanitize；import 检查 Session ID 冲突并保存消息 ID/time/顺序。外部 JSONL/数据库/工具调用结构转换待核。

**Session/持久 owner**：SessionTransfer 使用当前 Session/Message/Bus/Project 事务 owner；当前 import Created 参数未转交 mode，也没有导入 composition snapshot 的已定位合同，不称全模式历史恢复已完成。

**Agent**：canonical transfer 保留 Agent 字段；外部身份到当前 Agent 分类映射不能猜，不能仅因旧名称直接执行。 **模型**：canonical Model.Ref/消息 provider data 需真实转换；导入本身不调用模型。 **Instructions**：历史与可执行 Instructions/来源信任分开；Custom 历史读取不自动证明冻结依赖可继续执行。 **工具**：复用 SessionTransfer 和既有 parser/Schema；资产 Parser 剥离 conversation noise，不是 transcript converter。

**权限**：导入源读取、目标 Location 和来源/秘密/授权需真实边界；sanitize 功能不是公开发布授权。 **取消**：取消导入不能留下半 Session/半消息；导入历史不能停止或恢复原外部运行。 **重试**：当前 import 已有 ID 时明确 conflict；不能套普通 create 的 adoption 或旧 exact-payload retry 规则消除该冲突。 **恢复**：验证重开与消息呈现；live continuation 需要外部 adapter 对具体 thread/turn/attempt 的证据，不能从已导入文本推导可重跑。

**消费者**：canonical transfer owner 已有；外部格式转换、当前 App 历史 UI、模式/snapshot/source 全保留及真实消费者未证。 **旧数据**：保留原 vendor/version、Session/Message/tool IDs/time/source；缺失状态或未知副作用不补成成功。V1 数据库/凭据迁移不能算外部 transcript 导入。

**验收（待执行）**：真实各源样本→确定转换→canonical import→GET/timeline/tool/source→reopen；冲突、损坏、取消事务、模式与冻结历史语义；不触发外部工作。 **Owner**：Import/Core/Server/App；外部源身份/模式和历史恢复合同由产品 Owner 核定。

**待核字段**：源格式/version 清单、Tool/provider 元数据映射、mode/snapshot 迁移、sanitization 与可继续执行的区分。

**决定函数/入口证据**：[当前 packages/core/src/session/transfer.ts:57](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/transfer.ts:57)；[当前 packages/core/src/session/transfer.ts:64](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/transfer.ts:64)；[当前 packages/core/src/session/transfer.ts:91](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/transfer.ts:91)；[当前 packages/core/src/import-parser.ts:269](/home/keer/workspace/aigcfroge-v2/packages/core/src/import-parser.ts:269)；[当前 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:126](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:126)。

**已有夹具（只定位、未运行）**：[当前 packages/core/test/session-create.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-create.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### EXTERNAL-CLI-CONTINUATION · CLI 发现、外部 thread/turn 续接及只读审查 · 部分接线

**用户入口**：保留 Codex/Claude 等本地 CLI 发现、持久 participant/thread、追加/steer/queue、interrupt、继续与审查。旧目标是 Build implementer+Codex只读 reviewer；当前 dispatch 仅接受 internal provider。 **输入/输出**：CliDiscovery 返回 name/command/path/available；CliAdapter 有 jsonl/sdk/acp/app-server、resumeId、threadId/turnId、review/error/recoveryRequired 与可选控制方法。方法存在不能宣称所有 transport 都支持。

**Session/持久 owner**：Delegation/Participant/Turn/Delivery 来源事实与 externalThreadID/externalTurnID 归现有 service；adapter registry 的实际生产注册与完整执行接线未证。

**Agent**：内部 delegate 目标需非 primary；当前 Build/meta 为 primary。保留配置分类，不能静默换 general 或降为 subagent 来实现旧故事。 **模型**：外部模型选择来自具体 adapter/配置；内部运行仍归 SessionRunner，不新增统一外部模型 loop。 **Instructions**：保留子代理协议卡片、来源和同 participant 持续协作上下文；外部请求/结果进入当前 Instructions/receipt 的具体 producer 待核。 **工具**：CliAdapter、CliDiscovery 与现有 Delegation 控制面可复用；发现只读，不安装/登录/运行 CLI。外部 dispatch 不能靠接口存在放开。

**权限**：只读 reviewer 与真实 canUseTool/Permission waiter、attended、purge 权限必须接具体 transport；旧 verdict 不授予工具权限。 **取消**：按真实能力区分 cancel、interruptTurn、archiveThread/deleteThread；threadId 不能替代 active turnId。 **重试**：review/revision/attempt 身份保留；未知副作用不能因 resumeThread 成功就重试旧工作；缺能力必须明确拒绝。 **恢复**：reconcileResume 当前明确保留 unknown，返回 0；跨启动需要 adapter 的确切 attempt 证据，不能从缺日志或继续 thread 推导未执行。

**消费者**：adapter 接口/发现函数与 service 的外部关联/清理已有；真实注册、外部执行、attended、review/revision producer 与用户 UI 仍开放。 **旧数据**：保留 external_cli_session/thread/turn/meta step/receipt 真实来源；不得把历史 ID 当通用 turn ID 或靠文本 resume hint 重跑未知副作用。

**验收（待执行）**：只读发现→显式协作→真实 transport→persist thread/turn/receipt→追加/取消/冷恢复→revision review barrier；逐能力验证不可用/超时/拒绝与来源保护。 **Owner**：CLI/Delegation/Import/Core/App；Build 通道、外部副作用和 attended/review 合同由产品 Owner 与 /root 裁决。

**待核字段**：生产 adapter 注册、源 CLI/version/capability 矩阵、Build primary 的真实执行通道、未知结果 reconciliation 证据。

**决定函数/入口证据**：[当前 packages/core/src/tool/cli-adapter.ts:44](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/cli-adapter.ts:44)；[当前 packages/core/src/tool/cli-adapter.ts:85](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/cli-adapter.ts:85)；[当前 packages/core/src/tool/cli-adapter.ts:139](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/cli-adapter.ts:139)；[当前 packages/core/src/tool/cli-discovery.ts:15](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/cli-discovery.ts:15)；[当前 packages/core/src/delegation/execution.ts:587](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:587)；[当前 packages/core/src/delegation/execution.ts:607](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:607)；[当前 packages/core/src/delegation/service.ts:1104](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:1104)；[当前 packages/core/src/plugin/agent.ts:120](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/agent.ts:120)；[旧 docs/prd/meta-agent-orchestrator.md:68](/home/keer/workspace/aigcfroge/docs/prd/meta-agent-orchestrator.md:68)；[旧 docs/prd/meta-agent-orchestrator.md:79](/home/keer/workspace/aigcfroge/docs/prd/meta-agent-orchestrator.md:79)。

**已有夹具（只定位、未运行）**：[当前 packages/core/test/cli-discovery.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/cli-discovery.test.ts:1)；[当前 packages/core/test/delegation-service.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/delegation-service.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### WORK-TASK-CONSUMPTION · Task CRUD、真实进度、继续、调度、child 与当次历史 · 部分接线

**用户入口**：当前 SessionTaskPanel 已接持久表单 CRUD/重开；保留 V2 四态、真实进度、外部关闭、收起后更新、继续执行、持久 child 导航和当次只读调用快照。旧 M7 几何由现行计划 supersede。 **输入/输出**：content/priority/status 等 canonical Task 字段、taskID/sessionID/revision/summary/schedule；PATCH 使用 expectedRevision。运行进度和当次快照必须来自真实执行事实。

**Session/持久 owner**：TaskTable/SessionTask 是持久 owner；updateTask 的 CAS/commit 可供 execution 复用；Data.session.task→generated HTTP→Core 已接。

**Agent**：实际执行沿现有 Task/Delegation/child Agent；表单重开 pending 不决定 Agent 或开始执行。 **模型**：CRUD 无模型调用；真实 runner 结果、receipt 和 progress 才可计执行消费，fixture 摘要不代替 provider 输出。 **Instructions**：保持当前 SessionRunner/Instructions；继续执行不能回植旧 TaskDriver 或第二 provider loop。 **工具**：现有 Task 工具/HTTP 与 V2 Todo bridge 保留；Work 调度需要 Task adapter，不能用 Assistant ScheduleTable 承担。

**权限**：真实 Session/Location 归属、CAS、mutation ACK 与读回错误分别处理；运行取消/purge 与纯 CRUD 权限不混同。 **取消**：状态 PATCH/删除并不证明相应 trigger/inbox/Job 停止；完整 pause/remove/外部关闭需要执行 owner 联动。 **重试**：TaskPanel.mutate 按 ACK 成功，读回失败不重做已成功写入；reopen 只是 pending PATCH。全量/reorder 的结构并发合同另待裁决。 **恢复**：有确切 marker 的 Task/KV 更正子范围保留关闭；旧 marker 缺 owning input/revision 不能猜修。真实继续与冷恢复产品消费仍开放。

**消费者**：当前表单 CRUD；Task.updated 在展开时触发 load；进度轨道/收起后刷新、child/historical snapshot、Work schedule 尚未完成。 **旧数据**：保留旧 marker/receipt/通知的可证明身份；历史与当前 Task 分开；不回放旧 Todo/Task 树替换 V2。

**验收（待执行）**：真实 CRUD/ACK/stale/CAS→runner结果→四态/关闭后更新→继续/child导航/当次快照→重载；schedule claim/取消/冷恢复及结构/时区并发独立验收。 **Owner**：Task/Core/Server/Client/App、/root；旧 marker/结构并发/recurrence 时区由产品 Owner 裁决。

**待核字段**：真实进度度量、当次快照 UI 结构、Work 调度 adapter、全量/reorder 版本和 timezone nextRun 合同。

**决定函数/入口证据**：[当前 packages/app/src/session/tasks/session-task-panel.tsx:73](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/tasks/session-task-panel.tsx:73)；[当前 packages/app/src/session/tasks/session-task-panel.tsx:108](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/tasks/session-task-panel.tsx:108)；[当前 packages/app/src/session/tasks/session-task-panel.tsx:180](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/tasks/session-task-panel.tsx:180)；[当前 packages/app/src/session/tasks/session-task-panel.tsx:255](/home/keer/workspace/aigcfroge-v2/packages/app/src/session/tasks/session-task-panel.tsx:255)；[当前 packages/core/src/session/task.ts:963](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/task.ts:963)；[当前 docs/review/v2-task-product-audit-2026-10-24.md:3](/home/keer/workspace/aigcfroge-v2/docs/review/v2-task-product-audit-2026-10-24.md:3)；[当前 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:160](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:160)；[当前 docs/technical-debt.md:14](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:14)；[当前 docs/technical-debt.md:19](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:19)。

**已有夹具（只定位、未运行）**：[当前 packages/app/e2e/regression/session-header.spec.ts:1](/home/keer/workspace/aigcfroge-v2/packages/app/e2e/regression/session-header.spec.ts:1)；[当前 packages/server/test/session-task.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/server/test/session-task.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### WORK-DELEGATION · 持久 Delegation 协作、review/revision 与生命周期消费 · 部分接线

**用户入口**：保留持久协作列表/详情、participant/turn、同证据 fanout、steer/queue、版本化只读审查、关闭/完成/归档/显式 purge 和失败可见性。当前生命周期 HTTP 与内部执行已有，完整产品 UI 未定位。 **输入/输出**：Delegation/Participant/Turn/Delivery、evidence/revision digests、reviewedRevisionDigest/verdict 与 attempt 来源；appendTurn 不引入额外 requestID，按既有来源事实去重。

**Session/持久 owner**：DelegationService/Event/SQL/fold 管持久关系，Execution/child Session/Job 管执行，Task/KV settlement 管写回。review barrier 用实际 copyable/evaluateReviewBarrier/canComplete 规则。

**Agent**：implementer/reviewer/approver 角色与当前 Agent 执行分类分开；内部 dispatch 非 primary，具体 Build 通道另裁决。 **模型**：内部模型归 SessionRunner；外部真实 adapter 另接，不能把 Coordinator 当第二模型 loop。 **Instructions**：当前 history/Instructions 与子代理协议；外部 review/revision producer 和 UI 可追溯来源仍待接。 **工具**：已有 task/Delegation service 与真实 HTTP 控制；不能凭 DTO 或接口把外部 producer 算完成。

**权限**：HTTP 校验 parent ownership；review 不能绕过 Permission，purge 与默认保留历史分开；现有叶裁决保持。 **取消**：interrupt/close/complete/archive/delete 各自语义和完成 barrier 保留；取消来源 unarchive 等已验子范围不扩成全生命周期关闭。 **重试**：revision/review receipt 是版本事实，sticky rejection 需明确撤回；copyable 只允许既有无代码变化规则；较新 receipt 与原历史保留。 **恢复**：内部 exact child/input/Task marker 与冷恢复已有子范围；unknown side effects、多 pending、fanout 补偿、draft purge 与完整顺序仍开放，不由缺日志推导未执行。

**消费者**：真实 Delegation HTTP/内部执行/写回；列表/详情/turn/进度/审查/恢复 UI 与外部产物消费尚未闭环。 **旧数据**：保留 role、thread/child、turn/attempt、revision 与原 receipt；旧来源不足时保留人工 reconciliation，不能自动改已审历史。

**验收（待执行）**：真实多人 turn→执行→revision/review→completion barrier→UI→取消/归档/重开；隔离失败不抹健康结果，冷恢复和未知结果的明确人工状态。 **Owner**：Delegation/Core/Server/App/CLI、/root；外部副作用、角色与缺日志策略由产品 Owner 裁决。

**待核字段**：外部 producer、attended、完整 UI、draft purge 与未验多 participant/故障顺序；既有日志只引用子范围，不累加。

**决定函数/入口证据**：[当前 packages/server/src/handlers/delegation.ts:38](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/delegation.ts:38)；[当前 packages/server/src/handlers/delegation.ts:84](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/delegation.ts:84)；[当前 packages/core/src/delegation/service.ts:434](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:434)；[当前 packages/core/src/delegation/review.ts:20](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/review.ts:20)；[当前 packages/core/src/delegation/review.ts:78](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/review.ts:78)；[当前 packages/core/src/delegation/execution.ts:550](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:550)；[旧 docs/prd/meta-agent-orchestrator.md:65](/home/keer/workspace/aigcfroge/docs/prd/meta-agent-orchestrator.md:65)；[当前 docs/technical-debt.md:11](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:11)。

**已有夹具（只定位、未运行）**：[当前 packages/server/test/delegation.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/server/test/delegation.test.ts:1)；[当前 packages/core/test/delegation-review.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/delegation-review.test.ts:1)；[当前 packages/core/test/delegation-execution.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/delegation-execution.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### WORK-WORKFLOW · Workflow 运行/步骤、取消/重试及产品状态 · 部分接线

**用户入口**：保留 Workflow 运行/步骤/真实进度/child/Task 关联、取消/重试和当次历史。当前四执行 HTTP 与状态读取是真实实现；App 的完整 Workflow runtime 用户面板未定位。 **输入/输出**：run 输入 sessionID/requestID/expectedSnapshotDigest；cancel/retry 使用 run/step ID 与 revision；输出 canonical run/steps status。当前 root 函数要求 Custom root 和有效冻结 Workflow。

**Session/持久 owner**：WorkflowRun/StepRun/Event 与 Session composition snapshot 管持久身份；Execution 用现有 child Session/Job/Task；run 明确要求 retained events，snapshot digest 决定准入。

**Agent**：冻结 orchestrator/executor 选择；Work mode 页面不能未经明确 composition start/upgrade 就当成 Workflow root。 **模型**：每个 child 仍由当前 SessionRunner 调用 provider，不新增 workflow in-memory tool loop。 **Instructions**：consumer-scoped frozen bindings/当前 Instructions 与历史沿现有 Session owner；调用快照 UI 不用当前热 registry 替代。 **工具**：四实际 handler 在 session-instance-stubs.ts 内；文件名不等于该文件全是 stub，逐 endpoint 判断。

**权限**：实际 session/run/step ownership、Custom enabled、snapshot/revision preconditions 与叶工具权限保留。 **取消**：持久 cancel intent 先于停止 Job；运行/步骤取消与 Task 更新需要实际消费验证。 **重试**：requestID 与 run/step revision、已有结果/receipt 保护；未知步骤不能任意重跑。 **恢复**：同源内部恢复已有有界子范围；events-off、未知副作用、生产 startup 规模与多故障顺序仍开放，不累加旧检查点。

**消费者**：真实 HTTP status/run/cancel/retry 与 backend execution；App 运行控件、child/当次快照、真实事件更新仍开放。 **旧数据**：保留 frozen workflow revision、run/step/source/Task/child/input 身份；历史缺冻结依赖不回退最新定义。

**验收（待执行）**：明确 Custom start/upgrade→run CAS→真实 DAG/child/Task结果→status UI/历史→取消/重试→cold；旧 Work 入口怎样消费另确认，不能默改 mode。 **Owner**：Workflow/Custom/Core/Server/App、/root；Work 与 Custom 产品入口衔接由产品 Owner 核定。

**待核字段**：完整 runtime UI、Work 入口衔接、events-off 语义/规模与未验故障顺序。

**决定函数/入口证据**：[当前 packages/core/src/workflow/execution.ts:179](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:179)；[当前 packages/core/src/workflow/execution.ts:840](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:840)；[当前 packages/core/src/workflow/execution.ts:863](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:863)；[当前 packages/server/src/handlers/session-instance-stubs.ts:174](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/session-instance-stubs.ts:174)；[当前 packages/server/src/handlers/session-instance-stubs.ts:180](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/session-instance-stubs.ts:180)；[当前 packages/server/src/handlers/session-instance-stubs.ts:192](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/session-instance-stubs.ts:192)；[当前 docs/technical-debt.md:22](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:22)。

**已有夹具（只定位、未运行）**：[当前 packages/server/test/workflow-execution.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/server/test/workflow-execution.test.ts:1)；[当前 packages/core/test/workflow-execution.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/workflow-execution.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### CUSTOM-PROFILE-BUILDER-FREEZE · Custom Profile/Builder、Plan/Snapshot、冻结消费与反向引用 · 部分接线

**用户入口**：保留 Profile 选择/创建/编辑、Builder、plan/health、明确 start/upgrade、绑定消费者、运行/历史/引用/删除。Profile list/content 与 composition plan/start/health/refs 已是真 HTTP；App 用户入口未接。 **输入/输出**：Profile name/description/agents/bindings/presentation/requestedCapabilities/revision；ProfileInput 或 temporary CompositionInput→Plan→StartResponse(Session+snapshot)。旧 M1 单用户 Agent 与当前 Schema 1–16 的阶段范围需核定。

**Session/持久 owner**：CustomProfile/Service 与 SessionComposition snapshot 是真实 owner；Session.startCustom 原子 Created+snapshot，root meta、child/fork frozen selection；不能普通 create 后补 snapshot。

**Agent**：冻结平台 meta root 与选中 executor，consumer scope 不回退 live/default Agent。 **模型**：沿当前 frozen executor/Session model 解析，不恢复旧 Meta runtime。 **Instructions**：当前 SessionContext 使用 frozen Skill/Prompt/Command 与现行 Instructions；已有 Command 执行子范围保持关闭，producer/ambient MCP/Web 仍开放。 **工具**：复用当前 Tool.snapshot 的 direct/CodeMode 定义/Schema/namespace 同次重验；requestedCapabilities 仅声明，不能新建授权映射或强制 MCP 全 direct。

**权限**：当前 Agent/Session/leaf 权限与 capability 声明分开；凭据只存引用；Location/path/source/revision 和 exact runtime dependency 保留。 **取消**：候选/plan 不启动；明确 start 失败无半 Session/snapshot。删除先显示 refs，不级联 Profile/其他资产/历史；内容资产删除后 broken/new start blocked，冻结内容可历史重放。 **重试**：Plan 不是启动承诺，start 重新 freeze/digest；fixed ID 的已验证 frozen retry 沿现有 owner；缺依赖明确阻断。 **恢复**：历史版本与 Snapshot 始终可读范围保留；运行依赖不匹配阻断，不加载最新资产代替。sourceLocation、移动/归档和 snapshotsComplete 不能抹掉。

**消费者**：真实 Profile/composition HTTP、frozen Session/Command 与 refs；Builder/Profile selector/删除提示/结果导航和完整 watcher/producer 消费未完成，不能用失效 Custom 按钮算第五入口。 **旧数据**：保留 Profile revision、consumer bindings、snapshot version/digest/sourceLocation 和 frozen bodies；历史缺 source 或 snapshot 损坏显示 incomplete/blocked，不臆造。

**验收（待执行）**：真实 Profile→plan→明确 start→atomic snapshot→当前消费者/command/Workflow→refs/删除/历史→cold/upgrade；disabled/capability、路径/凭据、missing/stale、Scope/来源和 watcher 就绪。 **Owner**：Custom/Asset/Core/Server/App；阶段 bounds、producer/ambient 冻结与权限展示由产品 Owner 核定。

**待核字段**：Builder 产品阶段/Agent 数量限制、producer closure/Skill resources/ambient MCP/Web、完整 watcher 一致性与规模；第五入口 P3 未交付。

**决定函数/入口证据**：[当前 packages/server/src/handlers/custom-profile.ts:26](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/custom-profile.ts:26)；[当前 packages/server/src/handlers/composition-stubs.ts:65](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/composition-stubs.ts:65)；[当前 packages/core/src/session.ts:392](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:392)；[当前 packages/core/src/session.ts:429](/home/keer/workspace/aigcfroge-v2/packages/core/src/session.ts:429)；[当前 packages/core/src/session/context.ts:215](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/context.ts:215)；[当前 packages/core/src/composition/reference.ts:26](/home/keer/workspace/aigcfroge-v2/packages/core/src/composition/reference.ts:26)；[当前 packages/core/src/session/composition.ts:248](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/composition.ts:248)；[当前 packages/schema/src/custom-profile.ts:83](/home/keer/workspace/aigcfroge-v2/packages/schema/src/custom-profile.ts:83)；[旧 docs/prd/custom-mode-composition-platform.md:123](/home/keer/workspace/aigcfroge/docs/prd/custom-mode-composition-platform.md:123)；[旧 docs/prd/custom-mode-composition-platform.md:292](/home/keer/workspace/aigcfroge/docs/prd/custom-mode-composition-platform.md:292)；[当前 docs/research/upstream-v2-sync/p2-mode-preflight-2026-10-25-generic-create.md:1](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/p2-mode-preflight-2026-10-25-generic-create.md:1)。

**已有夹具（只定位、未运行）**：[当前 packages/server/test/custom-composition.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/server/test/custom-composition.test.ts:1)；[当前 packages/core/test/session-composition-references.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-composition-references.test.ts:1)；[当前 packages/core/test/session-skill.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/core/test/session-skill.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### GLOBAL-HOME-SEARCH · 全局首页的 Session 搜索与打开 · 已有

**用户入口**：已有真实 Home search 输入、聚焦、键盘选择和打开 Session；仅指当前已定位的 metadata 搜索子范围，完整跨 Project/Location parity 不因此关闭。 **输入/输出**：query、server/project 上下文与 Session records；按 Session label+projectName substring，另有 exact Session lookup，返回可导航记录，不是全文会话/KB/文件检索。

**Session/持久 owner**：server.session.list/get 与当前 Project/Session/location owner；Home index+Data cache 合并，不能另建全局 Session 真源。

**Agent**：搜索/打开不选择或改 Agent。 **模型**：搜索不调用模型。 **Instructions**：不因为导航修改 Instructions 或恢复工作。 **工具**：实际 Client session list/get、Home index/search/select；不是外部搜索 provider 工具。

**权限**：沿真实 Server/Project/Session 可见性与 canonical location；切换连接/项目不能串缓存。 **取消**：关闭搜索/改变 scope 不创建/删除 Session，不触发 runner。 **重试**：index query retry=false、refetchOnReconnect；exact lookup 与错误/空结果区分的完整 UX 仍需生产回归。 **恢复**：重连/重载索引与 canonical Data；旧路径、移动 Session 与未知 Project 名称的最终导航 parity 待验。

**消费者**：createHomeSessionSearchController→实际 Home view/controller；已定位真实入口，不按旧 UI 文件数量判断。 **旧数据**：保留 canonical Session ID/server/location/project；不能从标题或旧 path 猜新身份。

**验收（待执行）**：当前搜索子范围可复用；完整 parity 需跨 Project/Location、exact ID、冷加载/重连、scope 切换/错误与打开正确 Session，避免 mock-only 结论。 **Owner**：App/Home/Client/Core/Server；聚合范围由现行 Global parity 工作令约束。

**待核字段**：完整搜索 corpus/保留窗口、所有 Location/旧路径 parity、全字段/full-text 要求不凭当前 substring 自动承诺。

**决定函数/入口证据**：[当前 packages/app/src/home/sessions/search.ts:16](/home/keer/workspace/aigcfroge-v2/packages/app/src/home/sessions/search.ts:16)；[当前 packages/app/src/home/sessions/search.ts:41](/home/keer/workspace/aigcfroge-v2/packages/app/src/home/sessions/search.ts:41)；[当前 packages/app/src/home/sessions/search.ts:162](/home/keer/workspace/aigcfroge-v2/packages/app/src/home/sessions/search.ts:162)；[当前 packages/app/src/home/sessions/controller.tsx:62](/home/keer/workspace/aigcfroge-v2/packages/app/src/home/sessions/controller.tsx:62)；[当前 packages/app/src/home/sessions/controller.tsx:85](/home/keer/workspace/aigcfroge-v2/packages/app/src/home/sessions/controller.tsx:85)；[当前 docs/technical-debt.md:71](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:71)。

**已有夹具（只定位、未运行）**：[当前 packages/app/src/home/sessions/index.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/app/src/home/sessions/index.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### GLOBAL-SYNC-CONFIG · 全局/Location Sync、配置读取与写回 · 部分接线

**用户入口**：保留全局首页、跨项目/location聚合、canonical cache/event 重连与配置展示/修改。Current bootstrap/Client Data 已有；loadGlobalConfigQuery 返回 {}，App 配置写回明确 throws unavailable。 **输入/输出**：Server-scoped global/project/path 与 Location 数据、Config；Server config.get 实际返回 entries，App 期待的 global Config 与范围映射需核定，不能默认空对象或复制镜像 API。

**Session/持久 owner**：Project/Workspace/Location/Session 与 Core Config owner；客户端缓存只投影服务器事实。Config.latest 的 last matching document 决定每 key 选择，不能手写另一套 precedence。

**Agent**：Sync/config 加载不隐式改 Agent 或恢复 Session。 **模型**：Model/provider 刷新沿当前 V2 owner，不回植旧 LLM routing。 **Instructions**：配置改变经既有 current consumer/reload，真实 Instructions/provider 请求影响另验，空 Query 不证明更新。 **工具**：复用 current config.get/update、Project/Location bootstrap 与 Data event handling；先对齐 global vs Location entries contract。

**权限**：Server scope、Location canonicalization、配置来源与凭据保持既有边界；失败写回不得显示成功。 **取消**：导航/断开/配置取消不触发持久 mutation；in-flight query、dispose 与迟到响应需保持当前 scoped lifecycle。 **重试**：现有 bootstrap/query/reconnect 与 Data invalidation 保留；source precedence、部分失败与 stale echo 不以 {} 掩盖。 **恢复**：离线重连、服务复用、location alias/eviction 与旧数据 hydration需真实回归；不重做已验证 P0 子范围或累加日志。

**消费者**：真实 bootstrapGlobal/Home/Client Data；global config query 与 App save adapter 未接到已存在的 server config surface。 **旧数据**：旧 global/project 配置、server scope、路径与来源需明确归一化；不以合并对象猜 document 优先级或全局授权。

**验收（待执行）**：真实 config entries→明确 global/Location selection→UI→实际 update/echo→provider/Instructions refresh；跨项目/连接冷启动、部分失败、重连/迟到事件及 canonical cache 隔离。 **Owner**：Global/App/Client/Server/Core Config；global/Location shape 和保存能力合同由负责人核定。

**待核字段**：global API 选择/adapter shape、配置保存能力、完整聚合/旧路径与迟到事件 parity。

**决定函数/入口证据**：[当前 packages/app/src/runtime/server/global-sync/bootstrap.ts:52](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/server/global-sync/bootstrap.ts:52)；[当前 packages/app/src/runtime/server/global-sync/bootstrap.ts:81](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/server/global-sync/bootstrap.ts:81)；[当前 packages/app/src/runtime/server/sync.tsx:289](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/server/sync.tsx:289)；[当前 packages/server/src/handlers/config.ts:7](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/config.ts:7)；[当前 packages/core/src/config.ts:22](/home/keer/workspace/aigcfroge-v2/packages/core/src/config.ts:22)；[当前 packages/client/src/solid/data.ts:674](/home/keer/workspace/aigcfroge-v2/packages/client/src/solid/data.ts:674)；[当前 docs/technical-debt.md:71](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:71)。

**已有夹具（只定位、未运行）**：[当前 packages/app/src/runtime/server/global-sync/bootstrap.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/app/src/runtime/server/global-sync/bootstrap.test.ts:1)；[当前 packages/client/test/solid-data.test.ts:1](/home/keer/workspace/aigcfroge-v2/packages/client/test/solid-data.test.ts:1)。service/helper/fixture 的旧结果不能代替本项完整用户链。

### INTERNAL-SESSION-SHARE · 内部跨 Session reference/output/full 分享 · 已有

**用户入口**：已有 share 工具的 backend/durable inbox 关闭子范围。源→目标 Session 的 scope 与 trigger 明确；它不生成公开 URL，也不是 AI summary。 **输入/输出**：sourceSessionID/targetSessionID/scope(reference/output/full)/trigger；reference 是 ID，output 是最新 assistant text，full 是 formatMessages 决定的投影文本集合。

**Session/持久 owner**：SessionShareV2.share 验源/目标后调用目标 Session.synthetic，持久 admission 先于 advisory wake；metadata 保留 sourceSessionID/scope。

**Agent**：目标 Session 处理仍用其当前 Agent；分享本身不改目标 Agent/mode。 **模型**：分享不调用独立 summary 模型；trigger=true 的后续处理归目标 SessionRunner。 **Instructions**：共享为 synthetic 内容，非 system Instructions producer；source/trust 与当前请求边界保留。 **工具**：SessionShareTool 已注册；服务 scope/reference/output/full 与真实 content 决定函数可复用。

**权限**：share 叶对源/目标 Session ID 断言 Permission，不能把内部 service 存在当公开发布授权。 **取消**：trigger=false admit-only；已准入共享和目标 active execution 的取消分别归 Session owner。产品撤回/重复点击语义待核。 **重试**：沿 current Session.synthetic 准入身份规则；ShareInput 本身无 caller id，不能外推任意重复 share 的 exactly-once 用户语义。 **恢复**：durable synthetic 可重读并由目标 Session 继续；既有关闭子范围不扩成所有 UI/撤回/恢复已验。

**消费者**：真实 share Tool→Session synthetic→目标 current runner；当前完整产品选择/确认/撤回 UX 另核，公开链接见独立项。 **旧数据**：保留来源/目标/scope 与投影内容；full 的格式由 formatMessages 决定，不能改称外部完整 transcript 或 public snapshot。

**验收（待执行）**：复用既有 backend 子范围；新增产品消费时验证显式 scope/源目标权限、trigger、目标 history/current request、重复点击/取消/重载，AI summary 不混计。 **Owner**：Session/Core/App、/root；产品撤回/重试和 AI summary 另按其开放范围核定。

**待核字段**：完整 UI、撤回/双击重试、AI summary 与公开发布均不由当前内部分享覆盖。

**决定函数/入口证据**：[当前 packages/core/src/session/share-v2.ts:17](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/share-v2.ts:17)；[当前 packages/core/src/session/share-v2.ts:36](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/share-v2.ts:36)；[当前 packages/core/src/session/share-v2.ts:50](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/share-v2.ts:50)；[当前 packages/core/src/session/share-v2.ts:66](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/share-v2.ts:66)；[当前 packages/core/src/session/share-v2.ts:81](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/share-v2.ts:81)；[当前 packages/core/src/tool/plugin/share.ts:48](/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/plugin/share.ts:48)；[当前 packages/core/src/plugin/internal.ts:330](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/internal.ts:330)；[当前 docs/technical-debt.md:9](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:9)。

### PUBLIC-SHARE-LINK · 公开 URL 分享、访问控制与撤销 · 待迁移

**用户入口**：保留用户明确发布→copy/open link→远端会话查看→撤销/访问受限。当前兼容 share/unshare handler fail closed；内部 synthetic 分享不能代替这条用户链。 **输入/输出**：旧 ShareNext.create 返回 id/url/secret，并异步同步内容；remove 先远端 DELETE 成功后清本地记录。当前 canonical public payload、受众/保留期与 host 合同待核。

**Session/持久 owner**：旧 SessionShareTable/ShareNext 可供合同参考；当前公开 URL owner/存储与 canonical SessionTransfer/sanitize 适配尚未完成，不复制旧 V1 runtime。

**Agent**：发布/撤销不改变 Session Agent。 **模型**：公开链接与 AI summary 分开；不会因为生成 URL 就调用新模型 loop。 **Instructions**：远端展示数据、可执行上下文与秘密分开；链接可访问不证明内容同步/当前历史正确。 **工具**：复用 current Session/transfer/credential/HTTP owner，兼容 endpoint 逐个适配或退役；不将 stub 改成空 URL 成功。

**权限**：明确发布授权、源内容/sanitize、remote host/credential 与访问/撤销合同；secret 不进公开 UI 或日志。实际远程发布需独立授权。 **取消**：取消发布不产生远端对象；unshare 必须真实远端撤销 ACK，失败不能显示已撤销。 **重试**：创建/同步/撤销的重试与远端身份关联待定；旧异步 full sync 失败不能外推链接已完整同步。 **恢复**：旧 URL/secret/local row 与远端状态需核对；保留记录不等于有效访问或已撤销；离线失败策略待核。

**消费者**：旧 public-link UI/ShareNext；当前 session-instance share/unshare 仍 fail closed，真实访问/撤销产品消费未交付。 **旧数据**：旧 share_url/ShareTable/远端身份与凭据保护保留；不由迁移字段存在宣称公开 API 活跃，不静默重新发布旧 Session。

**验收（待执行）**：显式发布授权→真实 canonical export/sync→实际链接访问/访问控制→撤销→旧链接失效→重载/离线重试；内容和秘密边界、历史/留存明确。 **Owner**：Share/Core/Server/App、/root；remote destination/访问/留存与发布范围由产品 Owner 裁决。

**待核字段**：current public owner/API payload、remote host/授权/受众/保留期、幂等/同步失败/撤销恢复；不得默认远程发布。

**决定函数/入口证据**：[当前 packages/protocol/src/groups/session-instance.ts:709](/home/keer/workspace/aigcfroge-v2/packages/protocol/src/groups/session-instance.ts:709)；[当前 packages/protocol/src/groups/session-instance.ts:721](/home/keer/workspace/aigcfroge-v2/packages/protocol/src/groups/session-instance.ts:721)；[当前 packages/server/src/handlers/session-instance-stubs.ts:132](/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/session-instance-stubs.ts:132)；[旧 packages/aigcfroge/src/share/share-next.ts:310](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/share/share-next.ts:310)；[旧 packages/aigcfroge/src/share/share-next.ts:338](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/share/share-next.ts:338)；[当前 docs/technical-debt.md:10](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:10)。

## 具体待裁决项

### P1-MEMORY-VISIBILITY · 待裁决

Meta.query/search 是 project predicate；个人记忆为用户级 confirmed 集，旧 PRD 还要求适用模式与显式授权。哪些 Mode/Role 可读及缺来源处理尚未核定。

**Owner**：产品 Owner/Meta/Assistant/Core。**解除条件**：明确 Mode/Role/用户/项目可见域与授权，真实隔离及 current Instructions 消费。

**决定来源**：[当前 packages/core/src/agent/meta/memory.ts:115](/home/keer/workspace/aigcfroge-v2/packages/core/src/agent/meta/memory.ts:115)；[当前 packages/core/src/session/personal-memory.ts:158](/home/keer/workspace/aigcfroge-v2/packages/core/src/session/personal-memory.ts:158)；[旧 docs/prd/assistant-mode-personal-agent.md:215](/home/keer/workspace/aigcfroge/docs/prd/assistant-mode-personal-agent.md:215)；[当前 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:134](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:134)。

### P1-BUILD-DELEGATION-CHANNEL · 待裁决

旧协作故事明确 Build implementer；当前 Build 是 primary，internal dispatch 拒 primary。先明确真实执行通道，不能静默改分类或换 general。

**Owner**：产品 Owner/Delegation/Core。**解除条件**：确认符合 V2 Agent 分类的通道并真实验证 implementer+只读 reviewer。

**决定来源**：[旧 docs/prd/meta-agent-orchestrator.md:68](/home/keer/workspace/aigcfroge/docs/prd/meta-agent-orchestrator.md:68)；[当前 packages/core/src/plugin/agent.ts:120](/home/keer/workspace/aigcfroge-v2/packages/core/src/plugin/agent.ts:120)；[当前 packages/core/src/delegation/execution.ts:607](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/execution.ts:607)。

### P1-CUSTOM-STAGE-BOUND · 待裁决

旧 PRD M1 用户 Agent 长度固定1；当前 CustomProfile Schema 允许1–16。旧 main 对应阶段限制本轮未完整核对，保留现有已验证多消费者实现，UI阶段约束待核定。

**Owner**：产品 Owner/Custom/Core/App。**解除条件**：确定当前产品阶段与 UI bound，不凭旧数量改已验证 Snapshot/consumer owner。

**决定来源**：[旧 docs/prd/custom-mode-composition-platform.md:123](/home/keer/workspace/aigcfroge/docs/prd/custom-mode-composition-platform.md:123)；[当前 packages/schema/src/custom-profile.ts:83](/home/keer/workspace/aigcfroge-v2/packages/schema/src/custom-profile.ts:83)。

### P1-TASK-STRUCTURE-TIME-LEGACY · 待裁决

现行账本明确全量/reorder 缺结构版本、recurrence 时区 nextRun 与旧 owning marker 的缺口；已关闭的确切 marker 更正不重开。

**Owner**：产品 Owner/Task/Core与/root。**解除条件**：结构竞争、时区和旧记录修复明确合同及真实证据。

**决定来源**：[当前 docs/technical-debt.md:14](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:14)；[当前 docs/technical-debt.md:19](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:19)。

### P1-WORK-CUSTOM-WORKFLOW-ENTRY · 待裁决

Work 用户要求 Workflow 消费，但现有 WorkflowExecution.root 只接受冻结 Custom root；入口需明确 start/upgrade/关联，禁止隐式重分类。

**Owner**：产品 Owner/Work/Custom/App/Core。**解除条件**：明确符合 mode 冻结与 atomic composition 的用户路径。

**决定来源**：[当前 packages/core/src/workflow/execution.ts:179](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:179)；[当前 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:140](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:140)。

### P1-UNKNOWN-SIDE-EFFECTS · 待裁决

外部 thread continuation 不证明旧 attempt 安全；缺日志、retention/删除与未知 side effects 不能靠自动 retry 推断。保留 V2 有预算的现有恢复子范围。

**Owner**：产品 Owner/Core/Delegation/Workflow与/root。**解除条件**：明确具体 attempt 的持久 reconciliation、保留/删除与人工路径。

**决定来源**：[当前 packages/core/src/delegation/service.ts:1104](/home/keer/workspace/aigcfroge-v2/packages/core/src/delegation/service.ts:1104)；[当前 packages/core/src/workflow/execution.ts:840](/home/keer/workspace/aigcfroge-v2/packages/core/src/workflow/execution.ts:840)；[当前 docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:134](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md:134)。

### P1-PUBLIC-REMOTE-POLICY · 待裁决

公开 URL 的 destination、受众/凭据/保留/撤销恢复未在当前 owner 中闭环；内部分享关闭不授权公开发布。

**Owner**：产品 Owner/Share/Server/App与/root。**解除条件**：具体可审查 payload/访问/撤销实现与独立远程发布授权。

**决定来源**：[当前 docs/technical-debt.md:10](/home/keer/workspace/aigcfroge-v2/docs/technical-debt.md:10)；[旧 packages/aigcfroge/src/share/share-next.ts:338](/home/keer/workspace/aigcfroge/packages/aigcfroge/src/share/share-next.ts:338)。

## 切片关闭与技术债

仅接 service/HTTP 是简单运输切片，仍欠用户确认、当前 Instructions/真实 runner 消费、生产 daemon/adapter 启动、历史/引用与恢复 UI。完整路径应复用已有持久 owner、当前 renderer/Panel/Command 与真实 transport，不再新建 registry、TaskDriver、System Context 或 provider loop。

本报告明确登记每项未交付范围、Owner 与解除条件，不关闭任何账本条目。主线关闭实现切片前按现行 Slice Checkpoints 把实际未落地范围登记到账本/coverage manifest；冻结期本取证者不编辑这些文件。未知字段保持待核，不能用 false、空对象、空成功、最新资产或历史 passing log 填补。

同名 JSON 保存全部合同字段、来源引用、局部输入 SHA-256 与 MD 哈希；主线可据其选择具体下一切片，本文不重做整项架构报告。
