import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkArtifact } from "../src/session/artifact"

const validRecord = {
  id: "art_1",
  sessionID: "ses_123",
  kind: "document",
  title: "视频分镜脚本",
  mediaType: "text/markdown",
  relativePath: "视频分镜脚本.md",
  status: "available",
  createdAt: 1750000000000,
  updatedAt: 1750000000000,
} as const

describe("WorkArtifact.ArtifactRecord", () => {
  test("validates a valid record", () => {
    const r = Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)(validRecord)
    expect(r.id).toBe("art_1")
    expect(r.status).toBe("available")
    expect(r.kind).toBe("document")
  })

  test("rejects unknown kind", () => {
    expect(() => Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)({ ...validRecord, kind: "code" })).toThrow()
  })

  test("rejects unknown mediaType", () => {
    expect(() =>
      Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)({ ...validRecord, mediaType: "text/html" }),
    ).toThrow()
  })

  test("rejects unknown status", () => {
    expect(() => Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)({ ...validRecord, status: "pending" })).toThrow()
  })

  test("rejects missing sessionID", () => {
    const { sessionID: _sessionID, ...rest } = validRecord
    expect(() => Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)(rest)).toThrow()
  })

  test("work.artifact_applied event is defined with sessionID + artifactID data", () => {
    const payload = Schema.decodeUnknownSync(WorkArtifact.Event.ArtifactApplied.data)({
      sessionID: "ses_123",
      artifactID: "art_1",
    })
    expect(payload.artifactID).toBe("art_1")
    expect(WorkArtifact.Event.ArtifactApplied.type).toBe("work.artifact_applied")
  })
})

describe("WorkArtifact recoverable snapshot and errors", () => {
  const valid = { artifact: validRecord, revision: "a".repeat(64) }

  test("ArtifactSnapshot is a round-trippable Schema.Class without document bytes", () => {
    const snapshot = Schema.decodeUnknownSync(WorkArtifact.ArtifactSnapshot)(valid)
    expect(snapshot).toBeInstanceOf(WorkArtifact.ArtifactSnapshot)
    expect(Schema.encodeSync(WorkArtifact.ArtifactSnapshot)(snapshot)).toEqual(valid)
    expect(Object.keys(snapshot)).toEqual(["artifact", "revision"])
  })

  test("rejects absent or malformed content revision rather than filling a legacy default", () => {
    expect(() => Schema.decodeUnknownSync(WorkArtifact.ArtifactSnapshot)({ artifact: validRecord })).toThrow()
    expect(() => Schema.decodeUnknownSync(WorkArtifact.ArtifactSnapshot)({ ...valid, revision: "stale" })).toThrow()
  })

  test("every artifact failure exposes a readable message", () => {
    const sessionID = Schema.decodeUnknownSync(WorkArtifact.ArtifactRecord)(validRecord).sessionID
    const errors = [
      new WorkArtifact.PathValidationError({ relativePath: "../outside", reason: "Path escapes the Location" }),
      new WorkArtifact.ConflictError({ relativePath: "artifact.md" }),
      new WorkArtifact.NotFoundError({ sessionID, reason: "Session does not exist" }),
      new WorkArtifact.ScopeError({ sessionID, reason: "Session is outside this Location" }),
      new WorkArtifact.UnavailableError({ sessionID, reason: "Bound file is unavailable" }),
      new WorkArtifact.StorageError({ sessionID, phase: "bind", reason: "Reference could not be stored" }),
    ]
    expect(errors.every((error) => error.message.length > 0)).toBe(true)
  })
})
