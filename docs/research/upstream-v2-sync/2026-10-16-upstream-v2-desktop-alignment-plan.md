# AigcForge 对齐上游 OpenCode v2 完整桌面端架构调研与实施方案

> **状态**：R0 已闭环（`9c29234af`）/ R1a 已闭环（`fc1714de4`）/ **R1b 合同面全量达成**（batch 1-12 + 压轴 `a9e526e5c` = `session` 45 端点端到端注册；累计 **33 个组条目 / ≈245 端点合同**，含生成客户端与 fail-closed stub，全仓 **19/19** 恒绿；裁定跳过 tui/event/experimental；`global` 组归 R2/R4 control-plane 伴随切片——见 §9.3 Ledger）/ R2~R5 待窗口推进  
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

### 9.2 server 测试 6 败定界报告（2026-10-16，三分定界完成）

基座 `bun --cwd packages/server test` 的 6 个失败已完成根因定界（含 pristine upstream `461721082` 净土对照复现）：
- **Class A（3 个，OAuth 端口 1455/1457 族）＝ 真实数据污染，我方环境问题，已解决**：codemod 后基座测试与 fork 实际运行共用品牌数据目录 `~/.local/share/aigcfroge`，测试读到用户真实 auth/worktree 状态而碰撞（实证：`WorktreeError: destination already exists … 3a81d2/custom-10` 为 fork 真实 worktree）。**约定（全员遵守）**：本仓运行 server/core 测试一律带 XDG 隔离——`XDG_DATA_HOME/XDG_CACHE_HOME/XDG_CONFIG_HOME/XDG_STATE_HOME` 指向 /tmp 隔离目录后，Class A 三个测试全部转绿；
- **Class B（3 个：插件夹具 2 + 下载中止 1）＝ 上游自身问题，与本次迁移无关**：在 pristine upstream worktree 上以同样隔离环境复现同样失败（插件 fixture 在测试环境中静默未加载 config 插件；下载中止测试 5s 超时）。登记为上游债务（R5 E2E 前复核上游是否修复/CI 环境差异），**不阻塞 R1b/R2**。

### 9.3 R1b 剩余攻坚与跳过裁定（2026-10-16 更新 · 精确 Ledger）
**Ledger**：fork instance 级 35 组文件 → 已注册 **32**（含 pty 拆分 pty-instance/pty-connect-instance 两条目）· 剩余可注册 **3**（`session`/`instance`/`global`）· 裁定跳过 **3**（`tui`/`event`/`experimental`）。

- **`tui` 组：裁定跳过（已闭环）**。消费面审计：fork 侧零非 TUI 消费者；R0 已退役 tui 包与客户端，按桌面端闭包原则不注册。未来终端控制端点归 R4（ghostty-web）。
- **`event` 组：裁定跳过（batch 7 已闭环）**。base `server.event`/`/api/event` 为演化超集机制，且 identifier 撞名会破坏 OpenAPI；登记「R3 期间 app 事件消费切换 + 录制适配」债务。
- **`experimental` 组：裁定跳过（本轮闭环）**。消费面审计：`app`/`session-ui` 零 `.experimental.*` 调用；其 capabilities/console/tool/session/resource 服务对象为 CLI/TUI 时代客户端，不入桌面闭包。
- **`global` 组：注册（伴随切片）**。消费实证：fork `control-plane/workspace.ts`（远地工作区同步引擎）消费 `/global/event` 与 `/global/health`；与 R2/R4 的 control-plane 移植同窗口执行（提升源：core account、v1 config（**已备**于 `schema/v1/config/`）、EventV2）。
- **`instance` 组：注册（app 强消费）**。消费实证：fork app 文件变更 UI 直接调用 `client.vcs.diff/status` 等（`secondary-sidebar.tsx`/`git-state.ts`/`session.tsx`）——vcs.status/diff/apply/stage/unstage + instance/dispose 属 app 闭包核心面，须注册（可与 session 切片合并执行）。
- **`session` 组（压轴专项）：测绘完成，含 54 端点 / 12 提升源**——入口 `session`(1170 行)/`prompt`(1961 行)/`revert`/`status`/`summary`/`todo` + core `v1/session`(schema 侧已备)/`tool-summary`/`cache-diagnostics` + schema 侧 `SessionIdentity`/`SessionTask`/`WorkflowAsset`/`Composition`/`ProductMode`/`PermissionTier`（均已备）。含 task 五件套（get/patch/create/delete/reorder 原子变更）、permission break-glass 三件套（override get/put/delete）、workflow 五件套（run/cancelRun/cancelStep/retryStep/get）、cacheDiagnostics/toolSummary/composition 等产品核心面。**独立窗口执行**，执行时零再探。



---

---

## 10. R2 开窗研究（2026-10-16，Slice 2.1 可执行化）

### 10.1 Core 增量分布（权威：fork-delta，544 = 372 A + 171 M + 1 D）
`src/tool` 62 · `src/session` 54 · `src/database` 38 · `test/plugin` 31 · `src/plugin` 12 · `src/delegation` 12 · `src/agent` 12 · `src/config` 8 · `src/workflow` 6 · `src/util` 6 · `src/mcp` 6 · `src/github-copilot` 6 · `src/v1` 5 · **`src/system-context` 5** · 其余小域。

