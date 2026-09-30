import { afterEach, describe, expect, test } from "bun:test"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { Context, Schema } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-aigcfroge-directory", encodeURIComponent(directory))
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers,
    }),
    context,
  )
}

const Event = Schema.Struct({
  id: EventV2.ID,
  type: Schema.String,
  location: Schema.optional(Location.Ref),
  data: Schema.Unknown,
})

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const value = await reader.read()
  if (value.done) throw new Error("event stream closed")
  return Schema.decodeUnknownSync(Event)(JSON.parse(new TextDecoder().decode(value.value).replace(/^data: /, "")))
}

async function readEventType(reader: ReadableStreamDefaultReader<Uint8Array>, type: string) {
  for (let index = 0; index < 20; index++) {
    const event = await readEvent(reader)
    if (event.type === type) return event
  }
  throw new Error(`timed out waiting for ${type}`)
}

const LocationNotFoundBody = Schema.Struct({
  _tag: Schema.Literal("LocationNotFoundError"),
  directory: Schema.String,
  message: Schema.String,
})

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("v2 location HttpApi", () => {
  test("decodes EventV2 location refs without resolved project metadata", () => {
    expect(
      Schema.decodeUnknownSync(Event)({
        id: "evt_test",
        type: "file.watcher.updated",
        location: { directory: "/tmp/project" },
        data: {},
      }),
    ).toMatchObject({ location: { directory: "/tmp/project" } })
  })

  test("returns a typed 404 for a directory that does not exist on disk", async () => {
    // Regression: a stale remembered directory (deleted, renamed, or migrated
    // to a new machine) used to reach the fff native search engine inside
    // LocationServiceMap, die there, and surface as an opaque empty 500/503.
    // LocationMiddleware now fails fast with a typed, JSON-bodied 404.
    const missing = "/tmp/aigcfroge-test-directory-does-not-exist-9f3c2a"
    const response = await request("/api/command", missing)
    expect(response.status).toBe(404)
    const body = Schema.decodeUnknownSync(LocationNotFoundBody)(await response.json())
    expect(body).toMatchObject({ _tag: "LocationNotFoundError", directory: missing })
  })

  test("returns command and skill snapshots with resolved locations", async () => {
    await using tmp = await tmpdir({ git: true })

    for (const route of ["/api/command", "/api/skill"]) {
      const response = await request(route, tmp.path)
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        location: { directory: string; project: { id: string } }
        data: unknown
      }
      expect(body.data).toBeArray()
      expect(body.location.directory).toBe(tmp.path)
      expect(body.location.project.id).toBeTruthy()
    }
  })

  test("streams native EventV2 payloads across locations", async () => {
    await using subscriber = await tmpdir({ git: true })
    await using publisher = await tmpdir({ git: true })
    const response = await request("/api/event", subscriber.path)
    const reader = response.body!.getReader()
    const connected = await readEvent(reader)
    expect(connected.type).toBe("server.connected")
    expect(connected.location).toBeUndefined()

    const created = await request("/session", publisher.path, { method: "POST" })
    expect(created.status).toBe(200)
    expect(await readEventType(reader, "session.created")).toMatchObject({
      type: "session.created",
      location: { directory: publisher.path },
      data: { sessionID: expect.any(String) },
    })
    await reader.cancel()
  })
})
