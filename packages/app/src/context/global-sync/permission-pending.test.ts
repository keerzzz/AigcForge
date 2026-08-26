import { describe, expect, test } from "bun:test"
import type { PermissionRequest } from "@aigcfroge/sdk/v2/client"
import {
  permissionPendingFromLegacy,
  permissionPendingFromV2,
  permissionReplyFromV2,
  permissionReply,
  permissionPresentation,
  replyPermission,
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
    expect(permissionReplyFromV2({ sessionID: "ses_custom", requestID: "per_v2", reply: "allow_everything" })).toBeUndefined()
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
        },
      },
    },
  }

  await replyPermission(client, permissionPendingFromLegacy(legacy()), "reject")
  await replyPermission(client, { kind: "v2", request: v2() }, "once")

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
