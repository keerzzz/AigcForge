import { describe, expect, test } from "bun:test"
import type { Event, PermissionRequest, Session } from "@aigcfroge/sdk/v2/client"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { autoRespondableAsk, autoRespondsPermission, isDirectoryAutoAccepting } from "./permission-auto-respond"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as Session

const permission = (sessionID: string) =>
  ({
    sessionID,
  }) as Pick<PermissionRequest, "sessionID">

describe("autoRespondsPermission", () => {
  test("uses a parent session's directory-scoped auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("uses a parent session's legacy auto-accept key", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]

    expect(autoRespondsPermission({ root: true }, sessions, permission("child"), "/tmp/project")).toBe(true)
  })

  test("defaults to requiring approval when no lineage override exists", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" }), session({ id: "other" })]
    const autoAccept = {
      other: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), "/tmp/project")).toBe(false)
  })

  test("inherits a parent session's false override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(false)
  })

  test("prefers a child override over parent override", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/root`]: false,
      [`${base64Encode(directory)}/child`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("child"), directory)).toBe(true)
  })

  test("falls back to directory-level auto-accept", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), directory)).toBe(true)
  })

  test("session-level override takes precedence over directory-level", () => {
    const directory = "/tmp/project"
    const sessions = [session({ id: "root" })]
    const autoAccept = {
      [`${base64Encode(directory)}/*`]: true,
      [`${base64Encode(directory)}/root`]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, permission("root"), directory)).toBe(false)
  })
})

describe("isDirectoryAutoAccepting", () => {
  test("returns true when directory key is set", () => {
    const directory = "/tmp/project"
    const autoAccept = { [`${base64Encode(directory)}/*`]: true }
    expect(isDirectoryAutoAccepting(autoAccept, directory)).toBe(true)
  })

  test("returns false when directory key is not set", () => {
    expect(isDirectoryAutoAccepting({}, "/tmp/project")).toBe(false)
  })

  test("returns false when directory key is explicitly false", () => {
    const directory = "/tmp/project"
    const autoAccept = { [`${base64Encode(directory)}/*`]: false }
    expect(isDirectoryAutoAccepting(autoAccept, directory)).toBe(false)
  })
})

/**
 * `satisfies Event` is load-bearing: it is what makes these fixtures real union
 * members rather than hand-shaped objects, so a wire-shape change in the
 * generated SDK breaks this file instead of leaving it asserting a shape the
 * server no longer sends.
 */
const v1Asked = {
  id: "evt_v1",
  type: "permission.asked",
  properties: {
    id: "per_v1",
    sessionID: "ses_1",
    permission: "bash",
    patterns: ["rm -rf *"],
    metadata: {},
    always: ["bash"],
  },
} satisfies Event

const v2Asked = {
  id: "evt_v2",
  type: "permission.v2.asked",
  properties: {
    id: "per_v2",
    sessionID: "ses_1",
    action: "bash",
    resources: ["rm -rf *"],
  },
} satisfies Event

describe("autoRespondableAsk", () => {
  test("returns the request for a V1 ask", () => {
    // Companion to the V2 case below: without this, a guard that returned
    // `undefined` unconditionally would satisfy every other assertion here and
    // silently disable auto-accept instead of scoping it.
    const request: PermissionRequest | undefined = autoRespondableAsk(v1Asked)
    expect(request?.id).toBe("per_v1")
    expect(request?.sessionID).toBe("ses_1")
  })

  test("refuses a V2 ask so the browser store can never answer a scoped-grant prompt", () => {
    // The security case. Both asks reach this callback as `{type, properties}`
    // because the instance event route renames `data` to `properties`, so the
    // event type is the whole boundary — and MCP/custom approvals are V2-only.
    expect(autoRespondableAsk(v2Asked)).toBeUndefined()
  })

  test("refuses an unrelated event and a missing one", () => {
    expect(autoRespondableAsk({ id: "evt_x", type: "server.connected", properties: {} } satisfies Event)).toBeUndefined()
    expect(autoRespondableAsk(undefined)).toBeUndefined()
  })
})
