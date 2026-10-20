# 测试顾问立场书：被删掉的测试不会告诉你它保护了什么

> 记录说明：本文是 Round 1 立场书。部分数字与措辞已在 Round 2 与 [Lead 裁决](verdict.md) 中收敛，最终结论以裁决为准。

> 角色：资深测试顾问（风险覆盖 / 缺陷拦截 / 可演进性）
> 日期：2026-10-19；基线 main @ 75ee27fbd；工作目录：仓库根
> 约定：标「已核实」者，我读过对应文件或跑过命令；标「未核实」者显式保留不确定。

## 0. 结论先行

1. 我接受成本真实：964 个测试文件、227,247 行、79 个 Playwright spec（16,859 行）；CI unit 上限 40/90 分钟（test.yml:75），e2e 90/50 分钟（test.yml:270），一次完整 Chromium 实测 179/188 通过、24.9 分钟（docs/technical-debt.md:306）。这些不是幻觉，任何人用「测试不多」来回避它都是不诚实的。
2. 但「测试多导致开发慢」这个因果只在三个具体位置成立：测试类型错（源码字符串断言、只注册不执行的覆盖）、层级错（把最贵的层当默认层）、成本结构错（环境依赖与 flaky 未隔离）。删总量不是解，改类型、改层级、改门禁才是。
3. 「只写必要测试」不可操作：必要性大多在事故之后才可知。最干净的反例是 P0-B 白屏——Vite、tsgo、App 单测、exerciser 全绿，只有 e2e 看到；事后才用 124 行单测把它变成廉价回归（docs/review/AigcForge_CUSTOM_M2_REVIEW.md:99-111）。
4. 「不做全套 TDD」我部分接受：TDD 是设计工具，不是覆盖率工具。本仓有它生效的实证（d23cea0e3 先测量再定 owner；five-mode 方案 :55 的 D2 探针决定事务路线），但它只适用于可判定层；对 Effect 并发、多进程、浏览器、基准层强制红先行会制造 flaky。
5. 我的让步清单约 270 行（其中 80 行条件删除），全部是「删掉不降低风险覆盖」的类型；不可让步的 8 类另有清单。给 Lead 的最终判据是「一条测试必须能回答：它防的失败是什么、失败如何被观察、谁负责修」，而不是一个数量目标。

## 1. 成本：先承认，再定位（不拿它当挡箭牌）

| 成本项             | 证据                                                                                                                                                                                                                                                | 我的判断                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| CI unit 40/90 分钟 | .github/workflows/test.yml:70-78 注释：2026-09-21 一轮 core 的 2,493 个 Windows 测试 0 失败，但 aigcfroge 的 3,320 个测试没跑完就超时；Linux 同套 aigcfroge 20 分钟                                                                                 | 预算已被打满；根因是「每个测试都在两个 OS 跑全套」，不是「测试写得多」   |
| 本地单包全量       | Lead 2026-10-19 实测：core 294 文件 / 2,513 tests / 150.26s，2 个环境依赖失败（缺 codex app-server、real typecheck script）                                                                                                                         | 2.5 分钟可接受；假红来自未隔离的外部工具依赖，属可打标签的问题           |
| E2E 全量           | technical-debt.md:306（179/188、24.9 分钟）、:319（顺序敏感 10/11）、:339（冷 dev server 机制）、docs/review/global-shell-remaining-closure.md:98（冷启动预热 / 单独耗时 293 秒，此后每路由 7-11 秒；热态复跑 28.6s）                               | E3 是唯一能看到浏览器真面目的层，不能按分钟数砍；该修的是预热与隔离      |
| E4 与 benchmark    | test.yml:171、:179 两个 variant 各 45 分钟且不进 PR；technical-debt.md:329 的 A/B 显示宿主漂移（同 commit 371.9s 到 405.8s）大于修订差异                                                                                                            | 这类门禁本就不该按每次提交运行；保留非 PR 触发是对的                     |
| flaky 与假红       | technical-debt.md:87 四个子进程/实例测试在并行负载下集体 TimeoutError、空载全绿；technical-debt.md:333 一条「产品缺陷」实际是测试自身定位器 bug，从 S4 挂账到 9-16；提交 0a58ab85a 的 mock 泄漏让 provider 在后续文件变 undefined（修后 1116 通过） | 这才是真正拖慢开发的「测试税」；它不是删测试能解决的，是测试工程质量问题 |
| 假门禁             | exerciser 的 coverage 模式从不执行场景（packages/aigcfroge/test/server/httpapi-exercise/index.ts:3862-3866 注释原文）；effect 模式在 CI 是 advisory（test.yml:85-92）                                                                               | 部分「测试数量」根本没在保护行为，属账面虚胖，应先清理                   |

