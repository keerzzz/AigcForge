# ADR-13 Amendment 2: Meta-Agent Dispatch & Chat Mode Permission Envelopes

> **Status:** Approved — §1c 会话级权限档位例外已实施（2026-08-16，分支 `session-permission-tier`，实施计划 [`docs/plan/mode-scoped-permission-overlay.md`](../../plan/mode-scoped-permission-overlay.md)）
> **Date:** 2026-08-15
> **Amends:** [ADR-13: Chat Work Mode Boundary](./ADR-13-chat-work-mode-boundary.md)
> **Context:** 2026-08-11 元智能体调度架构决议（《元智能体调度架构讨论总结》§3.4 & §3.8）、2026-08-14 Chat 模式安全审计，以及 2026-08-15 Chat Session `full` 权限裁决

> **生命周期边界（2026-08-31）**：本 ADR 只决定 Meta-Agent 默认路由与 Chat/Work 权限信封，不定义持久多参与者委派的聚合、turn、review barrier 或 close/archive。上述生命周期由 [ADR-22](ADR-22-meta-agent-persistent-delegation.md) 与[唯一实施计划](../../plan/meta-agent-persistent-delegation-closed-loop.md)定义。

> **§1c 实施状态（2026-08-16）**：meta V1/V2 基线已收敛 fail-closed（`PermissionEffective` 唯一 owner）；`chat/work/assistant × meta` 支持持久档位 `propose`（默认）/`full`，**两档下已物化的写/命令工具均逐次 `ask`（propose 档为 2026-08-16 人类裁决修订，原提案 deny；两档差异在未知 action 基线 deny vs ask）**；当前有人值守 Chat 根 Session 主动开启 `meta + full` 后可直接使用物化的写/命令工具，危险 action（bash/edit/write/apply_patch 及未知）逐次 `ask`，saved approval 与 always 预授权不得跳过；unattended 根会话 ask 全降 deny、不可启用 break-glass；Session 级 break-glass（60s 租约，不持久化）仅根 Session 可用，break-glass 放开一般动作（含基线敏感文件 ask）但 Chat 危险 action 仍逐次确认；external CLI 委派 Chat 全档拒绝、Work/Assistant 仅 full 放行、未知 mode deny。

## Amendment

### §1a — Meta-Agent as Universal Default Primary Agent

Coding, Chat, and Work modes default to `meta` as their primary session agent; **Assistant mode defaults to `assistant-orchestrator`** (`resolvePrimaryAgent` in `packages/core/src/product-mode-agent-policy.ts` — 个人事项的 fail-closed 执行者，不做宽权限继承). `meta` acts as the unified conversational entry and orchestrator that dispatches complex tasks to specialized subagents or mode-bound orchestrators via the `task` tool:

- In **Coding mode**: `meta` can delegate execution to `build`, `explore`, `general`, `plan`, or user-defined agents.
- In **Chat mode**: `meta` creates and manages assets. Mode-specific orchestrator (`chat-orchestrator`) remains available as a task delegation target or explicit choice.
- In **Work mode**: `meta` drafts documents from presets. `work-orchestrator` remains available as a task delegation target or explicit choice.
- In **Assistant mode**: `meta` handles personal context, delegating to `assistant-orchestrator`.

### §1b — Default Fail-Closed Permission Invariant in Chat Mode

To preserve ADR-13 §边界规则 1 ("Chat 创建，Work/Coding 执行：Chat 不承担通用任务执行"), Chat defaults to the `propose` permission tier:

1. **Deny Direct Writes by Default**: In Chat `propose`, `meta` MUST NOT execute direct destructive file mutations (`edit`, `write`, `apply_patch`), direct shell commands (`bash`), or bypass asset proposal pipelines (`create_agent`, `configure_mcp`).
2. **Propose-First Invariant**: All asset creation in Chat mode MUST go through `propose_*_asset` tools producing `Candidate` objects for explicit user review and UI confirmation.
3. **No Delegated Write Channel**: Chat mode MUST NOT be able to reach a write-capable engine indirectly through the `task` tool.

#### §1b.3 — Enforcement baseline and approved tier extension

The current Chat delegation guarantee is **not** achieved by subagents "inheriting" the parent's permission envelope — no such inheritance exists in the code. The implemented baseline uses two distinct checks on two distinct delegation paths:

