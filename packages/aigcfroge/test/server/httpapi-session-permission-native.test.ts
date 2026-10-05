import { AgentV2 } from "@aigcfroge/core/agent"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { Hash } from "@aigcfroge/core/util/hash"
import { Composition } from "@aigcfroge/schema/composition"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { describe, expect } from "bun:test"
import { Effect, FileSystem, Layer, Schema } from "effect"
import { AIGCFROGE_V2_RUNTIME, AppLayer } from "../../src/effect/app-runtime"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const state = Layer.effectDiscard(
  Effect.gen(function* () {
    const custom = process.env["AIGCFROGE_CUSTOM_MODE"]
    process.env["AIGCFROGE_CUSTOM_MODE"] = "true"
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (custom === undefined) {
          delete process.env["AIGCFROGE_CUSTOM_MODE"]
          return
        }
        process.env["AIGCFROGE_CUSTOM_MODE"] = custom
      }),
    )
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
  }),
)
const it = testEffect(Layer.mergeAll(httpApiLayer, AppLayer).pipe(Layer.provide(state)))
// The runtime flag is captured at module load: execute this file in separate
// native-on and native-off processes. Custom stays native in both processes.
const modes = AIGCFROGE_V2_RUNTIME ? ProductMode.ID.literals : (["custom"] as const)

const respond = (directory: string, sessionID: SessionV2.ID, requestID: PermissionV2.ID, response: string) =>
  requestInDirectory(`/session/${sessionID}/permissions/${requestID}`, directory, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [ProductMode.CAPABILITIES_HEADER]: ProductMode.CAPABILITY_CUSTOM_V1,
    },
    body: JSON.stringify({ response }),
  })

const nativeOwner = Effect.fn("SessionPermissionNativeTest.owner")(function* (directory: string, mode: ProductMode.ID) {
  const location = Location.Ref.make({ directory: AbsolutePath.make(directory) })
  const sessions = yield* SessionV2.Service
  const session = yield* Effect.gen(function* () {
    if (mode !== "custom") return yield* sessions.create({ location, mode })
    const fs = yield* FileSystem.FileSystem
    const content = "---\nkind: agent\nname: coder\ndescription: Native permission test\n---\nRead project files.\n"
    yield* fs.makeDirectory(`${directory}/.aigcfroge/agents`, { recursive: true })
    yield* fs.writeFileString(`${directory}/.aigcfroge/agents/coder.md`, content)
    return (yield* sessions.createCustom({
      location,
      composition: new Composition.TemporaryInput({
        source: "temporary",
        agents: [
          new Composition.AgentRef({
            kind: "agent",
            relativePath: "coder.md",
            revision: Composition.Revision.make(Hash.sha256(Buffer.from(content))),
          }),
        ],
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      }),
    })).session
  })
  expect(session.mode).toBe(mode)
  const agentID = session.agent
  if (!agentID) return yield* Effect.die("Native permission fixture requires a real Session agent")
  const locations = yield* LocationServiceMap
  return yield* Effect.gen(function* () {
    yield* (yield* AgentV2.Service).transform((editor) =>
      editor.update(agentID, (agent) => {
        agent.permissions = [{ action: "read", resource: "*", effect: "ask" }]
      }),
    )
    return {
      session,
      permission: yield* PermissionV2.Service,
      saved: yield* PermissionSaved.Service,
      location: yield* Location.Service,
    }
  }).pipe(Effect.provide(locations.get(location)))
})

