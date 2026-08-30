# 外部 CLI 调度 M1–M5 完整实施方案（已批准 2026-08-05）

> 依据：`CLAUDE.md`（第一性原理/门禁/改完即审）、`AGENTS.md`（Effect/Schema/测试/codegraph 分层）、`ARCHITECTURE.md`（五层拓扑）、`DESIGN.md`（v2 token/i18n/a11y）、`packages/aigcfroge/AGENTS.md`（模块形态）、skills（effect / database / frontend-theming）、TDD 成文约定（`docs/plan/work-mode-m1-tdd-prompt.md` 红→绿→重构、`docs/plan/prompt-todo-task-fix-review-2026-08-06.md` 修复类 TDD 变体）。
> 前置文档：`docs/roadmap/external-cli-dispatch-roadmap.md`（路线总纲，本文是其可执行细化）。
> 执行提示词：`docs/plan/prompt-external-cli-dispatch.md`。
> 已确认决策：自动化优先，terminal handoff 暂缓；视觉维持"任务卡片 → 子会话详情页"隐喻；B+D 先行，ACP 为传输层终态。

---

## 0. 调研修正：三处新发现的 P0 事实

精读链路后，问题清单比 roadmap 更新三条（均已有行级证据）：

1. **resume 读写键不一致**：`task-driver-fill.ts:126` 按**父** Session ID 查 `external_cli_session`，`:154` 却按**子** Session ID 写入——resume 永远查不到自己写的行，该功能当前完全无效。
2. **UI 断链根因是 V2 输出无 metadata**：V2 task Output schema 仅 `{sessionID, output}`（`core/src/tool/task.ts:73-76`），而 session-ui 卡片跳转依赖 `metadata.sessionId`、TUI 依赖 `metadata.sessionId/background`。且 `TaskDriver.SessionFacade.create` 输入**无 title 字段**（`task-driver.ts:230-236`），导致子 Session 无标题、卡片回退启发式（`message-part.tsx:505-520`）也失效。
3. **V2 错误态丢失**：external-cli 分支固定返回 `state:"completed"`（`task.ts:196`），CLI 失败在 UI 上显示成功；legacy 会按 `result.status` 渲染 `task_error`。

---

## 1. 五层影响地图

| 层          | 包                                           | 本方案触点                                                                                                                |
| ----------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Entry       | tui、desktop                                 | TUI `Task()` 卡片 + permission 渲染（desktop 复用 app，无独立改动）                                                       |
| Application | app、aigcfroge                               | permission dock metadata 渲染、agent 列表刷新、registry 解冻、V1 兼容                                                     |
| Domain      | core、schema                                 | task.ts / task-driver.ts / task-driver-fill.ts / cli-timeout.ts / 适配器 / config.ts / permission.ts / meta-agent service |
| UI          | session-ui、ui                               | task 卡片（徽标/摘要/状态）、i18n key                                                                                     |
| Infra       | （无新增表，不触发 database skill 迁移流程） | —                                                                                                                         |

依赖方向约束：core 不依赖上层；session-ui 只消费 SDK 类型；新增 i18n key 须三语（en/zh/zht）同步，由 `packages/app/src/i18n/parity.test.ts` 自动强制。

---

## 2. TDD 总纪律（每个里程碑通用）

- 流程：红（先写失败测试/先跑复现命令，失败信息不符即停下报告）→ 绿（最小实现至通过）→ 回归（受影响包完整检查）。**禁止写完再补测试**。
- 测试模式选择：service/layer 逻辑 → `it.effect`（TestClock）；真实子进程/文件系统 → `it.live`；落盘（sqlite/临时目录）→ `it.instance`。
- 等待并发 fiber 只准用就绪信号（`pollWithTimeout`/`awaitWithTimeout`/`Deferred`），严禁 `Effect.sleep(N)`。
- CLI 进程替身两法：(a) mock `ChildProcessSpawner`（范例 `packages/aigcfroge/test/installation/installation.test.ts:17-42`，`executeWithTimeout` 的 spawner 是显式入参，单测直接可用）；(b) 假 adapter + `command: process.execPath` + `bun -e` 回显 JSON 走真实 spawn（范例 `packages/aigcfroge/test/tool/task.test.ts:304`）。
- 命令纪律：永不从仓根跑测试；`bun --cwd packages/<name> test --timeout 30000`；typecheck 用 `bun --cwd packages/<name> typecheck`（tsgo）。
- 每个里程碑收尾走 CLAUDE.md「改完即审」七步，输出固定格式复查结论；不顺手修无关代码，额外发现记入报告。

