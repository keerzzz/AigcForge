# 桌面端保留方案 — 调研与实施计划

> 目标：从 AigcForge monorepo 中删除所有非桌面端内容（web / slack / function / enterprise / cli / storybook / vscode 扩展 / GitHub Action / SST 云部署等），仅保留桌面端（Electron）所需的一切。
>
> 状态：调研完成（2025 年，基于 `main` 分支逐文件实测，非推测）
> 性质：只读调研结论 + 待执行计划（本文档撰写时未改动任何文件）

---

## 1. 背景与目标

AigcForge 是一个 22 包 monorepo，产品形态包括：**CLI、终端 TUI、Electron 桌面端** 三个本地入口，以及 web（Astro 文档站）、slack（机器人）、function（Cloudflare Worker）、enterprise（SolidStart 企业站）四个云端部署单元。

用户目标：**只保留桌面端**，删除其他一切端。

### 1.1 核心认知修正（与直觉相反的三点）

1. **`packages/aigcfroge` 不是"CLI 端"，而是桌面端的内置后端（sidecar 服务器本体）**。desktop 的 package.json **未声明**对它的依赖，靠 `../aigcfroge` 相对路径消费其构建产物。误删即断 sidecar，桌面端无法启动。
2. **`packages/server`、`packages/script`、`packages/tui` 也在桌面依赖链上**（aigcfroge 的依赖）。
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

electron-vite 从 **app 源码**打包（renderer 段用 `@aigcfroge/app/vite` 的 appPlugin，`publicDir: "../../../app/public"`），**不是**消费 app 的 dist 产物。

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

- `nix/desktop.nix` + `nix/aigcfroge.nix`（desktop.nix 以 aigcfroge.nix 为基底，**两者互相依赖**）+ `flake.nix` 输出 `aigcfroge-desktop`；
- CI：`nix-eval.yml`、`nix-hashes.yml`。

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
| 应用 | **`aigcfroge`**、`server`、`script` | **sidecar 后端本体**、其 HTTP API 实现（cors/api/pty-environment/middleware）、版本/渠道工具（`Script.channel`/`Script.version`） |
| 基础设施 | `effect-drizzle-sqlite`、`effect-sqlite-node`、`http-recorder`(dev) | SQLite 持久化（core 依赖）、HTTP 录制回放测试基础设施（llm/core devDep） |
| 连带 | `tui` | aigcfroge 声明依赖；但**仅 CLI 交互路径**（`src/cli/tui/layer.ts`）使用，sidecar 构建入口（`src/node.ts`）不经过 → 可后续重构剥离后删除 |

---

## 4. 可删除清单

### 4.1 无反向依赖，直接删

| 项 | 用途 | 备注 |
|---|---|---|
| `packages/web` | Astro + Starlight 营销/文档站 | 无 workspace 依赖 |
| `packages/enterprise` | SolidStart 企业站 | 依赖 core/session-ui/ui，但**不反向依赖** |
| `packages/function` | Cloudflare Worker（SyncServer + GitHub JWT） | 无 workspace 依赖 |
| `packages/slack` | Slack 机器人 | 根 package.json workspaces 单独列出，需同步移除 |
| `packages/console/` | 独立子项目（无 package.json，非 workspace） | 独立删除 |
| `packages/stats/` | 独立子项目（无 package.json，非 workspace） | 独立删除 |
| `packages/containers/` | Docker 容器（base/bun-node/rust/tauri-linux 等） | 独立删除 |
| `packages/docs/` | 文档站内容 | 独立删除 |
| `packages/identity/` | 品牌资源（logo 等） | 独立删除 |

### 4.2 可删但需同步修改引用

| 项 | 用途 | 同步修改 |
|---|---|---|
| `packages/cli` | CLI 分发二进制 | desktop 运行时/构建均不消费；删除需同步改 `publish.yml`（build-cli/sign-cli-windows job、build-electron 的 `needs`、publish job 的 4 处 `download-artifact`：aigcfroge-cli / -windows / -signed-windows / -preview-cli） |
| `packages/storybook` | UI 组件展示（纯开发工具） | 根 package.json `dev:storybook` 脚本同步删 |
| `sdks/vscode/` | VS Code 扩展 | `.github/workflows/publish-vscode.yml` 同步删；`script/publish.ts`、`raw-changelog.ts` 引用需修改 |
| `github/` | 产品级 GitHub Action（独立产品） | `.github/workflows/publish-github-action.yml`、`release-github-action.yml` 同步删 |
| `install`（根文件） | CLI 安装脚本 | 与桌面端无关 |

