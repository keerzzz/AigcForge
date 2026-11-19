# P2.2M Workflow 声明资产后端检查点

2026-10-28（Asia/Shanghai）。基线 `1bef0b81df3ce8ca605262daa428ccafaa63b7a0`，分支 `v2-dev`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本片十八个源码、测试及正式生成文件。日志时间为 UTC，2026-10-27 的运行对应本地 2026-10-28。

## 已交付行为

既有四条 Workflow 资产 HTTP 路由已接到 Location graph。新增唯一 [WorkflowAssetService](../../packages/core/src/workflow-asset-service.ts:145)，复用 WorkflowAssetPath、LocationMutation、FileMutation 和原注册表；HTTP handler 只处理传输和错误映射。没有迁移旧实现的伪注册表、吞 I/O 错误或无条件覆盖行为，也没有新增执行器或跨资产框架。

原 proposer 返回带目录前缀的路径，却用该路径查询以 `name.yaml` 为键的注册表。现在短路径和身份统一由 prepare 决定；同名异路径、同路径异名分别由 [propose 的两项比较](../../packages/core/src/workflow-asset-service.ts:232) 决定。外层 name/description 必须与 YAML 一致，非空 reviewed target 必须与生成目标一致。真实 Session runner 持久化五项 [metadata facts](../../packages/core/src/tool/propose-workflow-asset.ts:83)，不存在文件的 revision 为 null，原文只保存在 tool input。

Info 增加原始 content，保留 BOM、CRLF、注释和额外字段。版本按原始字节哈希；apply 保存原文，要求匹配 revision 和显式 overwrite；delete 对现存文件也要求匹配 revision。回读核对原字节、revision、全部声明字段和完整 steps，步骤相等由 [Schema.toEquivalence](../../packages/core/src/workflow-asset-service.ts:14) 决定。回读或 reload 失败时，只在磁盘仍等于本操作预期字节时回滚；外部改写与回滚失败均明确报错。

复用既有 `validateGraph` 校验新的 propose/apply。registry 保留结构有效的历史坏图，继续由 [CompositionResolver](../../packages/core/src/composition-resolver.ts:365) 返回诊断。StepDef 的原 optional/default 定义不变；空 steps 和组合边语义也未改变。Frontmatter 使用公开 Name/Description 约束，原先可以读入但无法编码成公开 Info 的超限身份现在列为 bad_frontmatter。

写入保持 100,000 UTF-8 bytes 上限；原磁盘读取保持排除一个首 BOM 后的 5,000,000 UTF-16 code units 上限。二者不是同一限制。独立复审发现初版保留 BOM 后多计一个字符；真实边界红测失败，修后边界可读，再增加一个字符仍被拒绝。

## 消费者与线合同

真实 HTTP 和正式生成 Promise client 已验证原文及嵌套 steps 往返。Composition plan/start 冻结当前 Workflow 的步骤和 revision；随后定义替换或删除不会改写既有 SQLite snapshot，旧引用被拒绝。测试中保存、替换和删除未创建 WorkflowRun/StepRun，也未增加 LLM 请求。这里的 start 是建立 Custom Session 并冻结组合，不能表示 Workflow 已执行成功。

保留四个路由、operation IDs、list 的 assets/invalid、content/apply 的 Info 和 delete 的 Void。Protocol 的 baseRevision 仍是原可选 String。生成 Promise apply 类型从 string|undefined 显示为 string|null，而旧、新 OpenAPI 原本都允许 string|null；这是生成表达差异，不是本片修改 wire 规则。

正式生成保留原十九个 WorkflowAsset 导出，新增 WorkflowAssetInfo。没有为 StepDef 加额外命名而重写 Composition 的类型。主树三个重叠生成文件已三方合并，原有 1,391 个非 Workflow Promise 导出逐字节保留；本片提交使用隔离生成结果。备份与核对见 [合并记录](evidence/v2-workflow-backend-2026-10-28/generated-merge-result.json)。

## 验证与独立复审

[验证清单](evidence/v2-workflow-backend-2026-10-28/validation-manifest.json) 记录命令、cwd、退出码、各轮源码哈希、日志哈希及版本差异。固定 Bun 1.4.2；主线程包内串行执行；类型脚本使用 GOMAXPROCS=2、GOMEMLIMIT=3GiB。子智能体分别实现 Core、HTTP 测试及独立复审，没有并行运行检查。

| 范围                                            | 实测结果                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| 旧 proposer 真实注册表红测                      | 0 pass / 3 fail；短路径、身份及坏图                                           |
| 最终 Core 资产、路径、注册表、YAML runtime      | 78 pass / 0 fail；251 expects；4 文件                                         |
| 既有组合、冻结、Workflow 执行消费者             | 98 pass / 0 fail；887 expects；实际 5 文件；BOM 修复前快照                    |
| Server 全包                                     | 165 pass / 1 skip / 0 fail；7538 expects；44 文件，含 5 个 Workflow HTTP 用例 |
| Schema 相关                                     | 37 pass / 0 fail；108 expects；2 文件                                         |
| Client 全包                                     | 224 pass / 0 fail；906 expects；20 文件                                       |
| Core/Schema/Protocol/Client/Server/GUI/App 类型 | 各包脚本 exit 0，具体输入版本见 manifest                                      |
| 定向 lint、AST、格式、SDK 文档                  | 15 TS 文件、10 生产文件、18 文件及 SDK 检查分别 exit 0                        |
| 正式生成稳定性                                  | 再次 Client generate、OpenAPI check、生成物 diff 各 exit 0                    |

[独立复审](evidence/v2-workflow-backend-2026-10-28/independent-review.md) 绑定全部十八项哈希，BOM 发现已关闭，无未解决阻断。保留旧 Schema 身份断言红测、品牌类型测试失败、首轮生成差异及命令清理失败的准确记录，见 [恢复说明](evidence/v2-workflow-backend-2026-10-28/recovery-notes.md)。旧 minimal StepDef JSON 测试本来就通过，没有将静态风险包装成复现缺陷。所有重复运行不累加。

两份红测日志的错误帧带尾空格；提交的是仅去尾空格的 normalized view，原字节与 SHA 保存在本地及外部备份，manifest 同时标明原始和提交版本。Server 的 Mercurial skip、既有运行警告和 AST runtime binary 提示保留；当前定向 lint 配置只有一条规则，不称为全面审计。

## 未交付范围与技术债

本片选择复用现有进程内锁及条件回滚，不增加通用事务框架；它不提供多进程 fencing 或崩溃后的持久事务恢复。保存定义也不验证所选 Agent 是否已绑定到某个运行组合，实际组合仍负责该约束。

`AUDIT-V2-ASSET-CONSUMER`、`V2-SERVER-LEGACY`、`V2-D-REFERENCES`、`V2-C-WORKFLOW`、`V2-D-COMPOSITION` 和 `V2-VALIDATION` 继续开放。Owner 为 Core/Schema/Server/App/GUI/Desktop 与主智能体；解除条件包括 Workflow GUI 显式 kind 分派、完整原文/steps 审阅与确认/CAS；默认 Project/显式 global 实际放置；导入、编辑、引用删除；空图和空 branches 的明确运行语义；创建、运行、取消、恢复和通知 UI；GUI/TCP 真实链、冷恢复、实际 provider、Desktop 和跨平台验证。本片没有进行 GUI 或真实 TCP 验收。下一片按 [GUI 预检](evidence/v2-workflow-backend-2026-10-28/next-gui-preflight.md) 继续，合法 Workflow 名称也可能生成 `.plugin.yaml`，不得按后缀误认种类。

仅本地限定提交，不 push、merge 或发布。
