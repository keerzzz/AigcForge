import { expect } from "bun:test"
import { Session } from "@aigcfroge/schema/session"
import { Context, Effect, Layer, Schema } from "effect"
import { it } from "../../core/test/lib/effect"
import path from "node:path"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import { Model } from "@aigcfroge/core/model"
import { Provider } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Global } from "@aigcfroge/util/global"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { tempGlobalLayer } from "../../core/test/fixture/global"
import { useOfflineCatalog } from "../../core/test/fixture/models"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { createRoutes } from "../src/routes"
import { Database } from "@aigcfroge/core/database/database"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { MetaAgentTable, MetaAgentSessionTable } from "@aigcfroge/core/meta-agent/sql"
import { EventSequenceTable, EventTable } from "@aigcfroge/core/event/sql"

const SessionResponse = Schema.Struct({ data: Schema.toEncoded(Session.Info) })

it.live("updates metadata and switches a captured Meta model through actual HTTP with rollback", () =>
  Effect.gen(function* () {
    const directory = (yield* tmpdirScoped("aigcfroge-server-update-")).path
    const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
    const context = yield* Layer.build(
      createRoutes(
        {
          app: { version: "test" },
          database: { path: ":memory:" },
          config: { directory: path.join(directory, "config"), project: false, content: "{}" },
          fs: { filewatcher: false },
          models: { fetch: false },
        },
        () => [],
        [Global.node.replace(tempGlobalLayer)],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const model = Model.Ref.parse("server-keeper/meta")
    yield* useOfflineCatalog([
      {
        info: Provider.Info.make({
          ...Provider.Info.empty(model.providerID),
          activation: "enabled",
          package: "@aigcfroge/ai/providers/openai/responses",
        }),
        models: [Model.Info.make(Model.Info.default(model.providerID, model.id))],
      },
    ]).pipe(Effect.provide(Context.get(context, LocationServiceMap.Service).get(location)))
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const request = (path: string, method: string, body?: unknown, status = method === "PATCH" ? 204 : 200) =>
      Effect.promise(async () => {
        const response = await handler(
          new Request(`http://aigcfroge.local${path}`, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        )
        expect(response.status).toBe(status)
        return response.status === 204 ? undefined : response.json()
      })

    const created = Schema.decodeUnknownSync(SessionResponse)(
      yield* request("/api/session", "POST", { location, model, metadata: { source: "create", stale: true } }),
    )
    yield* request(`/api/session/${created.data.id}`, "PATCH", { metadata: { source: "patch" } })
    const updated = Schema.decodeUnknownSync(SessionResponse)(yield* request(`/api/session/${created.data.id}`, "GET"))

    expect(updated.data.metadata).toEqual({ source: "patch" })
    const plan = Schema.decodeUnknownSync(SessionResponse)(
      yield* request("/api/session", "POST", {
        location,
        agent: "plan",
        model: { providerID: "unavailable", id: "old" },
      }),
    )
    yield* request(`/api/session/${plan.data.id}/agent`, "POST", { agent: "meta", model }, 204)
    const selected = Schema.decodeUnknownSync(SessionResponse)(yield* request(`/api/session/${plan.data.id}`, "GET"))
    expect(selected.data).toMatchObject({
      agent: "meta",
      model: { providerID: model.providerID, id: model.id },
      controller: { kind: "root", rootSessionID: plan.data.id },
    })
    const db = Context.get(context, Database.Service).db
    yield* db.$client.unsafe("DELETE FROM meta_agent_session WHERE session_id = ?", [plan.data.id]).pipe(Effect.orDie)
    const read = () =>
      Effect.all({
        sessions: db.select().from(SessionTable),
        metas: db.select().from(MetaAgentTable),
        owners: db.select().from(MetaAgentSessionTable),
        events: db.select().from(EventTable),
        sequence: db.select().from(EventSequenceTable),
      })
    const before = yield* read()
    expect(
      yield* request(
        `/api/session/${plan.data.id}/agent`,
        "POST",
        { agent: "build", model: { providerID: "ordinary", id: "build" } },
        400,
      ),
    ).toMatchObject({ kind: "meta_owner_invalid", field: "controller" })
    expect(yield* read()).toEqual(before)
  }).pipe(Effect.scoped),
)