### 4.3 云部署层（desktop 零引用，全删）

- `sst.config.ts`（SST 配置：Cloudflare/AWS/Stripe/PlanetScale/Honeycomb）
- `infra/`（app.ts / console.ts / enterprise.ts / lake.ts / monitoring.ts / secret.ts / stage.ts / stats.ts——全是云端端部署）
- 各包 `sst-env.d.ts`（SST 自动生成；desktop/app 源码零引用，仅类型文件）
- `perf/`（测试套件文档）

### 4.4 CI 精简

| 处置 | workflow |
|---|---|
| 删除 | `deploy.yml`、`stats.yml`、`storybook.yml`、`containers.yml`、`docs-locale-sync.yml`、`docs-update.yml` |
| 修改 | `publish.yml`——只保留 desktop 链（version → build-electron → publish/finalize），移除 CLI job 与引用 |
| 保留 | `ci.yml`、`test.yml`（测 aigcfroge/app，均在保留链）、`typecheck.yml`、`nix-eval.yml`、`nix-hashes.yml`、`pr-*.yml` 等流程管理类 |

### 4.5 保留的顶层内容

- `nix/desktop.nix` + `nix/aigcfroge.nix` + `flake.nix`（互相依赖，都留）
- `script/`：`sign-windows.ps1`（desktop 发布签名用）、`version.ts`/`changelog.ts`/`publish.ts`/`release/`（发布链路）、`lint-changed.ts`（lint 门禁）、`format.ts`、`upgrade-opentui.ts` 等
- `specs/`（v2 产品规范文档，建议保留）
- `patches/`（依赖补丁，保留链依赖）
- `bunfig.toml`（可清理 `@opentui/*` 排除项——仅当删除 tui 时；保留 electron-builder 相关项）
- 根 `package.json`：`postinstall`（`packages/core fix-node-pty`）+ `trustedDependencies`（electron、node-pty 等）是 desktop 原生依赖（PTY/Electron）的安装前提，**必须保留**

---

## 5. 删除后对桌面端的影响（实测结论）

### 5.1 完全无影响（约 95%）

1. **运行时零影响**：保留链全部包源码 **0 处 import** 可删包；全仓库反向搜索也 0 处其他代码引用可删包；sidecar 加载的是本地 HTTP API，不触碰任何其他端；desktop 不调用 CLI 二进制。
2. **本地构建零影响**：desktop 构建链（prebuild → build-node → electron-vite → electron-builder）不经过任何可删包。
3. **类型检查零破坏**：tsconfig 无跨包 include，删包不会造成类型引用悬空。
4. **测试范围变小**：turbo.json 的 test tasks 只涉及保留包（aigcfroge/core/app/ui/session-ui）。

### 5.2 必须同步修改（不修改则发布/脚本挂）

| 位置 | 现状 | 改为 |
|---|---|---|
| `publish.yml` build-electron job | `needs: [build-cli, version]` | `needs: [version]` |
| `publish.yml` publish job | `needs` 含 build-cli、sign-cli-windows；下载 4 个 CLI artifacts | 移除 needs 与 4 处 download-artifact |
| `script/publish.ts`、`raw-changelog.ts` | 引用 `sdks/vscode`、`github/` | 删除目录后同步修改 |
| 根 `package.json` | workspaces 单列 `packages/slack`；scripts 含 dev:web / dev:storybook / sso | 移除失效项 |
| `bunfig.toml` | `@opentui/*` 排除项（若删 tui） | 清理 |
| `bun.lock` | 含已删包 | `bun install` 重新生成 |

### 5.3 真正的风险点（仅 3 个）

1. **误删 `packages/aigcfroge`**：desktop 未声明对它的依赖（相对路径耦合），它又是 sidecar 本体——删除操作中最大的雷。
2. **`sst-env.d.ts` 文件**：删除后需跑一次 typecheck 确认无引用（实测源码零引用，风险极低）。
3. **`node-pty` 原生依赖**：core 的 `postinstall fix-node-pty` + 根 `trustedDependencies`（electron、node-pty）是保留链，勿顺手清理。

### 5.4 其他已确认的事实

