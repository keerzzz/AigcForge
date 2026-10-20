# 依赖卫生审计报告 (Dependency Hygiene Audit)

> 审计对象: `/media/win_data/aigcfroge` (Bun workspaces monorepo)
> 审计日期: 2026-09-25
> 审计基线: `05e5921ca` (`main`)
> 性质: **只读分析** — 未修改任何文件
> 方法: 对 18 个 `package.json`、全部 `packages/*/src|script|test|e2e|.storybook` 做 import-specifier 解析 + 边界词匹配交叉验证

---

## 0. 基线校准（与任务给定"实测事实"的差异）

任务给出的数字与本次实测存在小幅偏差，先声明清楚，后续所有结论以**实测值**为准：

| 指标                            | 任务给定 | 本次实测                   | 说明                                                                  |
| ------------------------------- | -------- | -------------------------- | --------------------------------------------------------------------- |
| 根 `node_modules`               | 6.6 GB   | **6.51 GB** (6,821,711 KB) | 一致（取整差异）                                                      |
| `node_modules/.bun` 包版本数    | 1407     | **1407**                   | 完全一致                                                              |
| workspace 依赖条目              | 476      | **480**                    | 18 个 package.json 的 deps+devDeps 条目数；含 `workspace:` 协议 38 条 |
| 外部依赖名（distinct external） | 212      | **213**                    | 非 `workspace:` 的 distinct 名称                                      |
| 根 `patchedDependencies`        | **12**   | **11**                     | ⚠️ 见 §3，实际只有 11 条                                              |

> 复现命令：`bun run /tmp/extract2.ts`（统计脚本，逻辑为遍历 `readdirSync("packages")` 中所有含 `package.json` 的目录，外加 `packages/sdk/js`，再合并根 `package.json`，仅计 `dependencies` + `devDependencies`）。

---

## 1. 死声明（Dead Declarations）

### 1.1 分类总览

对 18 个 package.json 中 **430 条**非 workspace 声明（deps+devDeps）逐条判定：

| 分类               | 数量    | 判定依据                                                                                |
| ------------------ | ------- | --------------------------------------------------------------------------------------- |
| `IMPORTED`         | **267** | 在本包 `src/script/test` 中有真实 import/require/dynamic-import                         |
| `TYPES`            | **45**  | `@types/*` / `@tsconfig/*`，环境类型或 tsconfig extends                                 |
| `CONFIG`           | **23**  | 仅在 `vite.config.ts` / `.storybook/main.ts` / `bunfig.toml` / `tsconfig.json` 中被引用 |
| `BINARY`           | **16**  | 在 package.json `scripts` 中通过 CLI 调用（`tsgo`、`electron-vite`、`tsc`）             |
| `DEAD(bin-unused)` | **9**   | 包带 bin 但无任何 script 调用（多为 tsgo 迁移后的 `typescript` 残留）                   |
| **`DEAD`**         | **70**  | **无 import、无 script、无 config 引用**                                                |

### 1.2 确认死声明清单（按包分组）

以下依赖经**全仓库**边界词检索（排除 `node_modules`/`dist`/`storybook-static`/`.turbo`/`out`/`.worktrees`/`bun.lock`/`package.json`/`*.min.js`）确认**零真实引用**。

#### `packages/aigcfroge` (18 条)

| 依赖                                      | 版本    | 类型   | 备注                                                                              |
| ----------------------------------------- | ------- | ------ | --------------------------------------------------------------------------------- |
| `@gitlab/opencode-gitlab-auth`            | 1.3.3   | dep    | 实际使用的是**另一个包** `opencode-gitlab-auth@2.1.0`（`src/plugin/index.ts:16`） |
| `@openauthjs/openauth`                    | catalog | dep    | 零引用                                                                            |
| `@opentelemetry/api`                      | 1.9.0   | dep    | 真实引用在 `packages/core/src/observability/otlp.ts:61`                           |
| `@opentelemetry/context-async-hooks`      | 2.6.1   | dep    | 同上，属 core                                                                     |
| `@opentelemetry/exporter-trace-otlp-http` | 0.214.0 | dep    | 同上，属 core                                                                     |
| `@opentelemetry/sdk-trace-base`           | 2.6.1   | dep    | 同上，属 core                                                                     |
| `@opentelemetry/sdk-trace-node`           | 2.6.1   | dep    | **全仓零引用**                                                                    |
| `@pierre/diffs`                           | catalog | dep    | 真实引用在 app / session-ui / ui                                                  |
| `@solid-primitives/event-bus`             | 1.1.2   | dep    | 真实引用在 app (`context/server-sdk.tsx:3`)                                       |
| `@solid-primitives/scheduled`             | 1.5.2   | dep    | 真实引用在 app (`pages/session.tsx:21`)；且版本与 app 的 1.5.3 **漂移**           |
| `@standard-schema/spec`                   | 1.0.0   | dep    | 零引用；**同一文件内重复声明**（`package.json:37` 与 `:107`）                     |
| `@zip.js/zip.js`                          | 2.7.62  | dep    | 真实引用在 desktop (`src/main/logging.ts`)                                        |
| `chokidar`                                | 4.0.3   | dep    | 零引用                                                                            |
| `immer`                                   | 11.1.4  | dep    | 真实引用在 core / session-ui / tui / ui                                           |
| `minimatch`                               | 10.2.5  | dep    | 真实引用在 core (`src/util/glob.ts`)                                              |
| `partial-json`                            | 0.1.7   | dep    | 零引用                                                                            |
| `@babel/core`                             | 7.28.4  | devDep | 真实引用在 app (`solid-jsx-plugin.ts:3`)                                          |
| `@standard-schema/spec`                   | 1.0.0   | devDep | 与上方 dep 重复                                                                   |