### 10.2 Core 侧双演化缝地图（R2 每个切片的通用处理规约）
1. **合同重映射（缝 A）**：fork core 文件 import `@aigcfroge/schema/session|session-message|provider` 期望 fork 形态——移植时**机械重映射至 `@aigcfroge/schema/v2/*`**（与 R1a 过渡位对接；R3 末正名切换时统一回改）。其余 schema 模块（permission-tier/workflow-asset/composition/session-task/session-identity 等）为已融合 canonical，直用无需重映射。
2. **`session/schema.ts` 解析缝（缝 B）**：双侧该 shim 文本同构（`export * as SessionSchema from "@aigcfroge/schema/session"`），区别仅在**解析目标**——无需文本手术；随缝 A 重映射同步生效（移植文件的 `./schema` import 保持不动，被重映射的是其深层依赖）。
3. **`../event` 重构缝（缝 C）**：fork `core/src/event.ts`（EventV2 服务，M 文件）在 base 已重构为 `core/src/event/` 目录 + event-logger——**上游演化缝**，需事件系统专项对账（后续切片）；Slice 2.1 内先以最小适配层（fork 调用面映射至 base event/）隔离，登记专项债务。
4. **fork-only 闭包模块**：`session/correction-store`、`meta-agent/sql`、`permission/effective`、`session/verifier`×2（delta 内）+ `instruction-context`（fork 保留-上游新删，delta 外）——直 port。

### 10.3 Slice 2.1（Core 地基）执行记录（2026-10-16，首波已落地 `c36e0a0d0`）
**首波交付**（17 文件：15 port + 2 件合并）：`system-context/`×6（代数/内置/修正事实/权限态/反向引用/注册表）· `session/context-epoch.ts`（Epoch 持久化）· `session/verifier.ts`+`verifier-prose.ts`（防幻觉验证器）· `session/correction-store.ts` · `session/verification-router.ts` · `session/history` 复用（base 演化版 `latestCompaction(db, id, "latest")` 直接适配 ✓）· `session/message-id.ts` · `permission/effective.ts`（模式感知权限重写，只读归一）· `meta-agent/sql.ts` · `instruction-context.ts` · `flag/flag.ts`（fork 保留件）· `util/record.ts`；合并增量：`session/error.ts`（+ContextSnapshotDecodeError）、`session/sql.ts`（+SessionContextEpochTable，迁移债随 R2 迁移切片）、`schema/session-event.ts`（+Verify 三事件、+ContextUpdated）、`schema/config.ts`（+meta 字段）、`schema/config/meta.ts`（新：ConfigMeta 家族）。
**首波淬炼的 R2 配方**（实证新增）：① **EventV2 即 Bus**（机械改名，`latestSequence` 逐字同源——事件缝去风险）；② `Event.durable` 投影器 = `commit: (seq) => 闭包直写 db`（无 tx 句柄）；③ 事件载荷**无 timestamp 字段**（base 内部计时）；④ declaration-emit 下**禁止自命名空间+同名 interface**（`composite+emitDeclarationOnly` 触发 private-name）→ 换名 `SystemContextValue`（namespace 保留、消费点机械改名）；⑤ v1 合同只读化波纹=局部数组改 `T[]` 可变（输出仍收口 Ruleset）；⑥ `Config.Info.meta` 为 fork 保留字段（ConfigMeta 家族已入 schema）。
**门禁成绩**：core 0 错 · schema 0 错 + **319/319** · 分包 19/19 全绿（storybook 假阴性已排除——本无 typecheck 脚本）· server 测试 **3 败**（XDG 隔离下 Class A 三败转绿实证 ✓，余 3=Class B 上游件）。
**下一步（Slice 2.2 开篇已动手）**：`execution` 域裁决完成——**base 的 execution.ts 是大幅演化版（write-ahead claim/生命周期事件/Job 集成，即 AGENTS 记载的现行架构），fork 版为旧基线**；方向反转为「base 为真值 + 回植 fork 语义增量」。已回植：`product-mode-policy.ts` + `product-mode-agent-policy.ts` + 官方测试**10/10 全绿**（`5adfa94ad`，5 模式治理核心 D12 实测于基座）。**D12 门禁接线**（`assertRuntimeSupported(session.mode)` 入 base drain）依赖 fork 合同正名切换（base 会话暂无 mode 字段）——登记为 R3 切换后的回接线任务。**runner 五件 M 文件裁决**（index/llm/model/publish-llm-event/to-llm-message，fork 净增量提取）→ **已闭环，见下**。

### 10.4 Slice 2.2 主体落地（2026-10-16，`21336fcd3`，承接 `5adfa94ad`）

**交付**：
1. `session/runner/attachment-resolver.ts`（95 行，D2(b) 延迟附件解析——客户端 `file://` 于 provider turn 前在会话 Location 内解析，`realPath` 双侧比对，越界/穿越/符号链接逃逸一律**拒读**转显式文本标记）+ `session/runner/auth-seam.ts`（28 行，模块级凭证缝，resolver 继承调用方 Effect 上下文）；
2. **官方测试双件移植**（`attachment-resolver.test.ts` 6 例安全验证 + `session-runner-auth-seam.test.ts` 3 例上下文传播）**9/9 全绿**；
3. **驻留补全（根正）**：实证 fork **从未修改** `schema/prompt`（delta 零增量）——fork 的 hybrid `FileAttachment{uri, mime, name?, description?, source?}` 即**基线形态**，base 已演化为 data 型。新驻留 `schema/src/v2/prompt.ts`（基线内容 + `.js` 后缀规范 + `withStatics→statics` 配方）+ `v2/session-message.ts` 重接 `./prompt.js` —— 驻留合同集修复为 **{session, session-message, provider, prompt}**，resolver 直连真合同（`SessionMessage.Message`/hybrid `FileAttachment` 全恢复原形）。

**runner 五件 M 裁决（证据链）**：

