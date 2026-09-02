import { describe, expect, test } from "bun:test"
import type { CompositionDiagnostic, CompositionPlan } from "@aigcfroge/sdk/v2/client"
import {
  classifyPlanFailure,
  classifySnapshotFailure,
  DISABLED_MESSAGE_MARKER,
  evaluateStartGate,
  parseErrorDetails,
} from "./custom-plan-state"

// Kept literal rather than imported from core: `packages/app` must not pull
// anything that transitively reaches `core/flag/flag.ts`, which reads `process`
// and blanks the web build. So this constant is duplicated on purpose, and this
// assertion is what catches the two copies drifting apart.
const SERVER_MESSAGE = "Custom mode is disabled on this server. Set AIGCFROGE_CUSTOM_MODE=true to enable it."

const plan = (over: Partial<CompositionPlan> = {}): CompositionPlan => ({
  version: 2,
  digest: "dig_1",
  valid: true,
  input: { source: "temporary", agents: [], bindings: {}, presentation: "native", requestedCapabilities: [] },
  instructions: [],
  skills: [],
  capabilities: [],
  diagnostics: [],
  ...over,
})

const diagnostic = (severity: CompositionDiagnostic["severity"]): CompositionDiagnostic => ({
  severity,
  code: "test",
  message: "test",
})

const gate = (over: Partial<Parameters<typeof evaluateStartGate>[0]> = {}) =>
  evaluateStartGate({
    starting: false,
    hasSdk: true,
    result: { plan: plan() },
    draft: { source: "profile", agentCount: 1 },
    ...over,
  })

/**
 * `disabled` is the only signal that downgrades the Builder from a red error to
 * the amber opt-in notice, and it is one of the conditions that keep Start
 * disabled. Misclassify it and Start becomes clickable against a server that will
 * refuse the request — so this is a behaviour boundary, not formatting.
 */
describe("classifyPlanFailure", () => {
  test("recognizes the server's custom-mode-disabled message", () => {
    expect(classifyPlanFailure({ status: 400, message: SERVER_MESSAGE })).toEqual({
      disabled: true,
      error: SERVER_MESSAGE,
    })
  })

  test("stays in sync with the server's wording", () => {
    // If the server message is reworded or localized so it no longer contains
    // this marker, `disabled` silently becomes undefined and Start re-enables.
    expect(SERVER_MESSAGE).toContain(DISABLED_MESSAGE_MARKER)
  })

  test("treats 404 as an unsupported server, not a disabled flag", () => {
    expect(classifyPlanFailure({ status: 404, message: "Not Found" })).toEqual({
      unsupported: true,
      error: "This server does not support custom compositions",
    })
  })

  test("leaves every other failure as a plain error", () => {
    expect(classifyPlanFailure({ status: 500, message: "boom" })).toEqual({ error: "boom" })
    expect(classifyPlanFailure({ status: 400, message: 'Unknown or unsupported product mode "nope"' })).toEqual({
      error: 'Unknown or unsupported product mode "nope"',
    })
  })

  test("survives a non-object rejection", () => {
    expect(classifyPlanFailure("network down")).toEqual({ error: "network down" })
    expect(classifyPlanFailure(undefined)).toEqual({ error: "undefined" })
  })

  test("does not mark a 404 as disabled even when the body mentions the flag", () => {
    // Order matters: an unsupported server cannot be fixed by setting the flag,
    // so the 404 branch has to win.
    expect(classifyPlanFailure({ status: 404, message: SERVER_MESSAGE })).toEqual({
      unsupported: true,
      error: "This server does not support custom compositions",
    })
  })
})

describe("parseErrorDetails", () => {
  test("reads status and message off an error-shaped object", () => {
    expect(parseErrorDetails({ status: 409, message: "conflict" })).toEqual({ status: 409, message: "conflict" })
  })

  test("ignores fields of the wrong type instead of coercing them", () => {
    expect(parseErrorDetails({ status: "409", message: 12 })).toEqual({ status: undefined, message: undefined })
  })

  test("stringifies a non-object rejection", () => {
    expect(parseErrorDetails(null)).toEqual({ message: "null" })
  })
})

