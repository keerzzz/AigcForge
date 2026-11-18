# P2.2E Prompt 后端检查点

日期：2026-10-27，Asia/Shanghai。工作区：`/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。状态：适用命令通过，独立复审及主智能体限定协议审批待完成。完整 P2.2 与 P0–P6 保持开放。

## 行为与复用

接续 2026-10-26 已应用的 Prompt 候选，完成中断后的验证。Prompt 提案只记录路径、存在性、revision 和名称/路径冲突事实；经显式 apply 写入后，可以读取原模板并通过同一 Session 的公开 prompt 入口消费。空正文和超过 canonical Template 上限的外部文件进入 `bad_template`，不进入有效目录，content 返回类型化 404。

- 提案事实由 [ProposePromptAssetTool.Plugin](../../packages/core/src/tool/propose-prompt-asset.ts:39) 产生；模板仍在原 tool input 中，metadata 不复制正文。
- 四个既有 HTTP 端点由 [PromptAssetHandler](../../packages/server/src/handlers/prompt-asset.ts:11) 连接已有 PromptAsset/PromptAssetService。原 owner 的路径检查、写入、revision 与回读处理保留。
- Session 与请求 Location 的相等规则由 [AssetLocation.atSessionLocation](../../packages/server/src/handlers/asset-location.ts:27) 决定：规范化后同时比较 directory 与 workspaceID，再取得原 Location 图。
- 外部模板有效性由 [PromptAsset.loadDir](../../packages/core/src/prompt-asset.ts:86) 调用 canonical `PromptAsset.Template` 决定；生成类型与 OpenAPI 已包含 `bad_template`。
- 公共 Instance 图提供 PromptAsset 与 PromptAssetService，复用原 SessionRunner、持久 inbox 和输入结果；未新增模型执行循环。

## 证据与验证

[最终输入记录](evidence/v2-continuation-2026-10-27/prompt-final-input.json) 绑定 15 个源码/测试/生成文件及 13 份适用命令记录。各记录保存实际命令、cwd、退出码、运行前后源码哈希和日志哈希。这些命令运行期间源码未变；随后独立 Task 时区保留修复另行绑定和验证，不将本表当作后续全部 WIP 的全包结论。

| 验证                           | 实际结果                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Server 全包                    | 159 pass / 1 skip / 0 fail；7255 expects，40 文件                                                                                             |
| Core 三类资产关联测试          | 23 pass / 0 fail；58 expects，3 文件                                                                                                          |
| Client 正式 generate           | exit 0；生成未改变源码                                                                                                                        |
| Protocol OpenAPI check         | exit 0                                                                                                                                        |
| Protocol、Client、App 类型检查 | 各 exit 0，逐包串行                                                                                                                           |
| 定向 lint                      | 13 文件，0 warnings / 0 errors；当前非 GUI 配置为 1 条规则                                                                                    |
| Effect AST 与格式              | 9 个生产文件 AST、13 文件格式，各 exit 0                                                                                                      |
| 历史 Schema/Core/Server 类型   | 复用已核验的最终记录；在 Prompt 验证冻结时，Schema/Core 捕获与 package 树仅 Server Prompt 测试不同，Server 品牌构造修正版记录匹配全部 15 文件 |

Server 夹具通过真实 `createRoutes` 图和 [HttpEffect.toWebHandlerWith](../../packages/server/test/fixture/asset-http.ts:72) 运行认证、Location、SessionRunner 与资产服务，文件写入实际临时目录；数据库为内存 SQLite，模型为 TestLLM。该证据不证明 TCP、GUI、外部 provider、磁盘数据库冷重开或 Desktop。虽然启用了文件 watcher，apply/delete 的显式 registry reload 不单独证明 native watcher 交付。

历史红测、格式失败、品牌断言类型失败及中断记录保留。新 `prompt-core-affected` 命令误包含两个不存在的文件，Bun 只匹配并执行 Prompt 的 21 个测试；它不作为三文件证据，也不与修正后的 23 个测试相加。Server 的 MaxListenersExceededWarning 和 AST 的 postinstall/binary-resolution 警告单独保留，不把 exit 0 写成无警告。

## 尚未交付

归属唯一 [技术债账本](../technical-debt.md) 的 `AUDIT-V2-ASSET-CONSUMER` / `V2-SERVER-LEGACY`：

- Prompt GUI 候选查看、确认、取消和模板插入：Owner App/GUI/Core；解除为生产宿主中明确操作后进入同 Session 的真实消费链。
- 默认当前 Project、显式个人全局落盘：Owner Core/Server/App；沿用已有产品裁决，解除为 Project/worktree/Location 归属与优先级实现及行为验证。
- 编辑、导入、引用删除和冷恢复：Owner Asset/Import/Custom/Core；解除为实际持久生命周期及历史消费验证。
- 其他四类资产、全平台、性能与最终切换：保留现行计划及原 Owner/解除条件。

本轮未提交。生成的提交区间 `git log --oneline 251c0fe38041a326e624db464d1ee0efd1522881..HEAD` 为空。既有 WIP 的仓外备份与回读结果见 [备份指针](evidence/v2-continuation-2026-10-27/backup-pointer.json)。
