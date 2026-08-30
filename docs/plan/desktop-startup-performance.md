# Desktop 启动性能优化方案

> **状态**: Draft，待实施
> **范围**: `packages/desktop`（主进程 + 渲染端入口）+ 必要时 `packages/aigcfroge/src/server` + `packages/core/src/database`
> **目标**: 消除桌面端启动后的卡顿与延迟，量化各阶段耗时
> **依据**: 本仓代码追踪（含类型层验证）+ 上游 `opencode-dev` 对比验证 + skills 规范

---

## 0. 起始前必须阅读（实施智能体 onboarding）

实施任何阶段前，**必须**按顺序阅读以下内容，理解执行约束与架构边界。跳过阅读会导致违反协议规范或破坏架构边界。

### 0.1 协议文档（执行约束）

| 文档                                                               | 必读章节                                                                                                           | 为什么                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| [CLAUDE.md](../../CLAUDE.md)                                       | 第一性原理（九荣九耻/四大拒绝/根因收敛）、项目边界、改完即审流程                                                   | 所有任务的执行宪法                                                    |
| [AGENTS.md](../../AGENTS.md)                                       | Branch And Commit、Code Retrieval、Effect Coding、Schema、Testing、Type Checking、V2 Session Core 8 不变量         | 代码风格 + Effect/测试规范 + Session 架构不变量                       |
| [ARCHITECTURE.md](../../ARCHITECTURE.md)                           | §2 系统概览、§3 包拓扑与依赖方向、§4.1 Session V2、§4.8 Database、§4.11 External CLI Dispatch、§6 跨层 Effect 边界 | 系统结构 + Layer provide 边界 + 子系统职责                            |
| [packages/desktop/AGENTS.md](../../packages/desktop/AGENTS.md)     | 全文（IPC/i18n 规范）                                                                                              | desktop 包规范：IPC handler 注册位置、i18n 强制                       |
| [packages/aigcfroge/AGENTS.md](../../packages/aigcfroge/AGENTS.md) | Module shape（self-export）、Effect rules、Runtime vs InstanceState、Effect v4 beta API                            | Effect 编码规范 + `Effect.forkIn(scope)` 非 fork + InstanceState 语义 |

### 0.2 Skills（编码细节）

| Skill                                                                            | 必读场景                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [.aigcfroge/skills/effect/SKILL.md](../../.aigcfroge/skills/effect/SKILL.md)     | 改 Effect 代码时；`testEffect`/`it.live` 测试模式；验证 API 查 `.aigcfroge/references/effect-smol` |
| [.aigcfroge/skills/database/SKILL.md](../../.aigcfroge/skills/database/SKILL.md) | 涉及 Database Layer/迁移时；迁移生命周期 `apply`/`applyOnly`；Layer 构建时序                       |

### 0.3 上下游 5 层代码（数据流追踪）

| 层                          | 必读文件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 追踪目的                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **入口层** desktop          | [main/index.ts](../../packages/desktop/src/main/index.ts)、[main/sidecar.ts](../../packages/desktop/src/main/sidecar.ts)、[main/windows.ts](../../packages/desktop/src/main/windows.ts)、[main/shell-env.ts](../../packages/desktop/src/main/shell-env.ts)、[main/server.ts](../../packages/desktop/src/main/server.ts)、[main/logging.ts](../../packages/desktop/src/main/logging.ts)、[main/unresponsive.ts](../../packages/desktop/src/main/unresponsive.ts)、[renderer/index.tsx](../../packages/desktop/src/renderer/index.tsx)、[renderer/initialization.ts](../../packages/desktop/src/renderer/initialization.ts) | 启动链全貌、sidecar spawn、窗口创建、shell env、渲染端 Splash   |
| **应用层** aigcfroge/server | [server/server.ts](../../packages/aigcfroge/src/server/server.ts)、[server/routes/instance/httpapi/server.ts](../../packages/aigcfroge/src/server/routes/instance/httpapi/server.ts)、[server/init-projectors.ts](../../packages/aigcfroge/src/server/init-projectors.ts)                                                                                                                                                                                                                                                                                                                                                 | `Server.listen` + `Layer.buildWithMemoMap` + 57+ Layer 节点组合 |
| **领域层** core             | [database/database.ts](../../packages/core/src/database/database.ts)（Layer 构建+迁移同步）、[models-dev.ts](../../packages/core/src/models-dev.ts)（后台刷新）、[effect/layer-node.ts](../../packages/core/src/effect/layer-node.ts)                                                                                                                                                                                                                                                                                                                                                                                     | Database 迁移阻塞点、ModelsDev 不阻塞、LayerNode 组合语义       |
| **UI 层** app/ui            | [app/src/components/debug-bar.tsx](../../packages/app/src/components/debug-bar.tsx)（DEV 性能面板）、[app/src/pages/layout.tsx](../../packages/app/src/pages/layout.tsx)（DebugBar 挂载）、ui Splash 组件                                                                                                                                                                                                                                                                                                                                                                                                                 | 运行时性能监控现状、Splash 已有                                 |
| **基础设施**                | [effect-sqlite-node](../../packages/effect-sqlite-node/)、[effect-drizzle-sqlite](../../packages/effect-drizzle-sqlite/)（vendor 桥接，oxlint 豁免）                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | SQLite driver 绑定、vendor 代码不改                             |

