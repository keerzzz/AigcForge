# P2.2K Plugin 声明资产后端检查点

2026-10-28（Asia/Shanghai）。基线 `e9053f4d1b8a99168a8949c6fbb57ebfa838adad`，分支 `v2-dev`，固定上游 `4617210822bdbb31e5749751afbfb4584ccedac8`。本片十七文件，包括三个正式生成文件。日志采用 UTC，故其 2026-10-27 时间对应本地 2026-10-28，不是重复使用历史验证。

## 行为与根因

既有 Plugin 资产四条 HTTP 路由从 stub 接到 Location graph。新增唯一 [PluginAssetService](../../packages/core/src/plugin-asset-service.ts:118)，将原 proposer 内联校验、短路径事实、保存与删除归入该 owner，复用 PluginAssetPath、LocationMutation、FileMutation.withLock/writeAtomic/remove 和原注册表。没有迁移旧 handler 的弱覆盖或吞回滚逻辑，没有新增执行器、安装器或授权系统。

两个旧实现红测都失败：真实注册表使用 `review.plugin.yaml`，旧 proposer 却返回 `.aigcfroge/plugins/review.plugin.yaml`；YAML 内描述与外层候选不一致仍被接受。现由 [prepare](../../packages/core/src/plugin-asset-service.ts:144) 统一 name/description 和目标，真实 I/O 错误不再伪装为不存在。[proposer](../../packages/core/src/tool/propose-plugin-asset.ts:62) 持久五项 facts，revision 明确 null，正文只存 tool input。

[PluginAsset.parseContent](../../packages/core/src/plugin-asset.ts:56) 统一 YAML 格式/Frontmatter 校验。Info 新增原 content，保留注释、扩展字段、空白和 BOM。注册表使用 Schema 编码声明以移除缺省可选字段，再进入 HTTP 响应；嵌套可选值使用既有 `optional`，避免 category/email/source/timeout 等在 JSON 编码时失败。列表的 source 对象转换为既有 Summary.source 字符串，toolCount=0、bridged=[] 只表示本片没有运行工具/Bridge 接线，不表示已扫描外部插件且结果为空。

apply 的 [CAS 与完整回读](../../packages/core/src/plugin-asset-service.ts:210) 要求已存在文件匹配 revision 并明确 overwrite，保存原字节后核对原文、结构字段和 revision。回读或 registry reload 失败时，仅当磁盘内容仍等于本次预期字节才回滚；回滚失败和外部改写显式返回错误。delete 对现存文件必须匹配 revision；省略 revision 返回 409，缺失文件且无 revision 仍为幂等空操作。创建开关关闭时，可读取当前 revision 后显式删除。

## 独立复审与已修发现

[独立复审](evidence/v2-plugin-backend-2026-10-28/independent-review.md) 发现并促成三项修复：省略 revision 绕过删除 CAS；TextDecoder 默认吞 BOM 导致原文比较失败；`NaN !== NaN` 导致旧 Schema 接受的 timeout 误判为变化。删除红测实际 200 而非 409；BOM/NaN 两条实际触发 ReadbackMismatch。修后分别使用严格 CAS、保留 BOM 解码和 Object.is；全部对应行为已验证。

复审子智能体编写了 supervisor 用例，已在报告披露对该单文件的作者自检限制；另外十六文件由它独立检查。主线程执行全部验证并重新匹配最终 hashes。最初三处源文件在验证副本被复制为 executable mode，现已恢复为基线 100644；主工作区原权限未被批量改动。

## 声明保存与插件执行边界

`.plugin.yaml` 不进入 [PluginSourceDirectory.discover](../../packages/core/src/plugin/source-directory.ts:9) 的可执行入口集合。本片只保存声明，不主动安装或连接 source，不执行声明中的 hooks。

但保存不能承诺“没有任何插件执行或网络副作用”。[共享 loader 的 digest 比较](../../packages/plugin/src/source.ts:13) 决定是否复用模块；缺失 optional import 由 [Bun source tracker](../../packages/plugin/src/source.bun.ts:65) 观察父目录，新增/删除声明会改变目录名列表。真实 Instance/ConfigPluginSource/PluginModule/registry 的 [supervisor 回归](../../packages/core/test/plugin/supervisor-reload.test.ts:251) 已验证：给定 Watcher.Test 的创建/删除事件，已有 TS 插件的求值和 setup generation 增加，而可执行集合仍只有原插件。该结果不是 YAML 被执行，也不是原生 OS watcher 或实际 HTTP 写入到刷新的完整链。

