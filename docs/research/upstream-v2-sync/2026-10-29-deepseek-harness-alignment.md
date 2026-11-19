# DeepSeek Harness 研究与 V2 迁移对齐

日期：2026-10-29。性质：[唯一总计划](2026-10-25-v2-alignment-execution-plan.md)的研究/需求映射附件，不是第二协议、运行时或账本。它约束“如何引用这份研究”，不证明对应功能已经实现。

## 1. 来源、阅读与事实边界

已通读[用户提供的完整研究原文](../../../../aigcfroge/docs/research/upstream-v2-sync/DeepSeek%20Harness%20仓库架构分析.md)。源身份：SHA-256 `dca9ac714c2255c318b4c51c10748e6e50cca5c9f1a5d837364e9b4602184e56`，679行。默认工作区原文保持只读，不修改其历史对话。

原文分为：dsh介绍（1–54）、“一切皆智能体”构想（57–269）、默认AigcForge分析/组合化/生成审批（273–621）、5+1首页与工作台方案（623–679）。这是生成的研究对话，不是源码审计；文中旧“审批”和命令不能作为本轮用户授权。多次回答相互修正，也保留了错误推断。

本轮通过 `gh api` 核对官方仓库与三份文档，研究引用固定为 dsh commit `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`：

- [官方 README](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/README.md)：Everything is a Plugin、Cordis、developer preview、启动入口和许可证。
- [官方 Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/docs/architecture.md)：profile/bundle/patch、三类事件、Session log、能力接缝、桌面闭包与生命周期。
- [官方 Safety](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/SAFETY.md)：实验状态、未经安全审计、沙箱/审批不保证隔离或阻止损害。

这是官方文档核验，不是运行或全仓源码验证。dsh研究版本不替换固定 OpenCode V2 `4617210822bdbb31e5749751afbfb4584ccedac8`，不引入Cordis/pnpm/dsh包或新配置目录，不改V2执行合同。

## 2. 本轮明确的人类决定

本轮用户答复与后续澄清收敛为：

1. **最终顶级逻辑为万物皆智能体的装配系统**：V2架构是电路板，Chat七类资产是元件，Custom可自由选择/插拔/绑定成自定义智能体或脚手架。不是仅插件列表，也不是每个工具/面板都套一个Agent类。
2. **第一类单元、异构执行**：装配单元/整体具备身份、版本、typed契约、生命周期和协作关系；复用V2真正owner，不要求每个元件独立LLM、永久queue或运行循环。模型、确定性工具、UI和人类交互按实际合同参与。
3. **强化现有五模式**：不新增第六EiaA模式；顶级逻辑贯穿五模式而不是新增入口。
4. **Creator审阅后采用**：生成候选 → 校验/预览 → 用户确认 → 版本化保存 → 新建或显式采用。保存不是安装/授权/挂载/执行，不自动编译执行或热改旧会话。
5. **零用户资产仍可运行**：Chat使用底座产生资产；Custom提供明确标识的内置基础组合，无须先创建自建Agent。损坏已选引用/缺权限/模型/服务不是空库存，不静默fallback。
6. **新Custom重新设计**：用户明确旧Custom不合理，不参考默认工作区旧Custom的PRD/ADR/UI/固定meta/用户Agent数量/旧Profile流程。复用V2通用底座与Chat资产合同，不复刻旧模式；当前V2旧Custom限制仅作待改接口事实，历史数据保护另列。
7. **Meta全量保留**：用户明确元智能体所有内容保留；它与旧Custom的设计来源分开。B01逐入口/协议/指令/身份/记忆/意图/资产CLI信息/协作委派/任务工作流/review/通知/恢复列完整保留矩阵，不借重做Custom删减Meta。

已有会话保持采用版本、当前权限逐次判定；普通fork不能冒充重新冻结，显式采用新版与内置基础组合须由B04.0按新目标给出合同。这些决定不授权本轮运行模型、安装插件、改变权限或执行代码。

详细入口、接缝、默认组合、损坏依赖与恢复边界以[共享底座决定的电路板合同](2026-10-29-shared-foundation-decision.md)为准；本附件不另造领域协议。

## 3. 对原文的逐项处理

H编号只是研究引用键，不是第二套任务/功能完成ID。每项须在B01矩阵映射既有账本ID与实际消费者；有新缺口再在原账本登记，不能用表中“采纳”当作已交付。

