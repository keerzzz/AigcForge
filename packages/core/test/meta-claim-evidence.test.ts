import { describe, expect, it } from "bun:test"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Config } from "@omnixa/core/config"
import { SessionMessage } from "@omnixa/core/session/message"
import { VerificationRouter } from "@omnixa/core/session/verification-router"
import { Verifier } from "@omnixa/core/session/verifier"
import { Session } from "@omnixa/core/session"
import { Shell } from "@omnixa/schema/shell"

const source = new VerificationRouter.Source({
  sessionID: Session.ID.make("ses_meta"),
  messageID: SessionMessage.ID.make("msg_meta"),
  id: "call_1",
})

const shellTool = (
  metadata: Record<string, Schema.Json>,
  status: "completed" | "running" = "completed",
): SessionMessage.AssistantTool => ({
  type: "tool",
  id: "call_shell",
  name: "shell",
  time: { created: DateTime.makeUnsafe(1) },
  state:
    status === "completed"
      ? {
          status: "completed",
          input: { command: "curl http://127.0.0.1:3000/health" },
          content: [{ type: "text", text: "ok" }],
          metadata,
        }
      : {
          status: "running",
          input: { command: "curl http://127.0.0.1:3000/health" },
          metadata,
        },
})

const editTool = (verifier: Verifier.Result): SessionMessage.AssistantTool => ({
  type: "tool",
  id: "call_edit",
  name: "edit",
  time: { created: DateTime.makeUnsafe(1) },
  state: {
    status: "completed",
    input: { path: "src/index.ts" },
    content: [{ type: "text", text: "edited" }],
    metadata: { verification: Schema.encodeSync(Schema.toCodecJson(Verifier.Result))(verifier) },
  },
})

describe("VerificationRouter META-CLAIM-EVIDENCE", () => {
  it("rejects claims missing a source or backed by non-execution tools", () => {
    const missing = VerificationRouter.evaluateClaim({ claim: "psql migration verified" })
    expect(missing.status).toBe("missing_evidence")

    const grepTool: SessionMessage.AssistantTool = {
      type: "tool",
      id: "call_grep",
      name: "grep",
      time: { created: DateTime.makeUnsafe(1) },
      state: {
        status: "completed",
        input: { pattern: "curl" },
        content: [{ type: "text", text: "matched" }],
      },
    }
    const disguised = VerificationRouter.evaluateClaim({
      claim: "curl health check passed",
      source,
      tool: grepTool,
    })
    expect(disguised.status).toBe("missing_evidence")
    expect(disguised.reason).toContain("not a Shell CommandResult or Verifier source")
  })

  it("binds shell CommandResult exit, timeout, and missing metadata deterministically", () => {
    const passedCmd: Shell.CommandResult = {
      id: Shell.ID.make("sh_1"),
      command: "curl http://127.0.0.1:3000/health",
      cwd: "/project",
      exit: 0,
      timeout: false,
      truncated: false,
      outputDigest: "a".repeat(64),
      started: 1,
      completed: 2,
    }
    const passed = VerificationRouter.evaluateClaim({
      claim: "curl health check passed",
      source,
      tool: shellTool({ commandResult: Schema.encodeSync(Shell.CommandResult)(passedCmd) }),
    })
    expect(passed).toMatchObject({
      status: "passed",
      kind: "command",
      exit: 0,
      outputDigest: "a".repeat(64),
    })

    const failedCmd: Shell.CommandResult = {
      id: Shell.ID.make("sh_2"),
      command: "psql -c 'SELECT 1'",
      cwd: "/project",
      exit: 1,
      timeout: false,
      truncated: false,
      outputDigest: "b".repeat(64),
      started: 1,
      completed: 2,
    }
    const failed = VerificationRouter.evaluateClaim({
      claim: "psql check passed",
      source,
      tool: shellTool({ commandResult: Schema.encodeSync(Shell.CommandResult)(failedCmd) }),
    })
    expect(failed).toMatchObject({ status: "failed", kind: "command", exit: 1 })

    const noMetadata = VerificationRouter.evaluateClaim({
      claim: "fault injection passed",
      source,
      tool: shellTool({}),
    })
    expect(noMetadata.status).toBe("missing_evidence")
  })

  it("binds Verifier.Result freshness and rejects unavailable or stale checks", () => {
    const passedResult = new Verifier.Result({
      sessionID: source.sessionID,
      toolName: "edit",
      source: { type: "tool", messageID: source.messageID, id: source.id },
      status: "passed",
      files: [],
      packages: [],
    })
    expect(
      VerificationRouter.evaluateClaim({
        claim: "core typecheck passed",
        source,
        tool: editTool(passedResult),
        verifierCurrent: true,
      }),
    ).toMatchObject({ status: "passed", kind: "verifier", verifierStatus: "passed" })

    expect(
      VerificationRouter.evaluateClaim({
        claim: "core typecheck passed",
        source,
        tool: editTool(passedResult),
        verifierCurrent: false,
      }),
    ).toMatchObject({ status: "missing_evidence", kind: "verifier" })

    const unavailableResult = new Verifier.Result({
      sessionID: source.sessionID,
      toolName: "edit",
      source: { type: "tool", messageID: source.messageID, id: source.id },
      status: "unavailable",
      files: [],
      packages: [],
    })
    expect(
      VerificationRouter.evaluateClaim({
        claim: "core typecheck passed",
        source,
        tool: editTool(unavailableResult),
        verifierCurrent: true,
      }),
    ).toMatchObject({ status: "missing_evidence", kind: "verifier", verifierStatus: "unavailable" })
  })

  it("summarizes claimStatus across VerificationRouter.route settlements", async () => {
    const configLayer = Layer.succeed(Config.Service, {
      entries: () => Effect.succeed([]),
    } as unknown as Config.Interface)
    const routerLayer = VerificationRouter.layer.pipe(Layer.provide(configLayer))

    const passedClaim = new VerificationRouter.ClaimEvidence({
      claim: "curl ok",
      source,
      kind: "command",
      status: "passed",
      exit: 0,
    })
    const missingClaim = new VerificationRouter.ClaimEvidence({
      claim: "psql ok",
      status: "missing_evidence",
    })
    const failedClaim = new VerificationRouter.ClaimEvidence({
      claim: "fault ok",
      source,
      kind: "command",
      status: "failed",
      exit: 1,
    })

    const settlement = await Effect.runPromise(
      Effect.gen(function* () {
        const router = yield* VerificationRouter.Service
        const allPassed = yield* router.route({
          history: [],
          source,
          operation: "none",
          status: "not_dispatched",
          claims: [passedClaim],
        })
        const hasMissing = yield* router.route({
          history: [],
          source,
          operation: "none",
          status: "not_dispatched",
          claims: [passedClaim, missingClaim],
        })
        const hasFailed = yield* router.route({
          history: [],
          source,
          operation: "none",
          status: "not_dispatched",
          claims: [passedClaim, missingClaim, failedClaim],
        })
        return { allPassed, hasMissing, hasFailed }
      }).pipe(Effect.provide(routerLayer)),
    )

    expect(settlement.allPassed.claimStatus).toBe("passed")
    expect(settlement.hasMissing.claimStatus).toBe("missing_evidence")
    expect(settlement.hasFailed.claimStatus).toBe("failed")
  })
})
