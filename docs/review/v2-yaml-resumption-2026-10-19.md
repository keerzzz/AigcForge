# V2 资产 YAML 接续验证 — 2026-10-19

工作区 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。本切片保留接手时全部未提交改动，无提交、无远程操作。只修改 `packages/core/test/asset-yaml-runtime.test.ts`、`packages/core/test/fixture/asset-yaml-probe.ts`，新增本报告和证据目录；接手时已有的 `packages/core/src/util/asset-yaml.ts` 保持原样。

实际读取 V2 根 `AGENTS.md`、主仓 `CLAUDE.md` 与 `ARCHITECTURE.md`、V2 Effect skill、主仓 enterprise-code-standard/reuse-first-refactor skills、build protocol、现有 Effect v4 源码。V2 没有本地 `ARCHITECTURE.md`，主仓架构只作边界参考，当前包方向与行为由 V2 代码决定。按接续任务说明，V2 codegraph 未初始化，本切片使用 `rg` 和精确源码读取。

## 代码发现与修复

| 发现                                                                                                                                                                     | 决定行为的代码                                                                         | 处理                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 真实 runtime probe 原有 YAML 1.1 输入 `color: on` 违反 Agent 配置颜色契约。颜色必须为六位十六进制；因此配置 decoder 返回 `undefined`，不是 YAML 解析把 `on` 转成布尔值。 | `packages/schema/src/config/agent.ts:10`，`packages/core/src/agent/asset-bridge.ts:16` | 改用同一 Schema 允许的 `description: on` 验证字符串语义；生产 decoder 未放宽。                                                            |
| 多字段 probe 结果用 `Schema.Struct`，构建/读取 Promise 和 stdout JSON 边界可明确保留错误类型。                                                                           | `packages/core/test/asset-yaml-runtime.test.ts:10`、`:29`、`:43`、`:56`                | 复用 `Schema.Class`、`Effect.tryPromise`、`Schema.decodeUnknownEffect`，读取 bundle 前检查输出存在，runtime 顺序执行用 `Effect.forEach`。 |
| fixture 中两个模块都导出 `CustomProfile`，import alias 是真实同名冲突。                                                                                                  | `packages/core/test/fixture/asset-yaml-probe.ts:6`                                     | 保留必要 alias，增加一行英文原因。                                                                                                        |
| 七个生产入口统一 YAML 解析/序列化选项，六处 parse、一处 stringify。                                                                                                      | `packages/core/src/util/asset-yaml.ts:3`、`:9`                                         | 保留已有适配器。`schema: core`、`merge: true`、`uniqueKeys: false`、`maxAliasCount: 100` 被真实 owner 与旧 Bun 兼容样例验证。             |

复用候选与方案对冲：

| 候选                                            | 证据                                                                                                                    | 兼容性                                                                                    | 决定与原因                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 现有 `AssetYaml`                                | `packages/core/src/util/asset-yaml.ts:3`，七个入口调用；`rg` 未找到另一套 Core/Util/Schema YAML parse/stringify owner。 | 满足 Bun/Node 通用解析与 Schema 输入边界。                                                | 复用；不加平台条件分支或第二 parser。                      |
| 现有 `testEffect` + spawner + scoped filesystem | `packages/core/test/lib/effect.ts`，`asset-yaml-runtime.test.ts:16`，`fixture/environment.ts`。                         | 顺序运行真实子进程，显式 Layer 组合，scoped 临时目录自动清理。                            | 复用；不模拟 Bun/Node、文件或 registry。                   |
| 直接保留 `Bun.YAML`                             | 七个入口的接手 diff；真正 Node 执行不提供 Bun 全局对象。                                                                | 不能完成 Node 资产迁移。                                                                  | 拒绝。                                                     |
| 新增保持旧 Bun stringify 字节的兼容序列化器     | 本次 `compatibility.ts:46`–`:48` 与 `compatibility.log`。                                                               | 当前只要求语义、持久文件 hash 与 stale guard；旧格式字节不能由 YAML 默认 stringify 保证。 | 保留简单统一适配；不新增投机格式模拟器。技术债边界见下节。 |

## 真实运行路径与覆盖

