# V2 分支独立审批复核 — 2026-10-17

**结论：REQUEST_CHANGES，不予通过当前工具流批次的审批；不批准整条分支合并或发布。**

本次确认 **3 项 P1 运行缺陷、1 项 P2 生成客户端缺口**。前三项已用生产实现和独立回归探针复现。既有测试通过及类型检查通过，均未覆盖这三个组合边界。另有已披露的 CI 退役包债务，按原计划保留其阶段性例外，不将其冒充本批新回归。

## 1. 对象与基线

| 项目                 | 固定值                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------- |
| 工作区               | `/home/keer/workspace/aigcfroge-v2`                                                    |
| 分支与 HEAD          | `v2-dev` / `8b0661b2a9278373cb020b0998ef0943bb433459`                                  |
| 迁移基点             | `461721082`，方案记载的 `upstream/v2` 快照                                             |
| 最新工具流批次前基线 | `06a42de9c`                                                                            |
| 最新批次             | 13 提交，118 文件，+13,844 / −505 行                                                   |
| 整体迁移             | 基点后 90 提交；未声明完成所有文件的逐行审计                                           |
| 主工作区             | `/home/keer/workspace/aigcfroge`，`main` 为 `75ee27fbd`；用户已有 `CLAUDE.md` 改动未动 |

计数由 `git rev-list --count`、`git diff --numstat` 生成，提交列表见证据目录。当前浅历史下 `git merge-base main HEAD` 返回 1；不能用普通 `main...HEAD` 表示此次迁移。按实施方案的固定 V2 基点审查迁移，按批次前基线定位本批引入的问题。

审查期间只创建报告和外部复现文件。`check:generated` 生成的一个工作区改动已保存差异后恢复；V2 工作区恢复干净，HEAD 未变。未提交代码、推送、合并或发布 GitHub 审批。

## 2. 重新调研的规范与适用关系

| 依据                                                                                                                       | 本次采用的约束                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 主工作区 `CLAUDE.md`、用户提供的 `AGENTS.md`                                                                               | 查询真实接口；追踪完整数据流；复用现有 owner；分别报告通过、失败与未验证项          |
| 主工作区 `ARCHITECTURE.md`、`CONTEXT.md`、ADR-19 / ADR-20                                                                  | Location 隔离；最终工具授权边界；审批连接事实；授权先于副作用                       |
| 主工作区 `.aigcfroge/skills/protocols/SKILL.md`                                                                            | 路由至 Tool、Effect、Schema、迁移与交付相关协议                                     |
| 两树的 Effect skill、主工作区 database / reuse-first-refactor / enterprise-code-standard / quality-to-pr 及 delivery gates | 检查 Layer 依赖、返回协议、复用面、真实测试、生成物与交付证据；不启动实现或 PR 流程 |
| V2 `AGENTS.md`、`packages/schema/AGENTS.md`                                                                                | 遵循 V2 当前 Schema → Core / Protocol → Server 分层和生成客户端要求                 |
| V2 `packages/core/src/tool/AGENTS.md:19`、`:29`、`:54`                                                                     | 叶执行器取得 Permission；叶执行器负责权限与副作用顺序；工具目录过滤不是执行授权     |
| V2 迁移方案 §9.1、§10.21–10.25；两份既有审批记录                                                                           | 区分已批准的阶段例外、待迁移范围与本批完成声明；历史测试数字不能代替本次实测        |
| V2 `.github/workflows/check.yml`、`test.yml` 与 package scripts                                                            | 分别检查本地 check、实际 CI 任务、生成客户端和包测试                                |

V2 没有根 `CLAUDE.md`。本次从主工作区读取用户指定宪法；V2 已演化的 Tool / Schema 契约以其 owner 和当地协议核对，未把旧树的类型名、执行模型或测试目录机械套用。Codegraph 调用确认 V2 未初始化，故符号调查回退到文本检索和精确源码读取。并行复核代理因服务容量错误均未完成，其输出不计作审查证据。