结论：成本真实。但逐项看，只有「假测试、假门禁、未隔离的外部依赖」是可删可改的负资产；其余是「必要但昂贵」的投资，应优化执行方式而不是取消。

## 2. 现有测试拦截/防止了什么：10 个实例

| #   | 缺陷或风险                                                                                   | 发现的层与证据                                                                                                                                                                                                  | 若漏测的后果                                             | 现在由什么守护                                                                        |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Web 全路由白屏（P0）                                                                         | app/src/utils/server.ts 经 core 触达 flag.ts，浏览器无 process 导致 ReferenceError。review 文档 :99-105；修复前 session-todo-progress.spec.ts 3/3 空白页，修复后 17/17                                          | 任意路由白屏，全部 session 页 e2e 皆坏                   | e2e 加 packages/app/src/utils/browser-boundary.test.ts（124 行，红证据见 review:111） |
| 2   | 跨服务器资产串台                                                                             | canonical URL 指向服务器 B，七类资产请求却打到全局当前服务器 A。technical-debt.md:337；packages/app/e2e/regression/chat-assets-cross-server.spec.ts:6-19                                                        | 用户看到另一台服务器的资产（接近数据泄漏级）             | 1 条双实例 mock e2e（420s 预算）                                                      |
| 3   | 缺失文件读取返回 200 空文本                                                                  | 提交 77051c464 改为 typed 404（handlers/file.ts:103-107）；technical-debt.md:343                                                                                                                                | 「文件消失」与「文件为空」不可区分，消费者把故障当空文件 | E3/E4 加 handler 契约                                                                 |
| 4   | OpenAPI operationId 缺失导致生成的 SDK 方法运行时为 undefined                                | packages/aigcfroge/test/server/openapi-drift.test.ts:42-54 注释原文：其它地方都看不见，路由照常响应、exerciser 通过，SDK 方法只在调用时 undefined；红证据 review:94（临时改 REDPROOF 后 1 fail，恢复后 5 pass） | 契约漂移静默到调用期，发布后炸                           | openapi-drift 加快照逐字一致（:56-66）                                                |
| 5   | provider 文本块在工具边界未关闭、run --format json 事件顺序颠倒                              | 提交 879453a61，同批加 packages/llm/test/provider/openai-chat.test.ts 35 行协议回归                                                                                                                             | 脚本消费方事件序错乱，模型输出与工具调用交错错误         | llm 协议回归加录制回放                                                                |
| 6   | 硬配额错误被当可重试                                                                         | 提交 d611b1000，executor.test.ts 新增 65 行、run-process.test.ts 40 行、message-v2.test.ts 39 行                                                                                                                | 不可重试错误反复重试，拖时间与配额                       | llm/executor 加 CLI 进程测试                                                          |
| 7   | 五种权限错误与真实 crash 渲染成同一句话                                                      | 提交 d23cea0e3（先测量后定位 owner），packages/core/test/tool-bash.test.ts 新增 70 行                                                                                                                           | 模型与用户无法区分拒绝与崩溃，纠正反馈丢失               | 真实 bash leaf、Tool.make、registry 的行为测试                                        |
| 8   | kill-switch 排空用过期 run revision 导致 run 永久 running 且所有端点 400                     | review:121；红证据：改回旧实现后 3 个测试失败，改回修复后 13 pass                                                                                                                                               | run 卡死、既不能重推也不能取消                           | workflow-runner 的 drain 用例                                                         |
| 9   | 迁移 UNIQUE 索引在同 session 两条 run 的非空库上失败，Database 层 Effect.orDie，每次启动失败 | review:124；守护 packages/core/test/database-migration.test.ts:270                                                                                                                                              | 全部存量用户无法启动                                     | 迁移测试                                                                              |
| 10  | V2 回归而 V1 正常（tool denial 静默）                                                        | 提交 e5d301fae 先钉住 V1 真实行为再判方向，结论是 V2 才是回归、不是缺功能                                                                                                                                       | 修错层；把回归当缺功能，丢失相反事实                     | V1/V2 parity 用例                                                                     |

另外两个「设计反馈型」实例（产出是决策，不是绿色）：

