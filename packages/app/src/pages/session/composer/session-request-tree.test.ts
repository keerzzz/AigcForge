import { describe, expect, test } from "bun:test"
import type { PermissionRequest, QuestionV2Request, Session } from "@aigcfroge/sdk/v2/client"
import type { PermissionV2Pending } from "@/context/global-sync/permission-pending"
import { ServerConnection } from "@/context/server"
import { ScopedKey, ServerScope } from "@/utils/server-scope"
import {
  selectSessionRequest,
  sessionActiveRequest,
  sessionPendingRequests,
  sessionQuestionToolRequest,
} from "./session-request-tree"

const scope = ServerScope.local
const directory = "/projects/first"

const session = (input: { id: string; parentID?: string }): Session => ({
  id: input.id,
  slug: input.id,
  projectID: "project",
  directory,
  parentID: input.parentID,
  title: input.id,
  version: "test",
  time: { created: 0, updated: 0 },
})

const permission = (id: string, sessionID: string): PermissionRequest => ({
  id,
  sessionID,
  permission: "bash",
  patterns: [],
  metadata: {},
  always: [],
})

const permissionV2 = (id: string, sessionID: string): PermissionV2Pending => ({
  id,
  sessionID,
  action: "bash",
  resources: ["/tmp/run.sh"],
})

const question = (id: string, sessionID: string): QuestionV2Request => ({
  id,
  sessionID,
  questions: [],
})