| 文件 | 裁决 | 证据 |
| :--- | :--- | :--- |
| `publish-llm-event.ts` | **SKIP（base 超越）** | base `StepRecord{outputStarted, providerFailed, failure, finish, needsContinuation}` 记录协议 + `step.ts:120/161/190/200/204` 重试分类（fork `textStarted/aborted` 启发被覆盖）；`Step.Ended` 经 `step.ts:255` 发布、`projector.ts:700/796` 投影计费（fork `onStepFinish` 被覆盖） |
| `to-llm-message.ts` | **SKIP（结构不可达）** | base schema 强制 `FileAttachment{data(Base64), mime, source}`——裸 URI 无法存在于 base 消息形态（schema 级保证）；base 已有 uri→text 回退（`attachmentLocation`/`textAttachment`）。fork 非 data 守卫在 base 架构下结构不可能 |
| `model.ts` | **LEDGER（fork 流库存）** | base 为 ModelResolver 目录流（`resolve(session, available)` + capabilities/cost/compaction/transport）；fork 为路由直构流（`@aigcfroge/llm` protocols + auth-seam 凭证 + `resolve(session, intent?)`）。两架构各自成立，fork 版随 fork runner 流正名后接线 |
| `index.ts` | **LEDGER（随 D12 接线）** | 增量 = 治理双错误 `SnapshotDriftError`（MEDIUM-3 自定义模式快照漂移防工具集宽化）+ `AgentProvenanceError`（资产溯源）+ RunError 联合扩展 ProductMode 三错误；thrower 均在 fork `llm.ts`——与 D12 门禁同批接线 |
| `llm.ts` | **LEDGER（专用切面，闭包门控）** | fork 单体 1219 行 vs base 分解式 375 + `step.ts`(325) + `retry.ts`(115)。fork 导入闭包实证依赖：composition digest/catalog、`agent/meta/intent` 分类器、skill guidance、AppProcess/InstallationVersion/Shell/Question 等域——**必须先落闭包前置域**（delegation/agent/composition/skill），属正名切换后专用子切片 |

**新配方**：⑦ **驻留补全判据**——fork-delta 零增量的 M 文件，其 fork 形态即基线形态；驻留层须复制**该文件本身**（连同其依赖链的基线形态），禁止依赖 base 演化版（R1a 驻留不完整的根因）。

**门禁成绩**：core **0 错** · schema **0 错 + 319/319** · 分包 **19/19 全绿** · 治理测试 **10/10** · resolver+seam 测试 **9/9**。

**下一步（Slice 2.3 入口）**：fork `llm.ts` 闭包前置域（`delegation` 12 · `agent` 12 · composition/skill 目录）优先，或 `session` 主体 54 件接缝分类——入口时按「解锁 fork runner 流」价值排序。

### 10.5 Slice 2.3 叶域首波（2026-10-16，`3f51155d8`）

**依赖探针定界**（fork llm.ts 闭包逐域 grep）：`cache`/`composition`/`installation`/`question` **零内核相对依赖**（叶域，本波落地）；`delegation` 重依 `session/sql`+`tool`（后置）；`workflow` 依 `composition/digest`+`session/task`+`tool/task-driver`（后置）；`skill` 两件依 `agent`（第二环）。

**交付（7 源件 + 5 测试件，26/26 全绿）**：
- `id/id.ts`（**M 件**＝fork 权威形态：schema/identifier 前缀包装层，13 种前缀含 workflowRun/workflowStep）直 port；
- `util/hash.ts`（noble→`node:crypto` 等价重写，`Hash.fast`/`Hash.sha256` 输出逐字节同源）+ 官方测试；
- `cache/cache-shape.ts`（前缀形状快照+诊断，直供 cacheDiagnostics 端点）+ 官方测试；
- `composition/digest.ts`（规范化字典序 sha256 → `Composition.Digest`，SnapshotDrift 校验桩）+ `consumer-view.ts`（schema 侧纯再导出）+ 官方测试；
- `installation/version.ts`（AIGCFROGE_VERSION/CHANNEL 全局声明）；
- `question.ts`（198 行：QuestionV2 服务，ask/reply/reject/list + 三事件 + Location 实例隔离语义）+ 官方测试（生命周期/拒绝/隔离三例）。

**新配方**：⑧ **事件定义转换**——fork `EventV2.define({type, schema})` 无 durable 选项时 → base `Bus.ephemeral({...})`（bus.ts:88-89 再导出工厂）；`EventV2.Service` → `Bus.Service`；测试接线 `AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]))` + `Layer.provide`/`Layer.mergeAll` 引用共享（同一 layer 引用两处出现 = 同实例，fork 测试的隔离语义可直搬）。⑨ **依赖等价重写**——base 缺第三方依赖（@noble/hashes）时以标准库等价实现，且**以 fork 官方测试自身断言背书**（hash.test 断言与 node:crypto 逐字相等）。⑩ **命名碰撞规避**——模块自有导出（question.ts 的 `Event` 注册表）与 schema 工厂撞名时，改用 Bus 再导出而非 rename import（零别名原则）。

**门禁成绩**：core **0 错** · 新旧测试 **26/26** · 分包 **19/19 全绿**。

**Slice 2.3 续篇路线**：第二环 = `skill/composition-catalog.ts` + `skill/guidance.ts`（依 composition✓ + agent）→ `agent/meta` 六件（intent/engine-selector/memory/mention/meta-prompt/prerouter）→ `agent` 编排三件 → `config` 8 → `delegation` 12（待 session/tool）→ `workflow` 6。`composition-resolver.ts`（fork 顶层新件）随 composition 完整切片入列。

### 10.6 Slice 2.3 第二环（2026-10-16，`cd458af70`）

