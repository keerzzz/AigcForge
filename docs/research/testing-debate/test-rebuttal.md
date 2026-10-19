# 测试顾问交叉反驳：把「必要」变成可检验，把「强制」变成可执行

> 前置：已读 docs/research/testing-debate/dev-position.md（173 行）与 test-position.md（167 行）。
> 本轮按 Lead 指定的 A-E 五个分歧正面回应；标注 [接受]/[部分接受]/[反对]；证据区分已核实/未核实。

## 0. 结论先行

1. A（删除规模）：最终数字是「立即删除 185 行 + 条件删除 80 行 + 转换不超过 1,900 行、净减 300–500 行」。我不接受把 1,300 行理解成可净删的存量——直接删会制造无替身的覆盖空洞；也不坚持自己 Round 1 的 270 行——那低估了 21 文件 / 1,933 行的存量（我复核 readFileSync 命中；Lead 口径 21 文件 / 1,980 行 / 188 例）。dev 的「重写 + 净减约 500」与我收敛到同一净减区间，分歧只在路径是「重写」还是「先删后转」。
2. B（门禁分层）：接受 PR 目标 <15 分钟与把完整 e2e 矩阵、Windows unit、E4、benchmark 移到 main/夜间；条件是在 PR 保留 6 个 E3 冒烟 spec（目标 ≤8 分钟，含一次预热），并用四条机制补偿判别力（§2）。
3. C（环境耦合与 exerciser）：三分类处理——必须修（stale 断言、报告措辞、effect 稳定场景升门禁）、必须打标签（codex app-server / real typecheck / PTY 等 integration）、保留不动的契约门禁（coverage/auth 路由注册）。顺序是先修、再标、最后谈门禁语义。
4. D（TDD）：我明确接受「core 纯逻辑强制红先行、UI/e2e 不做特性 TDD」，但保留「缺陷复现优先」这一条；testing.md:11 的最终文案见 §4。
5. E（TDD 文档）：3,375 行 TDD 手册与提及 RED/GREEN 的 plan 文档是流程成本，不是运行成本；建议保留 1 份 ≤150 行模板、归档其余、冻结新增执行手册，不纳入「删测试」清单。
6. 剩余分歧收敛为 3 个拍板项（§7）：D1 PR 冒烟子集、D2 先删后转、D3 testing.md:11 改写加判别式机械检查。若只批一项，批 D1 加机械门禁。

## 1. A：删除规模与最终数字

事实对齐（不同口径分开列，不混算）：

| 口径          | 文件                | 行 / 案例                   | 来源                                                                      |
| ------------- | ------------------- | --------------------------- | ------------------------------------------------------------------------- |
| Lead 扫描     | 21                  | 1,980 行 / 188 例           | Lead 补充事实（含 session-ui 与 app 其他源码断言文件）                    |
| 我的复核      | 21                  | 1,933 行                    | 我按 readFileSync 命中 app/src 与 session-ui/src 的测试文件统计（已核实） |
| 开发顾问 A 类 | 约 16               | 约 300 匹配器 / 约 1,300 行 | dev:10、dev:62、dev:118                                                   |
| debt:169 上限 | 15                  | 295 条                      | 开发顾问引 technical-debt.md:169                                          |
| 我 Round 1    | 2 个整文件 + 40 pin | 约 270 行                   | test-position §7                                                          |

我的最终处置（三件事分开算，不把「文件总行数」当「可删行数」）：

| 类别     | 对象                                                                                                                          | 行数         | 判据                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| 立即删除 | assistant-nav-tree.test.tsx 全文件（131 行，45 处 toContain 跨 9 源文件）；assistant-session-panel.test.tsx:13-66（约 54 行） | 185          | 行为已由 model 测试、open 行为测试与 e2e 覆盖（后者文件注释 :72-75 自认 source check 看不到 mount） |
| 条件删除 | 40 处 pinEnglishUI / pinDesktopViewport（technical-debt.md:335）                                                              | 约 80        | 先以 --project=chromium-zh 单跑验证无单跑依赖                                                       |
| 转换     | 其余约 1,700 行，按「可删 / 转类型级 / 转 DOM 行为 / 保留」四分类逐文件处理                                                   | ≤1,900       | 只转能证明判别力的；转后净减 300–500                                                                |
| 合计     |                                                                                                                               | 净减 300–500 | 与 dev 的净 -500 收敛，但路径不同                                                                   |

