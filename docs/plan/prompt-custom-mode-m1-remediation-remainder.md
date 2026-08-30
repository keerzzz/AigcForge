# Custom Mode M1 整改剩余波次 全量执行提示词

> 对应评审:[AigcForge_CUSTOM_M1_DELIVERY_REVIEW_2026-08-19.md](../review/AigcForge_CUSTOM_M1_DELIVERY_REVIEW_2026-08-19.md)(裁决 REJECT 的 9 项清单)
> M1 计划:[custom-mode-m1-single-agent-runtime.md](custom-mode-m1-single-agent-runtime.md);总计划:[custom-mode-composition-platform-implementation.md](custom-mode-composition-platform-implementation.md)
> 前置:M0 已合入(PR #43,`cd30c5496`);M1 六个 Phase + 整改 Wave 1/2 已在 `custom-rollout` 分支合入(10 commits)
> 分析基线:`custom-rollout@9aa08348b`(2026-08-19)+ **工作树未提交半成品**(见 §2.3);执行时先盘点再动手
> 生成日期:2026-08-19
> 用途:复制 `PROMPT START` 与 `PROMPT END` 之间的正文到新的执行对话

<!-- PROMPT START -->

你是 AigcForge 仓库(`/media/win_data/aigcfroge`)的高级全栈工程师。你的唯一目标是按仓库协议,以 TDD 小切片完成 **Custom Mode M1 整改的剩余三个波次**:W3a 收尾(upgrade 端点 + SDK + capability 头 + flag 门禁)、W3b(Phase E 全量 UI)、W4(Phase G 收口:kill switch 语义 + 稳定性矩阵 + 文档同步)。完工后停机等待高级全栈顾问总复审。**不得进入 M2-M5,不得 push,不得开 PR**(用户已定:全部完工后一次性 PR)。

M1 整改要闭环的评审缺口:

```text
W3a: POST /custom-composition/upgrade 端点(半成品待验证收尾)
     + JS SDK 重新生成 + App SDK client capability 头注入
     + AIGCFROGE_CUSTOM_MODE flag 四门禁(半成品)与既有测试 flag-on 适配
W3b: Phase E 全量 UI:挂载 custom slot / Builder 三列 / 四预览 Tabs
     / Draft 持久化 / start 流调真端点 / Snapshot 只读面板 / upgrade action
     / 全状态覆盖 / 18 locale i18n / 单元测试(+ e2e、storybook 酌情)
W4: 执行层 kill switch 语义 + 50 次稳定性矩阵(四指标)+ ADR/PRD/Roadmap/changelog/technical-debt 文档收口
```

每个 Wave 内部 slice 验证全绿后自动继续;W4 结束后统一停机。**任一 Gate 标准与代码事实冲突时停止并报告,不得自行变通。**

## 0. 开工门禁

先执行并记录:

```bash
pwd
git branch --show-current          # 必须是 custom-rollout
git status --short --branch
git log --oneline --decorate -12
git diff --stat                    # 必须看到 §2.3 列出的半成品清单
```

规则:

1. 当前分支必须是 `custom-rollout`,HEAD 为 `9aa08348b` 或其后(本提示词刷新时)。若分支被外部切换或 HEAD 不符,**立即停止并报告**,不要在错误基线上施工(本仓库会话中真实发生过分支被外部 `checkout main` 的事故)。
2. **工作树存在未提交的 W3a 半成品(§2.3),是上一执行代理被中断留下的。** 你的第一刀是盘点并验证它:能修就续,确认错误才改;不得整段丢弃重写,也不得盲目信任直接跳过验证。
3. 不覆盖、回滚、清理用户已有改动。禁止 `git reset --hard`、`git checkout --`、盲目 clean。已知无关在途文件:`v3-ui-prototype.html`(未跟踪,保留原样)。`.worktrees/` 目录不动。
4. 测试永不从仓库根运行(有 `do-not-run-tests-from-root` 守卫)。使用 `bun --cwd packages/<name> test --timeout 30000`;根目录只可跑 typecheck/lint/diff 类门禁。
5. 提交纪律见 §7:**只允许在 custom-rollout 上 commit,禁止 push / PR / `--no-verify`**。

## 1. 必读协议与计划

开工前完整读取,不依赖本提示词转述:

```text
CLAUDE.md
AGENTS.md
docs/testing.md
docs/technical-debt.md
docs/review/AigcForge_CUSTOM_M1_DELIVERY_REVIEW_2026-08-19.md   # 评审 9 项清单与裁决
docs/architecture/adr/ADR-17-custom-mode-composition-platform.md # 含 §19.1 HTTP 契约修订
docs/prd/custom-mode-composition-platform.md                     # §9/§10/§15 UI 验收 + §18.1 修订
docs/plan/custom-mode-m1-single-agent-runtime.md                 # Phase E/G 原文与验收标准
specs/v2/schema-changelog.md                                     # 已定案契约
packages/app/AGENTS.md                                           # UI 约定(稳定性>简洁>性能、createStore、本地联调方式)
packages/aigcfroge/src/server/routes/instance/httpapi/AGENTS.md  # 路由与错误契约
packages/aigcfroge/test/AGENTS.md + test/server/AGENTS.md        # 测试模式
packages/core/src/tool/AGENTS.md                                 # (仅当你触碰 tool 层时)
```

## 2. 基线状态(复审方已坐实,可直接采信)

### 2.1 已合入 custom-rollout 的 10 个 commit

`303a3faca`(Phase A 快照持久化)→ `9abe55e11`(B 原子 start)→ `a6e48ab6a`(C runner/skill/工具物化)→ `21a226c15`(D 双层门禁)→ `57b477f70`(E App surface)→ `1b20472ca`(F 生命周期)→ `b6634cff5`(整改:assertDependency 真实现/委派 typed 拒绝/move 重检/upgradeCustom 域)→ `d592ed784`(整改:runner 漂移重验/Snapshot-local skill catalog/Tier1 fail-closed)→ `81c10b8d9`(评审与提示词文档)→ `9aa08348b`(整改:HTTP 契约——V1 同步三端点拒 custom、session.custom capability 门禁、fork 路由对称、实例装配 v2RuntimeLayer/v2ShareLayer、矩阵重写、schema-changelog 定案)。

验证基线(9aa08348b 时刻):core 全量 2002 pass / 0 fail;aigcfroge test/server/ 364 pass / 0 fail;全仓 `bun typecheck` 15/15;`bun run script/lint-changed.ts` 0 violations。

### 2.2 关键契约事实(不要再推翻)

- 能力协商:客户端带 `x-aigcfroge-capabilities: product-mode-custom-v1`;non-capable 对 custom 会话一律 404。
- children/context 是 capable 客户端的**只读**端点(孤儿 custom 也 200 `{data:[]}`);switchAgent/switchModel/compact/wait/interrupt/share 六个控制端点 M1 拒 custom(400 `UnsupportedProductModeError`);prompt/shell/skill 走 V2 admission,缺快照 fail-closed(404 SessionNotFoundError,语义 wart 已评审接受)。
- fork:custom 父对 capable 客户端放行,路由 V2 `create({parentID})` 复制快照;孤儿父 400 typed。root 创建只能走 start 端点。
- 域函数 `SessionV2.upgradeCustom({ sessionID, composition, expectedPlanDigest?, title? })`:源须 custom(`UpgradeSourceModeError`)、须 idle(`SessionBusyError`,经 `SessionExecution.isActive`),冻结新组合建**新** Session,旧 Session/Snapshot 永不变更。
- runner 每个 provider turn 重验 snapshot 工具 fingerprint+catalogDigest(typed `SessionRunner.SnapshotDriftError`,fail-closed);skill tool 与 skill steer 走 Snapshot-local catalog。

### 2.3 未提交半成品清单(上一代理中断时的工作树)

| 文件                                                                        | 状态      | 内容                                                                                                                                                    |
| --------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/schema/src/composition.ts`                                        | 改,+7     | 新增 `Composition.UpgradeInput`(sessionID 必填 + composition + expectedPlanDigest? + title?)                                                            |
| `packages/core/src/flag/flag.ts`                                            | 改,+3     | 新增 `Flag.AIGCFROGE_CUSTOM_MODE`(truthy getter,跟随既有 Flag 模式)                                                                                     |
| `packages/core/src/product-mode-policy.ts`                                  | 改,+13    | 新增 `isCustomModeEnabled()`(读 flag,default off)+ `CUSTOM_MODE_DISABLED_MESSAGE`;注释声明仅 HTTP 门禁消费、域层 flag-free                              |
| `packages/aigcfroge/.../groups/custom-composition.ts`                       | 改,+16    | 声明 `POST /custom-composition/upgrade`,payload UpgradeInput,success StartResponse,errors [InvalidRequestError, SessionNotFoundError, SessionBusyError] |
| `packages/aigcfroge/.../handlers/custom-composition.ts`                     | 改,+78    | upgrade handler 全量错误映射;plan/start/upgrade 三个端点均已加 flag 门禁(flag off → 400 disabled 消息,先于 capability 检查)                             |
| `packages/server/src/handlers/session.ts`                                   | 改,+5     | `session.custom` 加 flag 门禁(先于 capability 检查)                                                                                                     |
| `packages/aigcfroge/test/server/httpapi-custom-composition-upgrade.test.ts` | 新,226 行 | upgrade 端点 4 测试:**3 过 1 挂**——`rejects upgrade while the source session is busy` 失败(busy 场景构造未完成)                                         |
| `packages/aigcfroge/test/server/scratch-busy.test.ts`                       | 新,156 行 | 调试 busy 场景的草稿脚手架。**必须折叠进正式测试文件后删除,禁止残留 scratch 文件**                                                                      |

半成品**未跑过** typecheck/lint;`health`/`references` 两个只读端点按契约**不加** flag 门禁(历史可读),保持一致即可。

## 3. W3a 收尾(先做完这个再进 UI)

1. **验证半成品**:`bun typecheck` 全绿;跑 upgrade 测试文件。修复 busy 测试——正确做法是让源会话真实处于 draining(参考 packages/aigcfroge 测试里既有的 busy 构造,如 prompt 后 status busy 模式 + `pollWithTimeout` 等待信号;禁止 `Effect.sleep` 硬等),或用可控 seam 让 `SessionExecution.isActive` 返回 true。折叠 scratch-busy.test.ts 并删除。
2. **flag 门禁回归适配**:flag 默认 off 后,既有 custom 测试会 400。逐文件适配:`v2-session-capability.test.ts`、`session-mode-fork-gate.test.ts`、upgrade 测试文件,以及 packages/core 中走 HTTP 或 start 路径的 custom 测试(如 `custom-composition-start.test.ts` 若受影响),在测试 setup 里 scoped 设置 `AIGCFROGE_CUSTOM_MODE=true` 并在 finalizer 恢复(test/server/AGENTS.md 的 scoped flag 约定)。同时**新增**反向覆盖:flag off 时 plan/start/upgrade/session.custom 四个门禁各一条 400 typed 断言;flag off 时已存在 custom 会话 get/children/context 仍 200(历史可读)。
3. **SDK 重新生成**:运行 `./packages/sdk/js/script/build.ts`(先读脚本了解是否需要起服务/导 spec)。确认生成的 client 含 `customComposition.upgrade`;不得手改生成物。若 packages/sdk/js 有 test/typecheck 脚本,跑绿。
4. **App capability 头注入**:找到 App SDK client 工厂(packages/app/src 内搜 createClient / context/sdk),在工厂单点给实例请求默认注入 `x-aigcfroge-capabilities: product-mode-custom-v1`。常量引用优先走 `@aigcfroge/sdk` 或 `@aigcfroge/schema` 的再导出;查 App 现有对 core 常量的引用惯例(如 `context/mode.tsx` 用 ProductModeAgentPolicy)再决定 import 来源,不得引入新的分层违规。工厂可测则补单测,不可测说明原因。
5. **App 感知 flag**:查 App 现有的 server→app 配置通道(如 global/config 类端点或 bootstrap 拉取),以最小改动暴露 `customModeEnabled` 布尔供 W3b 的"flag off"状态渲染;若无现成通道,在实例 API 的合适只读端点上补字段并在报告里说明选择。

W3a 完成判据:上述测试全绿;`bun typecheck` 15/15;`bun run script/lint-changed.ts` 0 violations;半成品全部入库(§7 提交纪律)。

## 4. W3b:Phase E 全量 UI(对 G0-G10 逐项闭环)

勘察已坐实现状(分支实测,直接采信):`packages/app/src/pages/mode-workspace.tsx:15` 的 `ALL_SLOTS = ["chat","coding","work","assistant"]` **不含 custom**——`57b477f70` 注册的 `CustomProjectColumnSidebar`/`CustomSessionListMain` 从未挂载,`/mode/custom` 渲染空页;`packages/ui/src/v2/components/icon.tsx` 无 `mode-custom` 字形(静默回退 "plus");custom "New session" 走通用 `launchModeSession` → `submit.ts:386-392` 调 `session.create({mode:"custom"})` 被服务端硬拒,是必错死路;无 Builder/预览/Draft/Snapshot panel/upgrade action/状态覆盖;i18n 每 locale 仅 2 key;零新增 App 测试、零 e2e、零 storybook。

逐项要求(规格原文以 M1 计划 Phase E 与 PRD §9/§10/§15 为准):

- **G0 挂载**:`ALL_SLOTS` 加 `"custom"`;桌面三列(资产目录/组合清单/解析预览)unframed layout,窄屏单列 steps/drawer(PRD §10.1:永不三列挤压);复用 ModeRoute/ModeWorkspace/typed slots 与 `render-all + display:none` 零 remount 模式。
- **G1 图标**:`packages/ui/src/v2/components/icon.tsx` 补 `mode-custom` 真实字形。
- **G2 Builder 三列**:左列 Location + Profile 搜索/列表/健康过滤 + temporary 入口;中列组合清单(exactly-one Agent + Prompt/Skill 绑定);右列解析预览。消费 `sdk.client.customComposition.plan` / `customProfile.*`(SDK 方法已存在)。
- **G3 四预览 Tabs**:Instructions / Capabilities / Permissions / Diagnostics,渲染真实 CompositionPlan。
- **G4 Draft 持久化**:按 packages/app/AGENTS.md 的 `createStore`/`Persist` 约定建 composition draft store;覆盖 Draft 恢复、start stale(plan digest 漂移)保留用户选择、resolver 失败保留输入(PRD §12)。
- **G5 start 流**:custom 入口不走 `launchModeSession`;点击启动 → `customComposition.start`(W3a 后含 capability 头)→ 成功跳 canonical Session 路由;失败按 PRD §10.3 分类渲染(loading/empty/permission-required/dependency-missing/version-drift/resolver-failed,**不得折叠成单一"无法启动"**)。
- **G6 Snapshot 只读面板**:`session-side-panel.tsx` 加 custom typed slot(render-all + display:none),只读展示 Composition/Dependencies/Run History,消费 SDK 的 session composition 读取端点;版本漂移诊断提示。
- **G7 upgrade action**:面板内"采用新版本"→ 走 W3a 的 `custom-composition/upgrade`(或 SDK 对应方法)→ 成功打开新 Session;源会话永不变更;busy 时禁用并提示。
- **G8 状态与协商**:flag off(读 W3a 的 App 通道)/ old server(不支持端点)/ typed unsupported 等 UX 状态全覆盖;App 已发 capability 头(W3a)后 custom 会话在列表/详情可见。
- **G9 i18n**:18 个 locale 文件(packages/app/src/i18n/)。parity 测试只对 en/zh/zht 强校验,但约定全量 18 文件同步新增 Builder/预览/状态/面板/upgrade 词汇;zh 实译,其余可英文兜底(跟随现有 base-spread 惯例);跑 `parity.test.ts` 绿;EN/ZH/ZHT 长串溢出按 PRD §15 检查。
- **G10 测试**:packages/app 用既有 happy-dom + 源码级装配断言模式(无 solid-testing-library,参照 `assistant-session-panel.test.tsx` 等);状态转移逻辑抽纯 ts 文件单测;至少覆盖:slot 挂载注册、draft store 恢复/保留、start 流调 start 端点且不再调 session.create、预览 tabs 渲染 plan、状态机各分支、i18n parity。e2e(`e2e/`)与 storybook(`packages/storybook`)各补一条最小用例,若基础设施成本过高则在报告里说明并降级为手工验收步骤清单。
- 红线:不创建 `/custom/*` shell、不嵌套卡片卡、不动非目标既有 mode 行为;新代码遵守根 AGENTS.md(无 else/早返回、无 `as any`、无星号/别名导入、自导出模式)。

W3b 完成判据:packages/app 单测全绿 + `bun --cwd packages/app typecheck`(tsgo -b)干净 + lint-changed 0 violations + 本地联调手工验收记录(backend :4096 / app :4444,见 packages/app/AGENTS.md;报告附 URL 与验收清单)。

## 5. W4:Phase G 收口

1. **执行层 kill switch 语义**:W3a 的 flag 只挡创建/plan。补运行期语义并文档化:flag off 时 custom 会话的 runner drain 是否阻断(建议:阻断新 drain、历史可读;实现于 SessionExecution/runner 边界的最小 seam,域层其余部分保持 flag-free)。配测试。
2. **稳定性矩阵**:写脚本/测试矩阵跑 custom 会话核心流(start → prompt → 委派 → fork → resume → upgrade)50 轮,记录四指标:失败数(须 0)、内存泄漏(堆增长)、挂起 fiber、typecheck。报告给数据。
3. **文档收口**:ADR-17/PRD/roadmap 状态字段更新(M1 整改完成项打钩);`specs/v2/schema-changelog.md` 补 upgrade 端点与 flag 语义;`docs/technical-debt.md` 闭环本次消除的条目(若有);changelog 按仓库惯例。
4. 最终回归:core 全量、aigcfroge test/server/、app 全量、`bun typecheck` 15/15、lint-changed、`git diff --check`。

## 6. 验证门禁(每个 Wave 收尾必须全绿才算完成)

```bash
bun --cwd packages/<name> test --timeout 30000 <focused files>   # 绝不从根跑 test
bun typecheck                                                     # 全仓 15/15
bun run script/lint-changed.ts                                    # 0 violations
git diff --check
```

## 7. 提交纪律

- 每个 Wave 至少一个 conventional commit(`type(scope): summary`,scope 用 core/server/app/sdk 等),测试全绿才提交;半成品首次入库单独一个 commit 并注明续作来源。
- **禁止** push、开 PR、`--no-verify`、改分支名、动 main。完工后停在 custom-rollout。

## 8. 停机报告格式

按 CLAUDE.md「改完即审」复查结论格式输出,并附:对照评审报告 9 项清单的逐项闭环证据(文件:行号 + 测试名)、每个 Wave 的验证命令与结果原文、G0-G10 闭环映射表、W4 矩阵四指标数据、以及明确列出的"未做/降级项+原因"。

<!-- PROMPT END -->
