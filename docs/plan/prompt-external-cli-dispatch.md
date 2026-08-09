# 执行提示词：外部 CLI 调度 M1–M5（交给执行智能体）

> 用法：每次开工一个里程碑，把「通用前置」+ 对应里程碑段落完整粘贴给执行智能体。M1 可直接执行；M2–M5 在其前置里程碑验收通过后执行。
> 方案全文：`docs/plan/external-cli-dispatch-implementation.md`（已批准 2026-08-05）。

---

## 通用前置（每次必带）

```text
你是 AigcForge 仓库的高级全栈工程师，工作目录 /media/keer/办公/aigcfroge。

【强制首读，未读不动手】
- CLAUDE.md（第一性原理、九荣九耻、安全门禁、改完即审七步流程）
- AGENTS.md（Effect 编码、Schema、测试三模式、自导出模式、禁 star/alias import）
- packages/aigcfroge/AGENTS.md（模块形态、Effect 细则）
- docs/plan/external-cli-dispatch-implementation.md（本任务方案，行号锚点以实际代码为准）
- .aigcfroge/skills/effect/SKILL.md（Effect v4 API 真源优先，禁凭记忆写旧 API）

【TDD 纪律】
- 红→绿→重构：先写失败测试并跑出预期失败（失败信息与预期不符立即停下报告），再最小实现至通过，禁止写完再补测试。
- 测试模式：service/layer 用 it.effect（TestClock）；真实子进程/文件系统用 it.live；落盘用 it.instance。
- 等待并发 fiber 只用就绪信号（pollWithTimeout/awaitWithTimeout/Deferred），严禁 Effect.sleep(N)。
- CLI 进程替身：mock ChildProcessSpawner（范例 packages/aigcfroge/test/installation/installation.test.ts:17-42）或假 adapter + command: process.execPath + bun -e 回显（范例 packages/aigcfroge/test/tool/task.test.ts:304）。
- testEffect 来自各包 test/lib/effect.ts；优先 Layer.mock 部分覆盖而非手写全量 stub。

【命令纪律】
- 永不从仓根跑测试；bun --cwd packages/<name> test --timeout 30000。
- typecheck 用 bun --cwd packages/<name> typecheck（tsgo），禁止直接调 tsc。
- lint 用 bun run lint（仓根）。

【工程门禁】
- 禁止无理由 as any / @ts-ignore / 非空断言；错误用 Schema.TaggedErrorClass；Effect.gen 组合；Effect.fn("Domain.method") 命名。
- 禁止 Effect.fork/forkDaemon，用 Effect.forkIn(scope)；优先 Effect.void。
- 模块用 export * as Foo from "./foo" 自导出；禁新增 export namespace、star import、alias import。
- 最小改动：不顺手修无关代码；审批范围外的发现记入报告末尾「额外发现」，不擅自修复。
- 根因收敛：多处同现错误先找共享根因再修；修复优先级 复用→删除→归并→重构→新增。

【交付格式】完成后输出：
1. 改动文件清单（路径+摘要）
2. 红→绿证据（失败的预期输出 + 通过结果）
3. 已运行命令及结果（test/typecheck/lint）
4. 复查结论（按 CLAUDE.md 改完即审七步的固定格式：影响文件/命中 skills/安全门禁/工程门禁/已运行命令/剩余风险）
5. 额外发现（如有）
```

---

## M1 提示词：core 链路修复

