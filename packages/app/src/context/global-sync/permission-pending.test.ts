import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@aigcfroge/sdk/v2/client"
import {
  permissionPendingFromLegacy,
  permissionPendingFromV2,
  permissionReplyFromV2,
  permissionReply,
  permissionPresentation,
  decidePermission,
  type PermissionV2Pending,
} from "./permission-pending"

const legacy = (input: Partial<PermissionRequest> = {}) => ({
  id: "per_v1",
  sessionID: "ses_legacy",
  permission: "bash",
  patterns: ["/tmp/run.sh"],
  metadata: {},
  always: [],
  ...input,
})

const v2 = (input: Partial<PermissionV2Pending> = {}) => ({
  id: "per_v2",
  sessionID: "ses_custom",
  action: "bash",
  resources: ["/tmp/run.sh"],
  ...input,
})

describe("permission pending adapters", () => {
  test("normalizes only the UI-safe V2 request fields", () => {
    expect(
      permissionPendingFromV2({
        ...v2(),
        metadata: {
          description: "Run the project formatter",
          execution_type: "command",
          credentialRef: "must-not-enter-app-state",
        },
        source: { type: "tool", messageID: "msg_1", callID: "call_1" },
      }),
    ).toEqual({
      ...v2(),
      metadata: {
        description: "Run the project formatter",
        execution_type: "command",
      },
      source: { type: "tool", messageID: "msg_1", callID: "call_1" },
    })
  })

  test("rejects malformed V2 event payloads instead of adding them to pending state", () => {
    expect(permissionPendingFromV2({ ...v2(), resources: ["/tmp/run.sh", 1] })).toBeUndefined()
    expect(permissionPendingFromV2({ ...v2(), source: { type: "tool", messageID: "msg_1" } })).toBeUndefined()
  })

  test("rejects malformed V2 reply payloads", () => {
    expect(permissionReplyFromV2({ sessionID: "ses_custom" })).toBeUndefined()
    expect(
      permissionReplyFromV2({ sessionID: "ses_custom", requestID: "per_v2", reply: "allow_everything" }),
    ).toBeUndefined()
    expect(permissionReplyFromV2({ sessionID: "ses_custom", requestID: "per_v2", reply: "once" })).toEqual({
      sessionID: "ses_custom",
      requestID: "per_v2",
      reply: "once",
    })
  })

  test("presents V2 action, resources, and safe metadata without legacy coercion", () => {
    expect(
      permissionPresentation({
        kind: "v2",
        request: v2({
          metadata: { description: "Run formatter", cli_target: "bun format", execution_type: "command" },
        }),
      }),
    ).toEqual({
      ...v2(),
      metadata: { description: "Run formatter", cli_target: "bun format", execution_type: "command" },
    })
  })

  test("keeps legacy and V2 reply transports distinct", () => {
    expect(permissionReply(permissionPendingFromLegacy(legacy()), "once")).toEqual({
      kind: "legacy",
      input: { sessionID: "ses_legacy", permissionID: "per_v1", response: "once" },
    })
    expect(permissionReply({ kind: "v2", request: v2() }, "always")).toEqual({
      kind: "v2",
      input: { sessionID: "ses_custom", requestID: "per_v2", reply: "always" },
    })
  })
})

test("routes scoped decisions through the grant endpoint and rejects them for legacy requests", async () => {
  const calls: Array<{ route: string; input: unknown }> = []
  const client = {
    permission: { respond: async () => undefined },
    v2: {
      session: {
        permission: {
          reply: async () => calls.push({ route: "reply", input: null }),
          grant: async (input: unknown) => {
            calls.push({ route: "grant", input })
          },
        },
      },
    },
  }

  await decidePermission(client, { request: { kind: "v2", request: v2() }, decision: "session" })
  await decidePermission(client, { request: { kind: "v2", request: v2() }, decision: "location" })

  // A scoped grant on a legacy request used to be a runtime throw. It is now a
  // compile error, which is strictly stronger: the call cannot be written at all,
  // so no runtime guard has to survive future refactors to keep it out.
  // @ts-expect-error a legacy request has no ScopedGrant to issue
  void (() => decidePermission(client, { request: permissionPendingFromLegacy(legacy()), decision: "session" }))
  // …and the reverse: `always` is a project-wide legacy rule, never a V2 answer.
  // @ts-expect-error a V2 request must not take the legacy `always` path
  void (() => decidePermission(client, { request: { kind: "v2", request: v2() }, decision: "always" }))

  expect(calls).toEqual([
    { route: "grant", input: { sessionID: "ses_custom", requestID: "per_v2", level: "session" } },
    { route: "grant", input: { sessionID: "ses_custom", requestID: "per_v2", level: "location" } },
  ])
})

test("dispatches each pending request through its owned reply endpoint", async () => {
  const calls: Array<{ route: string; input: unknown }> = []
  const client = {
    permission: {
      respond: async (input: unknown) => {
        calls.push({ route: "legacy", input })
      },
    },
    v2: {
      session: {
        permission: {
          reply: async (input: unknown) => {
            calls.push({ route: "v2", input })
          },
          grant: async () => undefined,
        },
      },
    },
  }

  await decidePermission(client, { request: permissionPendingFromLegacy(legacy()), decision: "reject" })
  await decidePermission(client, { request: { kind: "v2", request: v2() }, decision: "once" })

  expect(calls).toEqual([
    {
      route: "legacy",
      input: { sessionID: "ses_legacy", permissionID: "per_v1", response: "reject" },
    },
    {
      route: "v2",
      input: { sessionID: "ses_custom", requestID: "per_v2", reply: "once" },
    },
  ])
})
