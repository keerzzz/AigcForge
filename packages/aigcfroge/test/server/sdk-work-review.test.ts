import { EventV2 } from "@aigcfroge/core/event"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import { Hash } from "@aigcfroge/core/util/hash"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { createAigcfrogeClient } from "@aigcfroge/sdk/v2"
import { expect, test } from "bun:test"
import { ConfigProvider, Effect, FileSystem, Layer, Schema } from "effect"
import { HttpServer } from "effect/unstable/http"
import path from "node:path"
import { AppLayer } from "../../src/effect/app-runtime"
import { Session } from "../../src/session/session"
import { resetDatabase } from "../fixture/db"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer } from "./httpapi-layer"

test("AI-TDD-S06-R10: canonical review methods exist on the generated SDK namespace", () => {
  const sdk = createAigcfrogeClient({ baseUrl: "http://127.0.0.1" })
  expect(sdk.v2.session.workReview).toBeDefined()
  expect(typeof sdk.v2.session.workReview.get).toBe("function")
  expect(typeof sdk.v2.session.workReview.transition).toBe("function")
})

const state = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* Effect.promise(() => resetDatabase())
    yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
  }),
)

// Real production routes and generated fetch transport; never enable the alternate runtime.
const it = testEffect(
  Layer.mergeAll(httpApiLayer, AppLayer, LocationServiceMap.layer, EventV2.defaultLayer).pipe(
    Layer.provide(state),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          AIGCFROGE_SERVER_USERNAME: "aigcfroge",
          AIGCFROGE_SERVER_PASSWORD: "work-review-sdk-test",
        }),
      ),
    ),
  ),
)
const authorization = `Basic ${Buffer.from("aigcfroge:work-review-sdk-test").toString("base64")}`

it.live("AI-TDD-S06-R10/R11: generated client writes and reloads the canonical review on the default path", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
    const baseUrl = HttpServer.formatAddress((yield* HttpServer.HttpServer).address)
    const sdk = createAigcfrogeClient({ baseUrl, directory, headers: { authorization } })
    const created = yield* Effect.promise(() => sdk.session.create({ mode: "work", title: "SDK work review" }))
    expect(created.response.status).toBe(200)
    const session = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Session.Info))(created.data)
    // Creation returns the admitted Session; verify the persisted projection through the actual current GET.
    const initial = yield* Effect.promise(() => sdk.session.get({ sessionID: session.id }))
    expect(initial.response.status).toBe(200)
    expect(initial.data?.workContract).toMatchObject({ source: "ad-hoc", contractVersion: 1 })
    const empty = yield* Effect.promise(() => sdk.v2.session.workReview.get({ sessionID: session.id }))
    expect(empty.response.status).toBe(200)
    expect(empty.data).toEqual({ data: { status: "none" } })

    const applied = yield* Effect.promise(() =>
      sdk.workArtifact.apply({
        sessionID: session.id,
        relativePath: "review.md",
        title: "SDK artifact",
        content: "# Real SDK artifact\n",
        overwrite: false,
      }),
    )
    expect(applied.response.status).toBe(200)
    const artifact = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(WorkArtifact.ArtifactRecord))(applied.data)
    const revision = Hash.sha256(
      yield* (yield* FileSystem.FileSystem).readFileString(path.join(directory, "review.md")),
    )
    const submitted = yield* Effect.promise(() =>
      sdk.v2.session.workReview.transition({
        sessionID: session.id,
        workReviewCommand: {
          action: "submit",
          expectedReviewRevision: 0,
          artifactID: artifact.id,
          expectedArtifactRevision: revision,
        },
      }),
    )
    expect(submitted.response.status).toBe(200)
    const opened = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(WorkReview.Ready))(submitted.data?.data)
    expect(opened).toMatchObject({ status: "ready", current: true, review: { revision: 1, state: "open" } })
    const approved = yield* Effect.promise(() =>
      sdk.v2.session.workReview.transition({
        sessionID: session.id,
        workReviewCommand: {
          action: "approve",
          expectedReviewRevision: opened.review.revision,
          artifactID: artifact.id,
          expectedArtifactRevision: revision,
        },
      }),
    )
    expect(approved.response.status).toBe(200)
    const resolved = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(WorkReview.Ready))(approved.data?.data)
    expect(resolved).toMatchObject({ status: "ready", current: true, review: { revision: 2, state: "resolved" } })

    const current = yield* Effect.promise(() => sdk.session.get({ sessionID: session.id }))
    const canonical = yield* Effect.promise(() => sdk.v2.session.get({ sessionID: session.id }))
    expect(current.response.status).toBe(200)
    expect(canonical.response.status).toBe(200)
    expect(current.data?.workReview).toEqual(approved.data?.data.review)
    expect(canonical.data?.data.workReview).toEqual(approved.data?.data.review)
    const reloaded = createAigcfrogeClient({ baseUrl, directory, headers: { authorization } })
    const readback = yield* Effect.promise(() => reloaded.v2.session.workReview.get({ sessionID: session.id }))
    expect(readback.response.status).toBe(200)
    expect(readback.data).toEqual(approved.data)

    const conflict = yield* Effect.promise(() =>
      sdk.v2.session.workReview.transition({
        sessionID: session.id,
        workReviewCommand: {
          action: "approve",
          expectedReviewRevision: opened.review.revision,
          artifactID: artifact.id,
          expectedArtifactRevision: revision,
        },
      }),
    )
    expect(conflict.response.status).toBe(409)
    expect(conflict.error).toMatchObject({ _tag: "ConflictError", resource: "work-review" })
    expect(conflict.data).toBeUndefined()
    const unchanged = yield* Effect.promise(() => reloaded.v2.session.workReview.get({ sessionID: session.id }))
    expect(unchanged.data).toEqual(approved.data)
  }),
)