**交付（10 源件 + 3 测试件，全绿）**：
1. **skill 双件**：`composition-catalog.ts`（43→48 行，适配 base 技能形态）+ 官方测试 **3/3**；`guidance.ts`（105 行，含 Custom Snapshot 作用域目录 + 权限门 + SystemContext 代际更新文本）；
2. **agent/meta 五件**（纯叶/链式，零外部依赖）：`intent.ts`（正则意图分类器：7 类 3 复杂度）→ `engine-selector.ts`（意图→引擎派发表）→ `mention.ts`（@提及解析+工作流模式）→ `prerouter.ts`（确定性预路由管道：mention 优先/分类/置信度）；`meta-prompt.ts`（{{SUBAGENTS_LIST}}/{{CLI_LIST}}/{{ASSETS_LIST}} 填充器 + 顺序无关性设计）；
3. **prompt 三编排器**（纯提示词常量）：assistant/chat/work-orchestrator；官方测试双件（meta-prompt + work-orchestrator）**19/19 全绿**。

**新配方**：
- ⑪ **技能域演化映射**（fork 用户面基线 `{name, location}` → base 演化 `{id, name, path, autoinvoke}`）：catalog `location→path` 机械改；guidance `Skill.available(list, agent)` → `Skill.available(list, agent.permissions)`（**资源语义分歧 name vs id 登记 LEDGER**，正名切换后对账）；`AgentV2.Selection→Agent.Selection`；`SystemContext.SystemContext→SystemContextValue`（2.1 换名连锁）；`PermissionV2.evaluate→Permission.evaluate`（签名逐字同源 ✓）。
- ⑫ **品牌型断言**：bun:test `toBe/toEqual` 与品牌型（Skill.Name）类型摩擦 → 期望值用品牌构造（`Skill.Name.make(...)`），类型与运行时可证。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · catalog **3/3** · meta-prompt+work-orchestrator **19/19**。

**第三环预告**：agent 交叉件（`asset-bridge`/`file-loader`/`judge`/`meta/memory`）依赖 asset 域（`agent-asset*`/`skill-asset*` 6 件 + `schema/skill-asset`）+ `fs-util`/`gray-matter`/`catalog` 前置；fork `agent.ts`（M）经 Watcher/FileLoader 接线的仲裁随后。

### 10.7 Slice 2.3 第三环首波（2026-10-16，`196cc95bf`）

**交付（9 源件 + 2 测试件，全绿）**：
1. **Hash 并轨（自查重复即修）**：实证 base 已有 `@aigcfroge/util/hash`（upstream 自 core 上移）——删除早前 core 侧 port（`util/hash.ts`），`composition/digest` 直连 util 包；官方奇偶性测试迁并（Uint8Array→Buffer 断言）；
2. **基建叶件**：`constants.ts`（8 目录常量，浏览器安全）· `util/yaml-escape.ts`（双引号 YAML 转义）· `location-mutation.ts`（161 行 Location 受限变更服务）· `asset-migration.ts`（256 行 `.claude`/`.agents` 遗留资产首启导入，三处演化映射）· `asset-kind.ts`（97 行资产类别路由）+ 官方测试 **2/2**；
3. **路径双件**：`agent-asset/path.ts` + `skill-asset/path.ts`（101×2，段校验/相对路径/归属根）。

**新配方**：
- ⑬ **base 上移基建映射**——fork 依赖的 `core/fs-util`/`core/effect/layer-node` 已由 upstream 上移 `@aigcfroge/util/*`：映射导入而非重复移植；且 **`fs.glob(pattern, {cwd, absolute, include, dot})` → `fs.scan(...)` 选项逐字同构**（base `skill.ts:59` 同调用为证）。
- ⑭ **schema 再导出缺口**——fork `Config.Entry/Document` 实为 `@aigcfroge/schema/config` 直出、core config 未再导出：消费点直连 schema，不改 core config 面。
- ⑮ **枚举型演化序列化**——`command.model` 由 fork 字符串演化为 base `ConfigModel.Selection`（Short 字符串/Explicit 结构 双形解码）：迁移输出短形 `providerID/model` + variant 内嵌，与下游解码回路兼容。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · 本轮测试 **6/6**（asset-kind 2 + hash 1 + digest 3）。

**第三环续篇**：`schema/agent.ts` 融合（attended/handoffs/origin* + `empty` static，伴 base `default` 并存）→ `config/agent.ts`（27 行，`ConfigProvider.Request→Schema Provider.Request` 映射）→ `agent-asset.ts`/`skill-asset.ts` 模型层 → `asset-bridge`（`Agent.Info.empty`/`registerAgentAssetTransform`）→ services 双件 + `file-loader`；`asset-migration.test.ts`（176 行）随模型层落地。

### 10.8 Slice 2.3 第三环主体（2026-10-16，`929fd069c`）

**交付（12 源件 + 4 测试件，全绿）**：
1. **schema 双融合**：`schema/agent.ts`（+`attended?`/`handoffs`（只读必填）/`originRelativePath?`/`originRevision?` + `empty` static 与 base `default` 并存，required 字段涟漪＝零——base 唯一构造点即 statics）；`schema/config/agent.ts`（+`handoffs?`）。**base 已备对齐件免 port**：`ConfigAgent` 早已上移 `@aigcfroge/schema/config/agent`（含 `ConfigModel.Selection` 演化）；`ConfigProvider` 同理（`schema/config/provider`）。
2. **asset 模型层 8 件**：`agent-asset`/`skill-asset`（已在前波）+ `prompt-asset`/`mcp-asset`/`command-asset`（187/197/225 行，三 kind 同构）+ 各自 `path.ts`；`asset-kind`（前波）。
3. **`agent/asset-bridge.ts`**：`parseAgentAssetConfig`（Bun.YAML 原生）/`agentAssetToAgentInfo`（`ConfigModel.Selection` 直映 `Model.Ref`）/`registerAgentAssetTransform`（防覆盖语义）/watcher 自动刷新层。
4. **测试四件适配**（15/15）：cross-kind 隔离、状态注入、防覆盖 + 遗留迁移（.claude/.agents 优先级/非法名/首启判定）。