| 委派路径                             | 拦截点                                                                       | 机制                                                                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution_type: "subagent"`（默认） | `SessionV2.create` → `ProductModeAgentPolicy.enforcePrimary`                 | 子会话继承父会话的 `mode`（`packages/core/src/session.ts`：`parent?.mode ?? input.mode ?? Default`）；`checkPrimaryAgent("chat", agent)` 只接受 `meta` 与 `chat-orchestrator`，`build` / `explore` / `general` / `plan` 全部被拒 |
| `execution_type: "external-cli"`     | `TaskDriver.executeCLI` → `ProductModeAgentPolicy.checkCliDelegationAllowed` | 该路径**不创建子会话**，因此永远到不了 `enforcePrimary`；必须由独立的模式检查拦截，否则外部 CLI 会以自身权限写工作区                                                                                                             |

实现要点与已知约束：

- 子代理路径由 `task` 工具在委派前先行拦截（`packages/core/src/tool/task.ts`）：`TaskDriver.sessionMode` 查父会话模式，`checkPrimaryAgent` 校验 `subagent_type`，不合规直接返回 typed `ToolFailure`。`enforcePrimary` 的 `Effect.die` 仍保留为 Session 创建层的最后防线（子代理路径若绕过 task 预检直接进入 `SessionV2.create`，仍会被拦截）。
- 外部 CLI 路径在 chat 模式返回 `CommandDeniedError`（typed），错误信息指向 `propose_*_asset`。
- **已批准、尚待实施的 `checkCliDelegationAllowed` 档位语义**：Chat 在 `propose`/`full` 均拒绝；Work/Assistant 在 `propose` 拒绝、仅 `full` 放行；Coding 保持放行且忽略档位。`external-cli` 不创建子 Session，因此实施时必须在该执行路径独立读取有效权限档位，不能依赖 `enforcePrimary`。
- `meta` 的权限条目仍是 `{ action: "task", resource: "*", effect: "allow" }`。写边界不由这条权限承载，而由上表两个模式检查承载；因此**新增任何不经过 Session 创建的委派执行路径（如新的 `execution_type`）都必须同步加一条模式检查**，否则会重新打开这个通道。

### §1c — User-Activated Session `full` Exception

The user may explicitly select `meta + full` for the current attended Chat root Session. This is a narrow exception to §1b.1, not a change to Chat's default tier or asset ownership:

1. **Explicit and Session-Scoped**: `full` is never inferred from mode, Agent, prompt content, saved approval, or configuration. The user must activate it for the current root Session.
2. **Ask, Not Silent Allow**: Direct write and command actions, including `bash`, `edit`, `write`, `apply_patch`, and future unknown dangerous actions, are materialized as `ask`. Every dangerous operation uses the existing Permission Dock; saved approvals cannot silently pre-authorize these Chat `full` actions.
3. **Attended Only**: An unattended Session converts every unresolved `ask` to `deny`. Neither saved approvals nor a temporary master override may bypass this rule.
4. **No Delegation Bypass**: Chat continues to reject `task → build` and `external-cli` in both `propose` and `full`.
5. **Managed Assets Remain Typed**: Registered asset creation, update, apply, and delete continue through `propose_*`, explicit user confirmation, and the existing validated transaction boundary. `full` MUST NOT use generic file tools to bypass schema validation, path containment, CAS, rollback, registry reload, or readback. This requirement describes transaction behavior; it does not claim every asset kind already has a dedicated Core Effect service.
6. **Single Effective Permission Owner**: V1/V2 tool materialization and execution authorization must consume the same effective rules derived from mode, Agent, tier, attended state, temporary master override, and saved approvals.

Relaxing any item above requires another ADR amendment and security review.

### Affected Sections

This amendment amends ADR-13 §边界规则 1 by clarifying the permission enforcement mechanism under the meta-agent unified dispatch architecture and approving an explicit, attended, Session-scoped `meta + full` exception.

### Provenance

§1b.3 的机制描述在初版中声称"subagents inherit mode-bound read/propose constraints"，与代码不符（不存在约束继承），且当时 `external-cli` 路径确实是一个未拦截的写通道。两处均在 2026-08-15 审批中被指出并修正：机制描述改为上表的实测行为，`checkCliDelegationAllowed` 同期加入 `product-mode-agent-policy.ts`。同日，人类批准 §1c 的当前有人值守根 Session `meta + full` 例外；该例外不放开委派通道，也不改变受管资产事务边界。详见 [审计报告](../../audit/AigcForge_CHAT_MODE_AUDIT_2026-08-14.md)。
