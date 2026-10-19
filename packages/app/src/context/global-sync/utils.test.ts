import { describe, expect, test } from "bun:test"
import type { Agent, ProductMode, Session } from "@aigcfroge/sdk/v2/client"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { directoryKey, filterAgentList, mergeSessionReview, normalizeAgentList } from "./utils"

const agent = (name = "build"): Agent => ({
  name,
  mode: "primary",
  permission: [],
  options: {},
  primaryModes: [],
})

describe("normalizeAgentList", () => {
  test("keeps array payloads", () => {
    expect(normalizeAgentList([agent("build"), agent("docs")])).toEqual([agent("build"), agent("docs")])
  })

  test("wraps a single agent payload", () => {
    expect(normalizeAgentList(agent("docs"))).toEqual([agent("docs")])
  })

  test("extracts agents from keyed objects", () => {
    expect(
      normalizeAgentList({
        build: agent("build"),
        docs: agent("docs"),
      }),
    ).toEqual([agent("build"), agent("docs")])
  })

  test("drops invalid payloads", () => {
    expect(normalizeAgentList({ name: "AbortError" })).toEqual([])
    expect(normalizeAgentList([{ name: "build" }, agent("docs")])).toEqual([agent("docs")])
  })

  test("preserves handoffs field", () => {
    const agentWithHandoffs = {
      ...agent("build"),
      handoffs: [{ label: "Ask docs", agent: "docs", prompt: "Review this" }],
    } as Agent
    const result = normalizeAgentList([agentWithHandoffs])
    expect(result).toHaveLength(1)
    expect(result[0]?.handoffs).toEqual([{ label: "Ask docs", agent: "docs", prompt: "Review this" }])
  })
})

describe("filterAgentList", () => {
  const mode: ProductMode = "coding"
  const primary = { ...agent("build"), primaryModes: [mode] } satisfies Agent
  const asset = { ...agent("custom"), primaryModes: [mode], originRelativePath: "custom.md" } satisfies Agent

  test("includes asset-backed agents only when the setting permits them", () => {
    expect(filterAgentList([primary, asset], mode, true).map((item) => item.name)).toEqual(["build", "custom"])
    expect(filterAgentList([primary, asset], mode, false).map((item) => item.name)).toEqual(["build"])
  })

  test("keeps an agent whose provenance is unknown, without guessing it is official", () => {
    expect(filterAgentList([primary], mode, false).map((item) => item.name)).toEqual(["build"])
  })
})

describe("directoryKey", () => {
  test("normalizes slashes", () => {
    expect(String(directoryKey("C:\\Repos\\sst\\aigcfroge"))).toBe("C:/Repos/sst/aigcfroge")
    expect(String(directoryKey("C:/Repos/sst/aigcfroge"))).toBe("C:/Repos/sst/aigcfroge")
  })

  test("preserves backslashes in posix paths", () => {
    expect(String(directoryKey("/tmp/foo\\bar"))).toBe("/tmp/foo\\bar")
  })

  test("trims trailing slashes without breaking roots", () => {
    expect(String(directoryKey("C:/Repos/sst/aigcfroge/"))).toBe("C:/Repos/sst/aigcfroge")
    expect(String(directoryKey("C:/"))).toBe("C:/")
    expect(String(directoryKey("/"))).toBe("/")
  })
})

describe("AI-TDD-S04-R01 primary visibility owner", () => {
  test("keeps primary mode authorization separate from subagent eligibility", () => {
    const candidates = [
      { ...agent("build"), primaryModes: ["coding"] },
      { ...agent("reviewer"), mode: "subagent", primaryModes: ["coding"] },
      { ...agent("work-orchestrator"), primaryModes: ["work"] },
      { ...agent("hidden"), hidden: true, primaryModes: ["coding"] },
      { ...agent("unclassified"), primaryModes: [] },
    ] satisfies Agent[]

    expect(filterAgentList(candidates, "coding", true).map((item) => item.name)).toEqual(["build"])
  })

  test("uses provenance rather than names or native transport as the visibility rule", () => {
    const candidates = [
      { ...agent("custom-looking-name"), primaryModes: ["coding"] },
      {
        ...agent("official-looking-name"),
        primaryModes: ["coding"],
        source: "native",
        originRelativePath: "agents/official-looking-name.md",
      },
      { ...agent("hidden-asset"), primaryModes: ["coding"], hidden: true, originRelativePath: "hidden.md" },
    ] satisfies Agent[]

    expect(filterAgentList(candidates, "coding", false).map((item) => item.name)).toEqual(["custom-looking-name"])
    expect(filterAgentList(candidates, "coding", true).map((item) => item.name)).toEqual([
      "custom-looking-name",
      "official-looking-name",
    ])
  })

  test("does not advertise a primary mode when the server omitted its primaryModes projection", () => {
    const candidates = normalizeAgentList([{ name: "reviewer", mode: "all", permission: [], options: {} }])
    expect(candidates).toHaveLength(1)
    expect(filterAgentList(candidates, "coding", true)).toEqual([])
  })
})