**新配方**：
- ⑯ **同步 transform 陷阱（重大）**：base `TransformCallback = (editor) => void` **同步回调**——Effect 返回形回调在 void 位置被 TS 放行且**运行时静默吞没**（fork 形 `(draft) => Effect.gen(...)` 注册成功但永不执行）。适配：`Effect.runSync(内存读取)`；测试内 fork 形 `Effect.sync` 包装同样修正。**审计面**：全部 agent transform 消费点。
- ⑰ **schema 融合契约协议**：遵 schema AGENTS——`Schema.mutable` 禁用（只读 + `Types.DeepMutable` 边界突变）；optional 用 `optional(...)` 助手；required 字段涟漪 = 构造点显式补齐 + fixture 深克隆（`host.ts agentInfo` 增 handoffs 映射）。
- ⑱ **base 化测试图层接线**：`FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))`（替代 `defaultLayer`）；fixture `location()`（替代 `Location.layer(ref)`）；`AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, Location.node]), [Global.node.replace(globalLayer), Location.node.replace(...)])`（替代 `Agent.layer`）；Bus 于资产层为 serviceOption 可选 → 测试可省略。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · 新测试 **15/15** · 回归 **90/90**（10 文件含 session-prompt）· schema **319/319**。

**第三环收尾预告**：services 五件（`agent/skill/prompt/mcp/command-asset-service.ts` ≈2000 行，`file-mutation`/`permission/effective` 齐备）→ `file-loader`（gray-matter ✓ base 已备）→ `judge`/`meta/memory` → fork `agent.ts`（M）仲裁。

### 10.9 Slice 2.3 第三环收尾 + 迁移切片实质落地（2026-10-16，`982c60ac4`）

**交付（18 源件 + 8 测试件）**：
1. **asset services 五件**（≈2100 行）：agent/skill/prompt/mcp/command-asset-service（apply/delete/remove/rollback/并发修订守卫/临时文件原子写）+ 测试四件（agent-service、prompt-service 21 例含 M2 telemetry mock、command/mcp 模型件）；
2. **FileMutation 融合**：base 三法 + fork 增量 `remove`/`writeAtomic`（全 base 风格——`environment.files` 的 `read/write/stat/remove/move/mkdir` 面齐备，无需 fs-util）；`layer` 导出；**Target 统一**（`LocationMutation.Target.canonical:string` → `absolute:AbsolutePath`，与 base `FileAccess.Target` 逐字同构，55 处机械改名后服务零适配直传）；
3. **meta-agent 域**：`meta-agent/service.ts`（301 行）+ `agent/meta/memory.ts` + `agent/file-loader.ts` + `agent.ts` **fileLayer 仲裁落地**（Watcher+AgentFileLoader 接线，⑯ 同步 transform 适配）；
4. **测试八件**：asset-service×2 + command/mcp + meta-agent×2 + file-loader + 迁移后全谱。

**迁移切片实质落地（重磅）**：实证 fresh DB 走 `schema.up()`（schema.gen 全量 DDL）；迁移文件仅服务存量升级（`applyOnly` 按 journal 补差）。正确路径＝表注册于 `src/**/sql.ts`（drizzle.config 通配）→ 官方生成器 `bun run script/migration.ts`：
- 生成 `20261016135025_meta_agent_and_context_epoch`（`meta_agent`/`meta_agent_session`/`meta_agent_step`/`meta_agent_memory` + **`session_context_epoch`**——2.1 债务同步闭环）；
- `schema.gen.ts` +69 行（五表 DDL）、快照更新、注册表 **50 项**；
- `migration --check` **通过**（无未生成漂移 + 注册表新鲜）；
- 手工移植的 fork 迁移双件**撤回**（与生成件重复双源）。

**新配方**：
- ⑲ **fresh-DB 语义**——新表必须注册进 schema 源走生成器；严禁手工复制 fork 迁移文件（存量升级≠全量 DDL，双源必炸）。
- ⑳ **单实例共享层陷阱**——fork 的模块级常量层（`Database.defaultLayer`）映射为 base 工厂调用（`Database.layer()`）后，双次调用＝双库（内存库尤甚）→ 测试须提升为单值引用（`const database = Database.layer()`）。
- ㉑ **Target 同构归一**——`LocationMutation.Target` 与 `FileAccess.Target` 本为同一概念（字段名/品牌分歧）→ 归一后跨模块零适配。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · 本环回归 **156/156**（22 文件）· schema **319/319** · `migration --check` ✓。

**第三环余项**：`judge.ts`（依赖 fork `@aigcfroge/llm`/`catalog`——随 LLM 切面对正名后接线，LEDGER）；delegation/workflow 迁移表（复用生成器流程）；services 余测（list-assets/prompt-asset-v2-smoke 等）。**下一窗口**：进入 Slice 2.4（delegation 12 件——迁移已可走生成器，session/tool 面将自然展开）。

### 10.10 Slice 2.4 首波：delegation 逻辑核 + 投影 + 迁移（2026-10-16，`c56564ab8`）

**依赖探针定界**：delegation 12 件（4289 行）拆两段——**逻辑核段（本波）**与**工具流段（2.4b）**。工具流段依赖链实证：`service` → `tool/cli-adapter` → `acp-client`（需新增 `@agentclientprotocol/sdk` 依赖）→ `tool/acp`（fork 件）；`execution` → `background-job`（**Job/BackgroundJob 双演化**：fork 的 promote/extend 语义 vs base 演化版）→ `tool/task-driver`（1111 行）→ **`agent/judge`** → `catalog` + **`@aigcfroge/llm`（v2 树无此包——R4 LLM 收敛决策门控）**；另 `share-summary` 缺失。判定：工具流段=「fork 工具/元智能体流」正名后切面。

