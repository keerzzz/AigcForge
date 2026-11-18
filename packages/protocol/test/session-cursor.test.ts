import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionsCursor } from "../src/groups/session.js"
import { Session } from "@aigcfroge/schema/session"
import { Project } from "@aigcfroge/schema/project"
import { AbsolutePath, RelativePath } from "@aigcfroge/schema/schema"

describe("SessionsCursor", () => {
  test("round trips without Node globals", async () => {
    const input = {
      workspace: undefined,
      search: "protocol",
      order: "desc" as const,
      anchor: { id: Session.ID.make("ses_test"), time: 1, direction: "next" as const },
    }
    const cursor = SessionsCursor.make(input)

    expect(await Effect.runPromise(SessionsCursor.parse(cursor))).toEqual(input)
  })

  test("round trips mode in directory, project, and all-session cursors", async () => {
    const inputs = [
      {
        mode: "chat",
        order: "desc",
        search: "all sessions",
        anchor: { id: Session.ID.make("ses_mode_all"), time: 1, direction: "next" },
      },
      {
        mode: "work",
        directory: AbsolutePath.make("/project"),
        parentID: null,
        anchor: { id: Session.ID.make("ses_mode_directory"), time: 2, direction: "previous" },
      },
      {
        mode: "custom",
        project: Project.ID.global,
        subpath: RelativePath.make("src"),
        anchor: { id: Session.ID.make("ses_mode_project"), time: 3, direction: "next" },
      },
    ] satisfies Parameters<typeof SessionsCursor.make>[0][]

    for (const input of inputs) {
      const cursor = SessionsCursor.make(input)

      expect(await Effect.runPromise(SessionsCursor.parse(cursor))).toEqual(input)
    }
  })
})
