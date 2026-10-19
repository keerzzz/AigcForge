import { expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { ProjectV2 } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { testEffect } from "./lib/effect"

const it = testEffect(Database.defaultLayer)

it.effect("session mode membership includes older sessions and excludes other projects", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const projectID = ProjectV2.ID.make("project_status")
    const otherProjectID = ProjectV2.ID.make("project_status_other")
    yield* database.db
      .insert(ProjectTable)
      .values(
        [projectID, otherProjectID].map((id) => ({ id, worktree: AbsolutePath.make(`/test/${id}`), sandboxes: [] })),
      )
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values(
        Array.from({ length: 102 }, (_, index) => ({
          id: SessionSchema.ID.make(`ses_status_${index}`),
          project_id: index === 101 ? otherProjectID : projectID,
          directory: "/test",
          title: "Status membership",
          slug: `status-${index}`,
          version: "test",
          mode: "assistant" as const,
          time_updated: index,
        })),
      )
      .run()
      .pipe(Effect.orDie)
    const modes = yield* SessionStore.sessionModes({ projectID })
    expect(modes.size).toBe(101)
    expect(modes.get("ses_status_0")).toBe("assistant")
    expect(modes.has("ses_status_101")).toBe(false)
    expect((yield* SessionStore.sessionModes()).size).toBe(102)
  }),
)