describe("sessionActiveRequest (AI-TDD-S02-R01/R02)", () => {
  test("same session, both pending: permission wins the active slot, question stays discoverable", () => {
    const sessions = [session({ id: "root" })]
    const questions = { root: [question("q1", "root")] }
    const permissions = { root: [permissionV2("p1", "root")] }

    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: questions,
      legacyPermission: {},
      v2Permission: permissions,
    })

    expect(active?.domain).toBe("permission")
  })

  test("only a question pending: question is active", () => {
    const sessions = [session({ id: "root" })]
    const questions = { root: [question("q1", "root")] }

    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: questions,
      legacyPermission: {},
      v2Permission: {},
    })

    expect(active?.domain).toBe("question")
  })

  test("neither pending: no active request", () => {
    const sessions = [session({ id: "root" })]

    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: {},
      legacyPermission: {},
      v2Permission: {},
    })

    expect(active).toBeUndefined()
  })

  test("an existing active question is kept even once a permission also becomes pending (no preemption)", () => {
    const sessions = [session({ id: "root" })]
    const questions = { root: [question("q1", "root")] }
    const permissions = { root: [permissionV2("p1", "root")] }
    const previousActiveKey = ScopedKey.from(scope, directory, "root", "question", "q1")

    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: questions,
      legacyPermission: {},
      v2Permission: permissions,
      previousActiveKey,
    })

    expect(active?.domain).toBe("question")
  })

  test("after the previously active question resolves, selection falls through to the pending permission", () => {
    const sessions = [session({ id: "root" })]
    const permissions = { root: [permissionV2("p1", "root")] }
    const previousActiveKey = ScopedKey.from(scope, directory, "root", "question", "q1")

    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: {},
      legacyPermission: {},
      v2Permission: permissions,
      previousActiveKey,
    })

    expect(active?.domain).toBe("permission")
  })

  test("enumerates every pending request in parent/child and permission/question order", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const requests = sessionPendingRequests({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: {
        root: [question("root-question", "root")],
        child: [question("child-question", "child")],
      },
      legacyPermission: {},
      v2Permission: {
        root: [permissionV2("root-permission", "root")],
        child: [permissionV2("child-permission", "child")],
      },
    })

    expect(
      requests.map((request) => [
        request.domain,
        request.ownerSessionID,
        request.domain === "permission" ? request.request.request.id : request.request.id,
      ]),
    ).toEqual([
      ["permission", "root", "root-permission"],
      ["question", "root", "root-question"],
      ["permission", "child", "child-permission"],
      ["question", "child", "child-question"],
    ])
  })

  test("manual selection uses the full request key and rejects a stale key deterministically", () => {
    const requests = sessionPendingRequests({
      scope,
      directory,
      session: [session({ id: "root" })],
      sessionID: "root",
      question: { root: [question("first", "root"), question("second", "root")] },
      legacyPermission: {},
      v2Permission: {},
    })

    expect(selectSessionRequest(requests, { selectedKey: requests[1]?.key })?.request).toBe(requests[1]?.request)

    const staleKey = ScopedKey.from(scope, directory, "other", "question", "missing")
    expect(selectSessionRequest(requests, { selectedKey: staleKey })?.request).toBe(requests[0]?.request)
  })

  test("manual selection falls back to the first current request when the selected request is removed", () => {
    const first = question("first", "root")
    const second = question("second", "root")
    const before = sessionPendingRequests({
      scope,
      directory,
      session: [session({ id: "root" })],
      sessionID: "root",
      question: { root: [first, second] },
      legacyPermission: {},
      v2Permission: {},
    })
    const after = sessionPendingRequests({
      scope,
      directory,
      session: [session({ id: "root" })],
      sessionID: "root",
      question: { root: [first] },
      legacyPermission: {},
      v2Permission: {},
    })

    expect(
      selectSessionRequest(after, { selectedKey: before[1]?.key, previousActiveKey: before[1]?.key })?.request,
    ).toBe(first)
  })

  test("keeps typed owner identity for same request IDs in sibling sessions", () => {
    const requests = sessionPendingRequests({
      scope,
      directory,
      session: [session({ id: "root" }), session({ id: "child", parentID: "root" })],
      sessionID: "root",
      question: { root: [question("same", "root")], child: [question("same", "child")] },
      legacyPermission: {},
      v2Permission: {},
    })

    expect(requests.map((request) => request.ownerSessionID)).toEqual(["root", "child"])
    expect(new Set(requests.map((request) => request.key)).size).toBe(2)
  })

  test("a different session's identical requestID string does not match a stale activeKey (no owner confusion)", () => {
    const sessions = [session({ id: "root" }), session({ id: "other" })]
    const questions = { other: [question("q1", "other")] }
    const permissions = { root: [permissionV2("p1", "root")] }
    const previousActiveKey = ScopedKey.from(scope, directory, "root", "question", "q1")

    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: questions,
      legacyPermission: {},
      v2Permission: permissions,
      previousActiveKey,
    })

    expect(active?.domain).toBe("permission")
  })

  test("child session pending items are discoverable from the parent tree", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const questions = { child: [question("q1", "child")] }

    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: questions,
      legacyPermission: {},
      v2Permission: {},
    })

    expect(active?.domain).toBe("question")
    if (active?.domain === "question") expect(active.request.sessionID).toBe("child")
  })

  test("active key includes scope, location, session, domain, runtime kind, and request", () => {
    const sessions = [session({ id: "root" })]
    const permissions = { root: [permissionV2("p1", "root")] }

    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: {},
      legacyPermission: {},
      v2Permission: permissions,
    })

    expect(active?.key).toBe(ScopedKey.from(scope, directory, "root", "permission", "v2", "p1"))
  })

  test("a legacy permission (no V2 pending) is picked just like a V2 one", () => {
    const sessions = [session({ id: "root" })]
    const legacy = { root: [permission("perm_legacy", "root")] }

    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: {},
      legacyPermission: legacy,
      v2Permission: {},
    })

    expect(active?.domain).toBe("permission")
    if (active?.domain === "permission") expect(active.request.kind).toBe("legacy")
  })

  test("a question and a permission with the IDENTICAL requestID string get distinct activeKeys (R03)", () => {
    const sessions = [session({ id: "root" })]
    const questions = { root: [question("shared_id", "root")] }
    const permissions = { root: [permissionV2("shared_id", "root")] }

    const permissionActive = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: questions,
      legacyPermission: {},
      v2Permission: permissions,
    })
    expect(permissionActive?.key).toBe(ScopedKey.from(scope, directory, "root", "permission", "v2", "shared_id"))

    const questionSticky = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "root",
      question: questions,
      legacyPermission: {},
      v2Permission: permissions,
      previousActiveKey: ScopedKey.from(scope, directory, "root", "question", "shared_id"),
    })
    expect(questionSticky?.domain).toBe("question")
    expect(questionSticky?.key).toBe(ScopedKey.from(scope, directory, "root", "question", "shared_id"))
    expect(questionSticky?.key).not.toBe(permissionActive?.key)
  })

  test("switching sessions never carries a stale previousActiveKey into the new session's selection (R03)", () => {
    const sessions = [session({ id: "ses_a" }), session({ id: "ses_b" })]
    const questionsA = { ses_a: [question("q1", "ses_a")] }
    const questionsB = { ses_b: [question("q1", "ses_b")] }
    const permissionsB = { ses_b: [permissionV2("q1", "ses_b")] }
    const staleKeyFromSessionA = ScopedKey.from(scope, directory, "ses_a", "question", "q1")

    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      sessionID: "ses_b",
      question: { ...questionsA, ...questionsB },
      legacyPermission: {},
      v2Permission: permissionsB,
      previousActiveKey: staleKeyFromSessionA,
    })

    expect(active?.domain).toBe("permission")
    expect(active?.key).toBe(ScopedKey.from(scope, directory, "ses_b", "permission", "v2", "q1"))
  })
})

