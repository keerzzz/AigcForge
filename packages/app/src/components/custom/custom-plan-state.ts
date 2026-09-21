import type { CompositionDiagnostic, CompositionPlan } from "@aigcfroge/sdk/v2/client"

// Pure decision layer for the Custom Builder's preview column, split out of
// `custom-preview-column.tsx`.
//
// The split is not cosmetic. While this logic lived in the `.tsx`, its test could
// only import it when some *other* test file had already called
// `mock.module("@solidjs/router", …)` — that mock is process-global in bun, and the
// component's import chain reaches the router through `@/context/tabs`, which
// throws "Client-only API called on the server side" on the real module. Measured:
// `bun test src/components/custom/` alone => 1 fail (this file's test never runs);
// adding `src/components/file-tree.test.ts`, which mocks the router, => 0 fail. So
// the coverage was hostage to file ordering. Nothing here may import a context
// value or JSX.

export interface PlanFailure {
  error: string
  disabled?: boolean
  unsupported?: boolean
}

interface ErrorDetails {
  status?: number
  message?: string
  tag?: string
  mode?: string
}

/**
 * What the `customComposition.plan` resource settles to. Every field is optional
 * because `{}` is a real value here — it is what the resource returns before a
 * directory SDK exists — and telling that apart from a settled plan is the whole
 * point of `evaluateStartGate`.
 */
export type PlanResult = {
  plan?: CompositionPlan
  error?: string
  disabled?: boolean
  unsupported?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  return isRecord(value) && typeof value[key] === "number" ? value[key] : undefined
}

/**
 * Reads both the direct result-tuple shape and the `throwOnError` shape used by
 * the app SDK. The latter is an `Error` whose `cause` carries `{ status, body }`,
 * so ignoring `cause` made typed server errors look like transport failures and
 * hid 404 / UnsupportedProductModeError from the Builder.
 */
export function parseErrorDetails(err: unknown): ErrorDetails {
  const cause = err instanceof Error && isRecord(err.cause) ? err.cause : undefined
  const body = cause?.body ?? err
  const fallbackMessage =
    typeof err === "object" && err !== null ? undefined : err === undefined ? undefined : String(err)
  const message =
    stringField(body, "message") ??
    (err instanceof Error && err.message.length > 0 ? err.message : undefined) ??
    fallbackMessage
  const status = numberField(cause, "status") ?? numberField(body, "status")
  const tag = stringField(body, "_tag")
  const mode = stringField(body, "mode")
  return {
    ...(status === undefined ? {} : { status }),
    ...(message === undefined ? {} : { message }),
    ...(tag === undefined ? {} : { tag }),
    ...(mode === undefined ? {} : { mode }),
  }
}

/**
 * Classifies a failed `customComposition.plan` call.
 *
 * `disabled` is what downgrades the surface from a red error to the amber opt-in
 * notice, so misclassifying it re-enables Start against a server that will refuse.
 * The typed `UnsupportedProductModeError` body is the primary source. The message
 * fallback remains only for older servers that did not expose the tag through the
 * SDK wrapper.
 */
export const DISABLED_MESSAGE_MARKER = "Custom mode is disabled"

export function classifyPlanFailure(err: unknown): PlanFailure {
  const { status, message, tag, mode } = parseErrorDetails(err)
  const msg = message ?? String(err)
  if (status === 404) return { unsupported: true, error: "This server does not support custom compositions" }
  if (tag === "UnsupportedProductModeError" && mode === "custom") {
    return { disabled: true, error: msg }
  }
  if (msg.includes(DISABLED_MESSAGE_MARKER)) return { disabled: true, error: msg }
  return { error: msg }
}

export const blockingDiagnostics = (plan: CompositionPlan | undefined) =>
  (plan?.diagnostics ?? []).filter((diagnostic: CompositionDiagnostic) => diagnostic.severity === "blocking").length

export type StartBlocker =
  | "starting"
  | "no-sdk"
  | "plan-pending"
  | "plan-failed"
  | "custom-disabled"
  | "unsupported-server"
  | "no-digest"
  | "blocking-diagnostics"
  | "no-agents"

export type StartGate = { canStart: true } | { canStart: false; blocker: StartBlocker }

/**
 * The reason Start is unavailable, or `undefined` when it is available. Lives
 * beside the gate (and takes the gate as an argument) so the view cannot derive it
 * out of order — a memo that referenced a later declaration would throw inside
 * `createMemo`, which evaluates eagerly.
 */
export function blockerOf(gate: StartGate): StartBlocker | undefined {
  return gate.canStart ? undefined : gate.blocker
}

/**
 * Decides whether Start may be pressed.
 *
 * Every "not yet known" case has to block, not fall through: the server will
 * refuse a composition it never planned, and an enabled Start that fails on click
 * is worse than a disabled one that explains itself. The blocker is returned rather
 * than a bare boolean so the surface can say which condition it is waiting on.
 */
export function evaluateStartGate(input: {
  starting: boolean
  hasSdk: boolean
  result: PlanResult | undefined
  draft: { source: string; agentCount: number }
}): StartGate {
  if (input.starting) return { canStart: false, blocker: "starting" }
  if (!input.hasSdk) return { canStart: false, blocker: "no-sdk" }
  // `undefined` is the first paint, before the plan resource has settled once.
  if (input.result === undefined) return { canStart: false, blocker: "plan-pending" }
  if (input.result.disabled === true) return { canStart: false, blocker: "custom-disabled" }
  if (input.result.unsupported === true) return { canStart: false, blocker: "unsupported-server" }
  if (input.result.error !== undefined) return { canStart: false, blocker: "plan-failed" }
  const plan = input.result.plan
  // No digest means the server did not produce a resolvable composition, so there
  // is nothing for Start to freeze.
  if (plan === undefined || !plan.digest) return { canStart: false, blocker: "no-digest" }
  if (blockingDiagnostics(plan) > 0) return { canStart: false, blocker: "blocking-diagnostics" }
  if (input.draft.source === "temporary" && input.draft.agentCount === 0) {
    return { canStart: false, blocker: "no-agents" }
  }
  return { canStart: true }
}

/**
 * Outcome of `session.composition`.
 *
 * P2-11: the panel used to `catch { return undefined }` and then render "no
 * Snapshot" for anything falsy, which merged four different situations. Verified
 * against the endpoint (`handlers/session.ts:1093-1110`): a missing snapshot is
 * 404, but a snapshot the SERVER could not decode is 400 — i.e. real corruption
 * was being shown as "this session has no composition", and so was a dropped
 * connection.
 */
export type SnapshotFetch<T> =
  | { readonly state: "ready"; readonly snapshot: T }
  | { readonly state: "absent" }
  | { readonly state: "failed"; readonly message: string }

/** 404 is the only status that means "this session simply has no snapshot". */
export function classifySnapshotFailure(err: unknown): SnapshotFetch<never> {
  const { status, message } = parseErrorDetails(err)
  if (status === 404) return { state: "absent" }
  return { state: "failed", message: message ?? String(err) }
}
