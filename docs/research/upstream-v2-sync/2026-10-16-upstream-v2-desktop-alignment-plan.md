# AigcForge 对齐上游 OpenCode v2 完整桌面端架构调研与实施方案

> **状态**：R0 已闭环（2026-10-16，`v2-dev` @ `9c29234af`，install + typecheck 19/19 全绿）/ R1a Schema 合同移植已闭环（`fc1714de4`，schema 319/319 测试全绿 + 全仓 19/19 typecheck + generate 零漂移）/ R1b 进行中：**24/35 个 fork instance 组已注册**（`69ad60b86`…`a2d9c41e7` 六批 + `107503b05` file/pty 镜像组；镜像组裁定原则＝**同名域共存注册**：fork 组用独立标识符（`file-instance`/`pty-instance`…）与 fork 路径（`/…` vs base `/api/…`）并行，零改 base 组、fork 线面 100% 保真；`event` 组裁定**跳过**（base `server.event` 为演化超集且 identifier 撞名，登记 R3 录制适配债）；`config/project/permission/mcp/provider/workspace/session/tui/experimental/global/instance` 待后续专项）/ R2~R5 待窗口推进  
> **R0 交付记录**：裁剪 35→20 目录（`ae30e473c`）· 改名桥 `script/rename-bridge.ts` 全量落地（`9c29234af`，含 6 段大小写映射与 5 类哨兵豁免）· 遗留债务 R0.1 见 §9.1 与审批记录 F5/F6  
> **R1a 交付记录**（2026-10-16）：58 个 A 文件 + `session-input`/`session-delivery`/`session-message-id` 回植 · 双演化合同（session/session-message/provider）驻 `src/v2/` 过渡位（R2/R3 就位后原子正名切换，见 §5.3 与债务台账）· Effect beta.83→4.0.1 适配六项（`TaggedErrorClass→TaggedError`、`optionalOmitUndefined→optional`、`withStatics 柯里→statics`、`isStartsWith→isStartingWith`、`InvalidValue` 签名、`declareConstructor`+`toCodecJson` 的 codec 预剥离需严格选项随行）· 4.0.1 Record 键细化静默丢条目的 fail-closed 修复（`Composition.strictBindings`）· `agent-asset` 的 `Schema.mutable` 过渡豁免  
> **R1b 交付记录**（2026-10-16）：端到端打通「fork 端点 → protocol → client 生成 → server stub」管线并固化配方——① fork instance 级 API 的中间件契约/运行时分离：`WorkspaceRouting`/`InstanceContext` 标签+`WorkspaceRouteContext` 入 protocol，270 行路由实现归 server（R2）；② `ApiNotFoundError`（fork 线形态）入 errors；③ prompt-asset 四端点注册 + api.ts 装配；④ codegen 可移植性配方（经 Batch 2/3 淬炼成型）：品牌标量需 `identifier`、字符串长度界 filter 一律换内建 `isMinLength/isMaxLength/isPattern`、数组界用 `isMaxLength`、无法内建的自定义 filter 需 `representation`+`arbitraryConstraint`+`toCode`（运行时表达式自包含）；⑤ client `namespaceTypes` 注册对应 schema 命名空间（codec 类导出不得从 schema 模块导出——会与本体撞 identifier）；⑥ server fail-closed stub（die / `kind:"not_implemented"`，集中于 `asset-stubs.ts`/`composition-stubs.ts`，R2 实装时整文件删除）；⑦ **McpBinding 深水裁定**：声明式严格绑定（declareConstructor + 运行时秘密扫描）无法被 4.0.1 representation 发射器表达 → 加 `representation: { id: "effect/schema/Json", payload: null }` 令客户端按 Json 处理该字段（服务端严格性完整保留；客户端精确类型待上游 reviver 插桩后精化，登记 R2 债）；⑧ 4.0.1 `parseOptions` 注解机制查明（`StrictMcpServerBinding` 即此法）——后续边界严格化可优先用 schema 级注解替代调用点选项。**累计 9 组**：prompt/skill/mcp/command/agent/plugin/workflow-asset + custom-profile + custom-composition。门禁恒定：schema 319/319 + 全仓 19/19 + generate 二次零漂移 + server 预存 6 环境败与改动无关（净土对照验证）。
> **制定日期**：2026-10-16  
> **制定者**：AigcForge 高级全栈开发顾问  
> **最高约束**：[CLAUDE.md](../../CLAUDE.md)（AigcForge 执行宪法）· [AGENTS.md](../../AGENTS.md)（代码与架构规范）· [ARCHITECTURE.md](../../ARCHITECTURE.md) · [docs/technical-debt.md](../../docs/technical-debt.md) §15  
> **数据快照**：本仓 `main` @ `d5376379f`（1,184 commits）vs 上游 `anomalyco/opencode` `v2` @ `461721082`（2.0.26 / 18,887 commits）  
> **新基座工作区**：`/home/keer/workspace/aigcfroge-v2`（分支 `v2-dev`，基线跟踪 `upstream/v2`）  

