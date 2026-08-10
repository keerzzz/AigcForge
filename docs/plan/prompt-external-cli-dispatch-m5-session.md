你是 AigcForge 仓库的高级全栈工程师，工作目录 /media/keer/办公/aigcfroge。分支 `external-cli-core-fix`（M1–M4 已提交，工作树干净）。本会话执行 M5（终态里程碑）。

【强制首读，未读不动手】
- CLAUDE.md（第一性原理、九荣九耻、安全门禁、改完即审七步流程）
- AGENTS.md（Effect 编码、Schema、测试三模式、自导出模式、禁 star/alias import）
- packages/aigcfroge/AGENTS.md（模块形态、Effect 细则）
- docs/plan/external-cli-dispatch-implementation.md §7（M5 方案，行号锚点以实际代码为准）
- docs/plan/prompt-external-cli-dispatch.md（含 M1–M4 补丁段，本文是 M5 会话版）
- .aigcfroge/skills/effect/SKILL.md（Effect v4 API 真源优先）

【M5 前必补手动验收欠账（先做，别滚到终态）】
1. 真实 SDK it.live 冒烟：`claude-code-sdk`/`codex-sdk` 适配器各一条真实 CLI 冒烟（本机 claude 2.1.220 / codex 0.146.0 已装；`claude --version`/`codex --version` 验证），断言流→DelegationResult 与 resume 生效；CI 无 CLI 时 skip。
2. M1–M3 手动项：TUI 卡片 CLI 徽标/可展开摘要/状态 chip/可跳转四点在真实会话核对；子会话有标题+两条消息+失败态；config 新增 CLI 免重启出现。
3. 手动项需在 docs/review/ 记一条验收记录。

【当前状态（已核实）】
- 提交：`1cae9323c`(M1–M3) → `caa1e6b26`(M4 transport 字段) → `53f4d91af`(M4 SDK 适配器) → `config transport 显式报错`（最新）。
- 依赖：`@anthropic-ai/claude-agent-sdk@0.3.220`、`@openai/codex-sdk@0.146.0`、`@agentclientprotocol/sdk`(ACP 已有) 均在 repo root node_modules。
- 已就绪的 M5 输入：`DelegationResult.sessionId` 出口（M4 修复，jsonl 走 parseResumeHint、SDK 走 sessionId）；core cell 单存储（`registerCliAdapter`/`getCliAdapter`/`listCliAdapters`/`registerConfigCliAdapters`）；`CliAdapter.transport`("jsonl"|"sdk"|"acp") + 可选 `execute()`；fill 已按 transport 分派。
- 审批方三处风险结论：PermissionV2 桥 = M5 强制；config transport 静默降级 = 已修（本次）；真实 SDK 冒烟 = 手动项。

【M1 补丁（经验）】
- lint 新 warning 清零（`bun run lint` 对新增行重开 no-unsafe-type-assertion/consistent-return；SDK 边界 cast 用 `// oxlint-disable-next-line ... -- 原因` 豁免并注释）。
- 禁残留 `as` 强转；禁无理由 as any/@ts-ignore/非空断言。
- 组合根 wiring 必须搜齐同型修复点（app-runtime/server/public 三处；`Layer.mergeAll` 不跨 `Layer.provide` bubble，提供过的服务对 fill 不可见 → 显式 `Layer.provide(EventV2.defaultLayer)` 等）。
- 断言落持久化状态（structured state、DB 行），不只测返回值。

【M2 补丁（契约约束）】
- 不得变更 metadata `{sessionId, parentSessionId, cli, execution_type, status}` 形状。
- 配置定义 CLI 必须走 `aigcfroge/src/agent/agent.ts:409` 同一合成路径出现在 agent 列表（经 CliAdapterRegistry.available()）。
- TUI 无 i18n 体系；TUI route 组件（Task/PermissionPrompt）无渲染 harness → 纯函数化测试（`taskAgentLabel`/`permissionTaskTitle` 先例）；`hideDetails` 是静态 prop 非响应式。
- 状态 chip 数据 `state.status + metadata.status`；样式走 data-component/data-state 属性选择器 + v2 token，禁硬编码颜色。

