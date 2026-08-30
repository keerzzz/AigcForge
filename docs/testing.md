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

| 层级          | 工具                       | 位置                                                              | 说明                                                              |
| ------------- | -------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| 单元测试      | `bun test`                 | `packages/{core,aigcfroge,schema,llm,ui,session-ui}/**/*.test.ts` | Effect 用 `testEffect()`（见 `packages/core/test/lib/effect.ts`） |
| App 单元测试  | `bun test` + happydom 探针 | `packages/app/src/**/*.test.tsx`                                  | `--preload ./happydom.ts`                                         |
| HTTP API 演练 | 自研 `httpapi-exercise.ts` | `packages/aigcfroge/test/server/httpapi-exercise`                 | 3 种模式（见 §3）                                                 |
| E2E           | Playwright                 | `packages/app/e2e/{regression,smoke}/**/*.spec.ts`                | 桌面 + 窄视口 + 明暗 + 三语                                       |
| 性能基准      | benchmark.ts + Playwright  | `packages/app/e2e/performance/unit` + `playwright.config.ts`      | 串行，不设机器相关硬阈值                                          |

---

## 2. 包级测试命令

| 包                                 | 命令                                                            | 备注                                                                                               |
| ---------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| core                               | `bun --cwd packages/core test --timeout 30000`                  | 脚本含 `--only-failures`                                                                           |
| aigcfroge                          | `bun --cwd packages/aigcfroge test --timeout 30000`             | 脚本含 `--only-failures`                                                                           |
| aigcfroge                          | `bun --cwd packages/aigcfroge test:httpapi`                     | 独立门禁，见 §3                                                                                    |
| app                                | `bun --cwd packages/app test:unit`                              | `bun test --only-failures --preload ./happydom.ts ./src`                                           |
| app                                | `bun --cwd packages/app test:virtualizer`                       | `--conditions=browser` solid-virtual                                                               |
| app                                | `bun --cwd packages/app test:e2e <spec>`                        | `playwright test`（另有 `:ui` 交互、`:report`）                                                    |
| app                                | `bun --cwd packages/app test:bench`                             | `bun test ./e2e/performance/unit && playwright test --config e2e/performance/playwright.config.ts` |
| schema / llm                       | `bun --cwd packages/<name> test`                                | schema 无 timeout 覆盖                                                                             |
| ui / session-ui                    | `bun --cwd packages/<name> test`                                | 脚本含 `--only-failures`                                                                           |
| effect-drizzle-sqlite              | `bun --cwd packages/effect-drizzle-sqlite test --timeout 30000` | vendor 桥接                                                                                        |
| desktop / sdk / script / storybook | 无单测                                                          | 靠 typecheck + 其他层覆盖                                                                          |

> app 的 `test:unit:watch`：`bun test --watch --preload ./happydom.ts ./src`。

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
- **目标（尚未实现，勿作为 PR blocker）**：桌面与窄视口、light/dark、en/zh/zht 三语、键盘 focus。截至 2026-08-26 实测：18 个 `regression/*.spec.ts` 中 dark **0/18**、i18n **0/18**、keyboard **2/18**；`packages/app/playwright.config.ts:43` 只有单个 `chromium` / Desktop Chrome project，无 theme / locale / 窄视口 project。**所以这一行历史上是纸面要求，从未在任何层面成立**——登记于 [technical-debt](technical-debt.md) §4，根治方式是在 config 加 project（会一次照亮全部既有 spec），不是逐个 PR 追加断言
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
3. 不断言源码字符串代替行为。
4. 只测 `assert()` 不测工具定义物化 = 半测（权限类必须成对）。
5. 不只测 V2 漏 V1（双运行时功能必须 parity）。
6. 不新增 `Effect.sleep(N)` 等待型测试。
7. 测试必须在所属包内运行，禁止根目录执行。
