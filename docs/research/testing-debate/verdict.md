# Lead 裁决：测试不是太多，是「错位 + 只增不删 + 门禁太贵」

> 辩论双方：[开发顾问立场](dev-position.md) / [开发顾问反驳](dev-rebuttal.md) · [测试顾问立场](test-position.md) / [测试顾问反驳](test-rebuttal.md)
> 基线：main @ 75ee27fbd，2026-10-19。Lead 对本文件中的数字做了独立复核；与两位顾问口径不一致处已标出。

## 0. 裁决摘要

1. **「测试代码太多」只部分成立。** 总量 964 个测试文件 / 227,247 行 / 约 7.8k 用例，测试/非测试源码 ≈ 0.655；这在大型 Effect 仓里不是异常值。真正过量的是**低判别力测试、生成物和只增不删的维护惯性**，不是行为覆盖本身。
2. **「对开发进程有反作用」成立，但杠杆不是删总量。** 反作用来自门禁成本结构：PR 上双 OS 跑全量 unit（test.yml:75：Linux 40min / Windows 90min）、四个 e2e project（test.yml:260，90/50min）、exerciser 30min；本地 aigcfroge 全量运行 14.8 分钟只完成 1,361 个用例（约 46%，含 2 个 subprocess 失败），按比例外推约 30 分钟；CI 注释记录 Linux 20min。删掉 1,300 行源码字符串断言对 CI 墙钟几乎无影响；**重排门禁层级才是降本手段**。
3. **「只写必要测试、不做全套 TDD」方向成立，但必须操作化。** 「必要」用四问判据 + 判别力检查，不是凭感觉；TDD 按层分级：T0 纯逻辑强制红先行，T1 复现优先，T2/T3 不做特性 TDD。保留「缺陷复现优先」。
4. **两位顾问在 Round 2 已收敛为同一方案**：先修假绿/假门禁与文档漂移，再按 tier 重排 PR 门禁，再逐文件处置 18 文件 / 1,299 行 / 144 例（净减约 300–800 行；开发顾问估 600–800，测试顾问估 300–500），保留 8 类不可让步测试。
5. **本轮辩论的直接产出**：约 1,300 行可处置存量、1 条机械门禁（禁止新增源码字符串断言）、1 套 TDD 分层文案、1 个 PR e2e 冒烟子集、1 个必须先修的假绿缺陷。

---

## 1. 事实基线（Lead 复核）

### 1.1 体量（[实测]）

| 维度                                                            |      数值 |
| --------------------------------------------------------------- | --------: |
| 测试文件（.test.ts(x) + .spec.ts(x)，含 79 个 Playwright spec） |       964 |
| 测试代码行                                                      |   227,247 |
| 用例声明（anchored grep）                                       |   约 7.8k |
| 非测试源码行（packages/\*/src，排除测试）                       |   346,962 |
| test : src                                                      |     0.655 |
| 测试支撑代码（fixture/helper/test LLM server）                  | 约 17k 行 |

分布极不均匀：aigcfroge 287 文件/94,268 行、core 294/77,935（core 测试行 > core 源码 71,921）、app 245/34,466 + e2e 79 spec/16,859。三包占 91.1% 测试行。server、plugin、ui、session-ui、tui 等包测试极少或为零——**「测试太多」不是全局判断，是分布判断**。

### 1.2 成本（[实测] + [文档]）

- 本地 core 全量：2,513 tests / 294 文件 / **150.26s**，2 个环境依赖失败（本机未装 codex app-server、real typecheck 子进程）。
- 本地 aigcfroge 全量：运行 14.8 分钟时完成 1,361 个用例（约 46%），2 个 CLI subprocess 用例失败（aigcfroge mcp add 系列）；按比例外推约 30 分钟。CI 注释记录 Linux aigcfroge 20min、Windows 曾超时（test.yml:70-78）。
- 完整 Chromium e2e：179/188 passed、**24.9min**（docs/technical-debt.md:306）；冷态 dev server 首轮预热 293s（docs/review/global-shell-remaining-closure.md:98）。
- E4 真实后端：13.4m（默认）+ 7.0m（V2 variant），**不进 PR 门禁**（test.yml:94-104、:159-179）。
- 单文件回路实测 0.19-0.57s；单包 typecheck 1.04s（schema）。**内环不慢，慢的是门禁层。**

### 1.3 churn（Lead 复核，修正顾问口径）

开发顾问报告「最近 200 提交改动行中测试占 39.1%、测试删除率 14.7% vs 源码 187%」。Lead 复算：