**交付（9 源件 + 4 测试件）**：
1. **逻辑核**：`digest`（修订摘要计算）+ `review`（评审屏障/撤销）+ `presentation` + `state`（状态机迁移/阶段推进）+ `event`（23 个 durable 定义，⑧ 配方）+ `fold`（1038 行事件折叠，fail-closed）+ `index`；
2. **投影**：`projector`（253 行——从持久化事件流重建查询投影；tx 适配=base `project` 单参订阅者 + `DatabaseService | Transaction` 联合存储 + `Transaction` 从 `db.transaction` 签名派生 + `Bus.decodeSerializedEvent` 提升导出）；
3. **`tool/cli-session.sql.ts`**（external_cli_session 表）；
4. **测试四件**：digest/fold（1159 行）/review/state **30/30 全绿**。

**迁移（生成器复用 ✓）**：`bun run script/migration.ts --name delegation_tables` → `20261016140143_delegation_tables`（**delegation×3 + external_cli_session**）· schema.gen +89 行 · 注册表 51 项 · `--check` **通过**。

**新配方**：
- ㉒ **投影契约适配**——fork `bus.project(def, (event, tx))` 双参形 → base 单参订阅者 + 直写 db（`ProjectionStore = DatabaseService | Transaction` 联合 + Transaction 类型从 `db.transaction` 的 Parameters 派生，零深导入）；`decodeSerialized` 提升为 `Bus.decodeSerializedEvent` 导出。
- ㉓ **信封手工构造**——base `Event.Payload` 需要 `created: Finite` + 品牌 `Seq`/`Version`（`Event.Seq.make`/`Event.Version.make`）；缺 durable 的负例用 `as unknown as` 过类型面测运行时守卫。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · 本波测试 **30/30** · 回归 **128/128**（12 文件）· `migration --check` ✓。

**2.4b 入口（工具流段）**：`service`（1164 行）+ `execution`（758 行）+ `recovery`（241 行，依赖 service）+ `cli-adapter`/`acp-client`（含 SDK 依赖决策）+ Job/BackgroundJob 仲裁 + `task-driver`/`judge`/`catalog`/`share-summary`——集中于「fork 工具/元智能体流」正名后切面执行。

### 10.11 2.4b 重定界与 mcp binding 落地（2026-10-16，`ed1b66178`）

**2.4b 重定界（窗口勘察发现）**：cli 簇真实规模 **2600+ 行**（`codex-app-server` 单件 898 + `claude-code-sdk` 196 + `codex-sdk` 134 + …15 件）· **两个新依赖**（`@agentclientprotocol/sdk@0.21.0`、`@anthropic-ai/claude-agent-sdk`）· effect **beta.83→4.0.1 的 `unstable/process` API 漂移面**——**超单窗容量，定界为「工具/元智能体流」独立大窗**（与 R4 LLM 收敛、Job/BackgroundJob 仲裁同窗）。

**本窗改道交付——mcp binding 三件（534 行）**：
1. `mcp/binding/store.ts`（451 行：McpCredentialBindingStore——bind/rebind/revoke/get/resolve + 唯一约束/sentinel workspace_id/跨位置引用守卫）+ `sql.ts`（表）+ `event.ts`（durable 定义 + revision 守卫发布）；
2. 官方测试 **14/14 全绿**（commit 原子性、sentinel、跨 Location 拒绝、吊销流）；
3. **迁移**：`20261016143353_mcp_credential_binding` · schema.gen 同步 · 注册表 **52 项** · `--check` ✓。

**新配方**：
- ㉔ **publish commit 契约适配**——fork `commit: (seq, tx) => Effect<boolean>` → base `commit: (seq) => Effect<void>`（闭包**直写捕获 db**；原子性由 base `PublishOptions.commit`「随事件追加提交」保证——与 2.1 配方②同源）；store 内 3 处 `(tx) => tx.insert/update` 闭包机械改 db（含换行断链的 `yield* tx\n` 模式）。
- ㉕ **effect unstable→promoted 路径**——`effect/unstable/process`→`effect/process`（4.0.1 已提升，base `environment` 同款导入为证）；`unstable/http`→`http`；工具流大窗的 API 迁移面就地预清。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · 本波 **14/14** · 回归 **136/136**（12 文件）· `migration --check` ✓。

**余项（mcp 续）**：`connection`（1005 行，unstable/http+process 映射已就绪）/`contributor`（49）/`mcp-v2`（35）——与工具流大窗相邻，可随后续窗口或独立小窗落地。

### 10.12 mcp 叶件收尾与工具域规范发现（2026-10-16，`5ce70388a`）

**交付（3 源件）**：`mcp/contributor.ts`（49 行，MCP server 贡献者注册表）· `mcp/mcp-v2.ts`（35 行，McpV2 最小立面 + noopLayer）· `credential-scanner.ts`（97 行，凭证引用扫描；schema/credential-scan ✓ 已备）。

**窗口关键发现**：
1. **`tool/AGENTS.md`（base 域规范，权威）**——base tool 域为演化体系：`tool.ts` 承载 Location 级服务/注册/执行，「不得新增第二可执行入口类型/注册表自持执行器/授权回调」；「MCP 拥有单一稳定 tool transform 读取最新发现工具」。**fork 的 `tool/tool.ts`（M，180 行，`@aigcfroge/llm` 契约型）为旧架构**——不整体移植，须在工具流大窗按此规范仲裁。
2. **chain 归并**：`mcp/connection`（1005 行）→ `tool/mcp-registration` → `tool/tool` →（llm 门）= **工具流大窗成员**；`credential-scanner.test.ts`（147 行）耦合 connection 同挂账。mcp 域仅余此链。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿**（纯增件，全谱无回归）。