```text
任务：M1 — 外部 CLI 委派 core 链路修复（全部改动在 packages/core，TDD 红→绿）。

【背景事实（已核实，供定位）】
- V2 链路：packages/core/src/tool/task.ts（external-cli 分支 :183-198）→ TaskDriver.executeCLI（tool/task-driver.ts:152-156）→ 组合根 packages/core/src/session/task-driver-fill.ts（execute :98-164）→ cli-timeout.ts executeWithTimeout → 适配器（tool/claude-code.ts、gemini.ts、codex.ts、opencode.ts）。
- P0-1 resume 键不一致：task-driver-fill.ts 读 external_cli_session 用父 Session ID（:126）、写用子 Session ID（:154），resume 永远失效。
- P0-2 V2 子 Session 无 title、无消息（SessionFacade.create 无 title 字段，task-driver.ts:230-236）；legacy 对照 packages/aigcfroge/src/tool/task.ts:144-205（有 title、写 prompt+output 两条 user 消息）。
- P0-3 V2 external-cli 分支固定返回 state:"completed"，错误态丢失；且无 metadata（sessionId/cli/execution_type/status），UI 断链根因。
- meta_agent_step：executeCLI 不写 step；writeStep 落库 status 恒 running，updateStep 零调用者；writeStep 用模块级 stepSeq 计数器（service.ts:231-249）。

【Phase A（红）】新建/扩展四个测试文件，跑出预期失败：
1. packages/core/test/cli-adapters.test.ts（纯函数）：四适配器 buildArgs（新会话/带 resumeId）、parseResumeHint（合法帧/噪声帧/畸形 JSON）、parseOutput（claude type:"result"、codex text.delta+item.completed）。
2. packages/core/test/cli-timeout.test.ts（mock ChildProcessSpawner，it.effect）：CLI 不存在→failed 不抛异常；超时（TestClock 推进）→failed；非零 exit→failed 且 rawStdout 保留；正常→parseOutput 透传。
3. packages/core/test/task-driver-fill.test.ts（it.instance + 真实 Database.defaultLayer :memory:，layer 组合复用 packages/core/test/session-task.test.ts:262-289）：
   R1 子 Session 含 prompt+output 两条消息（prompt 带 [Project directory: …] 前缀）；
   R2 子 Session title = task 输入 description；
   R3 首次执行写 external_cli_session，第二次同父委派复用 external_session_id（mock spawner argv 含 --resume <id>）；
   R4 父 Session 挂 meta agent 时写 type:"external-cli" step，完成 updateStep→completed，失败→failed；
   R5 无 spawner → typed error。
4. packages/core/test/session-task.test.ts（扩展，mock LLM 发 execution_type:"external-cli" toolCall，seam 用 TaskDriver.install 假 cell，范例 packages/core/test/scheduled-job-executor.test.ts:44-70）：
   R6 metadata 含 sessionId/cli/execution_type/status；R7 CLI 失败渲染 task_error；R8 缺 cli_target→ToolFailure；R9 permission.assert 收到 resources:[cli_target] 且 metadata 含 description/execution_type（Layer.mock 捕获入参）；R10 external-cli 产生 session_task 记录且 settle 后回写状态。

【Phase B（绿）】按测试最小实现：
1. tool/task-driver.ts：SessionFacade.create 输入加可选 title；executeCLI 返回 {text, sessionID, status}，移除 :224-225 as 强转。
2. session/task-driver-fill.ts：create 传 title + 消除 :106 as any；补写 prompt/output 两条消息（格式对齐 legacy aigcfroge/src/tool/task.ts:165-205）；resume 读写同键（统一为父 Session ID 键，行内保留子 Session ID 溯源，代码注释说明键策略）；status 透传；无 spawner 改 Schema.TaggedErrorClass；executeCLI 补 writeStep(type:"external-cli") + updateStep。
3. tool/task.ts：external-cli 分支返回 metadata {sessionId,parentSessionId,cli,execution_type,status}；按 result.status 渲染 task_error/task_result；接入 session_task Track B（无 parent_task_id 时 append + onSettle patch，参照 :243-273 subagent 写法）；permission.assert CLI 模式 resources:[cli_target] + metadata:{description,execution_type:"external-cli"}。
4. meta-agent/service.ts：writeStep 的 stepSeq 改表内 MAX(seq)+1。

【Phase C（回归）】
bun --cwd packages/core test --timeout 30000；bun --cwd packages/core typecheck；bun run lint；bun --cwd packages/aigcfroge test tool/task.test.ts（V1 链不动，确认无回归）。

【验收】R1–R10 全绿 + 上述命令全过。顺手修正 docs/plan/meta-agent-v2-production-closure.md 中与现状不符的完成表述（仅修正表述，不改架构）。
```