为什么其余 1,000 多行不能直接删（三条理由）：

1. 删除的判据是「有没有行为替身」，不是「是不是文本断言」。有些文件同时测 wiring 不变量（i18n key、tab store、slot model、token 类名），e2e 只覆盖其中一部分；删掉没有替身的那部分是净损失。
2. 开发顾问自己给出了正确前提：A 类根因是 harness 缺失（dev:72 引 technical-debt.md:169），harness 已落地。既然可以转换，就不该用「删除」替代「转换」；删除只适用于「低成本可替代」的整文件。
3. 「净删 1,300 行」需要把断言删掉而不是替换，churn 会变成一次性大 diff，违背逐文件证据与可回滚；而「净减 500」与我的 300–500 是同一目标区间，只是路径是先删后转。

为什么 270 行不够：我 Round 1 只统计了两个整文件与 pin，实际存量是 21 文件 / 1,933 行；不处置其余文件，churn 与假红依旧（dev:49-56、technical-debt.md:169）。所以我把总数上调，但不接受「净删 1,300」。
验收：每个删除或转换的 PR 必须贴「注入破坏 → 红 → 还原 → 绿」两次输出（dev:107 与 testing.md:170-176 同向），否则不合并。

## 2. B：门禁分层的可执行折中

PR 阻断（目标 <15 分钟，linux only）：

| 项               | 内容                                                                                                | 预算                |
| ---------------- | --------------------------------------------------------------------------------------------------- | ------------------- |
| lint + typecheck | lint-changed + 受影响包 tsgo                                                                        | 现有                |
| T0/T1 单测       | 受影响包 tier1（纯逻辑 + Effect 集成）                                                              | 8 分钟内            |
| 契约门禁         | openapi-drift + exerciser coverage/auth + e2e/unit（manifest、presentation-tagging 等无浏览器契约） | 现有                |
| E3 冒烟子集      | 6 个 spec（见下表）                                                                                 | ≤8 分钟，含一次预热 |

PR 冒烟 6 spec 的选择（每一条都对应已发生的失败类别）：

| spec                                            | 它接住的失败                       | 证据                                                   |
| ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| e2e/regression/global-shell.spec.ts             | 全局壳/路由面白屏类回归            | review:99-105（P0-B 只有 e2e 看见）                    |
| e2e/regression/composer-submit.spec.ts          | 用户输入到 prompt_async 的主链断链 | technical-debt.md:315（Composer 只闭环受控提交前半段） |
| e2e/regression/session-turn-stall.spec.ts       | 静默 turn 卡死无出口               | ef2e6336f（test-only baseline 复现报告现象）           |
| e2e/regression/session-files-route.spec.ts      | /file/content 缺失文件 404 契约    | 77051c464、technical-debt.md:343                       |
| e2e/regression/session-terminal-route.spec.ts   | PTY 创建/连接/输入/resize/删除主链 | technical-debt.md:317                                  |
| e2e/regression/chat-assets-cross-server.spec.ts | 跨服务器资产身份串台               | technical-debt.md:337                                  |

预算说明：technical-debt.md:306 的 188 个 Chromium 场景共 24.9 分钟，折算 6 个 spec 约 3–8 分钟；冷启动另有 docs/review/global-shell-remaining-closure.md:98 记录的 293 秒预热，所以 PR 里必须先预热一次再跑。首轮实测若超 8 分钟，按序降级到 4 个（global-shell、composer-submit、session-files-route、session-terminal-route）。

移到 main / 夜间（接受 dev:127-129 的迁移）：完整 79 spec（62 regression + 9 real + 6 performance + 1 smoke + 1 zoom）、dark/zh/narrow 矩阵、Windows unit、E4 双 variant、benchmark、integration live。

丢失判别力的四条补偿：