- d23cea0e3 的「先测量」：先跑真实 bash leaf、Tool.make、registry，发现五类错误同一字符串，才决定 owner 与修法。
- five-mode 方案 :55 的 D2 探针：同连接原子批次可行、跨连接必死（SQLiteError: database is locked），直接决定 S2 走单事务。

必须同时说清的反面：R5 独立复审登记的 P0/P1 发现里，没有一条是既有 typecheck、单测、lint、exerciser 发现的（review:115 原文：它们全部存在时门禁都是绿的）。这既证明测试不是万能，也证明「必要性」不能靠写测试的人自我枚举——需要风险清单与独立复审互补。

## 3. 漏测成本按域：给「必要测试」一把刻度尺

| 域                 | 典型失败                         | 现有拦截                                                   | 漏测成本                                       | 我的判定                                                                         |
| ------------------ | -------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| provider transform | 事件顺序、错误分类、流式边界     | llm 协议测试加 recorded golden                             | 静默错序、重试风暴；脚本与成本直接受损         | 高，保留并持续加契约样本                                                         |
| DB migration       | 启动即失败、回填错值             | database-migration.test.ts                                 | 全部存量用户不可启动                           | 最高，不可删                                                                     |
| 权限               | 越权 retry、结果不可区分         | tool-bash、tier、authorization                             | 跨 Session 操作与数据越权                      | 最高；R5-4（retryStep 缺 run 到 session 归属校验）当时没有测试，是真实缺口，应补 |
| SessionRunner      | run 卡死、durable admission 缺口 | session-runner 系列测试、e2e/real/v2-admission-gap.spec.ts | 会话不可恢复、发布阻断                         | 高                                                                               |
| HTTP 契约          | SDK undefined、缺 identifier     | openapi-drift 加 exerciser（仅注册覆盖）加 httpapi 系列    | 生成 SDK 与运行时不符                          | 高；注册覆盖不等于行为覆盖（technical-debt.md:88 同型问题）                      |
| E2E 主路径         | 白屏、串台、路由错误             | 79 个 spec                                                 | 唯一能看到浏览器真实行为的层，漏了就是 P0 出厂 | 高，但只留主路径与错误态                                                         |

这张表就是必要性的可判定来源：必要性等于失败后果乘发生概率乘该层能否看见，而不是「这个函数有没有被覆盖」。

## 4. 测试分型：量大不等于冗余，但我明确承认低价值存在

四型（每型给判定标准与实例）：

1. 规格型/契约型：违反即产品错误。openapi 快照、exerciser 路由注册、迁移、i18n parity、presentation-tagging。判定标准：它保护的是对外承诺。
2. 回归型：每条必须能说清「它防哪个已发生的缺陷」。browser-boundary（P0-B）、cross-server（:337）、permission outcomes（d23cea0e3）、quota retry（d611b1000）。判定标准：说不出缺陷编号或事故说明的回归测试，优先怀疑。
3. 安全网型：E3 主路径（composer submit、files、PTY、terminal）、E4 真实后端。判定标准：它看见的失败，其他层结构性看不见。
4. 设计反馈型：d23cea0e3 的测量、D2 探针、five-mode :46 的 S0 RED 基线。判定标准：它的产出是决策，不是绿色。

低价值型（我认账的负资产，均给位置）：

- 源码字符串断言：assistant-nav-tree.test.tsx 整文件 131 行、45 处 toContain 跨 9 个源文件（:5-17）；assistant-session-panel.test.tsx:13-66 同类。它们「文本搬家就红、行为坏了还绿」（docs/testing.md:154 原话）。提交 170567929 已退役 14 条同类断言，说明这不是推测。
- 只注册不执行的覆盖：exerciser coverage 模式（index.ts:3862-3866）；其中 /file/content 缺失场景仍断言 200 空文本（index.ts:1419-1423），与 handler 的 typed 404（handlers/file.ts:103-107）相反。该断言从未被硬门禁执行（effect 为 advisory，test.yml:85-92），是「假测试」的活体样本。
- 环境依赖未隔离：codex app-server 与 real typecheck script 的 live 用例（Lead 实测 core 全量 2 fail）；technical-debt.md:87 记录的四个重负载敏感文件。
- 冗余 pin：矩阵收窄后 40 处 pinEnglishUI / pinDesktopViewport 不再改变结果（technical-debt.md:335）。
- 覆盖假象：technical-debt.md:88 指出 exerciser 三个 workflow mutation 端点只注册 404 场景，而覆盖门禁按 METHOD path 计数——「已覆盖」不等于「行为已测」。