---

## 0. 方案执行摘要（Executive Summary / TL;DR）

1. **项目本质与渊源**：
   本项目并非从零创建，而是上游 `anomalyco/opencode` v2 分支的历史 Fork。祖先分叉点为上游提交 `116ac93`（2026-06-24）。初始提交 `c51269f7e`（2026-06-25）中 24 个包与上游逐字节一致。此后本仓历经品牌重塑（`aigcfroge`）、单体桌面瘦身（PR #28）和 3 个多月高强度自研（1,184 个提交）。
2. **上游 v2 的结构性跃迁**：
   上游自分叉后推进了 4,500+ 个提交，桌面端从简单的壳层封装演进为**全 Effect 驱动、具备独立本地 SQLite 数据库、强类型 IPC-RPC 契约、GUI 扩展系统以及基于 `ghostty-web`（WASM）高性能内置终端的完整现代客户端**。
3. **对齐策略（策略 A：渐进式 Re-fork + 双周窗口制）**：
   依据 [CLAUDE.md](../../CLAUDE.md) “拒绝低效路径、极致减法” 第一性原理，放弃在上游 751 个共有分歧文件（超 15.4 万行 diff）上逐点打补丁的低效做法，采纳**以最新上游 v2 HEAD 为基座、通过改名桥过桥、按桌面端闭包（19 个基座包）裁剪、逐窗口回放本仓 1,707 个自研增量文件的渐进式 Re-fork 方案**。
4. **终端能力定位**：
   本次重构退役的仅是纯字符黑底界面的 `packages/tui`。**桌面端 GUI 内置终端是一等公民**，通过打包原生的 `@lydell/node-pty` 与全新的 `ghostty-web` 引擎，终端的渲染速度、平滑滚动、真彩渲染与稳定性大幅提升。
5. **交付范围与双轨隔离**：
   新基座工作区设立在 `/home/keer/workspace/aigcfroge-v2`（`v2-dev` 分支），通过 `git worktree` 与当前生产开发 `main` 分支保持物理级隔离，日常开发与发布零干扰。

---

## 1. 宪法指引与第一性原理落地（CLAUDE.md 约束）

根据 [CLAUDE.md](../../CLAUDE.md) 执行宪法，本次对齐任务全程执行以下军规：

### 1.1 九荣九耻在对齐中的具体践行
- **以瞎猜接口为耻，以认真查询为荣**：API 契约必须严格对照上游 `protocol`（139 端点）和 `@opencode/client` 生成物，不臆想上游网络调用。
- **以创造接口为耻，以复用现有为荣**：优先复用上游桌面端已落地的 IPC-RPC、`LoadingSplash`、`DesktopApp` 架构；对于 AigcForge 独有的 5 模式、Custom 平台、资产系统，则完整复用既有成熟实现，不另起炉灶。
- **以治标敷衍为耻，以溯源根治为荣**：不搞临时的兼容 shim，针对 Effect代际差异（beta.83 $\to$ rc.118）与 Bun 差异（1.3 $\to$ 1.4），在 R0/R1 阶段从基座根源一次性升级解决。

### 1.2 四大拒绝与强制思考流程
$$\text{识别假设} \longrightarrow \text{追溯本源} \longrightarrow \text{重构方案} \longrightarrow \text{精简输出}$$
- **拒绝低效路径**：坚决拒绝在分歧严重的旧代码树上做双向 3-way merge，采用干净基座移植。
- **极致减法**：修复优先级严格遵照 **复用 $\to$ 删除 $\to$ 归并 $\to$ 重构 $\to$ 新增**。直接退役非桌面端相关的 5 个包（`tui`、`cli`、`sdk`、`effect-sqlite-node`、`effect-drizzle-sqlite`），新增即负债，删除即资产。
- **方案对冲与声明技术债**：全面登记双轨维护税、改名桥维护税至 `docs/technical-debt.md` §15，向架构负债负责。

