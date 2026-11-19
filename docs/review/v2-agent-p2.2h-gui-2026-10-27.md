# P2.2H Agent GUI 检查点

2026-10-27。实现目录 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`；基线 `84d2e56a92`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本片扩展既有资产评审面板，让用户查看 Agent 配置、指令与权限警告，确认或取消保存，并在覆盖时核对当前 revision。完整 P2.2 和 P0–P6 仍开放。

## 行为与决定函数

- [read](../../packages/gui-extensions/src/skill-proposals/proposal.ts:94) 从持久工具输入与 metadata 读取 canonical Agent schema；旧消息缺少警告或 revision facts 时不可保存。Agent 和 Command 都有 source，[分派](../../packages/gui-extensions/src/skill-proposals/proposal.ts:148) 先辨识 config，Command 专属 UI 以 invocation 收窄。
- [applied](../../packages/gui-extensions/src/skill-proposals/proposal.ts:277) 解码 `{asset,warnings}`，逐项比较 name、description、relativePath、完整 config/source，并要求新保存结果的 handoffs 为空。只有回包与审核候选一致才显示成功；警告继续展示。
- [current](../../packages/gui-extensions/src/skill-proposals/proposal.ts:230) 比较 catalog 与 content 的路径、名称、描述和 revision；[apply](../../packages/gui-extensions/src/skill-proposals/panel.tsx:200) 使用该 revision 发起 CAS 覆盖。当前 Agent 有非空 handoffs 时，UI 和动作入口都禁止覆盖，避免现有 Candidate 合同丢失这些内容。
- [sameScope](../../packages/gui-extensions/src/skill-proposals/panel.tsx:681) 比较 Session、visit、Location、client/data 和连接状态；异步写入与回读复用 ownerScope、AbortController 和持久 proposal stamp 保护。取消确认不写入，保存不提交草稿。
- 复用原 Panel/Slot/Command、移动端菜单、lazy 面板、恢复页签预载、CSS 和英文 i18n。没有新增 SDK 或宿主特例。成功文案为 `Agent file saved.`；不暗示普通 Session native Agent 已发现、可选择或已执行。

选择扩展现有模块。未采用独立 Agent 面板或注册表。技术债是 handoffs 保留合同和普通 Session native bridge 尚未完成，当前保护性阻止覆盖与文件保存提示不会代替这两项。

## 隔离验证

[精确文件清单](evidence/v2-agent-gui-2026-10-27/files.json) 列出 11 个源码与测试文件。[机器记录](evidence/v2-agent-gui-2026-10-27/validation-manifest.json) 保存各轮命令、退出码、日志哈希、源码 pins 与相对最终源码的差异。隔离目录 `/home/keer/task-backups/v2-agent-backend-validation-20261027` 从 `b4ce37198e` 加已提交 Agent 后端与本片 GUI 构成；外部依赖共享，workspace 链接全部指向隔离目录。主线程以固定 Bun 1.4.2 串行执行。

| 检查                              | 实际结果                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------- |
| GUI 全包                          | 219 pass / 1 skip / 0 fail；661 expects；33 文件                              |
| App unit                          | 742 pass / 0 fail；2232 expects；107 文件                                     |
| App browser                       | 168 pass / 0 fail；1778 expects；38 文件                                      |
| 生产侧栏 keeper                   | 25 passed；包含 3 条 Agent 用例                                               |
| 最终 Agent keeper                 | 3 passed；完整字段/警告/取消/草稿、窄屏 dark 键盘 CAS、handoffs 保护          |
| 真实 window host / built-in graph | 25 passed                                                                     |
| GUI / App / E2E 类型检查          | 均 exit 0                                                                     |
| 增量 lint                         | 10 个适用 TS/TSX 文件，0 diagnostics                                          |
| SDK 文档                          | 155 declarations / 645 members / 191 parameters / 15 guide blocks，0 problems |
| GUI AST / Prettier                | exit 0；11 个源码与测试文件格式通过                                           |
| 生产 App build                    | exit 0；无 fixture flag 的产物另用于真实链路                                  |

GUI 全包后的变动仅在 E2E fixtures：使用已提交 Client 实际导出的 `AgentAssetApplyOutput["asset"]` 替代未导出的 `AgentAssetInfo`，并修正 keeper 空行。生产 GUI 文件未变。全 keeper 25/0 的 runtime 与最终相同；最终 3 条 Agent keeper 与最终 11 文件逐字节绑定。较早 GUI 类型检查未涵盖后续 E2E fixture，最终 E2E 类型检查另行通过。各轮 tally 不相加。

GUI 的一个 skip 是 Windows/WSL inline-script 场景。原 parser 红测为 1 pass / 5 fail；最初 Command 测试以 source 收窄导致类型失败；最初 E2E 类型检查受工作区未提交 SDK 导出影响；lint 的 7 处空行失败分别保留。AST runtime binary-resolution、Vite 配置/产物 chunk、NO_COLOR/FORCE_COLOR 既有 warning 保留。

## 真实链路

真实生产 GUI → 认证 TCP → Session runner → 持久 proposer → 确认/取消 → Agent 文件 → canonical list/content → composition plan/start 与 SQLite 冻结快照通过：**1 pass / 0 fail / 62 expects**。只有 2 次 primary 模型调用、0 次 title 调用。取消时无文件和 apply 请求；保存后完整 config/source、warnings、磁盘 SHA revision 与 readback 一致，草稿保持且未增加 prompt。组合快照包含实际配置解码后的 Agent、source、revision、permissions，持久 SQLite 与响应一致。

[真实链清单](evidence/v2-agent-gui-2026-10-27/real-chain-summary.json) 绑定 591 个源码文件与 3156 个生产产物，前后哈希一致。完整原始证据归档至 `/home/keer/task-backups/v2-agent-real-chain-20261027T105244Z`，4219 个文件复制后逐个哈希回读；归档清单 SHA256 `bac0d0a1e60e11dbfca2e43368ee5c55db24ee96a955010b43d16873cfa63752`。HTTP、模型请求、SQLite、认证 trace 保留在本地归档，不进入 Git。两张截图由主线程检查，完整配置、权限警告和保留草稿均可见。

第一轮 0 pass / 1 fail / 7 expects 在浏览器写入前被配置来源断言拦截：项目放在 `/home/keer/task-backups` 下，发现到祖先 `/home/keer/.aigcfroge`。改用独立 `/tmp` 项目后通过，生产发现规则和断言未改。原生 Skill watcher 仍记录用户与隔离仓路径；不宣称所有插件来源已完全脱离环境。本次从已创建的 Chat 开始，使用 bounded TestLLM，只证明上述链路，不证明普通 Session native Agent 发现、实际 Agent provider 执行、Mode 创建、冷重启或 Desktop。

## 性能边界

原始基线 15 条中 5 passed / 10 failed：测试把 Location 库存刷新 POST 也视为业务写入。按已有工作区修正，仅豁免路径 `/api/worktree/refresh` 且 body 字节等于当前 fixture projectID 的 POST，其余写入仍硬失败；决定规则见 [benchmark](../../packages/app/e2e/performance/timeline/session-entry-benchmark.spec.ts:33)。调用链与原失败记录见 [边界说明](evidence/v2-agent-gui-2026-10-27/benchmark-boundary.md)。修正测试后的 15/0 基线在 Agent GUI 修改前完成。

前后使用同一隔离源码基线、生产构建与三条路径各 5 个样本。最终后测 15 passed，无剔除样本。稳定耗时中位数（ms）：

| 场景                  | Before | After |
| --------------------- | ------ | ----- |
| Home → cold Session   | 823.8  | 941.4 |
| Home → new Session    | 425.8  | 426.4 |
| Session → new Session | 235.2  | 272.5 |

[原始后测数据与对比](evidence/v2-agent-gui-2026-10-27/performance-comparison.json) 保留所有轮次。两条路径变慢，5 个样本只支持本机描述性比较；不判显著性、不归因，也不宣称性能改善或无回归。后续 P6 仍需配对样本与 profiling。

## 复审与剩余范围

[独立复审](evidence/v2-agent-gui-2026-10-27/independent-review.md) 已由 `/root/gui_audit_resume` 完成，11 文件无具体阻断项。主线程复算源码清单和限定 diff 哈希一致。之前子智能体的 CC Switch/Azure resource 错误及 disconnected-stream 是基础设施失败，不计为通过。主线程核对适用验证、真实链和剩余范围后，按既有授权批准本地限定提交。

唯一债务账本保留 `AUDIT-V2-ASSET-CONSUMER` / `V2-SERVER-LEGACY` / `V2-D-REFERENCES` / `V2-VALIDATION`。Owner：Core/Server/App/GUI 与主智能体。解除条件：普通 Session native Agent 注册选择；handoffs 保留；默认当前 Project 和显式 global 的真实目标接线；编辑、导入和引用删除；数据库冷恢复；真实 provider、安装版 Desktop 与其他平台；专门 controller-generation 竞态；其余 MCP/Plugin/Workflow 资产。既有 Location-only 保存不等于已交付 Project/global 产品裁决。

本片以 `feat(gui): add agent asset proposal review` 作限定本地提交。提交清单必须由 `git log --oneline 84d2e56a92..HEAD` 生成。Mode/Home/Task/Codegen/Desktop 等无关 WIP 保持原状。本片不推送、不合并、不发布。