---

## 3. M1 — core 链路修复（红→绿，全部在 packages/core）

目标：外部 CLI 委派在数据层完整、真实、可追踪。预估 3–4 天。

### Phase A（红）：契约测试先行

新增/扩展四个测试文件：

1. **`packages/core/test/cli-adapters.test.ts`**（新建，纯函数，无需 layer）：
   - 四个适配器 `buildArgs`：新会话与带 `resumeId` 两种形态逐一断言 argv。
   - `parseResumeHint`：合法 `session.resume_hint` JSONL 帧 → 提取 ID；噪声帧/畸形 JSON → undefined。
   - `parseOutput`：各家代表性格式（claude `type:"result"`、codex `text.delta`+`item.completed`）→ `DelegationResult.status/summary`。
2. **`packages/core/test/cli-timeout.test.ts`**（新建，mock spawner，`it.effect`）：
   - CLI 不存在 → `{status:"failed", errors:["CLI not found on system"]}` 且不抛异常。
   - 超时（TestClock 推进 300s）→ failed + stderr 含超时信息。
   - 非零 exit code → failed 且 `rawStdout` 保留。
   - 正常输出 → 走 `adapter.parseOutput` 的结果透传。
3. **`packages/core/test/task-driver-fill.test.ts`**（新建，`it.instance` + 真实 `Database.defaultLayer`（`:memory:` + migration），复用 `session-task.test.ts` 的 layer 组合）：
   - **R1 子会话消息**：execute 后子 Session 含两条消息（prompt text part 带 `[Project directory: …]` 前缀、output text part = summary）。
   - **R2 子会话 title**：等于 task 输入的 description（驱动 SessionFacade.create 扩 title）。
   - **R3 resume 键一致**：首次执行写入 `external_cli_session`；构造第二次同父委派时能用上一轮的 external_session_id 作 resumeId（断言 mock spawner 收到的 argv 含 `--resume <id>`）。
   - **R4 step 状态机**：父 Session 挂载 meta agent 时，executeCLI 写入 `type:"external-cli"` step 且完成后 `updateStep` → `completed`；失败 → `failed`。
   - **R5 无 spawner**：返回 typed error 而非裸 `Error`。
4. **`packages/core/test/session-task.test.ts`**（扩展，mock LLM 发 `execution_type:"external-cli"` toolCall；seam 用 `TaskDriver.install` 假 cell，范例 `scheduled-job-executor.test.ts:44-70`）：
   - **R6 metadata**：tool 结果 metadata 含 `sessionId / cli / execution_type / status`（UI 断链修复的契约）。
   - **R7 错误态**：CLI 失败 → 渲染 `task_error` 而非固定 completed。
   - **R8 缺 cli_target** → `ToolFailure`。
   - **R9 permission metadata**：assert 收到 `resources:[cli_target]` 且 metadata 含 `description/execution_type`（用 `Layer.mock(PermissionV2.Service, …)` 捕获入参）。
   - **R10 session_task 联动**：external-cli 分支产生 `session_task` 记录且 settle 后状态回写（对齐 Track A/B 语义）。

### Phase B（绿）：最小实现

按测试驱动修改（文件+行号锚点）：

1. **`core/src/tool/task-driver.ts`**：`SessionFacade.create` 输入增加可选 `title`；`executeCLI` 返回类型扩为 `{text, sessionID, status}`（移除 `:224-225` 的 `as` 强转，改显式类型）。
2. **`core/src/session/task-driver-fill.ts`**：
   - 子 Session 创建传 `title`（消除 `:106` 的 `as any`，agent 字段用 branded 构造）。
   - 补写 prompt 消息与 output 消息（格式对齐 legacy `aigcfroge/src/tool/task.ts:165-205`：`[Project directory: …]` 前缀、`agent/model` 字段）。
   - 修 resume 键：读写同键——读按"父 Session 最近一条 active 行"查询、写也以父 Session ID 为键（保留子 Session ID 于行内可溯源；最终键策略以测试 R3 为准并在代码注释说明）。
   - 失败/超时把 `status` 透传进返回值；无 spawner 改 `Schema.TaggedErrorClass`。
   - executeCLI 路径补 `writeStep({type:"external-cli", engine: cliTarget})` + 完成后 `updateStep`（利用现有 service，无需新表）。
