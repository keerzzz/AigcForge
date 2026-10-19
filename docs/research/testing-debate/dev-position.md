# 开发顾问立场书：测试数量不是杠杆，测试组合与门禁耦合才是

> 记录说明：本文是 Round 1 立场书。其中 churn 与源码断言规模的数字已在 Round 2 与 [Lead 裁决](verdict.md) 中复核修正，最终结论以裁决为准。

> 角色：资深全栈开发顾问（交付速度 / 维护成本 / 架构演进）。任务：task-1 Round 1。
> 证据分三类并逐条标注：**[实测]** 本机命令输出、**[文档]** file:line、**[推断]** 我的判断。

## 0. 结论先行

1. **"测试代码太多"在体量维度上不成立。** 227,247 行测试 / 346,962 行 packages 源码 ≈ 0.655；最内层反馈回路实测 0.19–0.57s，单包 typecheck 1.04s **[实测]**。真正的墙钟成本在门禁层：CI unit 40/90min、e2e 90/50min、本地完整 Chromium 24.9min **[文档]**，与"测试行数"没有线性关系。
2. **但用户感受到的"反作用"是真实的**，来自三处结构性错配而非总量：(a) 最近 200 提交里 39.1% 的改动行落在测试；(b) 47.6% 的历史提交需要改测试文件，纯测试提交 156 个；(c) 测试只增不删——测试行删除率仅为新增的 14.7%，源码同期为 187% **[实测]**。
3. **有一小类测试是负资产**：源码字符串断言（约 16 文件 / 约 300 条文本匹配器 / 约 1,300 行）、类型形状运行时断言、环境耦合 live 测试（本机实测 10 pass / 1 fail）、25 处永久 skip。共同点：**没有回归判别力，却持续收租**。
4. **TDD 在本仓只是"文档强制"。** 全仓唯一强制出处在 docs/testing.md:11；CI、脚本、husky 对"先红后绿"零机械验证（已核实）。在 17 包 + Effect 分层 + AI 子代理模式下，red-first 的边际收益集中在 core 纯逻辑，边际成本集中在 UI / 集成 / e2e。
5. **我的建议不是"删测试"，而是三件事**：把文本断言换成行为断言；把反馈回路分层（L1 常跑、L2 pre-push、L3/L4 只在 PR 或夜间）；把门禁从"数量/覆盖计数"转向"判别力"。直接删除量估算仅约 1,000 行（0.4%），所以卖点必须是"让红等于回归、把 39% 的测试 diff 份额降下来"，绝不是删行数本身。

## 1. 判断：测试是否过多

### 1.1 体量与分布（**[实测]**，口径见附录 A）

| 包                            |              测试文件 |                    测试行 |  用例声明 |      源码行 |  test/src |
| ----------------------------- | --------------------: | ------------------------: | --------: | ----------: | --------: |
| aigcfroge                     |                   287 |                    94,268 |     2,986 |      90,498 |      1.04 |
| core                          |                   294 |                    77,935 |     2,397 |      71,921 |      1.08 |
| app                           | 245（含 79 e2e spec） | 34,466（其中 e2e 16,859） |     1,451 |      88,286 |      0.39 |
| tui                           |                    48 |                     4,726 |       207 |      27,764 |      0.17 |
| llm                           |                    26 |                     7,943 |       265 |       9,075 |      0.88 |
| schema                        |                    25 |                     3,558 |       251 |       5,321 |      0.67 |
| 其余 10 包（含 4 个无测试包） |                    39 |                     4,351 |       285 |      54,097 |      0.08 |
| **合计**                      |               **964** |               **227,247** | **7,842** | **346,962** | **0.655** |

读法：