> 另有 `glob@13.0.5`、`xdg-basedir@5.1.0`、`@parcel/watcher@2.5.1` 声明于 aigcfroge，真实引用在 `packages/core`（`src/util/glob.ts`、`src/global.ts`、`src/filesystem/watcher.ts`）——属**错位声明**而非死声明。

#### `packages/app` (7 条)

`@shikijs/transformers@catalog`、`@solid-primitives/active-element@2.1.3`、`@solid-primitives/audio@1.4.2`、`@solid-primitives/scroll@2.1.3`、`@solid-primitives/websocket@1.3.1`、`marked-shiki@catalog`（真实引用在 ui）、`solid-list@catalog`（真实引用在 ui）、`vite-plugin-icons-spritesheet@3.0.1`（真实引用在 ui/vite.config.ts）。

#### `packages/core` (9 条)

`@parcel/watcher-{darwin-arm64,darwin-x64,linux-arm64-glibc,linux-arm64-musl,linux-x64-glibc,linux-x64-musl,win32-arm64,win32-x64}@2.5.1` — 8 个平台二进制包，**全部零引用**（真正被 import 的是 `@parcel/watcher` 本体，位于 `packages/core/src/filesystem/watcher.ts`，而它声明在 aigcfroge）。另 `ignore@7.0.5` 真实引用在 aigcfroge（`src/server/routes/.../file.ts`）。

#### `packages/desktop` (5 条)

`@actions/artifact@4.0.0`（**版本漂移**：根声明 5.0.1）、`@solidjs/meta@catalog`（真实引用在 app/storybook/ui）、`@valibot/to-json-schema@1.6.0`、`sury@11.0.0-alpha.4`、`zod-openapi@5.4.6` — 后三者**零引用**。

#### `packages/http-recorder` (1 条)

`@effect/platform-node-shared@4.0.0-beta.83` — 零引用（同包内 `@effect/platform-node` 有引用）。

#### `packages/session-ui` (11 条)

`@shikijs/transformers@catalog`、`@solid-primitives/bounds@0.1.3`、`@solidjs/meta@catalog`、`fuzzysort@catalog`、`luxon@catalog`、`marked-katex-extension@5.1.6`、`marked-shiki@catalog`、`remeda@catalog`、`solid-list@catalog`、`katex@0.16.27`、`vis-network@10.1.0`。

> ⚠️ **重要例外（非死声明）**：`chart.js@4.5.1` 与 `vis-network@10.1.0` 在 `packages/session-ui/src/components/chart-libs.ts:3-4` 通过**相对路径** `../../../../node_modules/...` 直接读入原始 JS 文本（`?raw` 内联注入），**不经过包名解析**。这解释了为什么 `vis-network` 在此被标记，但它是**真实运行时依赖**（79.4 MB，见 §6）。`chart.js` 同理。这两个**不是死声明**，但用相对路径穿透 `node_modules` 是脆弱写法。

#### `packages/ui` (12 条)

`@shikijs/transformers@catalog`、`@solid-primitives/bounds@0.1.3`、`@solid-primitives/media@2.3.3`（真实引用在 app/session-ui）、`@solidjs/router@catalog`（真实引用在 app/desktop/session-ui）、`@shikijs/stream@catalog`（真实引用在 session-ui）、`diff@catalog`（真实引用在 aigcfroge/app/session-ui/tui）、`luxon@catalog`（真实引用在 app）、`morphdom@2.7.8`（真实引用在 session-ui）、`motion-dom@12.34.3`、`motion-utils@12.29.2`、`remend@catalog`（真实引用在 session-ui）、`strip-ansi@7.1.2`（真实引用在 aigcfroge/session-ui/tui）。

> ⚠️ `motion-dom` / `motion-utils` 是 `motion@12.34.5` 的**传递依赖**，ui 同时显式声明了 `motion` 本体（`components/motion-spring.tsx:1`）。显式声明 `motion-dom`/`motion-utils` 属冗余。
> ⚠️ `tailwindcss@catalog` 在 ui 中仅通过 `src/styles/tailwind/index.css:3-4` 的 CSS `@import` 使用 — **这是合法用法**，非死声明。

#### 其它包

`packages/effect-drizzle-sqlite`、`effect-sqlite-node`、`llm`、`schema`、`server`、`tui`：各 1 条（`@typescript/native-preview`，实为 BINARY，见下）。`packages/storybook`、`packages/plugin`、`packages/sdk/js`：`typescript@catalog`（storybook 用 `storybook build`，plugin 用 `tsc` 构建）。

### 1.3 二值化：工具链依赖**不是**死声明（明确区分）

以下依赖**无源码 import**，但属**合法 binary/config 用法**，**不计入死声明**：

| 依赖                                | 使用方式                  | 证据                                              |
| ----------------------------------- | ------------------------- | ------------------------------------------------- |
| `@typescript/native-preview`        | `tsgo` 二进制             | 15 个包的 `typecheck: tsgo --noEmit`；`.bin/tsgo` |
| `typescript`                        | `tsc` 二进制（仅 plugin） | `packages/plugin/package.json` `build: tsc`       |
| `vite`                              | `electron-vite` 二进制    | `packages/desktop` `build/preview`                |
| `@tsconfig/bun`, `@tsconfig/node22` | tsconfig `extends`        | 各包 `tsconfig.json`                              |
| `@storybook/addon-*`                | `.storybook/main.ts` 注册 | `packages/storybook/.storybook/main.ts`           |
| `happy-dom`                         | `bunfig.toml` preload     | `packages/session-ui/bunfig.toml`                 |
| `tailwindcss`, `@tailwindcss/vite`  | CSS `@import` + vite 插件 | `ui/src/styles/tailwind/index.css`, `app/vite.js` |
| `@types/*` (45 条)                  | 环境类型                  | 无需显式 import                                   |