3. **`core/src/tool/task.ts`**：
   - external-cli 分支：返回 metadata `{sessionId, parentSessionId, cli, execution_type, status}`；按 `result.status` 渲染 `task_error`/`task_result`；接入 session_task Track B（无 `parent_task_id` 时 append + onSettle patch）。
   - `permission.assert`（:169-178）：CLI 模式 `resources:[cli_target]`，补传 `metadata:{description, execution_type:"external-cli"}`（`PermissionV2.AssertInput` 已支持 metadata，`permission.ts:47`）。
4. **`core/src/meta-agent/service.ts`**：`writeStep` 的 `stepSeq` 模块级计数器改为表内 `MAX(seq)+1` 查询（消除进程内状态，测试可重复）。

### Phase C（回归）

`bun --cwd packages/core test --timeout 30000`、`bun --cwd packages/core typecheck`、`bun run lint`；V1 链（`packages/aigcfroge`）不动，跑 `bun --cwd packages/aigcfroge test tool/task.test.ts` 确认无回归。

### M1 验收

R1–R10 全绿；手动（tmux TUI）调度一次 claude-code：子会话有标题、有两条消息、失败场景显示错误；resume 第二次委派 argv 带 `--resume`。

---

## 4. M2 — UI 呈现闭环（session-ui / app / tui 三端）

目标：用户能看清"这是外部 CLI、跑到哪了、结果是什么"。预估 3–4 天。依赖 M1 的 metadata 契约。

### Phase A（红）：测试落点

1. **session-ui**（包内无渲染 harness，遵循"抽纯函数再测"的 `readPartText` 模式）：
   - 抽 `taskCardModel(input, metadata)` 纯函数（输出 `{isExternalCli, title, subtitle, status, href?, summary?}`），新建 `packages/session-ui/src/components/task-tool-card-model.test.ts` 覆盖：external-cli 识别、状态映射（running/completed/failed/timeout）、summary 提取、无 metadata 回退。
2. **app**：遵循 `agent-task-hub.test.tsx` 惯例写源码 wiring 契约测试：permission dock 渲染 `metadata.cli_target`/`execution_type` 的标记存在；新 i18n key 由 `parity.test.ts` 自动强制三语。
3. **TUI**：照 `test/component/task-item.test.tsx` 的 `testRender` + `captureCharFrame()` 模式，对 `routes/session/index.tsx` 的 task 分支加帧断言：external-cli 标题含 CLI 标识、状态行正确。permission.tsx 同理。

### Phase B（绿）：实现

1. **session-ui `message-part.tsx`**：
   - `getToolInfo` task 分支 + task 卡片消费 `taskCardModel`：`execution_type==="external-cli"`（或 `metadata.cli`）时图标换 terminal、标题旁加 CLI 徽标（新 i18n key `ui.tool.cli`）。
   - 摘要可展开：task 卡片不再无条件 `hideDetails`；`metadata`/`output` 中 summary 以 `defaultOpen: false` 的折叠区呈现（BasicTool 已支持 children 内容区）。
   - 状态 chip：spinner/成功/失败/超时四态，数据来自 `state.status` + `metadata.status`。
2. **app `session-permission-dock.tsx`**：渲染 `request.metadata` 的 `description`/`cli_target`（存在时），保持现有 patterns 列表不动。
3. **TUI `index.tsx` Task() + `permission.tsx`**：标题用 `metadata.cli ?? subagent_type`；permission 渲染 `cli_target`/`execution_type`。
4. **i18n**：`packages/ui/src/i18n/` 新增 `ui.tool.cli` 等 key（en/zh/zht 三语）；清理 `slash-popover.tsx:66-69`、`autocomplete.tsx:402-422` 的硬编码 `"CLI"`/`"[CLI]"`。
5. **a11y**（DESIGN.md）：徽标不依赖颜色单独表意（有文本/图标）；折叠区键盘可达；新增交互保留 focus 态。

### Phase C（回归）

`bun --cwd packages/session-ui test src`、`bun --cwd packages/app test:unit`、`bun --cwd packages/tui test --timeout 30000`、三包 typecheck + lint；桌面端 Electron 壳复用 app，无需单独验证；手动核对 light/dark 双主题、中英文溢出、窄视口。

### M2 验收

卡片四点（CLI 徽标/可展开摘要/状态 chip/可跳转）三端齐；permission dock 显示委派目标；i18n parity 通过。

---

## 5. M3 — 声明式配置 + 实时探测（core/config + aigcfroge/registry + app）

目标：新装/新增 CLI 免改代码、免重启生效。预估 4–5 天。

### Phase A（红）

