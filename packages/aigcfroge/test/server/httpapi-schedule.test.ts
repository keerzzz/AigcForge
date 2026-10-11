import { expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Database } from "@aigcfroge/core/database/database"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { testEffect } from "../lib/effect"
import { httpApiLayer } from "./httpapi-layer"

const it = testEffect(
  Layer.mergeAll(
    httpApiLayer,
    Database.defaultLayer,
    ScheduleService.defaultLayer,
    ScheduleService.deliveryDefaultLayer,
  ),
)

it.live("encoded reminder keys mark the persisted delivery read through HTTP", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const schedules = yield* ScheduleService.Service
    const deliveries = yield* ScheduleService.DeliveryService
    const sessionID = SessionSchema.ID.make("ses_delivery_read_http")
    const now = (yield* DateTime.nowAsDate).getTime()
    yield* database.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* database.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "delivery-read",
        directory: "/project",
        title: "delivery-read",
        version: "test",
      })
      .run()
      .pipe(Effect.orDie)
    const reminder = yield* schedules.create({
      sessionID,
      kind: "reminder",
      content: "read through HTTP",
      dueAt: now + 60_000,
      timezone: "UTC",
      deliveryKey: `reminder:${sessionID}:${now}:test`,
    })
    yield* deliveries.deliver({
      deliveryKey: reminder.deliveryKey,
      scheduleID: reminder.id,
      sessionID,
      kind: "reminder",
      content: reminder.content,
      deliveredAt: now,
      caughtUp: false,
    })
    expect(yield* deliveries.countUnread(sessionID)).toBe(1)
    const response = yield* HttpClientRequest.post(`/delivery/${encodeURIComponent(reminder.deliveryKey)}/read`).pipe(
      HttpClientRequest.setHeaders({
        origin: "http://127.0.0.1:44331",
        "x-aigcfroge-capabilities": "product-mode-custom-v1",
      }),
      HttpClient.execute,
    )
    expect(response.status).toBe(200)
    expect(yield* deliveries.countUnread(sessionID)).toBe(0)
  }),
)