---

## M2 提示词：UI 呈现闭环（前置：M1 验收通过）

```text
任务：M2 — 外部 CLI 委派 UI 呈现闭环（packages/session-ui、packages/app、packages/tui 三端，TDD 红→绿）。
依赖 M1 契约：tool 结果 metadata 含 {sessionId, parentSessionId, cli, execution_type, status}。

【强制加读】DESIGN.md（v2 token、i18n、a11y）、.aigcfroge/skills/frontend-theming/SKILL.md。

【Phase A（红）】
1. session-ui：抽纯函数 taskCardModel(input, metadata) → {isExternalCli, title, subtitle, status, href?, summary?}，新建 packages/session-ui/src/components/task-tool-card-model.test.ts（参照 message-part.test.ts 的 readPartText 纯函数测试模式）：external-cli 识别、四态映射、summary 提取、无 metadata 回退。
2. app：按 agent-task-hub.test.tsx 惯例写 wiring 契约测试——session-permission-dock.tsx 渲染 metadata.cli_target/execution_type。
3. TUI：照 packages/tui/test/component/task-item.test.tsx 的 testRender+captureCharFrame() 模式，对 src/routes/session/index.tsx task 分支与 permission.tsx 加帧断言（标题含 CLI 标识、状态行、permission 显示 cli_target）。

【Phase B（绿）】
1. session-ui/src/components/message-part.tsx：getToolInfo task 分支与 ToolRegistry task 卡片（:1833-1921）消费 taskCardModel——external-cli 时图标换 terminal + CLI 徽标（新 i18n key ui.tool.cli）；摘要去掉无条件 hideDetails，改 defaultOpen:false 折叠区；状态 chip 四态（running/completed/failed/timeout，数据 state.status + metadata.status）。样式走 data-component/data-state 属性选择器 + v2 token（--v2-*），禁硬编码颜色。
2. app/src/pages/session/composer/session-permission-dock.tsx：渲染 request.metadata.description/cli_target（存在时），不动现有 patterns 列表。
3. tui/src/routes/session/index.tsx Task()：标题 metadata.cli ?? subagent_type；permission.tsx:286-300 渲染 cli_target/execution_type。
4. i18n：packages/ui/src/i18n/ 新增 ui.tool.cli 等 key（en/zh/zht 三语同步，parity.test.ts 自动校验）；清理 packages/app/src/components/prompt-input/slash-popover.tsx:66-69 硬编码 "CLI"、packages/tui/src/component/prompt/autocomplete.tsx:402-422 硬编码 "[CLI]"。
5. a11y：徽标不单独依赖颜色表意；折叠区键盘可达；保留 focus 态。

【Phase C（回归）】
bun --cwd packages/session-ui test src；bun --cwd packages/app test:unit；bun --cwd packages/tui test --timeout 30000；三包 typecheck；bun run lint。手动核对 light/dark 双主题与中英文文本溢出。

【验收】卡片四点（CLI 徽标/可展开摘要/状态 chip/可跳转）三端齐；permission dock 显示委派目标；i18n parity 通过。
```

---

## M3 提示词：声明式配置 + 实时探测（前置：M2 验收通过）