- 三个包承担 206,669 / 227,247 = **91.1%** 的测试行。所谓"测试太多"其实是"core + aigcfroge + app 三包重"，不是全局现象。
- core 测试行（77,935）已经超过 core 源码（71,921）；aigcfroge 接近 1:1。域层高比例可以辩护（见 §6 让步），但它是 churn 的主要来源。
- app 非 e2e 测试约 17.6k 行；e2e 16,859 行 / 79 spec，其中 regression 62、real 9、performance 6、smoke 1、zoom 1 **[实测]**。
- **没有行覆盖率门禁**：CI 与脚本中未发现 coverageThreshold 或 --coverage（已 grep）；存在的只是 exerciser 的"路由覆盖"计数（docs/testing.md:56）。"删掉无判别力测试会掉门禁"的担心不成立。
- 结论：0.655 本身不是异常区间。用户命题若指"行数"，应改写为"行数分布在错误的测试类型上"。

### 1.2 反馈回路成本模型（**[实测]** + **[文档]**）

| 层级          | 触发       | 成本证据                                                                                                                        | 我的定位                                   |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| L0 typecheck  | 单包       | schema 1.04s（本机）；aigcfroge >180s、RSS 5.7GB、曾 >5min（technical-debt.md:304）                                             | 小包可每改必跑；大包只能 pre-push          |
| L1 单文件测试 | 改一个函数 | 0.19s（core model.test.ts）、0.57s（app uuid.test.ts）                                                                          | **唯一应该常跑的回路**                     |
| L2 单包全量   | 提交前     | core 150.26s / 2,513 tests（lead 实测）；app 1,116 例（technical-debt.md:276）；aigcfroge CI 预算 40/90min（test.yml:75）       | pre-push / PR 层                           |
| L3 CI 全量    | PR / push  | unit 40/90（test.yml:75）+ e2e 90/50（:270）+ exerciser 30（:91）+ e4 45×2（:171/:179）                                         | 不是开发内环；单次 push 机器预算可达数小时 |
| L4 本地 e2e   | UI 改动    | 完整 Chromium 179/188、24.9min（technical-debt.md:306）；冷态首轮 120s 无响应（:339）；单测超时 180s（playwright.config.ts:47） | 不能作为 TDD 回路                          |

- **更正 lead 数据**：--only-failures 不是成本证据。bun test --help 原文为 "Only display test failures, hiding passing tests"（本机核实），它只过滤输出，不跳过、不缓存；9 个包脚本使用它只影响可读性。
- 成本模型结论：**开发内环只应走 L1**。当前的反作用不是"测试多"，而是每次改动被默认要求穿过 L2/L3，而 L2/L3 的红被环境测试与 flake 污染。

### 1.3 测试 churn：维护税（**[实测]**）

- 585 / 1,229 提交（**47.6%**）触碰测试文件；纯测试提交 **156** 个（12.7%）；test 类型提交 139 个。
- 最近 200 提交：改动 97,506 行中 38,087 行是测试（**39.1%**）。
- 月度：8 月 295/531 提交（55.6%）、9 月 210/416（50.5%）碰测试；10 月 45 提交中 0 个（文档/复盘期）。
- 维护热点：database-migration.test.ts 被改 25 次、session-task-service.test.ts 24 次、httpapi-session.test.ts 23 次。
- 全历史 numstat：测试新增 203,893 / 删除 30,054（删除率 14.7%）；源码新增 160,733 / 删除 301,128（删除率 187%）。**测试资产只增不减**，这是 4 个月仓里最陡的负债斜率。
- 读法：churn 高不是"测试多"的错，是**测试与实现耦合粒度过细**的症状——改实现细节就要同步改断言。

## 2. 负价值 / 低价值测试分类