probe 导入并执行生产 owner，不复制 parser、registry、path 或 mutation 逻辑：

- CustomProfileService：propose → apply → atomic write/readback → CustomProfile reload/getByPath → 重复 apply → 修改 → stale rejection → delete；验证中文、引号、换行、hash、原始 YAML、同内容稳定 revision、修改后的新 revision、拒绝 stale 写入与文件删除。
- WorkflowAsset、PluginAsset：真实临时资产目录加载；保留字符串 `yes/on`、布尔值、日期字符串、十进制 leading-zero、普通 alias；语法错与 alias 扩增标记 `parse_error`，Schema 不合格标记 `bad_frontmatter`。
- ProposeWorkflowAssetTool、ProposePluginAssetTool：真实 validator 检查有效内容、语法错、alias 扩增与 Schema 不符。
- AgentAssetBridge：模型配置与 Agent Info 投影、merge key、重复键后值覆盖、YAML 1.1 `description: on`，语法错/alias 扩增/负 steps 保持拒绝。

这里的七个 owner 指 CustomProfileService、CustomProfile、WorkflowAsset、PluginAsset、两个 propose validator 和 AgentAssetBridge；八个测试文件包含这七套定向回归及 runtime test，不是八个生产 YAML owner。

## 命令、退出码与计数

所有测试、兼容样例、probe build/运行 cwd 均为 `packages/core`。命令原文、cwd、退出码、是否超时和耗时分别保存在同名 `.json` 与 `.log` 中。

八文件命令：

```sh
../../script/bun test --timeout 30000 test/agent-asset-bridge.test.ts test/custom-profile.test.ts test/custom-profile-service.test.ts test/workflow-asset-registry.test.ts test/plugin-asset-registry.test.ts test/propose-workflow-asset.test.ts test/propose-plugin-asset.test.ts test/asset-yaml-runtime.test.ts
```

| 已通过验证                                            | 实际结果                                                                              | 证据                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 固定 Bun 与真实 Node 版本                             | 各 exit 0；Bun `1.4.2`，Node `v24.15.0`。Bun 自报的 Node 兼容版本为 `v26.3.0`。       | `bun-version.{json,log}`、`node-version.{json,log}` |
| 八文件修复后回归                                      | exit 0；58 pass / 0 fail / 181 expect() calls。                                       | `owners-final.{json,log}`                           |
| 最终 runtime test（删除捕获环境中不可见的冗余日志后） | exit 0；1 pass / 0 fail / 7 expect() calls；再次启动真实 Bun 与 Node。                | `runtime-test-final.{json,log}`                     |
| probe Node target build                               | exit 0；保留 Effect/platform-node 为 external，其余真实 owner bundle。                | `runtime-build.{json,log}`                          |
| 独立 Bun probe                                        | exit 0；`{"runtime":"bun","node":"v26.3.0","bun":"1.4.2","owners":7}`                 | `runtime-bun-final.{json,log}`                      |
| 独立 Node probe                                       | exit 0；`{"runtime":"node","node":"v24.15.0","bun":null,"owners":7}`                  | `runtime-node-final.{json,log}`                     |
| 旧 Bun 与现有适配器兼容样例                           | exit 0；9 组 parser deepEqual + 1 组序列化解析后 deepEqual；序列化 bytesEqual=false。 | `compatibility.{json,log}`、`compatibility.ts`      |
| 三文件范围 oxlint                                     | exit 0；0 warnings / 0 errors；仓库当前配置仅对这些非 GUI 文件启用 1 条通用规则。     | `lint-reviewed.{json,log}`                          |
| 三文件与兼容样例 Prettier                             | exit 0；四文件符合格式。                                                              | `format-reviewed.{json,log}`                        |

失败独立记录，不以最终通过覆盖历史失败：