## 3. 本批必须修复的发现

### F1 — P1：生产事件订阅没有登记审批者，正常交互的 ask 被即时拒绝

**引入提交：`a251db78a`。改动位置：`packages/core/src/permission.ts:336`。**

`assert` 在创建请求前调用 `requireResponder`。该函数在 `permission.ts:241` 查询 `ApprovalPresence.hasResponder`，未命中即返回 `RejectedError(no_responder)`。决定连接是否存在的实现是 `permission/approval-presence.ts:81`：它仅检查 `bindResponder` 写入的数组。

生产订阅入口 `packages/server/src/handlers/event.ts:19` 只调用 `EventFeed.subscribe`；实际订阅逻辑 `packages/server/src/event-feed.ts:75` 只登记 Queue。全生产树没有 `bindResponder` 调用。提供服务的 Layer 并不会自动登记客户端连接。

**触发条件与影响：** 有人值守 Session 的权限结果为 `ask`，且没有可用 grant。即使客户端已订阅且能接收事件，工具执行仍失败；没有 pending 请求，也没有可供 UI 回复的审批。该条件不限 Custom 模式。

**实测：** 复现使用真实 Bus、真实 EventFeed 和 Permission 节点。订阅实际收到一条公共事件，随后得到：

```json
{ "receivedFrames": 1, "present": false, "failure": { "_tag": "Permission.RejectedError", "reason": "no_responder" } }
```

**测试为何漏检：** `permission.test.ts:24`、`permission-ask-bounds.test.ts` 和本批更新的 shell 测试手工 `bindResponder`。它们证明已绑定场景有效，未证明 HTTP 订阅会绑定。ADR-20 §2.7 明确要求生产事件流在连接 Scope 内登记并在断连时释放。

**修复与验收：** 在真实事件流连接生命周期中接入共享的 ApprovalPresence，保留能力头、Location 与断连清理语义。增加跨 Server 事件订阅 → Core assert → 事件收到 → reply 的集成测试；同时证明断连后 fail-closed。不要用默认在线或测试专用 bind 掩盖缺口。

### F2 — P1：新增 MCP 叶执行器跳过审批，ask 策略下已产生外部调用

**引入提交：`fc51db11b`。改动位置：`packages/core/src/mcp/connection.ts:968`。**

`establish` 注册的 `execute` 仅接收 `callInput`，直接调用 `callServer`；未接收标准调用 context，未调用 `Permission.assert`，节点依赖也没有 Permission。

**决定关系的实现：** `Tool.snapshot` 在 `packages/core/src/tool.ts:230` 仅过滤整体禁用的工具；`whollyDisabled` 在 `:292` 仅处理最终匹配的 wildcard deny。`ask` 工具会保留。`Snapshot.execute` 在 `:279` 直接进入叶执行器，运行边界 `tool/runtime.ts:37` 不补授权。现有同族 `tool/mcp.ts:49` 则先用 Session、Agent、messageID、call ID 调用 `permission.assert`，然后调用 MCP。

**触发条件与影响：** Custom feature flag 开启，新增 `McpConnection` 连接已建立，其 canonical MCP 工具被模型选择，策略为 `ask`。未出现审批，外部工具已经收到调用；返回失败无法撤销此前副作用。

**实测：** 使用真实连接节点、stdio 子进程、真实 Permission 规则与 `Tool.snapshot(rules).execute`。外部 fixture 在收到 `tools/call` 时写入标记：

```json
{ "policy": "ask", "externalCallReached": true, "pending": [] }
```

本次没有声称旧配置驱动的 `Mcp` 路径也存在同一漏洞。新增连接 owner 已入 Instance 图，但尚未发现生产配置或 Server 路由主动调用其 `connect`；当前应用可达性受后续 composition 接线范围限制。它作为本批交付的执行接口已经违反授权契约，应在接线前修复，不能据测试绿灯审批。