| #   | 类别                        | 规模（已核实）                           | 代表实例                                                                                                           | 为什么低价值                                                                             | 处置                                  |
| --- | --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| A   | 源码字符串断言              | 约 16 文件 / 约 300 匹配器 / 约 1,300 行 | app/src/components/assistant-nav-tree.test.tsx:21；pages/session/assistant-session-panel.test.tsx:15               | 读实现文本，不测行为；改名或抽常量即假红，删代码即假绿                                   | 用已有 JSX harness 转 DOM 断言        |
| B   | 类型形状运行时断言          | 147 处 Object.keys 中一部分              | core/test/public-tool.test.ts:11；core/test/public-aigcfroge.test.ts:13-15；tui/test/index.test.tsx:4-6            | typecheck 已覆盖；最极端的断言的是测试自己构造的字面量                                   | 删，保留类型级断言                    |
| C   | 重复层级覆盖                | 已收窄一次                               | 五 project 矩阵 1030→218（docs/testing.md:69）；40 个冗余 pin（technical-debt.md:335）                             | 同一断言在无差异维度重复展开                                                             | 已修；剩余 pin 顺带删                 |
| D   | 环境耦合 live 测试          | debt:87 列 4 文件；本地实测 1 例         | core/test/delegation-codex-app-server.test.ts:62-66                                                                | 本机 10 pass/1 fail（0.44s），spawn NotFound（cross-spawn-spawner.ts:386），红不等于回归 | 打 integration 标签，移出 PR 必跑     |
| E   | 测内部实现细节              | 与 A 重叠                                | assistant-nav-tree.test.tsx:43（断言 options 字面量）；assistant-session-panel.test.tsx:96（Tailwind 类名）        | 重构必然假红；表达的是 HOW 不是 WHAT                                                     | 并入 A 一起转换                       |
| F   | 纯转发 / 纯 getter / 导出面 | 约 20–30 行                              | core/test/global.test.ts:9-10（make().tmp toBe Path.tmp）；tui/test/index.test.tsx:4-6                             | 只测试赋值或转发；无产品行为                                                             | 删                                    |
| G   | 自证 RED / 无法判别的断言   | 规则存在但无机械检查                     | core/test/public-tool.test.ts:11（断言自己写的 {register} 字面量）；docs/testing.md:170-176 记录的 2026-08-31 实例 | 红是因为测试自身写错，不是产品缺陷                                                       | 规则升级为双向判别检查                |
| H   | 永久 skip / todo            | 25 处                                    | aigcfroge/test/v2/session-message-updater.test.ts:12,65,120；tui/test/cli/tui/diff-viewer-file-tree.test.tsx:30    | 零信号，仍占阅读与类型检查成本；掩盖"该功能没测"                                         | 删除或转 coverage-manifest 并设到期日 |

补充证据（**已核实**）：

- A 类根因不是测试作者偷懒：docs/technical-debt.md:169 明确记录"app 还有 15 个测试文件靠读组件源码断言（上限约 295 条）"，根因是 .tsx 在 bun test 里 import 即抛 Client-only API，拿不到 DOM 就退化成读源码。harness 已落地（packages/app/solid-jsx-plugin.ts:20-35、happydom.ts:8），text-diff-view 已转成真实 DOM 断言（text-diff-view.test.tsx:55-58）。**这 1,300 行的租现在可以一次性还清，不再有依赖风险。**
- permission-override.test.ts:29-46 是 A 类最坏形态：not.toContain 负断言——源码删掉或搬走就变绿，重构换写法就变红，方向刚好相反。
- B 类最典型的 public-tool.test.ts:11 断言的是测试自己写的对象字面量的 key；即使把 Tool.Interface 改坏也可能绿。
- D 类本机复核：delegation-codex-app-server.test.ts 的 skip 条件（:62-66）只在命令解析到 node_modules/.bin 时跳过，解析到系统路径但不可执行时仍会跑，于是本机出现 spawn NotFound 假红；lead 的 core 全量 2 fail 同源。
- **反向让步**：所谓"过度 mock 导致测 mock"在本仓不成立——jest.fn/vi.fn 实测 0 处，toHaveBeenCalled\* 仅 25 处，Layer.mock 105 处基本是 packages/aigcfroge/test/AGENTS.md 要求的局部 stub。我不拿这条做论据，避免把"类型错"甩给虚构的问题。
- 测试支撑代码 17,056 行（packages/\*/test 非测试文件 11,436 + app/e2e 支撑 5,620）——是资产不是负债，但应冻结增量。