| 实际失败                                                 | 原因与处理                                                                                                                                                                             | 证据                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 八文件首轮 exit 1；57 pass / 1 fail / 175 expect() calls | 唯一失败 `undefined !== 'on'`；probe 的 `color: on` 违反颜色 Schema，改用 description 后通过。                                                                                         | `owners-baseline.{json,log}`                                                         |
| 独立 Bun 与 Node probe 首轮各 exit 1                     | bundle 位于 evidence 目录，external `effect` 不能沿该目录解析：`Cannot find package 'effect'`。没有用重复 Effect bundle 绕过；临时 symlink 指向 Core 现有 node_modules，两端最终通过。 | `runtime-bun.{json,log}`、`runtime-node.{json,log}`、`runtime-resolution.{json,log}` |
| 增量 lint 显式 `v2` 首轮 exit 1                          | 工作区没有本地 `v2` ref；内层 git exit 128：`ambiguous argument 'v2'`。改用实际存在的 `upstream/v2`。该脚本只覆盖 GUI 包，对本切片 Core 文件不作验证；Core 有上述独立范围 lint。       | `lint-changed.{json,log}`、`lint-changed-final.{json,log}`                           |
| 增量 lint `upstream/v2` 重跑 exit 1                      | `953 problem(s) in 209 of 1017 changed files since 4617210822`。这是真实 GUI 范围失败；不修分配外文件，不以 Core 范围绿色掩盖。                                                        | `lint-changed-final.{json,log}`                                                      |

证据根：`docs/review/evidence/v2-yaml-resumption-2026-10-19/`。`summary.json` 自动读取命令与计数，不手写计数；`verified-sources.json` 固定最终三文件 hash。临时 1.7 MB probe bundle 和 node_modules symlink 验证后删除，保留生成命令、bundle hash 与实际进程日志。

`git diff --check` exit 0 只检查 tracked diff；本切片三个代码文件接手时仍 untracked，因此没有把这个空检查当作完整验证。逐文件 `git diff --no-index --check /dev/null <file>` 均 exit 1，输出为空，1 表示文件存在内容差异；这不是命令绿色。另按文件读取检查六个源码/报告/证据脚本的行尾空白，实际 exit 0、零问题，见 `untracked-whitespace.{json,log}`、`whitespace-final.json`。源码和报告另外通过上表 Prettier 检查。

## 明确的未交付范围

| 范围                                                                 | 状态                                                                                                                                                                                                                                                                                                                                                                         | Owner               | 解除条件                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| 旧 Bun 序列化的字节完全兼容                                          | 未提供。语义等价不意味着 bytesEqual；新 serializer 重写旧文件可能更新 revision。revision 决定函数是 `CustomProfile.loadDir` 的 raw-byte hash (`custom-profile.ts:100`)，apply 在 `custom-profile-service.ts:248`/`:257` 比较 current/base，`:281` hash readback。实际 probe 验证同 serializer 的同内容 revision 稳定和 stale rejection (`fixture/asset-yaml-probe.ts:111`)。 | 资产迁移负责人      | 用户或历史契约明确要求旧文件字节稳定，提供代表性历史样本，再评估兼容格式而不是先加第二实现。 |
| Core typecheck、全仓 typecheck/lint、完整 test 与 HTTP/UI 流程       | 本切片未运行；由主智能体统一验证，不能以本表定向绿色替代。                                                                                                                                                                                                                                                                                                                   | 主智能体            | 集成其余切片后运行相应门禁，并独立登记退出码与失败。                                         |
| 完整 YAML 规范一致性、所有 tag/multi-document/非 schema 任意值序列化 | 未声明。当前证据覆盖资产契约样例、真实 owner 与 alias 界限，不构成两个 parser 对全部 YAML 输入等价的证明。                                                                                                                                                                                                                                                                   | 资产 owner          | 出现明确受支持的新增输入形状，按真实 producer/consumer 加回归。                              |
| 生产 YAML owner、public API、依赖与 lockfile 额外编辑                | 本切片未修改；接手的 existing dirty 路由与依赖由其 owner 集成。                                                                                                                                                                                                                                                                                                              | 主智能体/对应 owner | 统一 diff 与类型检查后按分配范围完成。                                                       |

复查：没有新增 platform fallback、手写 registry、并行 parser、API 绕过、非空断言、`any`、sleep 等待或远程写入。新边界复用 Schema/Effect，测试覆盖真实文件与两种实际 runtime。切片未提交，因此不提供人工 commit 清单。