1. **config schema 测试**（`packages/core/test/config*.test.ts` 就近扩展）：
   - 合法 `cli_agents` 定义 decode 成功；未知 `output` 类型、缺 `command` → decode 失败（负测试）；未声明字段仍 `onExcessProperty:"ignore"`。
2. **`ConfigCliAdapter` 工厂测试**（新建）：模板插值 `{prompt}`/`{resumeId}` 生成 argv；`output` 三型（claude-jsonl/codex-jsonl/plain）解析复用现有解析器；`timeout` 透传。
3. **registry 测试**（扩展 `packages/aigcfroge/test/agent/meta/adapters/registry.test.ts`）：内置四个 + 配置定义合并；同名覆盖规则（配置 > 内置）。
4. **解冻测试**：
   - meta prompt：模拟 `available()` 结果变化后再次 fill，名单随之变化（当前 pre-compute 实现下此测试红）。
   - PATH 解析：`detect()` 在 `process.env.PATH` 缺失但 login-shell 环境含命令时可检出（mock 环境查询层）。

### Phase B（绿）

1. **`core/src/config.ts`**：新增 `cli_agents: Schema.Record(Schema.String, ConfigCliAgent.Info).pipe(Schema.optional)`（子模块 `config/cli-agent.ts`，范例 `config/mcp.ts`）；legacy V1 同步：`core/src/v1/config/config.ts` + `migrate.ts` 映射。
2. **`ConfigCliAdapter` 工厂**（core 侧 `tool/cli-config-adapter.ts`）：产出标准 `CliAdapter`。
3. **registry 收敛**（顺带偿还技术债）：合并模块级 cell 与 Effect service 为单份 `CliAdapterRegistry`（core 提供 service，aigcfroge re-export），`task-driver-fill.ts` 改为从 service 取适配器；内置四个改为一等配置默认值。
4. **解冻 1**：`meta-prompt-filler.ts` 取消 pre-compute，`MetaPrompt.Service.fill` 每次构建 prompt 时实时 `available()`（用 `Effect.cached` + 短 TTL 避免热路径反复 `which`）。
5. **解冻 2**：server 侧 `available()` 结果变化时发 `agent.updated` SSE 事件（周期 re-detect，间隔配置化，默认 60s）；app 经 `global-sync/event-reducer.ts` 更新 store。保底方案：composer 挂载时重新拉取（若事件通道工作量超预期则降级，需显式声明）。
6. **解冻 3（桌面 PATH）**：`detect()` 经 login-shell 环境解析（macOS/Linux 扫 `~/.local/bin`、`/usr/local/bin`、`/opt/homebrew/bin` 等常见目录兜底）。

### Phase C（回归）

core/aigcfroge/app 三包 test + typecheck + lint；手动：配置文件新增一个别名 CLI 条目，不重启 server，@补全与 meta prompt 出现新条目。

### M3 验收

新增 CLI = 装二进制 + 配置 5 行；新装 CLI 60s 内自动出现在 @补全；Electron GUI 启动可探测用户 shell 安装的 CLI。

---

## 6. M4 — transport 抽象 + 官方 SDK 适配器（claude / codex）

目标：删除最脆弱的两套 JSONL 解析，获得权限回调与标准 resume。预估 5–8 天。依赖 M3 的 registry 收敛。

### Phase A（红）

1. `CliAdapter` 接口扩 `transport: "jsonl" | "sdk" | "acp"`（schema 层先行，负测试：未知 transport decode 失败）。
2. claude/codex 两个 SDK 适配器的契约测试：mock SDK 模块（`Layer.mock` 或依赖注入 SDK factory），断言——流式消息 → `DelegationResult`；权限回调触发 `PermissionV2` 决策；resume 走 SDK 的 `resume`/`resumeThread` 而非自解析 hint。
3. 录制测试基建复用：SDK 底层仍是 spawn+JSONL，用 `packages/llm` 的 recordedTests 思路录制 CLI 输出 cassette（或沿用 `bun -e` 假 CLI 回显）保证 CI 无外部依赖。

### Phase B（绿）

1. `CliAdapter` 接口演进（core）：`execute` 语义从"buildArgs+parseOutput"抽象为 transport 分派；jsonl 保持现状作为 gemini/opencode 路径与全局 fallback。
2. 新适配器 `tool/claude-code-sdk.ts`（内部用 `@anthropic-ai/claude-agent-sdk`）、`tool/codex-sdk.ts`（`@openai/codex-sdk`）；`external_cli_session` 的 resume 由 SDK 会话 ID 继续承载（表结构不变）。
3. 权限回调桥：`canUseTool` → `PermissionV2` assert（只做映射，不改权限模型）。
4. 依赖准入：两个 SDK 进 `packages/core/package.json`（评估包体积；desktop 打包不含 CLI 二进制，仍需用户本机安装——探测逻辑不变）。

