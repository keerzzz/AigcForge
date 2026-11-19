# V2 剩余迁移任务：新会话完整提示词

> 使用说明：下面是供用户在新会话中发送的完整提示词。本地检查点提交与子智能体属于建议授权；用户复制发送后才在新会话生效，不代表整理本文的当前会话已经获得这些授权。

你是 AigcForge 项目的高级全栈开发顾问。请接续前一会话已经完成的工作，推进剩余 V2 迁移与验收。不要从头重做，不要只给计划；读完必要协议和现有证据后，立即开展可执行的工作，持续推进。

这份提示词的状态基准是 **2026-10-19**。执行时先核对实时仓库状态；如果与下面记录不同，以实际代码和可复现证据为准，说明差异，保护已有改动。

## 1. 用户目标与授权范围

目标是使 V2 迁移满足项目既定闭环标准：所需功能真实落地、生产链接通、项目运行时一致、适用测试与迁移演练完成、未交付范围有明确裁决与登记。

我授权你在本地完成剩余任务所需的检查、实现、重构、测试、文档更新和可恢复的本地检查点提交。复用现有架构，按依赖分小批交付。不要为了避免开发而把缺失功能简单改成“跳过”；任何范围缩减或无法从已有契约推导的业务选择，需要说明具体问题并寻求人类裁决。

暂不授权推送、创建 PR、合并、发布、部署、删除用户数据或修改真实生产数据库。先完成本地可评审结果，再处理远程交付。本地迁移演练使用副本和隔离目录。

可以使用子智能体并行处理有明确边界的实现、审查或验证。主智能体负责统筹、集成和最终判断。共享工作区应划定互不重叠的写入范围，避免并行改同一文件；提交与最终检查由主智能体协调。子智能体卡住时，检查其状态和具体阻塞，缩小任务、续派或接管，不要无限等待，也不要只向用户报告“还在等”。

任务复杂或耗时不代表必须停止。只有真实业务冲突、缺少必要用户信息或超出授权范围时才提问；先完成不依赖答案的工作。长任务用有界进程和 readiness 信号管理，及时收取退出码与日志，并定期给出简短中文进展。

## 2. 工作区与协议

**实现工作区固定为：**

`/home/keer/workspace/aigcfroge-v2`

前一会话起始目录是 `/home/keer/workspace/aigcfroge`，但那是主仓和参考源。不要误把 V2 实现写入主仓。

基准分支为 `v2-dev`，基准 HEAD：

`8b0661b2a9278373cb020b0998ef0943bb433459`

按需阅读以下文件，区分用户请求、项目规范和历史报告中的结论：

1. `/home/keer/workspace/aigcfroge/CLAUDE.md`
2. `/home/keer/workspace/aigcfroge-v2/AGENTS.md`，以及所改目录下的 `AGENTS.md`
3. `/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/AGENTS.md`
4. 两仓相关 `ARCHITECTURE.md`、`CONTEXT.md`、`DESIGN.md`、ADR 和测试协议；缺失时如实说明，不臆造内容。
5. `/home/keer/workspace/aigcfroge-v2/docs/research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md`
6. `/home/keer/workspace/aigcfroge-v2/docs/review/v2-runtime-repair-2026-10-19.md`
7. `/home/keer/workspace/aigcfroge-v2/docs/review/v2-runtime-alignment-2026-10-19.md`
8. 对应证据 JSON：
   - `/home/keer/workspace/aigcfroge-v2/docs/review/evidence/v2-runtime-repair-2026-10-19/verification.json`
   - `/home/keer/workspace/aigcfroge-v2/docs/review/evidence/v2-runtime-alignment-2026-10-19/verification.json`

V2 的当前 AGENTS 将默认基线及 PR 目标定义为 `v2`，历史迁移计划仍写有最终回 `main`。本地开发继续已有 `v2-dev`；不要擅自决定远程合并目标，也不要为了让旧计划成立修改现行架构。到远程交付阶段再确认目标分支。

