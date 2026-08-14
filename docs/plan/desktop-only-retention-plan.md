# 桌面端保留方案 — 调研与实施计划

> 目标：从 AigcForge monorepo 中删除所有非桌面端内容（web / slack / function / enterprise / cli / storybook / vscode 扩展 / GitHub Action / SST 云部署等），仅保留桌面端（Electron）所需的一切。
>
> 状态：调研完成（2025 年，基于 `main` 分支逐文件实测）；**2026-08-14 二次独立复核完成**，结论一致，并修正了 tui 依赖性质这一处错误（见 §1.1 与 §3）
> 性质：只读调研结论 + 待执行计划（本文档撰写时未改动任何文件）

---

## 1. 背景与目标

AigcForge 是一个 22 包 monorepo，产品形态包括：**CLI、终端 TUI、Electron 桌面端** 三个本地入口，以及 web（Astro 文档站）、slack（机器人）、function（Cloudflare Worker）、enterprise（SolidStart 企业站）四个云端部署单元。

用户目标：**只保留桌面端**，删除其他一切端。

### 1.1 核心认知修正（与直觉相反的三点）

1. **`packages/aigcfroge` 不是"CLI 端"，而是桌面端的内置后端（sidecar 服务器本体）**。desktop 的 package.json **未声明**对它的依赖，靠 `../aigcfroge` 相对路径消费其构建产物。误删即断 sidecar，桌面端无法启动。
2. **`packages/server`、`packages/script`、`packages/tui` 也在桌面依赖链上**（aigcfroge 的依赖）。其中 **tui 是 sidecar 的硬运行时依赖，不是可选项**——见 §3 表格修正说明。
3. **`packages/cli` 反而可以删除**：desktop 运行时与构建均不消费它；与其相关的打包代码（`SIDECAR_BINARIES` / `copyBinaryToSidecarFolder` / `AIGCFROGE_CLI_ARTIFACT` / `copy-bundles.ts`）经实测全部是 **dead code**（CI 传入 env 但无人读取，electron-builder 不引用）。

---

## 2. 桌面端真实架构（调研结论）

### 2.1 三个进程模型

| 进程 | 代码位置 | 职责 |
|---|---|---|
| **main** | `packages/desktop/src/main/`（入口 `index.ts`，第二入口 `sidecar.ts`） | 窗口、IPC、菜单、自动更新；fork 本地后端 sidecar（`spawnLocalServer()`） |
| **preload** | `packages/desktop/src/preload/index.ts` | contextBridge 暴露 `window.api`（contextIsolation + sandbox） |
| **renderer** | `packages/desktop/src/renderer/index.tsx` | SolidJS 壳，用 `PlatformProvider` 包住 `@aigcfroge/app` 的 `AppInterface` |

### 2.2 后端 sidecar（关键机制）

- main 进程 `spawnLocalServer()` 以 `utilityProcess` fork `out/main/sidecar.js`；
- `sidecar.ts` 动态 `import("virtual:aigcfroge-server")`，被 electron-vite 插件 `aigcfroge:server-dist` 解析到 **`../aigcfroge/dist/node/node.js`**（`electron.vite.config.ts` 的 `AIGCFROGE_SERVER_DIST`），并把该目录 `.wasm` 拷入 `out/main/chunks`；
- 该 bundle 由 `scripts/prebuild.ts` / `predev.ts` 里的 `cd ../aigcfroge && bun script/build-node.ts` 预构建（入口 `src/node.ts` → 导出 `Server`）；
- sidecar 在 `127.0.0.1` 随机端口起 HTTP 服务（basic auth），renderer 经 `oc://renderer` 协议加载本地 `out/renderer` 再连回本地服务；
- **完全本地运行，与 SST / 云基础设施零关系**；更新走 GitHub Releases。

### 2.3 renderer 如何消费 app

electron-vite 从 **app 源码**打包（renderer 段用 `@aigcfroge/app/vite` 的 appPlugin，`publicDir: "../../../app/public"`），**不是**消费 app 的 dist 产物。desktop 源码另有 16+ 处直接 import `app/src/i18n/*` 与 `ui/src/theme/*`（绕过 exports 的源码级引用，见 §5.4）。

### 2.4 本地构建 / 打包链路