```text
任务：M3 — cli_agents 声明式配置 + 三处探测解冻（packages/core + packages/aigcfroge + packages/app，TDD 红→绿）。

【背景事实】
- config 体系：packages/core/src/config.ts Info（record 字段范例 :62 agents/:92 commands/:105 providers；子模块范例 config/mcp.ts）；消费走 Config.entries() + Config.latest(entries, key)（范例 tool/task.ts:143-144）；decode 用 onExcessProperty:"ignore"（未声明字段静默丢弃）；legacy V1 需同步 core/src/v1/config/config.ts + migrate.ts。
- 冻结点 1：packages/aigcfroge/src/agent/meta/meta-prompt-filler.ts:23 启动时 pre-compute cliNames，之后永不刷新。
- 冻结点 2：packages/app/src/context/global-sync/bootstrap.ts:200 仅启动时拉一次 agent 列表。
- 冻结点 3：适配器硬编码 packages/aigcfroge/src/agent/meta/adapters/registry.ts:24-27 + core/src/session/task-driver-fill.ts:47-50（双 registry 技术债）。
- 桌面坑：Electron GUI 进程 PATH 与终端不一致，detect()（which）会漏检。

【Phase A（红）】
1. config schema：合法 cli_agents decode 成功；未知 output 类型/缺 command → decode 失败。
2. ConfigCliAdapter 工厂：{prompt}/{resumeId} 模板插值 argv；output 三型（claude-jsonl/codex-jsonl/plain）解析复用现有 delegation-parser；timeout 透传。
3. registry：内置四个 + 配置合并；同名覆盖（配置 > 内置）。
4. meta prompt 实时性：available() 结果变化后再次 fill 名单随之变化（当前实现下此测试红）。
5. PATH：process.env.PATH 缺失但 login-shell 环境含命令时 detect() 可检出。

【Phase B（绿）】
1. core/src/config/cli-agent.ts 新建 ConfigCliAgent.Info（command/description/args/resume_args/output/timeout）；config.ts Info 加 cli_agents record 字段；V1 config + migrate 同步。
2. core/src/tool/cli-config-adapter.ts 新建工厂，产出标准 CliAdapter。
3. registry 收敛：模块级 cell 与 Effect service 合并为单份（core 提供 service，aigcfroge re-export），task-driver-fill.ts 改从 service 取适配器；内置四个改为一等默认配置。
4. meta-prompt-filler.ts：取消 pre-compute，fill 时实时 available()（Effect.cached + 短 TTL）。
5. agent 列表动态化：server 周期 re-detect（默认 60s，可配置）变化时发 agent.updated SSE 事件，app 经 global-sync/event-reducer.ts 更新 store；若事件通道工作量超预期，降级为 composer 挂载时重新拉取并显式声明技术债。
6. detect() 经 login-shell 环境解析 + 常见 bin 目录兜底（~/.local/bin、/usr/local/bin、/opt/homebrew/bin）。

【Phase C（回归）】core/aigcfroge/app 三包 test + typecheck + lint；手动：配置文件新增别名 CLI 条目，不重启 server，@补全与 meta prompt 出现新条目。

【验收】新增 CLI = 装二进制 + 配置 5 行免重启生效；Electron GUI 启动可探测用户 shell 安装的 CLI。
```

---

## M4 提示词：transport 抽象 + 官方 SDK 适配器（前置：M3 验收通过）

```text
任务：M4 — CliAdapter transport 抽象 + claude/codex 官方 SDK 适配器（packages/core，TDD 红→绿）。

【目标】claude-code 适配器内部换 @anthropic-ai/claude-agent-sdk、codex 换 @openai/codex-sdk，删除两套自研 JSONL 解析；gemini/opencode 保持 jsonl；jsonl 永久保留为可配置 fallback。

【Phase A（红）】
1. CliAdapter 接口扩 transport: "jsonl"|"sdk"|"acp"（schema 负测试：未知 transport decode 失败）。
2. SDK 适配器契约测试（mock SDK factory 注入）：流式消息→DelegationResult；canUseTool 权限回调→PermissionV2 assert；resume 走 SDK resume/resumeThread 而非 parseResumeHint。
3. CI 无外部依赖：用 bun -e 假 CLI 回显或录制 cassette。

【Phase B（绿）】
1. CliAdapter 接口演进为 transport 分派；jsonl 为 gemini/opencode 路径与全局 fallback。
2. 新建 tool/claude-code-sdk.ts、tool/codex-sdk.ts；external_cli_session 表结构不变（存 SDK 会话 ID）。
3. 权限回调桥 canUseTool → PermissionV2 assert（只映射，不改权限模型）。
4. 两 SDK 进 packages/core/package.json（先评估包体积；仍要求用户本机装 CLI，探测逻辑不变）。

【Phase C（回归）】core test + typecheck + lint；新旧适配器双跑同一组契约用例做行为对齐；cli_agents.<name>.transport 可显式指定回退 jsonl。

【验收】claude/codex 委派不经自研 JSONL 解析；CLI 内权限问询走 PermissionV2；resume 由 SDK 语义保证。
```

