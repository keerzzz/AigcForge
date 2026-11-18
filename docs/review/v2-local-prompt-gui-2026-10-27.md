# P2.2F Prompt GUI 与既有资产 GUI 的本地提交复审

日期：2026-10-27。实施目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。本切片接通 Prompt 的查看、确认、取消、保存、版本冲突复查及原模板插入；同时收纳此前已复审但未提交的 Skill/Command GUI 依赖。完整 P2.2 与 P0–P6 仍未完成。

## 范围与决定函数

- 复用 `packages/gui-extensions/src/skill-proposals`，三类候选沿真实持久消息读取。`proposal.ts:74` 的 `read` 依据 canonical Schema 校验输入与完整 facts；`proposal.ts:163` 的 `list` 按工具名选择资产族。旧消息缺少 facts 时保持不可保存。
- `proposal.ts:231` 的 `applied` 比较路径、名称、描述和各族正文；`panel.tsx:329` 的 `insert` 再读真实 Prompt，核对原保存 revision 后才插入。`panel.tsx:600` 的 `sameScope` 决定 Session、Location、visit、client/data 代际及连接状态是否仍属于同一个操作。异步回包后重新检查存活状态。
- 宿主只增加通用且有文档的 `Composer.addText`。`packages/app/src/runtime/extension/mounted-session.ts:147` 使用 `composer.capture().store`；复用已在 HEAD 的 `composer/editor/actions.ts:62`，按光标增量插入，保留已有草稿、mentions 和 attachments，不提交、不展开模板占位符。
- 复用现有 Panel、Slot、Command、移动端菜单、延迟加载、恢复页签预载和英文 i18n。没有增加第二套资产存储、Session runner、provider loop 或测试专用产品入口。

提交基于 `629259b8521f63eb93504ee8b25c00fa0d1ea8f0`。独立验证代码树为 `d57df937f2051910bcaa381530fe0e71ccfe67e5`，23 个代码、测试、依赖及 SDK 文档文件；最终证据清单另含本报告与唯一债务账本的窄更新。完整列表由 Git 生成，见 [机器清单](evidence/v2-local-commits-2026-10-27/prompt-gui.json)。

隔离检查补齐的依赖均有实证：App 声明测试使用的 Protocol；Storybook 恢复官方依赖优化器并声明实际动态入口；三个现有浏览器 probe 的 DOM 重载与事件类型修正使整个 E2E 类型检查通过。没有纳入 Codegen、Mode/Home、TaskEvent、Desktop 或其他未提交业务代码。

`fsList/fsFind` 的两行 fixture 默认值也是必需依赖。第一次隔离 keeper 为 21 通过、1 失败，单独重放再次失败。trace 中 `/api/fs/find` 返回 200 但只有 `location`：未配置回调时返回 `data: undefined`，被 fixture JSON encoder 删除。canonical `packages/protocol/src/groups/fs.ts:51`、`:67` 均要求 `Location.response(Array(Entry))`。只收纳既有 fixture 的 `?? []` 修复后，22 条 keeper 全部通过；没有在产品编辑器里加空值兜底。

## 验证口径

测试与构建由主智能体串行运行，使用固定 `script/bun`（Bun 1.4.2）。隔离仓位于 `/home/keer/task-backups/v2-local-commit-validation`，本地 workspace 链接指向隔离仓，外部依赖 store 共享。每轮记录命令、退出码、代码树、源码前后哈希与日志哈希；下表不累计重复轮次。

| 隔离候选检查                              | 实际结果                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| GUI 全包                                  | 213 pass / 1 skip / 0 fail；636 assertions                                     |
| App 单元                                  | 742 pass / 0 fail；2232 assertions                                             |
| App browser                               | 168 pass / 0 fail；1778 assertions                                             |
| 生产侧栏 keeper                           | 22 passed，含 5 条 Prompt 用例                                                 |
| 真实 window host / built-in graph         | 25 passed                                                                      |
| 受 DOM 事件类型修正影响的 timeline keeper | 2 passed                                                                       |
| GUI、App、E2E 包类型                      | exit 0                                                                         |
| 增量 lint                                 | 18 个适用文件，0 diagnostics                                                   |
| SDK 文档                                  | 155 declarations / 645 members / 191 parameters / 15 source blocks，0 problems |
| GUI AST                                   | exit 0；保留 runtime binary-resolution warning                                 |
| 格式与 diff                               | 21 个源码/配置文件 Prettier 通过；staged diff check 通过                       |

