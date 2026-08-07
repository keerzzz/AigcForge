# M1 审批记录：外部 CLI 委派 core 链路修复（2026-08-06，通过）

> 审批对象：执行智能体按 `docs/plan/prompt-external-cli-dispatch.md`（通用前置 + M1）产出的工作区改动。
> 方案依据：`docs/plan/external-cli-dispatch-implementation.md` §3。

## 1. 改动清单

| 文件 | 摘要 |
|---|---|
| `packages/core/test/cli-adapters.test.ts`（新建） | 四适配器 buildArgs / parseResumeHint / parseOutput 纯函数契约（16 用例） |
| `packages/core/test/cli-timeout.test.ts`（新建） | executeWithTimeout：CLI 缺失 / 超时 / 非零退出 / 正常透传（4 用例，mock spawner） |
| `packages/core/test/task-driver-fill.test.ts`（新建） | R1 子会话双消息、R2 title、R3 resume 键一致（argv 含 `--resume`）、R4 step 状态机、R5 无 spawner typed error |
| `packages/core/test/session-task.test.ts`（扩展） | R6 metadata、R7 task_error、R8 缺 cli_target、R9 permission assert 形状、R10 session_task 联动 |
| `packages/core/src/tool/task-driver.ts` | `SessionFacade.create` 加 `title`；`executeCLI` 返回 `{text, sessionID, status}`，移除 as 强转 |
| `packages/core/src/session/task-driver-fill.ts` | 子 Session title + 双消息（EventV2 `Prompted` 投影）；resume 键统一为父 Session ID；`CliUnavailableError` typed error；executeCLI 写 `external-cli` step + `updateStep` |
| `packages/core/src/tool/task.ts` | Output 加 `metadata`；external-cli 分支错误态 / Track B session_task / permission assert `resources:[cli_target]` + metadata |
| `packages/core/src/meta-agent/service.ts` | `writeStep` 序号改表内 `MAX(seq)+1`（消除模块级计数器） |
| `packages/core/src/session.ts` | `CreateInput.title` 支持 |
| `packages/core/src/public/aigcfroge.ts`、`packages/server/src/handlers.ts`、`packages/aigcfroge/src/effect/app-runtime.ts` | 三处组合根显式 provide `EventV2.defaultLayer`（fill 经 EventV2 写子消息，根因一致的同型修复） |
| `docs/plan/meta-agent-v2-production-closure.md` | 修正与现状不符的完成表述 |

## 2. 红→绿与验证证据

- 契约测试 R1–R10 全绿：4 个文件 40 用例通过（`bun test test/{cli-adapters,cli-timeout,task-driver-fill,session-task}.test.ts`）。
- core 全量回归：1539 pass / 0 fail（194 文件，54s）。
- V1 链回归：`packages/aigcfroge` `tool/task.test.ts` 21 pass / 0 fail（V1 未动，确认无回归）。
- `bun --cwd packages/core typecheck`（tsgo）通过。
- `bun run lint`：0 error；审批中发现的 2 个新增 warning（测试文件未使用 import）已修复，剩余 1 个 warning 为 `packages/core/src/session/task.ts:71` 的既有问题（本次未触碰该文件，记入额外发现）。

## 3. 审批中修复的问题（2 项）

1. `packages/core/test/task-driver-fill.test.ts`：移除未使用 import（`AgentV2`、`MetaAgent`）。
2. `packages/core/src/session/task-driver-fill.ts`：移除 execute 尾部残留的 `as unknown as Effect.Effect<...>` 强转（typecheck 证明可安全移除），连带清理随之失效的 `SessionSchema`、`DelegationStatus` import。

修复后复验：typecheck 通过、40 用例全绿、lint 新增 warning 清零。

## 4. 技术判断说明

- **子会话消息经 `SessionEvent.Prompted` 投影写入**：`projector.ts:352` 仅将事件投影为已 promote 的用户消息，不触发子 Session drain——与 V1 直写消息等效且无重复执行风险，方案认可。
- **resume 键策略**：读写统一为父 Session ID，子 Session 经 `session.parent_id` 可溯源；注释已留在代码中。
- **`writeStep` 序号为表级 `MAX(seq)+1`**：非按 `meta_agent_session_id` 分组，但全局单调保证同会话内有序，可接受。
- **EventV2 三处组合根同型修复**：符合根因收敛（共享根因 = fill 新增 EventV2 依赖）。

## 5. 额外发现（不在本次修复范围）

- `packages/core/src/session/task.ts:71` `restrict-template-expressions` warning（`Type: never`）——既有问题，建议后续单独修复。
- `packages/core/src/tool/task-driver.ts:428,485` 两处既有 `as unknown as` 强转（delegate/delegateBackground）——历史遗留，M3 registry 收敛时可顺手评估。

## 6. 结论

**M1 通过验收**。R1–R10 全绿，门禁（No Cheating / 安全 / 整洁）达标，手动验收项（tmux TUI 调度 claude-code 看子会话）建议在 M2 UI 闭环后一并人工核对。下一里程碑：M2（UI 呈现闭环）。