---

## M5 提示词：ACP client 侧终态（前置：M4 验收通过）

```text
任务：M5 — ACP client 侧统一传输（TDD 红→绿）。

【背景】仓库已依赖 @agentclientprotocol/sdk@0.21.0，packages/aigcfroge/src/acp/ 是 agent 侧实现（供编辑器驱动 aigcfroge），本任务补 client 侧（aigcfroge 驱动外部 CLI）。协议参考 https://agentclientprotocol.com/protocol/overview。claude-code-acp 与 @zed-industries/codex-acp 为桥接进程。

【范围】
1. ACP client 模块（Layer 边界选型：packages/core/src/acp-client/ 或 aigcfroge 侧，实现时按依赖方向裁定并说明）：ClientConnection 生命周期 initialize → session/new|session/load → session/prompt → session/update 订阅 → session/cancel。
2. transport:"acp" 适配器：claude-code、codex；gemini 待 --experimental-acp 稳定再切。
3. session/load 替换 resume_hint：删除各适配器 parseResumeHint；external_cli_session 表存 ACP session id。
4. 权限桥：session/request_permission → PermissionV2 → 复用 M2 permission dock UI；fs/read_text_file 等 client 能力默认关闭、逐项评估开放（Security First 门禁）。
5. 任务卡片升级：session/update 的 tool_call 经 _meta.parentToolUseId 关联发起它的 task 卡片，展开视图渲染外部 CLI 实时进度（视觉形态不变）。
6. fallback：jsonl 长期保留，适配器 transport 可配置降级；opencode 子会话事件不转发 ACP 是上游已知 bug，不切 opencode。

【验证】core test（内存 transport fake + claude-code-acp it.live 冒烟，CI 无 CLI 时 skip）；三端 UI 回归；桌面端手动全链路。

【验收】claude/codex 走 ACP；权限问询双端弹窗一致；外部 CLI 工具调用进度实时可见；JSONL 可配置回退。
【收尾】更新 ARCHITECTURE.md §4 子系统表、docs/roadmap/external-cli-dispatch-roadmap.md 状态；复议 meta_agent_step 是否暴露 HTTP/UI（彼时给结论）。
```
---

## M1 审批结果（2026-08-06，通过）与后续里程碑补丁

M1 已验收通过，审批记录见 `docs/review/external-cli-dispatch-m1-review.md`。以下经验补丁并入通用前置，M2 起生效：

```text
【M1 经验补丁（M2 起追加遵守）】
1. 交付前自查 lint 新增 warning 必须清零（bun run lint 的 incremental 报告只看你改的文件）——M1 曾被检出 2 个未使用 import。
2. 禁止残留 as unknown as / as any 强转：先用 typecheck 验证能否直接删除，删不掉再注释理由。M1 有一处可删未删，审批时代为清理。
3. 组合根 wiring 类改动（Layer provide）必须搜齐所有组合根同型修复：M1 的 EventV2 依赖涉及 packages/core/src/public/aigcfroge.ts、packages/server/src/handlers.ts、packages/aigcfroge/src/effect/app-runtime.ts 三处，漏一处就是运行时 Service not found。
4. 契约测试的断言要落到持久化状态（如 tool 的 structured state、DB 行），不要只断言函数返回值——M1 的 R6/R10 是好范例，继续保持。

【M1 已确立、M2 直接可用的契约事实】
- task 工具 Output 现含 metadata: {sessionId, parentSessionId, cli, execution_type:"external-cli", status}（持久化为 tool state 的 structured 字段）。M2 的 UI 消费以此为数据源，不要再依赖启发式猜子 Session（message-part.tsx:505-520 的 taskSession 回退保留但不再是主路径）。
- 子 Session 有 title（= task description）且含 prompt+output 两条用户消息，点卡片跳转后非空白。
- permission assert 的 metadata 含 {description, execution_type:"external-cli"}，resources=[cli_target]——M2 的 permission dock 渲染直接读 request.metadata。
- 子 Session 消息经 SessionEvent.Prompted 投影写入（不触发 drain）。
```
---

