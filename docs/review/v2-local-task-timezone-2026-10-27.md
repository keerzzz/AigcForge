# Task 时区本地提交复审

2026-10-27。范围：固定时区、DST 与到期队列，以及取消/重新排期保留原固定时区。遵循旧仓 CLAUDE 的复用、数据流与验证规约，运行和准入语义采用本仓 AGENTS 的 V2 合同。使用 quality-to-pr、reuse-first-refactor 和 effect 技能核对。

## 行为与归属

- [nextRun](../../packages/core/src/session/schedule.ts:105) 复用现有 cron 方言；显式 named timezone 的缺失时间跳过，重复时间只采用首次。无时区历史数据保持历史路径。
- [SchedulerCore.arm](../../packages/core/src/session/schedule-core.ts:58) 以 cron 和 timezone 决定排期身份；同一排期保留到期时间。tick 比较队列项身份，避免等待前一任务时触发已经取消或改期的后续任务。
- [recurrenceFor](../../packages/core/src/session/task.ts:380) 由校验、update、replaceLegacy 共用；新 recurrence 省略 timezone 时保留已有固定值，显式值替换。没有新增表、公开字段或迁移。
- SessionTaskEvent 归一化留在工作区，未进入此提交。

## 实际验证

在从 HEAD 加八文件补丁导出的隔离副本验证，源码 tree 为 `16e2aa9782c6f23af0d3fb6c900af440a6cfc016`。workspace 包解析指向隔离副本；仅复用已安装外部依赖。所有命令运行前后源码哈希相同。机器记录见 [task-validation.json](evidence/v2-local-commits-2026-10-27/task-validation.json)。

| 检查 | 结果 |
| --- | --- |
| Core Task 服务与三个 schedule 测试文件 | 115 pass / 0 fail / 344 expects |
| Core 包 typecheck | exit 0 |
| 隔离版本 Server Task HTTP | 6 pass / 0 fail / 148 expects |
| 八文件 lint、四生产文件 AST、格式、diff check | 各 exit 0 |

lint 运行现有一条规则。AST 保留 postinstall/runtime binary resolution 警告。原工作区的 HTTP 7 项与历史 Core 全包不是本次隔离提交的验证数字，不累计。保留原红测和类型失败记录，详细本地证据目录为 `docs/review/evidence/v2-continuation-2026-10-27/`。

## 审批

主智能体已追踪 nextRun、Task 读写、task_schedule 与 SchedulerCore 的调用，复核已批准的 DST/队列审查和新增 retention 两路径。当前限定提交未发现阻塞项，批准本地暂存提交。补充独立 retention 复审随后完成：helper、三处调用、两条真实 Service/DB 回归及其六份记录均核验通过，未发现 blocker。

## 剩余范围

V2-C-TASK-CONTRACT / V2-C-TASK-SCHEDULE 仍开放，Owner 为主智能体与 Core/Client/Server/App 负责人。解除条件：客户端当前时区持久承载，prompt/command/tool/child 与 Workflow 冷恢复来源，已裁决的全量/排序冲突拒绝，以及真实 Work claim/CAS、执行、取消和冷恢复。此次提交不关闭整个 P4。