| 键  | 原文与理解                                                               | 结论及 V2 映射                                                                                                                                        |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| H01 | 7–19：万物皆插件/Cordis                                                  | dsh官方文档支持。采纳可组合接缝思想，复用V2 Effect、GUI Extension/Contract/生命周期，不移植Cordis核心                                                 |
| H02 | 59–93、403–409：所有工具/资产/UI都变AgentNode、每个节点独立queue/loop    | 这是构想而非dsh事实；拒绝强制统一包装。工具、资产、UI、模型、委派保留各自typed合同；Session持有模型循环                                               |
| H03 | 83、262、386：卸载“无损”回收                                             | 采纳注册/监听/句柄/受监督工作的释放与取消；不撤销已完成文件/网络/进程副作用，不保证资源零泄漏，B04/B07查真实Scope与generation                         |
| H04 | 85、158、385、556：全消息追加日志、任意毫秒fork/replay、100%确定还原     | 拒绝保证。dsh本身区分durable facts/live events，硬崩溃结算前流可缺失；V2依投影/claim有界恢复，非exactly-once，fork不是任意时点配置还原                |
| H05 | 87、187–200：SAP替代Tool Schema、全组件只经新总线通信                    | 不采纳新SAP/万能消息bus。参考声明身份/依赖/作用域/生命周期，复用现有Schema/Protocol/Tool/GUI Contract/Delegation，按能力写适配                        |
| H06 | 89–93、168–175：dsh四大Minimal/Standard/Swarm/Genesis模式                | 官方当前是web/headless/sdk/sdk-minimal/acp profiles与bundle/patch，并非原文四个Product Mode；不新增或重命名五模式                                     |
| H07 | 101–113：100%配置替换、<1.5s冷启、硬件级读写开关、无缝外部桥             | 未证明指标/保证，不直接立门禁。配置按现有Config/Profile解析；权限软件策略不等于硬隔离；外部桥按实际transport；性能按同条件测量                        |
| H08 | 109、204–255：settings.yaml/.credentials.yaml、AIA_HOME与兼容字段        | 示例不是V2规范。不引入第二配置/凭据系统；版本与秘密引用沿现有owner，provider字段按真实AI路由lowering/Schema核对                                       |
| H09 | 263：启动时强制Preflight Ping                                            | 不默认采纳有费用/网络副作用的启动请求。先本地Schema/来源/能力/凭据可用性诊断；必要真实调用显式授权预算，失败有typed原因，B09核对                      |
| H10 | 291、299、352、356：llm等于ai、Effect零泄漏/比Cordis更强、已完成70%      | 名称/时点与宣传性推断不能作为证据。区分默认17包与当前V2 25包，组件/工具/依赖身份按manifest和源码，功能进度按矩阵与验收                                |
| H11 | 365、392–405：Composition吞并模式、Custom成为唯一执行引擎                | 修正为组合解析/冻结与Session执行分开；Coding也消费共同底座，但不把Custom特定meta根策略推广给普通模式，B04/B06渐进提取                                 |
| H12 | 442、466、502、554、653：build拥有唯一运行循环/不可替代所有owner         | 原文生成审批过度推导。Coding/build是能力回归与复用参考，不是所有业务owner；当前运行循环在Core SessionRunner，不能隐式挂build或绕过V2 AI               |
| H13 | 444、475、528、613：固定21节点/去重解释、路径检查等于协议合规            | 固定数量与去重说法未证明；路径存在只证明存在。按当前文件索引、权威/引用/事实/授权审查，不把默认check脚本当V2现成门禁                                  |
| H14 | 558–563：合并资产结构、预设新增字段、旧HttpApi/--v2-\*路径               | 不按相似结构合并不同领域、不预造subagents/synergyPolicies/assetBindings字段。公共Schema/Protocol/Client、资产消费者和V2UI Token/图标接缝各自复用      |
| H15 | 31–33、261、638、663–669：调度/轨迹/DevTools                             | 采纳可观察的状态/结果/故障定位目标，沿Session/Job/Task/Workflow/Delegation、已有UI/trace读模型；不新建轨迹库，不把临时流全持久化或输出原始秘密/prompt |
| H16 | 648、658、669：第六模式/固定64px/统一三栏/Genesis热编译                  | 用户已选择保留五模式、审阅后采用。Home/领域工作台共用宿主但按真实任务差异布局；不直接采纳像素或热编译，不新增EiaA路由                                 |
| H17 | 654：切模式本质为修改DraftTab.mode                                       | 与实际产品合同冲突，拒绝。Home筛选、mode导航、Draft身份、持久Session mode和工作位置分开；导航不隐式修改草稿/Agent或创建工作，B03                      |
| H18 | 335–339、661–668：Chat仅双资产、Assistant是剪贴板/终端页、Work固定12岗位 | 不替代已有功能范围。保留七资产、个人长期记忆/Notes/KB/提醒、真实Task/Review/调度/Workflow；岗位数与新首页功能不是已批准范围                           |