## 3. TDD 强制循环的真实影响

### 3.1 文档强制 vs 机械强制（**[实测]**）

- 强制出处只有一处：docs/testing.md:11 "TDD 强制循环"。根 AGENTS.md 的 Testing 段没有 TDD 字样；CI（ci.yml:27-41 为 lint → typecheck → openapi drift → turbo test）、script/、.husky/ 对"先红后绿"零验证。
- 配套执行手册 docs/plan/_tdd_.md 共 5 个文件 3,375 行（最大 agent-interaction-ui-tdd-implementation.md 816 行），而最新那份在头部自述"S00–S09 均未执行"（已核实）。13 个提交信息提到 TDD。
- 判别式（docs/testing.md:172 "临时改对→跑→还原"）是人工步骤，事后无法从提交历史验证。**结论：在本仓 TDD 是文化约束，不是门禁。**

### 3.2 边际收益 / 边际成本（**[推断]**，依据上述实测）

| 层                                     | red-first 边际收益                          | red-first 边际成本                     | 建议                          |
| -------------------------------------- | ------------------------------------------- | -------------------------------------- | ----------------------------- |
| core 纯逻辑 / schema decode / 权限判定 | 高：0.2s 回路、确定性、能驱动接口设计       | 低                                     | **强制 TDD**                  |
| Effect service 组合                    | 中：能暴露 Layer 依赖缺口                   | 中：TestClock/Layer 装配成本高         | 行为测试先行，允许后补        |
| HTTP handler / 契约                    | 中：契约可先写                              | 中：exerciser/OpenAPI 门禁已覆盖大部分 | 交给契约门禁                  |
| UI 组件                                | 低：DOM 断言要 harness 才写得动（debt:169） | 高：假红/文本断言诱惑                  | **不做 TDD**，做行为断言      |
| e2e / 真实后端                         | 极低：L4 24.9min、冷启动 120s               | 极高                                   | **禁止 TDD**，只做冒烟/主路径 |

### 3.3 TDD 与"测试后置"的失败模式不同（**[推断]** + 仓内证据）

- TDD 失败模式：测试被写成"实现文本的镜像"（A 类的来源就是"先写测试但拿不到 DOM"）、过拟合内部结构、假 RED、churn 高。
- 后置失败模式：确认偏差（照着已实现行为补测试）、边界缺失、覆盖面看起来大但判别力弱。
- 本仓的实际证据偏向**前者**：1,982 处 toContain、约 300 条源码文本匹配器、25 处 skip、测试/源码 diff 39%。所以缺的不是"更严格的 TDD 流程"，而是**行为可观测性（harness）与审查判据**。

### 3.4 AI 子代理模式下的特殊风险（**[推断]**）

子代理产出代码的速度远快于验证速度，强制 red-first 会诱导"为了让循环闭合而制造 RED"。docs/testing.md:170-176 记录的 2026-08-31 实例正是这种形状（union 探针永远因缺 id 字段红，"今天红对了，明天红错了"）。可机械化的不是"时间顺序"，而是**判别力**（临时改坏生产代码必须变红）。

## 4. "必要测试"的操作化定义与处置清单

### 4.1 判定标准（可判定、可审查、可执行）

1. **行为判别力**：回滚修复或注入 bug 必须变红；纯重构（改名、抽函数、换内部表示）必须保持绿。PR 描述贴一次"破坏→红→还原→绿"输出。
2. **失败可诊断**：断言 diff 直接指出输入与可观察输出；禁止 "expected substring"，禁止"文件里找不到字符串"。
3. **层级归属**：能 L1 覆盖的不写 L3；能由 typecheck/lint 覆盖的不写运行时断言。
4. **成本预算**：单测文件 <1s、单包全量 <120s、e2e 单 spec <60s；除显式 integration 档外不得依赖外部二进制或网络。
5. **所有者**：每条测试对应一个风险或不变量；无主测试与死测试同罪。