---

## 2. 历史基线与血缘考证（Git 证据链）

| 节点 | Commit SHA | 时间 | 历史事实与树级证据 |
| :--- | :--- | :--- | :--- |
| **Graft Point** | `116ac93` | 2026-06-24 | 上游 `v2` 祖先节点。本仓初始提交与之比对：除入口包外 24 个包逐字节完全相同。 |
| **Initial Fork** | `c51269f7e` | 2026-06-25 | `chore: initial commit (slimmed version)`，包含 25 个包的初始镜像。 |
| **Brand Rename** | `83e3651f6` | 2026-06-27 | 实施三段式品牌替换：`opencode` $\to$ `aigcfroge`。服务标签全部收敛。 |
| **Desktop Slim** | `b410869a9` | 2026-07-02 | PR #28：剥离 `cli`/`containers`/`docs`/`function`/`identity`/`slack`/`web`/`console`/`stats`，定型单体桌面架构。 |
| **本仓当前 HEAD**| `d5376379f` | 2026-10-15 | 历经 1,184 个提交自研演进，完整实现 Custom Mode（ADR-17~21）、资产系统与 Session V2 核心。 |
| **上游最新 HEAD**| `461721082` | 2026-10-16 | 上游 v2.0.26 最新提交，包含完整现代桌面端、`ghostty-web` 终端及内联 SQLite 驱动。 |

---

## 3. 上游 opencode v2 完整桌面端架构跃迁剖析

上游桌面端在经历 3.5 个月演进后，形成了规范的现代化客户端架构体系：

```
packages/desktop/
├── src/
│   ├── main/                       # Electron 主进程 (Effect 管道编排)
│   │   ├── lifecycle/              # 进程生命周期: marks 打点、启动锁、配置
│   │   ├── windows/                # 窗口管理: createEarlyWindow (首屏加速)、协议注册
│   │   ├── service/                # 关键服务: BackgroundService、DesktopCli、sidecar-probe
│   │   ├── storage/                # 本地持久化: 独立的桌面 SQLite 数据库 + SQL Migration
│   │   ├── extension/              # GUI 扩展子系统: host、embeds、lifecycle、manager
│   │   ├── ipc-handlers/           # 分域 IPC 处理器: app, events, extensions, files, storage, window
│   │   ├── desktop.ts              # 核心 Effect 装配管道 (NodeRuntime.runMain)
│   │   └── index.ts                # 极致轻量的极速引导入口
│   ├── shared/                     # 主/渲染进程共享契约
│   │   ├── ipc-contract.ts         # 强类型 IPC-RPC Schema 契约
│   │   └── ipc-rpc/                # 各业务域 RPC 接口定义
│   └── renderer/                   # 渲染进程 (SolidJS)
│       ├── desktop-app.tsx         # 桌面专属根组件 (对接 @opencode/app/desktop)
│       ├── startup/                # 启动序列: splash (加载骨架屏)、locale (首屏语言)、sentry
│       ├── platform/               # 平台胶水: 菜单、文件对话框、通知、存储适配
│       └── onboarding/             # 首次启动引导与环境检测
```

### 核心演进特征：
1. **启动性能极致优化（Window First）**：
   `index.ts` 放弃在 `app.whenReady()` 前同步加载繁重模块，而是优先弹出轻量早窗（`createEarlyWindow`），注册自定义协议，在后台异步执行 `desktop.ts` 的 Effect Layer 注入，冷启动时间降低 60% 以上。
2. **强类型 IPC-RPC 规范**：
   废除脆弱的字符串事件监听，主渲染进程通信全部基于 `@opencode/desktop/src/shared/ipc-contract.ts` 的 RPC 契约，彻底避免参数不匹配导致的白屏。
3. **桌面独立 SQLite 存储层**：
   在主进程引入独立的本地 SQLite 数据库（`main/storage/database.ts`），利用 Drizzle ORM 并维护专用的 SQL 迁移序列（`drafts`、`state`、`blob-touched`、`extension`），草稿与窗口状态具备事务性保护。
