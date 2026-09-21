# AigcForge 测试体系指南

> 本仓测试体系的全景、门禁与命令速查。配套协议见根 `AGENTS.md` §Testing 与各包 `AGENTS.md`。

---

## 0. 核心原则

- **测试不能从仓库根目录运行**（根 `test` 脚本是 guard：`echo 'do not run tests from root' && exit 1`）。单包运行：`bun --cwd packages/<name> test --timeout 30000`。
- **`--cwd` 后面不要加 `run`**：`bun --cwd <pkg> run <script>` 会打印 `bun run` 的 usage、**什么都不执行、且 exit 0**（bun 1.3.14 实测）。正确形式是 `bun --cwd <pkg> <script>`，或 `cd packages/<name> && bun run <script>`。**这是"绿了但没跑"的静默陷阱**：报告里写了命令、退出码是 0、却没有任何测试执行。CI 用的是正确形式（`test.yml:145`、`storybook.yml:40` 均无 `run`，其余走 turbo），所以门禁本身有效；受影响的只是照文档手敲的人和 agent。已归档于 [technical-debt](technical-debt.md) §4。
- **TDD 强制循环**：红（先写测试确认失败）→ 绿（最小实现）→ 重构（去重保持绿）。禁止复制生产逻辑进测试。
- **避免 mock**：不用 `globalThis.*`（除非唯一选项）；用 `Layer.mock` 优于 `Layer.succeed(Service, Service.of({...}))` 全量 stub；测试实际实现。
- **禁止等待并发 fiber**：不用 `Effect.sleep(N)` / `setTimeout`。用就绪信号：`pollWithTimeout`、`awaitWithTimeout`、`llm.wait(n)`、`SessionStatus.Service.get`、`BackgroundJob.wait`、Bus+Latch、`Deferred.await` + `timeoutOrElse`。

---

## 1. 测试层级全景

| 层级          | 工具                       | 位置                                                                     | 说明                                                              |
| ------------- | -------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 单元测试      | `bun test`                 | `packages/{core,aigcfroge,schema,llm,ui,session-ui,script}/**/*.test.ts` | Effect 用 `testEffect()`（见 `packages/core/test/lib/effect.ts`） |
| App 单元测试  | `bun test` + happydom 探针 | `packages/app/src/**/*.test.tsx`                                         | `--conditions=browser --preload ./happydom.ts`                    |
| HTTP API 演练 | 自研 `httpapi-exercise.ts` | `packages/aigcfroge/test/server/httpapi-exercise`                        | 3 种模式（见 §3）                                                 |
| E2E           | Playwright                 | `packages/app/e2e/{regression,smoke}/**/*.spec.ts`                       | 桌面 + 窄视口 + 明暗 + 三语                                       |
| 性能基准      | benchmark.ts + Playwright  | `packages/app/e2e/performance/unit` + `playwright.config.ts`             | 串行，不设机器相关硬阈值                                          |

---

## 2. 包级测试命令

| 包                        | 命令                                                            | 备注                                                                                               |
| ------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| core                      | `bun --cwd packages/core test --timeout 30000`                  | 脚本含 `--only-failures`                                                                           |
| aigcfroge                 | `bun --cwd packages/aigcfroge test --timeout 30000`             | 脚本含 `--only-failures`                                                                           |
| aigcfroge                 | `bun --cwd packages/aigcfroge test:httpapi`                     | 独立门禁，见 §3                                                                                    |
| app                       | `bun --cwd packages/app test:unit`                              | `bun test --conditions=browser --only-failures --preload ./happydom.ts ./src`                      |
| app                       | `bun --cwd packages/app test:virtualizer`                       | `--conditions=browser` solid-virtual                                                               |
| app                       | `bun --cwd packages/app test:e2e <spec>`                        | `playwright test`（另有 `:ui` 交互、`:report`）                                                    |
| app                       | `bun --cwd packages/app test:bench`                             | `bun test ./e2e/performance/unit && playwright test --config e2e/performance/playwright.config.ts` |
| schema / llm              | `bun --cwd packages/<name> test`                                | schema 无 timeout 覆盖                                                                             |
| ui / session-ui           | `bun --cwd packages/<name> test`                                | 脚本含 `--only-failures`                                                                           |
| effect-drizzle-sqlite     | `bun --cwd packages/effect-drizzle-sqlite test --timeout 30000` | vendor 桥接                                                                                        |
| desktop / sdk / storybook | 无单测                                                          | 靠 typecheck + 其他层覆盖                                                                          |
| script                    | `bun --cwd packages/script test --timeout 30000`                | `bun test --timeout 30000`                                                                         |