数量本身说明不了问题。core 测试行数超过 core 源码（Lead 度量），但单测是最便宜的层；真正该按成本收益排序的是 79 个 E2E spec 与 20 个含源码字符串断言的测试文件。coverage-manifest.json（169 行）的 baseline 记录 198 个测试 / 50 文件、13 个稳定失败加 1 次 flake；三例被 quarantine 的用例后来全部转正，且没有一例被确认为产品缺陷：两例是测试或基础设施问题（dev-server reload abort、ZWSP 读取），一例是非唯一定位器加默认关闭的侧栏（无产品改动）——说明 E2E 全量审计有价值，同时说明「e2e 红了」必须先排除测试自身。

## 5. 反驳「只写必要测试」：三个不可操作点加一张不变量清单

1. 事后偏差：P0-B 之前，任何「必要测试清单」都不会包含「app 不得经 core 触达 flag.ts」；它是在白屏之后才被写下的（review:111）。删掉看似多余的测试，等于删掉未来事故的期权。
2. 判定时机错位：必要性在写的时候无法判定，只能在失败后果、发生概率、可观察层上判定。review:115 的 R5 那批 P0/P1 全部逃过既有门禁，说明连「全绿」都不能证明必要，更不能作为删除依据。
3. 删除的期权价值：technical-debt.md:321 的矩阵收窄（约 1030 到 218 实例，docs/testing.md:69）是成功删除——但它是先证明冗余（矩阵契约由 presentation-matrix.spec.ts 与标签门禁保证）再删；:335 的 40 处 pin 也明确保留给单跑调试。正确流程是「证明替身存在再删」，不是「凭必要感删」。

哪些看似多余、实际保护架构不变量：

- 依赖方向/类型归属：browser-boundary.test.ts（124 行，把「浏览器包不得引入 Node-only core」变成可执行的 BFS；:111 还有一条守卫的守卫，防止解析失效空跑）；配套 .oxlintrc 的 no-restricted-imports（docs/testing.md:161-163）。
- 类型归属：assistant-session-panel-open.test.ts:73 的双向 assignable（docs/testing.md:160），让 tsgo 而不是 toContain 失败。
- 双运行时 parity：docs/testing.md:167；e5d301fae 证明它能定位「回归在 V2 不在 V1」；e2e/real/v2-admission-gap.spec.ts 用「绿色表示缺口仍在」的活断言把已知债钉住。
- i18n parity：packages/ui/src/i18n/parity.test.ts 全文 23 行，断言 key 集合与模板占位符集合相等，是最便宜的一类契约测试。
- 迁移/契约快照：openapi.snapshot.json 加 UPDATE_OPENAPI_SNAPSHOT=1 显式重生成（docs/testing.md:134），把契约变更变成评审可见的 diff。
- 标签纪律：presentation-tagging.spec.ts:77 扫描源码强制「凡按 project.name 分支必须带标签」，否则 spec 会在矩阵里静默停跑。这是用测试保护测试基础设施的典型。

## 6. 评估「TDD 强制」：设计工具，不是覆盖率工具

事实：docs/testing.md:11 规定强制循环；:170-176 给出「新增 RED 必须可满足」的判别式（临时改生产代码、转绿、还原、两次输出进报告），但这是人工步骤；docs/plan 下五个 tdd 文档合计 3,375 行；我 grep .github/workflows 与 script/ 未发现任何机械校验 TDD 或先红的门禁。结论：文档强制不等于机械强制，当前「强制」不可执行，只能靠人。

TDD 在本仓真正生效的证据是设计反馈，不是覆盖率：

- d23cea0e3：先测量，因为计划把 owner 留空，而答案决定修复该放哪。
- five-mode 方案 :34-35 自己诊断：测试验证模块形状，而不是跨层行为；源码字符串断言、UI/Router 污染纯测试、测试复制生产逻辑，使「配置存在但不可运行」长期假绿。这说明本仓最需要的不是更多 TDD，而是换测试类型。
- five-mode :46 的 S0 RED 基线自证可满足；:55 的 D2 探针直接决定事务路线。

分层策略（可落地）：