it.live("AI-TDD-S06-R10/R15: generated review calls retain authorization and typed error responses", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true, config: { formatter: false, lsp: false } })
    const baseUrl = HttpServer.formatAddress((yield* HttpServer.HttpServer).address)
    const sdk = createAigcfrogeClient({ baseUrl, directory, headers: { authorization } })
    const created = yield* Effect.promise(() => sdk.session.create({ mode: "work", title: "SDK authorization" }))
    expect(created.response.status).toBe(200)
    const session = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Session.Info))(created.data)
    const anonymous = createAigcfrogeClient({ baseUrl, directory: directory })
    const denied = yield* Effect.promise(() => anonymous.v2.session.workReview.get({ sessionID: session.id }))
    expect(denied.response.status).toBe(401)
    expect(denied.error).toMatchObject({ _tag: "UnauthorizedError" })
    const wrong = yield* Effect.promise(() =>
      sdk.v2.session.workReview.get({ sessionID: session.id }, { headers: { authorization: "Basic invalid" } }),
    )
    expect(wrong.response.status).toBe(401)
    expect(wrong.error).toMatchObject({ _tag: "UnauthorizedError" })
    const missing = yield* Effect.promise(() => sdk.v2.session.workReview.get({ sessionID: "ses_missing" }))
    expect(missing.response.status).toBe(404)
    expect(missing.error).toMatchObject({ _tag: "SessionNotFoundError" })

    const forged = {
      action: "submit" as const,
      expectedReviewRevision: 0,
      artifactID: "art_missing",
      expectedArtifactRevision: "a".repeat(64),
      actor: "admin",
    }
    const invalid = yield* Effect.promise(() =>
      sdk.v2.session.workReview.transition({ sessionID: session.id, workReviewCommand: forged }),
    )
    expect(invalid.response.status).toBe(400)
    expect(invalid.data).toBeUndefined()
    const unchanged = yield* Effect.promise(() => sdk.v2.session.workReview.get({ sessionID: session.id }))
    expect(unchanged.data).toEqual({ data: { status: "none" } })
  }),
)