## M2 审批结果（2026-08-06，通过）与 M3 补丁

M2 已验收通过，审批记录见 `docs/review/external-cli-dispatch-m2-review.md`。M3 开工时携带「通用前置」+「M1 经验补丁」+ 本段 +「M3 提示词」。

```text
【M2 经验补丁（M3 起追加遵守）】
1. i18n 语言政策：packages/ui/src/i18n 与 packages/app/src/i18n 均只维护 en/zh/zht 三语（2026-07-31 政策），其余 15 个 locale 是冻结快照走英文回退——新 key 只加三语即可，parity 测试会守住。
2. 无渲染 harness 的包（session-ui/app/tui routes 级）：抽纯函数 + 单测是仓库认可的等价契约（taskCardModel/taskAgentLabel 是范例）；源码 wiring 断言仅限 app 既有惯例。
3. 执行中对方案的主动偏差（如帧断言→纯函数测试）必须在复查结论中声明理由与先例——M2 执行方做得好，继续保持。

【M2 已确立、M3 直接可用的契约事实】
- UI 契约已落地：metadata {sessionId, parentSessionId, cli, execution_type, status} 是三端卡片/权限 UI 的唯一数据源；M3 改 registry/适配器时不得变更该契约形状。
- agent 列表条目带 source:"external-cli"（agent.ts:409 合成），@补全与卡片都消费它；M3 的配置定义 CLI 必须走同一合成路径出现在列表里。
- ui.tool.cli i18n key 已存在（三语），M3 新增文案沿用同组命名。
```
---

## M3 审批结果（2026-08-06，通过，含审批方修复）与 M4 补丁

M3 已验收通过，审批记录见 `docs/review/external-cli-dispatch-m3-review.md`。M4 开工时携带「通用前置」+「M1 经验补丁」+「M2 经验补丁」+ 本段 +「M4 提示词」。

```text
【M3 经验补丁（M4 起追加遵守）】
1. live 服务（transform/filler/监听类）交付前必须核实生产调用方真实存在且生效——M3 的 MetaPrompt.Service.fill 无生产调用方，且 plugin init（packages/core/src/plugin/agent.ts:402）会预填空占位消费掉 {{CLI_LIST}}，导致后注册 transform 变 no-op。验收标准：必须有钉死真实构建顺序（AgentV2.layer→template→filler）的跨 reload 测试。
2. 占位符填充逻辑要顺序无关：先匹配占位符，再匹配"空填充"标记幂等重填（meta-prompt.ts 的 fillCliList + NO_CLI_MESSAGE 是范例），不要假设 transform 注册顺序。
3. lint 新增 warning 必须清零再交付（M1 补丁第 1 条重申）——M3 又出现 1 个未使用 import。
4. registry/存储收敛后，旧路径的薄包装文件要确认无引用再删（M3 审批方删了 aigcfroge 侧 claude-code/gemini/codex 三个死适配器文件）。

【M3 已确立、M4 直接可用的契约事实】
- cli_agents 声明式配置已生效：V2 Config.Info.cli_agents（config.ts:66）+ V1 schema/migrate 同步；TaskDriverFill 组合根注册内置四适配器后注册 config 条目，同名覆盖内置（config > built-in）。
- registry 单份：core/src/tool/cli-adapter.ts 的 module cell 是唯一存储；aigcfroge CliAdapterRegistry 是其薄 Effect 包装。M4 新增 SDK 适配器注册进同一 cell（registerCliAdapter），不要再建第二存储。
- CliAdapter 接口现状：{name, command, description, detect, buildArgs, parseOutput, parseResumeHint, timeout?}（core/src/tool/cli-adapter.ts）。M4 扩 transport 字段时保持向后兼容（现有四适配器与 fromConfig 默认 "jsonl"）。
- metadata 契约不变（M2 确立）：{sessionId, parentSessionId, cli, execution_type, status} 仍是 UI 唯一数据源，SDK 适配器必须产出同形 metadata。
- external_cli_session 表结构不变：SDK resume 的会话 ID 直接存现有列。
- meta prompt 动态化已闭环：MetaPromptFiller transform effectful 实时取名单 + 60s re-detect 触发 reload；M4 换 SDK 传输不影响该链路。
- 解冻 2 技术债：config 热更靠 composer 重拉 + 60s re-detect 兜底，SSE 推送未做。
```
---