- **app 三方共享**：desktop（renderer 源码）、`infra/app.ts`（云部署，删除）、`packages/aigcfroge/script/build.ts`（CLI 内嵌 web UI，删除 CLI 链后成为死代码）——删其他端时**保留 app**。
- **desktop 的 dead code**（清理机会）：`scripts/copy-bundles.ts`、`scripts/utils.ts` 的 `SIDECAR_BINARIES`/`copyBinaryToSidecarFolder`/`getCurrentSidecar`、`AIGCFROGE_CLI_ARTIFACT` env、`native:build` 脚本与 `native/` 目录（当前不存在）。
- **跨包相对导入**：desktop main 直接 import `../../ui/src/theme/themes/oc-2.json`，绕过 ui exports——重构/删除 ui 前需先消除。

---

## 6. 执行顺序（建议）

1. **建分支**（如 `desktop-only`），备份基线
2. **删独立子项目**：`console/` `stats/` `containers/` `docs/` `identity/` `web/` `function/` `slack/` `enterprise/`
3. **删 SST 层**：`sst.config.ts`、`infra/`、各包 `sst-env.d.ts`
4. **删扩展/工具**：`sdks/vscode`、`github/`、`install`、`storybook`
5. **精简 CI**：删 §4.4 列出的 workflows；`publish.yml` 只留 desktop 链
6. **删 `cli`**（改完 publish.yml 引用后）+ **评估 `tui` 剥离**（重构 aigcfroge，从 package.json 与 `src/cli/tui/layer.ts` 移除）
7. **验证**（见 §7）
8. **更新文档**：README / README.zh.md / ARCHITECTURE.md（§3 包拓扑、§2 系统概览）/ CLAUDE.md（已知负债表）/ 根 package.json scripts

---

## 7. 删除后验证清单

```bash
# 1. 依赖重新生成
bun install

# 2. 类型检查（保留链）
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
```

---

## 8. 关键证据索引（文件与行号）

| 事实 | 证据 |
|---|---|
| sidecar 加载 aigcfroge 的 node 产物 | `packages/desktop/electron.vite.config.ts:6`（`AIGCFROGE_SERVER_DIST = "../aigcfroge/dist/node"`）、`:54-68`（`aigcfroge:server-dist` 插件） |
| sidecar 运行时 | `packages/desktop/src/main/sidecar.ts:57`（`import("virtual:aigcfroge-server")` + `Server.listen`） |
| prebuild 构建 sidecar 后端 | `packages/desktop/scripts/prebuild.ts:10`（`cd ../aigcfroge && bun script/build-node.ts`） |
| aigcfroge node 入口 | `packages/aigcfroge/src/node.ts`（导出 `Server` from `./server/server`） |
| aigcfroge 依赖 server | `packages/aigcfroge/src/server/routes/instance/httpapi/*.ts`（import `@aigcfroge/server/cors` 等） |
| CLI 相关 dead code | `packages/desktop/scripts/utils.ts:11,54,61`（定义无调用方）；`publish.yml` 传 `AIGCFROGE_CLI_ARTIFACT` 无人读取；`copy-bundles.ts` 全仓库无调用 |
| desktop 依赖声明 | `packages/desktop/package.json`（仅 `@aigcfroge/app`、`@aigcfroge/ui`，未声明 aigcfroge） |
| app 被三方共享 | desktop renderer（electron.vite.config.ts renderer 段）、`infra/app.ts`、`packages/aigcfroge/script/build.ts:29-31,188` |
| tui 仅 CLI 路径使用 | `packages/aigcfroge/src/cli/tui/layer.ts:1` |
| desktop 无 SST 依赖 | desktop/app 源码零 `infra` 引用；`sst.config.ts` 部署的全是云端端 |
| 保留链零引用可删包 | 全仓库 grep：`@aigcfroge/{web,enterprise,function,slack,cli,storybook,console,stats}` 在保留链源码 0 匹配 |

---

## 9. 待决策项

- [ ] `tui` 是否剥离（保留则多一个包，剥离需重构 aigcfroge 的 CLI 交互路径）
- [ ] `storybook` 是否保留（UI 开发辅助，服务 ui/session-ui，非产品端）
- [ ] `cli` 删除前是否确认无其他隐式消费者（已实测无，但发布流程需先改）
- [ ] `specs/` 与 `docs/`（顶层）是否保留作知识库
- [ ] 删除后是否清理 desktop 的 dead code（§5.4）
