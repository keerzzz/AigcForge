import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect"
import { GrantEvent } from "@aigcfroge/core/grant/event"
import { ScopedGrantStore } from "@aigcfroge/core/grant/store"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { McpScope } from "@aigcfroge/schema/mcp-scope"
import { SessionV2 } from "@aigcfroge/core/session"
import { issueGrantForRequest } from "@aigcfroge/server/handlers/grant"
import { testEffect } from "../lib/effect"

/**
 * `issueGrantForRequest` is the extracted body of `POST
 * /api/session/:sessionID/permission/:requestID/grant`. It is tested here rather
 * than through an HTTP round trip because the compensation branch needs `get` to
 * succeed and `reply` to then fail, and both read the SAME in-memory pending Map
 * (`core/src/permission.ts:412` and `:343`). In one process that window only
 * opens for two racing grant requests, and racing tests are forbidden
 * (CLAUDE.md, 测试同步). Driving the two owners directly is the only way to
 * observe the branch deterministically.
 */
const it = testEffect(Layer.empty)

const REQUEST_ID = PermissionV2.ID.make("per_owner")
const SESSION_ID = "ses_owner"
const GRANT_ID = "grt_compensation"

// Built through the real decoders/constructors rather than cast object
// literals, so a schema change breaks this file instead of silently drifting.
const request = Schema.decodeUnknownSync(PermissionV2.Request)({
  id: REQUEST_ID,
  sessionID: SESSION_ID,
  action: "bash",
  resources: ["/tmp/run.sh"],
})

const issued = (revision: number): ScopedGrantStore.Info =>
  new McpScope.ScopedGrantInfo({
    grant: new McpScope.ScopedGrant({
      id: GRANT_ID,
      scope: { level: "session", sessionID: SESSION_ID },
      action: "bash",
      resources: ["/tmp/run.sh"],
      effect: "allow",
      issuedAt: 1000,
    }),
    status: "active",
    grantRevision: revision,
  })

type Calls = {
  issued: { action: string; level: string }[]
  replies: PermissionV2.ReplyInput["reply"][]
  revocations: { grantID: string; expectedRevision: number }[]
}

const owners = (
  calls: Calls,
  over: {
    replyFails?: boolean
    revokeFails?: boolean
    issueRejected?: boolean
    missing?: boolean
    foreignSession?: boolean
  } = {},
) => ({
  permission: {
    get: () =>
      Effect.succeed(
        over.missing
          ? undefined
          : over.foreignSession
            ? { ...request, sessionID: SessionV2.ID.make("ses_other") }
            : request,
      ),
    reply: (input: PermissionV2.ReplyInput) =>
      Effect.suspend(() => {
        calls.replies.push(input.reply)
        return over.replyFails
          ? Effect.fail(new PermissionV2.NotFoundError({ requestID: input.requestID }))
          : Effect.void
      }),
  } satisfies Pick<PermissionV2.Interface, "get" | "reply">,
  store: {
    issue: (input: { scope: { level: string }; action: string }) =>
      Effect.suspend(() => {
        if (over.issueRejected) return Effect.fail(new GrantEvent.CommitRejected({ grantID: GRANT_ID, revision: 1 }))
        calls.issued.push({ action: input.action, level: input.scope.level })
        return Effect.succeed(issued(1))
      }),
    revoke: (grantID: string, expectedRevision: number) =>
      Effect.suspend(() => {
        calls.revocations.push({ grantID, expectedRevision })
        return over.revokeFails
          ? Effect.fail(new ScopedGrantStore.NotFoundError({ grantID }))
          : Effect.succeed(issued(expectedRevision + 1))
      }),
  } satisfies Pick<ScopedGrantStore.Interface, "issue" | "revoke">,
})

const empty = (): Calls => ({ issued: [], replies: [], revocations: [] })

const str = (value: unknown) => (typeof value === "string" ? value : undefined)