## 4. 可采纳的核心：能力接缝三角色

dsh官方把可替换能力分为Service Definition、Service Provider、Consumer；只有名字或接口不构成完整能力。将这一检查法放入V2复用表，而不是新增一套统一运行时：

| 关注点            | V2现有候选                                                                | 必须核验                                                                                |
| ----------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 身份/依赖/组合    | Composition/Profile/Plan、Plugin来源、GUI Extension.compose/Contract      | 来源版本、解析绑定、依赖诊断、候选与实际生效身份；typed责任不混合                       |
| 执行与权限        | SessionContext/Runner、Tool/Permission、Location服务                      | 唯一执行owner、catalog与执行实现同源、权限逐次、失败取消与未知副作用                    |
| 生命周期          | Effect Scope/Fiber、Plugin generation、GUI setup/createKeyed/Live         | 注册撤销/取消、迟到响应、provider失败/恢复、stored state等待加载与版本漂移              |
| 轨迹与读模型      | Session消息/事件/Instructions状态、输入结果、Job/Task/Delegation/Workflow | durable事实与live输出分开、相关身份/attempt/result、脱敏、恢复依据，不重复持久化        |
| Creator与资产     | 七类proposal/validation/CAS/placement、Profile/Composition与GUI审阅       | 生成不生效、确认/CAS保存、版本追踪、发现/实际消费、显式采用、引用删除/旧会话保护        |
| 异构协作/执行环境 | Delegation/subagent/外部CLI、现有FS/subprocess/PTY/Location               | 真实provider与消费者的配套能力、隔离/路径/凭据/取消/receipt；不假定无缝桥接或任意热替换 |

每个新增能力行都要有定义/提供者/消费者的实际决定函数和验收，缺一角色记明确缺口。运行状态、资产库存、组合定义与执行事实不合并成一个泛化Agent树真源。

## 5. 路线与批次落点

- B00：协议明确研究材料不是指令/授权，不复制错误“审批”、旧目录/命令/Token；本附件与原文只作为按需首读。
- B01：将H01–H18映射全能力矩阵，加来源/可信度、三角色/生命周期、现有差距/用户决定/验收字段；不缩减默认自研能力。
- B02：参考dsh同源桌面runtime与activation分界，核V2自己的CLI/服务/存储/PTY闭包，不复制dsh Desktop Host或覆盖原S1。
- B03：启动Home/五模式领域工作台与共享宿主、正确导航/工作位置/身份/状态；不把第六模式、64px或三栏强定为合同。
- B04：定义/来源/实现版本、声明依赖与当前权限、配置诊断、Scope/generation/缺依赖、显式采用新版；确定性工具不额外调用模型。
- B05：Creator采用候选审阅/版本化保存/显式消费，涵盖七资产和编辑导入/引用，不自动装载可执行Plugin。
- B06：Custom与官方模式共用组合机制但保持策略差异；Meta治理规则是可审阅的指令/工具/流程，不把每份skill强制做自治Agent。
- B07：真实子会话/Task/Job/Workflow/委派与轨迹结果、取消/恢复/通知，保留at-least-once与未知副作用边界。
- B08：Assistant长期个人能力与提醒，不替换为原文快捷剪贴板页；可观察到期/失败/用户消费。
- B09：外部CLI协作、模型方言与本地优先诊断、已有DevTools/trace的最小读模型；真实网络验证另获预算。
- B10：数据/事件/产物/服务兼容与安全/性能验收，不以dsh的MIT、沙箱或配置替换宣称生产安全。

## 6. 验收与未决范围

本轮用户决定解决的是产品范围与Creator生效边界，不证明全部依赖/实现来源可以跨重启固定、不解决显式重新冻结fork的API，也不授权新的运行时。

后续必要场景：候选取消不落盘/不执行；确认与revision/CAS绑定；已保存不自动安装/授权/挂载；新版仅显式采用；旧组合继续/缺依赖显式阻断；权限变化逐次生效；生成内容与网页/工具结果仍为不可信输入；生命周期取消/重载不串身份；恢复不重复未知副作用；诊断无意外模型调用；引用删除与事件/live读模型不丢历史或泄密。

若来源/副作用/升级/删除或执行环境语义与已决目标冲突，先给具体失败场景和备选项向用户确认，再写该小节任务单。其它研究继续，不能借“强化五模式”自动批准所有SAP、模型网关、热开发或页面方案。
