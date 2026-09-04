import { Schema } from "effect"
import { Wildcard } from "./wildcard"

export const Handoff = Schema.Struct({
  label: Schema.String,
  agent: Schema.String,
  prompt: Schema.String,
  send: Schema.Boolean.pipe(Schema.optional),
  model: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Handoff" })
export type Handoff = typeof Handoff.Type

/**
 * Handoff send policy (D13, S3).
 *
 * Lives in `@aigcfroge/schema` because both clients need it and it is the only
 * workspace package the app may import without risking the `process is not
 * defined` blank screen (`packages/app/src/utils/browser-boundary.test.ts`).
 * A second copy in `packages/tui` was the alternative and is not allowed:
 * a permission decision with two implementations has two behaviours.
 *
 * The decision is a projection of `PermissionEffective.effectiveV2`, which cannot
 * be imported here (its transitive graph reaches `core/database`). It keeps the
 * branch that CREATES cross-agent differences — the meta x full-tier elevation —
 * and treats the client-absent inputs (`masterPermissionEnabled`, saved
 * approvals) as absent. Consequences, stated precisely:
 *
 * - on the `allow` axis this only narrows the CURRENT side, so it over-reports
 *   escalation (blocks a handoff that `effectiveV2` would have permitted) and
 *   never under-reports;
 * - a target that turns a `deny` into an `ask` is NOT reported as escalation,
 *   so it under-reports on that axis. That is deliberate: the tool-level ask
 *   still gates the action when it runs, so the user is never silently granted
 *   anything.
 *
 * `effectiveV2` remains the authoritative enforcer server-side.
 */
export type HandoffSessionContext = {
  readonly mode?: "chat" | "coding" | "work" | "assistant" | "custom"
  readonly tier?: "propose" | "full"
  readonly attended?: boolean
}

/** The V1 agent wire shape carried by `Agent.permission` in the SDK. */
export type AgentPermissionRule = {
  readonly permission: string
  readonly pattern: string
  readonly action: "allow" | "ask" | "deny"
}
export type AgentPermissionRuleset = ReadonlyArray<AgentPermissionRule>

type Rule = { readonly action: string; readonly resource: string; readonly effect: "allow" | "ask" | "deny" }

const DANGEROUS_ACTIONS = ["bash", "edit", "write", "apply_patch"] as const

const toRule = (rule: AgentPermissionRule): Rule => ({
  action: rule.permission,
  resource: rule.pattern,
  effect: rule.action,
})

/** Last match wins, mirroring `PermissionV2`'s ruleset evaluation. */
const evaluate = (rules: ReadonlyArray<Rule>, action: string, resource: string): "allow" | "ask" | "deny" => {
  let effect: "allow" | "ask" | "deny" = "ask"
  for (const rule of rules) {
    if (Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource)) effect = rule.effect
  }
  return effect
}

/**
 * The meta x full-tier elevation branch (chat/work/assistant) replays allows and
 * adds a wildcard ask — the only branch that makes an agent's effective rules
 * differ from its raw ruleset in a way a switch comparison can see.
 */
function projectedRules(rules: AgentPermissionRuleset, session: HandoffSessionContext, agent: string): Rule[] {
  const base = rules.map(toRule)
  const elevated =
    (session.mode === "chat" || session.mode === "work" || session.mode === "assistant") &&
    agent === "meta" &&
    session.tier === "full"
  if (!elevated) return base
  return [
    ...base,
    { action: "*", resource: "*", effect: "ask" },
    ...base.filter((rule) => rule.effect !== "deny"),
    ...DANGEROUS_ACTIONS.map((action) => ({ action, resource: "*", effect: "ask" as const })),
  ]
}

export function handoffRequiresApproval(
  session: HandoffSessionContext,
  currentAgent: string | undefined,
  targetAgent: string,
  currentRules: AgentPermissionRuleset,
  targetRules: AgentPermissionRuleset,
): boolean {
  const current = projectedRules(currentRules, session, currentAgent ?? "")
  const target = projectedRules(targetRules, session, targetAgent)

  const escalates = target.some(
    (rule) => rule.effect === "allow" && evaluate(current, rule.action, rule.resource) !== "allow",
  )
  // D13 rule 5: a target whose effective permissions include bash from a
  // propose-tier session jumps from propose-only to arbitrary command
  // execution — the same risk surface as the permission override dialog.
  const bashInPropose = session.tier === "propose" && evaluate(target, "bash", "*") === "allow"
  return escalates || bashInPropose
}

/**
 * What a handoff click is allowed to do.
 *
 * `switchAgent` is reachable only after either a non-escalating plan or an
 * affirmative `confirm`, so an escalating handoff cannot mutate the session: the
 * first implementation awaited `switchAgent` before computing the decision,
 * which meant the gate withheld the prompt while the agent — the thing that
 * actually carries the permissions — had already been switched durably, with no
 * way back.
 *
 * An escalating handoff is never silently prefilled either. Prefilling without
 * switching would leave the handoff text in the composer aimed at the OLD agent,
 * so sending it would quietly answer with the wrong agent. So it asks first and
 * then carries out the original intent (`then`) — `once` semantics. Remembering
 * the answer (`always`) is a persisted per-handoff grant: the client records
 * `handoffAuthorizationKey` only after an affirmative confirmation and feeds it
 * back as `authorized`; an exact handoff-configuration hit skips confirmation on
 * the next identical handoff. The key is Location-qualified so one project's
 * grants never leak into another.
 */
export type HandoffPlan =
  | { readonly action: "switch-and-send" }
  | { readonly action: "switch-and-prefill" }
  | {
      readonly action: "confirm"
      readonly reason: "escalation"
      readonly then: "switch-and-send" | "switch-and-prefill"
    }

/**
 * Identity of a remembered handoff grant. Location, session context, source and
 * target rules, agents, label, and prompt together pin the grant to one exact
 * authorization context. JSON encoding avoids delimiter collisions and
 * intentionally makes old, less-specific grants fail closed. The send/prefill
 * choice is execution intent, not a permission change, so one approval covers
 * both paths.
 */
export const handoffAuthorizationKey = (input: {
  readonly location: string
  readonly session: HandoffSessionContext
  readonly sourceAgent: string | undefined
  readonly label: string
  readonly targetAgent: string
  readonly prompt: string
  readonly currentRules: AgentPermissionRuleset
  readonly targetRules: AgentPermissionRuleset
}) =>
  JSON.stringify([
    input.location,
    input.session.mode ?? "",
    input.session.tier ?? "",
    input.session.attended ?? false,
    input.sourceAgent ?? "",
    input.label,
    input.targetAgent,
    input.prompt,
    input.currentRules,
    input.targetRules,
  ])

/**
 * Decide before touching the session. Every input must be read from the
 * PRE-switch state: `currentAgent` sourced from a live store after an awaited
 * switch compares the target against itself and reports no escalation.
 */
export function planHandoff(input: {
  readonly session: HandoffSessionContext
  readonly currentAgent: string | undefined
  readonly targetAgent: string
  readonly currentRules: AgentPermissionRuleset
  readonly targetRules: AgentPermissionRuleset
  readonly send?: boolean
  /** Location identity (workspace directory) of the current handoff. */
  readonly location?: string
  /** The handoff's stable label. */
  readonly label?: string
  /** The exact configured handoff prompt, used to invalidate stale remembered grants. */
  readonly prompt?: string
  /**
   * Handoff grants recorded after previous explicit confirmations, keyed by
   * `handoffAuthorizationKey`. A hit for the current exact handoff configuration
   * means the user already approved this handoff, so the escalation gate
   * is skipped the same way a fresh confirmation would be. The decision stays
   * here; clients only supply the persisted facts.
   */
  readonly authorized?: ReadonlySet<string>
}): HandoffPlan {
  const intent = input.send === true ? "switch-and-send" : "switch-and-prefill"
  const remembered =
    input.location !== undefined &&
    input.label !== undefined &&
    input.prompt !== undefined &&
    input.authorized?.has(
      handoffAuthorizationKey({
        location: input.location,
        session: input.session,
        sourceAgent: input.currentAgent,
        label: input.label,
        targetAgent: input.targetAgent,
        prompt: input.prompt,
        currentRules: input.currentRules,
        targetRules: input.targetRules,
      }),
    ) === true
  if (
    !remembered &&
    handoffRequiresApproval(input.session, input.currentAgent, input.targetAgent, input.currentRules, input.targetRules)
  ) {
    return { action: "confirm", reason: "escalation", then: intent }
  }
  return { action: intent }
}

export interface HandoffOps {
  /**
   * Switch and send as ONE request. Two calls — switch, then send — leave the
   * session switched with nothing sent when the second one fails, which is the
   * partial-failure shape the S2 kernel exists to remove. The canonical prompt
   * endpoint carries `agent`/`model` precisely so this can be one call.
   */
  readonly submit: () => Promise<void>
  /**
   * Selection only, for the prefill path: there is no input to carry, and the
   * prefill that follows is local, so nothing can fail after the switch lands.
   */
  readonly switchAgent: () => Promise<void>
  readonly prefill: () => void
  /** Resolves true only on an explicit approval; dismissal must resolve false. */
  readonly confirm: (reason: "escalation") => Promise<boolean>
  readonly reject: (reason: "escalation") => void
}

/** Executes a plan. Kept next to `planHandoff` so the ordering is testable once. */
export async function executeHandoff(plan: HandoffPlan, ops: HandoffOps): Promise<void> {
  const proceed = async (action: "switch-and-send" | "switch-and-prefill") => {
    if (action === "switch-and-send") return await ops.submit()
    await ops.switchAgent()
    return ops.prefill()
  }
  if (plan.action !== "confirm") return await proceed(plan.action)
  if (!(await ops.confirm(plan.reason))) return ops.reject(plan.reason)
  return await proceed(plan.then)
}
