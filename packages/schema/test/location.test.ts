import { describe, expect, test } from "bun:test"
import { Equal, Hash, Schema } from "effect"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { Workspace } from "../src/workspace"

const directory = AbsolutePath.make("/tmp/location-cache")
const implicit = () => [
  Location.Ref.make({ directory }),
  Location.Ref.make({ directory, workspaceID: undefined }),
  Schema.decodeUnknownSync(Location.Ref)({ directory }),
]

describe("Location.Ref cache identity", () => {
  test("normalizes omitted and explicit undefined workspace IDs across construction and decoding", () => {
    const canonical = Location.Ref.make({ directory, workspaceID: undefined })
    implicit().forEach((ref) => {
      expect(Equal.equals(ref, canonical)).toBe(true)
      expect(Hash.hash(ref)).toBe(Hash.hash(canonical))
    })
  })

  test("omits undefined workspace IDs from transport without changing cache identity on round-trip", () => {
    implicit().forEach((ref) => {
      const encoded = Schema.encodeSync(Location.Ref)(ref)
      expect(encoded).toEqual({ directory })
      expect(Object.hasOwn(encoded, "workspaceID")).toBe(false)
      expect(JSON.stringify(encoded)).toBe(JSON.stringify({ directory }))
      expect(Equal.equals(Schema.decodeUnknownSync(Location.Ref)(encoded), ref)).toBe(true)
    })
  })

  test("keeps explicit workspaces and different directories distinct", () => {
    const local = Location.Ref.make({ directory })
    const workspace = Location.Ref.make({ directory, workspaceID: Workspace.ID.make("wrk_one") })
    const otherWorkspace = Location.Ref.make({ directory, workspaceID: Workspace.ID.make("wrk_two") })
    const otherDirectory = Location.Ref.make({ directory: AbsolutePath.make("/tmp/location-other") })
    expect(Equal.equals(local, workspace)).toBe(false)
    expect(Equal.equals(workspace, otherWorkspace)).toBe(false)
    expect(Equal.equals(local, otherDirectory)).toBe(false)
    expect(Schema.encodeSync(Location.Ref)(workspace)).toEqual({ directory, workspaceID: workspace.workspaceID })
    expect(
      Equal.equals(Schema.decodeUnknownSync(Location.Ref)(Schema.encodeSync(Location.Ref)(workspace)), workspace),
    ).toBe(true)
  })
})
