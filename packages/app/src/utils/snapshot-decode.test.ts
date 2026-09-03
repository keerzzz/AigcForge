import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { decodeSnapshotResponse } from "./snapshot-decode"
import realResponse from "./snapshot-response.fixture.json"

/**
 * The fixture is a real server response, captured by the 2026-09-03 dogfood run for a
 * custom session created without a profile (`docs/review/five-mode-dogfood-2026-09-03/`;
 * only the absolute placement paths were replaced with `/tmp/custom-fixture`). It is kept
 * verbatim rather than hand-written on purpose: the first attempt at a hand-written
 * payload passed the decoder for the wrong reason — it was missing `tools.catalog` and
 * `tools.catalogDigest`, so it failed to decode whichever codec was used, which would have
 * hidden the actual bug.
 *
 * The two `null`s are the point: that is what the HttpApi JSON codec emits for absent
 * optional fields.
 */
describe("decodeSnapshotResponse", () => {
  test("decodes a real snapshot whose absent profile fields serialised as null", () => {
    const snapshot = decodeSnapshotResponse(realResponse)

    expect(snapshot).toBeDefined()
    expect(String(snapshot?.digest)).toBe(realResponse.digest)
    // Narrowed rather than cast: the V1 branch is the one that carries `data.agentID`,
    // so asserting through it also pins that this payload decoded as V1 and not V2.
    if (snapshot?.version !== 1) throw new Error(`expected a V1 snapshot, got version ${snapshot?.version}`)
    expect(snapshot.data.agentID).toBe("qa-reviewer")
  })

  test("the class schema on its own rejects that same payload", () => {
    // The regression this file exists for: both call sites used
    // `decodeUnknownOption(Snapshot)`, which declares the profile fields
    // `Schema.optional` (string | undefined) and so refuses null. Pinning it means a
    // future "simplification" back to the class schema fails here instead of silently
    // making every profile-less snapshot undecodable again.
    const wire: unknown = realResponse
    expect(Schema.decodeUnknownOption(Composition.Snapshot)(wire)._tag).toBe("None")
  })

  test("unwraps a snapshot nested under a `snapshot` key", () => {
    expect(String(decodeSnapshotResponse({ snapshot: realResponse })?.digest)).toBe(realResponse.digest)
  })

  test("returns undefined for a body that is not a snapshot", () => {
    expect(decodeSnapshotResponse({ error: "nope" })).toBeUndefined()
    expect(decodeSnapshotResponse(null)).toBeUndefined()
    expect(decodeSnapshotResponse("string")).toBeUndefined()
  })
})