**`DEAD(bin-unused)`（9 条，建议复核）**：这些包带 bin 但无 script 调用，多为 `tsgo` 迁移后残留的 `typescript`：

- `packages/{desktop,http-recorder,storybook,ui,sdk/js}/package.json` → `typescript`（desktop 还固定了 `~5.6.2`，与 catalog 的 `5.8.2` 冲突）
- `packages/aigcfroge` → `why-is-node-running@3.2.2`
- `packages/core` → `semver@^7.6.3`
- `packages/session-ui` → `katex@0.16.27`

### 1.4 错位声明（Declared-here, imported-elsewhere）

**50 条**依赖声明在 A 包，却只被 B 包 import。这是本次审计中最成体系的卫生问题——**`packages/aigcfroge` 与 `packages/ui` 被当作"依赖垃圾桶"**。

典型（完整 50 条见复现脚本 `/tmp/crosspkg.ts`）：

| 依赖                                                                               | 声明于         | 实际 import 于                     |
| ---------------------------------------------------------------------------------- | -------------- | ---------------------------------- |
| `@opentelemetry/{api,context-async-hooks,exporter-trace-otlp-http,sdk-trace-base}` | aigcfroge      | core (`src/observability/otlp.ts`) |
| `@parcel/watcher`                                                                  | aigcfroge      | core (`src/filesystem/watcher.ts`) |
| `glob`                                                                             | aigcfroge      | core (`src/util/glob.ts`)          |
| `minimatch`                                                                        | aigcfroge      | core (`src/util/glob.ts`)          |
| `xdg-basedir`                                                                      | aigcfroge      | core (`src/global.ts`)             |
| `immer`                                                                            | aigcfroge      | core / session-ui / tui / ui       |
| `ignore`                                                                           | core           | aigcfroge                          |
| `@zip.js/zip.js`                                                                   | aigcfroge      | desktop (`src/main/logging.ts`)    |
| `@babel/core`                                                                      | aigcfroge      | app (`solid-jsx-plugin.ts`)        |
| `@pierre/diffs`                                                                    | aigcfroge      | app / session-ui / ui              |
| `morphdom`, `remend`, `@shikijs/stream`                                            | ui             | session-ui                         |
| `katex`, `marked-katex-extension`, `marked-shiki`, `solid-list`                    | session-ui     | ui                                 |
| `diff`                                                                             | ui             | aigcfroge / app / session-ui / tui |
| `luxon`                                                                            | ui, session-ui | app                                |
| `@solidjs/router`                                                                  | ui             | app / desktop / session-ui         |
| `vite-plugin-icons-spritesheet`                                                    | app            | ui (`vite.config.ts`)              |

> 根因：`packages/aigcfroge` 作为入口包，历史上把所有下游依赖平铺进来；后续模块被拆到 core/ui 后，声明未随之迁移。这直接导致 §6 中 electron/desktop 依赖被根级安装。

---

## 2. 跨包重复声明与版本漂移

### 2.1 Catalog 使用现状

- Catalog 条目：**64**
- 通过 `catalog:` 被引用的条目：**56**（含 6 条仅经 `overrides` 引用）
- **从未被任何包引用**：**8 条**

| 未被引用的 catalog 条目     | 值                                          |
| --------------------------- | ------------------------------------------- |
| `@npmcli/arborist`          | 9.4.0                                       |
| `@hono/standard-validator`  | 0.2.0                                       |
| `@hono/zod-validator`       | 0.4.2                                       |
| `@cloudflare/workers-types` | 4.20251008.0                                |
| `dompurify`                 | 3.4.6                                       |
| `semver`                    | 7.7.4                                       |
| `sst`                       | 4.13.1                                      |
| `@solidjs/start`            | `https://pkg.pr.new/@solidjs/start@dfb2020` |

### 2.2 字面版本重复声明（可收敛到 catalog）

**114 个依赖**在 2+ 个 package.json 中以**字面版本**声明。其中 **67 个不在 catalog 中**——这是可立即收敛的部分。典型簇：

- `@ai-sdk/*` 全家桶（18 个包）在 `aigcfroge` 与 `core` 中重复声明同一版本
- `@opentelemetry/*`（4 个）在 aigcfroge 与 core 重复
- `@solid-primitives/*`（event-listener、media、resize-observer 等）在 app/session-ui/ui 三处重复
- `strip-ansi@7.1.2` 在 4 个包中重复（**未进 catalog**）

### 2.3 版本漂移（Version Drift）— 最高价值发现

**同一依赖在不同包中锁定不同字面版本**，共 **4 组**：

| 依赖                                | 版本 A                | 版本 B                               | 风险                                                                  |
| ----------------------------------- | --------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| `@actions/artifact`                 | **5.0.1** (根)        | **4.0.0** (desktop)                  | ⚠️ 高：CI 产物上传行为可能不一致；`bun.lock` 显示两个版本**同时安装** |
| `@solid-primitives/resize-observer` | **2.1.5** (app)       | **2.1.3** (session-ui, ui)           | ⚠️ 中：同一 UI 组件库内 resize 行为不一致                             |
| `@solid-primitives/scheduled`       | **1.5.2** (aigcfroge) | **1.5.3** (app)                      | ⚠️ 中：`debounce` 语义可能不同                                        |
| `semver`                            | **^7.6.0** (根)       | **^7.6.3** (aigcfroge, core, script) | 低：均为 range，但 catalog 已固定 7.7.4 却未被采用                    |

**Catalog 被字面版本架空（9 组）**——catalog 有定义，但个别包仍写字面版本，形成双真源：

