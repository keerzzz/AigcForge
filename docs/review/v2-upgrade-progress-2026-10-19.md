# V2 升级接续记录（2026-10-19）

## 2026-10-24 Workflow 后端执行

WorkflowExecution、四执行 HTTP、持久/公开事件、精确输入恢复及删除门禁已交付；Task 更正和取消来源 unarchive 已收口对应子范围。当前验证、失败、提交核算及未交付边界见 [执行检查点](v2-workflow-execution-2026-10-24.md)。TaskPanel/Work 调度、外部生产者、其余产品和系统验收继续由技术债账本管理；下文历史状态保留。

## 2026-10-24 Session 与 Workflow 读取

两个既有只读 GET 已接 current owner，Workflow 响应 JSON 缺省字段和保留客户端类型名已统一。全包、单包类型、失败和限制见 [Workflow 读取检查点](v2-workflow-read-2026-10-24.md)。执行、取消、重试、恢复与产品链继续按 V2-C-WORKFLOW 推进。

## 2026-10-24 Session 快照反向引用

现有 references 已增加冻结 Session 摘要和不完整标记，保留 sourceLocation 并对坏 JSON 逐行降级。验证、失败和限制见 [Session 引用检查点](v2-session-references-2026-10-24.md)；其他消费者、Workflow 执行与产品验收仍按账本推进。下文保留历史状态。

2026-10-20 接续已完成本批集成与五个包分别全量验证。以下内容保留 2026-10-19 历史；当前状态以 [接续检查点](v2-resumption-checkpoint-2026-10-20.md)、[当前清单](v2-remaining-inventory-2026-10-19.md) 和 [未交付账本](../technical-debt.md) 为准。Session 输入结果切片见 [输入结果检查点](v2-session-input-result-2026-10-20.md)，内部 Delegation 执行、恢复及 retry/steer/interrupt/close HTTP 见 [执行检查点](v2-delegation-execution-2026-10-20.md)。2026-10-21 持久 Task 叶权限与前后台工具切片见 [Task 检查点](v2-task-tool-2026-10-21.md)，六个 Task HTTP CRUD 与组合原子写入见 [Task HTTP 检查点](v2-task-http-2026-10-21.md)。Delegation 生命周期、四决策 reconcile 和先关闭后 purge 见 [生命周期检查点](v2-delegation-lifecycle-2026-10-21.md)。Custom Profile 六类反向查询见 [反向引用检查点](v2-custom-profile-references-2026-10-21.md)。外部 CLI、attended、产品 TaskPanel、Work 调度与其余客户链仍开放。

2026-10-22 代码检查点 `c40022ef51` 的 Custom plan/health 与内部冻结接线见 [冻结检查点](v2-composition-freeze-2026-10-22.md)。已捕获完整工具 Schema、冻结执行器配置与 Skill 正文；生产运行消费、原子 start/upgrade 和整体其他未交付范围继续推进。本切片逐包验证，canonical 根 `check` 未运行。

2026-10-23 Custom 冻结运行消费与原子生命周期已接通，验证与限制见 [运行检查点](v2-custom-runtime-2026-10-23.md)。Command 和整体客户流程继续按账本推进。

2026-10-23 Command 冻结模板执行子范围已交付，见 [Command 检查点](v2-custom-command-2026-10-23.md)。其余未交付继续按账本推进。

## 授权与工作区

- 实现目录：`/home/keer/workspace/aigcfroge-v2`；分支：`v2-dev`。
- 接续基准：`8b0661b2a9278373cb020b0998ef0943bb433459`。
- 用户授权本地实现、测试、文档、可恢复检查点提交及子智能体；未授权推送、PR、合并、发布、部署或修改生产数据。
- 主仓 `/home/keer/workspace/aigcfroge` 仅作参考。当前 V2 AGENTS 的 Session、Instructions、AI/Tool 契约优先。
- V2 根目录缺少 `ARCHITECTURE.md`、`CONTEXT.md`、`DESIGN.md`、`docs/testing.md`；不得冒用主仓同名文件为 V2 实现契约。本轮已建立 `docs/technical-debt.md` 记录未交付范围。
- Codegraph 对本工作区返回未初始化；本轮使用源码检索，未使用主仓索引代替。

## 已接住的修改

起始 `git status --short` 与交接一致：8 个已跟踪文件修改、2 个新测试、两份运行时报告、证据及交接提示词。已有改动涉及 SSE 审批应答者登记、MCP 叶权限与输出声明、Permission 等待取消、官方客户端重生成。本轮补齐真实 Node HTTP 回归与项目 Bun 入口，并取得下列实际验证结果。

本地检查点正在按范围形成；提交历史只能以 `git log --oneline 8b0661b2a9278373cb020b0998ef0943bb433459..HEAD` 为准。后续配置修复、测试契约对齐及分享链路分批集成。

## 当前分工与恢复入口