> app 的 `test:unit:watch`：`bun test --conditions=browser --watch --preload ./happydom.ts ./src`。

---

## 3. HttpApi exerciser（HTTP 契约门禁）

位置：`packages/aigcfroge/test/server/httpapi-exercise/index.ts`，三种模式：

| 模式     | 命令 flag                                          | 门禁性质                                                          |
| -------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| coverage | `--mode coverage --fail-on-missing --fail-on-skip` | **门禁**：路由覆盖缺失即失败                                      |
| auth     | `--mode auth --fail-on-missing --fail-on-skip`     | **门禁**：认证覆盖缺失即失败                                      |
| effect   | `--mode effect`                                    | **建议性**：main 上有既有 runtime 失败，CI 中 `continue-on-error` |

CI 中（linux only）：coverage + auth 为硬门禁，effect 为 advisory。

---

## 4. App E2E（Playwright）

- 配置：`packages/app/playwright.config.ts`（性能基准另用 `packages/app/e2e/performance/playwright.config.ts`）
- 目录：`regression/`（回归规格）、`smoke/`（冒烟）、`performance/`（基准）、`utils/`（辅助）
- **当前实际执行标准**：每个功能一份 spec，覆盖该功能的主路径与加载/空/错误态。**这是审查时唯一可据以打回的 e2e 标准。**
- **presentation matrix（2026-09-08 落地为真实门禁；2026-09-16 收窄为标签门禁）**：`playwright.config.ts` 定义五个 project——`chromium`（Desktop Chrome、light、en，跑业务全集）、`chromium-dark`（storageState 写 `aigcfroge-color-scheme=dark`）、`chromium-zh` / `chromium-zht`（storageState 写 `aigcfroge.global.dat:language={"locale":"zh"|"zht"}`）、`chromium-narrow`（390×844）。storage origin 从 `baseURL` 推导，不硬编码端口；全部 project 用 Chromium。**四个矩阵 project 带 `grep: PRESENTATION_GREP`**，只跑带 `@presentation` / `@a11y` 标签的 spec；标签与 grep 的单一真源是 `e2e/presentation-matrix.ts`（config 与契约 spec 共用它，不各自抄一份）。实测收窄效果（`playwright test --list`）：`chromium` 206 例 / 52 文件，四个矩阵 project 各 3 例 / 3 文件；收窄前每个 project 都是 206 例，即五 project ≈1030 个实例 → 现在 ≈218。**标签纪律**：①整份 spec 断言 theme/locale/viewport/a11y 的才打标签（当前：`presentation-matrix.spec.ts` = `@presentation`、`mode-slot-fallback-a11y.spec.ts` = `@a11y`、`global-shell-presentation.spec.ts` = `@presentation`）；②任何 `testInfo.project.name` 分支的 spec **必须**带标签，否则它在矩阵里静默停跑——这条由 `e2e/regression/presentation-tagging.spec.ts` 按源码扫描强制（node 侧，无需浏览器）；③不带标签的 spec 只在 `chromium` 跑，这是收窄而不是丢失：`pinEnglishUI` / `pinDesktopViewport`（当前 40 个 spec）本来就强制语言与桌面几何，跑在 zh/zht/narrow 下只是重复 base project 的同一断言。CI（`test.yml` e2e job）Linux 仍列五个 `--project`（过滤发生在 config 里），Windows 只跑 `chromium`，无 `continue-on-error`。矩阵契约由 `e2e/regression/presentation-matrix.spec.ts` 按 project 名断言真实 theme（`data-color-scheme`/`data-theme`）、locale（`documentElement.lang`）与 viewport；键盘可达性在 base project 上以 Tab 交互断言，不新建第六个 project。history：2026-08-26 前 dark/i18n/keyboard 覆盖为 0（纸面目标），根治即本项目，登记于 [technical-debt](technical-debt.md) §4；"五 project 机械重复全部业务"这条债在 §8 按本次收窄的证据改判。**英文文案断言的 spec 必须 `pinEnglishUI`**（`e2e/utils/locale.ts`，`test.beforeEach` 注入）——即便收窄后它们不再进矩阵 project，pin 仍保留：直接以 `--project=chromium-zh` 单跑某 spec 调试时断言仍按英文匹配；locale 无关 spec（纯 `data-*`/数据文本断言）不得 pin
- 运行报告：`bun --cwd packages/app test:e2e:report`（playwright-report）

