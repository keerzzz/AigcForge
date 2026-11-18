# Session 输入结果归属检查点（2026-10-20）

实现仓为 `/home/keer/workspace/aigcfroge-v2`，分支为 `v2-dev`。本切片接续本地提交 `8723a4021`，交付 Session 自有输入结果查询及其事件事实。Delegation execution/recovery/task 和客户流程仍由主智能体继续实现，解除条件见 [技术债账本](../technical-debt.md)。这是主智能体实现与源码核查，不能计作独立复核。

## 决定结果归属的规则

`SessionInputResult.read` (`packages/core/src/session/input-result.ts:21`) 是本切片唯一输入与结果的关系判断：在一个数据库事务内查确切 Session/input ID 的 user 或 synthetic anchor，按 `SessionMessageTable.seq ASC` 查询后续消息，跳过失败或未完成的 Assistant，返回第一个显式 `needsContinuation === false` 的成功 Assistant。失败/人为中断依据第一个 Idle marker；shutdown 没有 Idle，保持 processing。查询不依赖最近 20 条消息或整个合并 busy period 的终态。

不可推导的事实由 `SessionStep.attempt` (`packages/core/src/session/runner/step.ts:239`) 计算：工具继续需求与最终 Step 的 `toolChoice: none` 政策合并为一个值，既写入成功 Step.Ended，也用于返回 runner Outcome。`SessionMessageUpdater` (`packages/core/src/session/message-updater.ts:264`) 投影该事实，Step.Started 和 Step.Failed 清除旧值。事件 version 仍为 1，可选字段允许旧记录解码；旧完成 Assistant 缺此事实时返回 unverified，不能从 provider finish 猜成功。

方案沿用前一边界报告的选择：复用 Session Step 和消息投影，不另建输入结果表、执行身份或模型循环。技术限制明确保留：历史缺字段不自动补判，删除/revert/purge 后缺失 anchor 返回 missing，查询不负责 Delegation 冷恢复安全裁决。

## 已验证

原始命令、cwd、退出码和日志 SHA256 均在 [verification.json](evidence/v2-session-input-result-2026-10-20/verification.json)。测试在各包目录逐包运行，没有根目录测试。

| 范围                                                      | 实际结果                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Schema 全包                                               | exit 0；352 pass / 0 fail / 1233 expect；42 files                                           |
| Protocol 全包                                             | exit 0；10 pass / 0 fail / 41 expect；4 files                                               |
| Client 全包                                               | exit 0；224 pass / 0 fail / 906 expect；20 files                                            |
| Server 全包                                               | exit 0；99 pass / 1 skip / 0 fail / 6017 expect；33 files                                   |
| Server 消息 wire 补强                                     | exit 0；2 pass / 0 fail / 20 expect；真实 import/list HTTP 和生成 Promise client 保留 false |
| Core 六文件回归                                           | exit 0；365 pass / 0 fail / 1524 expect                                                     |
| Core 全包，隔离网络且保留 UID                             | exit 0；7032 pass / 365 skip / 0 fail / 107707 expect；353 files                            |
| Core / Schema 单包类型检查                                | 最终均 exit 0                                                                               |
| 官方 Protocol generate / check:generated、Client generate | 均 exit 0；差异限于可选 continuation 字段                                                   |
| 根目录 check（静态检查，无测试）                          | exit 0；19/19 typecheck，0 cached；1487 lint warnings / 0 errors                            |

Core 全包采用上一检查点已验证的同 UID 网络隔离命令，loopback 可用；宿主 8080 服务保持运行。Server 日志含已有 OAuth callback 测试的 MaxListenersExceededWarning，本切片未证明或修复该告警根因。

回归覆盖：同一 busy period 内两个 queue 各自结果、tool continuation 与 steer 共享结果、超过旧 20 条窗口后的查询、后续失败保留前次成功、step allowance 禁用工具后的确切停止、partial retry 最终成功与 retained replay、缺失/错误 Session 或 assistant anchor、历史缺事实、新历史隔离，以及生产 SessionExecution 的 failed/user interrupt/shutdown lifecycle。Runner 大夹具绕过生产 lifecycle 的一处测试显式发布失败事件，另外三个测试使用生产 SessionExecution layer 补证。没有强制制造跨连接读写交错；查询使用既有数据库事务，未新增并发机制。

## 失败证据与未交付

保留初轮夹具失败：TestLLM.text 缺 ID、默认 desc 导致预期顺序反向、runner fixture 缺 production terminal、SessionInbox.admit 参数误用。最终类型检查还发现事务内生成器状态和 Schema 测试 payload 字面量被推宽；分别补准确返回边界和字面量类型后通过。所有失败日志保留，不能用最终通过覆盖它们。

本切片尚无 Delegation 生产消费者调用 `SessionInputResult.read`，未交付 execution/recovery/task；全产品 E2E、Desktop/PTY、存量数据库副本升级和独立复核也未交付。前一份 [执行边界报告](v2-delegation-execution-boundary-2026-10-20.md) 的“未修改 Session 结果协议”仅对应 `8723a4021` 当时的范围，本切片已实现该报告所选方向。

## 提交核算

本地提交完成后，提交列表只由 `git log --oneline 8723a4021..HEAD` 生成；本报告不手写待产生的 commit ID。未推送或发布。
