# V2 验证与交付门禁

本页是 [CLAUDE](../CLAUDE.md) 的验证索引。工程规则见根 [AGENTS](../AGENTS.md)，测试合同由 owning package 和最近 keeper 持有；不复制默认工作区 Bun 1.3.14 命令、旧 harness 或历史 tally。

## 1. 执行规则

- 根 `test` 是 guard，禁止从根跑产品测试。使用 [script/bun](../script/bun) 对齐根 packageManager，包脚本决定条件、preload、wrapper 和测试 tsconfig。
- 主线独占测试/构建槽，一次一个包；E2E 按任务使用 workers=1、retries=0。只读研究可并行，不并发测试/构建或初始化大型索引。
- `docs/review/evidence/**` 保存历史源码、失败脚本和构建产物的原始字节，排除于当前源码 lint；活跃测试继续由 owning package 检查。
- 先得到可信且可满足的行为红证，再最小修复并复验；已有等价 keeper 就扩展，不复制生产实现进测试。
- 一个可观察合同一个最强适用 owner。UI 行为沿 App keeper；宿主生命周期沿现有 host/graph component tests；纯领域/安全/编码由 owning module 证明，不重复覆盖。
- 不加 test-only production seams、flags、globals 或 data attributes，不用固定 sleep/timeout 等待并发完成。复用 Deferred、真实事件/状态与 Playwright readiness。
- 改公开 Protocol/Server HttpApi 后正式生成 Client，不手改 generated。执行前保护 WIP；Client `check:generated` 会先生成，不能当只读命令。
- typecheck 不证明运行行为；App 要另验 E2E 类型，Desktop typecheck 不覆盖测试文件。Protocol 没有 test 脚本，使用当前合同检查和相邻 Server 行为测试。

## 2. 已核对命令入口

2026-10-29 按 manifest 核对；后续先确认脚本仍存在。以下是后续任务命令，不代表本次运行。每个命令单独执行。

Core 走包 wrapper，不能裸 `bun test` 绕过隔离：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core test --timeout 30000
```

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/core typecheck
```

App 的单元、browser 与 E2E 类型各有独立入口：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/app test:unit --timeout 30000
```

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/app test:browser --timeout 30000
```

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/app typecheck
```

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/app typecheck:e2e
```

其它拥有脚本的包用同一 launcher 的 `run --cwd=packages/<name> test/typecheck`，定向用例按其真实脚本传参；不把示例扩成每片全仓重跑。

| 包/边界                                                      | 脚本与注意事项                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Schema、AI、Client、Codegen、Server、GUI extensions、Desktop | 各有 test/typecheck；使用 manifest 中自己的测试预算与条件                 |
| Client                                                       | `generate`；`check:generated` = generate + generated diff，具有写入副作用 |
| Protocol                                                     | `generate`、`check:generated`、typecheck；没有 test 脚本                  |
| App                                                          | `test:e2e:built` 需要匹配当前 production build，不可复用来源不明的端口    |
| Storybook                                                    | 当前无 test/typecheck 脚本；不能编造命令                                  |
| 根 lint                                                      | oxlint + GUI AST rules + SDK docs；不是纯增量命令                         |
| 根 lint:changed                                              | 核对指定基线和实际 GUI 覆盖范围，不代表 Core/Codegen 全量 lint            |

正式生成入口：

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/client generate
```

```bash
/home/keer/workspace/aigcfroge-v2/script/bun run --cwd=packages/protocol check:generated
```

根 `check` 为 canonical lint/typecheck，默认 typecheck concurrency=1，保留全部包任务。日常按受影响包串行；低资源全类型检查需明确任务与资源安排。禁止 `tsc`、跳 hook 或假定旧 skip 环境变量仍适用。

## 3. 每个小节的证据

每条命令记录 cwd、完整命令、退出码、实际用例/skip、源码与依赖身份；失败与后续成功分别保留。help/usage 的 exit0、生成零漂移、hash 数量、单包 green 均不能代替产品语义证明。

| 影响面            | 必须观察的合同                                                                      |
| ----------------- | ----------------------------------------------------------------------------------- |
| Session/权限/工具 | 准入与可见事实、取消/重试/恢复、权限快照与实际执行、普通 Coding 不回退              |
| API/生成          | 请求与响应编码、错误/授权、optional/nullable、当前与 retained 合同和消费者          |
| 资产              | 提案/审阅/取消/CAS/保存/发现/消费/编辑导入/引用删除；声明保存不等于运行安装         |
| 路由/Panel        | server/project/Session/Draft 身份、迟到响应、前进后退/重载、storage 加载与宽度恢复  |
| 数据/存储         | 新库和旧库副本升级、实体/关系/快照/输入结果、重复启动和失败保留；不重编号 migration |
| 服务/发布         | 同源 bundled CLI、认证/IPC/PTY、冷启动/复用/接管和产物可重建                        |

全部 batch 目标保留。某小节只关闭明确验证的合同；其它未交付范围继续在[唯一账本](technical-debt.md)，不能用技术债登记把核心功能算完成。

## 4. 真实桌面与环境保护

产品小节在源码/依赖/产物冻结且复审通过后，由明确验收负责人运行隔离的真实 Electron + DeepSeek Flash；包级检查和受控模型不替代它，真实模型也不替代可重复的 CAS/故障/取消测试。

先确认隔离 user-data、Home/config、数据库副本、端口、服务注册和当前 PID/产物身份。禁止默认通过 installed client 的 ensure 接管用户服务，不操作现用库或秘密。开启/重启/关闭隔离进程及真实 provider 的预算必须在具体任务授权内；文档首批没有该运行授权，不把旧会话允许当新会话凭据。

## 5. 性能与停止条件

遵循 [performance guide](../packages/app/e2e/performance/AGENTS.md)：production build、串行、同 runtime/fixture/硬件、原始样本、可选 profiling。基准只断言场景完成与指标采集，不设机器相关硬阈值，不用几次样本宣称统计显著性。

场景无法完成、指标缺失、功能回退、数据/权限/身份错误或源码产物不匹配为阻断。数值变慢需保留样本、定位瓶颈并由负责人记录是否接受及解除条件，不把“留 P6”当自动放行；性能预算如需新增，另作有依据的决定。

## 研究补充的验证边界

[DeepSeek Harness对齐附件](research/upstream-v2-sync/2026-10-29-deepseek-harness-alignment.md)的用户选择为强化五模式、候选审阅后保存与显式采用。后续任务验证：定义/提供者/消费者配套、来源版本/依赖、卸载/取消/迟到响应、候选不执行、确认/CAS保存不自动安装授权挂载、显式采用/旧组合保护、权限变化逐次、引用删除与持久/live轨迹身份。Scope回收不能证明外部副作用撤销，fork/resume不是确定性重执行。

配置/能力诊断先本地Schema与来源检查，真实provider preflight显式授权预算，不默认在启动发网络请求。dsh为developer preview且官方未宣称安全审计通过；MIT、审批或沙箱不作为绝对隔离证据，不引入1.5秒/100%或机器相关阈值。

## 6. 文档-only 与发布

文档-only 检查路径/标题锚点、协议冲突、manifest/源码事实、任务状态与允许文件差异；既有脏文件用修改前后核对隔离本轮变更。禁止为得到 green 执行生成、安装、桌面或产品测试。文档通过不表示功能通过。

最终从已提交源码或明确交付补丁重建同源 Desktop/CLI，核对支持平台、服务/数据版本与更新失败恢复。代码回退不保证升级后的库可回退。提交/推送/PR/发布与用户数据变更仍需独立明确授权。
