# P2.2G Agent 资产后端检查点

2026-10-27。基线 `b4ce37198e7ad06d1d581221ae48ff1f1a146891`，实现分支 `v2-dev`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本片为六个生产与测试文件；完整七资产目标仍开放。

## 行为与复用

既有 Agent list/content/apply/delete 公共路由接通 Location 内的资产服务。`core/src/instance.ts` 暴露现有 registry/service 节点；未增加平行 registry、runner 或数据表。

[AgentAssetService.propose](../../packages/core/src/agent-asset-service.ts:186) 生成目标、存在性、revision、冲突和权限警告。[proposer](../../packages/core/src/tool/propose-agent-asset.ts:69) 将这些事实编码为可持久化 JSON；完整 config/source 仍只存于 tool input。原来的 Warning 类实例不能直接进入 JSON metadata，真实 Session runner 红测复现后已在编码边界修复。

[AssetLocation.atSessionLocation](../../packages/server/src/handlers/asset-location.ts:27) 同时比较规范化 directory 与 workspaceID，确定修改所属 Location。[AgentAssetService.apply](../../packages/core/src/agent-asset-service.ts:241) 继续负责路径、锁、CAS、原子写入和回读失败回滚；[HTTP apply](../../packages/server/src/handlers/agent-asset.ts:68) 保留 canonical `{ asset, warnings }`。缺失 content 按现行 Agent Protocol 返回 400 `InvalidRequestError`。省略 delete revision 继续遵循 owner 现有语义。

[CompositionResolver 的 Agent 转换](../../packages/core/src/composition-resolver.ts:287) 解码 canonical 配置，拒绝无效或 disabled Agent，并冻结源内容、revision 和权限。测试通过真实 HTTP、Session runner、文件系统和 SQLite 验证 plan/start 持久快照；删除资产后快照保持不变。保存和冻结均不触发额外模型请求。

本片选择扩展现有 owner；普通 Session 的 native Agent bridge 注册仍为技术债。上述证据只证明组合规划与冻结快照消费，不证明普通 Agent 选择器、该 Agent 的实际 provider 执行或 GUI。

## 验证

[验证清单](evidence/v2-agent-backend-2026-10-27/validation-manifest.json) 记录命令、退出码、日志哈希、源码 pins 与各次候选树。隔离树 `ceee7d00893ab8797159a7d0e330e495a45e20d7` 只含本片代码；六文件与实现工作区逐字节一致。外部依赖共享，workspace 链接全部指向隔离目录。

| 检查                                        | 本次结果                                             |
| ------------------------------------------- | ---------------------------------------------------- |
| Server 全包                                 | 154 pass / 1 skip / 0 fail；7291 expects；41 文件    |
| Core Agent registry/service/bridge/resolver | 35 pass / 0 fail；525 expects；4 文件                |
| Core / Server 包级 typecheck                | 均 exit 0                                            |
| Client 正式生成、OpenAPI check、生成物 diff | 均 exit 0；无公共生成物变化                          |
| 定向 lint                                   | 六文件，0 errors / 0 warnings；当前配置只有 1 条规则 |
| AST / Prettier / diff-check                 | 五生产文件 / 六文件 / 暂存差异分别 exit 0            |

Core 类型检查发生在 Server 测试中 Warning 构造器类型修正之前；所有 Core 源和依赖源均与最终树一致，唯一差异是该 Server 测试文件。最终 Server 类型检查与全包测试覆盖此修正。

Server 跳过项为缺少 `hg` 的 Mercurial 用例；现有 `MaxListenersExceededWarning` 和 AST runtime binary resolution warning 保留。初次 Core typecheck 因实测 103 线程、内存和交换压力，在 435 秒后定向终止；使用 `GOMAXPROCS=2 GOMEMLIMIT=3GiB` 后原包脚本在 106 秒内通过。未重启用户服务。

原始红测 0 pass / 4 fail、Warning 非 JSON 导致的 3/1、快照原始 JSON 与 Schema.Class 比较错误、两处 Warning 类型收窄错误均保留各自记录。早期 4/0 focused HTTP 结果和 35/0 Core 基线不与最终全包结果相加。

## 复审与剩余范围

独立复审状态以同目录 `independent-review.md` 为准。代理基础设施错误不计为审查完成；本报告不会将代理失败等同于通过。

`AUDIT-V2-ASSET-CONSUMER` / `V2-SERVER-LEGACY` / `V2-D-REFERENCES` / `V2-VALIDATION` 继续开放。Owner：Core/Server/App/GUI 与主智能体。解除条件：Agent GUI 完整配置与警告评审、确认/取消；普通 Session native 注册与选择；默认 Project 和显式 global 目标；编辑/导入/引用删除；冷恢复；实际 provider、Desktop 与其他平台用户链；其余资产族。

本次未纳入 Mode/Home/Task/Codegen/Desktop 既有 WIP。备份位于 `/home/keer/workspace/v2-agent-backup-20261027T081509Z`，13,302 个文件已归档并哈希回读核验。仅作本地限定提交，不推送、不合并、不发布。