---

## 5. 性能基准（test:bench）

- 位置：`packages/app/e2e/performance/unit/**/*.test.ts` + `packages/app/e2e/performance/playwright.config.ts`
- 场景：session tab switch/flash 等现有 benchmark（`e2e/performance/benchmark.ts`、`chrome-trace.ts`）
- 规则：**串行运行**，不添加机器相关硬阈值；基准必须来自现有场景而非临时新建

---

## 6. 三种测试模式（Effect 测试）

| 模式          | 适用                             | 能力                               |
| ------------- | -------------------------------- | ---------------------------------- |
| `it.effect`   | 纯逻辑 / TestClock / TestConsole | 虚拟时钟、捕获 console             |
| `it.live`     | 真实 OS 行为                     | 真实文件系统、子进程               |
| `it.instance` | 集成                             | scoped tmpdir + instance，自动清理 |

`testEffect(...)` 封装见 `packages/core/test/lib/effect.ts`。夹具 `tmpdir()` 见 `packages/aigcfroge/test/AGENTS.md`（`fixture/fixture.ts`，支持 git 初始化、config 写入、自定义 init/dispose）。

---

## 7. 全仓门禁命令

| 用途           | 命令                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| 全仓类型检查   | `bun typecheck`（= `bun turbo typecheck`）                             |
| 全仓单测       | `bun turbo test`（CI 用；本地从包内跑）                                |
| 增量 lint      | `bun run script/lint-changed.ts`（只查改动文件新增行）                 |
| 全量 lint      | `bun run lint`（= `oxlint` 全仓 + lint-changed，CI 用）                |
| 协议引用检查   | `bash .aigcfroge/skills/protocols/scripts/check-refs.sh`               |
| 差异检查       | `git diff --check`                                                     |
| App 性能       | `bun --cwd packages/app test:bench`                                    |
| Storybook 构建 | `bun --cwd packages/storybook build`（收集 app/ui/session-ui stories） |

### pre-push 钩子

`.husky/pre-push` 跑 `bun typecheck`；快速迭代可设 `AIGCFROGE_SKIP_TYPECHECK=1` 跳过。非 pre-commit 钩子。

---

## 8. CI 环节（GitHub Actions）