| 依赖                    | catalog 值    | 字面覆盖                           |
| ----------------------- | ------------- | ---------------------------------- |
| `typescript`            | 5.8.2         | `~5.6.2` (desktop)                 |
| `marked`                | 17.0.1        | `^15` (desktop)                    |
| `semver`                | 7.7.4         | `^7.6.0` (根)、`^7.6.3` (×3)       |
| `@tsconfig/bun`         | 1.0.9         | `1.0.9` (app，字面等于 catalog 值) |
| `@types/semver`         | 7.7.1         | `^7.5.8` (×2)                      |
| `@babel/core`           | 7.28.4        | `7.28.4` (aigcfroge)               |
| `fuzzysort`             | 3.1.0         | `3.1.0` (×2)                       |
| `@effect/platform-node` | 4.0.0-beta.83 | `4.0.0-beta.83` (http-recorder)    |
| `@solidjs/router`       | 0.15.4        | `0.15.4` (desktop)                 |

> `marked` 的 `^15` vs catalog `17.0.1` 是**跨大版本**漂移，desktop 与 app/session-ui/ui 使用不同 major 的 Markdown 解析器。

### 2.4 `@effect/*` 版本一致性（专项）

`effect` 在 **12 个包**中以 `catalog:` 声明（一致），但 `packages/http-recorder` 同时以**字面** `4.0.0-beta.83` 声明 `effect`（peerDependencies）与 `@effect/platform-node`（dependencies）。值恰好相同，**当前无实际漂移**，但绕过了 catalog 单一真源；未来 catalog 升级时 http-recorder 会被落下。

---

## 3. 补丁负担（Patch Burden）

### 3.1 事实校正

**根 `package.json` 的 `patchedDependencies` 是 11 条，不是 12 条。**

`bun.lock:667-676` 的 `patchedDependencies` 只记录了 **8 条**，比根 package.json **少 3 条**（`@ff-labs/fff-bun@0.9.3`、`gcp-metadata@8.1.2`、`pacote@21.5.0`）——因为这三个补丁的目标版本已不在 lockfile 中（见 3.3）。

### 3.2 逐补丁明细

| #   | 补丁文件                                   | 行数    | 改动文件 | hunk | +/-      | 内容摘要                                                                                            |
| --- | ------------------------------------------ | ------- | -------- | ---- | -------- | --------------------------------------------------------------------------------------------------- |
| 1   | `@modelcontextprotocol%2Fsdk@1.29.0.patch` | **427** | 8        | 19   | +175/-67 | 重载 `callTool` 泛型签名，修正 streamableHttp/protocol 的响应处理                                   |
| 2   | `@silvia-odwyer%2Fphoton-node@0.3.4.patch` | **285** | 1        | 10   | +45/-43  | wasm-bindgen 胶水层：`module.exports` → 独立 `__wbindgen_placeholder__` 对象（修复 ESM/CJS 互操作） |
| 3   | `@pierre%2Ftrees@1.0.0-beta.4.patch`       | 107     | 4        | 8    | +21/-5   | `#emit()` 透传 mutation event，供上层感知树变更                                                     |
| 4   | `@ai-sdk%2Fgoogle@3.0.73.patch`            | 69      | 5        | 5    | +17/-0   | 空 parts 的 content 出栈，避免 Google API 400                                                       |
| 5   | `solid-js@1.9.10.patch`                    | 58      | 6        | 4    | +8/-0    | Transition 首次计算时同步 `node.value`（对应上游 issue **#2046**）                                  |
| 6   | `@tanstack%2Fvirtual-core@3.17.0.patch`    | 58      | 5        | 5    | +6/-0    | 新增 `getLogicalScrollOffset`（含 `scrollAdjustments`）                                             |
| 7   | `@tanstack%2Fsolid-virtual@3.13.28.patch`  | 45      | 3        | 3    | +9/-3    | 用 `_willUpdate()` + reconcile 替代 `measure()`                                                     |
| 8   | `@ff-labs%2Ffff-bun@0.9.3.patch`           | 31      | 1        | 2    | +4/-8    | 改为直接 `require("@ff-labs/fff-bin-*")` 解析二进制路径                                             |
| 9   | `pacote@21.5.0.patch`                      | 18      | 1        | 1    | +5/-2    | git tarball 失败时回退到 clone（识别 `TAR_*` 与 4xx/5xx）                                           |
| 10  | `gcp-metadata@8.1.2.patch`                 | 14      | 1        | 1    | +4/-0    | `AggregateError` 直接返回 false，避免非 GCP 环境误报 warning                                        |
| 11  | `@npmcli%2Fagent@4.0.2.patch`              | 13      | 1        | 1    | +1/-1    | `this.#proxy.toString()` 修复代理 URL 序列化                                                        |

**补丁总 LOC = 1125**（`cat patches/*.patch | wc -l`）

### 3.3 🔴 高危：3 个补丁已失效（Stale Patches）

通过**标记串比对已安装文件**验证（脚本 `/tmp/verify_patches.ts`）：8/11 补丁的插入标记存在于 `node_modules`，**3 个不存在**：

