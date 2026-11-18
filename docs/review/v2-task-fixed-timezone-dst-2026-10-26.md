# Task 固定时区、DST 与到期队列检查点

2026-10-26，`/home/keer/workspace/aigcfroge-v2`，`v2-dev`，HEAD `251c0fe38041a326e624db464d1ee0efd1522881`。八份源码及八条验证记录已获 [限定本地审批](evidence/v2-command-resume-2026-10-26/continuation/protocol-approval-task-timezone-dst.json)，完整 P0–P6 未完成，未提交或推送。

人类裁决为任务固定时区；未指定时保存客户端用户当前时区；不存在的本地时间跳过，重复的本地时间仅执行首次一次。本次交付显式时区计算、持久字段读取与校验、队列身份和到期时间保留。客户端缺省和真实 Work 到期执行仍需后续接线。

## 已有 owner 与决定函数

`packages/core/src/session/schedule.ts:105` 继续保留历史无时区 field search，仅在它返回非未来值时借用当前本地 named timezone 修复。显式时区复用 parseCron、Effect Cron 的 UTC 日历枚举和 DateTime 的 earlier 解析；`:188` 至 `:193` 的完整本地日历往返比较排除不存在时间，`:163` 的严格未来边界跳过已过去的首次重复实例。原 AND 日约束与 Sunday 7 保留，未新增调度或时间库。

`packages/core/src/session/task.ts` 的 nextRunFor、scheduleWriteViolation 和工具 `packages/core/src/tool/taskschedule.ts` 的调用均传入持久 recurrence.timezone。已存在的异常计划可取消，重新安排仍需有效时区和未来匹配。

`packages/core/src/session/schedule-core.ts:69` 的身份包含 cron 与 timezone。未变计划复用原 deadline，防止 arm-before-tick 把已到期周期推至下一次；`:95` 的 queue entry 身份比较阻止前一个异步 trigger 执行期间已经改期、取消或删除的后一个候选被提前触发。测试用 Deferred 就绪与释放信号，未使用固定 sleep 等待并发。Assistant daemon 使用 Effect 时钟，对应两处 fixture 改用同一时钟。

## 验证和复审

最终 [输入](evidence/v2-command-resume-2026-10-26/continuation/task-timezone-dst-final-input.json) 和 [独立证据复审](evidence/v2-command-resume-2026-10-26/continuation/task-timezone-dst-final-independent-review.md) 绑定当前八源。Core 全包为 7466 pass、365 skip、0 fail、110816 expects；这是 Prompt 后续服务图变更之前捕获的运行版本。Server SessionTask HTTP 为 7 pass、0 fail、163 expects。定向 124/0/372 不与全包累计。类型、四生产 AST、格式及定向 lint 均有独立记录；较早八文件格式/lint匹配当前七源，工具 import 整理后的单文件补充检查匹配当前工具源码。

纽约 gap/fold、Lord Howe 半小时 gap、Apia 缺失日期、密集 fold、legacy 非未来结果、无效时区、空历法/越界起点、只改 timezone 的重排、取消/改期/删除交错均有行为覆盖。[算法独立复审](evidence/v2-command-resume-2026-10-26/continuation/dst-final-recovery-review.md) 核对安装的 Effect 4.0.1；[队列复审](evidence/v2-command-resume-2026-10-26/continuation/due-queue-final-independent-review.md) 保留其对应版本。

原 tests-only、DST 规则红测 68/17/244、队列 guard sensitivity 8/3/23、Assistant 时钟不一致 35/2/106、格式和旧值 import alias AST 失败分别保留。修复后的成功不改写历史失败。提交列表通过 `git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 生成，见 [commits](evidence/v2-command-resume-2026-10-26/continuation/task-timezone-dst-commits.txt)。

## 未交付

V2-C-TASK-CONTRACT：客户端缺省捕获、durable prompt/command/tool 源时区、child 继承、Workflow 冷恢复源，以及全量 reconcile/reorder 结构并发仍开放。Owner 为主智能体及 Client/Core/Server；解除为真实创建入口、持久恢复和结构竞争回归。

V2-C-TASK-SCHEDULE：真实 Work adapter/claim/CAS/执行/取消/冷恢复仍开放。当前 Assistant adapter 不调用 recurrence rearm；同一任务取消或改期后的旧回调回写契约须在真实 Work adapter 接线时解决。不能用通用 SchedulerCore 夹具或 Assistant delivery 宣称 Work 到期执行已交付。

canonical ledger 保留剩余范围。客户端默认时区候选、Prompt、五类其余资产、Meta/Assistant/Custom、Delegation/Workflow、全局/导入及 P6 按现行计划继续。