```
prebuild（copy-icons → copy-metainfo → cd ../aigcfroge && bun script/build-node.ts）
  → electron-vite build（main: index+sidecar；preload: cjs；renderer: appPlugin + app/public）
  → electron-builder --config electron-builder.config.ts
      （AIGCFROGE_CHANNEL 分 dev/beta/prod；mac dmg+zip 签名公证、win NSIS Azure 签名、linux AppImage+deb+rpm）
```

### 2.5 发布链路（CI）

`.github/workflows/publish.yml`（唯一桌面发布流）：

```
version → build-cli（CLI 分发，与桌面无关）→ sign-cli-windows → build-electron
  （6 平台矩阵：macOS x64/arm64、Windows x64/arm64、Linux x64/arm64；每平台 prepare→build→electron-builder）
  → publish（script/publish.ts → finalize-latest-json.ts / finalize-latest-yml.ts 合并多架构 latest 文件）
```

**注意**：build-electron job `needs: [build-cli, version]` 是纯依赖关系——CLI 产物实际无人消费（详见 §4.2）。

### 2.6 Nix 支持

- `nix/desktop.nix` + `nix/aigcfroge.nix`（desktop.nix 以 aigcfroge.nix 为基底，`desktop.nix:18-23` inherit 其 version/src/node_modules/patches；而 `aigcfroge.nix:55-57` 构建的是保留链的 `packages/aigcfroge`——**两者都保留**）+ `flake.nix` 输出 `aigcfroge-desktop`；
- CI：`nix-eval.yml`、`nix-hashes.yml`（删包后哈希由 `nix-hashes.yml` 自动重算）。

---

## 3. 必须保留清单（16 个 workspace 包）

实测依赖闭包（比直觉多出 `aigcfroge`、`server`、`tui`、`script`）：

```
desktop（devDeps: @aigcfroge/app, @aigcfroge/ui；隐含相对路径依赖 packages/aigcfroge）
├─ app        → deps: core, sdk, session-ui, ui
│   ├─ session-ui → deps: core, sdk, ui
│   ├─ core       → deps: effect-drizzle-sqlite, effect-sqlite-node, llm, plugin, schema（devDep: http-recorder）
│   │   ├─ llm       → deps: schema（devDep: http-recorder）
│   │   ├─ plugin    → deps: sdk
│   │   ├─ schema    → 无 workspace 依赖
│   │   ├─ effect-drizzle-sqlite / effect-sqlite-node → 无 workspace 依赖
│   ├─ sdk（sdk/js）→ 无 workspace 依赖
│   └─ ui          → 无 workspace 依赖
└─ aigcfroge（sidecar 源）→ deps: llm, plugin, sdk, server, tui, script（devDep: core, http-recorder, script）
    ├─ server → deps: core
    └─ tui    → deps: core, plugin, sdk, ui
```

| 组 | 包 | 保留原因 |
|---|---|---|
| 入口 | `desktop` | Electron 壳（main/preload/renderer） |
| 前端 | `app` | renderer 从 app **源码**直接打包（appPlugin + app/public） |
| UI | `ui`、`session-ui` | 设计系统 + 会话渲染（app 依赖；虽被 enterprise/stats/tui 共享，但删除它们不影响这两个包） |
| 领域 | `core`、`llm`、`schema`、`sdk/js`、`plugin` | 会话核心 / LLM 抽象 / Schema 契约 / OpenAPI 客户端 / 插件 SDK |
| 应用 | **`aigcfroge`**、`server`、`script` | **sidecar 后端本体**、其 HTTP API 实现（cors/api/pty-environment/middleware）、版本/渠道工具（`Script.channel`/`Script.version`，desktop `scripts/prepare.ts:2` 与 `build-node.ts:3` 均使用） |
| 基础设施 | `effect-drizzle-sqlite`、`effect-sqlite-node`、`http-recorder`(dev) | SQLite 持久化（core 依赖）、HTTP 录制回放测试基础设施（llm/core devDep；构建/运行不需要，但不改 devDep 声明则 `bun install` 需要它存在） |
| 连带（硬依赖） | `tui` | **修正（2026-08-14 复核）**：旧版称"tui 仅 CLI 交互路径使用"**不准确**。`packages/aigcfroge/src/util/record.ts:1`、`src/util/error.ts:1`、`src/util/locale.ts:1-2` 是对 `@aigcfroge/tui` 的 re-export 桥，而 `src/config/config.ts:17` 引用 `@/util/record`；`src/node.ts:1` 直接导出 `Config`，故 **sidecar bundle 实际包含 tui 代码**。剥离需先拆这 3 个 util 桥及 `src/config/tui*.ts` 等约 35 处 import——属于独立重构任务，不在本次瘦身范围 |