| 补丁                             | 目标版本 | 实际安装版本 | 标记存在？ | 结论                                                                                                                      |
| -------------------------------- | -------- | ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@ff-labs%2Ffff-bun@0.9.3.patch` | 0.9.3    | **0.9.4**    | ❌         | `0.9.4` 的 `src/download.ts` 仍是原始的 `createRequire` 写法 → **补丁未生效**                                             |
| `gcp-metadata@8.1.2.patch`       | 8.1.2    | **8.1.3**    | ❌         | `8.1.3` 上游已自行处理 `AggregateError`（`build/src/index.js:335` 有 `e.name === 'AggregateError'` 分支）→ **上游已修复** |
| `pacote@21.5.0.patch`            | 21.5.0   | **21.5.1**   | ❌         | `lib/git.js:258` 仍是 `er.constructor.name.match(/^Http/)` → **补丁未生效**                                               |

**判定**：

- `gcp-metadata@8.1.2` 补丁 = **确定的上游已修复**（可删除，且 catalog/依赖应升到 8.1.3）
- `@ff-labs/fff-bun@0.9.3`、`pacote@21.5.0` = **版本脱靶**。补丁仍在 `package.json` 中登记，但 `bun install` 已装到 .4/.1，补丁**静默失效**。这两条是"僵尸补丁"——占用维护注意力，却不产生任何效果。需确认 0.9.4/21.5.1 是否已包含同等修复；若未包含，则**修复已丢失**，属功能性回归风险。

### 3.4 补丁 × 使用度矩阵

| 补丁                               | 源码引用文件数 | 判定                                           |
| ---------------------------------- | -------------- | ---------------------------------------------- |
| `solid-js@1.9.10`                  | **452**        | 核心依赖，补丁必要                             |
| `@ai-sdk/google@3.0.73`            | 18             | 高频，必要                                     |
| `@modelcontextprotocol/sdk@1.29.0` | 11             | 必要（427 行，最重）                           |
| `@silvia-odwyer/photon-node@0.3.4` | 4              | 必要（285 行）                                 |
| `@ff-labs/fff-bun@0.9.4`           | 2              | 必要，但**补丁已失效**                         |
| `@pierre/trees@1.0.0-beta.4`       | 2              | 必要                                           |
| `@tanstack/solid-virtual@3.13.28`  | 1              | 必要                                           |
| `@npmcli/agent@4.0.2`              | **0**          | 传递依赖（经 `pacote`），补丁有效              |
| `gcp-metadata@8.1.2`               | **0**          | 传递依赖，**上游已修复，可删**                 |
| `pacote@21.5.0`                    | **0**          | 传递依赖，**补丁已失效**                       |
| `@tanstack/virtual-core@3.17.0`    | **0**          | `@tanstack/solid-virtual` 的传递依赖，补丁有效 |

> `@tanstack/solid-virtual@3.13.28` 与 `@tanstack/virtual-core@3.17.0` 是**成对补丁**（前者调用后者新增的 `getLogicalScrollOffset`）。二者必须同进同退——若只升级其中一个，`solid-virtual` 会调用不存在的 API。

---

## 4. 内联（Vendored）包分析

`ARCHITECTURE.md:179-186`（§4.8）称 `packages/effect-drizzle-sqlite` 为 "vendored"。

### 4.1 `packages/effect-drizzle-sqlite`

| 项                 | 值                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 是否 npm 包的 fork | **部分是**。它不是单一上游包的分支，而是**把上游 `drizzle-orm` 的 PostgreSQL Effect 适配器手工移植到 SQLite**                                                                                       |
| 上游参照           | `drizzle-orm@1.0.0-rc.2`。上游**已提供** `pg-core/effect/*`（`session.js` 149 行）与 `effect-core/*`，但**没有** `sqlite-core/effect/*`                                                             |
| 验证               | `node_modules/drizzle-orm/package.json` 的 `exports` 中 `sqlite`+`effect` 组合键为 **NONE**；`pg-core/effect` 存在                                                                                  |
| 上游引用方式       | 全部通过**公开子路径**导入 `drizzle-orm/effect-core`、`/entity`、`/relations`、`/sqlite-core/dialect` 等，**不是** copy-paste 上游源码                                                              |
| 本地规模           | **3232 行**（18 个 .ts 文件）；核心 `sqlite-core/effect/session.ts` 490 行                                                                                                                          |
| 本地适配层         | `src/up-migrations/{effect-sqlite,sqlite,utils}.ts`（400 行）是**纯本地新增**，上游无对应物                                                                                                         |
| NOTICE / LICENSE   | ❌ **无** LICENSE、无 NOTICE、无上游 copyright 声明                                                                                                                                                 |
| 自行声明           | `AGENTS.md` 明说 "vendors a Drizzle Effect SQLite adapter"、"Preserve Drizzle adapter naming and behavior where possible so this can be **replaced by upstream `drizzle-orm/effect-sqlite` later**" |
| 门禁豁免           | `ARCHITECTURE.md:115` 声明其 `oxlint-disable`d、豁免 `as any`/lint 门禁；`session.ts:1` 确有 `/* oxlint-disable */`                                                                                 |

**能否用上游 npm 包替代？** **目前不能。** 上游 `drizzle-orm@1.0.0-rc.2` 尚未发布 SQLite 的 Effect 适配器。该包的存在是**上游能力缺口**的填补，而非重复造轮子。但：

- 缺 LICENSE/NOTICE 是**合规风险**（`pg-core/effect` 的结构被大量参照，`package.json` 的 `license: MIT` 只覆盖自有代码）
- 应当**跟踪上游**：一旦 `drizzle-orm` 发布 `sqlite-core/effect`，此包可整体删除（约 3232 行 + 豁免门禁的负担）

### 4.2 `packages/effect-sqlite-node`

| 项                 | 值                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 是否 npm 包的 fork | **是** — `@effect/sql-sqlite-node@4.0.0-beta.83` 的**改写版**                                                                                                                                               |
| 验证               | 从 npm 下载 `4.0.0-beta.83` tarball 比对：上游 `src/SqliteClient.ts` **312 行** + `src/SqliteMigrator.ts` **90 行** = 417 行                                                                                |
| 本地规模           | **168 行**（单文件 `src/index.ts`）                                                                                                                                                                         |
| 关键差异           | 上游依赖 **`better-sqlite3@^12.9.0`**（原生扩展）；本地改用 **Node 内置 `node:sqlite` 的 `DatabaseSync`**，因此**去掉了原生依赖**                                                                           |
| 代码同源证据       | 两者均含完全相同的 `const ATTR_DB_SYSTEM_NAME = "db.system.name"`、`import { identity } from "effect/Function"`、`classifySqliteError` 用法、相同的 `Context.Service` 类型 ID 模式 — 本地显然由上游改写而来 |
| 上游可用性         | ✅ `@effect/sql-sqlite-node@4.0.0-beta.83` **在 npm 上存在**（443 个版本，含 beta.83；最新 rc.117）                                                                                                         |
| NOTICE / LICENSE   | ❌ **无** LICENSE、无 NOTICE、无上游 copyright 声明                                                                                                                                                         |
| 消费者             | `packages/core/package.json:83` 声明为 `workspace:*` — 但**全仓库无任何 `import`**（`rg "@aigcfroge/effect-sqlite-node"` 仅命中自身 `src/index.ts` 与两个 package.json）                                    |

**能否用上游 npm 包替代？** **技术上可以，但语义不等价**：

- 上游用 `better-sqlite3`（需 `trustedDependencies` + 原生编译，`root package.json` 已列 `node-pty` 等），本包用 `node:sqlite`（Node 22+ 内置，零原生依赖）。这是**有意的设计取舍**，不是偶然分叉。
- ⚠️ **该包当前是死代码**：唯一引用者是 `packages/core/package.json:83` 的声明，`core/src` 中**零 import**。要么接线，要么删除（168 行 + 一个 workspace 包 + 无 LICENSE 的合规面）。

### 4.3 `packages/http-recorder`

| 项        | 值                                                                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 是否 fork | **不是** — 原创实现                                                                                                                                                                                         |
| 证据      | `package.json` 有独立 `repository`（指向 `keerzzz/AigcForge`）、`homepage`、`bugs`、`publishConfig.access: public`、`engines.node >= 22`；`README.md` 标题为 `@aigcfroge/http-recorder`                     |
| LICENSE   | ✅ 有 `LICENSE`，但 copyright 行为 **"Copyright (c) 2025 opencode"** —— 说明该包源自 **opencode** 项目，是**上游项目内部的原创包**，而非第三方 npm 包的分叉                                                 |
| 规模      | 13 个 src 文件（cassette/recorder/matching/redaction/socket/websocket 等）                                                                                                                                  |
| 消费者    | ✅ 真实使用：`packages/llm/test/{recorded-websocket,recorded-test,recorded-golden}.ts`、`packages/core/test/session-runner-recorded.test.ts`、`packages/aigcfroge/test/session/llm-native-recorded.test.ts` |
| 版本引用  | 有 `script/build.ts` + `script/verify-package.ts`，具备独立发包能力                                                                                                                                         |

**能否用上游 npm 包替代？** **不适用** — 它不是任何 npm 包的分叉，而是本仓库自有的测试基础设施。README 自称 "Public beta"，`@aigcfroge/http-recorder@beta` 是可发布形态。

---

## 5. Catalog 版本漂移风险

### 5.1 预发布版本统计

**Catalog 共 64 条：9 条 prerelease / RC / beta，54 条 stable，1 条非 registry 源。**

**预发布清单（9 条，占 14.1%）**：

| 条目                         | 版本                   | 类型            |
| ---------------------------- | ---------------------- | --------------- |
| `effect`                     | `4.0.0-beta.83`        | beta            |
| `@effect/opentelemetry`      | `4.0.0-beta.83`        | beta            |
| `@effect/platform-node`      | `4.0.0-beta.83`        | beta            |
| `@effect/sql-sqlite-bun`     | `4.0.0-beta.83`        | beta            |
| `drizzle-orm`                | `1.0.0-rc.2`           | RC              |
| `drizzle-kit`                | `1.0.0-rc.2`           | RC              |
| `@typescript/native-preview` | `7.0.0-dev.20251207.1` | dev（带日期戳） |
| `@openauthjs/openauth`       | `0.0.0-20250322224806` | 0.0.0 + 时间戳  |
| `@lydell/node-pty`           | `1.2.0-beta.12`        | beta            |

**非 registry 源（1 条）**：

| 条目             | 值                                          |
| ---------------- | ------------------------------------------- |
| `@solidjs/start` | `https://pkg.pr.new/@solidjs/start@dfb2020` |