大工作区的旧验证另行保留：GUI 213/1skip/0、App unit 756/0 与 browser 168/0、host/graph 25、keeper 22。它们与隔离候选的依赖范围不同，不能代替上表。GUI 的一个 skip 是 WSL 场景。

原失败均保留：parser 红测 27 pass / 9 fail，之后 36/0；早期品牌类型、literal ternary/空行 lint、SDK source block、隔离 E2E 四个 DOM 类型错误，以及上述缺字段 fixture 崩溃。另一次性能 grep 无匹配，退出失败且未运行测试。最终结果不覆盖这些记录。

## 真实用户链

真实生产 App → 认证 TCP/router → Core proposer → 持久消息 → GUI 确认/取消 → Prompt 文件写入 → canonical list/content 回读 → 草稿插入 → 同一 Session HTTP 提交 → 有界 TestLLM 消费：**1 pass / 0 fail / 56 assertions**。实际 3 次 primary 调用、0 次 title 调用；插入前后无自动提交，只有 Enter 后增加准入。原模板中的占位符保持字面文本，最终模型请求包含已有草稿前缀和原模板。

587 个源码文件与 3175 个 App 产物的运行前后哈希一致。原始证据完整保存于 `/home/keer/task-backups/v2-prompt-real-chain-20261027T025324Z`，4239 个文件已逐个读回核验；归档清单 SHA256 为 `1278e2266ee1a7a81e7b827d7b5e724dacb7624b22ee0f2d43a51c462637dbcd`。原始 HTTP、模型请求、SQLite、trace 与认证信息不进入 Git。

首次真实链把临时项目放在仓库证据目录下，被配置来源断言拦截（0 pass / 1 fail / 7 assertions）。改在专属 `/tmp` 目录执行后通过，没有改生产发现规则。原生发现日志仍观察到用户和隔离仓的 Skill watcher；本结果证明指定 Prompt 的保存与消费，不宣称所有原生插件完全脱离环境。

## 性能与边界

改动前后均在大工作区使用生产构建，每侧 3 场景 × 20 个有效样本，无排除。稳定耗时 median / p95（ms）：

| 场景                | Before           | After           |
| ------------------- | ---------------- | --------------- |
| Home → new          | 423.85 / 461.30  | 419.35 / 465.50 |
| Session → new       | 153.90 / 262.70  | 160.10 / 565.50 |
| Home → cold Session | 671.65 / 1077.20 | 684.10 / 907.80 |

Session → new 的尾部上升保留。相同源码的专项重测 20/20 通过，median 143.20、p95 161.50 ms，未复现该尾部；不据此承诺没有性能回归。raw JSONL 与所有轮次单独保留。

本次真实链从已有 Chat Session 开始，未验收 Mode 创建、数据库冷重启、外部 provider、安装版 Desktop 或其他平台。Prompt 编辑、导入、引用删除、默认 Project 与显式 global 目标，以及 Agent/MCP/Plugin/Workflow 四族仍在唯一账本开放。额外 probe 修改未运行依赖 `pwsh.exe` 的 Windows terminal benchmark。Owner 为 Core/Server/App/GUI、主智能体；解除条件见 `docs/technical-debt.md` 的本次更新。

本地暂存和提交由用户既有授权覆盖。提交只包含通过复审的 GUI 闭包及窄文档更新；其他 WIP 保留，远程交付不在本轮范围。

子智能体的[插入边界静态复审](evidence/v2-continuation-2026-10-27/prompt-insert-review.md)未发现阻塞；主智能体核对最终隔离闭包、canonical 上下游与上述原始运行记录，限定批准本地提交。复审结论仅覆盖本报告列出的用户链。提交清单使用 `git log --oneline 629259b8521f63eb93504ee8b25c00fa0d1ea8f0..HEAD` 生成，完整接续批次使用 `git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD`，不手写提交数量。