modes.forEach((mode) => {
  describe(`AI-TDD-S03-R02 Session permission alias / ${mode} / native=${AIGCFROGE_V2_RUNTIME}`, () => {
    it.live("settles once, always and reject through the actual native owner", () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped({ git: true })
        const owner = yield* nativeOwner(directory, mode)
        const events = yield* EventV2.Service
        const terminal: EventV2.Payload[] = []
        const off = yield* events.listen((event) => {
          if (event.type === PermissionV2.Event.Replied.type) terminal.push(event)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => off)

        yield* Effect.forEach(PermissionV2.Reply.literals, (reply) =>
          Effect.gen(function* () {
            const resource = `src/${reply}.ts`
            const pending = yield* owner.permission.ask({
              sessionID: owner.session.id,
              action: "read",
              resources: [resource],
              save: [resource],
            })
            expect(pending.effect).toBe("ask")
            const response = yield* respond(directory, owner.session.id, pending.id, reply)
            expect(response.status).toBe(200)
            expect(yield* response.json).toBe(true)
            expect(yield* owner.permission.get(pending.id)).toBeUndefined()
            expect(
              terminal.filter(
                (event) =>
                  Schema.decodeUnknownSync(PermissionV2.Event.Replied.data)(event.data).requestID === pending.id,
              ),
            ).toMatchObject([
              {
                data: { sessionID: owner.session.id, requestID: pending.id, reply },
                location: { directory: owner.location.directory, workspaceID: owner.location.workspaceID },
              },
            ])
          }),
        )
        expect(yield* owner.permission.list()).toEqual([])
        const saved = yield* owner.saved.list({ projectID: owner.location.project.id })
        expect(saved).toHaveLength(1)
        expect(saved).toMatchObject([{ action: "read", resource: "src/always.ts" }])
        expect(terminal).toHaveLength(3)
      }),
    )

    it.live("rejects foreign Session/Location, missing and settled IDs without mutating the owner", () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped({ git: true })
        const elsewhere = yield* tmpdirScoped({ git: true })
        const owner = yield* nativeOwner(directory, mode)
        const sibling = yield* nativeOwner(directory, mode)
        const foreign = yield* nativeOwner(elsewhere, mode)
        const pending = yield* owner.permission.ask({
          sessionID: owner.session.id,
          action: "read",
          resources: ["src/owner.ts"],
          save: ["src/owner.ts"],
        })
        expect(pending.effect).toBe("ask")
        const terminal: EventV2.Payload[] = []
        const off = yield* (yield* EventV2.Service).listen((event) => {
          if (event.type === PermissionV2.Event.Replied.type) terminal.push(event)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => off)

        // Session paths are routed by persisted placement, not the directory
        // hint. The foreign Session exercises a genuinely different Location.
        yield* Effect.forEach([sibling.session, foreign.session], (session) =>
          Effect.gen(function* () {
            const response = yield* respond(directory, session.id, pending.id, "always")
            expect(response.status).toBe(404)
            expect(yield* response.json).toEqual({
              _tag: "PermissionNotFoundError",
              requestID: pending.id,
              message: `Permission request not found: ${pending.id}`,
            })
            expect(yield* owner.permission.get(pending.id)).toMatchObject({
              id: pending.id,
              sessionID: owner.session.id,
            })
            expect(yield* owner.saved.list()).toEqual([])
            expect(terminal).toEqual([])
          }),
        )
        expect(yield* foreign.permission.list()).toEqual([])

        const missing = PermissionV2.ID.create()
        const absent = yield* respond(directory, owner.session.id, missing, "once")
        expect(absent.status).toBe(404)
        expect(yield* absent.json).toEqual({
          _tag: "PermissionNotFoundError",
          requestID: missing,
          message: `Permission request not found: ${missing}`,
        })
        const absentSession = SessionV2.ID.make("ses_missing_native_permission")
        const noSession = yield* respond(directory, absentSession, pending.id, "once")
        expect(noSession.status).toBe(404)
        expect(yield* noSession.json).toEqual({
          name: "NotFoundError",
          data: { message: `Session not found: ${absentSession}` },
        })
        expect((yield* respond(directory, owner.session.id, pending.id, "invalid")).status).toBe(400)
        expect(yield* owner.permission.get(pending.id)).toBeDefined()
        expect(terminal).toEqual([])

        // A stale/spoofed directory header must not redirect a known Session.
        const accepted = yield* respond(elsewhere, owner.session.id, pending.id, "once")
        expect(accepted.status).toBe(200)
        expect(yield* accepted.json).toBe(true)
        const settled = yield* respond(directory, owner.session.id, pending.id, "always")
        expect(settled.status).toBe(404)
        expect(yield* settled.json).toEqual({
          _tag: "PermissionNotFoundError",
          requestID: pending.id,
          message: `Permission request not found: ${pending.id}`,
        })
        expect(yield* owner.permission.list()).toEqual([])
        expect(yield* owner.saved.list()).toEqual([])
        expect(terminal).toHaveLength(1)
      }),
    )

    it.live("shares the native endpoint's owner and commits only one concurrent always reply", () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped({ git: true })
        const owner = yield* nativeOwner(directory, mode)
        const pending = yield* owner.permission.ask({
          sessionID: owner.session.id,
          action: "read",
          resources: ["src/race.ts"],
          save: ["src/race.ts"],
        })
        expect(pending.effect).toBe("ask")
        const terminal: EventV2.Payload[] = []
        const off = yield* (yield* EventV2.Service).listen((event) => {
          if (event.type === PermissionV2.Event.Replied.type) terminal.push(event)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => off)
        const responses = yield* Effect.all(
          [
            respond(directory, owner.session.id, pending.id, "always"),
            requestInDirectory(`/api/session/${owner.session.id}/permission/${pending.id}/reply`, directory, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                [ProductMode.CAPABILITIES_HEADER]: ProductMode.CAPABILITY_CUSTOM_V1,
              },
              body: JSON.stringify({ reply: "always" }),
            }),
          ],
          { concurrency: "unbounded" },
        )
        expect(responses.filter((response) => response.status === 404)).toHaveLength(1)
        expect(responses.filter((response) => response.status === 200 || response.status === 204)).toHaveLength(1)
        expect(terminal).toMatchObject([
          { data: { sessionID: owner.session.id, requestID: pending.id, reply: "always" } },
        ])
        const saved = yield* owner.saved.list({ projectID: owner.location.project.id })
        expect(saved).toHaveLength(1)
        expect(saved).toMatchObject([{ action: "read", resource: "src/race.ts" }])
        expect(yield* owner.permission.list()).toEqual([])

        const retried = yield* respond(directory, owner.session.id, pending.id, "always")
        expect(retried.status).toBe(404)
        expect(yield* retried.json).toEqual({
          _tag: "PermissionNotFoundError",
          requestID: pending.id,
          message: `Permission request not found: ${pending.id}`,
        })
        expect(yield* owner.saved.list({ projectID: owner.location.project.id })).toEqual(saved)
        expect(terminal).toHaveLength(1)
      }),
    )

    it.live("maps a real persistence failure to 500 and keeps the request answerable", () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped({ git: true })
        const owner = yield* nativeOwner(directory, mode)
        const pending = yield* owner.permission.ask({
          sessionID: owner.session.id,
          action: "read",
          resources: ["src/storage.ts"],
          save: ["src/storage.ts"],
        })
        expect(pending.effect).toBe("ask")
        const terminal: EventV2.Payload[] = []
        const off = yield* (yield* EventV2.Service).listen((event) => {
          if (event.type === PermissionV2.Event.Replied.type) terminal.push(event)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => off)
        const database = yield* Database.Service
        // Fault the real isolated SQLite write; do not replace the permission
        // owner or PermissionSaved with a stub that could hide wrong wiring.
        yield* database.db.run(`
          CREATE TEMP TRIGGER permission_native_save_failure
          BEFORE INSERT ON permission
          BEGIN
            SELECT RAISE(ABORT, 'permission native save failed');
          END
        `)
        yield* Effect.addFinalizer(() =>
          database.db.run("DROP TRIGGER IF EXISTS permission_native_save_failure").pipe(Effect.orDie),
        )
        expect((yield* respond(directory, owner.session.id, pending.id, "always")).status).toBe(500)
        expect(yield* owner.permission.get(pending.id)).toBeDefined()
        expect(yield* owner.saved.list()).toEqual([])
        expect(terminal).toEqual([])

        yield* database.db.run("DROP TRIGGER permission_native_save_failure")
        const recovered = yield* respond(directory, owner.session.id, pending.id, "always")
        expect(recovered.status).toBe(200)
        expect(yield* recovered.json).toBe(true)
        expect(yield* owner.permission.list()).toEqual([])
        expect(yield* owner.saved.list({ projectID: owner.location.project.id })).toHaveLength(1)
        expect(terminal).toHaveLength(1)
      }),
    )

    it.live("maps notification defects to 500 without reopening or regranting a settled request", () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped({ git: true })
        const owner = yield* nativeOwner(directory, mode)
        const pending = yield* owner.permission.ask({
          sessionID: owner.session.id,
          action: "read",
          resources: ["src/notification.ts"],
          save: ["src/notification.ts"],
        })
        expect(pending.effect).toBe("ask")
        const terminal: EventV2.Payload[] = []
        const off = yield* (yield* EventV2.Service).listen((event) => {
          if (event.type !== PermissionV2.Event.Replied.type) return Effect.void
          if (Schema.decodeUnknownSync(PermissionV2.Event.Replied.data)(event.data).requestID !== pending.id)
            return Effect.void
          terminal.push(event)
          return Effect.die("permission native notification failed")
        })
        yield* Effect.addFinalizer(() => off)
        expect((yield* respond(directory, owner.session.id, pending.id, "always")).status).toBe(500)
        expect(yield* owner.permission.list()).toEqual([])
        const saved = yield* owner.saved.list({ projectID: owner.location.project.id })
        expect(saved).toHaveLength(1)
        expect(saved).toMatchObject([{ action: "read", resource: "src/notification.ts" }])
        expect((yield* respond(directory, owner.session.id, pending.id, "always")).status).toBe(404)
        expect(yield* owner.saved.list({ projectID: owner.location.project.id })).toEqual(saved)
        expect(terminal).toHaveLength(1)
      }),
    )
  })
})