- **一票否决**：断言对象不是产品行为（源码文本、类型形状、私有字段、自身构造的字面量）。

### 4.2 处置清单（按 ROI 排序，行数为估算 **[推断]**）

| 优先级 | 动作                       | 对象                                                                                                                                                                                                                                                       |                      估行数 | 收益                       | 风险 / 前提                                                   |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------: | -------------------------- | ------------------------------------------------------------- |
| P0     | 一次性转换源码文本断言     | 16 文件（assistant-nav-tree 45、assistant-kb-tab 35、assistant-entity-lists 29、assistant-session-panel 27、file-tab-strip 24、work-secondary-sidebar 22、session-file-tree 21、permission-override 19、assistant-citation 16、session-right-panel 14 等） | 约 1,300 行重写，净减约 500 | 恢复判别力；重构不再假红   | harness 已就绪（solid-jsx-plugin.ts），逐文件做、不批量 churn |
| P0     | 清理死测试                 | 25 处 skip/todo                                                                                                                                                                                                                                            |                      约 200 | 去掉"看起来有覆盖"的假象   | 转 coverage-manifest 并设到期日                               |
| P1     | 类型形状运行时断言转类型级 | public-tool 13 行、public-aigcfroge:13-15、tui/index 6 行、location-mutation:175、tool-write:281 等约 6 处                                                                                                                                                 |                       约 80 | 无损失（typecheck 已覆盖） | 无                                                            |
| P1     | 删除冗余 pin               | 40 个 e2e spec 的 beforeEach/import                                                                                                                                                                                                                        |                      约 120 | e2e 阅读成本下降           | 先按 debt:335 的放行条件确认无单跑依赖                        |
| P2     | 环境耦合测试隔离           | debt:87 四文件 + codex app-server live 例                                                                                                                                                                                                                  |                    不改行数 | 本地红等于回归             | 保留 integration job 与夜间跑                                 |
| P2     | 自建 linter 化             | browser-boundary.test.ts（124 行，debt:169 明示保留）；presentation-tagging.spec.ts（118 行）                                                                                                                                                              |                           0 | 提到 lint 更快             | 需验证 oxlint 能力，暂不删                                    |
| P3     | 冻结增量                   | 测试支撑代码 17,056 行；e2e spec 数 79                                                                                                                                                                                                                     |                           0 | 防止继续膨胀               | 配额制                                                        |

### 4.3 门禁与 CI 改造（建议 lead 拍板）

- **PR 必跑（目标 <15min）**：lint + 受影响包 typecheck + tier1 单测（仅 linux）+ openapi-drift + exerciser coverage/auth。
- **pre-push / 合并队列**：受影响包全量（core 150s 级别可接受）。
- **main / 夜间**：windows unit（现在每个 PR 都跑，预算 90min）、完整 e2e 矩阵、e4 双 variant、benchmark、integration live。
- **新增机械规则**：① 测试文件头声明 @tier unit|integration|e2e；② 禁止 test 内 readFileSync 读同仓 .ts/.tsx/.md 后做文本断言（存量白名单 16 文件，只减不增）；③ 禁止裸 test.skip（必须带 owner 与到期日）；④ 测试:源码 diff 比 >1.5 时 PR 打 test-heavy 标签并要求说明。
- **TDD 落地**：把 docs/testing.md:11 改为三级——core 纯逻辑"强制先红后绿"；service/handler"行为测试必须存在（可后置）"；UI/e2e"不做 TDD"。删除无法验证的"强制循环"字样，保留可验证的"判别式"。

## 5. 预判测试顾问的反驳与我的先回应

