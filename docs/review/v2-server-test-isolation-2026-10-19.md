# V2 Server Fetch 测试环境隔离（2026-10-19）

状态：Fetch 定向、Server 全量、单包 typecheck 和格式检查通过。工作区 `/home/keer/workspace/aigcfroge-v2`，分支 `v2-dev`。本任务写入范围为 `packages/server/test/fetch.test.ts`、本报告与对应证据目录，提交由主代理统一执行。

## 根因与实现

此前 Server 全量结果由主代理收取：85 pass、1 skip、1 fail，最后的双端口 busy OAuth 用例超时。该测试文件共享选项只有 `config.project: false`，仍使用用户全局 JSON 配置，日志出现多个用户 MCP 服务器加载。这里不把超时直接归咎于 MCP，而是修复测试本身依赖宿主配置这一可核查缺口。

实际决定配置发现关系的是 `packages/core/src/config/discovery.ts:25` 的 `ConfigDiscovery.discover`：`project: false` 在第 34 行只阻止向上目录遍历；第 55 行独立判断 global 开关，第 66 行仍返回 global 根。生产装配位于 `packages/server/src/routes.ts:127`，把 `ServerOptions.config.directory` 提供给 `Global.layerWith`。ServerOptions 未暴露 global:false，复用已有 directory 契约即可隔离用户 JSON 配置。

测试新增复用的 `makeHandler`，先获取 `tmpdirScoped` 作为默认配置目录，再调用实际 `ServerFetch.make`；现有显式目录与内容覆盖优先。全部 Handler 统一通过该 fixture。作用域内先创建临时目录，再构建 Handler，所以 Effect 按逆序释放 Handler 后删除目录。项目发现保持关闭，所有 OAuth 端口、生产重试和原测试 timeout 保留。

方案对比：仅对最后一个超时用例增加 timeout 会保留宿主配置污染；统一 fixture 直接处理全部该文件 Handler 的共享前提。没有新增生产代码，没有屏蔽失败用例或更改固定 OAuth 端口。

本次采用配置目录隔离与现有 Effect helper 的最小改动。`ConfigDiscovery` 仍有全局 `.agents`/`.claude` 兼容来源，ServerOptions.directory 不重写 Global.home；本次只解决已观察到的用户 JSON/MCP 注入。若后续发现家目录兼容资产造成污染，owner 为测试环境维护者，解除条件是通过现有 Global node 测试替换隔离 home，并有实际失败证据；不为未观察问题扩大生产选项。

## 验证记录

| 阶段        | 命令                                                                                                 | 退出码 | 结果                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| 源码契约    | `cat packages/server/test/fetch.test.ts packages/server/src/fetch.ts packages/server/src/options.ts` | 0      | 真实生产 make EAGER 构建与 config.directory 契约          |
| 配置关系    | 读取 ConfigDiscovery、Global、makeRoutes 与现有 tmpdir/effect helpers                                | 0      | project:false 不关闭 global；directory 可定向全局 JSON 根 |
| Effect 资源 | 读取本地 Effect 源码 acquireDisposable 与 tmpdirScoped 现有实现                                      | 0      | 复用既有 scoped fixture，无手写 runtime                   |

测试从 `packages/server` 运行，使用永久项目 `../../script/bun`。网络命名空间通过 `unshare -Urn` 与 `ip link set lo up` 隔离宿主 OAuth 端口，不改生产端口。

| 验证        | 精确命令                                                                                                                     | 退出码 | 结果                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| Fetch 定向  | `unshare -Urn sh -c 'ip link set lo up && exec ../../script/bun run test --timeout 30000 test/fetch.test.ts'`                | 0      | Bun 1.4.2；12 pass、0 fail、98 expect calls；10.72 秒                                     |
| Server 全量 | `unshare -Urn sh -c 'ip link set lo up && exec ../../script/bun run test --timeout 30000'`                                   | 0      | Bun 1.4.2；86 pass、1 skip、0 fail、5804 expect calls；87 tests across 30 files；31.98 秒 |
| 增量 lint   | `./node_modules/.bin/oxlint packages/server/test/fetch.test.ts`                                                              | 0      | 0 warnings、0 errors                                                                      |
| 格式        | `./node_modules/.bin/prettier --check packages/server/test/fetch.test.ts docs/review/v2-server-test-isolation-2026-10-19.md` | 0      | 全部通过                                                                                  |

日志：`docs/review/evidence/v2-server-test-isolation-2026-10-19/fetch.log`、`server-full.log`。Fetch 日志没有用户 MCP 加载或网络违规；Server 全量中的 MCP 子进程属于既有 `test/fixture/mcp-starts.cjs` 场景，日志明确使用项目 Bun 1.4.2 的永久缓存路径。

两轮都仍有 `MaxListenersExceededWarning: 11 listening listeners added to [Server]`，来自现有 OAuth 反复 bind 路径；这里保留警告，不修改生产重试逻辑或以 suppress 掩盖。全量 1 skip 沿用现有套件，未新增 skip。

本轮同时隔离用户配置和宿主端口，因此证明隔离环境内回归通过；它没有单独量化宿主配置对原超时的贡献。

最终单包检查从 `packages/server` 执行 `../../script/bun typecheck`，exit 0，实际脚本 `tsgo -b`，日志见 `typecheck.log`。最终 Prettier 检查本次测试、运行时源码、两份报告和探针源码，以及 `git diff --check` 均 exit 0。精确命令、目录、退出码与 tally 见本证据目录的 `verification.json`。
