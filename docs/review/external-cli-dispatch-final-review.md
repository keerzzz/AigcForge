# External CLI Dispatch M1–M5 最终审批报告

> 审查分支：`external-cli-fix`
> 基线：`origin/main`
> 审查日期：2026-08-06
> 审查方式：协议核对、Git 差异审查、五层影响追踪、现场数据库/日志复原、定向测试、全量测试、类型检查、lint、真实 Claude SDK 冒烟

## 1. 审批结论

**通过审批。** 已修复会导致 `@claude-code` 委派返回空结果、错误标记为成功、无法恢复外部会话或 resume 串用的根因，并完成本地验证。当前分支可合并到本地 `main`。

## 2. 五层影响审查

| 层 | 关键路径 | 结论 |
|---|---|---|
| Schema / Tool | `core/src/tool/task.ts`、`config/cli-agent.ts` | `execution_type`、`cli_target`、`task_id`、transport 配置有明确约束；external-cli 输出带 `metadata`。 |
| Domain / Session | `core/src/session/task-driver-fill.ts`、`tool/task-driver.ts` | 子 Session 创建、提示/结果投影、任务状态回写、取消、resume、权限桥闭环。 |
| Transport / Infra | SDK、JSONL、ACP、`external_cli_session` | Claude SDK 持久化和 sessionId 闭环；JSONL resume 参数按各 CLI 实际帮助修正；ACP 生命周期受 Scope 管理。 |
| Application | `aigcfroge` registry / meta prompt / app runtime | CLI 注册表为单一存储；config transport 选择不再被静默吞掉；可用 CLI 动态刷新。 |
| UI / TUI | `session-ui`、`app` permission dock、`tui` task card | external-cli 徽标、状态、摘要、子 Session 链接和权限描述均有消费方与契约测试。 |

## 3. 审查发现与修复

### F-1：空结果被当成成功，且没有可恢复 Claude session（高）

**证据：** 现场故障记录中，子 Session 只有委派提示和空结果；`external_cli_session` 没有可用外部 sessionId。旧 SDK 适配器对空/缺失 `result` 默认返回成功。

**修复：**

- `claude-code-sdk.ts` 显式传 `persistSession: true`。
- 捕获 SDK `system/init` 与 `result` 中的 `session_id`。
- 缺少最终结果、最终文本或持久 sessionId 时返回 `failed`，不再伪造成功文本。
- 使用 `AbortController`、SDK `query.close()` 和 `Effect.scoped`，超时/中断时释放 SDK 查询和子进程资源。
- Codex SDK、ACP 也拒绝无最终文本的假成功。

### F-2：配置 transport 的错误被吞掉（高）

`registerConfigCliAdapters` 对不支持/不可用的 SDK/ACP transport 会抛错，但 composition root 原先 `Effect.catch(() => Effect.void)` 将其静默忽略，导致用户配置与实际传输不一致。

**修复：** 显式解析 built-in transport；不可用配置通过 `Effect.orDie` fail-loud，禁止回退成看似可用但语义错误的 JSONL adapter。

### F-3：resume 可能跨 CLI 串用或复用旧 session（高）

旧查询只按 parent Session 和 `active` 查找，没有限定 `cli_target`，多个 CLI 共用一个父 Session 时可能把 Claude sessionId 传给 Codex，且旧记录永远保持 active。

**修复：**

- resume 查询加入 `cli_target` 并按 `time_updated` 倒序取最新记录。
- 新 sessionId 写入前将同父同 target 的旧 active 记录置为 completed。
- 冲突时更新已有记录，不再 `onConflictDoNothing` 静默丢弃新 sessionId。
- 新增跨 target 隔离测试。

### F-4：JSONL fallback 的 resume argv 不符合各 CLI 接口（高）

修正并覆盖测试：

- Claude：`--output-format json`、resume 时保留 prompt，并解析真实 `result/session_id`。
- Codex：使用 `exec resume [session_id] [prompt]`，识别 `thread.started.thread_id`。
- OpenCode：使用 `--session <id> <prompt>`。
- Gemini：使用 print prompt 形式并保留 resume prompt。

### F-5：external-cli 忽略 `task_id`，重试会创建新的 AigcForge 子 Session（中）

**修复：** external-cli 将 `task_id` 传入 TaskDriver，复用已有子 Session，并校验该 Session 属于当前 parent；新增重试复用测试。

## 4. 现场问题的最终行为

1. AigcForge 创建真实子 Session，并保存委派提示。
2. Claude Agent SDK 以委派目录作为 `cwd` 执行。
3. SDK 会话默认持久化到 Claude 的项目会话存储，并返回外部 UUID。
4. AigcForge 将该 UUID 写入 `external_cli_session`，后续同 parent + 同 CLI 委派使用 `resume`。
5. 子 Session 保存 CLI 最终结果，父 Session task card 获取 `metadata.sessionId`、CLI 名称、状态和摘要。
6. Claude Code 的 session list 按项目目录过滤；委派到 `/home/keer/Documents/web/opencode-dev` 的会话应在该目录对应的 Claude 项目列表中查看，而不是只在 AigcForge 当前目录列表中查找。也可以直接使用返回的外部 sessionId 恢复。

## 5. 验证证据

- `bun typecheck`：Turbo 18 个可类型检查任务全部成功。
- `bun run lint`：0 warnings，0 errors；changed-file incremental lint 通过。
- `packages/core` 全量：1583 pass / 2 skip / 0 fail。
- `packages/core` 外部 CLI 聚焦：70 pass / 0 fail。
- 真实 Claude SDK smoke：1 pass；首次调用与 resume 均成功，返回 sessionId。
- Claude SDK `listSessions({ dir })`：能读取新会话、摘要和首次提示。
- `packages/aigcfroge` registry/meta prompt：11 pass / 0 fail，typecheck 通过。
- `packages/session-ui` task card：11 pass / 0 fail，typecheck 通过。
- `packages/app` permission dock：2 pass / 0 fail。
- `packages/tui` external CLI card/permission：7 pass / 0 fail。
- `git diff --check`：通过。

## 6. 非阻塞遗留项

- 本机未安装 `claude-code-acp` / `codex-acp` bridge，因此 ACP 生产进程桥只完成真实协议内存测试，未完成真实 bridge binary 冒烟；detect 门控会在无 bridge 时回退 SDK。
- Codex 真实 SDK smoke 保持显式 opt-in，未在本次审批中消耗线上配额。
- ACP 的实时 `onProgress` 生产消费仍是后续 UI 议题；当前不影响最终结果、权限、sessionId 或 resume 闭环。

## 7. 最终审批

**批准将 `external-cli-fix` 提交为面向 `main` 的 PR。**