---

## 4. 可删除清单

### 4.1 无反向依赖，直接删

| 项 | 用途 | 备注 |
|---|---|---|
| `packages/web` | Astro + Starlight 营销/文档站 | 无 workspace 依赖 |
| `packages/enterprise` | SolidStart 企业站 | 依赖 core/session-ui/ui，但**不反向依赖** |
| `packages/function` | Cloudflare Worker（SyncServer + GitHub JWT） | 无 workspace 依赖 |
| `packages/slack` | Slack 机器人 | 根 package.json workspaces 单独列出（`package.json:27`），需同步移除 |
| `packages/console/` | 独立子项目（无 package.json，非 workspace） | 独立删除 |
| `packages/stats/` | 独立子项目（无 package.json，非 workspace） | 独立删除 |
| `packages/containers/` | Docker 容器（base/bun-node/rust/tauri-linux 等） | 独立删除 |
| `packages/docs/` | Mintlify 文档站内容（docs.json + 生成的 openapi.json） | 独立删除 |
| `packages/identity/` | 品牌资源（logo 等） | 独立删除 |

### 4.2 可删但需同步修改引用

| 项 | 用途 | 同步修改 |
|---|---|---|
| `packages/cli` | CLI 分发二进制 | desktop 运行时/构建均不消费；删除需同步改 `publish.yml`（build-cli/sign-cli-windows job、build-electron 的 `needs`、publish job 的 4 处 `download-artifact`：aigcfroge-cli / -windows / -signed-windows / -preview-cli）与 `script/publish.ts:42`（CLI 发布段） |
| `packages/storybook` | UI 组件展示（纯开发工具） | 根 package.json `dev:storybook` 脚本同步删；`storybook.yml` 同步删 |
| `sdks/vscode/` | VS Code 扩展 | `publish-vscode.yml` 同步删；`script/raw-changelog.ts:123,140`（git log 路径与分类表，另 `:42-43` sections 表有 Extensions 映射，属同一清理面）同步清理 |
| `github/` | 产品级 GitHub Action（独立产品；`action.yml:68-74` 安装 npm CLI、`index.ts:235` spawn `aigcfroge serve`） | `publish-github-action.yml`、`release-github-action.yml`、`aigcfroge.yml`（`:29` `uses: ./github`）同步删 |
| `install`（根文件） | CLI curl 安装脚本 | **必须同步删 `nix/node_modules.nix:33` 的 fileset 行**，否则 nix build 断 |
| `release.yml` | 手动 CLI-only 发布（`:31,36` packages/cli） | 与 publish.yml 功能重叠，整文件删除 |

### 4.3 云部署层（desktop 零引用，全删）

- `sst.config.ts`（SST 配置：Cloudflare/AWS/Stripe/PlanetScale/Honeycomb）
- `infra/`（app.ts / console.ts / enterprise.ts / lake.ts / monitoring.ts / secret.ts / stage.ts / stats.ts——全是云端端部署。**注意 `infra/app.ts:64` 部署的 app 静态站删除，但 `packages/app` 本身保留**：desktop renderer 从源码打包）
- 各包 `sst-env.d.ts`（SST 自动生成；desktop/app 源码零引用，仅类型文件）
- `perf/`（测试套件文档，无代码引用）
- 根 package.json：devDep `sst`（`:103`）；`@aws-sdk/client-s3`（`:107`）与 `heap-snapshot-toolkit`（`:111`）在 **dependencies** 段（两者全仓库零 import，已验证）；`sso` 脚本（AWS SSO，服务 SST 部署）

### 4.4 CI 精简