**修复与验收：** 复用现有 MCP 叶执行器的权限与 context 约定，在任何 RPC 前完成授权。对 allow / ask / deny、拒绝、资源级规则、已捕获工具快照分别验证；`ask` 未回复和 `deny` 时，外部进程必须收到零次调用。

### F3 — P1：新增 MCP 成功结果违反 Tool 输出契约，必经成功路径触发 defect

**引入提交：`fc51db11b`。改动位置：`packages/core/src/mcp/connection.ts:967`。**

注册对象提供 `input` 却没有 `output` schema。`toolResultOf` 在 `connection.ts:364` 总是返回带 `output` 属性的对象，包括纯文本、空内容和 structuredContent。

**决定关系的实现：** `packages/core/src/tool/runtime.ts:46` 明确规定：缺少输出 schema 时，结果只要含 `output` 即 `Effect.die("Tool result declared output without an output schema")`。现有同族 `tool/mcp.ts:48` 会注册 `output: tool.outputSchema ?? {}`。

**实测：** 真实 stdio fixture 成功返回 `echo:authorized`，经生产 registry 执行后的结果是：

```text
Exit.Failure → Cause.Die("Tool result declared output without an output schema")
```

**影响：** 远端动作已成功，但 Session 无法取得正常工具成功结果；不是普通远端 MCP 报错。F2 的外部调用也会继续撞上此缺陷，两个问题必须分别验证。

**测试为何漏检：** connection 测试主要调用 `conn.callTool`；registration 测试用自己声明 input/output 的 echo 工具。两组都没有测试真实 connection 生成的工具经 `Tool.Snapshot.execute` 结算。

**修复与验收：** 按当前 Tool 契约声明正确输出 schema，或在确实无结构化输出契约时仅返回 content。复用已有 MCP 转换约定，覆盖文本、结构化内容、空内容、isError 与混合内容的完整执行结算。

### F4 — P2：新增配置字段未同步生成客户端，官方漂移门禁失败

**引入提交：`8a9228bdb`。改动位置：`packages/schema/src/config.ts:62`。**

Schema 新增 `cli_agents` 与 `subagent_attended_default`，但 `packages/client/src/promise/generated/types.ts` 中的 `ConfigEntry` 缺少这两个字段。

**实测：** 从 `packages/client` 运行 `bun run check:generated` 返回 **1**。官方生成器只改动该文件，新增 11 行，对应这两个字段。完整差异见证据目录。

**影响：** 客户端声明与配置合同不同步，使用生成 ConfigEntry 类型的对象字面量无法表达新配置；CI 的 generated-client 检查也会失败。类型检查通过不能验证生成物新鲜度。

**修复与验收：** 使用 `packages/client` 的 `bun run generate` 重新生成并提交产物；随后 `check:generated` 必须返回 0。不要手改生成类型。本次生成结果已保存为证据并恢复，以保持待审分支不变。

## 4. 已知门禁债务与未完成范围

### G1 — 已登记的 CI 死配置，阻止整分支交付放行

`.github/workflows/test.yml:130` 仍过滤已删除的 `@opencode/sdk`。直接运行该命令返回：

```text
x No package found with name '@opencode/sdk' in workspace
```

同文件 `:141`、`:157` 仍把工作目录设为已删除的 `packages/cli`；`:171` 指向已删除的 `services/www`。这是包裁剪后的同一引用闭包缺口，应按桌面端新边界统一更新。

**既有例外有效：** 迁移方案 `:242` 已将 `.github` 死配置明确列为 R0.1，允许 R0 只用本地 install/typecheck 门禁，计划在 ADR-26 处理。因此本报告不把 G1 算作本批新增缺陷，也不要求倒改已批准的 R0 范围。它仍未满足整分支合并/发布的 CI 要求。

### 范围台账