| 口径                                          |                最近 200 提交 |                       全历史 |
| --------------------------------------------- | ---------------------------: | ---------------------------: |
| 纯 .test/.spec 文件改动行占比                 |   **5.7%**（5,540 / 97,506） |                            — |
| test/ 目录下支撑代码（fixture/helper）        |                5.7%（5,555） |                            — |
| openapi.snapshot.json（生成物，不是测试代码） |          **32.8%**（31,964） |                            — |
| 提交触碰测试文件的比例                        | 46.5%（571 / 1,229，全历史） |                         同左 |
| 测试行删除 / 新增                             |                            — | **4.9%**（11,774 / 239,021） |
| 源码行删除 / 新增                             |                            — |    11.9%（46,741 / 394,106） |

**结论修正**：「测试改动占 39%」不成立——其中约 31,964 行来自单个生成物 packages/aigcfroge/test/server/openapi.snapshot.json。真实测试相关 churn ≈ 11.4%。但「测试只增不删」成立（4.9% vs 源码 11.9%），且 46.5% 的提交要碰测试文件——维护税真实，只是量级没有 39% 那么骇人。

### 1.4 低价值/负价值测试（[实测]，双方已对齐）

- **源码字符串断言集群**：Lead 扫描 21 文件 / 1,980 行 / 188 例；开发顾问逐文件复核为 22 文件 / 1,980 行 / 188 例（含 theme-preload、html-artifact），并精确到**可处置 18 文件 / 1,299 行 / 144 例**；保留 3 文件 / 364 行（browser-boundary 真 import 图、workflow-runtime-model 生成物漂移哨兵、html-artifact 安全契约）。
  - 例：assistant-nav-tree.test.tsx:8,21-93（读源码 + toContain）；assistant-session-panel.test.tsx:9,14-64（整文件文本断言）；permission-override.test.ts:29-46（负断言：代码搬走就假绿）。
  - 根因不是作者偷懒：.tsx 在 bun test 中不可 import（docs/technical-debt.md:169），而 DOM harness 现已落地（packages/app/solid-jsx-plugin.ts:20-35、happydom.ts:8），这笔债可以还。
- **类型形状的运行时断言**：core/test/public-tool.test.ts:11（断言测试自己构造的字面量 keys）、public-aigcfroge.test.ts:13-15、tui/test/index.test.tsx:4-6；应由 typecheck 承担。
- **环境耦合假红**：core/test/delegation-codex-app-server.test.ts live 用例、verifier real typecheck 用例——本机 core 全量 2 fail 均源于此。应打 integration 标签移出默认门禁。
- **死 skip**：25 处 .skip/.todo。
- **假绿/过期契约**：exerciser coverage 模式**不执行场景**（packages/aigcfroge/test/server/httpapi-exercise/index.ts:3862-3866 自述 "pass/fail shape here was a lie"），/file/content 缺失场景仍断言 200 空文本（:1419-1423），而 handler 已是 typed 404（packages/aigcfroge/src/server/routes/instance/httpapi/handlers/file.ts:103-107）；effect 模式在 CI 是 advisory（test.yml:85-92）。**必须先修，再谈删测试。**
- **流程文档腐化**：docs/testing.md:69 称五个 project（含 chromium-zht），实际 packages/app/playwright.config.ts:76/80/88/96 只有四个，test.yml:260 也只列四个；debt:169 的 15 文件清单已漂移。
- **反向让步**：本仓 jest.fn/vi.fn = 0，toHaveBeenCalled\* 仅 25 处——「过度 mock」不成立，不作为论据。

### 1.5 TDD 的真实状态（[实测]）

- 全仓唯一强制出处是 docs/testing.md:11「TDD 强制循环」；CI、script、husky 对「先红后绿」**零机械验证**（双方独立核实）。根 AGENTS.md:200-207 的 Testing 段没有 TDD 字样。
- docs/plan/_tdd_.md 5 份合计 3,375 行；25-27 份 plan/review 文档提及 RED/GREEN；最新 816 行计划头部自述 S00-S09 未执行。
- 结论：**TDD 在本仓是文化约束/流程口令，不是可执行门禁。** 它制造的主要成本不是 CI 时间，而是「每个切片都要产 RED/GREEN 证据」的流程与文档开销，以及为闭合循环而写的低判别力测试。

---

## 2. 两角色立场与交锋

### Round 1