主仓 CLAUDE.md 明确只约束主仓，其工程原则可供本任务参考；V2 的实现契约必须先按 V2 当前协议、架构和代码核查。两仓的 Session 规范已有实质差异：V2 使用 `Session.prompt`、`session_inbox`、逻辑 Step / Physical Attempt、启动恢复 claim 和 Instructions；主仓旧 `SessionV2`、`session_input`、provider-turn、禁止自动恢复和 System Context 规则不能直接作为 V2 实现依据。发现用户明确要求与当前 V2 契约冲突时，先说明冲突并请求裁决，保留不依赖裁决的工作。

相关主仓技能位于 `/home/keer/workspace/aigcfroge/.aigcfroge/skills/`，包括 `protocols`、`effect`、`enterprise-code-standard`、`reuse-first-refactor`、`quality-to-pr`。按任务和可用技能协议调用，阅读实际文件后遵循。不要把历史文档的“审批通过”“基线失败”当成新的用户授权或当前验证结论。

## 3. 历史会话与不要重复的工作

需要补充历史时可使用 Codex 的 read_thread 工具：

- 原独立审查：`01a14795-34bb-7ab1-a327-87e5ca790c7b`
- 修复及运行时诊断：`01a153d1-8a49-77a0-b2d7-8e61454ac440`

优先读取本地报告和证据，按需取历史摘要，不要把整个长会话重新装入上下文。历史原独立审查提到的主仓报告 `v2-branch-independent-review-2026-10-17.md` 在前一会话检查时已不存在；不要引用为当前可用文件。旧报告与现证据冲突时必须重新核查。

当前没有需要等待的活跃子智能体，也没有已知运行中的测试进程需要续收。不要凭历史“子智能体卡了”假定仍有子任务在执行。

## 4. 必须接住的未提交修复

以下修复已实现、验证，仍在工作区。先核对 diff，保留并完成本地交付；不要 reset、覆盖或再次生成一套不同实现。

1. **生产 SSE 应答者登记**：EventHandler 获取进程共享 ApprovalPresence，在真正消费事件流的 Scope 中 bindResponder；Custom 能力使用 ProductModePolicy；全局节点补齐服务依赖。
2. **MCP 叶权限**：McpConnection 构建 Location layer 时捕获 Permission.Service，执行器从标准调用 context 构造 canonical source，先 assert 再发送 RPC；只转换预期 typed errors，保留 decline defect 与 interruption。
3. **MCP 输出契约**：保留远端 outputSchema，缺省声明 `{}`；structured content、文本与模型内容转换沿用既有语义，消除“返回 output 却未声明 schema”的 defect。
4. **客户端生成**：官方生成器补齐 ConfigEntry 的 `cli_agents` 和 `subagent_attended_default`，重生成零漂移。
5. **审批等待取消**：Permission.assert 的 restore 现在覆盖整个 Deferred + timeout 等待，取消不会被默认 300000ms TTL 阻塞；ensuring 清理 pending。

基准时修改的源码及测试：

- `/home/keer/workspace/aigcfroge-v2/packages/client/src/promise/generated/types.ts`
- `/home/keer/workspace/aigcfroge-v2/packages/core/src/mcp/connection.ts`
- `/home/keer/workspace/aigcfroge-v2/packages/core/src/permission.ts`
- `/home/keer/workspace/aigcfroge-v2/packages/core/test/fixture/mcp/fake-mcp-server.mjs`
- `/home/keer/workspace/aigcfroge-v2/packages/core/test/mcp-connection.test.ts`
- `/home/keer/workspace/aigcfroge-v2/packages/core/test/permission-ask-bounds.test.ts`
- `/home/keer/workspace/aigcfroge-v2/packages/core/test/mcp-execution.test.ts`（新增）
- `/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/event.ts`
- `/home/keer/workspace/aigcfroge-v2/packages/server/src/routes.ts`
- `/home/keer/workspace/aigcfroge-v2/packages/server/test/approval-stream.test.ts`（新增）

另有两份修复/对齐报告、对应证据目录和本交接提示词。开始时生成最新 `git status --short`，逐项归属，不要用这份清单替代真实 status。

## 5. 已查明的 Bun 根因