### 5.2 风险评估

- **`effect@4.0.0-beta.83` 是最深的耦合点**：12 个包声明 `catalog:`，另有 `packages/http-recorder` 以字面 peer 固定。上游已发到 `rc.117`，仓库落后 **34 个 prerelease**。升级需同步 `@effect/platform-node`、`@effect/sql-sqlite-bun`、`@effect/opentelemetry` 与 `packages/effect-drizzle-sqlite`（对照 `effect/unstable/*` API）。
- **`drizzle-orm@1.0.0-rc.2` + `effect-drizzle-sqlite` 是第二个耦合点**：`effect-drizzle-sqlite` 手工对齐 rc.2 的**内部**结构（`drizzle-utils.ts` 明确是 "local typed shims for Drizzle runtime internals that RC2 does not expose in declarations"）。RC 迭代会直接击穿这个 shim。
- **`@typescript/native-preview@7.0.0-dev.20251207.1`**：日期戳版本，`tsgo` 是全部 15 个包 `typecheck` 的唯一执行器——单点。
- **`@solidjs/start` 指向 `pkg.pr.new`**：该条目**从未被任何包引用**（§2.1），是纯残留；但它保留了一个**非 registry 供应链入口**，应删除。
- **`@lydell/node-pty@1.2.0-beta.12`**：在 `root package.json` 的 `trustedDependencies` 中，且 `postinstall` 会执行 `bun run --cwd packages/core fix-node-pty`——原生模块 + beta 版本，风险集中。