- **开发顾问**：体量不是杠杆；成本在门禁层；churn 与「只增不删」是维护税；约 1,300 行源码文本断言、类型形状断言、环境耦合、死 skip 是负资产；TDD 只应保留在 core 纯逻辑；主张 PR <15min、Windows/完整 e2e/E4 移 main/夜间。
- **测试顾问**：成本真实，但 10 个实例证明测试拦住了真缺陷（P0-B 白屏仅 e2e 可见、跨服务器串台、OpenAPI identifier 缺失→SDK undefined、provider 事件序、配额重试、权限结果坍缩、kill-switch 卡死、迁移启动失败、V1/V2 parity 等）；「只写必要测试」不可操作（必要性多为事后可知）；TDD 是设计工具不是覆盖率工具；最低不可删 8 类。

### Round 2（收敛结果）

| 议题     | 收敛结论                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 删除规模 | 顾问「270 行可删」与开发「1,299 行可重写」是**互补口径**，不是冲突：立即删 185 行 + 条件删 80 行 + 转换约 1,100 行，净减约 300–800 行（开发顾问估 600–800，测试顾问估 300–500）；144 例假判别断言 → 约 50-60 条行为断言 |
| PR e2e   | **PR 保留 critical 子集**（开发顾问 12 spec / 测试顾问 6 spec，取 6-8 起步，预算 ≤8-15min），main/nightly 跑四 project 全量与 E4；2 周漏检监测，漏检 spec 永久进 critical                                               |
| TDD      | T0 强制红先行；T1 稳定复现时先红；T2/T3 不做特性 TDD；缺陷复现优先。强制手段从「时间顺序」改为可机械检查的「判别式」                                                                                                    |
| 假门禁   | 一致判定「修不删」，且必须先修：/file/content 改 typed 404、coverage 标注 registration-only、effect 稳定绿升硬门禁                                                                                                      |
| 流程文档 | 一致同意归档 4 份 TDD 手册、保留 ≤150 行规范、清洗文档漂移                                                                                                                                                              |

仍存分歧（Lead 已裁决）：

1. PR e2e 子集大小 → **取 6-8 个 spec 起步**，首跑实测后调；漏检由 main 全量 + 棘轮补偿。
2. 先删后转 vs 一次性重写 → **先删整文件（有替身证据）+ 其余逐文件转换**，不做批量 churn。
3. UI/e2e 是否「禁止 TDD」→ **禁止特性 TDD，保留缺陷复现优先**。

---

## 3. Lead 裁决

### 3.1 「必要测试」的操作化判据（写进 docs/testing.md）

一条测试要保留/新增，必须能回答：

1. **防什么失败**：引用缺陷/契约/ADR/事故；答不出 → 低价值。
2. **哪层能看见**：为什么其他层看不见；若 typecheck/lint 能覆盖，则不写运行时断言。
3. **失败可诊断**：断言 diff 直接给出输入与可观察输出；禁止「源码里找不到字符串」。
4. **判别力可证**：注入破坏必须变红、纯重构必须保持绿；禁止只能由改测试自身满足的 RED（沿用 docs/testing.md:170-176）。
5. **成本与所有者**：单测文件 <1s、单包全量 <120s、e2e 单 spec <60s；无主测试与死测试同罪。

一票否决：断言对象不是产品或契约行为（源码文本、类型形状、私有字段、测试自造字面量）。

### 3.2 TDD 分级（替换 docs/testing.md:11 的「强制循环」）

- **T0 可判定纯层**（schema 解码、协议 transform、错误分类、权限判定表、迁移、契约快照、i18n、路径包含）：**强制先写失败测试**；判别式可机械检查。
- **T1 Effect 服务集成**：失败可稳定复现时先红；否则先写行为基线。
- **T2 浏览器 E3**：不做特性 TDD；缺陷必须复现优先（page.clock 等确定性手段）。
- **T3 E4/benchmark/矩阵**：证据轮次 + quarantine + 明确 unlock，不做红先行。

### 3.3 测试组合与门禁

- **PR 必跑（目标 <15min）**：lint + 受影响包 typecheck + T0/T1 受影响包测试（Linux）+ openapi-drift + exerciser coverage/auth + **6-8 个 critical e2e spec**（global-shell、composer-submit、session-turn-stall、session-files-route、session-terminal-route、cross-server、markdown-sanitize、tool-denial-visible）。
- **main / nightly**：Windows unit、四 project e2e 全量、E4 双 variant、benchmark、integration live。
- **不变**：openapi 逐字快照 + 显式 UPDATE 机制；E4 非 PR 触发；coverage/auth 注册门禁。
- **新增机械门禁**：① 禁止新增「读同仓源码再 toContain」（存量白名单只减不增）；② 测试文件标 @tier unit|integration|e2e；③ 裸 skip 必须带 owner + 到期日；④ 环境依赖 live 测试带 integration 标签，默认不跑。

### 3.4 处置清单（ROI 排序）