**工具流大窗准备度（给正名窗口的交接清单）**：SDK 依赖决策（`@agentclientprotocol/sdk`/`@anthropic-ai/claude-agent-sdk`）· effect 迁移面已预清（㉕）· Job/BackgroundJob 仲裁（prompt/extend 语义）· tool 域 AGENTS.md 规范为仲裁基准 · R4 LLM 收敛决策（llm 包引入面）· 清单：cli 簇 18 件 2600+ 行 + `tool/tool.ts`/`mcp-registration`/`mcp/connection`/`task-driver`(1111)/`judge`/`catalog`/`share-summary` + `delegation/service`(1164)/`execution`(758)/`recovery`(241)。

### 10.13 余量权威对账 + 会话摘要组落地（2026-10-16，`c54f0cf11`）

**余量权威对账（修正早期口径）**：以 `delta A 件 − base 实存` 全量重算——剩余 core A 件 **142**：tool **45** · database **35**（≈34 fork 迁移件——**生成器管辖，非 port 目标**）· session **28** · workflow 6 · 小域群 22。**早期小域口径修正**：`plugin`/`v1`/`github-copilot`/`util`/`public` **零缺口**（旧计数混入了退役 `aigcfroge` 包路径）。真实剩余 ≈**107 件**。

**交付（4 源件 + 1 fixture + 1 测试件）**：
1. `session/tool-summary.ts`（111 行，toolSummary 端点后端）+ 官方测试 **11/11**（fixture 适配：base 工具态四形 `streaming/running/completed(NonEmptyArray Content)/error` + `FinishReason` 归一 `end_turn→stop`）；
2. `session/summary.ts`（48 行，diff 端点：snapshot 起止读取 `V2Snapshot.diffFull`）；
3. `session/share-v2.ts`（129 行，跨会话分享：reference/output/full 三态 + Synthetic 注入 + 可选触发；**事件载荷裁剪**——base Synthetic 仅收 `{sessionID, text}`，id/时间戳由基座内部补）；
4. `session/v2-snapshot.ts`（27 行，快照契约——实现归 `v2-runtime`，门控中）。

**新配方**：
- ㉖ **活契约优先**——fork 会话消费件（share/summary）的消息类型指向 **base 活契约 `SessionMessage.Info`**（非 v2 驻留合同）：实证 base Info 联合全含所需成员（Shell.command/Assistant.snapshot/content），跨契约转换零成本；v2 驻留合同仅服务 fork 自有服务链。
- ㉗ **型面差异三连**——`ToolState` 四形（streaming 非 pending/required metadata/content 非空）、`FinishReason` 归一集、Synthetic 事件载荷最小化。

**挂账（本组余）**：`session-identity`（310 行，hub：artifact/composition/schedule-service/plugin-asset/workflow-asset 依赖簇未就绪）· share/summary 测试件（需 base 会话测试脚手架——与 session 主体切片同窗）· `cache-diagnostics`（依 `v1/session` 642 行）· `v2-runtime`（依 `location-layer` 324 行）。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · 本波 **11/11** · 回归 **127/127**（9 文件）。

### 10.14 会话工具与治理簇落地（2026-10-16，`6c5cb0d19`）

**交付（10 源件 + 9 测试件，81/81 全绿）**：
1. **治理三件**：`session/artifact.ts`（作品落盘：LocationMutation 越界拦截 + FileMutation 原子写/防覆盖 + 冲突守卫）· `session/doom-loop.ts`（重复调用环检测，权限/配置驱动）· `session/reference-checker.ts`（引用校验：markdown 链接/TS import 悬空检测 + CorrectionStore 写入，**真实 ripgrep 链路实测**）；
2. **记忆与工作簇**：`session/personal-memory.ts` + `.sql.ts`（assistant 模式记忆三事件 + 表）· `session/work-preset.ts`（预设注册表）· `session/work-review.ts`（评审状态机）；
3. **杂件**：`session/dag.ts`（任务依赖环检测）· `session/correction-extractor.ts`（纠正提取）· `config/meta.ts`（ConfigMeta 家族服务侧）· `session/work-review` 生命周期测试。

**基础设施补齐**：`FileMutation.create`（防覆盖语义，stat-then-write under lock）+ `TargetExistsError`；`Ripgrep.layer`/`RipgrepBinary.layer` 增导出；`session/personal_memory` 表迁移（生成器）。

**新配方**：
- ㉘ **decline=defect 语义**——base 权限拒绝走 defect 通道（`Permission.Error = Blocked | Corrected`；tool/AGENTS.md 明示）：mock 用 `Effect.die(DeclinedError)`，断言用 `Cause.findDefect` + `Result`（effect 4 无 `dieOption`）。
- ㉙ **node-scoped 服务的测试根**——ripgrep 等 location-node 服务在测试中须**按目录构建**（`Location.node.replace(绑定目录)`），共享"/"根会静默空扫描。
- ㉚ **Config 再导出缺口定式**——`Config.Entry/Document/Info` 消费点统一直连 `@aigcfroge/schema/config`（第三次应用）；Config mock 需补 `changes` 成员。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · 本波 **81/81**（9 文件）· 回归 **120/120** · `migration --check` ✓。

### 10.15 KB 与 Task/Schedule 簇 + session 表融合（2026-10-16，`ef33ea74d`）

