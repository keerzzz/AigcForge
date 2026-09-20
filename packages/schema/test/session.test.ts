import { describe, expect, test } from "bun:test"
import { Session } from "@aigcfroge/schema/session"
import { DateTime, Schema } from "effect"
import { Agent } from "../src/agent"
import { Project } from "../src/project"
import { AbsolutePath } from "../src/schema"

describe("Session.Info JSON transport", () => {
  test("omits absent optional fields instead of serializing null", () => {
    const info = Session.Info.make({
      id: Session.ID.make("ses_transport_optional"),
      mode: "custom",
      presetCategoryId: undefined,
      slug: "transport-optional",
      version: "test",
      parentID: undefined,
      projectID: Project.ID.make("global"),
      agent: Agent.ID.make("meta"),
      model: undefined,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: {
        created: DateTime.makeUnsafe(1_700_000_000_000),
        updated: DateTime.makeUnsafe(1_700_000_000_000),
        archived: undefined,
      },
      title: "Transport optional",
      location: { directory: AbsolutePath.make("/tmp/transport-optional"), workspaceID: undefined },
      subpath: undefined,
      attended: undefined,
      permissionTier: "propose",
      revert: undefined,
      summary: undefined,
    })

    const encoded = Schema.encodeUnknownSync(Schema.toCodecJson(Session.Info))(info)
    expect(encoded).toEqual({
      id: "ses_transport_optional",
      mode: "custom",
      slug: "transport-optional",
      version: "test",
      projectID: Project.ID.make("global"),
      agent: Agent.ID.make("meta"),
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      title: "Transport optional",
      location: { directory: "/tmp/transport-optional" },
      permissionTier: "propose",
    })
  })
})