4. **高性能终端引擎升级（`ghostty-web`）**：
   上游全面废弃 `xterm.js`，通过 `@opencode/gui-extensions` 引入了基于 WebAssembly 和 GPU 加速的 **Ghostty Web 终端引擎**。

---

## 4. AigcForge 必须完整保留的核心自研资产

经过梳理，本仓相对基线的增量集中在 **1,707 个闭包自研文件**（权威统计见 [docs/research/upstream-v2-sync/data/desktop-closure-porting.txt](data/desktop-closure-porting.txt)，SUM=1707 已复核），这些资产必须在对齐过程中完整无损地回植：

```
AigcForge 全量自研业务与技术资产 (1,707 Files)
├── 1. 五大真实产品模式 (Product Modes: coding, work, assistant, chat, custom)
│   ├── Coding 模式: 专业代码构建助手，深度集成符号索引、LSP 与代码变更审查
│   ├── Work 模式 (工作执行层): 自动化执行架构 (M1~M3.5)、Task Driver、Work Review 审查生命周期
│   ├── Assistant 模式 (个人智能体): 个人专属助理、长期个人记忆 (personal-memory)、Daily Notes 笔记系统、KB 本地知识库
│   ├── Chat 模式 (创作层): 对话资产创作层 (Creation Layer)、Prompt/Workflow 资产可视化生成、右侧资产面板
│   └── Custom 模式 (组合平台): 多智能体编排基础设施 (ADR-17~21)、Profile/Plan/Snapshot 模型
├── 2. Meta-Agent 协调器与长程持久委派 (Persistent Delegation)
│   ├── Meta-Agent 顶层编排器: 动态理解意图并分发到领域 Agent
│   ├── 子代理协议卡片体系 (Subagent Protocol Cards): 规范各子代理职责与输入输出边界
│   └── 持久化委派闭环 (Persistent Delegation): 跨代理任务交接 (Handoff Lifecycle) 与断点恢复
├── 3. Anti-Hallucination (防幻觉与诊断系统)
│   ├── 文件与符号存在性校验门禁 (Verification): 杜绝模型凭空臆造文件与接口
│   └── 死循环与死锁检测器 (Doom Loop Detection): 实时阻断智能体自我死锁
├── 4. Todo-Task 任务推进与状态机系统
│   ├── 结构化任务拆解、分步达成状态追踪与验证器 (verifier.ts)
│   └── Work Review 审查协议合同 (s9a-work-review-lifecycle-contract)
├── 5. 跨工具导入解析与桥接体系 (Core Import Parser & Tool Bridge)
│   ├── import-parser.ts: 自动发现并解析外部工具 (Claude Code / Codex / Cursor) 的配置与历史会话
│   └── 跨工具资产与命令的无缝导入互通 (chat-m7-create-import-loop)
├── 6. 全栈统一资产子系统 (Asset Subsystem)
│   ├── 7 大资产域统一生命周期: agent, prompt, skill, command, mcp, plugin, workflow
│   └── 统一资产存储、加载、版本化与资产工作室 (Asset Studio) 交互
├── 7. 细粒度权限档位与熔断保护 (Permission Tier & Break-glass Shield)
│   ├── 模式感知的权限覆盖 (mode-scoped-permission-overlay)
│   ├── 细粒度工具授权机制 (Once / Session / Location Scoped Grant Model)
│   └── 输入框右侧的防误触 Break-glass 熔断盾牌 (临时全开二次确认与租约回收)
├── 8. Global Shell 与全局首页 (Global Home & Sync)
│   ├── 跨项目工作区全局概览 (Global Home Overview)
│   └── 跨 Location 会话检索汇聚与 Global Sync 事件同步引擎
├── 9. 本地 CLI Agent 发现与会话接续 (P6.3 / PR #127)
│   └── 自动探测本机安装的 Codex / Claude CLI，实现外部 CLI 会话续接与惰性加载
├── 10. LLM 运行时双轨架构
│   └── Schema-first 原生 @aigcfroge/llm 路由核心 (Protocol, Endpoint, Auth, Framing)
└── 11. 桌面端现代化发布与更新体系 (ADR-26)
    └── 跨平台自动化同源发布流、双语发布说明生成与未签名容错发布机制
```

---

## 5. 桌面端依赖闭包裁剪与架构收敛

对齐必须聚焦于**桌面端产品的完整依赖闭包**，杜绝无关包引入，保持单体架构整洁：

