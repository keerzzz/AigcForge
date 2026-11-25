# Meta 结果收口与协议加载复审

修复分支：`meta-result-closure`。基线：`2a4a28b7c1a93336aa5ce3b782954c25773c3acf`，来自 `main`。验证回执保存于 `/home/keer/.codex/outputs/2026-11-25/meta-result-closure/`。

## 事实、候选、推导和建议

**fact**：原导出 `ses_df1fbd8acffePnFs5sAIc8Xzy0.json` 的 SHA-256 为 `be215896d24549fac5a08f7e307fb1e0d9aa3e3bd81fc275113cc0922fa2d67b`。导出与只读数据库均记录六项计划中的四项 completed、两项 in_progress，最终回答却声称 6/6。收集报告项在最后 General 结果返回前 184.111 秒完成。另有“curl、psql、故障注入均已实测”的表述，对应 child 只执行了 12 次源码检索 shell。

**hypothesis**：计划状态和子会话结果缺少明确绑定，且报告依据来自自由文本，导致执行完成、计划完成、源码推论与机械验证混用。

**inference**：普通 subagent 输入没有计划 Task 身份字段，回传不会结算计划行；当前 Task 已通过 parent_task_id、原执行来源和 revision 结算同一计划行。Task 手动状态写入原先只检查执行归属与并发版本，没有限制显式依赖；新增回归证明能够在 worker 未结束时提前完成报告。该证据支持复用原 Task 和 DAG 检查，无需新调度器。

**recommendation / 已实施**：Meta 提示词要求计划委派使用既有 task + parent_task_id，并为报告或审阅阶段声明 dependsOn。实际工具选择仍由模型生成；确定性门禁约束已声明依赖的完成写。完成写边界复用 TaskDag 的终态和删除前置策略；失败或取消的 worker 可以结束结果收集，但不能算 worker 成功。每次 Meta 请求携带当前 Task 状态、revision、计数、operationRef 和 hasOutput；不重复长结果全文，不写持久事件。真实结果与 CommandResult / Verifier 保持原 owner。

## 实施与影响面

- Core SessionTask：update、append、replaceLegacy、patch/updateTask 在同一写锁与事务检查依赖。批量采用同批最终状态，覆盖跨 Session、链式依赖与 completed 时新增依赖；历史已完成项的普通文字编辑可继续。内部 settle 保留原执行归属与 CAS。
- Core Task / Meta：只在顶层 Meta root 的当前请求加入任务数据，计数覆盖整个 Session，按计划报告时需选定原任务 ID。原结果继续存储，长正文按已有结果入口读取。
- Core ConfigInstructionPlugin：消费公开配置已声明的 instructions，沿原 Instructions algebra 加载和刷新；未改变公共 Protocol 或 Server HttpApi。
- 测试：修正 foreground Task keeper 的时序，等待 child idle 后再执行 revert。结果可用与协调器完成释放是不同状态。

两个方案对照：仅修改 Meta 提示词不能约束 Task 状态写入；新增调度与验证系统会重复当前 owner。本批复用现有 Task、DAG、InstructionDiscovery 与验证来源。每项自然语言“已实测”断言的确定性证据绑定仍记于唯一技术债账本 META-CLAIM-EVIDENCE。

## 协议自动加载的实际行为

| 来源                                   | 实际行为                                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 全局 AGENTS.md                         | 默认读取 Global.config/AGENTS.md；Linux 默认是 ~/.config/omnixa/AGENTS.md，OMNIXA_CONFIG_DIR 可覆盖目录         |
| 当前项目与上级 AGENTS.md               | 从 Location 向上发现；Home 内最多走到 Home，Home 外遵守项目根边界                                               |
| 子目录 AGENTS.md                       | Read 成功读取文件或列目录后补充沿路径的子目录规则；可见历史去重，压缩后可重新注入                               |
| CLAUDE.md、ARCHITECTURE.md、测试等文档 | 不由文件名或 Markdown 链接自动展开；可显式配置 instructions 或使用 Read 读取                                    |
| 显式本地路径、glob、URL                | 本批恢复当前 Schema 已声明的加载能力；配置文件有 path 时相对其目录，无 path 时相对 Location；支持 ~/            |
| child / root                           | child 继承 Location，独立加载全局与项目协议；续问保留自身历史。新 root 使用目标 Location，fork 采用父最新指令值 |

项目根 `omnixa.json` 可明确列入核心协议：

```json
{
  "instructions": ["CLAUDE.md", "ARCHITECTURE.md", "docs/testing.md"]
}
```

全局配置也可用绝对路径或 `~/` 列入既有全局协议，例如 `~/.claude/CLAUDE.md`。此例展示配置入口；实际加载以用户已有配置和真实文件为准。

显式文件、glob 匹配、符号链接目标和缺失目录逐级出现的变更使用原 watcher 刷新；URL 在配置变更或新 Location 加载时获取，普通本地变更复用已取正文。URL 自动周期刷新没有配置合同，本批不引入定时器。自动发现与显式配置只加载被声明的来源，不递归展开正文链接。

已存在全局文件的内容无法读取时使用 unavailable：首个完整 delta 阻断，已有 Session 保留原协议。原 FSUtil.isFile 的 stat 错误分类保持基线；本修复不把该路径报告为已覆盖的所有文件系统失败。

## 差分复审与验证

差分已由独立只读审查覆盖 Task 与协议两条链。发现并修复：批量重复 ID 节点绕过、completed 新增依赖绕过、长结果重复快照、缺失目录监听、符号链接真实目标更新和 extglob 更新。红证与后继 green 分别保留。

Core 影响范围运行：587 pass、1 skip、0 fail，588 项跨 14 个文件。复审修正后，对本批三个修改测试文件的最终单包运行：259 pass、1 skip、0 fail，共 260 项；Windows 路径大小写用例在 Linux 跳过。Core 类型检查通过。最终根检查状态以 root-check-resource-receipt.json 为准；此前 final-validation-v2.json 的根运行已中断，不能视为通过。回执记录完整命令、cwd、退出码、源文件 SHA-256 和日志，不把重叠测试数相加。

自由文本分析正确性不能由该次确定性测试裁决；技术债解除需结构化证据绑定。原会话和现用服务不参与补丁验证。
