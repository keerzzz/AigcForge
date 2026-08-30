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
}

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