【M3 补丁（单存储/实时性）】
- registry 已钉死单存储：core cell 是唯一 Map，aigcfroge `CliAdapterRegistry` 是薄 wrapper 委托它。**禁止再建第二 registry**。
- `meta-prompt-filler`：`fill` 实时 `registry.available()`；AgentV2 transform 同步快照 + 60s 周期 re-detect reload；TTL 缓存与「同窗口即时性」契约冲突，勿加。
- config `cli_agents` transport sdk/acp：仅 claude/codex 允许（保留内置 SDK 适配器），其他名显式报错。
- 组合根 fill 需显式 provide EventV2.defaultLayer（M1 教训）。

【M4 补丁（SDK seam 纪律）】
- SDK 边界交付前**对照 node_modules `.d.ts`/运行时逐调用点核对 seam**（抓过真实 codex bug：run 收 string 而非 object）。
- 传输切换过横切 checklist：会话 ID（sessionId/resume）、超时、取消、权限、错误映射、UI metadata 六项逐一核。
- 超时分支字面量显式标契约类型（如 `"failed" as const`）。
- SDK/ACP 适配器用 factory 注入（测试假 SDK、生产真 SDK）；生产 cast 用 oxlint-disable + 注释。

【M5 任务（终态）】
目标：ACP client 侧统一传输——aigcfroge 作为 client 驱动外部 CLI（claude-code、codex），长期收敛方向落点。TDD 红→绿。

Phase A（红）：
1. ACP client 契约测试：`ClientConnection` 生命周期 initialize → session/new|session/load → session/prompt → session/update 订阅 → session/cancel（内存 transport fake；真实 `claude-code-acp`/`@zed-industries/codex-acp` 的 it.live 冒烟，CI 无 CLI skip）。
2. transport:"acp" 适配器契约测试（mock ACP connection）：session/load 响应回填 `DelegationResult.sessionId`；tool_call 经 `_meta.parentToolUseId` 关联 task 卡片；权限 request_permission → PermissionV2。
3. 权限桥测试：SDK canUseTool 与 ACP request_permission 共用同一次组合根接线，断言 assert 收到正确 action/resources/metadata（Layer.mock 捕获）。

Phase B（绿）：
1. ACP client 模块：`ClientConnection` 生命周期实现；Layer 边界按依赖方向裁定（core 提供 seam、aigcfroge 提供真实连接，或反之），选型在实现时说明。
2. transport:"acp" 适配器：claude-code/codex 切换；gemini 待 `--experimental-acp` 稳定再切；opencode 不切（上游子会话事件不转发是已知 bug）。
3. session/load 替换 resume_hint：ACP 适配器从 session/load 响应回填 sessionId，删各适配器 `parseResumeHint`（jsonl fallback 保留 `external_cli_session` 表语义）。
4. 权限桥（M4 强制结转）：`session/request_permission` → `PermissionV2`，与 SDK `canUseTool` **一次组合根接线**（app-runtime/server/public 三处搜齐）；复用 M2 permission dock UI；`fs/read_text_file` 等 client 能力默认关闭逐项评估。
5. 任务卡片升级：session/update 的 tool_call 经 `_meta.parentToolUseId` 关联发起它的 task 卡片，展开视图渲染外部 CLI 实时进度（视觉形态不变，信息密度提升）。
6. fallback：jsonl 长期保留可配置降级（`cli_agents.<name>.transport` 显式 jsonl）。

Phase C（回归）：core/aigcfroge/app/tui 相关包 test + typecheck + lint；新旧传输双跑同一组契约用例做行为对齐。

验收：claude/codex 走 ACP；权限问询双端弹窗一致；外部 CLI 工具调用进度实时可见；JSONL 可配置回退。

收尾：更新 `ARCHITECTURE.md` §4 子系统表 + `docs/roadmap/external-cli-dispatch-roadmap.md` 状态；复议 meta_agent_step 是否暴露 HTTP/UI（M1 范围外项）。

【命令纪律】永不从仓根跑测试；`bun --cwd packages/<name> test --timeout 30000`；typecheck 用 `bun --cwd packages/<name> typecheck`（tsgo）；lint 用 `bun run lint`（仓根）。

【TDD 纪律】红→绿→重构；service/layer 用 it.effect、真实子进程/文件系统用 it.live、落盘用 it.instance；等待并发 fiber 只用就绪信号，严禁 Effect.sleep(N)；测试模式与 M1–M4 既有测试文件对齐。

【交付格式】完成后输出：1. 改动文件清单 2. 红→绿证据 3. 已运行命令及结果 4. 复查结论（改完即审七步固定格式）5. 额外发现。