1. main 与发布门禁阻断：夜间红不允许进入发布分支，且 E4 仍保留双 variant（test.yml:171/:179）。
2. 逃逸棘轮：任何一个在 PR 漏掉、在夜间抓到的 P0 回归，其 spec 必须加入 PR 冒烟子集，只增不减。
3. 无浏览器契约留在 PR：presentation-tagging.spec.ts（118 行）、manifest.spec.ts 与 e2e/unit 保证「没有静默停跑」，这正是 P0-B 时代缺失的那类守护。
4. 可选的第二阶段：变更路径到 spec 目录的映射（改 packages/app/src/pages/session 时跑对应 session spec），在 smoke 子集稳定后加。

与 dev 的差异：dev:127-129 主张完整 e2e 移出 PR；我接受迁移，但要求 6 个 smoke 留在 PR，因为「只有 e2e 看得见」的失败（review:103）延迟到夜间等于把 P0 出厂风险从 PR 移到发布前。

## 3. C：环境耦合与 exerciser 的先后顺序

| 类别   | 对象                                                                                                                                | 动作                                                                                                         | 顺序               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| 必须修 | exerciser 的 /file/content 缺失断言仍断言 200 空文本（index.ts:1419-1423），与 handler 的 typed 404（handlers/file.ts:103-107）相反 | 改为 404 断言；这属于「测试与实现相反」，任何删测试动作前必须先修                                            | Step 1（1–2 天）   |
| 必须修 | coverage 模式从不执行场景（index.ts:3862-3866 已有注释，但报告未标）；effect 模式是 advisory（test.yml:85-92）                      | 报告明示「仅注册覆盖」；清点 effect 红账，把稳定绿场景升为硬门禁，其余在 coverage-manifest 登记 owner/unlock | Step 1–2（1–2 周） |
| 打标签 | delegation-codex-app-server.test.ts（dev:65 本机 10 pass/1 fail）、real typecheck script、PTY 与外部二进制 live 用例                | 打 integration 标签，移出 PR 必跑，夜间跑且失败记录                                                          | Step 3（2 天）     |
| 保留   | exerciser coverage/auth、openapi-drift                                                                                              | 不动                                                                                                         | 无                 |

对「exerciser coverage 是假门禁」的回应：部分接受。作为行为覆盖它是假的（coverage 不执行，index.ts:3862-3866）；作为路由注册契约它是真的，dev:33 与 dev:139 只证明它不是行覆盖率，不证明它无效。处置不是废除，而是「改名 + 报告 + 把行为验证接到 effect」；「假门禁」的准确说法是「注册契约门禁被误当行为门禁，且有一条过期断言证明它没有被人工读过」。
先后顺序的理由：如果先删测试再修门禁，stale 断言会被一起删掉，就等于用删除掩盖了一次真实的行为漂移；先修才能让后续删除有可信基线。

## 4. D：TDD 的最终立场与 testing.md:11 文案

我明确接受：「core/schema 纯逻辑强制红先行、UI/e2e 不做特性 TDD」（dev:88-94、dev:131 的分层方向与我 Round 1 §6 一致）。
我保留一条例外：「缺陷复现优先」。任何层的缺陷修复都必须先在最低可复现层写 RED（可以是 route-level baseline，如 ef2e6336f 用 page.clock 复现静默 turn，正文明确 No production code is touched），修后保留为回归。这与「禁止 UI/e2e 做特性 TDD」不冲突：前者是调试与回归，后者是功能设计。

docs/testing.md:11 最终文案建议（替换现在那句「TDD 强制循环：红→绿→重构」）：
「分层测试先行：core/schema 等可判定纯逻辑默认先红后绿；Effect service 与 HTTP handler 必须存在行为测试（允许后置）；UI 与 e2e 不做特性 TDD。任何层修缺陷必须先复现（RED 可来自 route-level baseline 或注入破坏）。禁止制造不可满足的 RED；判别式见 §10 第 8 条。」
如何「强制」core：不靠时间顺序（不可验证，双方都已核实 CI 无此检查），靠判别式——T0 新增测试必须在 PR 记录「注入破坏→红→还原→绿」（dev:107 与 testing.md:170-176）；这已经是可机械检查的形式。

## 5. E：3,375 行 TDD 计划文档怎么处置

事实：docs/plan 下 5 份 tdd 文档合计 3,375 行；docs/plan/\*.md 中我 grep 到 20 份提及 RED/GREEN（Lead 口径 27，可能含子目录，未复核）；最新一份自述 S00–S09 均未执行（dev:83 已核实）。
判断：文档不是测试运行成本，不进入「测试太多」的删除清单；但每份近 2,000 行的执行手册定义 per-slice RED/GREEN 门禁而机器不验证（dev:81-84），会产生「流程已经执行」的幻觉，这是真实的流程成本。
建议：