| 处置 | workflow |
|---|---|
| 删除 | `deploy.yml`、`stats.yml`、`storybook.yml`、`containers.yml`、`docs-locale-sync.yml`、`docs-update.yml`、`publish-vscode.yml`、`publish-github-action.yml`、`release-github-action.yml`、`aigcfroge.yml`、`release.yml` |
| 修改 | `publish.yml`——只保留 desktop 链（version → build-electron → publish/finalize），移除 CLI job 与引用（唯一真正的发布链手术，详见 §5.2） |
| 保留不动 | `ci.yml`、`typecheck.yml`、`nix-eval.yml`、`nix-hashes.yml`（通用 turbo/nix 命令，自动收缩）；`test.yml`（`:74` turbo test 自动收缩；`:78-88` httpapi-exercise 在 packages/aigcfroge、e2e job `:90-159`（packages/app 段自 `:134` 起），均在保留链）；`beta.yml`、`generate.yml`（script/beta.ts、generate.ts 均在保留链）；仓库管理类 `close-issues.yml`、`close-prs.yml`、`pr-standards.yml`、`compliance-close.yml`、`notify-discord.yml`（用 script/github/*.ts，与 `github/` Action 目录无关） |
| 待决策 | `review.yml:35`、`triage.yml:23`、`duplicate-issues.yml:23,135`、`pr-management.yml:40` 均跑 `bun i -g aigcfroge` 装最新 npm CLI。CLI 停发后冻结在最后一个已发布版本——短期不坏，长期需删除或改造（见 §9） |

补充：`docs-locale-sync.yml:12` 已是 `if: false` 停用状态、`docs-update.yml:13` 限定 `sst/aigcfroge` 仓库在本 fork 本不触发——删除它们更无悬念。

`.github/actions/setup-bun`、`setup-git-committer` **保留**（发布/测试链通用）；`.github/TEAM_MEMBERS` **保留**（`packages/script/src/index.ts:55`、`script/raw-changelog.ts:28`、`nix/node_modules.nix:34` 三处依赖）。

### 4.5 保留的顶层内容

- `nix/desktop.nix` + `nix/aigcfroge.nix` + `flake.nix` + `nix/hashes.json` + `nix/scripts/`（互相依赖，都留）
- `script/`：`sign-windows.ps1`（Azure 签名；当前桌面 CI 未直接调用，CLI job 删除后可留作备用或删除，见 §9）、`version.ts`/`changelog.ts`/`publish.ts`（精简后）/`beta.ts`/`generate.ts`/`release/`（发布链路）、`lint-changed.ts`/`format.ts`（门禁）、`duplicate-pr.ts`（pr-management.yml 使用）、`upgrade-opentui.ts`（tui 保留则需要）、`github/close-*.ts`
- `scripts/check-agent-protocols.sh`（校验 `packages/aigcfroge/src/agent`，保留链）
- `specs/`（v2 产品规范文档，建议保留）
- `patches/`：仅删 `@standard-community%2Fstandard-openapi@0.2.9.patch`（其消费方 `hono-openapi` 仅 enterprise 使用；连同根 catalog 的 `hono-openapi` 条目一起删）+ `install-korean-ime-fix.sh`（非 bun patch，全仓库零引用的独立脚本，可删）。其余 patch（`@ff-labs/fff-bun`、`@npmcli/agent`、`pacote`、`photon-node`、`solid-js`、`gcp-metadata`、`@ai-sdk/google`、`@tanstack/*`、`@pierre/trees`、`@modelcontextprotocol/sdk`）消费方全在保留链，**保留**
- `bunfig.toml`（保留 `@opentui/*` 排除项——tui 保留；electron-builder 相关项也保留）
- 根 `package.json`：`postinstall`（`packages/core fix-node-pty`）+ `trustedDependencies`（electron、node-pty 等）是 desktop 原生依赖（PTY/Electron）的安装前提，**必须保留**；`dev`、`dev:desktop`、`dev:web`（→ packages/app，保留链，可用于脱离 Electron 调 renderer）保留
- `.husky/pre-push`（只跑 `bun typecheck`，自动收缩）；`turbo.json`（test 任务全指向保留包，无需改）；`.github/TEAM_MEMBERS`（见 §4.4）

---

## 5. 删除后对桌面端的影响（实测结论）

### 5.1 完全无影响（约 95%）

1. **运行时零影响**：保留链全部包源码 **0 处 import** 可删包；全仓库反向搜索也 0 处其他代码引用可删包；sidecar 加载的是本地 HTTP API，不触碰任何其他端；desktop 不调用 CLI 二进制。
2. **本地构建零影响**：desktop 构建链（prebuild → build-node → electron-vite → electron-builder）不经过任何可删包。
3. **类型检查零破坏**：project references 全闭包只有 desktop → app 一条边（`desktop/tsconfig.json:20`），其余跨包类型解析走 package.json exports 直读 `.ts` 源码，删包不会造成类型引用悬空。
4. **测试范围变小**：turbo.json 的 test tasks 只涉及保留包（aigcfroge/core/app/ui/session-ui）。

### 5.2 必须同步修改（不修改则发布/构建挂）

| 位置 | 现状 | 改为 |
|---|---|---|
| `publish.yml` build-electron job | `needs: [build-cli, version]`（`:231-233`） | `needs: [version]` |
| `publish.yml` publish job | `needs` 含 build-cli、sign-cli-windows（`:457-461`）；下载 4 个 CLI artifacts（`:487-505`） | 移除 needs 与 4 处 download-artifact；`script/publish.ts` 调用（`:559`）随脚本同步精简 |
| `script/publish.ts` | `:42` 发布 `packages/cli` | 删该段（`:39` aigcfroge、`:45` sdk/js、`:48` plugin、`:51-52` desktop finalize 保留） |
| `script/raw-changelog.ts` | `:123` git log 路径含 `sdks/vscode github`、`:140` 分类表 | 删除目录后同步清理（仍能跑，只是分类失效） |
| 根 `package.json` | workspaces 单列 `packages/slack`（`:27`）；scripts 含 `dev:storybook`（`:12`）、`sso`（`:20`）；`sst`（devDep `:103`）、`@aws-sdk/client-s3`（`:107`）、`heap-snapshot-toolkit`（`:111`，后两者在 dependencies 段）；catalog 残留只为被删包服务的条目（`@cloudflare/workers-types`、`@openauthjs/openauth`、`hono-openapi`、`drizzle-kit` 等） | 移除失效项；catalog 残留不报错，可顺手清理。**`dev:web` 保留**（指向保留链的 app） |
| `nix/node_modules.nix` | `:36` fileset 含 `../install` | 删 `install` 文件时**必须同步删此行**，否则 nix build 断 |
| `patches/` + 根 `package.json` `patchedDependencies` | `@standard-community/standard-openapi` patch 仅 enterprise 消费 | 删 patch 文件与 `patchedDependencies` 对应条目，否则 bun install 告警 |
| `.oxlintrc.json` | `:74-75` ignorePatterns 的 `packages/console/**`、`packages/stats/**` | 死规则（无害），可选清理 |
| `bun.lock` | 含已删包 | `bun install` 重新生成，无需手工编辑 |
| `bunfig.toml` | `@opentui/*` 排除项 | tui 保留 → **不动** |

### 5.3 真正的风险点（仅 3 个）

1. **误删 `packages/aigcfroge`**：desktop 未声明对它的依赖（相对路径耦合：`scripts/prebuild.ts:10`、`electron.vite.config.ts:6`），它又是 sidecar 本体——删除操作中最大的雷。publish.yml 的 build-cli job 可删，但它构建的 `packages/aigcfroge` 源码树必须保留。
2. **`sst-env.d.ts` 文件**：删除后需跑一次 typecheck 确认无引用（实测源码零引用，风险极低）。
3. **`node-pty` 原生依赖**：core 的 `postinstall fix-node-pty` + 根 `trustedDependencies`（electron、node-pty）是保留链，勿顺手清理。

### 5.4 其他已确认的事实

- **app 三方共享**：desktop（renderer 源码）、`infra/app.ts`（云部署，删除）、`packages/aigcfroge/script/build.ts:29-31,188`（CLI 内嵌 web UI；CLI 发布链删除后该产物无人消费，成为死代码，但 build.ts 本身保留）——删其他端时**保留 app**。
- **desktop 的 dead code**（清理机会，不在本次范围）：`scripts/copy-bundles.ts`、`scripts/utils.ts:11,54,61` 的 `SIDECAR_BINARIES`/`copyBinaryToSidecarFolder`/`getCurrentSidecar`、`AIGCFROGE_CLI_ARTIFACT` env、`native:build` 脚本与 `native/` 目录。
- **跨包相对导入**：desktop 直接 import `ui/src/theme/themes/oc-2.json`（`src/main/windows.ts:4`）与 16+ 处 `app/src/i18n/*`（`src/renderer/i18n/index.ts:20-35+`），绕过 ui/app exports——重构/删除 ui、app 前需先消除。
- **WSL 路径** `src/main/wsl/sidecar.ts:37` 在 WSL 发行版内执行 `aigcfroge serve`——用的是发行版里已安装的 CLI，与仓库代码无耦合（仅 CLI 接口契约）。CLI 停发不影响本仓库构建，但 WSL 场景的安装来源需留意。
- **保留链测试自洽（2026-08-14 审批实测）**：16 个保留包的全部 test/spec/e2e 文件中，`@aigcfroge/{web,enterprise,function,slack,cli,storybook}`、`sdks/vscode`、`../github/` 均 0 匹配，相对 import 无跨包逃逸——删除后测试链完整。
- **既有测试缺口（非本次删除引入，仅备案）**：desktop 的 11 个测试文件无 test 脚本/CI 入口（含 `electron-builder.config.test.ts`，仅测 channel 身份一致性）；llm/schema/tui 等有 test 脚本但 turbo.json 未挂；sdk/js、plugin、server、script、effect-sqlite-node 零测试；sidecar 打包环节（build-node bundle、electron-vite 插件、.wasm 拷贝）无自动化测试，只能靠 §7 的完整 build 验证。

---

## 6. 执行顺序（建议）

1. **建分支**（如 `desktop-only`），备份基线
2. **删独立子项目**：`console/` `stats/` `containers/` `docs/` `identity/` `web/` `function/` `slack/` `enterprise/`
3. **删 SST 层**：`sst.config.ts`、`infra/`、各包 `sst-env.d.ts`；根 package.json 的 `sst`/`sso`/零 import devDeps
4. **删扩展/工具**：`sdks/vscode`、`github/`、`install`（同步删 `nix/node_modules.nix:33`）、`storybook`（同步删根 `dev:storybook`）
5. **精简 CI**：删 §4.4 列出的 11 个 workflows；`publish.yml` 只留 desktop 链（version → build-electron → publish/finalize）
6. **删 `cli`**（改完 publish.yml 与 `script/publish.ts:42` 后）；清理 `patches/` 的 standard-openapi 条目、`raw-changelog.ts` 分类、`.oxlintrc.json` 死规则、根 catalog 残留
7. **验证**（见 §7）
8. **更新文档**：README / README.zh.md / ARCHITECTURE.md（§3 包拓扑、§2 系统概览）/ CLAUDE.md（已知负债表）/ 根 AGENTS.md；并在 `packages/desktop/AGENTS.md` 中**写明对 `packages/aigcfroge` 的相对路径隐式依赖**，防止后来者误删
9. **后续独立任务（不在本次瘦身范围）**：tui 剥离重构（拆 util 桥 + ~35 处 import）；desktop dead code 清理；desktop→aigcfroge 依赖显式化（package.json 声明）

---

## 7. 删除后验证清单

```bash
# 1. 依赖重新生成
bun install

# 2. 类型检查（保留链；或 bun typecheck 全仓 turbo 检查）
bun --cwd packages/desktop typecheck
bun --cwd packages/app typecheck
bun --cwd packages/core typecheck
bun --cwd packages/aigcfroge typecheck

# 3. 本地构建（完整走一遍 build-node → electron-vite）
bun --cwd packages/desktop build

# 4. 打包验证（选当前平台）
bun --cwd packages/desktop package:linux   # 或 package:mac / package:win

# 5. 运行时验证（sidecar 能起、renderer 能连）
bun --cwd packages/desktop dev

# 6. 测试（保留链单包测试）
bun --cwd packages/core test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/app test --timeout 30000

# 7. Nix 验证（若使用 nix）
nix eval .#aigcfroge-desktop.name   # 或交给 CI 的 nix-eval.yml
```

---

## 8. 关键证据索引（文件与行号）

| 事实 | 证据 |
|---|---|
| sidecar 加载 aigcfroge 的 node 产物 | `packages/desktop/electron.vite.config.ts:6`（`AIGCFROGE_SERVER_DIST = "../aigcfroge/dist/node"`）、`:54-68`（`aigcfroge:server-dist` 插件，含 `.wasm` 拷贝） |
| sidecar 运行时 | `packages/desktop/src/main/sidecar.ts:57`（`import("virtual:aigcfroge-server")` + `Server.listen`）；`src/main/server.ts:82-83`（`utilityProcess.fork`，127.0.0.1 随机端口 + basic auth） |
| prebuild 构建 sidecar 后端 | `packages/desktop/scripts/prebuild.ts:10`、`scripts/predev.ts:5`（`cd ../aigcfroge && bun script/build-node.ts`） |
| aigcfroge node 入口 | `packages/aigcfroge/src/node.ts:1-4`（导出 `Config`/`Server`/`bootstrap`/`Database`）；`script/build-node.ts:3,15-29`（输出 `dist/node`） |
| aigcfroge 依赖 server | `packages/aigcfroge/src/server/routes/instance/httpapi/server.ts:71-117`（import `@aigcfroge/server/*`） |
| **tui 被 bundle 进 sidecar（修正）** | `packages/aigcfroge/src/util/record.ts:1`、`src/util/error.ts:1`、`src/util/locale.ts:1-2`（re-export `@aigcfroge/tui`）；`src/config/config.ts:17` 引用 `@/util/record`；`src/node.ts:1` 导出 `Config` → sidecar bundle 含 tui |
| CLI 相关 dead code | `packages/desktop/scripts/utils.ts:11,54,61`（定义无调用方）；`publish.yml:352` 传 `AIGCFROGE_CLI_ARTIFACT` 无人读取；`copy-bundles.ts` 全仓库无调用；build-electron `needs: [build-cli, version]` 仅排序依赖 |
| desktop 依赖声明 | `packages/desktop/package.json`（仅 `@aigcfroge/app`、`@aigcfroge/ui`，未声明 aigcfroge） |
| desktop 对 app/ui 的源码级直接引用 | `electron.vite.config.ts:3`（`@aigcfroge/app/vite`）、`:85`（`publicDir: "../../../app/public"`）；`src/main/windows.ts:4`（`ui/src/theme/themes/oc-2.json`）；`src/renderer/i18n/index.ts:20-35+`（16 处 `app/src/i18n/*`） |
| app 被三方共享 | desktop renderer（electron.vite.config.ts renderer 段）、`infra/app.ts:64`、`packages/aigcfroge/script/build.ts:29-31,188` |
| nix 耦合 | `nix/desktop.nix:18-23`（inherit aigcfroge.nix）；`nix/node_modules.nix:33`（fileset 含 `../install`）、`:34`（含 `.github/TEAM_MEMBERS`） |
| 4 个 workflow 依赖 npm CLI | `review.yml:35`、`triage.yml:23`、`duplicate-issues.yml:23,135`、`pr-management.yml:40`（`bun i -g aigcfroge`） |
| desktop 无 SST 依赖 | desktop/app 源码零 `infra` 引用；`sst.config.ts` 部署的全是云端端 |
| 保留链零引用可删包 | 全仓库 grep：`@aigcfroge/{web,enterprise,function,slack,cli,storybook}` 在保留链源码 0 匹配 |
| patch 消费方 | `@standard-community/standard-openapi` → 仅 `packages/enterprise/package.json:26`（hono-openapi peer）；其余 patch 消费方全在保留链 |

---

## 9. 待决策项

- [x] ~~`tui` 是否剥离~~ → **本次保留**（2026-08-14 复核修正：tui 是 sidecar 硬运行时依赖；剥离需拆 3 个 util 桥 + ~35 处 import，列为后续独立重构任务）
- [ ] `storybook` 是否保留（建议删除：纯开发工具；代价是 ui/session-ui 失去可视化开发环境）
- [ ] 4 个依赖 npm CLI 的仓库管理 workflow（review/triage/duplicate-issues/pr-management）：CLI 停发后冻结在最后发布版——删除、改造，还是接受僵化？
- [ ] `cli` 删除前是否确认无其他隐式消费者（已实测无；注意 WSL 场景 `src/main/wsl/sidecar.ts:37` 依赖发行版内已安装 CLI，属外部安装来源问题）
- [ ] `specs/` 与 `docs/`（顶层）是否保留作知识库（建议保留；`docs/plan/` 至少保留本文档）
- [ ] 删除后是否清理 desktop 的 dead code（§5.4，建议列为后续任务）
- [ ] `script/sign-windows.ps1` 去留（CLI 签名场景消失；桌面 Windows 签名走 electron-builder 内建，可留作备用）
- [ ] `stats.ts` 脚本（stats.yml 删除后）：npm 维度失效，GitHub release 资产下载量维度仍覆盖 desktop——保留还是删


---

## 10. 审批记录（2026-08-14）

按 `CLAUDE.md` 改完即审流程与 `protocols` skill 路由执行（改动为文档-only，采用链接/事实/git diff 验证）：

- **影响面**：仅本文档（`git diff --stat`：1 file changed）。
- **命中协议/技能**：`CLAUDE.md`（审批流程）、`AGENTS.md`（根，代码检索/测试规约）、`packages/desktop/AGENTS.md`（4 行，无冲突约束）、`protocols` skill（Phase 1/2 路由与影响面核对）；`effect`/`database`/`frontend-theming` 未命中（无代码改动）。引用完整性 `check-refs.sh`：28/28 通过。
- **事实核验**：22 条关键声明分两组实地核验（A 组 sidecar/构建链/nix/patches 11 条；B 组 CI/脚本/根配置/测试覆盖 11 条），覆盖上下游 5 层（desktop → app/ui/aigcfroge → session-ui/server → core/plugin → llm/schema/sdk/effect-*）及其测试代码。结果：**语义 0 不符**；7 处行号漂移 + 1 处 dependencies/devDependencies 措辞已回改本文档（§2.6、§4.2、§4.3、§4.4、§5.2、§6、§8）。
- **测试自洽性**：保留链 16 包测试零引用被删包；既有测试缺口备案于 §5.4。
- **裁决**：**有条件批准**——计划可按 §6 顺序执行。前置条件：§9 待决策项中 3 项需在执行前由 owner 拍板（storybook 去留、4 个 npm CLI workflow 处置、specs/docs 保留范围），其余待决策项可在执行中并行决定。
## 10.2 执行审批记录（2026-08-14，终审：批准）

执行在独立 worktree（`slim_desktop_only`）的分支 `desktop-only` 上完成，9 个 commit 对应 §6 各节，1584 文件变更（+168 / -475,756）。

**用户决策落地（覆盖 §9 默认值）**：`storybook` **保留**（含根 `dev:storybook` 脚本与 `storybook.yml`），保留包总数 16 → **17**。提交历史含 "删后恢复" 抖动（`8636234aa` → `c21758ae8`），合入前可考虑 squash。其余预决策（specs/docs 保留、4 个 npm CLI workflow 保留不动、sign-windows.ps1 与 stats.ts 保留）均按默认执行。

**审批人独立复验（非转述执行方报告）**：

| 门禁 | 结果 |
|---|---|
| typecheck ×4（desktop/app/core/aigcfroge） | 全 PASS |
| core 测试 | 1782 pass / 2 skip / **0 fail**（执行方申报 "2 fail 同基线" 不准确，实为负载抖动） |
| aigcfroge 测试 | 3167 pass / 1 fail；失败项 `loop sets status to busy then idle`（`test/session/prompt.test.ts:954`，自带 3s 墙钟超时）为并发负载抖动，隔离复跑 57/57 转绿 |
| app 全量测试 | 831+3 = **834 pass / 0 fail**，与申报一致 |
| check-refs.sh | 27/27 通过 |
| 悬空引用 grep | 保留链对被删包引用 = 0 |
| 构建产物 | `.deb`(126MB) / `.AppImage`(165MB) / `linux-unpacked` 实际存在 |

**白盒审查**：publish.yml 手术（build-cli/sign-cli-windows 移除、needs 修正、4 处 artifact 下载删除）逐行核对无误；根 package.json / .oxlintrc.json / nix/node_modules.nix / patches / script/publish.ts:42 / raw-changelog.ts 均与 §5.2 一致。

**遗留瑕疵（非阻塞，均为删除前已存在的死配置）**：
1. `publish.yml:188` 仍传死 env `AIGCFROGE_CLI_ARTIFACT`；`:258` 仍 glob `resources\aigcfroge-cli.exe`（带 SilentlyContinue，无害）——建议顺手清理
2. `script/publish.ts:38` 日志标签 `=== cli ===` 实为 aigcfroge npm 发布段，措辞陈旧（cosmetic）

**合入前提**：主检出工作区（分支 `fix-assistant-panel-layout`）挂有 14 个 `packages/app` 未提交业务改动（非本次产出），合入前需先提交或另行安置。

