import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkReview } from "../src/work-review"
import { WorkflowAsset } from "../src/workflow-asset"

const revision = WorkflowAsset.Revision.make("a".repeat(64))
const binding = { artifactID: "artifact-a", artifactRevision: revision }
const review = { contractVersion: 1, state: "open", ...binding, revision: 1, updatedAt: 1 }
const actions = ["submit", "request_changes", "approve", "re_review", "reopen"] as const
const command = {
  action: "submit",
  expectedReviewRevision: 0,
  artifactID: binding.artifactID,
  expectedArtifactRevision: revision,
} as const

describe("WorkReview canonical schema", () => {
  test("AI-TDD-S06-R13: Review retains required identity and concurrency revision", () => {
    expect(Schema.decodeUnknownSync(WorkReview.Review)(review)).toMatchObject(review)
  })

  test.each(["artifactID", "revision"])("AI-TDD-S06-R13: Review rejects legacy records without %s", (field) => {
    const legacy = Object.fromEntries(Object.entries(review).filter((entry) => entry[0] !== field))
    expect(Schema.decodeUnknownOption(WorkReview.Review)(legacy)._tag).toBe("None")
  })

  test.each([0, -1, 1.5, NaN, Infinity, "1", null, undefined])(
    "AI-TDD-S06-R13: Review rejects invalid concurrency revision %p",
    (value) => {
      expect(Schema.decodeUnknownOption(WorkReview.Review)({ ...review, revision: value })._tag).toBe("None")
    },
  )

  test.each(["", null, 1, undefined])("AI-TDD-S06-R13: Review rejects invalid artifact identity %p", (value) => {
    expect(Schema.decodeUnknownOption(WorkReview.Review)({ ...review, artifactID: value })._tag).toBe("None")
  })

  test("Review is a named Schema.Class and round-trips through JSON", () => {
    const decoded = Schema.decodeUnknownSync(WorkReview.Review)({ ...review, reopenedFrom: "resolved" })
    expect(decoded).toBeInstanceOf(WorkReview.Review)
    const codec = Schema.toCodecJson(WorkReview.Review)
    expect(Schema.decodeUnknownSync(codec)(Schema.encodeUnknownSync(codec)(decoded))).toEqual(decoded)
  })

  test("Binding is a named Schema.Class with the exact identity and content revision", () => {
    expect(new WorkReview.Binding(binding)).toMatchObject(binding)
    expect(Schema.decodeUnknownSync(WorkReview.Binding)(binding)).toBeInstanceOf(WorkReview.Binding)
    expect(Schema.decodeUnknownOption(WorkReview.Binding)({ ...binding, artifactID: "" })._tag).toBe("None")
    expect(Schema.decodeUnknownOption(WorkReview.Binding)({ artifactRevision: revision })._tag).toBe("None")
    expect(Schema.decodeUnknownOption(WorkReview.Binding)({ ...binding, artifactRevision: "invalid" })._tag).toBe(
      "None",
    )
  })

  test.each(["open", "fix_requested", "responded", "resolved"])("Review preserves the existing state %s", (state) => {
    expect(Schema.decodeUnknownSync(WorkReview.Review)({ ...review, state }).state).toBe(state)
  })

  test("Review does not add a fifth lifecycle state", () => {
    expect(Schema.decodeUnknownOption(WorkReview.Review)({ ...review, state: "reopened" })._tag).toBe("None")
  })
})