describe("AI-TDD-S02 complete-tree selection and scoped identity", () => {
  const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
  const input = {
    session: sessions,
    sessionID: "root",
    scope,
    directory,
    question: {},
    legacyPermission: {},
    v2Permission: {},
  }

  test("R02: a parent question precedes a child's permission", () => {
    const active = sessionActiveRequest({
      ...input,
      question: { root: [question("parent-question", "root")] },
      v2Permission: { child: [permissionV2("child-permission", "child")] },
    })
    expect(active?.domain).toBe("question")
    expect(active?.request).toMatchObject({ id: "parent-question" })
  })

  test("R02: permission precedes question at the same tree depth", () => {
    const active = sessionActiveRequest({
      ...input,
      session: [...sessions, session({ id: "sibling", parentID: "root" })],
      question: { child: [question("child-question", "child")] },
      v2Permission: { sibling: [permissionV2("sibling-permission", "sibling")] },
    })
    expect(active?.domain).toBe("permission")
    if (active?.domain === "permission") expect(active.request.request.sessionID).toBe("sibling")
  })

  test("R02: an active question survives an earlier sorted arrival in the same domain", () => {
    const current = question("q-z", "root")
    const previous = sessionActiveRequest({ ...input, question: { root: [current] } })
    const active = sessionActiveRequest({
      ...input,
      question: { root: [question("q-a", "root"), current] },
      previousActiveKey: previous?.key,
    })
    expect(active?.request).toBe(current)
  })

  test("R02: an active child question is not preempted by a new parent question", () => {
    const current = question("child-question", "child")
    const previous = sessionActiveRequest({ ...input, question: { child: [current] } })
    const active = sessionActiveRequest({
      ...input,
      question: { root: [question("new-parent-question", "root")], child: [current] },
      previousActiveKey: previous?.key,
    })
    expect(active?.request).toBe(current)
  })

  test("R02: an active legacy permission survives a later V2 arrival", () => {
    const current = permission("legacy-permission", "root")
    const previous = sessionActiveRequest({ ...input, legacyPermission: { root: [current] } })
    const active = sessionActiveRequest({
      ...input,
      legacyPermission: { root: [current] },
      v2Permission: { root: [permissionV2("v2-permission", "root")] },
      previousActiveKey: previous?.key,
    })
    expect(active?.request).toEqual({ kind: "legacy", request: current })
  })

  test("R03: a different Location cannot inherit an old active key", () => {
    const current = question("shared", "root")
    const previous = sessionActiveRequest({ ...input, question: { root: [current] } })
    const next = { ...input, directory: "/projects/second" }
    const active = sessionActiveRequest({
      ...next,
      question: { root: [current] },
      v2Permission: { root: [permissionV2("permission", "root")] },
      previousActiveKey: previous?.key,
    })
    expect(active?.domain).toBe("permission")
    expect(sessionActiveRequest({ ...next, question: { root: [current] } })?.key).not.toBe(previous?.key)
  })

  test("R03: current runtime owners cannot share a permission identity", () => {
    const legacy = sessionActiveRequest({ ...input, legacyPermission: { root: [permission("shared", "root")] } })
    const v2 = sessionActiveRequest({ ...input, v2Permission: { root: [permissionV2("shared", "root")] } })
    expect(legacy?.key).not.toBe(v2?.key)
  })
})