1. **"漏测成本远高于测试维护成本"**——接受这条经济学。我的方案不减少行为覆盖：文本断言换成 DOM/契约断言会提高真实覆盖，只删零判别力断言。论据：现在 24.9 分钟全量 Chromium 也只有 179/188（technical-debt.md:306），昂贵层本身没绿，说明钱没花在买绿上。
2. **"测试有期权价值，删了以后就没了"**——部分接受，但要求算净期权：期权价值 = 该测试能抓到的缺陷类别概率 × 损失 − 维护租金。源码文本断言的概率约等于 0（它抓的是文本改动，不是行为缺陷），租金为正；且删除在 git 里可逆，保留的租金不可逆。
3. **"类型/契约保护不能删"**——完全接受，并明确边界：openapi-drift、exerciser coverage/auth、schema decode 一个不动；只删 typecheck 已能证明的形状断言。
4. **"TDD 是设计工具，不是覆盖率工具"**——接受，这正是我要求按层分级的理由：core 域逻辑继续强制；UI/e2e 的 24.9min 回路不具备 red-green 节奏。
5. **"删测试会掉覆盖率/质量门禁"**——本仓无行覆盖率门禁（已 grep 核实），不存在这个约束；exerciser 的路由覆盖计数不因删除这些文件而下降。
6. **"团队能接受当前 CI 成本"**——用数字回答：unit 40/90 + e2e 90/50 + exerciser 30 + e4 90 的预算、本地 e2e 24.9min、cold start 120s；且 39.1% 的近期改动行是测试，review 带宽被结构性占用。

## 6. 我的让步与不确定边界

**我明确让步的**：

- core 域层"测试行 ≥ 源码行"可辩护，我不主张对 core 做总量削减。
- 真实后端/E4/契约门禁不是太多，而是**不足**（technical-debt.md:306 的失败与证据缺口都在昂贵层）；预算应从"文本断言"再分配到"少数真实链路"。
- browser-boundary 这类真 import 图扫描（debt:169 明示保留）与 exerciser 门禁不在删除清单内。
- 我用于反驳 lead 的成本结论（--only-failures）已被证伪，本文已撤回。

**未核实 / 属推断**：

- aigcfroge 与 app 的本地全量墙钟未实测（按任务约束未全量跑）；只引用 CI 预算与文档记录。
- 各包"用例声明数"是 grep 近似（7,842），与 lead 口径 7,827 差 15，不影响结论。
- "转换 16 文件可净减约 500 行"是基于 text-diff-view 个案外推，属估算。
- "测试 diff 份额会因此显著下降"未做 A/B，属推断；建议先在一个包试点并复测 39.1% 这个指标。

## 附录 A：已核实证据（命令 / file:line）

| 结论                                                | 证据                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 964 文件 / 227,247 行 / 7,842 用例 / 346,962 源码行 | find 计数 wc -l、grep 声明点、逐包 src 行求和（本机执行）                                                  |
| 0.19s / 0.57s / 1.04s / core 150.26s                | bun test 单文件计时（core model、app uuid）、schema tsgo、lead 实测 core 全量                              |
| 47.6% 提交碰测试 / 39.1% 近期改动行 / 6.8:1 增删比  | git log --numstat、git log --name-only 聚合（本机执行）                                                    |
| 环境假红                                            | delegation-codex-app-server.test.ts 10 pass/1 fail、cross-spawn-spawner.ts:386；technical-debt.md:87       |
| 源码文本断言                                        | technical-debt.md:169（根因 + 15 文件清单）、docs/testing.md:154、app/src 20 文件 readFileSync 实测        |
| 无覆盖率门禁                                        | grep coverageThreshold/--coverage 无结果；仅有 docs/testing.md:56 路由覆盖                                 |
| TDD 仅文档强制                                      | docs/testing.md:11；AGENTS.md 无 TDD；.github/script/.husky 无 red-green 检查；docs/plan/_tdd_.md 3,375 行 |

## 附录 B：未核实清单

1. aigcfroge / app 本地全量测试墙钟（未跑）。
2. app 单测全量时长（docs 记录 1,116 例但无当前耗时）。
3. 删除或转换后的 churn 变化（需试点 A/B）。
4. technical-debt.md:169 的文件清单有漂移（当前树存在 work-artifact-panel / directory-picker / delegation-panel，未找到 permission-tier-selector），精确到文件的处置应以当下树为准。
