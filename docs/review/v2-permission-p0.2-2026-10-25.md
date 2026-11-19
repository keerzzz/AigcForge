# V2 P0.2 权限与工具快照实施复查

日期：2026-10-25。结论：权限基线修复及适用本地验证已通过主智能体协议审批，尚未提交。审批依据见 [协议审批](v2-permission-p0.2-approval-2026-10-25.md)。P0、产品迁移与发布切换仍未完成。

- 计划：[现行实施计划](../research/upstream-v2-sync/2026-10-25-v2-alignment-execution-plan.md)；Phase P0，Slice P0.2。
- 实施目录：`/home/keer/workspace/aigcfroge-v2`；分支 `v2-dev`。
- HEAD：`251c0fe38041a326e624db464d1ee0efd1522881`；固定上游：`4617210822bdbb31e5749751afbfb4584ccedac8`。
- 适用验证：实际权限服务、工具快照与调用、Custom/master/V1 回归、Core 类型检查、五文件 lint、独立复审。
- 当前非目标：变更 Todo、重建执行循环、全量 Coding 增量迁移、Desktop 运行验收、远程操作与发布。

## 接续、现场与归属

接续聊天 `01a170c7-eb78-7543-b0dc-bf76c5e1d3d1` 和 `01a171eb-ba44-7912-a7cd-e1e525653bfa`。前一聊天的历史目标要求“完成小节任务后需要审批，没有问题后继续下一个任务”；用户随后明确委托主智能体依据 Claude 与固定上游 V2 协议审批；本切片已履行该审批点。旧产品参考采用当前 main 与 WIP、Todo 保留 V2 的既有裁决继续有效。

此前多轮代理 HTTP 400 中断不作为项目验证失败或完成证据。最近已保存的产品修复是在 hook 返回后落实无人值守 ask→deny；本次接续没有新增产品源码，完成最终回归、类型/lint、证据核验和文档同步。

本次核对了目录、分支、HEAD/上游、工作树、状态、暂存/未暂存差异、全部未跟踪文件与实际进程；没有仍运行的 V2 测试/构建进程。完整仓外备份为 `/home/keer/.codex/backups/aigcfroge-v2/p0.2-current-20261025T090507Z`，含 29 个已跟踪改动、276 个未跟踪文件、binary patches、manifest 和现场输出；副本与补丁已读取核验。

产品改动限于五文件：`packages/core/src/permission.ts`、`src/permission/effective.ts`、`test/permission.test.ts`、`test/permission-effective-custom.test.ts`、`test/session-custom-context.test.ts`。[证据目录](evidence/v2-permission-p0.2-2026-10-25/) 的五份 `*.final.slice.patch` 按首次 P0.2 备份生成；备份未包含的原未改动文件使用固定 HEAD 作为输入。