describe("sessionActiveRequest edge cases", () => {
  const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
  const input = {
    session: sessions,
    sessionID: "root",
    scope,
    directory,
    question: {},
    legacyPermission: {},
    v2Permission: {},
  }

  test("returns undefined when sessionID is missing", () => {
    const active = sessionActiveRequest({
      scope,
      directory,
      session: sessions,
      question: { root: [question("question", "root")] },
      legacyPermission: {},
      v2Permission: { root: [permissionV2("permission", "root")] },
    })

    expect(active).toBeUndefined()
  })

  test("returns undefined for empty and unrelated trees", () => {
    const empty = sessionActiveRequest({
      ...input,
      session: [],
      question: { other: [question("unrelated-question", "other")] },
      v2Permission: { other: [permissionV2("unrelated-permission", "other")] },
    })
    const unrelated = sessionActiveRequest({
      ...input,
      session: [session({ id: "other" }), session({ id: "leaf", parentID: "other" })],
      question: { other: [question("question", "other")] },
      v2Permission: { leaf: [permissionV2("permission", "leaf")] },
    })

    expect(empty).toBeUndefined()
    expect(unrelated).toBeUndefined()
  })

  test("cyclic parent links terminate and visit each session once", () => {
    const rootPermission = permission("root-permission", "root")
    let legacyFilterCalls = 0

    const active = sessionActiveRequest({
      scope,
      directory,
      session: [session({ id: "root", parentID: "child" }), session({ id: "child", parentID: "root" })],
      sessionID: "root",
      question: {},
      legacyPermission: { root: [rootPermission] },
      v2Permission: {},
      includeLegacyPermission: () => {
        legacyFilterCalls += 1
        return true
      },
    })

    expect(active?.request).toEqual({ kind: "legacy", request: rootPermission })
    expect(legacyFilterCalls).toBe(1)
  })

  test("preserves stored order within a domain", () => {
    const firstQuestion = question("first-question", "root")
    const secondQuestion = question("second-question", "root")
    const firstPermission = permissionV2("first-permission", "root")
    const secondPermission = permissionV2("second-permission", "root")

    const questionActive = sessionActiveRequest({
      ...input,
      question: { root: [firstQuestion, secondQuestion] },
    })
    const permissionActive = sessionActiveRequest({
      ...input,
      v2Permission: { root: [firstPermission, secondPermission] },
    })

    expect(questionActive?.request).toBe(firstQuestion)
    expect(permissionActive?.request).toEqual({ kind: "v2", request: firstPermission })
  })

  test("filters auto-response legacy requests and drops a stale filtered active", () => {
    const filtered = permission("auto-response", "root")
    const next = permission("visible", "child")
    const previous = sessionActiveRequest({
      ...input,
      legacyPermission: { root: [filtered] },
    })

    const active = sessionActiveRequest({
      ...input,
      legacyPermission: { root: [filtered], child: [next] },
      includeLegacyPermission: (item) => item.id !== filtered.id,
      previousActiveKey: previous?.key,
    })

    expect(previous?.request).toEqual({ kind: "legacy", request: filtered })
    expect(active?.request).toEqual({ kind: "legacy", request: next })
  })

  test("does not reuse an active key after a server scope change", () => {
    const remoteScope = ServerScope.fromServerKey(ServerConnection.Key.make("https://remote.example"))
    const current = question("shared", "root")
    const previous = sessionActiveRequest({
      ...input,
      question: { root: [current] },
    })

    const active = sessionActiveRequest({
      ...input,
      scope: remoteScope,
      question: { root: [current] },
      v2Permission: { root: [permissionV2("permission", "root")] },
      previousActiveKey: previous?.key,
    })

    expect(active?.domain).toBe("permission")
    expect(active?.key).toBe(ScopedKey.from(remoteScope, directory, "root", "permission", "v2", "permission"))
  })

  test("a completed or removed active request falls through to the next stored request", () => {
    const first = question("first", "root")
    const second = question("second", "root")
    const previous = sessionActiveRequest({
      ...input,
      question: { root: [first, second] },
    })

    const active = sessionActiveRequest({
      ...input,
      question: { root: [second] },
      previousActiveKey: previous?.key,
    })

    expect(active?.request).toBe(second)
  })
})

describe("sessionQuestionToolRequest (AI-TDD-S05-R05)", () => {
  const part = { sessionID: "root", messageID: "message", callID: "call" }
  const pending = { ...question("question", "root"), tool: { messageID: "message", callID: "call" } }
  const requests = (items: QuestionV2Request[]) =>
    sessionPendingRequests({
      scope,
      directory,
      session: [session({ id: "root" }), session({ id: "child", parentID: "root" })],
      sessionID: "root",
      question: {
        root: items.filter((item) => item.sessionID === "root"),
        child: items.filter((item) => item.sessionID === "child"),
      },
      legacyPermission: {},
      v2Permission: { root: [permissionV2("question", "root")] },
    })

  test("selects the one exact tool owner and ignores a same-ID permission", () => {
    expect(sessionQuestionToolRequest(requests([pending]), part)?.key).toBe(
      ScopedKey.from(scope, directory, "root", "question", "question"),
    )
  })

  test.each([
    { name: "another session", request: { ...pending, sessionID: "child" } },
    { name: "another message", request: { ...pending, tool: { messageID: "other", callID: "call" } } },
    { name: "another call", request: { ...pending, tool: { messageID: "message", callID: "other" } } },
    { name: "no tool identity", request: { ...pending, tool: undefined } },
  ])("does not select $name", ({ request }) => {
    expect(sessionQuestionToolRequest(requests([request]), part)).toBeUndefined()
  })

  test("does not guess when two pending requests claim one tool call", () => {
    expect(sessionQuestionToolRequest(requests([pending, { ...pending, id: "other" }]), part)).toBeUndefined()
  })

  test("a resolved request immediately loses its locate action", () => {
    expect(sessionQuestionToolRequest(requests([]), part)).toBeUndefined()
  })

  test("a child tool can locate its own request from the existing parent tree", () => {
    const child = { ...pending, sessionID: "child" }
    expect(sessionQuestionToolRequest(requests([child]), { ...part, sessionID: "child" })?.key).toBe(
      ScopedKey.from(scope, directory, "child", "question", "question"),
    )
  })
})