| Owner                    | 独占写入范围                                                                   | 下一验收点                                              |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 主智能体                 | 本记录、Core 配置与测试契约修复、验证证据、集成和提交                          | 同环境 Core 基准对照、根 check、纵向链集成              |
| runtime 子智能体         | 已完成运行时入口及 Server fetch 测试隔离；当前只写独立审查报告                 | `v2-independent-review-2026-10-19.md`                   |
| phase_inventory 子智能体 | `session/share-v2.ts`、share Tool Plugin、`plugin/internal.ts` 与对应测试/报告 | durable inbox、leaf Permission、真实 snapshot、生产注册 |
| ci_alignment 子智能体    | `.github/workflows/test.yml`、`publish.yml` 与专属报告/证据                    | 按当前 Desktop/Sidecar 契约修复陈旧目标；不执行远程发布 |

repair_review 与 node_regression 曾因上游资源/流断连失败，主智能体已接管 Node 回归，未把失败子任务计为审查通过。

子智能体不提交；主智能体收取证据并统一集成。若会话断开，先核查 Git 状态、本记录、各子报告及实际运行进程；已完成工作不重做，未完成工作依据落盘状态续派或接管。

## 交付顺序与未交付范围

1. 接续修复、固定运行时、实际回归和本地检查点。
2. 依据可核查清单逐条完成 Phase C/D 纵向链，接入生产 handlers 与客户端消费者。
3. R0.1 CI/发布路径、Desktop Sidecar/PTY。
4. 全量检查、E2E、桌面冷启动、数据库隔离副本迁移。
5. 独立复核、本地交付与剩余账本。

以上未完成项 owner 为主智能体；解除条件分别为实现与装配证据、实际命令退出码和所需人类业务裁决。此记录是接续入口，不是整体迁移完成声明。

## 本轮验证

本轮使用 Bun 1.4.2；运行时入口为根目录 `./script/bun`，包目录 `../../script/bun`。全局 Bun 保持不变。日志与命令记录位于 `evidence/v2-upgrade-2026-10-19/`，其他子报告有各自 evidence 目录。

| 检查                                                | 实际结果                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Core 原修复 12 文件                                 | exit 0；192 pass / 42 skip / 0 fail / 862 assertions                                                                                 |
| Web + Node HTTP 审批流首轮                          | exit 0；4 pass / 0 fail / 10 assertions                                                                                              |
| Server 原修复 6 文件复跑                            | exit 0；16 pass / 0 fail / 93 assertions                                                                                             |
| Client 全量                                         | exit 0；224 pass / 0 fail / 906 assertions                                                                                           |
| App unit + browser                                  | exit 0；742 unit、168 browser 通过；不是 Playwright E2E                                                                              |
| 官方 Client generate                                | exit 0；生成目录 SHA256 零漂移                                                                                                       |
| 无缓存根 check 首轮                                 | exit 2；lint 1487 warnings / 0 errors，18/19 typecheck 成功，新增 Node 测试读取地址 union 的 port 导致 TS2339                        |
| 修复为 HttpServer.formatAddress 后 Server typecheck | exit 0；尚不等于根 check 已通过                                                                                                      |
| Core 全量首轮                                       | exit 1；6957 pass / 365 skip / 19 fail / 105799 assertions；11 项 GitLab OAuth 与宿主 8080 占用同时出现，网络隔离定向复跑 19/19 通过 |
| Core 配置/Location/Bus 修复 5 文件                  | exit 0；112 pass / 0 fail / 639 assertions                                                                                           |
| models-dev/process 测试修复 2 文件                  | exit 0；40 pass / 0 fail / 167 assertions                                                                                            |
| Server 全量首轮                                     | exit 1；85 pass / 1 skip / 1 fail；fetch 测试读取用户全局配置并启动 MCP                                                              |
| Server 隔离配置后全量                               | exit 0；86 pass / 1 skip / 0 fail / 5804 assertions；见 Server test isolation 报告                                                   |
| Core 原 HEAD 基准，首次网络隔离                     | exit 1；6949 pass / 368 skip / 9 fail / 105780 assertions；隔离用户映射 root 引入两个权限失败，不能与普通用户结果直接比较            |

正确保留 UID 1000 并在启用 loopback 后清除 capability 的基准复跑已结束：exit 1，6954 pass / 365 skip / 7 fail / 106084 assertions，记录为 `baseline-core-user.json`。七项基准失败已有对应修复；修改后七文件合并验证为 exit 0，152 pass / 0 fail / 806 assertions。该轮含分享注册后的工具列表更新，分享源代码随独立切片交付。修改后 Core 全量及最终根 check 尚待源码稳定后运行。

保留失败证据：运行时子智能体与根 check 并行跑审批流时为 2 pass / 2 fail（Web SSE readiness 超时）。后续 6 文件复跑及完整 Server 全量通过；尚未证明并发负载就是失败根因。
