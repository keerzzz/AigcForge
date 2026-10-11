import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ProjectV2 } from "@aigcfroge/core/project"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { WorkReviewUnavailableError } from "@aigcfroge/server/errors"
import { createAigcfrogeClient } from "@aigcfroge/sdk/v2/client"
import { MessageID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"

const info = {
  id: SessionID.descending(),
  mode: "coding" as const,
  slug: "test-session",
  projectID: ProjectV2.ID.global,
  workspaceID: undefined,
  directory: "/tmp/aigcfroge",
  parentID: undefined,
  summary: undefined,
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  share: undefined,
  title: "Test session",
  version: "1.0.0",
  time: {
    created: 1,
    updated: 2,
    compacting: undefined,
    archived: undefined,
  },
  permission: undefined,
  revert: undefined,
} satisfies Session.Info

describe("Session schema", () => {
  test("preserves the workReview omission contract through the HTTP JSON codec and generated SDK", async () => {
    // HttpApi's JSON response normalization uses this public schema codec.
    const encode = Schema.encodeUnknownSync(Schema.toCodecJson(Session.Info))
    const review = new WorkReview.Review({
      contractVersion: 1,
      state: "open",
      artifactID: "artifact-wire-review",
      artifactRevision: WorkflowAsset.Revision.make("a".repeat(64)),
      revision: 2,
      reopenedFrom: "resolved",
      updatedAt: 1_700_000_000_000,
    })
    const read = async (body: string) => {
      // Exercise the real generated parser without opening a socket or replacing global fetch.
      const sdk = createAigcfrogeClient({
        baseUrl: "http://work-review.invalid",
        throwOnError: true,
        fetch: async (request) => {
          expect(request.method).toBe("GET")
          expect(new URL(request.url).pathname).toBe(`/session/${info.id}`)
          return new Response(body, { headers: { "content-type": "application/json" } })
        },
      })
      const session = await sdk.session.get({ sessionID: info.id })
      expect(session.response.status).toBe(200)
      // The SDK maps an empty JSON response to {}; never let that pass as an absent review.
      if (!session.data || session.data.id !== info.id) throw new Error("GET session returned no matching body")
      return session.data
    }

    await expect(read("")).rejects.toThrow("GET session returned no matching body")
    await expect(read("{}")).rejects.toThrow("GET session returned no matching body")
    await Promise.all(
      [
        { session: info, expected: undefined },
        { session: { ...info, workReview: undefined }, expected: undefined },
        { session: { ...info, workReview: review }, expected: review },
      ].map(async (input) => {
        const body = JSON.stringify(encode(input.session))
        const session = await read(body)
        expect(session.workReview).toEqual(input.expected)
        expect(Object.hasOwn(session, "workReview")).toBe(input.expected !== undefined)
        expect(body.includes('"workReview"')).toBe(input.expected !== undefined)
      }),
    )
    expect(() => encode({ ...info, workReview: null })).toThrow()
  })

  test("encodes undefined optional session fields as omitted keys", () => {
    const encoded = Schema.encodeUnknownSync(Session.Info)(info) as Record<string, unknown>

    for (const key of ["workspaceID", "parentID", "summary", "share", "permission", "revert"]) {
      expect(Object.hasOwn(encoded, key)).toBe(false)
    }
    expect(Object.hasOwn(encoded.time as Record<string, unknown>, "compacting")).toBe(false)
    expect(Object.hasOwn(encoded.time as Record<string, unknown>, "archived")).toBe(false)
    expect(JSON.stringify(encoded)).not.toContain("parentID")
  })

  test("encodes undefined optional global session project fields as omitted keys", () => {
    const encoded = Schema.encodeUnknownSync(Session.GlobalInfo)({
      ...info,
      project: {
        id: ProjectV2.ID.global,
        name: undefined,
        worktree: "/tmp/aigcfroge",
      },
    }) as Record<string, unknown>

    expect(Object.hasOwn(encoded, "parentID")).toBe(false)
    expect(Object.hasOwn(encoded.project as Record<string, unknown>, "name")).toBe(false)
  })

  test("encodes nested undefined optional session fields as omitted keys", () => {
    const encoded = Schema.encodeUnknownSync(Session.Info)({
      ...info,
      summary: {
        additions: 1,
        deletions: 2,
        files: 3,
        diffs: undefined,
      },
      revert: {
        messageID: MessageID.ascending(),
        partID: undefined,
        snapshot: undefined,
        diff: undefined,
      },
    }) as Record<string, unknown>

    expect(Object.hasOwn(encoded.summary as Record<string, unknown>, "diffs")).toBe(false)
    for (const key of ["partID", "snapshot", "diff"]) {
      expect(Object.hasOwn(encoded.revert as Record<string, unknown>, key)).toBe(false)
    }
  })
})

test("WorkReview error JSON omits an unknown committed revision instead of reporting null", () => {
  const encode = Schema.encodeUnknownSync(Schema.toCodecJson(WorkReviewUnavailableError))
  expect(
    encode(
      new WorkReviewUnavailableError({ message: "Storage unavailable", code: "storage", committedRevision: undefined }),
    ),
  ).toEqual({ _tag: "WorkReviewUnavailableError", message: "Storage unavailable", code: "storage" })
  expect(
    encode(
      new WorkReviewUnavailableError({ message: "Notification failed", code: "notification", committedRevision: 2 }),
    ),
  ).toHaveProperty("committedRevision", 2)
})
