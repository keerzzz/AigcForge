import { describe, expect, test } from "bun:test"
import { WorkspaceV2 } from "@aigcfroge/core/workspace"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { locationRefForRoute } from "../../src/server/routes/instance/httpapi/middleware/workspace-routing"

describe("locationRefForRoute (S7 GREEN 4)", () => {
  test("keeps both directory and workspaceID in the full Location.Ref", () => {
    // route.directory may be URL-encoded (it comes from the
    // x-aigcfroge-directory header / directory query param in the
    // non-session case) — the helper decodes it.
    const ref = locationRefForRoute({
      directory: encodeURIComponent("/project/a b"),
      workspaceID: WorkspaceV2.ID.make("wrk_1"),
    })
    expect(ref.directory).toBe(AbsolutePath.make("/project/a b"))
    expect(ref.workspaceID).toBe(WorkspaceV2.ID.make("wrk_1"))
  })

  test("leaves workspaceID unset when the route has none", () => {
    const ref = locationRefForRoute({ directory: "/project" })
    expect(ref.directory).toBe(AbsolutePath.make("/project"))
    expect(ref.workspaceID).toBeUndefined()
  })
})
