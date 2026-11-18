# Task 固定时区保留检查点

日期：2026-10-27，Asia/Shanghai。状态：实现与适用验证完成，独立复审及限定协议审批待完成。工作区 `aigcfroge-v2`，分支 `v2-dev`；未提交。

## 问题与修改

已有固定时区的 Task 在全量更新或 legacy replace 中提交新的 recurrence，但省略 timezone 时，整条 recurrence 覆盖原记录。取消任务也会丢失时区，后续重新排期不再按原固定时区计算。

两条新增的真实 SessionTask 服务用例复现该问题：原 57 个用例通过，两条新用例在取消后的断言失败，收到的 recurrence 缺少 `America/New_York`。原红测保留为 [task-retention-red](evidence/v2-continuation-2026-10-27/task-retention-red.json)。

修复复用 [SessionTask.recurrenceFor](../../packages/core/src/session/task.ts:355)：输入整条 recurrence 省略时保留 prior；输入显式 timezone 时采用输入；输入 recurrence 但省略 timezone 时保留已有固定 timezone。校验与 update / replaceLegacy 两个持久化写入点共用该规则。原 DST 算法、事务、revision、事件和取消非法历史计划的规则保持原路径。没有新增公开字段或迁移。

## 验证

[最终输入](evidence/v2-continuation-2026-10-27/task-retention-final-input.json) 绑定两个变更文件与六份最终记录；日志哈希及运行前后源码均已核验。

| 范围                                   | 结果                                           |
| -------------------------------------- | ---------------------------------------------- |
| Core Task 服务及三个 schedule 测试文件 | 115 pass / 0 fail / 344 expects                |
| Server Task HTTP                       | 7 pass / 0 fail / 163 expects                  |
| Core 类型检查                          | exit 0                                         |
| 两文件定向 lint                        | exit 0，0 warnings/errors，当前配置为 1 条规则 |
| 生产文件 AST、两文件格式               | 各 exit 0；AST 运行时二进制解析警告保留        |

首次类型检查发现测试将 optional recurrence 与 nullable SQL 字段直接比较；已在断言前确认持久 recurrence 存在，未使用类型逃逸。最终行为与类型检查重新运行，上述 115 个用例只计最终一轮。未运行 Core 全包，不把 2026-10-26 的历史全包结果计作当前源码验证。

## 剩余范围

本修复只保护已有固定时区。`V2-C-TASK-CONTRACT` / `V2-C-TASK-SCHEDULE` 仍由 Core/Client/Server/App 与主智能体负责：客户端缺省捕获、持久 prompt/command/tool/child 来源、Workflow run 冷恢复来源、结构并发冲突拒绝、真实 Work 执行及取消恢复均继续开放。解除条件仍为各条真实调用链和持久生命周期验证，见 [唯一技术债账本](../technical-debt.md) 与 [现行计划](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)。旧 19 文件缺省时区候选需重放到此 owner，不能覆盖已修复规则。
