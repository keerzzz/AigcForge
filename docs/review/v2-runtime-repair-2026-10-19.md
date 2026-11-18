# V2 运行时修复复核（2026-10-19）

四项审查发现已修复，相关回归测试通过。测试还暴露了审批等待取消被 TTL 阻塞的共享根因，本次一并修复。本报告只覆盖这些工作区改动，不批准整个迁移分支上线或合并。

**同日补充复核**：V2 指定 Bun 1.4.2，而此前测试使用本机全局 1.3.14。隔离使用 1.4.2 并对齐子进程 PATH 后，最小断连探针、完整生产路由 Node HTTP 审批测试（2 pass）、Server 相关回归（14 pass）均通过。REPAIR-HTTP-01 已收敛为本机运行版本不一致，详情见 `docs/review/v2-runtime-alignment-2026-10-19.md`。下方原始结果保持原运行时范围。

- 工作区：`/home/keer/workspace/aigcfroge-v2`
- 分支：`v2-dev`
- 基准 HEAD：`8b0661b2a9278373cb020b0998ef0943bb433459`
- 依据：主仓 `CLAUDE.md` 的执行协议、V2 仓库及 Core Tool 的 `AGENTS.md`、指定历史对话中的四项发现和继续修复授权。
- 状态：未提交的工作区改动；没有推送、PR 或合并。
- 提交清单由 `git log --oneline 8b0661b2a9278373cb020b0998ef0943bb433459..HEAD` 生成，输出为空，见 `evidence/v2-runtime-repair-2026-10-19/commit-list.log`。

## 修复与裁决依据

| 发现                                                            | 修复                                                                                                                                                                                                 | 决定契约的代码与验证                                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 生产 SSE 未登记审批应答者，真实连接存在时仍拒绝 `ask`           | 生产 `EventHandler` 获取进程共享 `ApprovalPresence`，在订阅被消费的 Scope 中绑定应答者；能力头沿用 `ProductModePolicy.isCustomCapable`；全局服务节点补齐依赖                                         | `packages/server/src/handlers/event.ts:22`、`packages/server/src/routes.ts:70`。是否能应答由 `packages/core/src/permission/approval-presence.ts:81` 的 Location/模式匹配决定。真实 HTTP 测试覆盖审批、公开 reply API、断连、普通与 Custom-capable 并存           |
| MCP 新连接执行器在叶权限检查前发送 RPC                          | 构建 Location layer 时捕获 `Permission.Service`；执行器以 canonical action 和调用上下文构造 source，先 `permission.assert` 再 `callServer`；只映射 typed errors，保留 decline defect 与 interruption | `packages/core/src/mcp/connection.ts:973`；canonical 身份由 `packages/core/src/tool/mcp-registration.ts:55` 决定。真实工具 snapshot 和 MCP 子进程标记证明：无应答者、拒绝、反馈、取消、旧 snapshot 遇到当前 deny 均不发送 RPC；`once` 后才发送                   |
| MCP 返回 `output` 却未声明 output schema，触发工具运行时 defect | 保留发现的 `outputSchema`，缺省声明 `{}`；结果转换保留 structured content，只有未声明 schema 时解析 JSON 形文本                                                                                      | `packages/core/src/mcp/connection.ts:950`、`:970`、`:332`。缺失声明的失败由 `packages/core/src/tool/runtime.ts:46` 决定；输出编码由同文件 `:110` 决定。真实 snapshot 覆盖文本、JSON、字面量、structured、raw、空、混合媒体及 error 输出                          |
| 生成客户端缺少两个配置字段                                      | 使用客户端官方生成器补齐 `ConfigEntry` 的 `cli_agents`、`subagent_attended_default`，没有手写生成结果                                                                                                | 字段源 `packages/schema/src/config.ts:62`、`:65`；生成结果 `packages/client/src/promise/generated/types.ts:3702`、`:3712`。官方 `check:generated` 与 Client 全量测试通过                                                                                         |
| 共享审批等待在取消后仍等待最长默认 300000ms TTL                 | 将 `restore` 包住整个 `Deferred.await + catchTag + timeoutOrElse`，使 timeout 的等待及竞争分支可中断；清理保留在 `ensuring`                                                                          | `packages/core/src/permission.ts:337`。原先仅恢复 Deferred 等待，外层 timeout 在 uninterruptible mask 内启动。`packages/core/test/permission-ask-bounds.test.ts:201` 用实际 pending 请求及有界 readiness 信号验证立即取消、保留 interruption cause、清空 pending |

复用现有 Permission 叶边界、ApprovalPresence 进程节点、McpRegistration canonical 命名、Tool snapshot、ProductModePolicy、EventFeed、生成器及测试夹具。没有新增注册表、权限回调或会话执行层。

方案选择：将缺口接入现有 owner，保留当前原始 JSON Schema 的输出契约。完整 Schema 属性校验和 Bun HTTP 运行时适配会扩张通用工具及服务器边界，本次未实现；残余范围登记在下方技术债表。

## 已验证