## M4 审批结果（2026-08-06，通过，含审批方修复）与 M5 补丁

M4 已验收通过，审批记录见 `docs/review/external-cli-dispatch-m4-review.md`。M5 开工时携带「通用前置」+「M1–M3 经验补丁」+ 本段 +「M5 提示词」。

```text
【M4 经验补丁（M5 起追加遵守）】
1. SDK/协议边界的 mock seam 测试有根本局限：as unknown as cast 会掩盖真实库的形状失配——M4 的 codex run({type:"text"}) 在真实 SDK 里必抛 TypeError（normalizeInput 对非字符串做 for..of），mock 全绿也发现不了。交付前必须对照 node_modules 的 .d.ts 与运行时实现逐调用点核对 seam 的每个方法签名与参数形状。
2. 传输路径切换时，既有横切能力必须逐条过 checklist：M4 换 SDK 路径丢了 (a) 会话 ID 捕获（持久化依赖 parseResumeHint，SDK 适配器没有）和 (b) 超时包装（executeWithTimeout 只包 jsonl 路径）。checklist：会话 ID、超时、取消、权限、错误映射、UI metadata，一项都不能默认"新路径自然继承"。
3. 超时/降级分支的返回字面量要显式标注为契约类型（Effect.succeed<DelegationResult>），否则 union 收窄会让下游属性访问挂掉 typecheck——core 全量 test 全绿也抓不到，必须跑 typecheck 再交付。

【M4 已确立、M5 直接可用的契约事实】
- CliAdapter 接口现状：{name, command, description, detect, buildArgs, parseOutput, parseResumeHint?, timeout?, transport?, execute?, cancel?}。transport: "jsonl"(默认)|"sdk"|"acp"；execute(input: {prompt, cwd, resumeId?, canUseTool?}) => Effect<DelegationResult>。
- DelegationResult 增 sessionId?：SDK/ACP 传输的会话 ID 出口；task-driver-fill 持久化统一走 result.sessionId ?? parseResumeHint?.(rawStdout ?? summary)，acp 适配器也必须从 session/load 响应回填 sessionId。
- SDK 超时语义：adapter.timeout ?? 300_000，超时返回 {status:"failed", summary 含 "Timed out"}（M2 UI timeout chip 依赖该文案）；acp 路径保持同语义。
- SDK 注册即默认：TaskDriverFill 与 aigcfroge registry 都注册 claude-code-sdk/codex-sdk（同名覆盖 jsonl）；config cli_agents 同名条目仍可覆盖回 jsonl（config > built-in）。M5 的 acp 适配器同模式：注册同名覆盖 SDK 成默认。
- 权限桥债务（M5 强制项）：PermissionV2 需接进 TaskDriverFill 的 executeCLI——SDK canUseTool 与 ACP session/request_permission 共用这一次组合根 wiring（搜齐 public/server/app-runtime 三处，M1 补丁第 3 条）。wiring 完成前 SDK/ACP 均为 auto-deny。
- fromConfig 边界：config 条目 transport:"sdk" 目前静默产出无 execute 的适配器（实际 jsonl）。M5 必须二选一：实现 SDK 工厂选择，或对 transport:"sdk"/"acp" 显式报错，禁止静默降级。
- 依赖现状：@anthropic-ai/claude-agent-sdk@0.3.220、@openai/codex-sdk@0.146.0 在 packages/core；@agentclientprotocol/sdk@0.21.0 仓库已有。
- 手动验收欠账（M5 前补）：真实 SDK it.live 冒烟（claude 2.1.220 / codex 0.146.0 本机已装）；M1–M3 手动项（tmux TUI 卡片、子会话双消息、配置新增 CLI 免重启）。
```
---