以下 Owner 是建议的责任域，不代表已由人类指派。报告不关闭这些范围，也不将它们计入已交付：

| 范围                                                                                     | 责任域                   | 解锁条件                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| F1 生产审批连接                                                                          | Server / Core Permission | 真实 SSE → assert → reply 与断连测试通过                   |
| F2 / F3 新 MCP 执行边界                                                                  | Core MCP / Tool          | 授权前零 RPC；真实注册工具全结果类型正常结算               |
| F4 生成客户端                                                                            | Schema / Client          | 生成后零漂移，配置类型合同一致                             |
| G1 R0.1 CI 退役包引用                                                                    | Infra / ADR-26 发布体系  | 当前保留包的完整 CI 工作流可运行                           |
| Phase C/D delegation、task-driver、workflow、judge/catalog、composition、runner/LLM 收敛 | Core                     | 按方案 §10.24 的真实消费者接线与集成测试完成               |
| 5 模式 App 接入、sidecar、桌面冷启动、Ghostty 打包                                       | App / Desktop            | R3–R4 验收完成                                             |
| 存量数据库升级、完整 E2E、cutover                                                        | Core / QA / Release      | 升级回放与 R5 门禁通过；migration --check 不能替代升级演练 |
| 历史失败“逐名同集”声明                                                                   | 各失败测试 owner         | 相同运行时、隔离环境、命令、固定旧 HEAD 的双向对照         |

## 5. 验证结果

结果以本次命令结束状态为准，详见证据目录 `verification.txt`。通过、失败及跳过分别列出，不沿用旧审批的汇总数字。

| 检查                            | 命令 / 范围                                              | exit | 本次结果                                               |
| ------------------------------- | -------------------------------------------------------- | ---- | ------------------------------------------------------ |
| 无缓存 lint + 全仓 typecheck    | 根目录 `TURBO_FORCE=true bun run check`                  | 0    | 19/19 成功，0 缓存                                     |
| Permission / grant / shell 定向 | core 包；8 个文件，完整命令见 verification.txt           | 0    | 145 pass / 42 skip / 0 fail                            |
| MCP / CLI / ACP / SDK 定向      | core 包；13 个文件                                       | 0    | 119 pass / 0 fail                                      |
| 资产 / 任务 / 记忆工具定向      | core 包；10 个文件                                       | 0    | 46 pass / 0 fail                                       |
| Core 全量                       | core 包 `bun run test --timeout 30000`                   | 1    | 6930 pass / 365 skip / 31 fail；7326 tests / 347 files |
| Server 全量，XDG 隔离           | server 包 `bun run test --timeout 30000`                 | 1    | 79 pass / 1 skip / 3 fail；83 tests / 29 files         |
| Schema 全量                     | schema 包 `bun run test --timeout 30000`                 | 0    | 319 pass / 0 fail                                      |
| Client 全量                     | client 包 `bun run test --timeout 30000`                 | 0    | 224 pass / 0 fail                                      |
| 生成客户端                      | client 包 `bun run check:generated`                      | 1    | ConfigEntry 生成差异 11 行，已保存并恢复               |
| 迁移结构检查                    | core 包 `bun run migration --check`                      | 0    | 无 schema 漂移；不等于存量库升级通过                   |
| 三条新增边界回归                | core 包运行外部 boundaries.test.ts                       | 1    | 0 pass / 3 fail，分别复现 F1/F2/F3                     |
| CI SDK 任务复现                 | 根目录 `bun turbo verify:package --filter=@opencode/sdk` | 1    | 目标包不存在；属于已登记 R0.1                          |
| 批次差异格式                    | `git diff --check 06a42de9c HEAD`                        | 0    | 通过                                                   |

Core 失败按共同前提归类：GitLab OAuth 11 项（日志报告本机 8080 端口占用）；Plugin / watcher 11 项；Config 4 项；Location 缓存身份、modern MCP、Bus replay routing、SSE reconnect、ModelsDev 各 1 项。分类只用于定位，并未把未查明的失败全部定性为环境问题。

