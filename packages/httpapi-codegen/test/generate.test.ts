import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { type Brand, DateTime, Effect, FileSystem, Schema, SchemaAST, SchemaGetter, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api"
import { format } from "prettier"
import { ConfigMCP } from "../../schema/src/config/mcp"
import { Model } from "../../schema/src/model"
import { ModelGroup } from "../../schema/src/model-group"
import { ProductMode } from "../../schema/src/product-mode"
import { AbsolutePath, optional } from "../../schema/src/schema"
import { Session } from "../../schema/src/session"
import { SessionCommunication } from "../../schema/src/session-communication"
import { SessionGoal } from "../../schema/src/session-goal"
import { ConfigMCPV1 } from "../../schema/src/v1/config/mcp"
import {
  compile,
  emitEffect,
  emitEffectImported,
  emitEffectShape,
  emitPromise,
  generate,
  GenerationError,
  type Output,
} from "../src"
import { it } from "./effect"
import { Api, Missing } from "./fixture"

function api(endpoint: HttpApiEndpoint.Constraint) {
  return HttpApi.make("test").add(HttpApiGroup.make("session").add(endpoint))
}

function compileEffect<Id extends string, Groups extends HttpApiGroup.Constraint>(source: HttpApi.HttpApi<Id, Groups>) {
  return emitEffect(compile(source))
}

async function emittedModule(output: Output) {
  // Effect clients resolve their runtime from this package's node_modules.
  const directory = await mkdtemp(join(fileURLToPath(new URL("../", import.meta.url)), ".httpapi-codegen-"))
  const dispose = () => rm(directory, { recursive: true, force: true })

  try {
    // Finish each write before cleanup can run, even when a later write fails.
    await Array.fromAsync(output.files, (file) => Bun.write(join(directory, file.path), file.content))
    const module = await import(`${join(directory, "index.ts")}?t=${crypto.randomUUID()}`)
    return { module, [Symbol.asyncDispose]: dispose }
  } catch (cause) {
    await dispose()
    throw cause
  }
}

class TimedPayload extends Schema.Class<TimedPayload>("Codegen.TimedPayload")({
  created: Schema.DateTimeUtc,
  count: Schema.NumberFromString,
}) {}

const SwitchPayload = Schema.Struct({
  model: Model.Selection,
  created: Schema.DateTimeUtc,
  count: Schema.NumberFromString,
})
const HistoryPayload = Schema.Struct({ entries: Schema.Array(TimedPayload) })
const PlainPayload = Schema.Struct({
  prompt: Schema.String,
  created: Schema.DateTimeUtc,
  count: Schema.NumberFromString,
})

export const ClassPayloadApi = HttpApi.make("class-payload").add(
  HttpApiGroup.make("model")
    .add(
      HttpApiEndpoint.post("groupSave", "/api/model/group", {
        query: { location: Schema.String },
        payload: ModelGroup.SaveInput,
        success: Schema.String,
      })
        .annotate(OpenApi.Identifier, "model.group.definition.save")
        .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error", errors: "all" }),
    )
    .add(
      HttpApiEndpoint.delete("groupRemove", "/api/model/group", {
        query: { location: Schema.String },
        payload: ModelGroup.RemoveInput,
        success: Schema.String,
      }).annotate(OpenApi.Identifier, "model.group.definition.remove"),
    )
    .add(
      HttpApiEndpoint.post("switch", "/api/model/switch", {
        query: { location: Schema.String },
        payload: SwitchPayload,
        success: Schema.String,
      }),
    )
    .add(
      HttpApiEndpoint.post("history", "/api/model/history", {
        query: { location: Schema.String },
        payload: HistoryPayload,
        success: Schema.String,
      }),
    )
    .add(
      HttpApiEndpoint.post("struct", "/api/struct", {
        query: { location: Schema.String },
        payload: PlainPayload,
        success: Schema.String,
      }),
    ),
)

type ClassPayloadClient = {
  readonly model: {
    readonly group: {
      readonly definition: {
        readonly save: (input: {
          readonly location: string
          readonly payload: (typeof ModelGroup.SaveInput)["~type.make.in"]
        }) => Effect.Effect<string, unknown>
        readonly remove: (input: {
          readonly location: string
          readonly payload: (typeof ModelGroup.RemoveInput)["~type.make.in"]
        }) => Effect.Effect<string, unknown>
      }
    }
    readonly switch: (
      input: (typeof SwitchPayload)["~type.make.in"] & { readonly location: string },
    ) => Effect.Effect<string, unknown>
    readonly history: (
      input: (typeof HistoryPayload)["~type.make.in"] & { readonly location: string },
    ) => Effect.Effect<string, unknown>
    readonly struct: (
      input: (typeof PlainPayload)["~type.make.in"] & { readonly location: string },
    ) => Effect.Effect<string, unknown>
  }
}

describe("HttpApiCodegen.generate", () => {
  test("compiles one contract for Promise and Effect emitters", () => {
    const contract = compile(
      api(
        HttpApiEndpoint.get("get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          success: Schema.Struct({ data: Schema.String }),
        }),
      ),
    )

    const promise = emitPromise(contract)
    const effect = emitEffect(contract)

    expect(promise.operations).toEqual(effect.operations)
    expect(promise.files.map((file) => file.path)).toEqual(["types.ts", "client-error.ts", "client.ts", "index.ts"])
    const promiseClient = promise.files.find((file) => file.path === "client.ts")?.content
    expect(promiseClient).toContain('"get": (input: SessionGetInput, requestOptions?: RequestOptions)')
    expect(promiseClient).toContain("`/session/${encodeURIComponent(input.sessionID)}`")
    expect(effect.files.find((file) => file.path === "session.ts")?.content).toContain(
      'params: { "sessionID": input["sessionID"] }',
    )
  })

  test("rejects erased Promise SSE output aliases without a wire codec", () => {
    const contract = compile(
      api(HttpApiEndpoint.get("events", "/event", { success: HttpApiSchema.StreamSse({ data: Schema.Unknown }) })),
    )
    expect(() =>
      emitPromise(contract, {
        outputTypes: {
          "session.events": {
            name: "EventWire",
            import: 'import type { EventWire } from "./event-wire"',
          },
        },
      }),
    ).toThrow("Promise SSE output overrides require a schema-derived wire codec")
  })

  test("emits an Effect client against an imported authoritative API", () => {
    const output = emitEffectImported(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.Struct({ data: Schema.String }),
          }),
        ),
      ),
      { module: "@example/api", api: "Api" },
    )

    expect(output.files.map((file) => file.path)).toEqual(["client-error.ts", "client.ts", "index.ts"])
    expect(output.files.find((file) => file.path === "client.ts")?.content).toContain(
      'import { Api } from "@example/api"',
    )
    expect(output.files.find((file) => file.path === "client.ts")?.content).toContain(
      "HttpApiClient.ForApi<typeof Api>",
    )
  })
  ;[false, true].forEach((shaped) => {
    it.live(`materializes canonical group save/remove payloads with generated shape ${shaped}`, () =>
      Effect.gen(function* () {
        const contract = compile(ClassPayloadApi)
        const output = emitEffectImported(contract, {
          module: fileURLToPath(import.meta.url),
          api: "ClassPayloadApi",
          ...(shaped ? { shapeModule: "./api" } : {}),
        })
        const emitted = yield* Effect.acquireRelease(
          Effect.promise(() =>
            emittedModule({
              ...output,
              files: [...output.files, ...(shaped ? emitEffectShape(contract).files : [])],
            }),
          ),
          (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
        )
        const make: (options: {
          readonly baseUrl: string
        }) => Effect.Effect<ClassPayloadClient, never, HttpClient.HttpClient> = emitted.module.Omnixa.make
        const requests: Array<{ method: string; query: Record<string, string>; body: unknown }> = []
        const httpClient = HttpClient.make((request) => {
          if (request.body._tag !== "Uint8Array") return Effect.die(new Error("Expected a JSON payload"))
          requests.push({
            method: request.method,
            query: Object.fromEntries(request.urlParams.params),
            body: Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(
              new TextDecoder().decode(request.body.body),
            ),
          })
          return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json("ok")))
        })
        const save = {
          groupID: Model.GroupID.make("primary"),
          target: { scope: "project", path: AbsolutePath.make("/workspace/omnixa.jsonc") },
          expectedDigest: null,
          patch: { set: { name: "Primary" } },
        } satisfies (typeof ModelGroup.SaveInput)["~type.make.in"]
        const remove = { groupID: save.groupID, target: save.target, expectedDigest: "digest-1" }
        expect(Schema.is(ModelGroup.SaveInput)(save)).toBe(false)
        expect(Schema.is(ModelGroup.Patch)(save.patch)).toBe(false)
        expect(Schema.is(ModelGroup.RemoveInput)(remove)).toBe(false)

        const result = yield* Effect.gen(function* () {
          const client = yield* make({ baseUrl: "https://example.com" })
          const saved = yield* client.model.group.definition.save({ location: "local", payload: save })
          const removed = yield* client.model.group.definition.remove({ location: "local", payload: remove })
          const existing = yield* client.model.group.definition.save({
            location: "local",
            payload: Schema.decodeUnknownSync(Schema.toCodecJson(ModelGroup.SaveInput))(save),
          })
          const invalid = yield* client.model.group.definition
            .save({
              location: "local",
              payload: { ...save, patch: Object.assign({}, save.patch, { unexpected: true }) },
            })
            .pipe(Effect.flip)
          return { saved, removed, existing, invalid }
        }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient))

        expect(result.saved).toBe("ok")
        expect(result.removed).toBe("ok")
        expect(result.existing).toBe("ok")
        expect(result.invalid).toBeInstanceOf(emitted.module.ClientError)
        expect(requests).toEqual([
          { method: "POST", query: { location: "local" }, body: save },
          { method: "DELETE", query: { location: "local" }, body: remove },
          { method: "POST", query: { location: "local" }, body: save },
        ])
      }),
    )

    it.live(
      `materializes deep Class payloads and preserves decoded flat Struct inputs with generated shape ${shaped}`,
      () =>
        Effect.gen(function* () {
          const contract = compile(ClassPayloadApi)
          const output = emitEffectImported(contract, {
            module: fileURLToPath(import.meta.url),
            api: "ClassPayloadApi",
            ...(shaped ? { shapeModule: "./api" } : {}),
          })
          const emitted = yield* Effect.acquireRelease(
            Effect.promise(() =>
              emittedModule({
                ...output,
                files: [...output.files, ...(shaped ? emitEffectShape(contract).files : [])],
              }),
            ),
            (value) => Effect.promise(() => value[Symbol.asyncDispose]()),
          )
          const make: (options: {
            readonly baseUrl: string
          }) => Effect.Effect<ClassPayloadClient, never, HttpClient.HttpClient> = emitted.module.Omnixa.make
          const requests: Array<{ query: Record<string, string>; body: unknown }> = []
          const httpClient = HttpClient.make((request) => {
            if (request.body._tag !== "Uint8Array") return Effect.die(new Error("Expected a JSON payload"))
            requests.push({
              query: Object.fromEntries(request.urlParams.params),
              body: Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(
                new TextDecoder().decode(request.body.body),
              ),
            })
            return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json("ok")))
          })
          const created = DateTime.makeUnsafe("2026-11-15T00:00:00.000Z")
          const group = {
            type: "group",
            groupID: Model.GroupID.make("primary"),
          } satisfies (typeof Model.GroupRef)["~type.make.in"]
          const ref = Model.Ref.parse("test/model-a")
          const timed = { created, count: 3 }
          expect(Schema.is(Model.GroupRef)(group)).toBe(false)
          expect(Schema.is(TimedPayload)(timed)).toBe(false)

          const result = yield* Effect.gen(function* () {
            const client = yield* make({ baseUrl: "https://example.com" })
            const selected = yield* client.model.switch({ location: "local", model: group, created, count: 1 })
            const physical = yield* client.model.switch({ location: "local", model: ref, created, count: 2 })
            const history = yield* client.model.history({ location: "local", entries: [timed] })
            const plain = yield* client.model.struct({ location: "local", prompt: "plain", created, count: 4 })
            return [selected, physical, history, plain]
          }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient))

          expect(result).toEqual(["ok", "ok", "ok", "ok"])
          expect(requests).toEqual([
            { query: { location: "local" }, body: { model: group, created: "2026-11-15T00:00:00.000Z", count: "1" } },
            { query: { location: "local" }, body: { model: ref, created: "2026-11-15T00:00:00.000Z", count: "2" } },
            { query: { location: "local" }, body: { entries: [{ created: "2026-11-15T00:00:00.000Z", count: "3" }] } },
            {
              query: { location: "local" },
              body: { prompt: "plain", created: "2026-11-15T00:00:00.000Z", count: "4" },
            },
          ])
          const source = output.files.find((file) => file.path === "client.ts")?.content
          expect(source).toContain("const EndpointModelSwitchPayload = SchemaParser.makeEffect")
          expect(source).toContain('query: { "location": input["location"] }, payload')
          expect(source).not.toContain("const EndpointModelStructPayload")
        }),
    )
  })

  test("generates Effect API types from schemas instead of the imported API", () => {
    const Info = Schema.Struct({ id: Schema.String }).annotate({ identifier: "Session.Info" })
    const output = emitEffectShape(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session/:id", {
            params: { id: Schema.String },
            success: Schema.Struct({ data: Info }),
          }),
        ),
      ),
      {
        typeReferences: [
          {
            schema: Info,
            name: "Session.Info",
            import: 'import type { Session } from "@example/schema/session"',
          },
        ],
      },
    )
    const source = output.files[0]?.content

    expect(source).toContain('import type { Session } from "@example/schema/session"')
    expect(source).toContain('export type SessionGetInput = { readonly "id": string }')
    expect(source).toContain("export type SessionGetOutput = Session.Info")
    expect(source).not.toContain("HttpApiClient")
    expect(source).not.toContain("@example/api")
  })

  test("preserves named Effect references across optional schema occurrences", () => {
    const State = Schema.Record(Schema.String, Schema.Unknown).annotate({ identifier: "Message.State" })
    const output = emitEffectShape(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: Schema.Struct({
              encoded: Schema.toEncoded(Schema.Struct({ state: Schema.optionalKey(State) })),
              optional: Schema.optional(State),
            }),
          }),
        ),
      ),
      {
        typeReferences: [
          { schema: State, name: "Message.State", import: 'import type { Message } from "@example/schema/message"' },
        ],
      },
    )
    const source = output.files[0]?.content
    expect(source).toContain('readonly "state"?: Message.State')
    expect(source).toContain('readonly "optional"?: Message.State | undefined')
  })

  test("preserves decoded Goal evidence defaults while Promise output retains the optional wire field", () => {
    const defaults = Schema.Struct({ currentEvidenceIDs: SessionGoal.Info.fields.currentEvidenceIDs }).annotate({
      identifier: "GoalEvidenceDefaults",
    })
    const contract = compile(api(HttpApiEndpoint.get("get", "/goal", { success: Schema.Struct({ data: defaults }) })))
    const effect = emitEffectShape(contract).files[0]?.content
    const promise = emitPromise(contract).files.find((file) => file.path === "types.ts")?.content

    expect(Schema.decodeUnknownSync(defaults)({}).currentEvidenceIDs).toEqual([])
    expect(effect).toContain('readonly "currentEvidenceIDs": ReadonlyArray<string>')
    expect(effect).not.toContain('readonly "currentEvidenceIDs"?:')
    expect(promise).toContain('readonly "currentEvidenceIDs"?: ReadonlyArray<string>')
  })

  test("preserves Communication classes and branded identities as decoded Effect contracts", () => {
    const contract = compile(
      HttpApi.make("communication").add(
        HttpApiGroup.make("session")
          .add(
            HttpApiEndpoint.get("read", "/communication/:communicationID", {
              params: { communicationID: SessionCommunication.ID },
              success: Schema.Struct({ data: Schema.NullOr(SessionCommunication.Message) }),
            }),
          )
          .add(
            HttpApiEndpoint.post("send", "/communication", {
              payload: SessionCommunication.Send,
              success: Schema.Struct({ data: SessionCommunication.Receipt }),
            }),
          )
          .add(
            HttpApiEndpoint.get("list", "/communication", {
              success: Schema.Struct({ data: SessionCommunication.Page }),
            }),
          ),
      ),
    )
    const effect = emitEffectShape(contract, {
      typeReferences: [
        {
          schema: SessionCommunication.ID,
          name: "SessionCommunication.ID",
          import: 'import type { SessionCommunication } from "@omnixa/schema/session-communication"',
        },
        {
          schema: SessionCommunication.Send,
          name: "SessionCommunication.Send",
          import: 'import type { SessionCommunication } from "@omnixa/schema/session-communication"',
        },
        {
          schema: SessionCommunication.Receipt,
          name: "SessionCommunication.Receipt",
          import: 'import type { SessionCommunication } from "@omnixa/schema/session-communication"',
        },
        {
          schema: SessionCommunication.Message,
          name: "SessionCommunication.Message",
          import: 'import type { SessionCommunication } from "@omnixa/schema/session-communication"',
        },
        {
          schema: SessionCommunication.Page,
          name: "SessionCommunication.Page",
          import: 'import type { SessionCommunication } from "@omnixa/schema/session-communication"',
        },
      ],
    }).files[0]?.content
    const promise = emitPromise(contract).files.find((file) => file.path === "types.ts")?.content

    expect(effect).toContain('readonly "communicationID": SessionCommunication.ID')
    expect(effect).toContain('readonly "payload": SessionCommunication.Send')
    expect(effect).toContain("export type SessionReadOutput = SessionCommunication.Message | null")
    expect(effect).toContain("export type SessionSendOutput = SessionCommunication.Receipt")
    expect(effect).toContain("export type SessionListOutput = SessionCommunication.Page")
    expect(promise).not.toContain("Brand")
    expect(promise).toContain("export type SessionCommunicationID = string")
  })

  test("does not reuse named Effect references for different suffixed shapes", () => {
    const State = Schema.Record(Schema.String, Schema.Unknown).annotate({ identifier: "Message.State" })
    const Different = Schema.Record(Schema.String, Schema.Number).annotate({ identifier: "Message.State" })
    const output = emitEffectShape(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: Schema.Struct({ original: State, different: Different }),
          }),
        ),
      ),
      {
        typeReferences: [
          { schema: State, name: "Message.State", import: 'import type { Message } from "@example/schema/message"' },
        ],
      },
    )
    const source = output.files[0]?.content
    expect(source).toContain('readonly "original": Message.State')
    expect(source).toContain('readonly "different": ({ readonly [x: string]: number })')
  })

  test("preserves referenced branded Effect types across optional, record, and re-annotated shapes", () => {
    const SessionID = Schema.String.check(Schema.isStartingWith("ses_")).pipe(
      Schema.brand("Session.ID"),
      Schema.annotate({ identifier: "Session.ID" }),
    )
    const AgentID = Schema.String.pipe(Schema.brand("Agent.ID"), Schema.annotate({ identifier: "Agent.ID" }))
    const Cursor = Schema.String.pipe(
      Schema.brand("SessionsCursor"),
      Schema.annotate({ identifier: "SessionsCursor" }),
    ).annotate({ description: "Cursor" })
    const Cost = Schema.Finite.pipe(Schema.brand("Money.USD"), Schema.annotate({ identifier: "Money.USD" }))
    const output = emitEffectShape(
      compile(
        api(
          HttpApiEndpoint.get("list", "/session/:sessionID", {
            params: { sessionID: SessionID },
            query: Schema.Struct({
              agent: AgentID.pipe(Schema.optional),
              cursor: Cursor.pipe(Schema.optional),
            }),
            success: Schema.Struct({
              data: Schema.Struct({
                active: Schema.Record(SessionID, Schema.Struct({ cost: Cost })),
                agents: Schema.Array(AgentID),
              }),
            }),
          }),
        ),
      ),
      {
        typeReferences: [
          { schema: SessionID, name: "Session.ID", import: 'import type { Session } from "@example/schema/session"' },
          { schema: AgentID, name: "Agent.ID", import: 'import type { Agent } from "@example/schema/agent"' },
          {
            schema: Cursor,
            name: "SessionsCursor",
            import: 'import type { SessionsCursor } from "@example/protocol/session"',
          },
          { schema: Cost, name: "Money.USD", import: 'import type { Money } from "@example/schema/money"' },
        ],
      },
    )
    const source = output.files[0]?.content

    expect(source).toContain('import type { Session } from "@example/schema/session"')
    expect(source).toContain('import type { Agent } from "@example/schema/agent"')
    expect(source).toContain('import type { SessionsCursor } from "@example/protocol/session"')
    expect(source).toContain('import type { Money } from "@example/schema/money"')
    expect(source).toContain('readonly "sessionID": Session.ID')
    expect(source).toContain('readonly "agent"?: Agent.ID | undefined')
    expect(source).toContain('readonly "cursor"?: SessionsCursor | undefined')
    expect(source).toContain('readonly [x: Session.ID]: { readonly "cost": Money.USD }')
    expect(source).toContain('readonly "agents": ReadonlyArray<Agent.ID>')
  })

  test("allows composed Effect outputs to use an authoritative named type", () => {
    const output = emitEffectShape(compile(api(HttpApiEndpoint.get("events", "/event", { success: Schema.Unknown }))), {
      outputTypes: {
        "session.events": {
          name: "OmnixaEvent",
          import: 'import type { OmnixaEvent } from "@example/protocol/event"',
        },
      },
    })
    const source = output.files[0]?.content

    expect(source).toContain('import type { OmnixaEvent } from "@example/protocol/event"')
    expect(source).toContain("export type SessionEventsOutput = OmnixaEvent")
  })

  test("rejects authoritative Effect types colliding with generated aliases", () => {
    expect(() =>
      emitEffectShape(compile(api(HttpApiEndpoint.get("get", "/session", { success: Schema.String }))), {
        outputTypes: {
          "session.get": {
            name: "SessionGetOutput",
            import: 'import type { SessionGetOutput } from "@example/schema/session"',
          },
        },
      }),
    ).toThrow("Generated Effect type collides with imported type: SessionGetOutput")
  })

  test("rejects qualified Effect imports colliding with generated interfaces", () => {
    const Info = Schema.Struct({ id: Schema.String }).annotate({ identifier: "Session.Info" })

    expect(() =>
      emitEffectShape(compile(api(HttpApiEndpoint.get("get", "/session", { success: Info }))), {
        typeReferences: [
          {
            schema: Info,
            name: "SessionApi.Info",
            import: 'import type { SessionApi } from "@example/schema/session"',
          },
        ],
      }),
    ).toThrow("Generated Effect type collides with imported type: SessionApi")
  })

  test("rejects imported endpoints colliding with generated adapter values", () => {
    const contract = compile(api(HttpApiEndpoint.get("session.get", "/session", { success: Schema.String })))

    expect(() =>
      emitEffectImported(contract, {
        module: "@example/api",
        endpoints: { "session.session.get": "EndpointSessionGet" },
      }),
    ).toThrow("Generated Effect adapter collides with imported endpoint: EndpointSessionGet")
    expect(() =>
      emitEffectImported(contract, {
        module: "@example/api",
        api: "EndpointSessionGet",
      }),
    ).toThrow("Generated Effect adapter collides with imported endpoint: EndpointSessionGet")
  })

  test("exposes an imported Effect client through its generated shape and rejects widened outputs", () => {
    const output = emitEffectImported(
      compile(api(HttpApiEndpoint.get("get", "/session", { success: Schema.String }))),
      { module: "@example/api", api: "Api", shapeModule: "../api" },
    )
    const source = output.files.find((file) => file.path === "client.ts")?.content

    expect(source).toContain('import type { SessionGetOutput } from "../api"')
    expect(source).toContain("preserveEffect<SessionGetOutput>()")
    expect(source).toContain("__generatedOutputWiderThanContract")

    type BrandedID = string & Brand.Brand<"Session.ID">
    const preserveEffect =
      <A>() =>
      <Actual extends A, E, R>(
        effect: Effect.Effect<Actual, E, R> &
          ([A] extends [Actual]
            ? unknown
            : { readonly __generatedOutputWiderThanContract: [expected: Actual, generated: A] }),
      ): Effect.Effect<A, E, R> =>
        effect
    const preserveStream =
      <A>() =>
      <Actual extends A, E, R>(
        stream: Stream.Stream<Actual, E, R> &
          ([A] extends [Actual]
            ? unknown
            : { readonly __generatedOutputWiderThanContract: [expected: Actual, generated: A] }),
      ): Stream.Stream<A, E, R> =>
        stream

    const brandedEffect = Effect.succeed("ses_1" as BrandedID)
    const brandedStream = Stream.make("ses_1" as BrandedID)

    preserveEffect<BrandedID>()(brandedEffect)
    preserveStream<BrandedID>()(brandedStream)
    // @ts-expect-error Generated output cannot widen a branded contract output to plain string.
    preserveEffect<string>()(brandedEffect)
    // @ts-expect-error Generated stream output cannot widen a branded contract output to plain string.
    preserveStream<string>()(brandedStream)
  })

  test("projects imported endpoint constants into a generated API", () => {
    const output = emitEffectImported(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.Struct({ data: Schema.String }),
          }),
        ),
      ),
      { module: "@example/api", endpoints: { "session.get": "SessionGet" } },
    )
    const client = output.files.find((file) => file.path === "client.ts")?.content

    expect(client).toContain('import { SessionGet } from "@example/api"')
    expect(client).toContain('const Api = HttpApi.make("generated").add(HttpApiGroup.make("session").add(SessionGet))')
  })

  test("imports an authoritative group without reconstructing it", () => {
    const output = emitEffectImported(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.String,
          }),
        ),
      ),
      { module: "@example/api", group: "SessionGroup" },
    )
    const client = output.files.find((file) => file.path === "client.ts")?.content

    expect(client).toContain('import { SessionGroup } from "@example/api"')
    expect(client).toContain('const Api = HttpApi.make("generated").add(SessionGroup)')
    expect(client).not.toContain("HttpApiGroup")
  })

  test("separates hosted and consumer group names", () => {
    const source = HttpApi.make("test").add(
      HttpApiGroup.make("server.session").add(
        HttpApiEndpoint.get("session.get", "/session", { success: Schema.String }),
      ),
    )
    const contract = compile(source, { groupNames: { "server.session": "sessions" } })

    expect(contract.groups[0]?.identifier).toBe("sessions")
    expect(contract.groups[0]?.sourceIdentifier).toBe("server.session")
    expect(contract.groups[0]?.endpoints[0]?.operation).toMatchObject({ group: "sessions", name: "get" })
  })

  test("derives nested paths from OpenAPI operation IDs", () => {
    const source = HttpApi.make("test").add(
      HttpApiGroup.make("server.session").add(
        HttpApiEndpoint.get("internal.stage", "/session/revert/stage", { success: Schema.String }).annotateMerge(
          OpenApi.annotations({ identifier: "v2.session.revert.stage" }),
        ),
      ),
    )
    const contract = compile(source, { groupNames: { "server.session": "session" } })

    expect(contract.groups[0]?.endpoints[0]?.clientPath).toEqual(["revert", "stage"])
    expect(OpenApi.fromApi(source).paths["/session/revert/stage"]?.get?.operationId).toBe("v2.session.revert.stage")
  })

  test("uses nested OpenAPI operation IDs across emitters", () => {
    const source = HttpApi.make("test").add(
      HttpApiGroup.make("server.session")
        .add(
          HttpApiEndpoint.get("list", "/session/instructions", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "v2.session.instructions.list" }),
          ),
        )
        .add(
          HttpApiEndpoint.put("put", "/session/instructions", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "v2.session.instructions.put" }),
          ),
        )
        .add(
          HttpApiEndpoint.delete("remove", "/session/instructions", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "v2.session.instructions.remove" }),
          ),
        ),
    )
    const contract = compile(source, { groupNames: { "server.session": "session" } })

    expect(contract.groups[0]?.endpoints.map((endpoint) => endpoint.clientPath)).toEqual([
      ["instructions", "list"],
      ["instructions", "put"],
      ["instructions", "remove"],
    ])
    expect(contract.groups[0]?.endpoints.map((endpoint) => endpoint.operation.name)).toEqual([
      "instructions.list",
      "instructions.put",
      "instructions.remove",
    ])

    const promise = emitPromise(contract, {
      outputTypes: {
        "session.instructions.list": {
          name: "InstructionListWire",
          import: 'import type { InstructionListWire } from "./instruction-list-wire"',
        },
      },
    })
    const promiseClient = promise.files.find((file) => file.path === "client.ts")?.content
    const promiseTypes = promise.files.find((file) => file.path === "types.ts")?.content
    expect(promiseClient).toContain('"session": { "instructions": { "list": (requestOptions?: RequestOptions)')
    expect(promiseClient).toContain('"put": (requestOptions?: RequestOptions)')
    expect(promiseClient).toContain('"remove": (requestOptions?: RequestOptions)')
    expect(promiseTypes).toContain('import type { InstructionListWire } from "./instruction-list-wire"')
    expect(promiseTypes).toContain("export type SessionInstructionsListOutput = InstructionListWire")
    expect(promiseTypes).toContain("export type SessionInstructionsPutOutput = string")
    expect(promiseTypes).toContain("export type SessionInstructionsRemoveOutput = string")

    const effect = emitEffect(contract)
    expect(effect.files.find((file) => file.path === "session.ts")?.content).toContain(
      '"instructions": { "list": EndpointInstructionsList(raw), "put": EndpointInstructionsPut(raw), "remove": EndpointInstructionsRemove(raw) }',
    )

    const imported = emitEffectImported(contract, { module: "@example/api", api: "Api" })
    expect(imported.files.find((file) => file.path === "client.ts")?.content).toContain(
      '"instructions": { "list": EndpointSessionInstructionsList(raw), "put": EndpointSessionInstructionsPut(raw), "remove": EndpointSessionInstructionsRemove(raw) }',
    )

    const shape = emitEffectShape(contract)
    const apiShape = shape.files.find((file) => file.path === "api.ts")?.content
    expect(apiShape).toContain('readonly "instructions": { readonly "list": SessionInstructionsListOperation<E>')
    expect(apiShape).toContain('readonly "put": SessionInstructionsPutOperation<E>')
    expect(apiShape).toContain('readonly "remove": SessionInstructionsRemoveOperation<E>')
  })

  test("executes nested Promise operation IDs", async () => {
    const source = HttpApi.make("test").add(
      HttpApiGroup.make("session")
        .add(
          HttpApiEndpoint.get("list", "/session/instructions", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "session.instructions.list" }),
          ),
        )
        .add(
          HttpApiEndpoint.put("put", "/session/instructions", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "session.instructions.put" }),
          ),
        )
        .add(
          HttpApiEndpoint.delete("remove", "/session/instructions", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "session.instructions.remove" }),
          ),
        ),
    )
    const output = emitPromise(compile(source))
    await using emitted = await emittedModule(output)
    const methods: Array<string> = []

    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
        methods.push(init?.method ?? "GET")
        return Response.json("ok")
      },
    })

    expect(await client.session.instructions.list()).toBe("ok")
    expect(await client.session.instructions.put()).toBe("ok")
    expect(await client.session.instructions.remove()).toBe("ok")
    expect(methods).toEqual(["GET", "PUT", "DELETE"])
  })

  test("rejects duplicate and leaf-namespace endpoint paths", () => {
    const source = HttpApi.make("test").add(
      HttpApiGroup.make("session")
        .add(
          HttpApiEndpoint.get("first", "/first", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "session.instructions.list" }),
          ),
        )
        .add(
          HttpApiEndpoint.get("second", "/second", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "session.instructions.list" }),
          ),
        ),
    )

    expect(() => compile(source)).toThrow("Client endpoint name collision: session.instructions.list")
  })

  test("rejects nested root collisions across top-level groups", () => {
    const source = HttpApi.make("test")
      .add(
        HttpApiGroup.make("first", { topLevel: true }).add(
          HttpApiEndpoint.get("first.list", "/first", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "instructions.list" }),
          ),
        ),
      )
      .add(
        HttpApiGroup.make("second", { topLevel: true }).add(
          HttpApiEndpoint.get("second.put", "/second", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "instructions.put" }),
          ),
        ),
      )

    expect(() => compile(source)).toThrow("Client name collision: instructions")
  })

  test("rejects nested paths that collide after type-name normalization", () => {
    const source = HttpApi.make("test").add(
      HttpApiGroup.make("session")
        .add(
          HttpApiEndpoint.get("first", "/first", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "session.foo.bar" }),
          ),
        )
        .add(
          HttpApiEndpoint.get("second", "/second", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "session.foo-bar" }),
          ),
        ),
    )

    expect(() => compile(source)).toThrow("Client endpoint type collision: SessionFooBar")
  })

  test("rejects ambiguous and prototype-mutating nested path segments", () => {
    const source = api(
      HttpApiEndpoint.get("get", "/session", { success: Schema.String }).annotateMerge(
        OpenApi.annotations({ identifier: "session.__proto__.get" }),
      ),
    )

    expect(() => compile(source)).toThrow("Client endpoint path cannot contain __proto__")
  })

  test("rejects normalized group, operation-key, and group prototype collisions", () => {
    const sanitized = HttpApi.make("test")
      .add(HttpApiGroup.make("foo-bar").add(HttpApiEndpoint.get("get", "/first", { success: Schema.String })))
      .add(HttpApiGroup.make("foo.bar").add(HttpApiEndpoint.get("get", "/second", { success: Schema.String })))
    expect(() => compile(sanitized)).toThrow("Client module name collision: foo-bar")

    const normalized = HttpApi.make("test")
      .add(HttpApiGroup.make("foo_bar").add(HttpApiEndpoint.get("get", "/first", { success: Schema.String })))
      .add(HttpApiGroup.make("foo.bar").add(HttpApiEndpoint.get("get", "/second", { success: Schema.String })))
    expect(() => compile(normalized)).toThrow("Client group type collision: FooBar")

    const endpointType = HttpApi.make("test")
      .add(
        HttpApiGroup.make("foo").add(
          HttpApiEndpoint.get("first", "/first", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "foo.bar.baz" }),
          ),
        ),
      )
      .add(
        HttpApiGroup.make("fooBar").add(
          HttpApiEndpoint.get("second", "/second", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "fooBar.baz" }),
          ),
        ),
      )
    expect(() => compile(endpointType)).toThrow("Client endpoint type collision: FooBarBaz")

    const operationKey = HttpApi.make("test")
      .add(
        HttpApiGroup.make("a.b").add(
          HttpApiEndpoint.get("get", "/first", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "a.b.c" }),
          ),
        ),
      )
      .add(
        HttpApiGroup.make("a").add(
          HttpApiEndpoint.get("b.c", "/second", { success: Schema.String }).annotateMerge(
            OpenApi.annotations({ identifier: "a.b.c" }),
          ),
        ),
      )
    expect(() => compile(operationKey)).toThrow("Client operation key collision: a.b.c")

    const prototype = HttpApi.make("test").add(
      HttpApiGroup.make("session").add(HttpApiEndpoint.get("get", "/session", { success: Schema.String })),
    )
    expect(() => compile(prototype, { groupNames: { session: "__proto__" } })).toThrow(
      "Client group name cannot be __proto__",
    )
  })

  test("omits custom transport endpoints", () => {
    const source = HttpApi.make("test").add(
      HttpApiGroup.make("server.pty")
        .add(HttpApiEndpoint.get("pty.get", "/pty", { success: Schema.String }))
        .add(HttpApiEndpoint.get("pty.connect", "/pty/connect", { success: Schema.Boolean })),
    )
    const contract = compile(source, { omitEndpoints: new Set(["pty.connect"]) })

    expect(contract.groups[0]?.endpoints.map((endpoint) => endpoint.endpoint.identifier)).toEqual(["pty.get"])
  })

  test("uses bracket access for input field names", () => {
    const source = api(
      HttpApiEndpoint.post("token", "/token", {
        headers: { "x-example-token": Schema.Literal("1") },
        success: Schema.String,
      }),
    )
    const contract = compile(source)
    const promise = emitPromise(contract).files.find((file) => file.path === "client.ts")?.content
    const effect = emitEffectImported(contract, {
      module: "@example/api",
      endpoints: { "session.token": "Token" },
    }).files.find((file) => file.path === "client.ts")?.content

    expect(promise).toContain('"x-example-token": input["x-example-token"]')
    expect(effect).toContain('"x-example-token": input["x-example-token"]')
  })

  test("rejects consumer group name collisions", () => {
    const source = HttpApi.make("test")
      .add(HttpApiGroup.make("first").add(HttpApiEndpoint.get("one", "/one", { success: Schema.String })))
      .add(HttpApiGroup.make("second").add(HttpApiEndpoint.get("two", "/two", { success: Schema.String })))

    expect(() => compile(source, { groupNames: { first: "same", second: "same" } })).toThrow(
      "Client group name collision: same",
    )
  })

  test("uses the unqualified endpoint name for the public client", () => {
    const contract = compile(
      api(
        HttpApiEndpoint.get("session.get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          success: Schema.String,
        }),
      ),
    )
    const promise = emitPromise(contract).files.find((file) => file.path === "client.ts")?.content
    const effect = emitEffectImported(contract, {
      module: "@example/api",
      endpoints: { "session.session.get": "SessionGet" },
    }).files.find((file) => file.path === "client.ts")?.content

    expect(contract.groups[0]?.endpoints[0]?.operation.name).toBe("get")
    expect(promise).toContain('"get": (input: SessionGetInput, requestOptions?: RequestOptions)')
    expect(effect).toContain(
      'const adaptGroupSession = (raw: RawClient["session"]) => ({ "get": EndpointSessionGet(raw) })',
    )
    expect(effect).toContain('raw["session.get"]')
  })

  test("preserves optional keys in Promise error types", () => {
    class OptionalError extends Schema.TaggedError<OptionalError>()(
      "OptionalError",
      { message: Schema.String, detail: Schema.String.pipe(Schema.optional) },
      { httpApiStatus: 400 },
    ) {}
    const output = emitPromise(
      compile(api(HttpApiEndpoint.get("get", "/session", { success: Schema.String, error: OptionalError }))),
    )

    expect(output.files.find((file) => file.path === "types.ts")?.content).toContain(
      'readonly "message": string; readonly "detail"?: string | undefined',
    )
  })

  test("supports name-discriminated Promise errors", () => {
    class NamedError extends Schema.Error<NamedError>("NamedError")(
      { name: Schema.Literal("NamedError"), message: Schema.String },
      { httpApiStatus: 400 },
    ) {}
    const output = emitPromise(
      compile(api(HttpApiEndpoint.get("get", "/session", { success: Schema.NumberFromString, error: NamedError }))),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain('readonly "name": "NamedError"')
    expect(types).toContain('"name" in value && value["name"] === "NamedError"')
  })

  test("preserves reflected default error statuses", () => {
    class MissingStatus extends Schema.TaggedError<MissingStatus>()("MissingStatus", {
      message: Schema.String,
    }) {}
    const output = emitPromise(
      compile(api(HttpApiEndpoint.get("get", "/session", { success: Schema.String, error: MissingStatus }))),
    )

    expect(output.files.find((file) => file.path === "client.ts")?.content).toContain("declaredStatuses: [500]")
  })

  test("erases brands from Promise wire types", () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String.pipe(Schema.brand("SessionID")) },
            success: Schema.Struct({ data: Schema.String.pipe(Schema.brand("SessionID")) }),
          }),
        ),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain('readonly "sessionID": string')
    expect(types).not.toContain("Brand")
  })

  test("preserves suggestions for open string unions in Promise wire types", () => {
    const Field = Schema.Union([Schema.Literals(["reasoning", "reasoning_content"]), Schema.String]).annotate({
      identifier: "Field",
    })
    const output = emitPromise(
      compile(api(HttpApiEndpoint.get("get", "/model", { success: Schema.Struct({ field: Field }) }))),
    )

    expect(output.files.find((file) => file.path === "types.ts")?.content).toContain(
      'export type Field = "reasoning" | "reasoning_content" | (string & {})',
    )
  })

  test("retains non-recursive references in Promise wire types", () => {
    const Referenced = Schema.Struct({ value: Schema.String }).annotate({ identifier: "Referenced" })
    const output = emitPromise(
      compile(
        HttpApi.make("test").add(
          HttpApiGroup.make("session")
            .add(HttpApiEndpoint.get("get", "/session", { success: Schema.Struct({ data: Referenced }) }))
            .add(
              HttpApiEndpoint.get("list", "/sessions", {
                success: Schema.Struct({ data: Schema.Array(Referenced) }),
              }),
            ),
        ),
      ),
    )

    const types = output.files.find((file) => file.path === "types.ts")?.content
    expect(types).toContain('export type Referenced = { readonly "value": string }')
    expect(types).toContain('export type SessionGetOutput = ({ readonly "data": Referenced })["data"]')
    expect(types).not.toContain("Referenced1")
  })

  test("inlines shared anonymous Promise wire types", () => {
    const Shared = Schema.Struct({ value: Schema.String })
    const output = emitPromise(
      compile(
        api(HttpApiEndpoint.get("get", "/session", { success: Schema.Struct({ first: Shared, second: Shared }) })),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain('readonly "first": { readonly "value": string }')
    expect(types).toContain('readonly "second": { readonly "value": string }')
    expect(types).not.toContain("export type Objects")
  })

  test("emits mutable Promise outputs without restricting inputs", () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.post("create", "/session", {
            payload: Schema.Struct({ values: Schema.Array(Schema.String) }),
            success: Schema.Struct({ data: Schema.Array(Schema.Struct({ values: Schema.Array(Schema.String) })) }),
          }),
        ),
      ),
      { mutableOutputs: true },
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain('readonly "values": ReadonlyArray<string>')
    expect(types).toContain(
      'export type SessionCreateOutput = ({ "data": Array<{ "values": Array<string> }> })["data"]',
    )
  })

  test("retains distinct Promise references at identifier boundaries", () => {
    const Session = Schema.Struct({ name: Schema.Literal("Session"), id: Schema.String }).annotate({
      identifier: "Session",
    })
    const SessionID = Schema.String.annotate({ identifier: "SessionID" })
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: Schema.Struct({ session: Session, sessionID: SessionID }),
          }),
        ),
      ),
    )

    const types = output.files.find((file) => file.path === "types.ts")?.content
    expect(types).toContain('export type Session = { readonly "name": "Session", readonly "id": string }')
    expect(types).toContain("export type SessionID = string")
    expect(types).toContain('readonly "session": Session, readonly "sessionID": SessionID')
  })

  test("disambiguates flattened Promise reference names", () => {
    const First = Schema.String.annotate({ identifier: "ExampleName" })
    const Second = Schema.String.annotate({ identifier: "Example_Name" })
    const output = emitPromise(
      compile(
        api(HttpApiEndpoint.get("get", "/session", { success: Schema.Struct({ first: First, second: Second }) })),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain("export type ExampleName = string")
    expect(types).toContain("export type ExampleName2 = string")
    expect(types).toContain('readonly "first": ExampleName, readonly "second": ExampleName2')
  })

  test.each([false, true])(
    "preserves canonical and legacy Promise references with mutable outputs %s",
    (mutableOutputs) => {
      const Current = Schema.Struct({ disabled: Schema.Boolean }).annotate({ identifier: "Mcp.RemoteConfig" })
      const Legacy = Schema.Struct({ enabled: Schema.Boolean }).annotate({ identifier: "McpRemoteConfig" })
      const CurrentBox = Schema.Struct({ config: Current }).annotate({ identifier: "Config.Box" })
      const LegacyBox = Schema.Struct({ config: Legacy }).annotate({ identifier: "Config.Box" })
      const EquivalentBox = Schema.Struct({ config: Current }).annotate({
        identifier: "Config.Box",
        description: "Same canonical config",
      })
      const output = emitPromise(
        compile(
          api(
            HttpApiEndpoint.get("get", "/session", {
              success: Schema.Struct({
                current: Current,
                legacy: Legacy,
                currentBox: CurrentBox,
                legacyBox: LegacyBox,
                equivalentBox: EquivalentBox,
                configs: Schema.Array(Current),
                servers: Schema.Record(Schema.String, Legacy),
              }),
            }),
          ),
        ),
        { mutableOutputs },
      )
      const types = output.files.find((file) => file.path === "types.ts")?.content
      const modifier = mutableOutputs ? "" : "readonly "

      expect(types).toContain(`export type McpRemoteConfig = { ${modifier}"disabled": boolean }`)
      expect(types).toContain(`export type McpRemoteConfig2 = { ${modifier}"enabled": boolean }`)
      expect(types).toContain(`export type ConfigBox = { ${modifier}"config": McpRemoteConfig }`)
      expect(types).toContain(`export type ConfigBox1 = { ${modifier}"config": McpRemoteConfig2 }`)
      expect(types).toContain(`${modifier}"current": McpRemoteConfig, ${modifier}"legacy": McpRemoteConfig2`)
      expect(types).toContain(
        `${modifier}"currentBox": ConfigBox, ${modifier}"legacyBox": ConfigBox1, ${modifier}"equivalentBox": ConfigBox,`,
      )
      expect(types).toContain(`${modifier}"configs": ${mutableOutputs ? "Array" : "ReadonlyArray"}<McpRemoteConfig>`)
      expect(types).toContain(`${modifier}"servers": { ${modifier}[x: string]: McpRemoteConfig2 }`)
      expect(types?.match(/export type ConfigBox =/g)).toHaveLength(1)
      expect(types).not.toContain("export type ConfigBox2")
    },
  )

  test.each([false, true])("preserves Promise string literals with mutable outputs %s", (mutableOutputs) => {
    const Current = Schema.String.annotate({ identifier: "Mcp.RemoteConfig" })
    const Legacy = Schema.Boolean.annotate({ identifier: "McpRemoteConfig" })
    const literals = [
      "McpRemoteConfig",
      "prefix McpRemoteConfig suffix",
      'prefix "McpRemoteConfig" suffix',
      "prefix 'McpRemoteConfig' suffix",
      "Schema.Json",
      "prefix Schema.Json suffix",
      "an unknown value",
      "readonly value",
      "ReadonlyArray<unknown>",
    ]
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: Schema.Struct({ current: Current, legacy: Legacy, label: Schema.Literals(literals) }),
          }),
        ),
      ),
      { mutableOutputs },
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    literals.forEach((literal) => expect(types).toContain(JSON.stringify(literal)))
  })

  test("preserves canonical MCP config and legacy OAuth contracts in Promise outputs", () => {
    const output = emitPromise(
      compile(
        HttpApi.make("test").add(
          HttpApiGroup.make("config")
            .add(HttpApiEndpoint.get("current", "/config", { success: ConfigMCP.Info }))
            .add(HttpApiEndpoint.get("legacy", "/config/legacy", { success: ConfigMCPV1.Info })),
        ),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content ?? ""
    const currentRemote = types.split("\n\n").find((type) => type.startsWith("export type McpRemoteConfig ="))
    const legacyRemote = types.split("\n\n").find((type) => type.startsWith("export type McpRemoteConfig2 ="))
    const currentLocal = types.split("\n\n").find((type) => type.startsWith("export type McpLocalConfig2 ="))
    const legacyLocal = types.split("\n\n").find((type) => type.startsWith("export type McpLocalConfig ="))

    expect(types).toContain('readonly "servers"?: { readonly [x: string]: McpLocalConfig2 | McpRemoteConfig }')
    expect(currentLocal).toContain('readonly "disabled"?: boolean')
    expect(currentLocal).toContain('readonly "timeout"?: McpTimeoutConfig')
    expect(legacyLocal).toContain('readonly "enabled"?: boolean')
    expect(legacyLocal).toContain('readonly "timeout"?: number')
    expect(currentRemote).toContain('readonly "disabled"?: boolean')
    expect(currentRemote).toContain('readonly "timeout"?: McpTimeoutConfig')
    expect(currentRemote).toContain('readonly "oauth"?: McpOAuthConfig | false')
    expect(legacyRemote).toContain('readonly "enabled"?: boolean')
    expect(legacyRemote).toContain('readonly "timeout"?: number')
    expect(legacyRemote).toContain('readonly "oauth"?: McpOAuthConfig2 | false')
    expect(types).toContain('export type McpOAuthConfig = { readonly "client_id"?: string')
    expect(types).toContain('export type McpOAuthConfig2 = { readonly "clientId"?: string')
    expect(types).toContain("export type ConfigCurrentOutput = ConfigMCP")
    expect(types).toContain("export type ConfigLegacyOutput = McpLocalConfig | McpRemoteConfig2")
  })

  test("preserves literals while inlining Promise input and anonymous output references", () => {
    const Referenced = Schema.Struct({ value: Schema.String }).annotate({ identifier: "Example" })
    const Shared = Schema.Struct({ label: Schema.Literal("prefix Objects suffix $& __PROMISE_TYPE_1__") })
    const output = emitPromise(
      compile(
        HttpApi.make("test").add(
          HttpApiGroup.make("session")
            .add(
              HttpApiEndpoint.post("create", "/session", {
                payload: Schema.Struct({
                  config: Referenced,
                  label: Schema.Literal("prefix Example suffix"),
                  json: Schema.Literal("Schema.Json"),
                }),
                success: Schema.Struct({ first: Shared, second: Shared }),
              }),
            )
            .add(HttpApiEndpoint.get("get", "/session", { success: Schema.Boolean })),
        ),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content ?? ""
    const input = types.split("\n\n").find((type) => type.startsWith("export type SessionCreateInput ="))
    const result = types.split("\n\n").find((type) => type.startsWith("export type SessionCreateOutput ="))

    expect(input).toContain('readonly "value": string')
    expect(input).toContain('readonly "label": "prefix Example suffix"')
    expect(input).toContain('readonly "json": "Schema.Json"')
    expect(result).toContain('readonly "first": { readonly "label": "prefix Objects suffix $& __PROMISE_TYPE_1__" }')
    expect(result).toContain('readonly "second": { readonly "label": "prefix Objects suffix $& __PROMISE_TYPE_1__" }')
    expect(types).toContain("export type SessionGetOutput = boolean")
  })

  test("preserves distinct Promise identifiers with authored numeric suffixes", () => {
    const First = Schema.String.annotate({ identifier: "Shared" })
    const Second = Schema.String.annotate({ identifier: "Shared_1" })
    const output = emitPromise(
      compile(
        api(HttpApiEndpoint.get("get", "/session", { success: Schema.Struct({ first: First, second: Second }) })),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain("export type Shared = string")
    expect(types).toContain("export type Shared1 = string")
    expect(types).toContain('readonly "first": Shared, readonly "second": Shared1')
  })

  test("preserves checked Promise identifiers with authored numeric suffixes", () => {
    const First = Schema.Int.annotate({ identifier: "Checked" })
    const Second = Schema.Int.annotate({ identifier: "Checked_1" })
    const output = emitPromise(
      compile(
        api(HttpApiEndpoint.get("get", "/session", { success: Schema.Struct({ first: First, second: Second }) })),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain("export type Checked = number")
    expect(types).toContain("export type Checked1 = number")
    expect(types).toContain('readonly "first": Checked, readonly "second": Checked1')
  })

  test("preserves Promise names across shared contextual schemas and flattened collisions", () => {
    const Shared = Schema.String.annotate({ identifier: "ProbeName" })
    const Authored = Schema.Boolean.annotate({ identifier: "ProbeName1" })
    const Underscore = Schema.Null.annotate({ identifier: "ProbeName_1" })
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: Schema.Struct({
              required: Shared,
              optional: Schema.optionalKey(Shared),
              authored: Authored,
              underscore: Underscore,
            }),
          }),
        ),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain("export type ProbeName = string")
    expect(types).toContain("export type ProbeName1 = boolean")
    expect(types).toContain("export type ProbeName12 = null")
    expect(types).toContain(
      'readonly "required": ProbeName, readonly "optional"?: ProbeName, readonly "authored": ProbeName1, readonly "underscore": ProbeName12',
    )
  })

  test.each(["ordinary-first", "defaults-first"])(
    "preserves Promise encoded ProductMode defaults with %s traversal",
    (order) => {
      const Defaulted = Schema.Struct({ mode: Session.Info.fields.mode }).annotate({ identifier: "DefaultedMode" })
      const Identity = Schema.Struct({ mode: ProductMode.ID }).annotate({ identifier: "ModeIdentity" })
      const ordinaryModes = Schema.Array(ProductMode.ID)
      const fields =
        order === "ordinary-first"
          ? { ordinaryModes, defaulted: Defaulted, identity: Identity }
          : { defaulted: Defaulted, ordinaryModes, identity: Identity }
      const output = emitPromise(
        compile(api(HttpApiEndpoint.get("get", "/session", { success: Schema.Struct(fields) }))),
      )
      const types = output.files.find((file) => file.path === "types.ts")?.content

      expect(Schema.decodeUnknownSync(Defaulted)({}).mode).toBe(ProductMode.Default)
      expect(() => Schema.decodeUnknownSync(Identity)({})).toThrow()
      expect(types).toContain('export type DefaultedMode = { readonly "mode"?: ProductMode }')
      expect(types).toContain('export type ModeIdentity = { readonly "mode": ProductMode }')
      expect(types).toContain('readonly "ordinaryModes": ReadonlyArray<ProductMode>')
    },
  )

  test("keeps conflicting Promise reference identifiers distinct", () => {
    const First = Schema.Struct({ value: Schema.String }).annotate({ identifier: "Shared" })
    const Second = Schema.Struct({ value: Schema.Number }).annotate({ identifier: "Shared" })

    const output = emitPromise(
      compile(
        api(HttpApiEndpoint.get("get", "/session", { success: Schema.Struct({ first: First, second: Second }) })),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain('export type Shared = { readonly "value": string }')
    expect(types).toContain('export type Shared1 = { readonly "value": number }')
    expect(types).toContain('readonly "first": Shared, readonly "second": Shared1')
  })

  test("deduplicates equivalent Promise references with the same identifier", () => {
    const First = Schema.String.annotate({ identifier: "Shared", description: "first" })
    const Second = Schema.String.annotate({ identifier: "Shared", description: "second" })
    const output = emitPromise(
      compile(
        api(HttpApiEndpoint.get("get", "/session", { success: Schema.Struct({ first: First, second: Second }) })),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain("export type Shared = string")
    expect(types).not.toContain("export type Shared1")
    expect(types).toContain('readonly "first": Shared, readonly "second": Shared')
  })

  test("emits Effect Json schemas as standalone Promise types", () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: Schema.Json,
          }),
        ),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain("export type JsonValue =")
    expect(types).toContain("{ readonly [key: string]: JsonValue }")
    expect(types).not.toContain("Schema.Json")
  })

  test("emits an optional Promise input when every field is optional", () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("list", "/session", {
            query: { limit: Schema.optional(Schema.Number) },
            success: Schema.Array(Schema.String),
          }),
        ),
      ),
    )

    expect(output.files.find((file) => file.path === "client.ts")?.content).toContain(
      '"list": (input?: SessionListInput, requestOptions?: RequestOptions)',
    )
  })

  test("rejects Promise transports that are not implemented", () => {
    expect(() =>
      emitPromise(
        compile(
          api(
            HttpApiEndpoint.get("text", "/text", {
              success: Schema.String.pipe(HttpApiSchema.asText()),
            }),
          ),
        ),
      ),
    ).toThrow("Unsupported Promise success encoding: session.text")

    expect(() =>
      emitPromise(compile(api(HttpApiEndpoint.get("read", "/file/*/tail", { success: Schema.String })))),
    ).toThrow("Unsupported Promise path wildcard: /file/*/tail")

    expect(() =>
      emitPromise(
        compile(
          api(
            HttpApiEndpoint.get("events", "/events", {
              success: HttpApiSchema.StreamSse({ data: Schema.String, error: Missing }),
            }),
          ),
        ),
      ),
    ).toThrow("Unsupported Promise stream: session.events")
  })

  test("executes an emitted Promise GET through fetch", async () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.Struct({ data: Schema.String }),
          }),
        ),
      ),
    )
    await using emitted = await emittedModule(output)
    let request: Request | undefined
    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com/base?tenant=one#fragment",
      fetch: async (input: RequestInfo | URL) => {
        request = input instanceof Request ? input : new Request(input)
        return Response.json({ data: "hello" })
      },
    })

    expect(await client.session.get({ sessionID: "a/b" })).toBe("hello")
    expect(request?.method).toBe("GET")
    expect(request?.url).toBe("https://example.com/base/session/a%2Fb")
  })

  test("maps an emitted no-content response to undefined", async () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.post("interrupt", "/session/:sessionID/interrupt", {
            params: { sessionID: Schema.String },
            success: HttpApiSchema.NoContent,
          }),
        ),
      ),
    )
    await using emitted = await emittedModule(output)
    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async () => new Response(null, { status: 204 }),
    })

    expect(await client.session.interrupt({ sessionID: "session" })).toBeUndefined()
  })

  test("executes an emitted binary wildcard GET through fetch", async () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("read", "/file/*", {
            query: { token: Schema.optional(Schema.String) },
            success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
          }),
        ),
      ),
    )
    await using emitted = await emittedModule(output)
    let request: Request | undefined
    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async (input: RequestInfo | URL) => {
        request = input instanceof Request ? input : new Request(input)
        return new Response(new Uint8Array([1, 2, 3]))
      },
    })

    const result = await client.session.read({ path: "src/a b#c.ts", token: "x/y" })
    expect(result).toBeInstanceOf(Uint8Array)
    expect(Array.from(result)).toEqual([1, 2, 3])
    expect(request?.method).toBe("GET")
    expect(request?.url).toBe("https://example.com/file/src/a%20b%23c.ts?token=x%2Fy")
  })

  test("serializes flattened query, header, and JSON payload inputs", async () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.post("prompt", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            query: { resume: Schema.optional(Schema.Boolean) },
            headers: { traceID: Schema.String },
            payload: Schema.Struct({ prompt: Schema.String }),
            success: Schema.Struct({ data: Schema.String }),
          }),
        ),
      ),
    )
    await using emitted = await emittedModule(output)
    let request: Request | undefined
    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        request = input instanceof Request ? input : new Request(input, init)
        return Response.json({ data: "admitted" })
      },
    })

    expect(await client.session.prompt({ sessionID: "session", resume: true, traceID: "trace", prompt: "hello" })).toBe(
      "admitted",
    )
    expect(request?.url).toBe("https://example.com/session/session?resume=true")
    expect(request?.headers.get("traceID")).toBe("trace")
    expect(await request?.json()).toEqual({ prompt: "hello" })
  })

  test("serializes an opaque union payload as the direct JSON body", async () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.post("configure", "/session", {
            payload: Schema.Union([
              Schema.Struct({ type: Schema.Literal("local"), command: Schema.Array(Schema.String) }),
              Schema.Struct({ type: Schema.Literal("remote"), url: Schema.String }),
            ]),
            success: HttpApiSchema.NoContent,
          }),
        ),
      ),
    )
    await using emitted = await emittedModule(output)
    let request: Request | undefined
    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        request = input instanceof Request ? input : new Request(input, init)
        return new Response(null, { status: 204 })
      },
    })

    await client.session.configure({ payload: { type: "local", command: ["omnixa"] } })

    expect(await request?.json()).toEqual({ type: "local", command: ["omnixa"] })
  })

  test("serializes explicit null query values", async () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("list", "/session", {
            query: { parentID: Schema.optional(Schema.NullOr(Schema.String)) },
            success: Schema.Struct({ data: Schema.Array(Schema.String) }),
          }),
        ),
      ),
    )
    await using emitted = await emittedModule(output)
    let request: Request | undefined
    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        request = input instanceof Request ? input : new Request(input, init)
        return Response.json({ data: [] })
      },
    })

    await client.session.list({ parentID: null })

    expect(request?.url).toBe("https://example.com/session?parentID=null")
  })

  test("rejects with declared tagged errors and exports a type guard", async () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("get", "/session/:sessionID", {
            params: { sessionID: Schema.String },
            success: Schema.Struct({ data: Schema.String }),
            error: Missing.pipe(HttpApiSchema.status(404)),
          }),
        ),
      ),
    )
    await using emitted = await emittedModule(output)
    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async () => Response.json({ _tag: "Missing", message: "gone" }, { status: 404 }),
    })

    const error = await client.session.get({ sessionID: "missing" }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: "Missing", message: "gone", _tag: "Missing" })
    expect(emitted.module.isMissing(error)).toBeTrue()
  })

  test("iterates an emitted SSE stream lazily without reconnecting", async () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("subscribe", "/event", {
            query: { after: Schema.optional(Schema.Number) },
            success: HttpApiSchema.StreamSse({
              data: Schema.Struct({ type: Schema.String, count: Schema.NumberFromString }),
            }),
          }),
        ),
      ),
    )
    await using emitted = await emittedModule(output)
    let requests = 0
    let url: string | undefined
    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async (input: RequestInfo | URL) => {
        requests++
        url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        const encoder = new TextEncoder()
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: {"type":"ready","count":"1"}\r'))
              controller.enqueue(encoder.encode("\n\r\n"))
              controller.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })
    const events = client.session.subscribe({ after: 2 })

    expect(requests).toBe(0)
    const received = []
    for await (const event of events) received.push(event)
    expect(received).toEqual([{ type: "ready", count: "1" }])
    expect(requests).toBe(1)
    expect(url).toBe("https://example.com/event?after=2")
  })

  test("validates emitted SSE against its encoded schema and keeps raw JSON explicitly unknown", async () => {
    const data = Schema.Struct({
      type: Schema.Literal("ready"),
      count: Schema.NumberFromString,
      created: Schema.Finite,
      nested: Schema.Struct({
        id: Schema.String.check(Schema.isStartingWith("evt_")),
        seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        labels: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
        metadata: Schema.Record(Schema.String, Schema.Unknown),
      }),
    })
    const valid = {
      type: "ready",
      count: "1",
      created: 1,
      nested: { id: "evt_ready", seq: 0, labels: ["snowman \u2603"], metadata: { opaque: [1, true] } },
    }
    const output = emitPromise(
      compile(api(HttpApiEndpoint.get("subscribe", "/event", { success: HttpApiSchema.StreamSse({ data }) }))),
      { mutableOutputs: true },
    )
    await using emitted = await emittedModule(output)
    const source = output.files.find((file) => file.path === "client.ts")?.content
    const accepts = Schema.is(Schema.toEncoded(data))
    const malformed = [
      null,
      [],
      { ...valid, type: "other" },
      { ...valid, count: 1 },
      { ...valid, created: null },
      { ...valid, nested: { ...valid.nested, id: "wrong" } },
      { ...valid, nested: { ...valid.nested, seq: -1 } },
      { ...valid, nested: { ...valid.nested, seq: Number.MAX_SAFE_INTEGER + 1 } },
      { ...valid, nested: { ...valid.nested, labels: [""] } },
      { ...valid, nested: { ...valid.nested, labels: [1] } },
    ]
    expect(accepts(valid)).toBe(true)
    for (const value of malformed) {
      expect(accepts(value)).toBe(false)
      const client = emitted.module.Omnixa.make({
        baseUrl: "https://example.com",
        fetch: async () =>
          new Response("data: " + JSON.stringify(value) + "\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
      })
      await expect(client.session.subscribe()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        name: "ClientError",
        reason: "MalformedResponse",
      })
      await expect(client.session.subscribe.raw()[Symbol.asyncIterator]().next()).resolves.toEqual({
        done: false,
        value,
      })
    }
    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async () =>
        new Response("data: " + JSON.stringify(valid) + "\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
    })
    await expect(client.session.subscribe()[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: false,
      value: valid,
    })
    expect(source).not.toContain("yield JSON.parse(data) as")
    expect(source).not.toMatch(/from ["'](?:effect|@omnixa\/(?:protocol|schema))/)
  })

  test("validates emitted SSE length checks against native encoded objects, strings, and arrays", async () => {
    for (const check of [Schema.isMinLength(1), Schema.isMaxLength(3), Schema.isBetweenLength(1, 3)]) {
      for (const fixture of [
        {
          data: Schema.Struct({ length: Schema.Number }).check(check),
          values: [{ length: 0 }, { length: 2 }, { length: 4 }, { length: "2" }, null],
        },
        { data: Schema.String.check(check), values: ["", "ab", "abcd", { length: 2 }, null] },
        { data: Schema.Array(Schema.Number).check(check), values: [[], [1, 2], [1, 2, 3, 4], { length: 2 }, null] },
      ]) {
        const accepts = Schema.is(Schema.toEncoded(fixture.data))
        const output = emitPromise(
          compile(
            api(
              HttpApiEndpoint.get("subscribe", "/event", {
                success: HttpApiSchema.StreamSse({ data: fixture.data }),
              }),
            ),
          ),
        )
        await using emitted = await emittedModule(output)
        for (const value of fixture.values) {
          const client = emitted.module.Omnixa.make({
            baseUrl: "https://example.com",
            fetch: async () =>
              new Response("data: " + JSON.stringify(value) + "\n\n", {
                headers: { "content-type": "text/event-stream" },
              }),
          })
          const next = client.session.subscribe()[Symbol.asyncIterator]().next()
          if (accepts(value)) {
            await expect(next).resolves.toEqual({ done: false, value })
            continue
          }
          await expect(next).rejects.toMatchObject({ name: "ClientError", reason: "MalformedResponse" })
        }
      }
    }
  })

  test("validates emitted SSE refined record keys with native encoded key selection", async () => {
    const data = Schema.Record(Schema.String.check(Schema.isStartingWith("evt_")), Schema.Int)
    const accepts = Schema.is(Schema.toEncoded(data))
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("subscribe", "/event", {
            success: HttpApiSchema.StreamSse({ data }),
          }),
        ),
      ),
    )
    await using emitted = await emittedModule(output)
    for (const value of [
      { evt_ready: 2 },
      { evt_bad: "wrong" },
      { extra: "unselected" },
      { evt_ready: 2, extra: "unselected" },
      null,
      [],
    ]) {
      const client = emitted.module.Omnixa.make({
        baseUrl: "https://example.com",
        fetch: async () =>
          new Response("data: " + JSON.stringify(value) + "\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
      })
      const next = client.session.subscribe()[Symbol.asyncIterator]().next()
      if (accepts(value)) {
        await expect(next).resolves.toEqual({ done: false, value })
        continue
      }
      await expect(next).rejects.toMatchObject({ name: "ClientError", reason: "MalformedResponse" })
    }
  })

  test("validates emitted SSE refined template record keys against native key selection", async () => {
    const data = Schema.Record(Schema.TemplateLiteral(["evt_", Schema.String]).check(Schema.isMinLength(8)), Schema.Int)
    const accepts = Schema.is(Schema.toEncoded(data))
    expect(accepts({ evt_x: 1 })).toBe(false)
    const output = emitPromise(
      compile(api(HttpApiEndpoint.get("subscribe", "/event", { success: HttpApiSchema.StreamSse({ data }) }))),
    )
    await using emitted = await emittedModule(output)
    for (const value of [
      { evt_good: 2 },
      { evt_x: 1 },
      { evt_bad: "wrong" },
      { evt_good: "wrong" },
      { extra: "unselected" },
      { evt_good: 2, extra: "unselected" },
      null,
      [],
    ]) {
      const client = emitted.module.Omnixa.make({
        baseUrl: "https://example.com",
        fetch: async () =>
          new Response("data: " + JSON.stringify(value) + "\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
      })
      const next = client.session.subscribe()[Symbol.asyncIterator]().next()
      if (accepts(value)) {
        await expect(next).resolves.toEqual({ done: false, value })
        continue
      }
      await expect(next).rejects.toMatchObject({ name: "ClientError", reason: "MalformedResponse" })
    }
  })

  test("validates emitted SSE oneOf union members against native encoded matching", async () => {
    const data = Schema.Union([Schema.Struct({ a: Schema.String }), Schema.Struct({ b: Schema.String })], {
      mode: "oneOf",
    })
    const accepts = Schema.is(Schema.toEncoded(data))
    expect(accepts({ a: "x", b: "x" })).toBe(false)
    const output = emitPromise(
      compile(api(HttpApiEndpoint.get("subscribe", "/event", { success: HttpApiSchema.StreamSse({ data }) }))),
    )
    await using emitted = await emittedModule(output)
    for (const value of [{ a: "x" }, { b: "x" }, { a: "x", b: "x" }, { a: 1 }, {}, null, []]) {
      const client = emitted.module.Omnixa.make({
        baseUrl: "https://example.com",
        fetch: async () =>
          new Response("data: " + JSON.stringify(value) + "\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
      })
      const next = client.session.subscribe()[Symbol.asyncIterator]().next()
      if (accepts(value)) {
        await expect(next).resolves.toEqual({ done: false, value })
        continue
      }
      await expect(next).rejects.toMatchObject({ name: "ClientError", reason: "MalformedResponse" })
    }
  })

  test("rejects oneOf template parts whose exact parsing cannot be emitted", () => {
    const data = Schema.Record(
      Schema.TemplateLiteral(["evt_", Schema.Union([Schema.Literal("x"), Schema.String], { mode: "oneOf" })]),
      Schema.Int,
    )
    expect(Schema.is(Schema.toEncoded(data))({ evt_y: 1 })).toBe(true)
    expect(Schema.is(Schema.toEncoded(data))({ evt_x: 1 })).toBe(false)
    expect(() =>
      emitPromise(
        compile(api(HttpApiEndpoint.get("subscribe", "/event", { success: HttpApiSchema.StreamSse({ data }) }))),
      ),
    ).toThrow("Promise SSE oneOf template part is not implemented")
  })

  test("keeps raw SSE UTF8, activity, reader cancellation, and typed failures on the owning loop", async () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("subscribe", "/event", {
            success: HttpApiSchema.StreamSse({ data: Schema.Struct({ type: Schema.Literal("known") }) }),
          }),
        ),
      ),
    )
    await using emitted = await emittedModule(output)
    const unknown = { id: "evt_split", type: "test.large", data: { text: "split \u2603" } }
    const bytes = new TextEncoder().encode(": heartbeat\r\n\r\ndata: " + JSON.stringify(unknown) + "\r\n\r\n")
    const start = bytes.indexOf(new TextEncoder().encode("\u2603")[0]!)
    const boundaries = [start + 1, start + 2, bytes.length - 1, bytes.length]
    const counts = { requests: 0, activity: 0, cancelled: 0 }
    const client = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async () => {
        counts.requests++
        return new Response(
          new ReadableStream({
            start(controller) {
              boundaries.forEach((end, index) =>
                controller.enqueue(bytes.slice(index === 0 ? 0 : boundaries[index - 1], end)),
              )
            },
            cancel() {
              counts.cancelled++
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      },
    })
    const iterator = client.session.subscribe.raw({ onActivity: () => counts.activity++ })[Symbol.asyncIterator]()
    expect(counts.requests).toBe(0)
    await expect(iterator.next()).resolves.toEqual({ done: false, value: unknown })
    await iterator.return!()
    expect(counts).toEqual({ requests: 1, activity: boundaries.length, cancelled: 1 })
    const failure = new Error("reader failed")
    const failing = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(failure)
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    })
    await expect(failing.session.subscribe.raw()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      name: "ClientError",
      reason: "Transport",
      cause: failure,
    })
    const malformed = emitted.module.Omnixa.make({
      baseUrl: "https://example.com",
      fetch: async () => new Response("data: {not-json}\n\n", { headers: { "content-type": "text/event-stream" } }),
    })
    await expect(malformed.session.subscribe.raw()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      name: "ClientError",
      reason: "MalformedResponse",
    })
  })

  test("rejects unsupported SSE checks instead of silently emitting an unchecked guard", () => {
    const data = Schema.Int.check(Schema.isMultipleOf(2, { arbitraryConstraint: {} }))
    expect(() =>
      emitPromise(
        compile(api(HttpApiEndpoint.get("subscribe", "/event", { success: HttpApiSchema.StreamSse({ data }) }))),
      ),
    ).toThrow("Promise SSE check is not implemented")
  })

  test("preserves public group and endpoint identifiers exactly", () => {
    const output = compileEffect(
      HttpApi.make("test").add(
        HttpApiGroup.make("session").add(HttpApiEndpoint.get("get", "/session/:sessionID", { success: Schema.String })),
      ),
    )

    expect(output.operations[0]).toMatchObject({ group: "session", name: "get" })
  })

  test("emits one client module per HttpApi group", () => {
    const source = HttpApi.make("test")
      .add(HttpApiGroup.make("session").add(HttpApiEndpoint.get("get", "/session", { success: Schema.String })))
      .add(HttpApiGroup.make("tool").add(HttpApiEndpoint.get("list", "/tool", { success: Schema.String })))

    const output = compileEffect(source)

    expect(output.files.map((file) => file.path)).toEqual([
      "session.ts",
      "tool.ts",
      "client-error.ts",
      "client.ts",
      "index.ts",
    ])
  })

  test("emits syntactically valid TypeScript modules", () => {
    const output = compileEffect(
      api(
        HttpApiEndpoint.get("get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          success: Schema.Struct({ data: Schema.String }),
        }),
      ),
    )
    const transpiler = new Bun.Transpiler({ loader: "ts" })

    for (const file of output.files) expect(() => transpiler.transformSync(file.content)).not.toThrow()
  })

  it.live("keeps the strict generated-consumer fixture current", () =>
    Effect.gen(function* () {
      const output = compileEffect(Api)
      const actual = yield* Effect.promise(() =>
        Array.fromAsync(new Bun.Glob("*.ts").scan(fileURLToPath(new URL("generated", import.meta.url)))),
      )
      expect(actual.sort((a, b) => a.localeCompare(b))).toEqual(
        output.files.map((file) => file.path).sort((a, b) => a.localeCompare(b)),
      )
      yield* Effect.forEach(output.files, (file) =>
        Effect.tryPromise(() =>
          Promise.all([
            Bun.file(new URL(`generated/${file.path}`, import.meta.url)).text(),
            format(file.content, { parser: "typescript", semi: false, printWidth: 120 }),
          ]),
        ).pipe(Effect.map(([content, expected]) => expect(content).toBe(expected))),
      )
    }),
  )

  test("flattens transport input channels into one domain input", () => {
    const output = compileEffect(
      api(
        HttpApiEndpoint.post("prompt", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          query: { resume: Schema.String },
          headers: { traceID: Schema.String },
          payload: Schema.Struct({ prompt: Schema.String }),
          success: Schema.Struct({ data: Schema.String }),
        }),
      ),
    )

    expect(output.operations[0]?.input).toEqual([
      { name: "sessionID", source: "params" },
      { name: "resume", source: "query" },
      { name: "traceID", source: "headers" },
      { name: "prompt", source: "payload" },
    ])
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      'params: { "sessionID": input["sessionID"] }',
    )
  })

  test("uses one opaque field for non-struct payloads across emitters", () => {
    const source = api(
      HttpApiEndpoint.post("configure", "/session/configure", {
        payload: Schema.Union([
          Schema.Struct({ type: Schema.Literal("local"), command: Schema.Array(Schema.String) }),
          Schema.Struct({ type: Schema.Literal("remote"), url: Schema.String }),
        ]),
        success: Schema.String,
      }),
    )
    const contract = compile(source)
    const effect = emitEffect(contract)
    const imported = emitEffectImported(contract, { module: "@example/api", api: "Api" })
    const shape = emitEffectShape(contract)
    const promise = emitPromise(contract)

    expect(effect.operations[0]).toMatchObject({
      input: [{ name: "payload", source: "payload" }],
      inputMode: "required",
    })
    expect(effect.files.find((file) => file.path === "session.ts")?.content).toContain('payload: input["payload"]')
    expect(imported.files.find((file) => file.path === "client.ts")?.content).toContain('payload: input["payload"]')
    expect(shape.files[0]?.content).toContain(
      'readonly "payload": { readonly "type": "local", readonly "command": ReadonlyArray<string> }',
    )
    expect(promise.files.find((file) => file.path === "types.ts")?.content).toContain(
      'readonly "payload": { readonly "type": "local", readonly "command": ReadonlyArray<string> } | { readonly "type": "remote", readonly "url": string }',
    )
    expect(promise.files.find((file) => file.path === "client.ts")?.content).toContain('body: input["payload"]')
  })

  test("routes arrays, primitives, and index-signature records through the opaque payload path", () => {
    for (const payload of [Schema.Array(Schema.String), Schema.String, Schema.Record(Schema.String, Schema.Number)]) {
      expect(
        compile(api(HttpApiEndpoint.post("set", "/session", { payload, success: HttpApiSchema.NoContent }))).groups[0]
          ?.endpoints[0]?.operation.input,
      ).toEqual([{ name: "payload", source: "payload" }])
    }
  })

  test("rejects an opaque payload field that collides with another input channel", () => {
    expect(() =>
      compile(
        api(
          HttpApiEndpoint.post("configure", "/session", {
            query: { payload: Schema.String },
            payload: Schema.Union([Schema.String, Schema.Number]),
            success: Schema.String,
          }),
        ),
      ),
    ).toThrow("Opaque payload field collision: session.configure.payload conflicts with query.payload")
  })

  test("preserves required empty struct payloads in imported Effect adapters", () => {
    const contract = compile(
      api(
        HttpApiEndpoint.post("empty", "/session", {
          payload: Schema.Struct({}),
          success: Schema.String,
        }),
      ),
    )
    const effect = emitEffectImported(contract, { module: "@example/api", api: "Api" })
    const promise = emitPromise(contract)

    expect(effect.files.find((file) => file.path === "client.ts")?.content).toContain("payload: { }")
    expect(promise.files.find((file) => file.path === "client.ts")?.content).toContain("body: { }")
  })

  test("uses no argument when an operation has no input fields", () => {
    const output = compileEffect(api(HttpApiEndpoint.get("health", "/health", { success: Schema.String })))

    expect(output.operations[0]?.inputMode).toBe("none")
  })

  test("uses an optional object when every input field is optional", () => {
    const output = compileEffect(
      api(
        HttpApiEndpoint.get("list", "/session", {
          query: { limit: Schema.optional(Schema.String) },
          success: Schema.Array(Schema.String),
        }),
      ),
    )

    expect(output.operations[0]?.inputMode).toBe("optional")
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain('input?.["limit"]')
  })

  test("regenerates standard HttpApi transport codecs from decoded schemas", () => {
    const output = compileEffect(
      api(
        HttpApiEndpoint.get("list", "/session", {
          query: { archived: Schema.optional(Schema.Boolean) },
          success: Schema.String,
        }),
      ),
    )

    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain("Schema.Boolean")
  })

  test("uses a required object when any input field is required", () => {
    const output = compileEffect(
      api(
        HttpApiEndpoint.get("get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          query: { includeArchived: Schema.optional(Schema.String) },
          success: Schema.String,
        }),
      ),
    )

    expect(output.operations[0]?.inputMode).toBe("required")
  })

  test("rejects colliding input names across transport channels", () => {
    expect(() =>
      compileEffect(
        api(
          HttpApiEndpoint.post("prompt", "/session/:id", {
            params: { id: Schema.String },
            payload: Schema.Struct({ id: Schema.String }),
            success: Schema.Void,
          }),
        ),
      ),
    ).toThrow("Input field collision: id")
  })

  test("rejects multiple payload alternatives until selection semantics are explicit", () => {
    expect(() =>
      compileEffect(
        api(
          HttpApiEndpoint.post("prompt", "/session", {
            payload: [Schema.Struct({ text: Schema.String }), Schema.Struct({ count: Schema.Number })],
            success: Schema.String,
          }),
        ),
      ),
    ).toThrow("Multiple payload schemas: session.prompt")
  })

  test("unwraps an exact data success envelope", () => {
    const output = compileEffect(
      api(
        HttpApiEndpoint.get("get", "/session/:sessionID", {
          params: { sessionID: Schema.String },
          success: Schema.Struct({ data: Schema.String }),
        }),
      ),
    )

    expect(output.operations[0]?.success).toBe("value")
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      "Effect.map((value) => value.data)",
    )
  })

  test("maps no-content success to void", () => {
    const output = compileEffect(
      api(HttpApiEndpoint.post("interrupt", "/session/:sessionID/interrupt", { success: HttpApiSchema.NoContent })),
    )

    expect(output.operations[0]?.success).toBe("void")
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain('"httpApiStatus": 204')
  })

  test("preserves non-default empty response statuses", () => {
    const output = compileEffect(api(HttpApiEndpoint.post("create", "/session", { success: HttpApiSchema.Created })))

    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain('"httpApiStatus": 201')
  })

  test("returns a non-envelope success unchanged", () => {
    const output = compileEffect(api(HttpApiEndpoint.get("health", "/health", { success: Schema.String })))

    expect(output.operations[0]?.success).toBe("value")
  })

  test("rejects multiple success shapes until their public semantics are explicit", () => {
    expect(() =>
      compileEffect(
        api(
          HttpApiEndpoint.get("get", "/session", {
            success: [Schema.String, Schema.Number],
          }),
        ),
      ),
    ).toThrow("Multiple success schemas: session.get")
  })

  test("models an SSE success as a direct stream", () => {
    const output = compileEffect(
      api(
        HttpApiEndpoint.get("subscribe", "/event", {
          success: HttpApiSchema.StreamSse({ data: Schema.Struct({ type: Schema.String }) }),
        }),
      ),
    )

    expect(output.operations[0]?.success).toBe("stream")
  })

  test("emits opaque Promise SSE fields as any", () => {
    const output = emitPromise(
      compile(
        api(
          HttpApiEndpoint.get("subscribe", "/event", {
            success: HttpApiSchema.StreamSse({
              data: Schema.Struct({
                metadata: Schema.Record(Schema.String, Schema.Unknown),
                label: Schema.Literal("unknown"),
              }),
            }),
          }),
        ),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain('readonly "metadata": { readonly [x: string]: any }')
    expect(types).toContain('readonly "label": "unknown"')
  })

  test("preserves annotated stream response statuses", () => {
    const output = compileEffect(
      api(
        HttpApiEndpoint.get("subscribe", "/event", {
          success: HttpApiSchema.StreamSse({ data: Schema.String }).pipe(HttpApiSchema.status(202)),
        }),
      ),
    )

    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      ".pipe(HttpApiSchema.status(202))",
    )
  })

  test("rejects schemas whose semantics cannot be emitted exactly", () => {
    const OpaqueUrl = Schema.declare((input): input is URL => input instanceof URL)

    expect(() => compileEffect(api(HttpApiEndpoint.get("get", "/url", { success: OpaqueUrl })))).toThrow(
      "Unportable schema: session.get.success",
    )
  })

  test("rejects custom transformations hidden beneath standard HttpApi codecs", () => {
    const QueryBoolean = Schema.Literals(["yes", "no"]).pipe(
      Schema.decodeTo(Schema.Boolean, {
        decode: SchemaGetter.transform((value) => value === "yes"),
        encode: SchemaGetter.transform((value) => (value ? "yes" : "no")),
      }),
    )

    expect(() =>
      compileEffect(
        api(
          HttpApiEndpoint.get("get", "/session", {
            query: { archived: QueryBoolean },
            success: Schema.String,
          }),
        ),
      ),
    ).toThrow("Effect schema requires authoritative import: session.get")
  })

  test("rejects same-shape custom transformations", () => {
    const Trimmed = Schema.String.pipe(
      Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transform((value) => value.trim()),
        encode: SchemaGetter.transform((value) => value),
      }),
    )

    expect(() => compileEffect(api(HttpApiEndpoint.get("get", "/session", { success: Trimmed })))).toThrow(
      "Effect schema requires authoritative import: session.get",
    )
  })

  test("rejects custom validation checks without portable metadata", () => {
    const Positive = Schema.Number.check(Schema.makeFilter((value) => (value > 0 ? undefined : "positive")))

    expect(() => compileEffect(api(HttpApiEndpoint.get("get", "/session", { success: Positive })))).toThrow(
      "Unportable schema: session.get.success",
    )
  })

  test("emits schema classes with native arbitrary constraints structurally", () => {
    class Attempt extends Schema.Class<Attempt>("Attempt")({
      count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }) {}
    const output = emitPromise(compile(api(HttpApiEndpoint.get("get", "/session", { success: Attempt }))))
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain('export type Attempt = { readonly "count": number }')
    expect(types).toContain("export type SessionGetOutput = Attempt")
  })

  test("preserves named classes with canonical optional JSON fields across Promise outputs", () => {
    class Info extends Schema.Class<Info>("Example.Info")({
      id: Schema.String,
      label: optional(Schema.String),
      count: optional(Schema.Number),
    }) {}
    class Updated extends Schema.Class<Updated>("Example.Updated")({
      tasks: Schema.Array(Info),
    }) {}
    const output = emitPromise(
      compile(
        HttpApi.make("test").add(
          HttpApiGroup.make("session")
            .add(HttpApiEndpoint.get("get", "/session", { success: Info }))
            .add(HttpApiEndpoint.get("list", "/sessions", { success: Schema.Array(Info) }))
            .add(HttpApiEndpoint.get("updated", "/session/updated", { success: Updated })),
        ),
      ),
    )
    const types = output.files.find((file) => file.path === "types.ts")?.content

    expect(types).toContain(
      'export type ExampleInfo = { readonly "id": string, readonly "label"?: string, readonly "count"?: number | "Infinity" | "-Infinity" | "NaN" }',
    )
    expect(types).toContain('export type ExampleUpdated = { readonly "tasks": ReadonlyArray<ExampleInfo> }')
    expect(types).toContain("export type SessionGetOutput = ExampleInfo")
    expect(types).toContain("export type SessionListOutput = ReadonlyArray<ExampleInfo>")
    expect(types).toContain("export type SessionUpdatedOutput = ExampleUpdated")
    expect(types?.match(/export type ExampleInfo =/g)).toHaveLength(1)
    expect(types).not.toContain("null")
    expect(types).not.toContain("undefined")
  })

  test("rejects spoofed and aborted validation checks", () => {
    const Spoofed = Schema.Number.check(
      Schema.makeFilter(() => "always fails", { meta: { _tag: "isFinite" }, arbitrary: {} }),
    )
    const Aborted = Schema.Number.check(Schema.isFinite().abort())

    expect(() => compileEffect(api(HttpApiEndpoint.get("spoofed", "/session", { success: Spoofed })))).toThrow(
      "Unportable schema: session.spoofed.success",
    )
    expect(() => compileEffect(api(HttpApiEndpoint.get("aborted", "/session", { success: Aborted })))).toThrow(
      "Unportable schema: session.aborted.success",
    )
  })

  test("rejects altered wire-side schemas even when the codec transformation is canonical", () => {
    const JsonNumber = Schema.toCodecJson(Schema.Number)
    const link = JsonNumber.ast.encoding?.[0]
    if (link === undefined) throw new Error("Expected JSON number encoding")
    // This helper is present at runtime but omitted from the public declaration surface.
    // oxlint-disable-next-line no-restricted-globals -- The test verifies an Effect runtime helper without a public type.
    const replaceEncoding: unknown = Reflect.get(SchemaAST, "replaceEncoding")
    if (typeof replaceEncoding !== "function") throw new Error("Expected SchemaAST.replaceEncoding")
    const ast: unknown = replaceEncoding(JsonNumber.ast, [
      new SchemaAST.Link(Schema.String.check(Schema.isMinLength(2)).ast, link.transformation),
    ])
    if (!SchemaAST.isAST(ast)) throw new Error("Expected altered schema AST")
    const Altered = Schema.make<Schema.Top>(ast)

    expect(() => compileEffect(api(HttpApiEndpoint.get("get", "/session", { success: Altered })))).toThrow(
      "Effect schema requires authoritative import: session.get",
    )
  })

  test("rejects lexical generation and annotation values", () => {
    const Generated = Schema.declare((input): input is string => typeof input === "string").annotate({
      generation: { runtime: "LocalOnly", Type: "string" },
    })
    const Annotated = Schema.declare((input): input is string => typeof input === "string").annotate({
      custom: () => "local",
    })

    expect(() => compileEffect(api(HttpApiEndpoint.get("generated", "/session", { success: Generated })))).toThrow(
      "Unportable schema: session.generated.success",
    )
    expect(() => compileEffect(api(HttpApiEndpoint.get("annotated", "/session", { success: Annotated })))).toThrow(
      "Unportable schema: session.annotated.success",
    )
  })

  test("preserves errors from server-only middleware", () => {
    class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}
    class Authorization extends HttpApiMiddleware.Service<Authorization>()("Authorization", {
      error: Unauthorized,
    }) {}

    const output = compileEffect(
      api(HttpApiEndpoint.get("get", "/session", { success: Schema.String }).middleware(Authorization)),
    )

    expect(output.operations[0]).toBeDefined()
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      'extends Schema.TaggedError<EndpointGetError0Class>("Unauthorized")',
    )
  })

  test("preserves tagged error response statuses", () => {
    class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}
    const output = compileEffect(
      api(
        HttpApiEndpoint.get("get", "/session", {
          success: Schema.String,
          error: Missing.pipe(HttpApiSchema.status(404)),
        }),
      ),
    )

    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      'EndpointGetError0Class.annotate({ "httpApiStatus": 404 })',
    )
  })

  test("supports every HttpApi method through the generic constructor", () => {
    const output = compileEffect(api(HttpApiEndpoint.make("TRACE")("trace", "/trace", { success: Schema.String })))

    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain('HttpApiEndpoint.make("TRACE")')
  })

  test("uses safe identity-derived module paths without changing public group identifiers", () => {
    const output = compileEffect(
      HttpApi.make("test")
        .add(HttpApiGroup.make("../session").add(HttpApiEndpoint.get("get", "/session", { success: Schema.String })))
        .add(HttpApiGroup.make("GROUP-0").add(HttpApiEndpoint.get("list", "/session", { success: Schema.String }))),
    )

    expect(output.files.slice(0, 2).map((file) => file.path)).toEqual(["session.ts", "GROUP-0.ts"])
    expect(output.files[0]?.content).toContain('HttpApiGroup.make("../session"')
  })

  test("prefixes group modules that collide with support or Windows-reserved names", () => {
    const output = compileEffect(
      HttpApi.make("test")
        .add(HttpApiGroup.make("INDEX").add(HttpApiEndpoint.get("get", "/index", { success: Schema.String })))
        .add(HttpApiGroup.make("CON").add(HttpApiEndpoint.get("get", "/con", { success: Schema.String }))),
    )

    expect(output.files.slice(0, 2).map((file) => file.path)).toEqual(["group-INDEX.ts", "group-CON.ts"])
  })

  test("rejects module names colliding after normalization", () => {
    expect(() =>
      compileEffect(
        HttpApi.make("test")
          .add(HttpApiGroup.make("my.group").add(HttpApiEndpoint.get("first", "/first", { success: Schema.String })))
          .add(HttpApiGroup.make("my/group").add(HttpApiEndpoint.get("second", "/second", { success: Schema.String }))),
      ),
    ).toThrow("Client module name collision: my-group")
  })

  test("rejects collisions in the flattened client namespace", () => {
    expect(() =>
      compileEffect(
        HttpApi.make("test")
          .add(HttpApiGroup.make("status").add(HttpApiEndpoint.get("get", "/nested", { success: Schema.String })))
          .add(
            HttpApiGroup.make("system", { topLevel: true }).add(
              HttpApiEndpoint.get("status", "/status", { success: Schema.String }),
            ),
          ),
      ),
    ).toThrow("Client name collision: status")
  })

  test("emits a usable raw type for top-level groups", () => {
    const output = compileEffect(
      HttpApi.make("test").add(
        HttpApiGroup.make("health", { topLevel: true }).add(
          HttpApiEndpoint.get("check", "/health", { success: Schema.String }),
        ),
      ),
    )

    expect(output.files[0]?.content).toContain("type RawGroup = HttpApiClient.Client<typeof GroupHealth")
  })

  it.effect("reports compiler failures in the generate Effect", () =>
    Effect.gen(function* () {
      const error = yield* generate(
        api(
          HttpApiEndpoint.get("get", "/url", {
            success: Schema.declare((input): input is URL => input instanceof URL),
          }),
        ),
        {
          directory: "/generated",
        },
      ).pipe(Effect.flip)

      expect(error).toBeInstanceOf(GenerationError)
      if (error instanceof GenerationError) expect(error.reason).toBe("Unportable schema: session.get.success")
    }).pipe(Effect.provideService(FileSystem.FileSystem, FileSystem.makeNoop({}))),
  )

  test("rejects required client middleware without an adapter", () => {
    class SignedRequest extends HttpApiMiddleware.Service<SignedRequest>()("SignedRequest", {
      requiredForClient: true,
    }) {}

    expect(() =>
      compileEffect(api(HttpApiEndpoint.get("get", "/session", { success: Schema.String }).middleware(SignedRequest))),
    ).toThrow("Client middleware requires adapter: SignedRequest")
  })

  test("maps transport and decode failures to one stable client error", () => {
    const output = compileEffect(
      api(
        HttpApiEndpoint.get("get", "/session", {
          success: Schema.String,
        }),
      ),
    )

    expect(output.operations[0]?.errors).toContain("ClientError")
    expect(output.operations[0]?.errors).not.toContain("HttpClientError")
    expect(output.operations[0]?.errors).not.toContain("SchemaError")
    expect(output.files.find((file) => file.path === "session.ts")?.content).toContain(
      "new ClientError({ cause: error })",
    )
  })
})