简单实现的技术债明确保留：声明资产和运行插件共享目录；既有插件可能刷新，缺失包配置也可能重试解析。没有只过滤某个 handler 或某类后缀来伪造强隔离。进一步隔离须同时检查 ConfigPluginSource 与 PluginModule 的观察路径，并保持缺失依赖后来出现时的恢复能力。

## 验证

[验证清单](evidence/v2-plugin-backend-2026-10-28/validation-manifest.json) 自动生成每次命令、cwd、退出码、源码 pins、原始 tally 和日志 SHA256。隔离树 `d184fb4ca43294f72b40e3a5590df9c7956e24bf`；十四个非生成文件与主工作区逐字节相同，三个生成文件以隔离树为提交权威。固定 Bun 1.4.2，包内串行测试，类型检查使用 GOMAXPROCS=2、GOMEMLIMIT=3GiB。

| 验证范围                                        | 实测结果                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Core 声明/路径/回读/故障集                      | 50 pass / 0 fail；156 expects；4 文件                                       |
| Plugin supervisor reload 整组                   | 9 pass / 0 fail；47 expects                                                 |
| Server 全包                                     | 160 pass / 1 skip / 0 fail；7510 expects；43 文件                           |
| Schema Plugin                                   | 8 pass / 0 fail；14 expects                                                 |
| Client 全包                                     | 224 pass / 0 fail；906 expects                                              |
| Core/Schema/Protocol/Client/Server/GUI/App 类型 | 对应包脚本各 exit 0，版本差异由 manifest 列示                               |
| 正式生成与稳定性                                | Client generate、OpenAPI generate/check、再次 generate 和生成物 diff 均通过 |
| 定向 lint/AST/format/diff                       | 14 TS 文件、10 生产 TS 文件、17 文件与切片差异各 exit 0                     |

Server 单个 hg skip、已有 MaxListenersExceededWarning、AST runtime binary resolution warning 保留。lint 当前配置仅一条规则，不夸大为全面审计。HTTP 使用真实 Web Request handler、runner、SQLite 和文件系统；不是 GUI、外部 provider 或真实 TCP 验收。

Schema 初始可选字段编码失败、错误尝试用 Schema.toType 解码 Class 普通对象、两处测试品牌类型不匹配、先前零匹配的 roundtrip 测试命令以及几次相对 cwd 同步命令失败均保留。用例红测与 fixture/命令失败区分；最终源码哈希决定适用性，sourceTree 是暂存参考，不覆盖当时 working-file pins。所有重复运行不相加。

## 生成物与现场保护

初次生成把几个 Plugin 公开类型展开成匿名结构；按仓库已有 Schema.Struct identifier 写法保留原有十六个 PluginAsset 导出，生成后共二十一个；没有手改生成器或生成文件。非有限 timeout 仍保留旧 Schema.Number 合同，生成类型如实表达其 JSON 编码，不改成 Finite 掩盖区别。

主工作区已有未提交 Codegen/Task 生成改动。原文件保存在 `/home/keer/task-backups/v2-plugin-generated-wip-20261028`；Effect/OpenAPI 三方合并无冲突，Promise 五处冲突保留非 Plugin 改动，1426 个非 PluginAsset export body 与原 WIP 逐字节一致。提交只暂存隔离生成结果，工作区保留合并后的 WIP。其余 58 个 tracked WIP 哈希保持不变。详见 [合并记录](evidence/v2-plugin-backend-2026-10-28/generated-merge-result.json)。

## 剩余范围

`AUDIT-V2-ASSET-CONSUMER` / `V2-SERVER-LEGACY` / `V2-D-REFERENCES` / `V2-VALIDATION` 继续开放。Owner Core/Server/App/GUI/Plugin/Desktop 与主智能体。解除条件：Plugin GUI 原声明/副作用说明/确认取消/CAS；Bridge 扫描及原始格式转换；默认 Project/显式 global 实际放置；导入、编辑、引用删除；source/hooks 实际消费与授权；共享目录的原生 watcher/HTTP/网络副作用链；冷恢复、provider、Desktop/跨平台；Workflow 等剩余资产。声明保存成功不关闭这些目标。

仅本地限定提交，不 push、merge 或发布。