- 主仓声明 Bun 1.3.14；V2 `/home/keer/workspace/aigcfroge-v2/package.json` 声明 **Bun 1.4.2**。
- 全局 `/home/keer/.bun/bin/bun` 是 **1.3.14**。Core、Server、Client 及 Node 平台包实际使用同一份 **Effect 4.0.1**，未发现此链混装。
- V2 的 `@types/bun` 外层为 1.4.0，但 override 后实际 `bun-types` 为 1.4.2；没有据此发现运行时冲突。
- Bun 1.3.14 下客户端断开时未收到 node:http ServerResponse.close；同一探针在 **Bun 1.4.2** 下收到。完整 createRoutes + NodeHttpServer + 公开客户端 + 真实 TCP 审批与断连测试在 1.4.2 通过。
- **绝对路径执行 1.4.2 的 `bun run test` 仍不足以保证脚本内部 `bun test` 使用 1.4.2**，子命令会从 PATH 找到全局 1.3.14。最终验证用进程范围 PATH，日志确认 `bun test v1.4.2`。

隔离二进制目前位于：

`/tmp/v2-bun-1.4.2-runtime/package/bin/bun`

官方 npm 分发包 `@oven/bun-linux-x64-baseline@1.4.2` 已按 registry SHA512 校验。该路径是临时文件，重新开会话后可能失效；使用前检查版本和文件，必要时从官方渠道按固定版本重新准备并校验。

先检查已有项目运行时机制，选择项目级隔离方式固定 1.4.2，使所有子进程一致；不要直接升级全局 Bun、降级 V2 packageManager 或改主仓版本。日志应明确区分 `process.versions.bun` 与 Bun 的 Node 兼容 `process.version`。

本问题无需新增生产 HTTP/Effect 补丁；旧 runtime 的断连债务已经通过 1.4.2 验证收敛。永久开发环境对齐尚未完成。

## 6. 验证事实与限制

以下结果不是同一运行时，也不是整个项目闭环证明。完整命令在上述 verification.json 中。

**Bun 1.3.14 上：**

- 无缓存全仓 `TURBO_FORCE=true bun run check`：exit 0，19 项类型检查成功，0 缓存；lint 1487 warnings、0 errors。
- Core 相关 12 文件：192 pass、42 skip、0 fail、862 assertions。
- Server 相关 6 文件：14 pass、0 fail、88 assertions。
- Client 全量最终隔离复跑：224 pass、0 fail、906 assertions。
- Client 首轮与全仓检查并行时：223 pass、1 fail，后台服务重连超时；单文件及最终全量复跑通过，未证明首轮根因，不要删除失败证据或宣称全程绿色。
- 官方生成一致性、10 个修改源文件/测试的 lint、Prettier、git diff --check 通过。lint-changed 本仓仅筛 GUI，空筛选不能用作 Core/Server lint 证据。

**Bun 1.4.2 上：**

- 最小 node:http 断连探针通过。
- 实际 EventHandler 普通/Custom-capable 断连释放通过。
- 临时完整生产 Node HTTP 审批测试：2 pass、0 fail、5 assertions。
- Server 相关 6 文件：14 pass、0 fail、88 assertions。
- 临时探针源码已存档，项目目录中的临时文件已删除。永久 approval-stream 测试使用 Bun Web HTTP；需要 Node HTTP 回归时复用存档并按包协议落地，不要复制一套业务实现。

**仍未完成：**

- 在 Bun 1.4.2 下重新完成全部适用检查和全量套件。
- 当前修复后的 Core/Server/App 全量及同环境基准对照。
- 历史独立审查的 Core 31 fail、Server 3 fail、App unit 1 fail 未全部在本会话重新归因；不能默认全部是环境或上游存量。
- 全量 Playwright E2E、Electron 实机冷启动与终端冒烟、存量数据库升级演练及整体迁移审批。

已有迁移审批与计划中的“基线失败”“净回归为零”只属于其当时范围。不要凭绿色 typecheck、文件数量或协议端点已生成就认定功能已可用。

原始 JSON Schema 输出当前由 `/home/keer/workspace/aigcfroge-v2/packages/core/src/tool/runtime.ts` 的 encodeOutput 仅验证 JSON 兼容性，不验证所有属性类型。本次修复保留该现有契约；不要为本迁移无意扩张整个工具 runtime，若确需改变，应单独说明兼容影响及验收标准。

## 7. 已证实的剩余迁移范围