| Workflow               | 触发          | 内容                                                                                                                     |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ci.yml`               | PR / 分支     | Lint → Typecheck → `bun turbo test`                                                                                      |
| `test.yml`             | PR / dev push | **unit × 2 OS**（linux+windows，40min 上限）+ **e2e × 2 OS** + HttpApi exerciser（coverage/auth 门禁 + effect advisory） |
| `typecheck.yml`        | PR            | `bun typecheck`                                                                                                          |
| `storybook.yml`        | PR            | `bun --cwd packages/storybook build`                                                                                     |
| `pr-standards.yml`     | PR            | PR 标题 / 分支命名规范                                                                                                   |
| `pr-management.yml` 等 | 事件/定时     | PR/issue 治理、beta 同步、发布、nix（非测试环节）                                                                        |

CI 注记：

- Windows 上 aigcfroge:test 子进程密集约慢 2.9 倍，CI 设 40min；Windows 关 filewatcher（`AIGCFROGE_EXPERIMENTAL_DISABLE_FILEWATCHER=true`）。
- `check-compliance` / `check-standards` / `add-contributor-label` / `check-duplicates` 为 PR 治理 checks（非测试）。

### 8.1 E4（真实后端 harness）与契约门禁（S6 接线）

- **E4 独立 job，不进 PR 必跑集合**：`test.yml` 的 `e4` job 只在非 PR（push / workflow_dispatch）触发，跑两个 variant——默认运行时（产品链）与 `E4_V2_RUNTIME=1`（V2 现状 spec 的唯一执行环境；那里的 green 表示 V2 缺口仍在，见该 spec 头注释）。PR 上的浏览器面由 `e2e` job 的 E3 套件覆盖。
- **证据必须上传**：job 把 `E4_RUN_DIR` 指到 workspace 内的 `packages/app/e2e/real/run-evidence/`，因此每个 variant 的 `manifest.json`、`teardown-gate.json`、`orchestrator.log` 都作为 artifact 上传（失败时另含 `test-results`）。手工跑时不会上传，所以本地证据要自己归档——S0–S5 的基线在 `/media/win_data/aigcfroge-shell-closure-*`；S6 的四个轮次（E3 全套、E4 双 variant、exerciser 三模式、benchmark）在 `/media/win_data/aigcfroge-shell-closure-s6/`，目录里的 README 记录每个 run dir 对应哪个 variant，不要凭目录名猜（`manifest.json` 的 `v2Runtime` 是唯一权威）。
- **Node 钉定 24.15**：与 `e2e` job 同因（Playwright 1.59 在 24.16 上提取 Chromium 挂起）。
- **OpenAPI 契约门禁**：`packages/aigcfroge/test/server/openapi-drift.test.ts` 随 unit job 运行，两条断言——①每个 operation 必须带 `OpenApi.annotations({ identifier })`（缺了会让生成 SDK 的方法在运行时变 `undefined`，其它门禁都不报）；②live spec 与 checked-in 快照必须逐字一致。快照故意变更时用 `UPDATE_OPENAPI_SNAPSHOT=1 bun test ./test/server/openapi-drift.test.ts` 显式重生成，让 diff 进入评审。
- **测试预算耦合**：`packages/aigcfroge` 的 `bun test --timeout 90000` 与 `httpapi-sdk.test.ts` 内 30s 的就绪轮询窗口是一对——窗口必须低于包预算，两者一起改（该用例注释里有同样的告警）。曾因两者都是 30s 而在饱和 runner 上出现 17/1 超时。
- **effect 模式仍是 advisory**：exerciser 的 coverage/auth 是门禁，effect 目前 advisory（仓库既有状态）。要升为门禁需先清掉它记录的运行期失败，属独立决策。

---

## 9. 已知测试相关债（关联 docs/technical-debt.md）

| 债                   | 说明                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| app stories 覆盖为零 | `packages/app/src/**/*.stories.tsx` 目前无文件；UI 共享组件新增 story 后才能被 storybook CI 收集（4 模式归一化 Phase 3 计划内） |
| 性能基准单一         | 仅 session tab switch/flash 场景                                                                                                |
| happy-dom 探针限制   | dompurify ≥3.4.7 与探针不兼容，升级前须迁移探针到真实浏览器（见技术债 §4，到期 2026-08-27）                                     |

---

## 10. 测试书写红线（违者打回）

1. 不复制 production 逻辑到测试 helper。
2. 不用 `as any` / `@ts-ignore` / 跳过 hook 强行绿。
3. 不断言源码字符串代替行为。读一个 `.ts`/`.tsx` 再 `toContain` 它的字符，测的是文本而不是行为：
   re-export 或换个写法就假绿，重命名或换格式就假红。已批量整改（`170567929` 换掉 14 条）。
   替代物按性质选：
   - **行为**（点了会怎样、请求发了什么）→ e2e，或把函数抽成可注入 client 的纯 `.ts` 做单测
     （例：`components/chat/asset-insert.test.ts` 用记账 client 断言 apply 路由与 payload）。
   - **类型归属**（谁拥有这个类型）→ 类型级断言，让 `tsgo` 而不是 `toContain` 失败
     （例：`assistant-session-panel-open.test.ts` 双向 assignable）。
   - **依赖方向**（这层不许 import 那层）→ `.oxlintrc.json` 的 `no-restricted-imports`
     override，一次覆盖整层而不是一个文件（例：`packages/app/src/context/**` 不许 import
     `@/pages/*`）。
   - **「复用而非分叉」** 目前没有便宜的行为化替代（fork 出来的组件长得一样），Chat/Work 右栏各留
     一条并在文件头写明，见技术债 §4。新增此类断言前先证明前三条都不适用。
4. 只测 `assert()` 不测工具定义物化 = 半测（权限类必须成对）。
5. 不只测 V2 漏 V1（双运行时功能必须 parity）。
6. 不新增 `Effect.sleep(N)` 等待型测试。
7. 测试必须在所属包内运行，禁止根目录执行。
8. **新增的 RED 必须可满足**：能仅靠修改生产代码变绿。禁止 `expect(false).toBe(true)`、禁止
   `const x = false; expect(x).toBe(true)`、禁止断言只能由改测试自身来满足的条件。
   判别式（提交前必跑）：临时把生产代码改对 → 跑 → 确认变绿 → 还原 → 两次输出都进报告。
   反例（2026-08-31 实测）：用 `Schema.decodeUnknownSync(SessionEvent.Durable)(payload)` 探
   union 成员性，因为 union 每个成员都要求事件信封的 `id` 字段，手搓 payload 即使在标签加入后
   仍会因 `Missing key at ["id"]` 继续红 —— 今天红对了，明天红错了。正解是断言
   `Object.keys(SessionEvent.Durable.cases)` 的成员性。