**交付（10 源件 + 6 测试件，114/114 全绿）**：
1. **KB 簇**：`kb/link.ts`（双链解析）+ `session/kb-service.ts`（820 行：FTS 索引笔记服务）+ `kb.sql.ts` 表；官方测试 **32/32**；
2. **Task/Schedule 簇**：`session/task.ts`（1176 行：任务 CRUD/乐观并发/事件投影）+ `session/todo.ts`（128 行：todo 投影）+ `schedule`/`schedule-core`/`schedule.sql`/`schedule-service`（714 行：到期投递 at-least-once claim + 退避）；官方测试 **82/82**（session-task-service 单套 1654 行含并发/条件认领/观察者事务化用例）；
3. **session 表融合（D12 前置落库）**：`session_v2` +3 列（`mode`/`permission_tier`/`attended`，含默认值+索引）· `TaskTable` · `SessionCompositionSnapshotTable`——**迁移三个**（personal_memory/knowledge_base/task_and_schedule）经生成器落地（ALTER+CREATE 全备）。

**新配方**：
- ㉛ **默认层不捆数据库**——fork 的 `defaultLayer = layer.pipe(provide(Database.defaultLayer))` 常量共享 → base 工厂调用=**每模块独立内存库**（⑳ 源侧再现）——移植规约：defaultLayer **只导出 `layer` 本体**，Database/Bus 由消费侧图层图提供（单库保证）。
- ㉜ **provideMerge 链修复跨层依赖**——`Layer.mergeAll` 不解析层间依赖；`X.pipe(provideMerge(...), ...)` 链式方可收敛（session-task-service 五层收敛实证）。
- ㉝ **fork 包↔内建对位**——`effect-drizzle-sqlite` → 内建 `database/drizzle/sqlite-core/effect`；`EffectSQLiteTransaction<Rel>` → 从 `db.transaction` 签名**派生**（零深导入）；`unstable/sql/SqlError` → `sql/SqlError`。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · 本波 **114/114**（kb 32 + task/schedule 82）· 回归 **222/222**（14 文件）· schema **319/319** · `migration --check` ✓。

**余量更新**：session 域余 `composition`（381）· `session-identity`（hub）· `cache-diagnostics` · `v2-runtime` · `share-summary` · `task-driver-fill`/`scheduled-job-executor`（工具流窗）· workflow 6 · 工具流大窗。

### 10.16 Composition 与 Workflow 就绪面（2026-10-16，`090e43958`）

**交付（9 源件 + 2 测试件，37/37 全绿）**：
1. `session/composition.ts`（381 行：会话组合快照服务）+ `workflow/event.ts`（run 事件 + revision 守卫发布——**binding 式 commit 契约**再应用）· `workflow/sql.ts` · `workflow/workflow-run.ts`（workflow_run/step_run 状态机 + 冲突守卫）· `workflow-asset.ts`（registry，js-yaml→**Bun.YAML** ⑨）· `workflow-asset/path.ts`；
2. 测试：workflow-asset-path + workflow-asset-registry **37/37**；
3. **迁移** `20261016151845_workflow_runs`（workflow_run/workflow_step_run 表）· `--check` ✓。

**门控移交**：`workflow-runner`（依 `tool/task-driver`）+ `workflow-execution`（依 runner）+ `workflow/execution/local`（依 location-layer）→ 工具流大窗。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · 本波 **37/37** · 回归 **228/228**（15 文件）· `migration --check` ✓。

**剩余总览**：session 域余 4 件（`session-identity` hub / `cache-diagnostics` / `v2-runtime` / `share-summary`）+ 工具流大窗（含 workflow 3 件、delegation service/execution/recovery、cli 簇、task-driver 系、location-layer）+ `composition-resolver`/`custom-profile` 小簇。

### 10.17 Grant/Permission/CustomProfile/PluginAsset 小簇（2026-10-16，`fde20c9c1`）

**交付（14 源件 + 12 测试件，其中 9 套 **116/116** 全绿 + 3 套挂账）**：
1. **grant 簇**：`grant/{event,sql,store}`（scoped grant 生命周期 + revision 守卫发布——**binding 式 commit 契约**三应用）；
2. **permission 增件**：`approval-presence`（在场审批）+ `session-override`（会话级权限覆写）；
3. **custom-profile 簇**：`custom-profile`（解析/编码）+ `custom-profile-service`（524 行：落盘/补偿/回滚）+ `custom-profile/path`——测试 **3 套全绿**（含注入式回滚验证）；
4. **plugin-asset 簇**：`plugin-asset`（registry）+ `bridge`（`~/.claude` 桥）+ `path`——测试 **2 套全绿**；
5. **杂件**：`path-identity`（168 行路径归一）+ `import-parser`（3 套测试全绿）——`FileSystem.Size`→**`ByteSize.bytes`**（4.0.1 改名）。

**基建补齐**：`FileMutation.writeIfUnchanged` + `StaleContentError`（防陈旧写）；**session schema 融合**——`Session.Info` +`mode`（解码/构造双默认）+`attended`（D12 门禁的 schema 侧对位）；迁移 `20261016152635_grants_and_profiles`（scoped_grant 表）。

**挂账**：`permission-grants`/`permission-session-override`/`scoped-grant-store` 测试件——需 base 会话服务完整测试脚手架（`Session.layer`/`SessionStore.defaultLayer` 对位，随测试脚手架切片）；`composition-resolver`（依 mcp/connection + tool registry）随工具流窗。

**门禁成绩**：core **0 错** · 分包 **19/19 全绿** · 本波 **116/116** · 回归 **267/267**（15 文件）· schema **319/319** · `migration --check` ✓。

---

> **结语**：本方案以工程宪法为准绳，以树级事实为依据，彻底规避了盲目合并的灾难。新基座 `/home/keer/workspace/aigcfroge-v2` 已经正式建立并准备就绪，后续将严格遵照本路线图稳健推进！