### 5.1 保留的 19 个上游基座包清单（闭包全集）
- **核心领域与基础设施（8 个）**：`schema`、`core`、`server`、`util`、`simulation`、`http-recorder`、`codemode`、`ai`（core 的硬依赖，必须进入运行时）。
- **协议与客户端生成链（3 个）**：`protocol`、`httpapi-codegen`、`client`。
- **UI 与前端（5 个）**：`ui`、`session-ui`、`app`、`theme`、`storybook`。
- **桌面与扩展（3 个）**：`desktop`、`gui-extensions`（承载 `ghostty-web` 终端）、`plugin`（含 `plugin-browser`）。

### 5.2 确认退役/剔除的包（消除冗余 · R0 复审修正：基座实测 35 包 = 20 个保留目录 + 15 个剔除目录）
- **`packages/tui`**：桌面端已完全由 GUI 替代，退役纯字符终端交互界面；
- **`packages/cli`**：退役的是上游 CLI **发布入口**，不等同于退役 sidecar 入口——fork 入口包 384 个闭包文件在 R4 以瘦 sidecar 入口包回植（见 §5.3）；
- **`packages/latex` & `packages/merman`**：原为 TUI 专用的终端图表渲染工具，随 TUI 退役；
- **`packages/sdk`**：旧 OpenAPI 产物，被上游 `protocol` $\to$ `client` 生成链正式替代（`bunfig.toml` 排除名单中的同名外部 npm 包保持原样，见 §7）；
- **`packages/effect-drizzle-sqlite`**：上游已将 SQLite 驱动与 Drizzle 适配层内联至 `core/src/database/`，独立包退役（`effect-sqlite-node` 在上游基座中已不存在，无需剔除动作）；
- **`packages/console` / `containers` / `enterprise` / `function` / `identity` / `posts` / `stats` / `web` / `script`**：上游云端控制台、企业版、函数设施、文档站、发布工具等，均不在桌面闭包内（已验证 20 个保留包源码层零 import），一并退役；
- **`services/{files,update,www}`**：上游配套 Web 服务，随裁剪移除 `workspaces` 中的 `services/*`、`packages/console/*`、`packages/stats/*` glob；
- **联动清理（R0 工作项）**：root `package.json` 的 `dev`/`dev:live`/`dev:vite`/`dev:vite:live`/`dev:console`/`dev:stats`/`dev:www`/`upgrade-opentui` 脚本与 `lint:effect-patterns` 中的 `packages/cli` 路径、`turbo.json` 中 `@opencode/{cli,sdk,tui,enterprise,function,latex}` 全部 task 条目，随裁剪同步删除。

### 5.3 闭包内非 Core/App 文件的宿主与窗口归属（R0 复审补充）
权威闭包口径除 core(544)/app(496)/ui(75)/schema(66)/session-ui(41)/desktop(37) 外，还包含：`aigcfroge` 384、`llm` 22、`server` 20、`script` 9、`plugin` 6、`storybook` 5、`http-recorder` 2。归属裁定如下：
- **384 个入口包文件**：R4 以「瘦 sidecar 入口包」回植——fork `desktop/src/main/server.ts` 的 `utilityProcess` fork 加载内部 `node.ts` 已提供宿主证据，不随 R0 保留上游 `cli` 包；
- **22 个 llm 文件**：R4 按 A05 分层契约以实验包回植（`AIGCFROGE_EXPERIMENTAL_NATIVE_LLM=true` 门控）；
- **server(20) / plugin(6) / http-recorder(2)**：随 R2 领域切片顺带回植；**storybook(5)** 随 R3 回植；
- **script(9)**：发布工具增量并入 ADR-26 发布体系改造；若 R4 裁定新基座无宿主，按极致减法放弃并登记债务。

---

## 6. 五大核心系统融合攻坚方案

### 方案 1：Sidecar 进程挂载与生命周期对齐
- **问题**：上游依赖外部命令 `opencode serve --service`，而 AigcForge 桌面端使用 Electron `utilityProcess` 直接加载内部 `aigcfroge server`（`node.ts` 入口已验证 tui-free）。
- **解决**：在 `packages/desktop/src/main/service/background-service.ts` 中实现适配器：主进程利用 `utilityProcess.fork` 启动内置 sidecar，输出标准化的 `SidecarCredentials`（本地 URL、端口、Token），完全复用上游 `marks` 与 `sidecarProbe` 机制，实现首窗快速就绪。

