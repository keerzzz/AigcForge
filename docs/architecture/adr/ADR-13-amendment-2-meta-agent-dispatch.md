# ADR-13 Amendment 2: Meta-Agent Dispatch & Chat Mode Permission Envelopes

> **Status:** Approved
> **Date:** 2026-08-15
> **Amends:** [ADR-13: Chat Work Mode Boundary](./ADR-13-chat-work-mode-boundary.md)
> **Context:** 2026-08-11 元智能体调度架构决议（《元智能体调度架构讨论总结》§3.4 & §3.8）与 2026-08-14 Chat 模式安全审计

## Amendment

### §1a — Meta-Agent as Universal Default Primary Agent

All Product Modes (Coding, Chat, Work, Assistant) default to `meta` as their primary session agent. `meta` acts as the unified conversational entry and orchestrator that dispatches complex tasks to specialized subagents or mode-bound orchestrators via the `task` tool:

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

- 子代理路径的拒绝目前表现为 **defect**（`enforcePrimary` 走 `Effect.die`，`TaskDriver.createChild` 又套了 `Effect.orDie`），不是 typed tool failure。模型按 `PROMPT_META` 的 "every FILE write must go through task → build delegation" 指引在 chat 模式尝试委派 `build` 时，会得到一个崩溃而不是"chat 模式不允许"的可读错误。**这是已知缺陷，不是设计意图**，修复方向是让 task 工具在委派前先查模式并返回 `ToolFailure`。
- 外部 CLI 路径在 chat 模式返回 `CommandDeniedError`（typed），错误信息指向 `propose_*_asset`。
- `meta` 的权限条目仍是 `{ action: "task", resource: "*", effect: "allow" }`。写边界不由这条权限承载，而由上表两个模式检查承载；因此**新增任何不经过 Session 创建的委派执行路径（如新的 `execution_type`）都必须同步加一条模式检查**，否则会重新打开这个通道。

### Affected Sections

This amendment amends ADR-13 §边界规则 1 by clarifying the permission enforcement mechanism under the meta-agent unified dispatch architecture.

### Provenance

§1b.3 的机制描述在初版中声称"subagents inherit mode-bound read/propose constraints"，与代码不符（不存在约束继承），且当时 `external-cli` 路径确实是一个未拦截的写通道。两处均在 2026-08-15 审批中被指出并修正：机制描述改为上表的实测行为，`checkCliDelegationAllowed` 同期加入 `product-mode-agent-policy.ts`。详见 [审计报告](../../audit/AigcForge_CHAT_MODE_AUDIT_2026-08-14.md)。