Server 首轮未加 XDG 隔离为 78 pass / 1 skip / 4 fail，额外包含 OAuth 端口测试。按方案 §9.2 隔离重跑后为表中结果，余下为 HEAD 下载中止和 canonical plugin 两项；首轮不作为正式基线。既有报告记载 Core 34 fail，本次为 31 fail。未完成旧 HEAD、同运行时、同隔离配置的双向对照，故不声称失败集合相同或净回归为零。

定向测试与全量测试有重叠，不合计为独立测试覆盖。三条新增回归的失败是缺陷复现，未计入 Core 原有 7326 个测试。

| 其他受影响包检查           | exit | 本次结果                                             |
| -------------------------- | ---- | ---------------------------------------------------- |
| AI `bun run test`          | 0    | 1793 pass / 28 skip / 0 fail；1821 tests / 134 files |
| App `bun run test:unit`    | 1    | 741 pass / 1 fail；742 tests / 107 files             |
| App `bun run test:browser` | 0    | 168 pass / 0 fail；168 tests / 38 files              |

App 的单个失败为 `recovers project metadata after the connection to the server is dropped`。本次未在旧 HEAD 重跑，不声明其基线归属。这里的 `test:browser` 使用 browser 条件与 happydom，不代表 Playwright 或 Electron 实机验证。

## 6. 根因与复审路径

F1–F3 共享的集成根因是：迁移保留了模块内测试，却遗漏生产 owner 之间的连接契约。F1 测试替调用方登记 responder；F2/F3 的连接测试绕过 registry，而 registry 测试另造了完整工具。应先补三条跨 owner 的失败回归，再在既有授权与结果契约处修复。

简单地增加默认在线状态、放宽 Tool 输出校验或在测试里补更多 Layer，会掩盖真实问题。建议保持当前 V2 架构，复用已有 MCP 叶执行约定，将必要生产接线补齐。无需为了本次修复增加第二注册表、执行器或权限中心。

复审至少需要：F1–F4 修复后的固定 HEAD、三条失败复现转绿、现有相关测试无回归、无缓存 check 和 generated-client 检查通过。整分支交付还需关闭阶段台账，不能从工具流切片审批推导出 R5 完成。

## 7. 覆盖限制与证据

本次深入检查了最新批次中的 Permission / grant / responder、Session 映射、MCP connection / registration / runtime、工具插件注册、Schema / Client 生成关系，以及相关生产消费者与测试。CLI/ACP/SDK、资产/任务/记忆工具进行了测试与接线抽查；不声称所有适配器协议、所有故障分支或整个迁移树逐行覆盖。没有统计行覆盖率，也不以通过用例数代替覆盖率。

未运行实机 Electron、完整浏览器 E2E、所有操作系统、真实第三方 CLI/SDK 网络服务或真实用户数据库升级。未在旧 HEAD 重新跑完整失败对照，故不认定所有全量测试失败均为存量。当前本机 Bun 为 1.3.14，仓库 packageManager 声明 1.4.2；本次结论限定于记录的环境，仍需按仓库固定运行时复验。

三个独立探针使用真实生产服务和执行器；只替换无关的 Image normalize，并使用本地 stdio fixture。SSE 探针复用了真实 EventFeed 订阅和 Bus，未启动完整 HTTP/Electron 客户端；生产 HTTP handler 的同一订阅路径经源码确认。MCP 外部标记用于证明 RPC 已发生，不只判断调用返回的错误。

证据目录：[v2-branch-independent-review-2026-10-17](./v2-branch-independent-review-2026-10-17/verification.txt)。其中包含命令结果、自动生成的提交清单、三条复现、使用的本地 MCP fixture、无缓存检查日志和生成客户端差异。报告中的源码行号均以本次固定 HEAD 为准。