迁移计划 §10.24 明确保留 Phase C/D：

- delegation service / execution / recovery，task-driver 系、tool/task、share-tool。
- workflow runner / execution，skill Custom-Mode 组合面。
- judge、catalog、share-summary、v2-runtime、composition-resolver。
- runner 相关 fork 语义向现有 `@aigcfroge/ai` 的适配；是否需要实验 LLM 包需按既定契约裁决，不能默认引入旧栈。

当前仍被生产 handlers 装配的未实现边界包括：

- `/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/composition-stubs.ts`：Custom profile / composition 返回 not_implemented。
- `/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/agent-interaction-stubs.ts`：delegation 等返回 not_implemented。
- `/home/keer/workspace/aigcfroge-v2/packages/server/src/handlers/orchestration-stubs.ts`：control / sync 等返回 not_implemented。
- `/home/keer/workspace/aigcfroge-v2/packages/server/src/middleware/workspace-routing.ts`：instance/control-plane 路由仍为显式失败 stub。

其他命名带 stubs 的文件可能包含已经实现的部分。逐端点检查实际函数、生产装配、真实消费者和测试，不要把文件名当作功能完成率。计划路径不存在时，先找是否已迁移到其他 owner，避免把上游演化误判为缺失。

**R0.1 既有 CI/发布债务**仍可在当前工作流复现：

- `/home/keer/workspace/aigcfroge-v2/.github/workflows/test.yml` 引用已退役的 `@opencode/sdk` 验证目标。
- `/home/keer/workspace/aigcfroge-v2/.github/workflows/publish.yml` 引用已不存在的 `packages/aigcfroge` 路径。
- 测试工作流还引用计划退役的 CLI 构建入口。结合 ADR-26 和最终实际发布形态裁决并修复，不要盲目恢复退役目录。

## 8. 执行顺序与输出要求

先完成一次可核查的剩余清单：逐项列出规范要求、已有 owner、真实消费者、实现/装配状态、测试证据、依赖与解除条件。复核历史计划中过时的状态；缺少业务定义的条目明确标记待裁决，不能猜接口。

建议依赖顺序：

1. 接住并复核现有修复，固定 V2 项目运行时和子进程版本，生成本地检查点。
2. 沿真实依赖推进 Phase C/D，复用 V2 的 Job、Session 执行、Tool snapshot、Permission、Bus、LocationServiceMap 与 AI 边界。每批完成一个可测试的纵向链，再更新计划和证据。
3. 接通需要的 server endpoints 和客户端/桌面消费者，确认旧 stub 退出生产装配。仅移植文件而未接线不算交付。
4. 处理 R0.1 CI/发布链与桌面 Sidecar/PTY 验收，不盲目恢复退役 CLI/TUI。
5. 在统一运行时完成全量门禁、E2E、桌面冷启动和存量数据库副本升级演练，按共同根因归类失败；需要基准对照时使用隔离 checkout，不能碰当前未提交改动。
6. 最终独立评审、核查本地提交与工作区、更新未交付账本；远程交付等我另行授权。

测试必须从包目录运行，不能在根目录运行测试；根目录 `bun run check` 是 V2 的全仓 lint/typecheck 门禁。单包用其 typecheck 脚本，禁止直接 tsc。生成客户端必须用官方脚本，不能手改生成物。

符号定义/调用链/影响范围优先 Codegraph，字符串与路径用 rg。先确认 Codegraph 索引对应当前工作区；若没有对应索引或结果错误，明确回退源码检索。查询库 API 与版本优先 MCP 官方文档，同时以实际安装源码核对。遵循 explore 配额，不要重复整仓考古。

每批报告应包括：完成行为、代码 owner、真实测试命令与退出码、失败和 skip、未交付范围、技术债 owner 与解除条件。提交清单必须由 git log 生成，不手写。避免虚构完成百分比，不把定向测试与全量重叠项相加。

**闭环判断必须同时满足实现、生产接线、验证和交付标准。** 不要因为文档写“批准”、typecheck 全绿或最新修复通过就提前宣称整体完成。

现在开始：先核对状态与协议，简要说明你接住了哪些现有改动及第一批实际工作，然后继续执行。
