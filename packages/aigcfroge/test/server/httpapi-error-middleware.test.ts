import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { NamedError } from "@aigcfroge/core/util/error"
import { describe, expect } from "bun:test"
import { ConfigErrorV1 } from "@aigcfroge/core/v1/config/error"
import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi"
import { NonNegativeInt } from "@aigcfroge/core/schema"
import { InvalidRequestError } from "../../src/server/routes/instance/httpapi/errors"
import {
  SchemaErrorMiddleware,
  schemaErrorLayer,
} from "../../src/server/routes/instance/httpapi/middleware/schema-error"
import { errorLayer } from "../../src/server/routes/instance/httpapi/middleware/error"
import { NotFoundError } from "../../src/storage/storage"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer))

class ValidationProbePayload extends Schema.Class<ValidationProbePayload>("ValidationProbePayload")({
  seq: NonNegativeInt,
  result: Schema.Literals(["ok", "business", "builtin"]),
}) {}

const ValidationProbeApi = HttpApi.make("validation-probe")
  .add(
    HttpApiGroup.make("probe").add(
      HttpApiEndpoint.post("post", "/validation-probe", {
        payload: ValidationProbePayload,
        success: Schema.Number,
        error: [InvalidRequestError, HttpApiError.BadRequest],
      }),
    ),
  )
  .middleware(SchemaErrorMiddleware)

const validationProbeHandlers = HttpApiBuilder.group(ValidationProbeApi, "probe", (handlers) =>
  handlers.handle("post", (ctx) =>
    Effect.gen(function* () {
      if (ctx.payload.result === "business") {
        return yield* new InvalidRequestError({ message: "Business validation rejected", kind: "business-validation" })
      }
      if (ctx.payload.result === "builtin") return yield* new HttpApiError.BadRequest({})
      return ctx.payload.seq
    }),
  ),
)

const validationProbeRoutes = HttpApiBuilder.layer(ValidationProbeApi).pipe(
  Layer.provide(validationProbeHandlers),
  Layer.provide(schemaErrorLayer),
)

function expectUnknownErrorBody(body: unknown) {
  expect(body).toMatchObject({
    name: "UnknownError",
    data: { message: "Unexpected server error. Check server logs for details." },
  })
  expect((body as { data?: { ref?: unknown } }).data?.ref).toMatch(/^err_[0-9a-f-]{8}$/)
}

describe("HttpApi error middleware", () => {
  it.live("returns a safe body for unknown 500 defects", () =>
    Effect.gen(function* () {
      yield* HttpRouter.add("GET", "/boom", Effect.die(new Error("secret stack marker"))).pipe(
        Layer.provide(errorLayer),
        HttpRouter.serve,
        Layer.build,
      )

      const response = yield* HttpClientRequest.get("/boom").pipe(HttpClient.execute)
      const body = yield* response.json

      expect(response.status).toBe(500)
      expectUnknownErrorBody(body)
      expect(JSON.stringify(body)).not.toContain("secret stack marker")
    }),
  )

  it.live("returns a safe body for named defects", () =>
    Effect.gen(function* () {
      yield* HttpRouter.add(
        "GET",
        "/named",
        Effect.die(new NamedError.Unknown({ message: "secret named marker" })),
      ).pipe(Layer.provide(errorLayer), HttpRouter.serve, Layer.build)

      const response = yield* HttpClientRequest.get("/named").pipe(HttpClient.execute)
      const body = yield* response.json

      expect(response.status).toBe(500)
      expectUnknownErrorBody(body)
      expect(JSON.stringify(body)).not.toContain("secret named marker")
    }),
  )

  it.live("returns invalid config defects as structured client errors", () =>
    Effect.gen(function* () {
      const configError = new ConfigErrorV1.InvalidError({
        path: "/tmp/aigcfroge.json",
        issues: [{ message: "Expected object", path: ["provider", "anthropic", "options"] }],
      })

      yield* HttpRouter.add("GET", "/config-error", Effect.die(configError)).pipe(
        Layer.provide(errorLayer),
        HttpRouter.serve,
        Layer.build,
      )

      const response = yield* HttpClientRequest.get("/config-error").pipe(HttpClient.execute)
      const body = yield* response.json
      const serialized = JSON.stringify(body)

      expect(response.status).toBe(400)
      expect(body).toMatchObject({
        name: "ConfigInvalidError",
        data: {
          path: "/tmp/aigcfroge.json",
          issues: [{ message: "Expected object", path: ["provider", "anthropic", "options"] }],
        },
      })
      expect(serialized).toContain("/tmp/aigcfroge.json")
      expect(serialized).toContain("anthropic")
    }),
  )

  it.live("does not map storage not-found defects to 404", () =>
    Effect.gen(function* () {
      yield* HttpRouter.add(
        "GET",
        "/missing",
        Effect.die(new NotFoundError({ message: "Resource not found: secret" })),
      ).pipe(Layer.provide(errorLayer), HttpRouter.serve, Layer.build)

      const response = yield* HttpClientRequest.get("/missing").pipe(HttpClient.execute)
      const body = yield* response.json

      expect(response.status).toBe(500)
      expectUnknownErrorBody(body)
    }),
  )
  it.live("legacy validation response is accepted by its declared middleware schema", () =>
    Effect.gen(function* () {
      yield* validationProbeRoutes.pipe(HttpRouter.serve, Layer.build)
      const response = yield* HttpClientRequest.post("/validation-probe").pipe(
        HttpClientRequest.bodyJson({ seq: -1, result: "ok" }),
        Effect.flatMap(HttpClient.execute),
      )
      const body = yield* response.json
      expect(response.status).toBe(400)
      expect(response.headers["content-type"] ?? "").toContain("application/json")
      // Decode the untouched response before Bun's partial matcher handles it.
      const declared = Schema.decodeUnknownSync(
        Schema.toEncoded(Schema.toCodecJson(Schema.Union(Array.from(SchemaErrorMiddleware.error)))),
      )(body)
      expect(body).toMatchObject({
        name: "BadRequest",
        data: { kind: "Payload", message: expect.stringContaining("seq") },
      })
      expect(declared).toMatchObject({ name: "BadRequest", data: { kind: "Payload" } })
    }),
  )

  it.live("schema middleware preserves handler InvalidRequestError encoding", () =>
    Effect.gen(function* () {
      yield* validationProbeRoutes.pipe(HttpRouter.serve, Layer.build)
      const response = yield* HttpClientRequest.post("/validation-probe").pipe(
        HttpClientRequest.bodyJson({ seq: 0, result: "business" }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(response.status).toBe(400)
      expect(yield* response.json).toEqual({
        _tag: "InvalidRequestError",
        message: "Business validation rejected",
        kind: "business-validation",
      })
    }),
  )

  it.live("schema middleware preserves the built-in BadRequest encoding", () =>
    Effect.gen(function* () {
      yield* validationProbeRoutes.pipe(HttpRouter.serve, Layer.build)
      const response = yield* HttpClientRequest.post("/validation-probe").pipe(
        HttpClientRequest.bodyJson({ seq: 0, result: "builtin" }),
        Effect.flatMap(HttpClient.execute),
      )
      expect(response.status).toBe(400)
      expect(yield* response.json).toEqual({ _tag: "BadRequest" })
    }),
  )
})
