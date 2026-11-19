# 会话内容、回答操作与侧栏实施计划审批

结论：**批准按SC00–SC09分片实施。** 本次未发现阻挡计划派发的问题。先派发SC00；每片由当前Root审查实际改动和验证结果后，明确派发下一片。用户已授权此实施与审批安排，普通可逆修复无需逐次向用户再次确认。

## 审批绑定

- 工作区：`/home/keer/workspace/aigcfroge-v2`；分支：`v2-dev`。
- 当前HEAD：`0a09f6bccdb71f1234eea759eb99e8a336d1d4da`。
- 计划：[侧聊、子会话与共享SSE底座实施计划](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-10-side-chat-subagent-implementation-plan.md)。
- 本轮计划SHA-256：`b6680319d1c46481e6557e8067effa87ceaa698567f2ca56df2f0f9217ee012b`。
- 审批日期：2026-11-10；Root最终裁决，独立后端/UI复审辅助。
- 实施模型：`gpt-6.1-sol`，思考：`max`；由新会话执行。

## 依据与复审

读取当前V2的CLAUDE现行段、根AGENTS、ARCHITECTURE、DESIGN、testing，以及App、GUI、SessionUI、UI、Schema、Core Tool、Plugin、Desktop、CLI和E2E/performance的适用指南；公共模型内容接缝按AI指南相关段复核。Core/Server/Protocol/Client不存在的包级AGENTS未被臆造，适用根与最近owner规范。Effect与RTL技能落实到服务、取消、测试、响应式及混排；图标依据实际primary/additional目录合并函数。

已读取最近测试的实际断言，包括SharedEvents多消费者、volatile流不请求replay、API替换、Fork持久投影和边界、子会话导航、候选保存的目标冲突、BTW旧生命周期、Composer草稿/光标与扩展宿主A→B→A身份。未用测试文件存在代替行为覆盖，也未运行产品测试来证明一份文档已经实现。

独立报告：

- [后端/契约审批](/home/keer/.codex/outputs/2026-11-10/side-chat-plan/backend-plan-review.md)：approved。
- [UI/测试合同审批](/home/keer/.codex/outputs/2026-11-10/side-chat-plan/ui-plan-review.md)：通过。
- [新增会话身份分析与增量审批](/home/keer/.codex/outputs/2026-11-10/side-chat-plan/session-identity-backend.md)：approved，不改变原结论。
- [新增会话挂载分析与增量复核](/home/keer/.codex/outputs/2026-11-10/side-chat-plan/session-mount-ui.md)：可用于实施；提出的共享草稿寿命场景已补入§11.4。

以上报告分别绑定其读取时的计划版本；最终Root复核增量为：资产捕获收敛至默认最新已完成回答条件、补充§11身份/挂载和草稿寿命、按用户要求明确新会话及逐片审批。最终身份以上列计划哈希为准。

## 第一性裁决

| 事实依据                                                                 | 选择                                                                                | 验证责任                                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Session ID被主键、inbox、事件aggregate、执行coordinator和receipt共同引用 | 保留持久ID；在宿主补不带假tab的目标引用和Panel挂载，布局source与内容target分开      | SC01–03验证跨server同ID、多source同target、替换/卸载/恢复与草稿寿命 |
| 同ServerRuntime已有SharedEvents和一个Data，视图只是消费者                | 复用共享连接及数据；补初始水合、重连和旧响应处理，不新建SSE/状态缓存                | SC01使用原Client/Data keeper，SC03/07验证实际多会话视图             |
| Fork复制真实历史，咨询只需参考，普通capture先生成用户草稿                | 三种动作保留各自语义；Fork公开through，咨询建普通Chat，资产沿原propose/review/apply | SC04–07验证边界、输入归属、用户发送与保存流程                       |
| 现Slot具备typed输入、排序与卸载；现回答操作位置缺失                      | 扩展原SlotMap；Fork、资产和侧聊贡献轻量操作                                         | SC05/06/07补原host与App keeper，不加第二注册表                      |
| child/Meta/Delegation保存真实来源与执行绑定                              | child先只读查看，正式控制沿原owner；视图位置不改变权限或回执                        | Core/Server原subagent、Meta、Delegation keeper及SC09真实链          |

采用简单方案的已知代价已写入计划：咨询参考会沿正常历史参与压缩，需要精确原文时读取已保存输入。没有已运行的第二ID生成策略，不建立IdProvider；没有第二传输需求，不建立多协议SSE框架。

## 已修订的实质问题

1. 普通Session.create会adopt已存在ID。咨询操作新增自己的持久来源和首问归属，防止占用无关会话；不恢复旧exact-payload retry。
2. 首问重试区分pending补advisory wake与promoted/cancelled读回，避免漏wake或重复provider执行。
3. 普通prepare的hook可改files/metadata。服务参考在prepare之后附加，digest按实际持久bytes计算。
4. 多事件创建/准入优先复用同aggregate的Bus.publishAll；若hook要求先落库，SC00明确两阶段持久归属及恢复，禁止把两次HTTP调用说成原子。
5. 消息水合的API/current检查与metadata读取不同。SC01用真实竞态验证，在Data owner修复，不把每个Panel变成补偿器。
6. 请求响应面以当前主目标优先、否则选中侧聊为规则；保持blocked，不增加全局审批管理器。
7. 全局SSE不提供历史回放，retained Bus失败独立沿原owner收敛。
8. 默认资产入口只显示最新已完成回答，未成立的“点击旧回答抓错最新回答”假设已撤回；新接口仍传精确目标。

## 明确的规范差额

- DESIGN的“请求留中间Composer”在SC00澄清为请求属于实际交互Session的Composer。权限判定不变。
- GUI AGENTS禁止Timeline工作的一句，在SC05按用户要求窄化为允许轻量动作贡献；保留禁止逐行订阅/异步请求/后台执行的性能依据。
- 用户已明确要求简体中文与去除中英文边界空格；按该要求完成翻译和既有locale恢复，不以一般性English-only规则推迟。

这些差额由用户目标和可观测实现需求驱动，已在计划列明，不新增无风险条目支撑的许可流程。

## 文档核验与实施边界

[文档核验工件](/home/keer/.codex/outputs/2026-11-10/side-chat-plan/document-validation.json)由[可重跑脚本](/home/keer/.codex/outputs/2026-11-10/side-chat-plan/validate-documents.py)生成：检查本地引用及行号、实际manifest命令、计划差异与原六份WIP哈希、分支/HEAD和暂存区。最终轮命令从V2目录运行，退出0；详细计数以该工件为准。

独立报告与本文是计划审批；生产行为须由每片实际工件接受。SC05沿new-session的Fork keeper扩展through；SC07更新旧BTW一次性generate/无输入框/关闭删除断言，保留旧记录兼容与新持久侧聊各自合同。相关真实执行仍需处理原retained Bus/source失败，不能用UI模拟代替。

本轮仅新增计划与审批文档及独立研究工件。原生产代码、当前手测桌面和Source未改变。后续源码/依赖/产物按实际小节冻结，测试/构建串行，必要真实模型与桌面验收由Root在该片任务单给出隔离目标及预算。