describe("AI-TDD-S04-R06 visibility preference is not primary-mode authorization", () => {
  test.each(["chat", "coding", "work", "assistant", "custom"] as const)(
    "showing asset-backed agents cannot grant missing server eligibility in %s mode",
    (mode) => {
      const candidates = [
        { ...agent("meta"), primaryModes: [mode] },
        { ...agent("forbidden-asset"), primaryModes: [], originRelativePath: "agents/forbidden.md" },
      ] satisfies Agent[]

      expect(filterAgentList(candidates, mode, false).map((item) => item.name)).toEqual(["meta"])
      expect(filterAgentList(candidates, mode, true).map((item) => item.name)).toEqual(["meta"])
    },
  )
})

const review = (revision: number, state: WorkReview.State = "open") =>
  new WorkReview.Review({
    contractVersion: 1,
    artifactID: "artifact-a",
    artifactRevision: WorkflowAsset.Revision.make("a".repeat(64)),
    state,
    revision,
    updatedAt: 10,
  })

const reviewSession = (id: string, workReview?: WorkReview.Review) =>
  ({
    id,
    slug: id,
    projectID: "project",
    directory: "/project",
    title: id,
    version: "1",
    mode: "work",
    time: { created: 1, updated: 1 },
    workReview,
  }) satisfies Session

describe("AI-TDD-S06-R11/R12 shared WorkReview merge", () => {
  test("R11: decodes canonical plain JSON, not only a Schema.Class instance", () => {
    const wire = { ...review(2) }
    expect(Object.getPrototypeOf(wire)).toBe(Object.prototype)
    expect(mergeSessionReview(undefined, reviewSession("ses_a", wire)).workReview).toEqual(wire)
  })

  test("R12: a higher revision wins even when its timestamp is lower", () => {
    const current = reviewSession("ses_a", { ...review(2), updatedAt: 999 })
    const incoming = reviewSession("ses_a", { ...review(3), updatedAt: 1 })
    expect(mergeSessionReview(current, incoming).workReview).toEqual(incoming.workReview)
    expect(current.workReview).toEqual({ ...review(2), updatedAt: 999 })
  })

  test.each(["older", "equal", "missing", "invalid"] as const)(
    "R12: %s snapshot preserves the accepted review but updates unrelated Session fields",
    (kind) => {
      const accepted = { ...review(5, "resolved") }
      // Corrupt only the wire input to the merge boundary, not the typed Session fixture.
      const incoming = {
        ...reviewSession("ses_a"),
        workReview:
          kind === "missing"
            ? undefined
            : {
                ...review(kind === "equal" ? 5 : kind === "invalid" ? 9 : 2),
                artifactID: kind === "invalid" ? "" : "artifact-b",
              },
        title: "server title",
        time: { created: 1, updated: 90 },
      }
      expect(mergeSessionReview(reviewSession("ses_a", accepted), incoming)).toMatchObject({
        workReview: accepted,
        title: "server title",
        time: { updated: 90 },
      })
    },
  )

  test("R12: a review from another Session cannot leak into a new Session snapshot", () => {
    expect(mergeSessionReview(reviewSession("ses_a", review(9)), reviewSession("ses_b")).workReview).toBeUndefined()
    const incoming = reviewSession("ses_b", review(1))
    expect(mergeSessionReview(reviewSession("ses_a", review(9)), incoming).workReview).toEqual(incoming.workReview)
  })

  test("R12: an invalid cached review cannot suppress a lower valid revision", () => {
    const incoming = reviewSession("ses_a", review(2))
    // An invalid cached payload belongs at the untrusted merge input, never in Store<State>.
    expect(
      mergeSessionReview({ ...reviewSession("ses_a"), workReview: { ...review(99), artifactID: "" } }, incoming)
        .workReview,
    ).toEqual(incoming.workReview)
  })

  test.each(["artifactID", "revision"] as const)("R11: missing %s is not repaired as an old format", (field) => {
    // Strip required wire fields after Schema construction so the negative case reaches the decoder.
    const incoming = { ...reviewSession("ses_a"), workReview: { ...review(2), [field]: undefined } }
    expect(mergeSessionReview(undefined, incoming)).toMatchObject({ id: "ses_a", workReview: undefined })
  })

  test("R11: metadata-only and ad-hoc snapshots do not manufacture a Review", () => {
    const incoming = { ...reviewSession("ses_a"), mode: "coding" as const, metadata: { workReview: review(7) } }
    expect(mergeSessionReview(undefined, incoming)).toMatchObject({
      id: "ses_a",
      mode: "coding",
      metadata: incoming.metadata,
      workReview: undefined,
    })
  })
})