describe("WorkReview.Command", () => {
  test.each([...actions])("accepts the artifact action %s", (action) => {
    const decoded = Schema.decodeUnknownSync(WorkReview.Command)({ ...command, action })
    expect(decoded).toBeInstanceOf(WorkReview.ArtifactCommand)
    expect(decoded).toMatchObject({ ...command, action })
  })

  test("respond requires only action and expectedReviewRevision", () => {
    const decoded = Schema.decodeUnknownSync(WorkReview.Command)({ action: "respond", expectedReviewRevision: 2 })
    expect(decoded).toBeInstanceOf(WorkReview.RespondCommand)
    expect(decoded).toEqual(new WorkReview.RespondCommand({ action: "respond", expectedReviewRevision: 2 }))
  })

  test.each([0, 1, 42])("accepts nonnegative expectedReviewRevision %p", (expectedReviewRevision) => {
    expect(Schema.decodeUnknownSync(WorkReview.Command)({ ...command, expectedReviewRevision })).toMatchObject({
      expectedReviewRevision,
    })
    expect(Schema.decodeUnknownSync(WorkReview.Command)({ action: "respond", expectedReviewRevision })).toMatchObject({
      expectedReviewRevision,
    })
  })

  test.each([-1, 0.5, NaN, Infinity, "0", null, undefined])("rejects expectedReviewRevision %p", (value) => {
    expect(Schema.decodeUnknownOption(WorkReview.Command)({ ...command, expectedReviewRevision: value })._tag).toBe(
      "None",
    )
    expect(
      Schema.decodeUnknownOption(WorkReview.Command)({ action: "respond", expectedReviewRevision: value })._tag,
    ).toBe("None")
  })

  test.each(["action", "expectedReviewRevision", "artifactID", "expectedArtifactRevision"])(
    "artifact actions cannot omit %s",
    (field) => {
      const incomplete = Object.fromEntries(Object.entries(command).filter((entry) => entry[0] !== field))
      expect(Schema.decodeUnknownOption(WorkReview.Command)(incomplete)._tag).toBe("None")
    },
  )

  test.each(["", null, 1])("artifact actions reject artifactID %p", (artifactID) => {
    expect(Schema.decodeUnknownOption(WorkReview.Command)({ ...command, artifactID })._tag).toBe("None")
  })

  test.each(["a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), "", null, 1])(
    "artifact actions reuse WorkflowAsset.Revision validation for %p",
    (expectedArtifactRevision) => {
      expect(Schema.decodeUnknownOption(WorkReview.Command)({ ...command, expectedArtifactRevision })._tag).toBe("None")
    },
  )

  const forbidden = [
    ["state", "resolved"],
    ["nextState", "resolved"],
    ["owner", "forged-owner"],
    ["actor", "forged-actor"],
    ["timestamp", 123],
    ["updatedAt", 123],
    ["at", 123],
    ["metadata", { injected: true }],
    ["location", { directory: "forged" }],
    ["sessionID", "forged-session"],
    ["revision", 123],
    ["artifactRevision", revision],
    ["extra", true],
  ] as const

  test.each(["plain", "json"] as const)(
    "AI-TDD-S06-R02: %s Command decoding rejects every extra field for every action",
    (format) => {
      const schema = format === "json" ? Schema.toCodecJson(WorkReview.Command) : WorkReview.Command
      const decode = Schema.decodeUnknownOption(schema)
      forbidden.forEach((field) => {
        actions.forEach((action) => {
          expect(decode({ ...command, action, [field[0]]: field[1] })._tag).toBe("None")
        })
        expect(decode({ action: "respond", expectedReviewRevision: 1, [field[0]]: field[1] })._tag).toBe("None")
      })
      expect(decode({ action: "respond", expectedReviewRevision: 1, artifactID: binding.artifactID })._tag).toBe("None")
      expect(decode({ action: "respond", expectedReviewRevision: 1, expectedArtifactRevision: revision })._tag).toBe(
        "None",
      )
    },
  )

  test("AI-TDD-S06-R02: named command constructors enforce the same excess-property boundary", () => {
    const injectedArtifact = { ...command, state: "resolved" }
    const injectedRespond = { action: "respond", expectedReviewRevision: 1, actor: "forged" } as const
    expect(() => new WorkReview.ArtifactCommand(injectedArtifact)).toThrow()
    expect(() => new WorkReview.RespondCommand(injectedRespond)).toThrow()
  })

  test("rejects unsupported action names", () => {
    expect(Schema.decodeUnknownOption(WorkReview.Command)({ ...command, action: "resolve" })._tag).toBe("None")
  })

  test("all allowed commands survive the actual JSON codec", () => {
    const codec = Schema.toCodecJson(WorkReview.Command)
    actions.forEach((action) => {
      const input = { ...command, action }
      const decoded = Schema.decodeUnknownSync(codec)(input)
      expect(Schema.encodeUnknownSync(codec)(decoded)).toEqual(input)
    })
    const respond = { action: "respond", expectedReviewRevision: 1 }
    expect(Schema.encodeUnknownSync(codec)(Schema.decodeUnknownSync(codec)(respond))).toEqual(respond)
  })
})

describe("WorkReview.ReadResult", () => {
  test("none is a directly constructible named class, not an empty Review", () => {
    const none = new WorkReview.None({ status: "none" })
    expect(Schema.decodeUnknownSync(WorkReview.ReadResult)({ status: "none" })).toEqual(none)
    expect(none).toBeInstanceOf(WorkReview.None)
  })

  test.each([true, false])("ready preserves its canonical Review, Binding and current=%p", (current) => {
    const ready = new WorkReview.Ready({
      status: "ready",
      review: Schema.decodeUnknownSync(WorkReview.Review)(review),
      artifact: new WorkReview.Binding(binding),
      current,
    })
    const codec = Schema.toCodecJson(WorkReview.ReadResult)
    const decoded = Schema.decodeUnknownSync(codec)(Schema.encodeUnknownSync(codec)(ready))
    expect(decoded).toEqual(ready)
    expect(decoded).toBeInstanceOf(WorkReview.Ready)
    if (decoded.status !== "ready") throw new Error("Expected ready read result")
    expect(decoded.review).toBeInstanceOf(WorkReview.Review)
    expect(decoded.artifact).toBeInstanceOf(WorkReview.Binding)
  })

  test.each(["corrupt_review", "artifact_missing", "artifact_unavailable"] as const)(
    "unavailable reports %s with or without a valid Review",
    (reason) => {
      const unavailable = new WorkReview.Unavailable({ status: "unavailable", reason })
      expect(Schema.decodeUnknownSync(WorkReview.ReadResult)({ status: "unavailable", reason })).toEqual(unavailable)
      expect(unavailable).toBeInstanceOf(WorkReview.Unavailable)
      expect(Schema.decodeUnknownSync(WorkReview.ReadResult)({ status: "unavailable", reason, review })).toMatchObject({
        status: "unavailable",
        reason,
        review,
      })
    },
  )

  test("unavailable does not silently discard a corrupt optional Review", () => {
    const corrupt = { state: "open", artifactRevision: revision, updatedAt: 1, contractVersion: 1 }
    expect(
      Schema.decodeUnknownOption(WorkReview.ReadResult)({
        status: "unavailable",
        reason: "corrupt_review",
        review: corrupt,
      })._tag,
    ).toBe("None")
  })

  test("read availability is closed and ready requires an artifact and current flag", () => {
    const decode = Schema.decodeUnknownOption(WorkReview.ReadResult)
    expect(decode({ status: "unknown" })._tag).toBe("None")
    expect(decode({ status: "unavailable", reason: "forbidden" })._tag).toBe("None")
    expect(decode({ status: "ready", review, current: false })._tag).toBe("None")
    expect(decode({ status: "ready", review, artifact: binding })._tag).toBe("None")
  })
})
