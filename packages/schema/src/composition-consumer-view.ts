export * as CompositionConsumerView from "./composition-consumer-view"

import { Composition } from "./composition"

/**
 * Which asset set a Session may see inside a frozen Composition Snapshot.
 *
 * The three states are deliberately distinct. Collapsing "this snapshot predates per-consumer
 * bindings" and "this session's agent is not in the frozen pool" into one `undefined` is what let
 * an unknown agent fall through to the cross-consumer flat arrays — the exact leak D5-A closes.
 *
 * Owned here (not in `@aigcfroge/core`) so the app composer can resolve the same consumer catalog
 * for the slash popover without deep-importing core; core re-exports this module unchanged.
 */
export type Scope =
  /** V1, or a V2 snapshot written before bindings existed: the flat arrays are the contract. */
  | { readonly _tag: "unscoped" }
  /** New graph, consumer resolved. Only this consumer's binding is visible. */
  | { readonly _tag: "scoped"; readonly key: string }
  /** New graph, but the session's agent is absent from the frozen pool. Callers must fail closed. */
  | { readonly _tag: "unresolved"; readonly agent: string }

type SessionLike = {
  readonly parentID?: string | null | undefined
  readonly agent?: string | null | undefined
}

const ORCHESTRATOR = "orchestrator"

/** True when the snapshot carries a per-consumer binding graph (V2 with bindings present). */
export function isScopedGraph(snapshot: Composition.Snapshot): boolean {
  return snapshot.version === 2 && snapshot.data.bindings !== undefined
}

export function resolveScope(snapshot: Composition.Snapshot, session: SessionLike): Scope {
  if (!isScopedGraph(snapshot)) return { _tag: "unscoped" }
  // Root sessions are always the orchestrator; Custom root is pinned to `meta` by policy, and the
  // orchestrator consumer always exists in a new graph (the resolver emits it even when empty).
  if (!session.parentID) return { _tag: "scoped", key: ORCHESTRATOR }
  const agent = session.agent ?? ""
  if (snapshot.version !== 2) return { _tag: "unresolved", agent }
  const info = snapshot.data.agents.find((a) => a.id === agent || a.name === agent)
  if (!info) return { _tag: "unresolved", agent }
  return { _tag: "scoped", key: info.consumerKey ?? `agents/${info.name}` }
}

/**
 * Same mapping as {@link resolveScope} but from an agent identity alone, for call sites that run
 * inside a provider turn and have the selected agent rather than the Session row (tool leaves).
 * Custom root is pinned to `meta` by ProductModeAgentPolicy, so `meta` maps to the orchestrator.
 */
export function resolveScopeForAgent(snapshot: Composition.Snapshot, agent: string | null | undefined): Scope {
  if (!isScopedGraph(snapshot)) return { _tag: "unscoped" }
  const id = agent ?? ""
  if (id === "meta") return { _tag: "scoped", key: ORCHESTRATOR }
  if (snapshot.version !== 2) return { _tag: "unresolved", agent: id }
  const info = snapshot.data.agents.find((a) => a.id === id || a.name === id)
  if (!info) return { _tag: "unresolved", agent: id }
  return { _tag: "scoped", key: info.consumerKey ?? `agents/${info.name}` }
}

/**
 * Whether the caller may proceed. `false` means fail closed with a typed error — never fall back
 * to the flat arrays, which belong to every consumer at once.
 */
export function isBindingSatisfied(snapshot: Composition.Snapshot, scope: Scope): boolean {
  if (scope._tag === "unscoped") return true
  if (scope._tag === "unresolved") return false
  if (snapshot.version !== 2) return false
  const bindings = snapshot.data.bindings
  if (bindings === undefined) return false
  return scope.key in bindings
}

const binding = (snapshot: Composition.Snapshot, scope: Scope): Composition.SnapshotBindingData | undefined => {
  if (scope._tag !== "scoped" || snapshot.version !== 2) return undefined
  return snapshot.data.bindings?.[scope.key]
}

export function getInstructions(snapshot: Composition.Snapshot, scope: Scope): ReadonlyArray<Composition.Instruction> {
  if (scope._tag === "unscoped") return snapshot.data.instructions
  return binding(snapshot, scope)?.instructions ?? []
}

export function getPrompts(
  snapshot: Composition.Snapshot,
  scope: Scope,
): ReadonlyArray<Composition.SnapshotPromptData> {
  if (scope._tag === "unscoped") return snapshot.data.prompts
  return binding(snapshot, scope)?.prompts ?? []
}

export function getSkills(snapshot: Composition.Snapshot, scope: Scope): ReadonlyArray<Composition.SkillInfo> {
  if (scope._tag === "unscoped") return snapshot.data.skills
  return binding(snapshot, scope)?.skills ?? []
}

export function getCommands(snapshot: Composition.Snapshot, scope: Scope): ReadonlyArray<Composition.CommandInfo> {
  if (scope._tag === "unscoped") return snapshot.version === 2 ? snapshot.data.commands : []
  return binding(snapshot, scope)?.commands ?? []
}