### Phase C（回归）

core test + typecheck + lint；新旧适配器双跑同一组契约用例（行为对齐矩阵）；保留 jsonl 适配器可配置回退（`cli_agents.<name>.transport` 显式指定）。

### M4 验收

claude/codex 委派不再经过自研 JSONL 解析；CLI 内权限问询弹 aigcfroge 权限 UI；resume 由 SDK 语义保证。

---

## 7. M5 — ACP client 侧终态

目标：统一传输协议，ACP 为一等通道。预估 8–13 天。依赖 M4 的 transport 抽象。

### 范围

1. **ACP client 实现**（新包内模块 `packages/core/src/acp-client/` 或 aigcfroge 侧，选型以实现时 Layer 边界为准）：复用已依赖的 `@agentclientprotocol/sdk@0.21.0`，实现 `ClientConnection` 生命周期（initialize → session/new|session/load → session/prompt → session/update 订阅 → session/cancel）。
2. **transport: "acp" 适配器**：claude-code（`claude-code-acp` 桥接进程）、codex（`@zed-industries/codex-acp`）；gemini 待 `--experimental-acp` 稳定后再切。
3. **session/load 替换 resume_hint**：`external_cli_session` 表语义保留（记录 ACP session id），删除各适配器 `parseResumeHint`。
4. **权限桥**：`session/request_permission` → `PermissionV2` → 复用 M2 的 permission dock UI；`fs/read_text_file` 等 client 能力按安全门禁逐项开放（默认关闭，逐项评估）。
5. **任务卡片升级**：`session/update` 的 tool_call 事件经 `_meta.parentToolUseId` 关联到发起它的 task 卡片，展开视图渲染外部 CLI 实时进度（视觉形态不变，信息密度提升）。
6. **风险与回退**：gemini experimental、opencode 子会话事件不转发 ACP（上游 bug）→ jsonl fallback 长期保留；每个适配器 `transport` 可配置降级。

### 验证

core test（ACP 用内存 transport fake + 真实 `claude-code-acp` 的 `it.live` 冒烟，CI 无 CLI 时 skip）；三端 UI 回归；桌面端手动全链路。

### M5 验收

claude/codex 走 ACP；权限问询双端弹窗一致；外部 CLI 工具调用进度实时可见；JSONL 路径可随时配置回退。

---

## 8. 范围外（明确不做）

- terminal handoff + transcript import（人工交接）：暂缓，后续单独立项。
- PTY/交互式 TUI 驱动外部 CLI：任何阶段不做。
- V1 task 工具（`packages/aigcfroge/src/tool/task.ts`）下线：工作量大，M3 registry 收敛后 V1/V2 共用一份适配器，V1 工具本体留待后续。
- `meta_agent_step` 的 HTTP 端点与 UI 消费：M1 仅补全写入与状态机（让已有表数据变真实）；暴露与否在 M5 收尾时复议。
- `docs/plan/meta-agent-v2-production-closure.md` 与现状不符：M1 收尾时同步修正该文档表述。

---

## 9. 风险登记

| 风险                                                | 缓解                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| M1 改 `SessionFacade.create` 签名波及 subagent 路径 | R 系列测试覆盖 subagent 回归（session-task.test.ts 现有用例兜底） |
| resume 键修复影响已落库的旧行                       | 旧行本来就查不到（bug），无兼容负担；迁移不需要                   |
| M3 周期 re-detect 的 `which` 开销                   | TTL + 间隔配置化；`Effect.cached` 去重                            |
| M4 SDK 版本与 CLI 版本耦合                          | adapter 内做能力探测；保留 jsonl 回退配置                         |
| M5 各家 ACP 成熟度参差                              | 按家灰度；fallback 永久保留                                       |
| 桌面端 PATH 探测平台差异                            | 常见 bin 目录兜底清单 + `it.live` 平台冒烟                        |

## 10. 执行顺序与总验收

M1（core 修复）→ M2（UI 闭环）→ M3（配置+探测）→ M4（SDK transport）→ M5（ACP 终态）。总工期预估 23–34 天。每个里程碑独立可发布、独立验收，均走「改完即审」七步并输出复查结论。全部完成后更新 `ARCHITECTURE.md` §4 子系统表与 `docs/roadmap/external-cli-dispatch-roadmap.md` 状态。