/** Reads the typed failure without asserting its type — a cast here would let a
 *  changed error type silently satisfy every `tag` assertion below. */
const failureOf = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true)
  const found = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none()
  expect(Option.isSome(found)).toBe(true)
  const error: Record<string, unknown> =
    Option.isSome(found) && typeof found.value === "object" && found.value !== null ? { ...found.value } : {}
  return { tag: str(error._tag), resource: str(error.resource), message: str(error.message) }
}

const run = (calls: Calls, over: Parameters<typeof owners>[1] = {}, level: "session" | "location" = "session") =>
  issueGrantForRequest({ ...owners(calls, over), sessionID: SESSION_ID, requestID: REQUEST_ID, level })

describe("issueGrantForRequest", () => {
  it.effect("issues the grant and resolves the pending request on the happy path", () =>
    Effect.gen(function* () {
      const calls = empty()
      const result = yield* run(calls)
      expect(result.grant.id).toBe(GRANT_ID)
      expect(calls.issued).toEqual([{ action: "bash", level: "session" }])
      expect(calls.replies).toEqual(["once"])
      // Nothing to compensate when the reply lands.
      expect(calls.revocations).toEqual([])
    }),
  )

  it.effect("revokes the freshly issued grant when the reply fails, and reports a conflict", () =>
    Effect.gen(function* () {
      const calls = empty()
      const exit = yield* run(calls, { replyFails: true }).pipe(Effect.exit)
      const failure = failureOf(exit)
      // The caller must not be told the grant succeeded…
      expect(failure.tag).toBe("ConflictError")
      expect(failure.resource).toBe(REQUEST_ID)
      // …the grant really was issued and the reply really was attempted…
      expect(calls.issued).toHaveLength(1)
      expect(calls.replies).toEqual(["once"])
      // …and it was revoked at the revision it was issued at, so no active grant
      // outlives the failed reply.
      expect(calls.revocations).toEqual([{ grantID: GRANT_ID, expectedRevision: 1 }])
    }),
  )

  it.effect("still fails the call when the compensating revoke itself fails", () =>
    Effect.gen(function* () {
      const calls = empty()
      const exit = yield* run(calls, { replyFails: true, revokeFails: true }).pipe(Effect.exit)
      // A failed compensation must never be reported as a successful grant.
      expect(failureOf(exit).tag).toBe("ConflictError")
      expect(calls.revocations).toEqual([{ grantID: GRANT_ID, expectedRevision: 1 }])
    }),
  )

  it.effect("passes a location-level request through as a location scope", () =>
    Effect.gen(function* () {
      const calls = empty()
      yield* run(calls, {}, "location")
      expect(calls.issued).toEqual([{ action: "bash", level: "location" }])
    }),
  )

  it.effect("never issues for a request that is already gone", () =>
    Effect.gen(function* () {
      const calls = empty()
      const exit = yield* run(calls, { missing: true }).pipe(Effect.exit)
      expect(failureOf(exit).tag).toBe("PermissionNotFoundError")
      expect(calls.issued).toEqual([])
      expect(calls.replies).toEqual([])
    }),
  )

  it.effect("never issues for a request owned by a different session", () =>
    Effect.gen(function* () {
      const calls = empty()
      const exit = yield* run(calls, { foreignSession: true }).pipe(Effect.exit)
      expect(failureOf(exit).tag).toBe("PermissionNotFoundError")
      expect(calls.issued).toEqual([])
      expect(calls.replies).toEqual([])
    }),
  )

  it.effect("does not resolve the pending request when issuance is rejected", () =>
    Effect.gen(function* () {
      const calls = empty()
      const exit = yield* run(calls, { issueRejected: true }).pipe(Effect.exit)
      expect(failureOf(exit).tag).toBe("ConflictError")
      // A request whose grant never committed must stay pending.
      expect(calls.replies).toEqual([])
      expect(calls.revocations).toEqual([])
    }),
  )
})