| 优先级 | 动作                                                                                                                         |            规模 | 验收/风险                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------: | ---------------------------------- |
| P0     | 修假绿：/file/content → typed 404；coverage 报告标 registration-only；effect 稳定绿升门禁；补 workflow mutation 端点成功/409 |         约 1 天 | 先红后绿证据；有既有红需先清零     |
| P0     | 清洗流程文档：testing.md:69 project 数、debt:169 清单、归档 4 份 TDD 手册                                                    |            1 天 | 文档与 config/CI 对齐              |
| P1     | 机械门禁：禁源码断言 + tier 标签 + skip owner                                                                                |            1 天 | 白名单只减不增                     |
| P1     | 删除：assistant-nav-tree 全文件 131 行 + assistant-session-panel 结构断言约 54 行                                            |          185 行 | 先找 DOM/模型/e2e 替身并贴证据     |
| P1     | 环境耦合测试打标签移出 PR                                                                                                    |         4+ 文件 | 本机 core 2 假红消失               |
| P2     | 转换其余源码断言：18 文件 / 1,299 行 / 144 例 → 行为断言约 450-550 行                                                        | 净减 300-800 行 | 逐文件提交，单文件可回滚           |
| P2     | 类型形状断言转类型级（约 80 行）                                                                                             |        约 80 行 | typecheck 能证明                   |
| P2     | 25 处死 skip 转 coverage-manifest 或删除                                                                                     |       约 200 行 | 必须有 owner/到期日                |
| P3     | 清理 TDD 过程名：delegation-build-participant.test.ts:91、delegation-task.test.ts:165 等 describe 里的 "TDD RED" 改为行为名  |        约 10 处 | 纯命名，避免后来者误解为未完成 RED |
| P3     | PR 门禁重排 + 2 周漏检监测                                                                                                   |               — | 保留旧 workflow 可回滚             |
| P3     | 季度 ROI 复审：不可删清单逐条审计红证据                                                                                      |       每季 4 次 | 零拦截且后果低 → 降级              |

### 3.5 不可让步清单（删了就是赌）

1. DB migration / 启动路径；2. 权限/授权（含 R5-4 缺口补测）；3. provider transform / 事件序 / 错误分类；4. OpenAPI drift + SDK 契约；5. V1/V2 parity + v2-admission-gap；6. E3 主路径（白屏、串台、路由）；7. 安全（XSS、凭据扫描、路径包含）；8. 低成本契约（i18n parity 23 行、presentation-tagging 118 行）。

---

## 4. 对用户命题的逐条回应

| 用户命题                           | 裁决                         | 依据                                                                                                                                                               |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 「测试代码太多了」                 | **部分成立**                 | 总量 0.655 可辩护；但 18 文件/1,299 行低判别力断言、25 死 skip、环境耦合假红、exerciser 假绿确实过量；分布严重不均（三包占 91%，ui/session-ui/server/plugin 很少） |
| 「对开发进程有反作用」             | **成立，但主因不是总量**     | 双 OS 全量 + 4 project e2e + 20min aigcfroge + flaky/假红；删 1,300 行测试对 CI 墙钟影响很小，重排门禁才是杠杆                                                     |
| 「不需要所有 TDD 相关内容」        | **成立**                     | TDD 仅文档强制、无机械验证；UI/e2e 不适合红先行；3,375 行手册与 25+ 计划提及 RED/GREEN 是流程开销；应分级 + 归档                                                   |
| 「有必要测试的才写，没必要的不写」 | **方向成立、不能凭直觉执行** | 「必要」必须用 §3.1 五问判定；本仓历史证明「看似多余」的 e2e/契约测试拦下过 P0；正确动作是「按风险分层 + 删错类型 + 换层级」，不是「按数量砍」                     |

---

## 5. 证据边界（未核实项）

- 开发顾问的 39.1% / 14.7% / 187% 三个 churn 数字 Lead 未按同口径复现，已用 §1.3 的自测口径替换；其「22 文件 / 1,980 行 / 188 例」经 Lead 与开发顾问双向核对，可信。
- aigcfroge 本地全量为分片实测：14.8 分钟完成 1,361 用例（约 46%）后主动停止，完整墙钟为按比例外推；CI 20min 来自 test.yml:70-78 注释。
- e2e 24.9min、E4 13.4/7.0min、冷启动 293s 均为文档/CI 注释记录，非本次实测。
- PR critical 子集的首跑墙钟、changed-path 选择的漏检率需 CI 实测；转换后净减行数为外推。
- 7.8k 用例为 grep 近似；两位顾问分别得 7,842 / 8,481，口径差异不影响结论。
