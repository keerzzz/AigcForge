import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { ReminderCreateTool } from "@aigcfroge/core/tool/reminder-create"
import { ReminderUpdateTool } from "@aigcfroge/core/tool/reminder-update"
import { ReminderCancelTool } from "@aigcfroge/core/tool/reminder-cancel"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_reminder_tool_test")

// Tools self-assert their permission action (review BLOCKER #1 fix); tests
// provide an allow-all gate so the tool logic itself stays the focus.
const mockPermission = Layer.mock(PermissionV2.Service, {
  assert: () => Effect.void,
})

const it = testEffect(
  ReminderCreateTool.layer.pipe(
    Layer.provideMerge(ReminderUpdateTool.layer),
    Layer.provideMerge(ReminderCancelTool.layer),
    Layer.provideMerge(ScheduleService.layer),
    Layer.provideMerge(ScheduleService.deliveryLayer),
    Layer.provideMerge(Database.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(ToolRegistry.defaultLayer),
    Layer.provideMerge(mockPermission),
  ),
)

// A deny gate must block the tool (review BLOCKER #1): the runtime
// permission.assert is the enforcement, not just the materialize-time filter.
const denyPermission = Layer.mock(PermissionV2.Service, {
  assert: () => Effect.fail(new PermissionV2.DeniedError({ rules: [] })),
})

const itDeny = testEffect(
  ReminderCreateTool.layer.pipe(
    Layer.provideMerge(ScheduleService.layer),
    Layer.provideMerge(ScheduleService.deliveryLayer),
    Layer.provideMerge(Database.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(ToolRegistry.defaultLayer),
    Layer.provideMerge(denyPermission),
  ),
)

const setup = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "reminder",
      directory: "/project",
      title: "reminder",
      version: "test",
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

describe("Reminder tools", () => {
  it.effect("registers reminder_create/update/cancel", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const names = (yield* toolDefinitions(registry)).map((definition) => definition.name).sort()
      expect(names).toEqual(["reminder_cancel", "reminder_create", "reminder_update"])
    }),
  )

  it.effect("creates a pending reminder via reminder_create", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const result = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-reminder-create",
          name: "reminder_create",
          input: { content: "Follow up with customer", dueAt: Date.now() + 3600_000, timezone: "Asia/Shanghai" },
        },
      })
      expect(result.result.type).toBe("text")
      const text = result.result.value
      expect(text).toContain("Follow up with customer")

      const schedules = yield* ScheduleService.Service
      const list = yield* schedules.list(sessionID)
      expect(list).toHaveLength(1)
      expect(list[0]?.content).toBe("Follow up with customer")
      expect(list[0]?.status).toBe("pending")
      expect(list[0]?.timezone).toBe("Asia/Shanghai")
    }),
  )

  it.effect("creates two reminders at the same due time with different content (deliveryKey content digest)", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const dueAt = Date.now() + 3600_000
      for (const content of ["Take medicine", "Join standup"]) {
        const result = yield* settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: `call-reminder-create-${content}`,
            name: "reminder_create",
            input: { content, dueAt, timezone: "Asia/Shanghai" },
          },
        })
        expect(result.result.type).toBe("text")
      }

      const schedules = yield* ScheduleService.Service
      const list = yield* schedules.list(sessionID)
      expect(list).toHaveLength(2)
      expect(new Set(list.map((item) => item.deliveryKey)).size).toBe(2)
    }),
  )

  it.effect("updates an existing reminder via reminder_update", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const created = yield* schedules.create({
        sessionID,
        kind: "reminder",
        content: "Original",
        dueAt: Date.now() + 3600_000,
        timezone: "Asia/Shanghai",
        deliveryKey: "reminder:tool:update:1",
      })
      const registry = yield* ToolRegistry.Service
      const result = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-reminder-update",
          name: "reminder_update",
          input: { id: created.id, content: "Updated text", dueAt: Date.now() + 7200_000 },
        },
      })
      expect(result.result.type).toBe("text")
      expect(result.result.value).toContain("Updated text")

      const updated = (yield* schedules.list(sessionID))[0]
      expect(updated?.content).toBe("Updated text")
      expect(updated?.attempts).toBe(0)
    }),
  )

  it.effect("cancels a reminder via reminder_cancel and refuses later updates", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const created = yield* schedules.create({
        sessionID,
        kind: "reminder",
        content: "Doomed",
        dueAt: Date.now() + 3600_000,
        timezone: "Asia/Shanghai",
        deliveryKey: "reminder:tool:cancel:1",
      })
      const registry = yield* ToolRegistry.Service
      const cancelled = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-reminder-cancel",
          name: "reminder_cancel",
          input: { id: created.id },
        },
      })
      expect(cancelled.result.type).toBe("text")
      expect(cancelled.result.value).toContain("never be delivered")
      expect((yield* schedules.list(sessionID))[0]?.status).toBe("cancelled")

      // A terminal reminder cannot be updated: the tool reports updated=false.
      const update = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-reminder-update",
          name: "reminder_update",
          input: { id: created.id, content: "Too late" },
        },
      })
      expect(update.result.type).toBe("text")
      expect(update.result.value).toContain("terminal")
    }),
  )

  itDeny.effect("denies reminder_create when the permission assert fails", () =>
    Effect.gen(function* () {
      yield* setup
      const registry = yield* ToolRegistry.Service
      const result = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: "call-reminder-deny",
          name: "reminder_create",
          input: { content: "Blocked", dueAt: Date.now() + 3600_000, timezone: "Asia/Shanghai" },
        },
      })
      expect(result.result.type).toBe("error")
      expect(result.result.value).toContain("Permission denied")
      // Nothing was persisted — the gate runs before the write.
      const schedules = yield* ScheduleService.Service
      expect(yield* schedules.list(sessionID)).toHaveLength(0)
    }),
  )
})