完整命令、cwd、退出码与证据映射见 `evidence/v2-runtime-repair-2026-10-19/verification.json`。测试均从包目录运行。

| 检查                                     | 本轮结果                                                                           | 证据                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 全仓 `TURBO_FORCE=true bun run check`    | exit 0；19 项类型检查成功，0 项缓存；lint 1487 条警告、0 错误；SDK 文档检查 0 问题 | `check-summary.log`；原始全日志位置和 SHA256 见 verification.json |
| Core 相关 12 文件                        | exit 0；192 pass、42 skip、0 fail；862 assertions                                  | `core-final.log`                                                  |
| Server 相关 6 文件                       | exit 0；14 pass、0 fail；88 assertions                                             | `server-final.log`                                                |
| Client 全量最终复跑，无并行构建          | exit 0；224 pass、0 fail；906 assertions                                           | `client-final.log`                                                |
| Client 重连失败文件单独复跑              | exit 0；10 pass、0 fail；86 assertions                                             | `client-reconnect.log`                                            |
| 官方 `check:generated`                   | exit 0；重生成没有新增漂移                                                         | `generated.log`                                                   |
| 10 个修改源文件/测试文件的 oxlint        | exit 0；0 warnings、0 errors                                                       | `changed-lint.log`                                                |
| 修改文件 Prettier 与 `git diff --check`  | exit 0                                                                             | `final-hygiene.log`                                               |
| Node v24.15.0 实际 EventHandler 断连探针 | exit 0；普通和 Custom-capable 连接均正确登记、断开后释放                           | `node-event-handler.log` 及对应探针源码                           |

生成一致性检查使用临时 Git index：先从 HEAD 建索引，再仅暂存当前生成目录，运行官方 `check:generated`。这使检查比较“本次有意生成的结果”与“再次生成的结果”。真实 Git index 保持原状，临时 index 已删除。

Node 探针运行真实 EventHandler、EventFeed、ApprovalPresence、NodeHttpServer，使用真实 TCP。为了避开其他 API 的运行时依赖，构建仅事件组的协议，不覆盖全路由图或认证；全路由图、认证及公共客户端链由 Bun Web HTTP 回归测试覆盖。

## 失败与验证边界

Client 首轮全量在全仓 check 同时运行时：exit 1，223 pass、1 fail、895 assertions。失败为 `Promise reconnect preserves a protocol-incompatible owner with no version requirement`，错误为 `Timed out waiting for the background service to start`，定位 `packages/client/src/promise/service.ts:53`。随后单文件及无并行构建的全量复跑通过。没有修改服务重连代码，也没有证明首轮失败的根因；不能把首轮记录为绿色或直接认定为基线失败。原始输出保存在 `client-first.log`。

`lint-changed.ts` 本仓只筛选 GUI 文件，本次筛选为空；不把它作为 Core/Server lint 覆盖证据。全仓 lint 的 1487 条警告不是零警告，本次没有逐项定性。Core 的 42 项 skip 不算通过。

本次没有重跑 Core、Server、App 全量，也没有对旧 HEAD 做全量对照。历史对话中的全量失败和其他迁移范围不在本报告审批范围内。

## 残余范围与技术债登记

本表作为本 slice 的 debt ledger。每项均给出责任模块和解除条件。

| ID               | 状态与影响                                                                                                                                                                                                         | Owner                      | 解除条件                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| REPAIR-HTTP-01   | 同日补充复核已证明：本机 1.3.14 未发出断连 close；V2 指定 1.4.2 的最小探针、实际 EventHandler、完整 createRoutes + NodeHttpServer 均在断连后释放 responder。运行时缺陷未在指定版本复现；本机日常 PATH 仍未永久对齐 | 开发环境维护者             | V2 开发终端及脚本子进程固定 1.4.2。对比证据与新验证范围见 `docs/review/v2-runtime-alignment-2026-10-19.md`；无须为旧版本现象加入生产 HTTP 补丁 |
| REPAIR-SCHEMA-01 | 原始 JSON Schema 输出目前只验证 JSON 兼容性，不验证各属性类型；这是 `ToolRuntime.encodeOutput` 的现有分支语义。本次声明 schema 并消除缺声明 defect，没有扩张该通用边界                                             | Core Tool maintainers      | 明确所有 raw JSON Schema 输出兼容性策略，再在 `packages/core/src/tool/runtime.ts:110` 统一实现并验证各 producer                                |
| REPAIR-VERIFY-01 | Core/Server/App 全量及原 HEAD 全量对照未在本修复执行；不能批准整体迁移分支                                                                                                                                         | Migration / QA maintainers | 在目标 CI 环境运行全量，失败逐项归因或与基准对照；相关门禁完成后再作整体审批                                                                   |
| R0.1（既有）     | `.github` 仍含引用已裁剪包的工作流，已登记在迁移计划 §9.1；本次未修改                                                                                                                                              | Release / CI maintainers   | 按 ADR-26 发布体系改造闭环；源登记 `docs/research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md:242`                       |

修复范围可进入代码评审。上线、合并和整个迁移分支的审批需要另行完成上述对应门禁。