> 说明：以上为**耦合度与升级成本**评估，不构成"存在已知 CVE"的断言——本次审计未做漏洞库比对。

---

## 6. 最重的依赖树（Top 25）

### 6.1 🔴 首要发现：3.56 GB 孤儿目录

`node_modules` 总计 **6.51 GB**，但构成极不健康：

| 组成                                          | 大小        | 占比      | 性质                           |
| --------------------------------------------- | ----------- | --------- | ------------------------------ |
| `node_modules/.old_modules-06e0d6613b43bf43/` | **3.56 GB** | **54.7%** | 🔴 **孤儿/陈旧安装树，零引用** |
| `node_modules/.bun/`                          | 2.41 GB     | 37.0%     | 正常（Bun 硬链接 store）       |
| 其余实际包                                    | 0.54 GB     | 8.3%      | 正常                           |

**证据**：

- `du -sk node_modules/.old_modules-06e0d6613b43bf43` = 3,730,649 KB
- 内含 **1320 个顶层条目**，与现役 `node_modules` 的 959 个**高度重叠**（`@anthropic-ai` 527 MB、`@openai` 349.7 MB、`electron` 309.5 MB 在两边各存一份）
- 全仓库检索 `old_modules` **零引用**（配置文件、脚本、git 均无）
- `.gitignore:2` 的 `node_modules` 规则使其被忽略——因此**不会被 `git clean` 或代码审查发现**，静默占用磁盘

> 删除该目录可立即回收 **3.56 GB（-54.7%）**。这是本次审计**成本最低、收益最高**的单项动作。

### 6.2 Top 25 最重包

（按 `du -sk` 实测，剔除 `@scope` 聚合行与 `.bun` store）

| #   | 包                                              | 大小         | 构建期 / 运行时                                                                   |
| --- | ----------------------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| 1   | `@openai/codex-linux-x64`                       | **349.6 MB** | **构建期/工具**（`@openai/codex-sdk` 的预编译二进制，`core` 依赖）                |
| 2   | `electron`                                      | **309.5 MB** | **构建期**（`desktop` devDep `42.3.3`，打包用）                                   |
| 3   | `@anthropic-ai/claude-agent-sdk-linux-x64`      | **262.3 MB** | **构建期/工具**（平台二进制）                                                     |
| 4   | `@anthropic-ai/claude-agent-sdk-linux-x64-musl` | **257.2 MB** | **构建期，且本机不可用**（glibc 主机上的 musl 变体）                              |
| 5   | `mermaid`                                       | **86.4 MB**  | **运行时**（ui/session-ui Markdown 图表）                                         |
| 6   | `vis-network`                                   | **79.4 MB**  | **运行时**（session-ui `chart-libs.ts` 内联注入）                                 |
| 7   | `@protobuf-ts/plugin`                           | **53.5 MB**  | **构建期**（protobuf 代码生成）                                                   |
| 8   | `@opencode-ai/plugin`                           | **46.7 MB**  | **传递依赖**（经 `@gitlab/opencode-gitlab-auth` 拉入；该包本身是死声明，见 §1.2） |
| 9   | `drizzle-kit`                                   | **46.5 MB**  | **构建期**（迁移生成 CLI）                                                        |
| 10  | `effect`                                        | **46.0 MB**  | **运行时**（12 个包核心依赖）                                                     |
| 11  | `@turbo/linux-64`                               | **35.5 MB**  | **构建期**（turbo 二进制）                                                        |
| 12  | `@bufbuild/protoplugin`                         | **31.5 MB**  | **构建期**（protobuf）                                                            |
| 13  | `electron-winstaller`                           | **28.9 MB**  | **构建期**（Windows 安装包，Linux 上无用）                                        |
| 14  | `@oxlint-tsgolint/linux-x64`                    | **27.7 MB**  | **构建期**（lint）                                                                |
| 15  | `@typescript/native-preview-linux-x64`          | **22.3 MB**  | **构建期**（`tsgo`）                                                              |
| 16  | `typescript`                                    | **22.1 MB**  | **构建期**                                                                        |
| 17  | `drizzle-orm`                                   | **21.6 MB**  | **运行时**                                                                        |
| 18  | `@sentry/cli-linux-x64`                         | **20.4 MB**  | **构建期**（sourcemap 上传）                                                      |
| 19  | `ai-gateway-provider`                           | **20.3 MB**  | **运行时**（LLM provider）                                                        |
| 20  | `tree-sitter-bash`                              | **20.1 MB**  | **运行时**（shell 工具 WASM 语法）                                                |
| 21  | `storybook`                                     | **20.0 MB**  | **构建期**                                                                        |
| 22  | `vis-data`                                      | **17.3 MB**  | **运行时**（`vis-network` 传递依赖）                                              |
| 23  | `@azure/storage-blob`                           | **16.7 MB**  | **构建期**（经 `@actions/artifact` 拉入；该包在 desktop 是死声明）                |
| 24  | `vis-util`                                      | **15.3 MB**  | **运行时**（`vis-network` 传递依赖）                                              |
| 25  | `happy-dom`                                     | **14.5 MB**  | **构建期/测试**（session-ui 测试环境）                                            |

### 6.3 尺寸结构观察

- **构建期工具占绝对主导**：Top 25 中 16 个为构建期，合计约 **1.44 GB**
- **纯浪费可回收**：
  - `.old_modules` 孤儿树 — **3.56 GB**
  - musl 变体（glibc 主机上不可用）— **0.30 GB**（10 个包，最大是 `claude-agent-sdk-linux-x64-musl` 257 MB）
  - `@opencode-ai/plugin` 46.7 MB + `@azure/storage-blob` 16.7 MB — 均由**死声明**引入