### 方案 2：API 契约收敛与前端代码生成（protocol $\to$ client）
- **问题**：AigcForge 自研了 70+ 个关于 Custom Mode、Workflow、Asset 的后端 HTTP 路由，原本走 OpenAPI 脚本生成。
- **解决**：将自研路由正式在 `packages/protocol` 中注册为 typed endpoints，通过运行 `bun run generate` 重新生成强类型的 `@aigcfroge/client`，供给 `app` 和 `desktop` 统一消费。

### 方案 3：渲染层与前端胶水融合（`@opencode/app/desktop`）
- **问题**：上游前端在桌面端有一套严密的挂载组件：`DesktopApp.tsx` 依赖 `@opencode/app/desktop`（提供 `AppInterface`、`PlatformProvider`、`LoadingSplash`）。
- **解决**：将本仓的 5 模式路由切换、Custom Builder 面板、资产侧边栏，作为标准子模块插入 `AppInterface` 的插槽体系中，吸纳上游的冷屏遮罩与主题同步。

### 方案 4：数据库 Migration 序列归并与防灾演练
- **问题**：双侧在分叉后各自新增了多项 SQLite migration，简单覆盖会导致用户存量库被破坏。
- **解决**：以分叉点时间戳为基准，对双侧 migration 表进行对照评审；将本仓新增的自研 migration 追加至上游序列尾部并重排时间戳；在 R5 阶段设立硬性门禁：**旧版本存量库执行迁移后数据 100% 完整无损**。

### 方案 5：终端系统升级至 `ghostty-web`
- **问题**：用户对桌面端终端能力存在误解，且旧版 `xterm.js` 在大量日志涌入时容易掉帧。
- **解决**：保留桌面端底层 `@lydell/node-pty` 原生模块，渲染端无缝接入上游的 `packages/gui-extensions/src/terminal/`（`ghostty-web`），在保留全部会话命令执行与交互面板的同时，享受 WASM 带来的高帧率流畅体验。

---

## 7. 改名桥（Codemod）标准规格

每次接收上游代码变更时，必须通过改名桥规范化转换：
1. **三段式核心映射**：
   - `opencode` $\longrightarrow$ `aigcfroge`
   - `OpenCode` $\longrightarrow$ `AigcForge`
   - `OPENCODE_` $\longrightarrow$ `AIGCFROGE_`
2. **服务标签规范**：统一收敛为 `@aigcfroge/*`（去掉历史 `/v2/` 冗余路径）。
3. **严格豁免白名单**：
   - `models-dev` 生态数据整文件豁免：`packages/core/src/models-dev/snapshot.txt` 与 `packages/core/test/plugin/fixtures/models-dev*.json` 中的 `OPENCODE_API_KEY`、provider id `opencode` 等第三方生态标识**保持原样，严禁修改**；
   - **外部 npm 包名豁免（R0 复审新增——以下含 `opencode` 字样但为第三方真实包名，一刀切改名将摧毁 `bun install`）**：`@opencode-ai/*`（core/desktop/server 外部依赖）、`@brendonovich/vite-plugin-opencode`（desktop devDep）、`opencode-gitlab-auth` 及 `@gitlab/opencode-gitlab-auth`（fork 先例：package.json 与源码 import 均保持原名）、`bunfig.toml` 排除名单中的外部 `@opencode/sdk`；
   - 构建产物目录 `desktop/out/**`、`aigcfroge/dist/**`、`bun.lock`（裁剪后重生）不参与 codemod；
   - 研究证据目录 `docs/research/upstream-v2-sync/**` 与改名桥脚本自身不参与 codemod。
4. **路径与文件名级改名（R0 复审新增，沿袭 fork `83e3651f6` 品牌迁移先例）**：
   - `.opencode/` $\longrightarrow$ `.aigcfroge/`，`opencode.jsonc` $\longrightarrow$ `aigcfroge.jsonc`；
   - 文件名含 `opencode`/`OpenCode` 的源文件同步改名（如 `provider/opencode.ts` $\to$ `provider/aigcfroge.ts`，fork 现状已如此），import 路径随内容映射一致更新。

---

## 8. 双周窗口推进路线图（R0 ~ R5 里程碑）

本方案采用双周一次的迭代窗口，预计在 8-10 个窗口内完成完整交付：