describe("classifySnapshotFailure", () => {
  test("treats 404 as a session that simply has no snapshot", () => {
    expect(classifySnapshotFailure({ status: 404, message: "Snapshot not found for session ses_1" })).toEqual({
      state: "absent",
    })
  })

  test("keeps a server-side decode failure as an error, not as an absent snapshot", () => {
    // Verified against handlers/session.ts:1093-1110: `SnapshotDecodeError` maps to
    // 400, so a corrupt stored snapshot used to render as "this session has no
    // composition" — the one outcome the user cannot act on.
    expect(classifySnapshotFailure({ status: 400, message: "Bad Request" })).toEqual({
      state: "failed",
      message: "Bad Request",
    })
  })

  test("keeps a transport failure with no status as an error", () => {
    expect(classifySnapshotFailure(new Error("socket hang up"))).toEqual({
      state: "failed",
      message: "socket hang up",
    })
    expect(classifySnapshotFailure("offline")).toEqual({ state: "failed", message: "offline" })
  })
})

describe("evaluateStartGate", () => {
  test("allows Start once a valid plan with a digest has settled", () => {
    expect(gate()).toEqual({ canStart: true })
  })

  test("blocks while the plan has never settled", () => {
    // P2-12: this is first paint. Falling through here enables Start against a
    // composition the server has not planned.
    expect(gate({ result: undefined })).toEqual({ canStart: false, blocker: "plan-pending" })
  })

  test("blocks on a plain plan failure, not just on disabled/unsupported", () => {
    // P2-12: `classifyPlanFailure` returns `{ error }` for every non-404,
    // non-disabled failure — a 500, a decode error, a dropped connection.
    expect(gate({ result: { error: "boom" } })).toEqual({ canStart: false, blocker: "plan-failed" })
  })

  test("blocks when the settled plan carries no digest", () => {
    // P2-12: there is nothing for Start to freeze without a digest.
    expect(gate({ result: { plan: plan({ digest: "" }) } })).toEqual({
      canStart: false,
      blocker: "no-digest",
    })
  })

  test("reports the most specific blocker when several apply", () => {
    // `starting` wins over everything so a double click cannot re-enter, and
    // `disabled` wins over a generic error because it drives the amber notice.
    expect(gate({ starting: true, hasSdk: false, result: undefined })).toEqual({
      canStart: false,
      blocker: "starting",
    })
    expect(gate({ result: { disabled: true, error: SERVER_MESSAGE } })).toEqual({
      canStart: false,
      blocker: "custom-disabled",
    })
    expect(gate({ result: { unsupported: true, error: "no" } })).toEqual({
      canStart: false,
      blocker: "unsupported-server",
    })
  })

  test("blocks without an SDK for the directory", () => {
    expect(gate({ hasSdk: false })).toEqual({ canStart: false, blocker: "no-sdk" })
  })

  test("blocks on a blocking diagnostic but not on a warning", () => {
    expect(gate({ result: { plan: plan({ diagnostics: [diagnostic("blocking")] }) } })).toEqual({
      canStart: false,
      blocker: "blocking-diagnostics",
    })
    expect(gate({ result: { plan: plan({ diagnostics: [diagnostic("warning"), diagnostic("error")] }) } })).toEqual({
      canStart: true,
    })
  })

  test("blocks an empty temporary draft but allows an empty saved profile", () => {
    expect(gate({ draft: { source: "temporary", agentCount: 0 } })).toEqual({
      canStart: false,
      blocker: "no-agents",
    })
    expect(gate({ draft: { source: "temporary", agentCount: 1 } })).toEqual({ canStart: true })
    expect(gate({ draft: { source: "profile", agentCount: 0 } })).toEqual({ canStart: true })
  })
})