## M5 审批结果（2026-08-06，通过，含审批方修复）— 里程碑收官与后续项

M5 已验收通过，M1–M5 全部收官。审批记录见 `docs/review/external-cli-dispatch-m5-review.md` §7（执行方交付记录在 §1–§6）。

```text
【M5 经验补丁（后续里程碑遵守）】
1. 交付前必须自己跑一遍 typecheck——连续两个里程碑（M4 union 收窄、M5 测试缺 import）typecheck 假绿，test 全绿不能替代 typecheck。
2. 对计划假设的修正要给出证据链——M5 执行方推翻"三根显式 wire PermissionV2"时附了 location-layer.ts:109 + 工具 execute 惯例 + 正反两面理由（根级静态 Location 污染 project 作用域），是标准做法，继续保持。
3. 能力声明要精确到"接线状态"：M5 的"任务卡片数据层已完成"实际指接口+发射侧就绪、fill 未接线、无消费者。以后此类声明统一按「接口/发射/接线/消费」四段式描述。

【M5 已确立的契约事实（终态）】
- 传输优先级：ACP（which() 门控桥二进制）> SDK > jsonl，同名注册覆盖；config cli_agents 同名仍可覆盖（config > built-in）；config transport:"sdk"/"acp" 用于非 claude/codex 名显式报错。
- 权限桥：fill 的 executeCLI 经 serviceOption(PermissionV2.Service) 从会话 drain 上下文解析，canUseTool 对 PARENT session assert（action=工具名/kind，resources=[JSON input]，metadata={cli, external:true}）；SDK canUseTool 与 ACP request_permission 共用；无 PermissionV2 → auto-deny。ACP 侧 action 用 toolCall.kind（协议不带工具名）。
- ACP client：packages/core/src/acp-client/{connection,update,process}.ts；适配器 tool/acp.ts 的 makeAcpAdapter 通用，claude-code-acp/codex-acp 薄包装；session/load 回填 DelegationResult.sessionId；stopReason→status 映射 end_turn=success、max_tokens/max_turn_requests=partial、其余 failed。
- onProgress 休眠基础设施：CliAdapter.execute 接受 onProgress、ACP 适配器发射 ToolCallProgress（含 _meta.parentToolUseId），fill 未接线、无 UI 消费。启用需三段：fill 传参 → 状态/事件 → UI 渲染。
```

【后续独立项（不属本计划，需各自立项）】
1. 手动验收欠账：桥二进制 it.live 冒烟（装 claude-code-acp/codex-acp 后）；真实 SDK 冒烟（AIGCFROGE_LIVE_CLI_SMOKE=1，等 provider 配额）；M1–M3 TUI 三点（卡片四点/子会话双消息/配置免重启）。
2. 任务卡片外部 CLI 实时进度 UI（onProgress 三段接线 + 展开视图渲染，视觉方案先行）。
3. meta_agent_step 暴露决策（P2：补全 HTTP+AgentTaskHub 消费，或删表）。
4. ACP loadSession 能力探测回退（不支持 load 的桥回退 newSession）。