1. 保留 1 份 ≤150 行的 TDD 模板（从 agent-interaction 文档抽取 RED/GREEN/判别式三段即可）加 docs/testing.md 的 §6 与 §10。
2. 其余 4 份移入 docs/plan/archive/ 并在文首标注「历史手册，不再执行」。
3. 冻结新增 TDD 执行手册：新计划只需要在 PR 模板勾选 RED/GREEN 判别式三项，不再按 slice 写手册。
4. 每季度清理一次；预估 1–2 人日，收益是 review 带宽与新人入口，不是墙钟。
   不把文档行数计入「测试代码 227,247 行」的对比，也不作为删除测试的理由。

## 6. 接受、改变与坚持

[接受] 体量不是杠杆、0.655 不动（dev:8）；--only-failures 撤回（dev:46）；mock 不是本仓问题（dev:76）；无行覆盖率门禁；openapi-drift、exerciser coverage/auth、browser-boundary、i18n parity、presentation-tagging 不动（dev:137/147）；机械门禁四条（dev:130），其中「禁止 readFileSync 读同仓源码做文本断言」与我 Round 1 的最高杠杆建议独立收敛。
[我改变主张] 删除规模上调为净减 300–500 行、转换 ≤1,900 行；「T0 强制红先行」降级为「习惯 + 判别式门禁」；接受 PR <15 分钟目标与完整 e2e 移出 PR（附 smoke 条件）；「重写全部 16 文件」改为「先删后转、逐文件证明」。
[我坚持] 最低不可删 8 类（迁移、权限、provider、HTTP 契约、V1/V2 parity、E3 主路径、安全、低成本契约）；缺陷复现优先；exerciser stale 断言必须先修；「测试只增不删」需要季度 ROI 与删除台账，不能只靠一次性删除。

## 7. 剩余分歧与请 Lead 拍板

分歧：

1. PR 是否保留 E3 冒烟子集：我主张 6 个 spec；dev:127-129 主张完整 e2e 移出 PR。
2. A 类处置路径：我主张先删整文件再加逐文件转换；dev:118 主张一次性转换 16 文件。
3. UI/e2e 措辞：我主张「不做特性 TDD，但缺陷复现优先」；dev:94 主张禁止 TDD。

拍板项：

- D1：批准 PR 冒烟 6 spec（§2 表），预算 ≤8 分钟含预热；超预算降至 4 个。
- D2：批准「先删后转」加源码断言白名单只减不增；净减目标 300–500 行；每个删除/转换 PR 贴判别式证据。
- D3：批准 testing.md:11 按 §4 文案改写，并把判别式至少对 T0 新增测试做机械检查（PR 模板勾选或脚本）。
  若只批一项：批 D1 与机械门禁（dev:130 第 2 条）——它们同时降低 churn、假红与 P0 逃逸，且不牺牲风险覆盖。

## 8. 证据边界

已核实：964 文件 / 227,247 行 / 79 spec / 16,859 行；21 文件 / 1,933 行 readFileSync 命中（packages/app/src 与 packages/session-ui/src）；playwright.config.ts:76/80/88/96 只有四个 project，而 docs/testing.md:69 写五个、test.yml:260 只列四个（文档与实现漂移）；docs/review/global-shell-remaining-closure.md:98 的 293 秒冷启动；exerciser index.ts:3862-3866 与 :1419-1423、handlers/file.ts:103-107；test.yml:85-92 advisory；ef2e6336f test-only；docs/plan 下 5 份 tdd 文档 3,375 行、20 份 plan 提及 RED/GREEN（我的口径）。
未核实：Lead 的 21 文件 / 1,980 行 / 188 例与 dev 的 churn 数字（47.6%、39.1%、14.7%、187%）、dev 的 16 文件 / 300 匹配器 / 1,300 行、Lead 的 27 份 RED/GREEN 口径；6 个 smoke spec 的实测时长（按 technical-debt.md:306 折算，需首轮校准）；本次未运行任何测试套件（遵守负载约束）。