| 层                                                                                               | 测试先行义务                                    | 理由与证据                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0 可判定纯层：schema 解码、协议 transform、错误分类、权限判定表、迁移、契约快照、i18n、路径包含 | 强制红先行                                      | 失败可稳定重放、单测秒级；本仓多数 P0 都属此类                                                                                                              |
| T1 Effect 服务集成（testEffect、it.live、就绪信号）                                              | 缺陷可稳定复现时红先行；否则先写 RED 基线       | fiber 失败常依赖调度；固定 sleep 会 flaky（technical-debt.md:87；test/AGENTS.md:165 引 PR #27622）                                                          |
| T2 浏览器 E3                                                                                     | 复现优先加主路径覆盖，不要求每个 PR 红先行      | 呈现、路由、定位器的真值只能在浏览器得到（P0-B、:337 都由 e2e 抓到）；ef2e6336f 的 route-level baseline 用 page.clock 复现静默 turn，证明复现可以不用 sleep |
| T3 多进程 E4、benchmark、矩阵                                                                    | 证据轮次加 quarantine 加明确 unlock，不做红先行 | 宿主漂移大于修订差异（technical-debt.md:329）；冷 dev server 结论是会让人修探针而不是修运行方式（:339）                                                     |

一句话：TDD 的适用范围由「红的可归因性与可重放性」决定，而不是由团队是否信奉 TDD 决定。

## 7. 我让步的部分：可删/可改清单（位置与估行数）

| 项             | 位置                                                                   | 估行数               | 动作与前置条件                                                                                                                          |
| -------------- | ---------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 整文件源码断言 | packages/app/src/components/assistant-nav-tree.test.tsx:5-131          | 131                  | 删除；前置：确认行为由 model 测试与 e2e 主路径接住（文件头注释自称 pure functions 另有测试）                                            |
| 结构型源码断言 | packages/app/src/pages/session/assistant-session-panel.test.tsx:13-66  | 约 54                | 删除结构断言、保留 open 行为测试；mount 类断言转 e2e（mode-slot-fallback-a11y.spec.ts，文件注释 :72-75 也说 source check 看不到 mount） |
| 冗余 pin       | 40 处 pinEnglishUI / pinDesktopViewport（technical-debt.md:335）       | 约 80（条件）        | 先以 --project=chromium-zh 单跑一次确认，再删                                                                                           |
| 假断言         | exerciser index.ts:1419-1423                                           | 5                    | 改为 404 断言或删除；同时把 effect 中稳定绿的场景升为硬门禁（改 test.yml:85-92）                                                        |
| 环境依赖未隔离 | codex app-server、real typecheck 的 live 用例（Lead 实测 core 2 fail） | 0（不删）            | 加能力标签或 skipIf，让本地与 CI 都不再假红                                                                                             |
| 合计           |                                                                        | 约 270（含 80 条件） | 这是我认为真能降成本、且不降低风险覆盖的部分                                                                                            |

我同时接受「覆盖数字不能当 KPI」：technical-debt.md:88 的 404-only 场景与 index.ts:3862 的不执行模式，都说明覆盖可以被账面满足。

## 8. 不可让步清单（删了就是赌）

| #   | 测试                                                                                                                         | 它防的失败                   | 为什么不能让                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------ |
| 1   | packages/core/test/database-migration.test.ts:270                                                                            | 存量库启动失败（review:124） | 失败是全局不可启动，迁移没有试错空间       |
| 2   | packages/core/test/tool-bash.test.ts（d23cea0e3）、session-permission-tier、httpapi-authorization                            | 拒绝与崩溃不可区分、越权     | R5-4 无测试已说明缺口代价；这是安全边界    |
| 3   | packages/llm/test/provider/openai-chat.test.ts、executor.test.ts、recorded golden                                            | 事件序、错误分类、流式边界   | 失败静默且跨层，脚本与成本直接受损         |
| 4   | packages/aigcfroge/test/server/openapi-drift.test.ts:42-66、exerciser coverage/auth                                          | SDK undefined、契约漂移      | docs/testing.md:134 明确「其它门禁都不报」 |
| 5   | docs/testing.md:167、e5d301fae、e2e/real/v2-admission-gap.spec.ts                                                            | 修错层、V2 回归              | 双运行时是本仓当前主要事故源               |
| 6   | e2e/regression 中 62 个 spec 的主路径（composer-submit、session-files、terminal、cross-server）                              | 白屏、串台、路由错误         | 唯一能看见浏览器真实行为的层               |
| 7   | core/test/credential-scanner.test.ts、session-ui sanitize-regression.test.tsx、markdown-sanitize.spec.ts、a6d269efa 路径包含 | XSS、凭据泄漏、越界读写      | 后果不可逆                                 |
| 8   | ui/src/i18n/parity.test.ts（23 行）、presentation-tagging.spec.ts（118 行）                                                  | 漏翻译、矩阵静默停跑         | 单位成本极低，删除省不了多少               |