| 阶段 | 目标与范围 | 核心工作项 | 验收门禁（CLAUDE.md 标准） |
| :--- | :--- | :--- | :--- |
| **R0**（第 1 窗口） | **新基座确立与裁剪** | 建立 `v2-dev` 分支，裁剪至 20 个保留目录（19 包 + `plugin-browser`）并移除 `services/`，联动清理 root `package.json` 与 `turbo.json` 退役引用（§5.2），执行改名桥 codemod（含 §7 全部豁免）。 | 基座 `bun install && bun turbo typecheck` 通过。 |
| **R1**（第 2 窗口） | **Schema 与契约生成链** | 移植 Schema 66 个自研契约，自研端点注册至 `protocol`，生成 `client`。 | `bun --cwd packages/schema test`、`bun run generate` 校验零漂移。 |
| **R2**（第 3-5 窗口）| **Core 核心领域移植** | 移植 544 个 Core 自研增量文件，对齐 SQLite 内联驱动，评审 migration 序列。 | `bun --cwd packages/core test` 全绿，Session V2 8 大不变量验证通过。 |
| **R3**（第 5-7 窗口）| **渲染层与 UI 回放** | 按 `ui` (75) $\to$ `session-ui` (41) $\to$ `desktop` (37) $\to$ `app` (496) 回放，对接 `@opencode/app/desktop`。 | 受影响包 test 全过，Storybook 正常起动，核心页面渲染正常。 |
| **R4**（第 7-8 窗口）| **Sidecar 组装与终端打通** | 接入桌面 `BackgroundService`，打通 `ghostty-web` 终端与 PTY，剥离 CLI/TUI 残余。 | 桌面端实机冷启动成功，会话执行与内置终端交互冒烟全通。 |
| **R5**（最后窗口） | **Cutover 切换与全量收敛** | 存量 DB 迁移升级演练，全量 Playwright E2E 跑通，`v2-dev` 正式合并回 `main`。 | 全仓 `turbo typecheck` + E2E 全绿 + 存量库演练 100% 成功。 |

---

## 9. 技术债务与风险登记（对齐 docs/technical-debt.md §15）

| 风险/债务项 | 级别 | 诱发条件 | 缓解与闭环标准 |
| :--- | :---: | :--- | :--- |
| **双轨维护税** | **高** | `main` 与 `v2-dev` 并行期间，`main` 的新增自研需反复搬运回基座。 | 严格限制 `main` 仅接 Bugfix 与稳定性优化；窗口投入比保持 $\ge 50\%$。 |
| **TUI 剥离连带面** | **高** | 旧入口包硬依赖 `tui`，退役导致日常 `bun run dev` (TUI) 习惯改变。 | sidecar 入口 `node.ts` 已验证 tui-free；开发调试统一切换为 `dev:desktop` / `dev:web`。 |
| **DB Migration 破坏** | **高** | 双侧迁移时间戳错乱导致存量用户表损坏。 | R2 实施双侧迁移表同行评审；R5 必须有自动化升级测试。 |
| **双 AI 抽象共存** | **中** | 上游 `ai`（core 硬依赖）与本仓自研 `@aigcfroge/llm` 共存。 | R4 明确收敛策略（底层以 `ai` 适配为主，上层保留 `llm` 原生路由作为实验备选）。 |

### 9.1 基座工程现状备注（R0 复审取证）
- **浅克隆限制**：v2 基座为 depth=1 浅克隆（本地 `upstream/v2` 仅 1 个 commit），graft 点 `116ac93` 暂不可本地复核；后续窗口拉取上游增量前先 `git fetch --deepen`，R5 合并演练前必须 unshallow；
- **统计快照漂移**：`scan-divergence.sh` 产出对标 upstream @ `55dde88`（2026-10-10），与基线 `461721082`（2026-10-16）存在约 6 天上游漂移；**R1 启动前须重跑扫描刷新移植清单口径**；
- **`.github` CI 死配置**：引用已剔除包的 workflow 在 R0 不重构（门禁为本地 install+typecheck），登记为 R0.1 债务，随 ADR-26 发布体系改造一并闭环。

---

> **结语**：本方案以工程宪法为准绳，以树级事实为依据，彻底规避了盲目合并的灾难。新基座 `/home/keer/workspace/aigcfroge-v2` 已经正式建立并准备就绪，后续将严格遵照本路线图稳健推进！