### 0.4 测试代码（TDD 基线 + 回归基线）

| 测试文件                                                                                      | 当前覆盖                                                      | TDD 起点                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| [main/shell-env.test.ts](../../packages/desktop/src/main/shell-env.test.ts)                   | 纯函数 parseShellEnv/mergeShellEnv/resolveUserShell/isNushell | 阶段 1 加 `loadShellEnvAsync` 测试 |
| [main/index.test.ts](../../packages/desktop/src/main/index.test.ts)                           | forwardInitializationFailure                                  | 阶段 2 回归基线                    |
| [renderer/initialization.test.ts](../../packages/desktop/src/renderer/initialization.test.ts) | initializationData/initializationReady 错误处理               | 阶段 2 回归基线                    |
| [app/e2e/performance/](../../packages/app/e2e/performance/)                                   | 渲染层导航基准（不测主进程启动）                              | 阶段 0 埋点验证参考其探针模式      |

---

## 1. 问题与已验证根因

### 现象

用户反馈：每次启动桌面端后很卡。

### 根因（按影响排序，均已代码 + 类型层验证）

| #      | 根因                                                    | 性质                                                                                    | 位置                                                                                                                                                                                                 | 验证依据                                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R1** | `loadShellEnv` 用 `spawnSync` 同步阻塞主进程事件循环    | **真卡**（阻塞事件循环，IPC 也冻结）                                                    | [shell-env.ts:37](../../packages/desktop/src/main/shell-env.ts#L37) `spawnSync`；调用点 [index.ts:189](../../packages/desktop/src/main/index.ts#L189) `preferAppEnv`                                 | `spawnSync` 语义；`-il` timeout 后不重试 `-l`（[shell-env.ts:81-84](../../packages/desktop/src/main/shell-env.ts#L81-L84)），最坏 ~5s                                                                                                |
| **R2** | 窗口创建被 sidecar spawn + health check 阻塞            | **慢启动**（`Fiber.await` 异步 suspend 不阻塞事件循环，但延迟 `createMainWindow` 调用） | [index.ts:348](../../packages/desktop/src/main/index.ts#L348) `Fiber.await(loadingTask)` -> L350 `createMainWindow`                                                                                  | Effect 协作式调度语义；`createMainWindow`/`createMenu` 搜索 sidecar/server/serverReady **零匹配**，确认不依赖 sidecar                                                                                                                |
| **R3** | sidecar 动态导入 server 包 + 同步构建 57+ Layer         | sidecar 冷启动慢                                                                        | [sidecar.ts:57](../../packages/desktop/src/main/sidecar.ts#L57) `import("virtual:aigcfroge-server")` -> [server.ts:137](../../packages/aigcfroge/src/server/server.ts#L137) `Layer.buildWithMemoMap` | [database.ts:33-43](../../packages/core/src/database/database.ts#L33-L43) `DatabaseMigration.apply(db)` **同步**在 Layer 构建时执行；[models-dev.ts:239](../../packages/core/src/models-dev.ts#L239) `forkScoped` 后台刷新**不阻塞** |
| **R4** | `startNetLog` 持续网络日志                              | 持续 I/O 开销                                                                           | [index.ts:275](../../packages/desktop/src/main/index.ts#L275) -> [logging.ts:47](../../packages/desktop/src/main/logging.ts#L47)                                                                     | `netLog.startLogging` 语义                                                                                                                                                                                                           |
| **R5** | `updater.start()` 启动即检查更新                        | 启动期网络抢占                                                                          | [index.ts:271](../../packages/desktop/src/main/index.ts#L271)                                                                                                                                        | `updater.start` 语义                                                                                                                                                                                                                 |
| **R6** | 渲染端 `ready-to-show` 才显示，但窗口被 R2 阻塞无法创建 | Splash 无法尽早显示                                                                     | [windows.ts:177](../../packages/desktop/src/main/windows.ts#L177)                                                                                                                                    | 渲染端已有 Splash [renderer/index.tsx:335-339](../../packages/desktop/src/renderer/index.tsx#L335-L339) 和 `awaitInitialization` [L302](../../packages/desktop/src/renderer/index.tsx#L302)                                          |

### 启动链时序（当前）

```
index.ts main()  [Effect.runFork, L367]
├─ contextMenu()                                    [同步]
├─ process.chdir(homedir())                         [同步, L108]
├─ initLogging() / initCrashReporter()              [同步, L136-137]
├─ createWslServersController()                     [同步, L139]
├─ setDefaultCACertificates()                       [同步, L166]
├─ ensureLoopbackNoProxy() / useEnvProxy()          [同步, L177-178]
├─ app.requestSingleInstanceLock()                  [同步, L184]
├─ preferAppEnv()  ◄── R1: spawnSync 阻塞事件循环 ~1-5s  [L189]
├─ app.whenReady()                                  [异步等待, L237]
├─ migrate()                                        [同步, L239]
├─ registerRendererProtocol() / setDockIcon()       [L241-242]
├─ setupAutoUpdater() / registerIpcHandlers()       [L243-269]
├─ updater.start()  ◄── R5                          [L271]
├─ startNetLog()    ◄── R4                          [L275]
├─ spawnLocalServer()  ◄── R3: sidecar spawn + import server + Layer 构建（含 Database 同步迁移）
│   └─ health.wait (100ms 轮询, 30s 超时)           [L336]
├─ Fiber.await(loadingTask)  ◄── R2: 等 sidecar+health 才往下走  [L348]
└─ createMainWindow()  ◄── 窗口此时才创建            [L350]
    └─ ready-to-show -> win.show()  ◄── R6          [windows.ts:177]
```

### 上游对比验证

上游 `opencode-dev` 启动链与本仓**完全一致**（同样 R1-R6）：

| 环节                                | 上游 `index.ts`   | 本仓        |
| ----------------------------------- | ----------------- | ----------- |
| `preferAppEnv` 在 `whenReady` 前    | L203 < L255       | L189 < L237 |
| `Fiber.await(loadingTask)` 阻塞窗口 | L409              | L348        |
| `shell-env.ts` spawnSync            | L37, TIMEOUT=5000 | 相同        |
| `Database.node` 同步迁移            | 相同              | 相同        |

**结论**：启动卡顿是上游架构级设计，非本仓 fork 引入的回归。不能等上游修，本仓需自解。

### 测试覆盖缺口

| 测试文件                                                               | 覆盖                         | 缺口                                         |
| ---------------------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| [shell-env.test.ts](../../packages/desktop/src/main/shell-env.test.ts) | 纯函数                       | **未测 loadShellEnv 的 spawnSync 超时/重试** |
| [index.test.ts](../../packages/desktop/src/main/index.test.ts)         | forwardInitializationFailure | **未测启动顺序/窗口创建时机**                |
| e2e/performance/                                                       | 渲染层导航基准               | **不测 desktop 主进程启动到首窗口**          |

R1、R2 的行为均未被测试锁定 -- TDD 工作流要补这个缺口。

---

## 2. TDD 工作流总则

### 2.1 红-绿-蓝循环

每个可测阶段严格走 TDD：

1. **红**：先写失败测试，刻画当前问题行为或期望的新行为
2. **绿**：最小改动让测试通过
3. **蓝**：重构，保持测试绿色

### 2.2 测试模式选择（遵循 effect SKILL + AGENTS.md Testing）

| 测试对象                     | 模式                                                 | 理由                                                                                                |
| ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 纯函数（parseShellEnv 等）   | `it.effect` 或普通 `test`                            | 无副作用                                                                                            |
| shell env 异步探测（子进程） | `it.live`                                            | 涉及真实子进程 spawn（effect SKILL: "filesystem, git, child process, locks, real time 用 it.live"） |
| Effect 服务/Layer            | `testEffect(...)`                                    | 复用 runtime，避免手写                                                                              |
| 启动顺序/Electron 生命周期   | **不可单测**                                         | 用阶段 0 埋点 + 手动冒烟 + 回归测试替代                                                             |
| 并发 fiber 就绪              | `pollWithTimeout`/`Deferred`/`SessionStatus.Service` | 禁止 `Effect.sleep(N)` 等待（AGENTS.md Testing）                                                    |

### 2.3 测试命令（严格遵循项目边界）

```sh
# 单包测试，永不从根目录跑
bun --cwd packages/desktop test --timeout 30000
bun --cwd packages/aigcfroge test --timeout 30000
bun --cwd packages/core test --timeout 30000

# 类型检查（tsgo，非 tsc）
bun --cwd packages/desktop typecheck
bun --cwd packages/aigcfroge typecheck

# Lint
bun run lint
```

### 2.4 TDD 适用性矩阵

| 阶段               | TDD 可行性              | 策略                                             |
| ------------------ | ----------------------- | ------------------------------------------------ |
| 0 可观测性         | 低（日志非行为）        | 写 `perf()` helper 输出格式测试 + 手动验证日志   |
| 1 shell env 异步化 | **高**                  | 完整红-绿-蓝，`it.live` 测子进程                 |
| 2 窗口解耦         | 低（Electron 生命周期） | 搜索验证不依赖 + 埋点 + 手动冒烟 + 回归测试      |
| 3 sidecar/DB 优化  | 中（Layer 构建时序）    | `testEffect` 测 Layer 构建行为，但启动顺序靠埋点 |
| 4 次要优化         | 低                      | 回归测试 + 埋点                                  |

---

## 3. 实施阶段

### 阶段 0：可观测性先行（必须最先做）

**目的**：量化各阶段实际耗时，确认根因优先级，为后续每个阶段的收益度量提供基线。

**TDD**：

- **红**：在 `packages/desktop/src/main/logging.test.ts`（新建）写 `perf()` helper 测试，验证输出 `{ label, ms }` 结构
- **绿**：实现 `perf()` helper
- **蓝**：在启动链各节点插入 `perf()` 调用

**改动**：`packages/desktop/src/main/index.ts` + `logging.ts` 加埋点

```ts
// logging.ts 新增
const startupMarks: { label: string; ms: number }[] = []
export function perf(label: string) {
  const ms = performance.now()
  startupMarks.push({ label, ms })
  write("startup", label, { ms })
}
export function getStartupMarks() {
  return [...startupMarks]
}

// index.ts 各节点后调用：
//   perf("before-whenReady")  // main 开始
//   yield* Effect.promise(() => app.whenReady())
//   perf("after-whenReady")
//   perf("after-migrate")
//   perf("after-preferAppEnv")  ← 重点量化 R1（在 preferAppEnv 后）
//   perf("after-spawnSidecar")
//   perf("after-healthCheck")   ← 量化 R2/R3
//   perf("after-createWindow")
// windows.ts ready-to-show 回调里：perf("after-readyToShow")  ← 量化 R6
```

**关键度量点**：

- `after-preferAppEnv` 的 ms = R1 耗时
- `after-spawnSidecar` 到 `after-healthCheck` 的差 = R3 耗时
- `after-createWindow` 到 `after-readyToShow` 的差 = R6 耗时
- `before-whenReady` 到 `after-readyToShow` = 总启动时间

**验证**：

- `bun --cwd packages/desktop test`（perf helper 测试）
- 启动应用后查看 `<userData>/logs/<run>/main.log`，确认各 milestone 时间戳

**风险**：无（纯日志，不改行为）。

---

### 阶段 1：P0 - shell env 异步化（R1）

**问题**：[shell-env.ts:37](../../packages/desktop/src/main/shell-env.ts#L37) `spawnSync` 阻塞事件循环，调用点 [index.ts:189](../../packages/desktop/src/main/index.ts#L189) 在 `app.whenReady()` 之前。

**已验证前提**：

- `preferAppEnv` 设置的 `AIGCFROGE_EXPERIMENTAL_*` flag 读取点在 sidecar（server 层），主进程 `migrate()` 不读（已搜索确认）
- 主进程 `chdir(homedir())` 后无立即用 PATH 的操作（ripgrep 在 sidecar/core 层，不在主进程）
- 因此 shell env 探测可与 `app.whenReady()` 并行，只需在 sidecar spawn 前就绪

**TDD（完整红-绿-蓝）**：

**红**：在 [shell-env.test.ts](../../packages/desktop/src/main/shell-env.test.ts) 加 `loadShellEnvAsync` 测试（`it.live`，涉及子进程）

```ts
import { describe, expect, test } from "bun:test"
import { loadShellEnvAsync, parseShellEnv } from "./shell-env"

describe("loadShellEnvAsync", () => {
  test("loads env from a shell that exits 0", async () => {
    // 用 /bin/sh -c "env -0" 模拟，或用一个能立即返回的 shell
    const env = await loadShellEnvAsync("/bin/sh", { log: () => {} })
    expect(env).not.toBeNull()
    expect(Object.keys(env!).length).toBeGreaterThan(0)
  })

  test("returns null for nushell", async () => {
    const env = await loadShellEnvAsync("nu", { log: () => {} })
    expect(env).toBeNull()
  })

  test("falls back when shell exits non-zero", async () => {
    // 用一个不存在的 shell 路径触发 Unavailable
    const env = await loadShellEnvAsync("/nonexistent/shell", { log: () => {} })
    expect(env).toBeNull()
  })
})
```

**绿**：实现 `loadShellEnvAsync`（`spawn` 异步版，保留 `loadShellEnv` 同步版不删，可回滚）

```ts
// shell-env.ts 新增
import { spawn } from "node:child_process"

function probeAsync(shell: string, mode: "-il" | "-l"): Promise<Probe> {
  return new Promise((resolve) => {
    const child = spawn(shell, [mode, "-c", "env -0"], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: TIMEOUT,
      windowsHide: true,
    })
    let stdout = Buffer.alloc(0)
    child.stdout?.on("data", (chunk: Buffer) => (stdout = Buffer.concat([stdout, chunk])))
    child.on("error", () => resolve({ type: "Unavailable" }))
    child.on("close", (code) => {
      if (code !== 0) return resolve({ type: "Unavailable" })
      const env = parseShellEnv(stdout)
      if (Object.keys(env).length === 0) return resolve({ type: "Unavailable" })
      resolve({ type: "Loaded", value: env })
    })
  })
}

export async function loadShellEnvAsync(shell: string, logger: ShellEnvLogger): Promise<Record<string, string> | null> {
  if (isNushell(shell)) {
    logger.log(`[server] Skipping shell env probe for nushell: ${shell}`)
    return null
  }
  const interactive = await probeAsync(shell, "-il")
  if (interactive.type === "Loaded") {
    logger.log(`[server] Loaded shell environment with -il (${Object.keys(interactive.value).length} vars)`)
    return interactive.value
  }
  if (interactive.type === "Timeout") {
    logger.log(`[server] Interactive shell env probe timed out: ${shell}`)
    return null
  }
  const login = await probeAsync(shell, "-l")
  if (login.type === "Loaded") {
    logger.log(`[server] Loaded shell environment with -l (${Object.keys(login.value).length} vars)`)
    return login.value
  }
  logger.log(`[server] Falling back to app environment: ${shell}`)
  return null
}
```

**蓝**：重构 `preferAppEnv` 拆分 + index.ts 调用点改并行

```ts
// server.ts 拆分 preferAppEnv
export function preferAppEnvSync(userDataPath: string) {
  Object.assign(process.env, {
    AIGCFROGE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    AIGCFROGE_EXPERIMENTAL_FILEWATCHER: "true",
    AIGCFROGE_EXPERIMENTAL_EVENT_SYSTEM: "true",
    AIGCFROGE_CLIENT: "desktop",
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
  })
}

export function preloadShellEnv(logger: ShellEnvLogger): Promise<void> {
  const shell = process.platform === "win32" ? null : getUserShell()
  if (!shell) return Promise.resolve()
  return loadShellEnvAsync(shell, logger).then((shellEnv) => {
    if (shellEnv) Object.assign(process.env, shellEnv)
  })
}

// index.ts L189 附近
preferAppEnvSync(app.getPath("userData"))
const shellEnvPromise = preloadShellEnv(getLogger()) // 异步并行，不阻塞
// ... 中间其他初始化 ...
yield * Effect.promise(() => app.whenReady())
yield * Effect.promise(() => shellEnvPromise) // sidecar spawn 前确保 env 就绪
perf("after-preferAppEnv") // 此时 shell env 已就绪，但事件循环未被阻塞
```

**验证**：

- `bun --cwd packages/desktop test`（新增的 loadShellEnvAsync 测试）
- `bun --cwd packages/desktop typecheck`
- 阶段 0 埋点对比 `after-preferAppEnv` 耗时（应从 ~1-5s 降到 ~0，因为并行了）
- 手动启动确认启动期主进程不冻结（DevTools remote debugging port 9222）

**风险**：

- shell env 探测仍可能耗时 5s，但现在与 `app.whenReady()` 并行，不阻塞事件循环
- 回滚：保留 `loadShellEnv`（同步版）不删，出问题立即切回 `preferAppEnv`

---

### 阶段 2：P0 - 窗口创建与 sidecar 启动解耦（R2 + R6）

**问题**：[index.ts:348](../../packages/desktop/src/main/index.ts#L348) `Fiber.await(loadingTask)` 等 sidecar + health check 完成才创建窗口。

**已验证前提**：

- `createMainWindow` 搜索 sidecar/server/serverReady **零匹配**（[windows.ts](../../packages/desktop/src/main/windows.ts)）--不依赖 sidecar
- `createMenu` 同样**零匹配**（[menu.ts](../../packages/desktop/src/main/menu.ts)）--不依赖 sidecar
- 渲染端已有 Splash [renderer/index.tsx:335-339](../../packages/desktop/src/renderer/index.tsx#L335-L339)，`ready` memo 在 `sidecar.loading` 时显示 Splash
- `serverReady` Deferred 在 health check **之前** succeed（[index.ts:326](../../packages/desktop/src/main/index.ts#L326) vs [index.ts:336](../../packages/desktop/src/main/index.ts#L336)）
- IPC `awaitInitialization` 已注册（[index.ts:247-255](../../packages/desktop/src/main/index.ts#L247-L255)），等 `serverReady` Deferred
- `forwardInitializationFailure` 已把 loadingTask 失败转发到 serverReady，渲染端能收到错误

**TDD（低可行性，替代策略）**：

- 启动顺序涉及 Electron `app` 生命周期，无法单测
- **替代**：搜索验证（已完成，零依赖）+ 阶段 0 埋点 + 手动冒烟 + 现有 [index.test.ts](../../packages/desktop/src/main/index.test.ts) 回归

**改动**：`packages/desktop/src/main/index.ts` 调整 `createMainWindow` 时机

```ts
// 当前（L237-L365）：
yield* Effect.promise(() => app.whenReady())
// ... migrate, registerProtocol, setDockIcon, setupAutoUpdater, registerIpcHandlers ...
// ... startNetLog, spawnLocalServer, health.wait ...
yield* Fiber.await(loadingTask)   // ◄── 阻塞
mainWindow = createMainWindow()   // ◄── L350 才创建窗口
createMenu({ ... })

// 改为：
yield* Effect.promise(() => app.whenReady())
// ... migrate, registerProtocol, setDockIcon, setupAutoUpdater, registerIpcHandlers ...
// ... startNetLog ...
perf("after-preWindowSetup")

// 立即创建窗口，显示 Splash（渲染端加载后显示 Splash，等 serverReady）
mainWindow = createMainWindow()
createMenu({ ... })
perf("after-createWindow")

// sidecar 后台启动，不阻塞
const loadingTask = yield* Effect.gen(function* () {
  // spawn sidecar + Deferred.succeed(serverReady) + health.wait
}).pipe(forwardInitializationFailure(serverReady), Effect.forkChild)
// 不再 yield* Fiber.await(loadingTask)
// loadingTask 失败由 forwardInitializationFailure 转发到 serverReady，渲染端显示错误
```

**关键约束**：

- `createMainWindow` 必须在 `registerRendererProtocol`（L241）和 `app.whenReady()` 之后
- `createMenu` 依赖 `mainWindow`，跟随调整
- `registerIpcHandlers` 必须在 `createMainWindow` 前（渲染端会立即调 `awaitInitialization` IPC）
- `loadingTask` 的 `forwardInitializationFailure(serverReady)` 保证 sidecar 失败时渲染端收到错误（已有机制，[index.test.ts](../../packages/desktop/src/main/index.test.ts) 已覆盖其行为）

**验证**：

- `bun --cwd packages/desktop test`（index.test.ts 回归）
- `bun --cwd packages/desktop typecheck`
- 阶段 0 埋点对比 `after-createWindow` 时间点（应从 sidecar 启动后提前到 spawn 前）
- 手动启动确认窗口/Splash 立即出现，sidecar 后台就绪后自动连接
- 手动确认 sidecar 启动失败时渲染端显示错误（而非永久 Splash）
- 回滚：把 `Fiber.await(loadingTask)` 加回去即可恢复原行为

**风险**：

- 窗口提前创建，若 sidecar 启动失败，渲染端需正确显示错误 -> 已有 `initializationData` 的 `localServerStartup` 标记（[renderer/initialization.ts:6-15](../../packages/desktop/src/renderer/initialization.ts#L6-L15)），验证之
- `createMainWindow` 前的依赖顺序不能乱（registerProtocol -> createWindow -> createMenu）

---

### 阶段 3：P1 - sidecar 启动优化（R3，可选，阶段 1/2 见效后再评估）

**问题**：sidecar 导入整个 server 包 + 同步构建 57+ Layer。其中 **Database 迁移同步阻塞** Layer 构建。

**已验证**：

- [database.ts:33-43](../../packages/core/src/database/database.ts#L33-L43) `Layer.effect` 内 `yield* DatabaseMigration.apply(db)` **同步**执行，阻塞 `Layer.buildWithMemoMap`
- [models-dev.ts:239](../../packages/core/src/models-dev.ts#L239) `Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced("60 minutes"))))` **后台**，不阻塞
- 因此阶段 3 聚焦 **Database 迁移异步化**，ModelsDev 无需优化

**方向**（高风险，跨 core 层，需单独评估）：

1. **Database 迁移不阻塞 listen**：将 `DatabaseMigration.apply(db)` 从 Layer 构建移到 listen 后台，或用 `Effect.forkIn` 在 Layer 构建后异步执行
2. 需确认：迁移未完成时，Session/Event 查询若命中未迁移的表如何降级

**TDD（中可行性）**：

- **红**：在 `packages/core/test` 写测试，验证 `Database.node` Layer 构建在迁移未完成时不阻塞（或验证迁移后台化的新行为）
- **绿**：重构 `database.ts` Layer，迁移异步化
- **蓝**：调整依赖迁移就绪的消费者（Session 等）

**前提**：阶段 0 埋点确认 R3 是瓶颈（`after-spawnSidecar` 到 `after-healthCheck` 耗时显著，且 Database 迁移占主要部分）。

**风险**：**高**。跨 core 层，涉及 Layer 构建时序 + 迁移就绪语义 + Session/Event 消费者。可能破坏 Session V2 不变量（AGENTS.md V2 Session Core 8 不变量）。必须由熟悉 core 层的实施者评估，且需完整回归测试。

**建议**：阶段 1/2 完成后，用阶段 0 埋点重新评估 R3 是否仍需优化。若 Database 迁移耗时不显著（例如已迁移过，增量迁移少），则跳过本阶段。

---

### 阶段 4：P2 - 次要优化（R4 + R5）

**改动**：`packages/desktop/src/main/index.ts` 延迟非关键启动工作

```ts
// R4: startNetLog 延迟到窗口 ready-to-show 后
// 当前 L275 在 sidecar spawn 前调用
// 改为：在 windows.ts createMainWindow 的 win.once("ready-to-show", ...) 回调里追加 startNetLog

// R5: updater.start() 延迟
// 当前 L271 在 sidecar spawn 前调用
// 改为：ready-to-show 后启动，或 setTimeout(() => void updater.start(), 2000) 避免抢占启动期网络
```

**TDD（低可行性）**：回归测试 + 埋点验证。

**风险**：低。启动期网络日志丢失可接受（启动期请求少）；updater 延迟不影响功能。

**验证**：阶段 0 埋点确认启动期 I/O/网络减少。

---

## 4. 验证方法

### 4.1 量化验证（阶段 0 埋点）

启动应用后读取 `<userData>/logs/<run>/main.log`，提取各 milestone 时间戳，对比改动前后：

| 指标                        | 改动前                  | 改动后目标               |
| --------------------------- | ----------------------- | ------------------------ |
| `after-preferAppEnv` 耗时   | ~1-5s                   | <100ms（异步并行）       |
| `after-createWindow` 时间点 | sidecar+health 后       | whenReady 后立即         |
| `ready-to-show` 耗时        | sidecar+health+渲染加载 | 渲染加载（不含 sidecar） |
| 总启动到首帧                | 上述之和                | 显著降低                 |

### 4.2 行为验证

- 启动后窗口/Splash 立即出现（阶段 2）
- 启动期主进程不冻结（阶段 1，DevTools remote debugging port 9222 观察）
- sidecar 启动失败时渲染端显示错误，不永久 Splash（阶段 2）
- 启动后功能正常（会话、工具、文件操作等）

### 4.3 回归验证（改完即审流程）

每个阶段完成后：

1. `git diff -- <files>` 锁定本次改动
2. `bun --cwd packages/desktop test --timeout 30000`（受影响包测试）
3. `bun --cwd packages/desktop typecheck`（tsgo）
4. `bun run lint`（oxlint）
5. 手动冒烟：启动、打开会话、切换模式、关闭重启
6. 输出复查结论（影响文件/命中 skills/安全门禁/工程门禁/已运行命令/剩余风险）

---

## 5. 范围边界（不做什么）

| 不做                                                             | 理由                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| 不改 sidecar Layer 架构（阶段 3 除外，且需单独评估）             | 跨 core 层，风险高，阶段 1/2 已能覆盖主要收益           |
| 不改渲染端 app 包入口（`@aigcfroge/app`）                        | 跨包改动，渲染端已有 Splash 和 awaitInitialization 机制 |
| 不改 `loadShellEnv` 的探测策略（`-il` 优先）                     | 保持与上游一致，只改同步->异步                          |
| 不引入 Electron `contentTracing` 实时监控                        | 范围过大，阶段 0 的 performance.mark 已足够量化         |
| 不优化 ModelsDev 后台刷新                                        | 已验证 `forkScoped` 不阻塞 Layer 构建                   |
| 不改 vendor 桥接代码（effect-drizzle-sqlite/effect-sqlite-node） | AGENTS.md 豁免，oxlint-disabled                         |

---

## 6. 风险矩阵

| 阶段 | 风险                                   | 等级   | 缓解                                                                                     |
| ---- | -------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| 0    | 无                                     | -      | 纯日志                                                                                   |
| 1    | 主进程在 shell env 就绪前需要 PATH     | 中     | 已验证 migrate 不读 flag、主进程无立即用 PATH；保留同步版可回滚                          |
| 1    | 异步 spawn 的错误处理遗漏              | 中     | 保留 Unavailable/Timeout 分支，与同步版语义一致；TDD 覆盖                                |
| 1    | 测试用真实子进程不稳定                 | 中     | `it.live` + 合理 timeout；用 `/bin/sh` 而非用户真实 shell                                |
| 2    | sidecar 失败时渲染端未显示错误         | 中     | 已有 forwardInitializationFailure + localServerStartup 标记，手动验证之                  |
| 2    | createMainWindow/createMenu 依赖顺序   | 低     | 已搜索验证零 sidecar 依赖；严格保持 registerProtocol -> createWindow -> createMenu       |
| 2    | 启动顺序无单测                         | 中     | 搜索验证 + 埋点 + 手动冒烟 + 回归测试替代                                                |
| 3    | Layer 迁移异步化破坏 Session V2 不变量 | **高** | 阶段 1/2 后再评估；需 core 层专家；完整回归测试；遵守 AGENTS.md V2 Session Core 8 不变量 |
| 4    | 启动期网络日志丢失                     | 低     | 启动期请求少，可接受                                                                     |

---

## 7. 实施顺序与建议

```
阶段 0（可观测性） ──► 阶段 1（shell env 异步，TDD） ──► 阶段 2（窗口解耦）
                                                              │
                                                              ▼
                                                    量化评估 R3 是否仍需优化
                                                              │
                                                    ┌─────────┴─────────┐
                                                    ▼                   ▼
                                          阶段 3（DB 迁移异步）    阶段 4（次要）
                                         （高风险，慎入）         （低风险，可并行）
```

**建议**：

1. **阶段 0 + 1 + 2 一个 PR**（可观测性 + 两个 P0 修复），收益最大、风险可控
2. 阶段 1 是唯一完整 TDD 的阶段，严格走红-绿-蓝
3. 阶段 4 可与阶段 1/2 同 PR 或紧随其后
4. 阶段 3 单独评估，用阶段 0 埋点数据决策，且需 core 层专家参与

---

## 8. 附：上游性能资产移植评估

经核实，上游 `opencode-dev` 的 2 个渲染层基准均**无法直接移植**到本仓（本仓 fork 后未同步上游后续增强）：

| 基准                                         | 缺失依赖                                                                                                                                                                                                                                                                                                             | 移植条件                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `session-parent-hydration-benchmark.spec.ts` | `MockServerConfig` 缺 `beforeMessagesResponse` 字段（[mock-server.ts:16](../../packages/app/e2e/utils/mock-server.ts#L16)）；`measureSessionSwitch` 参数缺 `requiredPartID`/`requireBottomAnchor`（[session-tab-switch-probe.ts:102](../../packages/app/e2e/performance/timeline/session-tab-switch-probe.ts#L102)） | 需先同步上游 `mock-server.ts` 和 `session-tab-switch-probe.ts` 的签名增强 |
| `review-pane-scaling-benchmark.spec.ts`      | `file-tree-v2`/`session-review-v2-file-header` 组件选择器本仓不存在；`setupTimelineBenchmark` 缺 `newLayoutDesigns` 参数（[session-timeline-benchmark.fixture.ts:96](../../packages/app/e2e/performance/timeline/session-timeline-benchmark.fixture.ts#L96)）                                                        | 需先落地 review-panel v2 组件                                             |

**注意**：这两个基准是渲染层导航性能基准，与桌面端启动性能（本方案主题）无关。移植它们需要先同步上游的 mock-server/probe 签名或组件实现，属于独立的资产同步工作，不在本方案范围内。若需移植，建议作为独立 PR，先同步 `mock-server.ts` 和 `session-tab-switch-probe.ts` 的上游增强（注意品牌名 `mockOpenCodeServer`->`mockAigcfrogeServer`），再补基准文件。

本仓 `packages/app/e2e/performance/AGENTS.md`（13 条性能基准准则）经核实**已存在且与上游一致**，无需补。