- **运行时实际负载**：`effect` + `drizzle-orm` + `mermaid` + `vis-network` + `ai-gateway-provider` + `tree-sitter-*` ≈ **290 MB**，仅占 6.51 GB 的 **4.5%**

---

## 7. 结论：三个最严重的依赖卫生问题（按成本排序）

### 🥇 第一：3.56 GB 孤儿安装树（`node_modules/.old_modules-06e0d6613b43bf43`）

**成本 = 磁盘 54.7% + 诊断噪音。** 全仓库零引用，被 `.gitignore` 掩盖，1320 个条目与现役树重复。它同时污染了本次审计的基线——任务给定的 "6.6 GB" 中有一半以上是这个死目录。**一个 `rm -rf` 即可回收 3.56 GB。** 这也解释了为什么 `node_modules` 尺寸与 `.bun`(1407 包) 的合理预期严重不符。

### 🥈 第二：70 条死声明 + 50 条错位声明（依赖图失真）

**成本 = 安装体积 + 供应链面 + 升级不可推理。** 70 条死声明中，`@opentelemetry/sdk-trace-node`、`chokidar`、`partial-json`、`sury`、`zod-openapi`、`@valibot/to-json-schema`、5 个 `@solid-primitives/*`、`@shikijs/transformers`、`motion-dom`/`motion-utils`、8 个 `@parcel/watcher-<platform>` 等**完全零引用**却仍被安装。更严重的是 50 条**错位声明**：`packages/aigcfroge` 与 `packages/ui` 承担了 core/app/session-ui/desktop 的依赖，导致 `@babel/core`、`@zip.js/zip.js`、`@pierre/diffs`、`glob`、`minimatch`、`@parcel/watcher`、`immer` 等全部从根级解析。这不是"多装几个包"的问题——它使**依赖边界无法用于判断架构层级**，`ARCHITECTURE.md:115` 声明的分层约束在依赖层面已经失效。

### 🥉 第三：3 个僵尸补丁 + 4 组版本漂移（升级路径上的地雷）

**成本 = 隐性功能回归 + 升级时不可预期的破坏。** `patchedDependencies` 声称 11 条，但 `bun.lock` 只记录 8 条——`@ff-labs/fff-bun@0.9.3`、`gcp-metadata@8.1.2`、`pacote@21.5.0` 三条的**目标版本已不在安装树中**。经标记串验证，这三条**全部未生效**：其中 `gcp-metadata` 是上游已自行修复（`8.1.3` 已有 `AggregateError` 分支），可安全删除；而 `@ff-labs/fff-bun`（0.9.4 仍是旧写法）与 `pacote`（21.5.1 仍是 `er.constructor.name.match(/^Http/)`）的**修复已实际丢失**。叠加 4 组版本漂移（`@actions/artifact` 5.0.1 vs 4.0.0、`@solid-primitives/resize-observer` 2.1.5 vs 2.1.3、`@solid-primitives/scheduled` 1.5.2 vs 1.5.3、`semver` 三值）与 catalog 被 9 组字面版本架空（含 `marked` 的 `^15` vs `17.0.1` 跨大版本），升级 `effect@4.0.0-beta.83`→`rc.117` 或 `drizzle-orm` 时，这些不一致会以难以定位的运行时行为差异形式暴露。

---

## 附录：复现脚本与证据文件

| 产物             | 路径                                                                              | 用途               |
| ---------------- | --------------------------------------------------------------------------------- | ------------------ |
| 依赖条目统计     | `/tmp/extract2.ts`                                                                | §0 基线校准        |
| 死声明分类       | `/tmp/audit4.ts` → `/tmp/audit4.json`                                             | §1.1 分类总览      |
| 逐包 import 映射 | `/tmp/importmap.ts` → `/tmp/importmap.json`                                       | §1 判定基础        |
| 错位声明矩阵     | `/tmp/crosspkg.ts`                                                                | §1.4（50 条）      |
| 重复/漂移分析    | `/tmp/audit2b.ts`, `/tmp/audit2c.ts`                                              | §2.2–2.3           |
| Catalog 分析     | `/tmp/audit2d.ts`                                                                 | §2.1, §5           |
| 补丁统计         | `/tmp/patchstats.ts`                                                              | §3.2               |
| 补丁生效验证     | `/tmp/verify_patches.ts`                                                          | §3.3（标记串比对） |
| 尺寸实测         | `/tmp/nm_sizes.txt`, `/tmp/nm_scoped.txt`, `/tmp/nm_dot.txt`, `/tmp/nm_total.txt` | §6                 |

**已知方法学局限（不臆测声明）**：

1. **`chart.js` / `vis-network` 的判定**依赖人工识别 `chart-libs.ts:3-4` 的相对路径穿透写法。纯自动化扫描会将其误判为死声明——本报告已人工纠正。
2. **CSS `@import` 用法**（`tailwindcss`）需单独识别，已人工排除。
3. **补丁"上游是否已修复"的判定**仅基于**已安装版本的代码比对**（`gcp-metadata@8.1.3` 明确含 `AggregateError` 处理分支）。对 `@ff-labs/fff-bun@0.9.4` 与 `pacote@21.5.1`，本次**只确认补丁未生效**，**未确认**上游是否已等价修复——需查阅二者 changelog 才能定论。
4. **未做漏洞库比对**（无 `bun audit` 运行），§5 的风险表述限于耦合度与升级成本，不含 CVE 断言。
5. `node_modules` 尺寸测量在 `/media/win_data`（FUSE 挂载）上进行，`du` 单包耗时约 9 秒；`.old_modules` 的 3.56 GB 为 `du -sk` 实测值，非估算。
