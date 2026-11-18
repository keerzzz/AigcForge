# Meta 跨模式、Goal 与 Schedule 实施审批

日期：2026-11-13。状态：用户已批准工程实施；真实模型验收暂不运行。
工作区：/home/keer/workspace/aigcfroge-v2；分支：v2-dev。
HEAD：0a09f6bccdb71f1234eea759eb99e8a336d1d4da。

本文件记录本次审批选择；数据、状态、接口和验收合同以[完整方案1.2](/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-11-13-meta-cross-mode-goal-schedule-closure-plan.md)为准。本页不另定义执行协议。

## 建议批准的结果

- Meta跨五种模式协调；创建、委派和继续真正独立的顶部主会话。
- 原Task保存每次operation、目标输入、完整结果与源消费，形成重试、取消和恢复闭环。Meta的A1、A2、B1支持按需双向输入/输出、准确replyTo和直接跟进；Build/Plan保留任务执行与自动结果回传。
- 持久Goal支持完成条件、实际证据、预算和暂停/恢复。
- 一次/周期Schedule支持已有会话、首次创建后复用、每轮新建；补齐现API stub、timer装配与旧Task兼容。
- 仅Meta可用的主动入口、原右栏、dock详情、依赖/往来和标题引用chip；SSE消息流展示同一批持久事实，Build/Plan仍可查看任务历史与回执。
- 各包定义/提供者/消费者、正式生成、迁移、36项验收和同源Desktop/CLI签收。

## 审批选择

1. **关系**：主动跨会话创建/关联/发送限当前Meta合法独立root；目标使用自身模式、Location与权限。Build/Plan执行与自动回传保留；切换Agent跟随后端capability撤出新入口，历史与SSE回执保留。
2. **Goal**：每协调会话同时一个运行Goal；保存多个；模型提出候选，实际工件或明确人工验收裁决完成。
3. **定时**：原Schedule统一规则；每次运行有独立occurrence；同规则默认不重叠，错过多期合并一次或明确skip。
4. **界面**：手动委派root打开顶部；定时后台root保存后由用户打开；侧栏收起不暂停任务。
5. **现场**：继续现v2-dev；保护已有WIP。工作目录/Worktree按每任务明确选择，不静默切用户分支。
6. **实施**：按MP01–MP07开展必要源码、测试、正式生成、隔离本地服务与验收；提交、推送、合并、发布及现用数据库修改仍另需明确授权。
7. **真实验收预算建议**：DeepSeek Flash协调/worker合计最多24次Physical Attempt；现有外部Claude/Codex路径合计最多8次实际provider请求。逐轮记账，触及上限不追加请求。
8. **范围**：本片同服务器跨模式/Location；跨服务器执行、关机云端调度、新DSH/ZCode执行adapter在完整方案§14保留owner和解除条件。

2026-11-13用户明确答复：**“批准工程实施，真实模型验收暂不运行”**。据此批准完整方案1.2的工程实现、确定性测试、正式生成、构建和隔离本地无真实模型验收；P07真实provider预算本次不启用，模型请求保持0。最终真实产品链继续作为待签收项，不能以工程通过代替。

## 复审与验证

[独立设计复审](/home/keer/.codex/outputs/2026-11-13/meta-plan-approval/reader-review.md)已接受修订版。实际修正了多operation/可信来源、retry先后、输入membership与取消范围、原恢复入口、Goal条件/计量、Schedule旧状态/运行中CAS，以及API消费者与批次依赖。

1.2定向复审已接受Meta主动协调边界、旧share入口检查、Agent切换与历史保留、actor/contentSource区分、SSE消息流与侧栏消费。身份接口真实接线及Composer待提交Agent的衔接分别归MP01/MP03。签收方案为608行，SHA-256：64e251ed37cbdd164f6c241461cf3e46ee39a0b60a35d1898c639c9a7ee6d492。该工程范围已获用户批准。

[确定性文档检查](/home/keer/.codex/outputs/2026-11-13/meta-plan-approval/document-validation-final.json)核对引用、25包、36项验收、格式和源码/暂存区保护。设计复审通过不等于功能通过；实现与功能验收尚未运行。方案与审批文档是本轮仓库新增内容。

Root按完整方案与MP01任务单的批次退出条件实施；真实模型验收暂不运行，总目标在工程与最终功能签收前保持active。