## 9. 给 Lead 的可拍板建议

1. 必要测试判据（写进 docs/testing.md，可审查）：一条测试必须能回答三问——(a) 它防的具体失败是什么（引用缺陷、契约或 ADR 编号）；(b) 失败在哪一层可被观察到、为什么别层看不到；(c) 失败时谁负责修。答不全的标记为删除/改造，不进入新增门禁。
2. 门禁改造（按成本收益排序）：
   (a) 新增机械门禁：禁止新增「读同仓源码再 toContain」的测试（oxlint 自定义规则或 script 检查 readFileSync 加源文件后缀），把 docs/testing.md:154 从文档变成 CI。成本约一天，是最高杠杆。
   (b) 修正 exerciser：报告里明确标注 coverage 模式只验证注册；修 /file/content 的过期断言；把 effect 中稳定绿的场景升为硬门禁，其余留在 advisory 并登记 unlock。
   (c) 保留 openapi 逐字快照与显式 UPDATE 机制；保留 E4 非 PR 触发与双 variant。
   (d) 环境依赖 live 测试按能力标签隔离（codex app-server、real typecheck、PTY 等），先消灭本地假红再谈删。
3. TDD 分级：T0 强制红先行（可把 :170-176 判别式的两条输出纳入 PR 模板）；T1 复现优先；T2/T3 证据优先。不追求每个 PR 全 TDD，也不接受取消一切测试先行。
4. 删除顺序与安全网：先做第 7 节约 270 行（一周内），每删一项前贴出覆盖替身证据；删除 PR 只动测试，不同批改生产。
5. 每季度一次测试成本收益复审：统计最近 90 天不可让步清单里的测试是否真的拦下过缺陷（看红证据 commit）；零拦截且后果低的降级，有拦截的加预算。

## 10. 已核实 / 未核实

已核实（我读过文件或跑过命令）：

- 964 个测试文件、227,247 行、79 个 Playwright spec、16,859 行（git ls-files 加 wc，与 Lead 更正后的数字一致）。
- test.yml:70-78、:85-92、:171、:179、:270；technical-debt.md 第 87、88、306、319、321、333、335、337、339、343 行；review 文档第 94、99-105、111、115、119-125 行；各提交的 stat 与正文。
- exerciser coverage 不执行场景（index.ts:3862-3866）、/file/content 过期断言（:1419-1423）、handler typed 404（handlers/file.ts:103-107）、77051c464 未更新 exerciser。
- assistant-nav-tree.test.tsx 131 行 / 45 处 toContain / 9 个源文件；assistant-session-panel.test.tsx 105 行。
- .github/workflows 与 script/ 无 TDD 或先红机械检查；docs/plan 下五个 tdd 文档合计 3,375 行。
- i18n parity 23 行；browser-boundary 124 行；presentation-tagging 118 行；coverage-manifest.json 共 169 行。
- 已核实的文档与实现漂移：docs/testing.md:69 称 playwright.config.ts 定义五个 project（含 chromium-zht），但 packages/app/playwright.config.ts:76/80/88/96 只有四个（chromium、chromium-dark、chromium-zh、chromium-narrow），test.yml:260 也只列四个。这是文档约束缺少机械校验的直接后果，也支持我在 §9.2(a) 的主张。

未核实（引用 Lead 或他人度量，或本次未跑）：

- 7,827 个用例（我用粗 grep 得 8,481，含 it( 等模式，口径不同）；19 个文件 / 179 例源码字符串断言；147 处 Object.keys；1,979 处 toContain；16.4k 行测试支撑代码；测试与源码 0.65 的源码行数口径（我按 packages/\*/src/\*\* 得 412,399 行，与 347,054 的差异未查）。
- core 全量 150.26s / 2 fail 是 Lead 2026-10-19 实测，我未复跑（遵守不加重负载要求）。
- 24.9 分钟 E2E、13.4 分钟与 7.0 分钟 E4 墙钟均引文档或 CI 注释，非本次实测。
- /file/content 过期断言是否真的在 --mode effect 下失败，我未运行 exerciser，只核对了代码与门禁配置。
- 「冷态首轮编译 293 秒」的出处已核实为 docs/review/global-shell-remaining-closure.md:98（冷启动预热 / 单独耗时 293 秒，此后每路由 7-11 秒）；technical-debt.md:339 记录的是同一机制的另一现象（120 秒无响应、热态复跑 28.6s）。