[WIP 核验](evidence/v2-permission-p0.2-2026-10-25/wip-preservation-final.json) 证明，除切片五文件和允许更新的计划/账本外，首次 P0.2 备份中的 276 个既有路径未变。没有暂存或提交；[提交列表](evidence/v2-permission-p0.2-2026-10-25/commits-final.txt) 由 `git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 生成，输出为空。

## 根因、决定函数与复用

原 tier 包络在 Session allow 之后重放 Agent deny，导致执行拒绝原始配置 merge 已展示的工具。配置展示与请求级 saved/hook 裁决有不同语义，不能全部压成同一份扁平规则。

本切片保留原权限、工具与 Session owner，在权限服务内恢复普通 Coding 的配置顺序与请求裁决边界：

- [Permission.evaluate:108](../../packages/core/src/permission.ts:108) 与 [merge:120](../../packages/core/src/permission.ts:120) 决定最后匹配与顺序合并，复用现有 Wildcard。
- [usesOrderedConfiguration:50](../../packages/core/src/permission/effective.ts:50) 选择 Coding、master=false；[compute:56](../../packages/core/src/permission/effective.ts:56) 在该分支保留 Agent→Session 顺序，停止 deny 重放及 saved 插入。
- [configured:191](../../packages/core/src/permission.ts:191) 返回配置规则及是否咨询 saved；[effectiveRules:228](../../packages/core/src/permission.ts:228) 暴露配置姿态。
- [evaluateInput:272](../../packages/core/src/permission.ts:272) 先拒绝任一资源的配置 deny，再处理 saved 和 hook；[290 行](../../packages/core/src/permission.ts:290) 把无人值守 hook 新引入的 ask 转为 deny，阻止进入 grant/responder/pending。saved、grant、presence 与 pending 仍使用原服务。
- [SessionContext.select:216](../../packages/core/src/session/context.ts:216) 保留原 merge，交给工具与 Skill/MCP 发现；[Tool.whollyDisabled:374](../../packages/core/src/tool.ts:374) 仅隐藏最后 action 匹配为全资源 deny 的工具。资源级 deny 保留发现，执行 leaf 调用 Permission.assert。
- [effectiveV1:166](../../packages/core/src/permission/effective.ts:166) 继续原包络；Custom 冻结选取、执行 allow→ask、只读白名单、显式 deny、master 与 Chat full 危险动作约束保留原 owner。

用户链：持久 Session/Agent 配置 → SessionContext 与工具快照 → direct/CodeMode captured tool → Permission.assert → saved/hook/审批或拒绝 → 工具结果。回归使用实际 SessionStore、数据库、Agent、Permission、PluginHooks、Tool 和 Instructions，不复制决策算法。

方案对冲：扁平规则实现更短，但不能表达配置 deny 先于 saved 及 hook 的请求关系。当前方案在原 owner 中处理两个边界，没有新增通用框架。产品 master/档位与展示的允许差异、默认 Coding 增量目录及 UI 仍是技术债，归 AUDIT-V2-PERMISSION / AUDIT-V2-CODING-PARITY。

## 红测试与最终验证

主线独占测试/构建资源，单包串行执行；子智能体只读。固定 `/home/keer/workspace/aigcfroge-v2/script/bun`，测试输出为 Bun 1.4.2。完整 argv、cwd、退出码、耗时、dirty/untracked 输入 SHA256 与日志 SHA256 在同名 JSON；采集器不是全仓源码快照。[核验记录](evidence/v2-permission-p0.2-2026-10-25/evidence-validation-final.json) 已核查日志和五文件哈希。

历史红/绿分开保留，不累计重叠用例：

- `permission-red`：33 pass / 9 fail，exit 1；四个快照失败含夹具模式/目录前提错误，不能计为普通 Coding 缺陷。
- [permission-corrected-red](evidence/v2-permission-p0.2-2026-10-25/permission-corrected-red.log)：修正夹具、临时还原原生产决策后，33 pass / 9 fail，exit 1；真实 Agent/Session、saved/hook 与四种快照→执行反例。`red-production-mutation.json` 记录原生产文件基准与恢复哈希。
- `permission-corrected-green`：86 pass / 0 fail，7 文件，exit 0；对应早期状态。
- `unattended-hook-red`：匹配 0 tests，exit 1；属于命令错误，无缺陷证明力。
- [unattended-hook-red-corrected](evidence/v2-permission-p0.2-2026-10-25/unattended-hook-red-corrected.log)：0 pass / 1 fail，30 filtered out，exit 1；期望 deny，实际 ask。
- [unattended-hook-green](evidence/v2-permission-p0.2-2026-10-25/unattended-hook-green.log)：1 pass / 0 fail，30 filtered out，exit 0；五文件哈希与当前一致。
- `permission-final-green`：175 pass / 0 fail，14 文件，exit 0；后续源码变化，不能替代最终重验。

本次接续最终验证均为 exit 0：

- [permission-resume-final](evidence/v2-permission-p0.2-2026-10-25/permission-resume-final.json)：cwd `packages/core`；`run test --timeout 30000`，14 个指定文件；**176 pass / 0 fail，839 expect**。输出未报告 skip/filtered。这是受影响回归集，不是 Core 全包或全仓测试。
- [permission-resume-typecheck](evidence/v2-permission-p0.2-2026-10-25/permission-resume-typecheck.json)：cwd `packages/core`；`run typecheck` → `tsgo -b tsconfig.json tsconfig.tests.json`。
- [permission-resume-lint](evidence/v2-permission-p0.2-2026-10-25/permission-resume-lint.json)：cwd 仓根；`x --no-install oxlint` 显式五文件；0 warnings / 0 errors。当前配置在 Core 只启用一项规则，不当作完整质量证明；未以 GUI lint:changed 代替 Core lint。

覆盖 Agent deny→Session allow、最终 deny 单/多资源、saved/hook 两方向、有人/无人值守、master 启用/关闭、Custom 冻结/开关、direct/CodeMode 的发现和调用。审批等待使用 Bus+Deferred；V1 覆盖为计算/格式兼容。read leaf、模型与 MCP 是 fixture，未验真实文件 IO、远端 MCP 或权限 UI。

本切片未变更 Protocol/Schema/Client 公开合同或生成物，无需生成。inbox、Step 和 runner owner 未修改；14 文件未动态重验 first-admission-wins 或完整执行生命周期。

独立子智能体 `permission_review` 核对五文件 diff、固定上游与决定链，未发现实质缺陷；`permission_evidence` 核验日志/源码哈希、有效红测与覆盖边界。结果见 [独立复审](evidence/v2-permission-p0.2-2026-10-25/independent-review.md)。两者未测试、构建、安装、初始化索引或修改文件。

文档链接、当前切片哈希和定向 diff 检查通过。首轮 Markdown 格式检查发现账本既有的表格间距/空行问题；对照接续备份确认后仅归一化该格式，最终 [permission-document-format](evidence/v2-permission-p0.2-2026-10-25/permission-document-format.json) 为 exit 0。独立 Desktop 短任务的静态结果也已保存，未计为运行验收。

## 未交付与下一切片

- AUDIT-V2-PERMISSION：本地基线已验证；Owner 为 Core/权限负责人、主智能体。切片协议审批已通过；提交及产品权限展示/master/档位允许差异验收后解除剩余范围。
- AUDIT-V2-CODING-PARITY：默认 Coding 增量工具/上下文及符号/LSP/审查、防幻觉、doom loop 仍开放；Owner 为 Core/Tool/App 负责人。P1 真实 owner/消费者与用户链验收后解除。
- AUDIT-V2-DESKTOP-CLOSURE：P0.3 只读取证；Owner 为 Desktop/Release 负责人。必要依赖恢复与真实开发/packaged 冷启动、服务复用、凭据/native PTY 仍需完成；独立 CLI/TUI 发布范围另行裁决。
- AUDIT-V2-RECOVERY-ISOLATION 与 P1–P6 继续按现行账本，不因权限回归通过而关闭。

下一切片 P0.3，协议审批已通过并开始实施。整体目标保持开放；远程操作、现用服务、存量数据与发布遵守原授权边界。
