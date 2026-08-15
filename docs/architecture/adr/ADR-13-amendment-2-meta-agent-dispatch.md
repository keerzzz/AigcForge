# ADR-13 Amendment 2: Meta-Agent Dispatch & Chat Mode Permission Envelopes

> **Status:** Approved
> **Date:** 2026-08-15
> **Amends:** [ADR-13: Chat Work Mode Boundary](./ADR-13-chat-work-mode-boundary.md)
> **Context:** 2026-08-11 元智能体调度架构决议（《元智能体调度架构讨论总结》§3.4 & §3.8）与 2026-08-14 Chat 模式安全审计

## Amendment

### §1a — Meta-Agent as Universal Default Primary Agent

Coding, Chat, and Work modes default to `meta` as their primary session agent; **Assistant mode defaults to `assistant-orchestrator`** (`resolvePrimaryAgent` in `packages/core/src/product-mode-agent-policy.ts` — 个人事项的 fail-closed 执行者，不做宽权限继承). `meta` acts as the unified conversational entry and orchestrator that dispatches complex tasks to specialized subagents or mode-bound orchestrators via the `task` tool:

- In **Coding mode**: `meta` can delegate execution to `build`, `explore`, `general`, `plan`, or user-defined agents.
- In **Chat mode**: `meta` creates and manages assets. Mode-specific orchestrator (`chat-orchestrator`) remains available as a task delegation target or explicit choice.
- In **Work mode**: `meta` drafts documents from presets. `work-orchestrator` remains available as a task delegation target or explicit choice.
- In **Assistant mode**: `meta` handles personal context, delegating to `assistant-orchestrator`.

### §1b — Fail-Closed Permission Invariant in Chat Mode

To preserve ADR-13 §边界规则 1 ("Chat 创建，Work/Coding 执行：Chat 不承担通用任务执行"):

1. **Deny Direct Writes**: In Chat mode, `meta` MUST NOT execute direct destructive file mutations (`edit`, `write`), direct shell commands (`bash`), or bypass asset proposal pipelines (`create_agent`, `configure_mcp`).
2. **Propose-First Invariant**: All asset creation in Chat mode MUST go through `propose_*_asset` tools producing `Candidate` objects for explicit user review and UI confirmation.
3. **No Delegated Write Channel**: Chat mode MUST NOT be able to reach a write-capable engine indirectly through the `task` tool.

#### §1b.3 — Enforcement mechanism (as implemented)

The guarantee in §1b.3 is **not** achieved by subagents "inheriting" the parent's permission envelope — no such inheritance exists in the code. It is achieved by two distinct checks on two distinct delegation paths:

| 委派路径 | 拦截点 | 机制 |
|---|---|---|
| `execution_type: "subagent"`（默认） | `SessionV2.create` → `ProductModeAgentPolicy.enforcePrimary` | 子会话继承父会话的 `mode`（`packages/core/src/session.ts`：`parent?.mode ?? input.mode ?? Default`）；`checkPrimaryAgent("chat", agent)` 只接受 `meta` 与 `chat-orchestrator`，`build` / `explore` / `general` / `plan` 全部被拒 |
| `execution_type: "external-cli"` | `TaskDriver.executeCLI` → `ProductModeAgentPolicy.checkCliDelegationAllowed` | 该路径**不创建子会话**，因此永远到不了 `enforcePrimary`；必须由独立的模式检查拦截，否则外部 CLI 会以自身权限写工作区 |

实现要点与已知约束：

- 子代理路径由 `task` 工具在委派前先行拦截（`packages/core/src/tool/task.ts`）：`TaskDriver.sessionMode` 查父会话模式，`checkPrimaryAgent` 校验 `subagent_type`，不合规直接返回 typed `ToolFailure`。`enforcePrimary` 的 `Effect.die` 仍保留为 Session 创建层的最后防线（子代理路径若绕过 task 预检直接进入 `SessionV2.create`，仍会被拦截）。
- 外部 CLI 路径在 chat 模式返回 `CommandDeniedError`（typed），错误信息指向 `propose_*_asset`。
- **`checkCliDelegationAllowed` 只拦 chat 是有意设计，非遗漏**：ADR-13 §边界规则 1 的"Chat 只创建不执行"只约束 chat——work/coding 本就是执行模式（`work-preset` 直接落盘、build 直接写）。`external-cli` 是 meta 提示词触发的显式用户委派动作，在 work/assistant 放行是给"执行型模式"保留 CLI 委派能力。chat 是唯一纯 propose 边界，因此 gate 只在 chat 收紧。若未来某模式需要同样的 propose-only 语义，按同一模式补充即可。
- `meta` 的权限条目仍是 `{ action: "task", resource: "*", effect: "allow" }`。写边界不由这条权限承载，而由上表两个模式检查承载；因此**新增任何不经过 Session 创建的委派执行路径（如新的 `execution_type`）都必须同步加一条模式检查**，否则会重新打开这个通道。

### Affected Sections

This amendment amends ADR-13 §边界规则 1 by clarifying the permission enforcement mechanism under the meta-agent unified dispatch architecture.

### Provenance

§1b.3 的机制描述在初版中声称"subagents inherit mode-bound read/propose constraints"，与代码不符（不存在约束继承），且当时 `external-cli` 路径确实是一个未拦截的写通道。两处均在 2026-08-15 审批中被指出并修正：机制描述改为上表的实测行为，`checkCliDelegationAllowed` 同期加入 `product-mode-agent-policy.ts`。详见 [审计报告](../../audit/AigcForge_CHAT_MODE_AUDIT_2026-08-14.md)。
