# M4 审批记录：transport 抽象 + 官方 SDK 适配器（2026-08-06，通过，含审批方修复）

> 审批对象：执行智能体按 `docs/plan/prompt-external-cli-dispatch.md`（通用前置 + M1–M3 补丁 + M4）产出的 3 个提交（`caa1e6b26` Phase A、`53f4d91af` SDK transports、`45e2965f4` lock 解析）。
> 方案依据：`docs/plan/external-cli-dispatch-implementation.md` §6。前置：M1–M3 已通过。
> 分支 `external-cli-core-fix`（M1–M3 已随 `1cae9323c` 提交，本轮起执行方开始提交，工作区干净）。

## 1. 改动清单（执行方交付）

| 文件 | 摘要 |
|---|---|
| `packages/core/src/tool/cli-adapter.ts` | `CliAdapter` 扩 `transport?: "jsonl"\|"sdk"\|"acp"`（默认 jsonl，向后兼容）+ 可选 `execute(input)` SDK/ACP 路径 + `SdkPermissionRequest/Handler` 类型 |
| `packages/core/src/config/cli-agent.ts` | config schema 增 `transport` 字段（jsonl/sdk/acp） |
| `packages/core/src/tool/claude-code-sdk.ts`（新建） | `makeClaudeCodeSdkAdapter(sdk)`：注入式 SDK seam；`query()` 流式 → DelegationResult；canUseTool → allow/deny 桥；resumeId → `options.resume` |
| `packages/core/src/tool/codex-sdk.ts`（新建） | `makeCodexSdkAdapter(sdk)`：`startThread`/`resumeThread` → `run()` → finalResponse；`approvalPolicy: "never"` auto-deny |
| `packages/core/src/session/task-driver-fill.ts` | 注册两个 SDK 适配器（同名覆盖 jsonl 成默认）；`transport==="sdk" && execute` 走 SDK 路径，否则走 `executeWithTimeout` |
| `packages/aigcfroge/src/agent/meta/adapters/registry.ts` | BUILT_INS 增加两个 SDK 适配器（同一 core cell，无第二 registry） |
| `packages/core/package.json` + `bun.lock` | `@anthropic-ai/claude-agent-sdk@0.3.220`、`@openai/codex-sdk@0.146.0` |
| `packages/core/test/cli-sdk-adapters.test.ts`（新建） | 6 用例：流式→DelegationResult、is_error→failed、resumeId 传递、canUseTool 桥、codex run/resumeThread |
| `packages/core/test/config/cli-agent.test.ts` | +transport schema 用例 |

## 2. 审批方修复（4 项，均已验证）

1. **resume 断链（P0，验收标准未达成）**：持久化分支以 `adapter.parseResumeHint` 为前提，SDK 适配器没有该函数 → `external_cli_session` 行永不写入 → 同父 Session 的下次委派永远全新开始，「resume 由 SDK 语义保证」不成立。修复：`DelegationResult` 增 `sessionId`；claude 从 init/result 消息捕获 `session_id`；codex 返回 `thread.id`；task-driver-fill 持久化改用 `result.sessionId ?? parseResumeHint?.(...)`。测试：task-driver-fill R6（SDK 路径端到端：持久化 + 二次委派 execute 收到 resumeId）+ 两个适配器契约用例。
2. **SDK 路径无超时（P1）**：`executeWithTimeout` 只包 jsonl 路径，SDK `execute` 直调——挂死的 query 会永久阻塞委派 fiber。修复：`Effect.timeoutOrElse`（`adapter.timeout ?? 300_000`）返回 failed + "Timed out"（与 M2 UI timeout chip 文案对齐）。测试：R7（live clock，TestClock 不会自动触发超时）。
3. **codex `run()` 参数类型错误（P0，被 mock 掩盖）**：seam 声明 `run({type:"text",text})`，但真实 SDK `normalizeInput` 对非字符串参数执行 `for (const item of input)`——裸对象不可迭代，生产必抛 TypeError。审批方对照 `node_modules/@openai/codex-sdk/dist/index.js` 核实后修复：`run(prompt)` 传字符串；契约测试加回归断言（run 收到的 input === prompt 字符串）。
4. **typecheck union 收窄**：timeout orElse 字面量标注 `Effect.succeed<DelegationResult>`，修复 `result.sessionId/rawStdout` 属性访问报错。

