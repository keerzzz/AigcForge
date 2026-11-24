import { expect } from "bun:test"
import { Omnixa } from "@omnixa/client"
import { Database } from "@omnixa/core/database/database"
import { Bus } from "@omnixa/core/bus"
import { Model } from "@omnixa/core/model"
import { PersonalMemory } from "@omnixa/core/session/personal-memory"
import { PersonalMemoryTable } from "@omnixa/core/session/personal-memory.sql"
import { Provider } from "@omnixa/core/provider"
// Core service and public schema share the PersonalMemory name.
import { PersonalMemory as PersonalMemorySchema } from "@omnixa/schema/personal-memory"
import { Context, Effect, Layer, Schema } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)

it.live("serves authenticated personal memory lifecycle using the existing generated client", () =>
  Effect.gen(function* () {
    const fixture = yield* AssetHttpFixture.setup({
      prefix: "omnixa-personal-memory-http-",
      assetDirectory: ".omnixa",
      files: [],
      model: Model.Ref.make({ id: Model.ID.make("memory-fixture"), providerID: Provider.ID.make("test") }),
    })
    const memories = Context.get(
      yield* Layer.build(
        PersonalMemory.layer.pipe(
          Layer.provide([Layer.succeed(Database.Service, fixture.database), Layer.succeed(Bus.Service, fixture.bus)]),
        ),
      ),
      PersonalMemory.Service,
    )
    const first = yield* memories.propose({
      content: "Prefers concise project updates",
      source: "explicit",
      trustLevel: "high",
      sensitivityLevel: "low",
    })
    const second = yield* memories.propose({
      content: "Potential user preference",
      source: "derived",
      trustLevel: "low",
      sensitivityLevel: "medium",
    })
    const statuses: number[] = []
    const api = Omnixa.make({
      baseUrl: "http://omnixa.local",
      headers: { authorization: `Basic ${btoa("omnixa:secret")}`, "x-omnixa-directory": fixture.directory },
      fetch: Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          const response = await fixture.handler(new Request(input, init))
          statuses.push(response.status)
          return response
        },
        { preconnect: fetch.preconnect },
      ),
    })
    const listed = yield* Effect.promise(() => api.memory.list())
    expect(
      Schema.decodeUnknownSync(Schema.Array(PersonalMemorySchema.Info))(listed)
        .map((item) => item.id)
        .sort(),
    ).toEqual([first.id, second.id].sort())
    expect((yield* Effect.promise(() => api.memory.pending())).map((item) => item.id).sort()).toEqual(
      [first.id, second.id].sort(),
    )
    expect((yield* fixture.request(`/memory/${second.id}/remove`, { body: {} })).status).toBe(400)
    expect((yield* memories.listPending()).map((item) => item.id).sort()).toEqual([first.id, second.id].sort())
    expect((yield* Effect.promise(() => api.memory.confirm({ id: first.id }))).status).toBe("confirmed")
    expect(
      yield* Effect.promise(() =>
        api.memory.edit({
          id: first.id,
          content: "Updated personal preference",
          trustLevel: "medium",
          sensitivityLevel: "low",
        }),
      ),
    ).toMatchObject({ id: first.id, content: "Updated personal preference", status: "confirmed", trustLevel: "medium" })
    expect((yield* Effect.promise(() => api.memory.reject({ id: second.id }))).status).toBe("rejected")
    expect((yield* Effect.promise(() => api.memory.remove({ id: first.id }))).status).toBe("deleted")
    expect(yield* Effect.promise(() => api.memory.pending())).toEqual([])
    expect((yield* Effect.promise(() => api.memory.list())).map((item) => item.status).sort()).toEqual([
      "deleted",
      "rejected",
    ])
    expect(statuses).toEqual(Array(8).fill(200))
    expect(yield* memories.listConfirmed()).toEqual([])
    const rows = yield* fixture.database.db.select().from(PersonalMemoryTable).all()
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === first.id)?.content).toBe("Updated personal preference")
    for (const operation of ["confirm", "reject", "remove"] as const) {
      const response = yield* fixture.request(`/memory/${first.id}/${operation}`, { body: {} })
      expect(response.status).toBe(400)
    }
    const invalid = yield* fixture.request(`/memory/${second.id}`, { body: { trustLevel: "invalid" } })
    expect(invalid.status).toBe(400)
    expect((yield* fixture.request(`/memory/${second.id}`, { body: { content: "terminal edit" } })).status).toBe(400)
    expect((yield* fixture.request("/memory/not-memory-id/confirm", { body: {} })).status).toBe(400)
    expect((yield* fixture.request("/memory", { authenticated: false })).status).toBe(401)
    expect((yield* fixture.request("/memory", { directory: fixture.other })).status).toBe(200)
    expect(yield* memories.list()).toHaveLength(2)
    expect(yield* fixture.llm.requests()).toHaveLength(0)
  }),
)