## 3. 风险分析（执行方申报三项，审批结论）

1. **PermissionV2 权限桥未接（SDK auto-deny）——接受为技术债，M5 验收前必须落地**。理由：(a) 非回归——jsonl 路径 `claude -p` 同样无 `--dangerously-skip-permissions`，headless 下本来就 auto-deny，行为等价；(b) 经济性——M5 的 ACP 权限桥（`session/request_permission → PermissionV2`）与 SDK `canUseTool` 需要同一次 PermissionV2 组合根接线（M1 组合根陷阱：public/server/app-runtime 三处同型修复），合并到 M5 一次做完避免两次 wiring。已写入 M5 补丁。
2. **config `cli_agents.transport` 选择未完全接线——接受并记录边界**。`cli_agents` 条目语义是「完整自定义」（M3 既定 config > built-in）：同名覆盖 SDK 默认会回到 jsonl spawn 是显式用户行为。但 `fromConfig` 遇 `transport:"sdk"` 静默产出无 `execute` 的适配器（实际跑 jsonl）是误导。M5 补丁要求：fromConfig 对 `transport:"sdk"` 要么实现 SDK 工厂选择，要么显式拒绝，禁止静默降级。
3. **真实 SDK 端到端冒烟未跑——部分已由审批方覆盖，残余列入手动验收**。审批方完成了静态 seam 核对（对照两 SDK 的 .d.ts/.js 逐调用点验证，codex run() bug 即此法抓获）；claude 侧 `query`/`Options.canUseTool`（第三参 signal 可忽略、deny 必带 message 已满足）/`resume`/`session_id` 均吻合。残余：真实 `query()`/`Codex.run()` 的 it.live 冒烟（本机已装 claude 2.1.220 / codex 0.146.0），列入 M5 前手动验收清单。

## 4. 验证证据（审批方独立复跑）

- 聚焦：`cli-sdk-adapters` + `task-driver-fill` 15 pass / 0 fail（含新增 R6/R7 + sessionId 契约用例）。
- aigcfroge 聚焦：adapters + meta-prompt-filler 14 pass / 0 fail。
- core 全量：1566 pass / 0 fail（197 文件，两轮均绿）。
- typecheck：core + aigcfroge（`tsgo --noEmit`）通过。
- `bun run lint`：0 error，warning 仅剩 M1 已登记的既有项 `core/src/session/task.ts:71`（非本次引入）。

## 5. 额外发现（不在本次修复范围）

- **mock seam 测试的根本局限**：`as unknown as` cast 会掩盖真实 SDK 形状失配（codex run() 即实例）。经验已写入 M5 补丁：SDK/协议边界交付前必须对照 node_modules 的 .d.ts 与运行时实现逐调用点核对 seam。
- codex `Thread.id` 文档注明 "populated after the first turn starts"——adapter 在 `run()` 完成后读取，时序安全。
- claude-agent-sdk lock 0.3.220 vs npm 最新 0.3.223，次版本落后可接受，M5 时可顺手升级。
- SDK 超时只放弃等待（fiber 中断），SDK 自身子进程可能短暂残留；彻底 kill 需要 SDK 的 close()/AbortSignal 接线，随 M5 PermissionV2 wiring 一并评估。

## 6. 审批结论

**M4 通过验收（含审批方 4 项修复）。** transport 抽象向后兼容（jsonl 默认、config 可显式回退）、单存储不变、SDK 默认切换完成；两个 P0（resume 断链、codex run 参数）与一个 P1（无超时）由审批方补齐并测试覆盖。验收标准三条中「不经自研 JSONL 解析」达成，「resume 由 SDK 语义保证」修复后达成，「权限问询走 PermissionV2」降级为 M5 强制项。

## 7. 下一步

M5（ACP client 侧终态）开工。M5 验收前置：PermissionV2 组合根接线（SDK canUseTool + ACP request_permission 共用）、真实 SDK it.live 冒烟、fromConfig transport:"sdk" 显式化。
