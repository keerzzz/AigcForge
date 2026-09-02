import { describe, expect } from "bun:test"
import { Hash } from "@aigcfroge/core/util/hash"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { Composition } from "@aigcfroge/schema/composition"
import { Database } from "@aigcfroge/core/database/database"
import { Effect, FileSystem, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { Session } from "@/session/session"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Database.defaultLayer, httpApiLayer))
const capableHeaders = { [ProductModePolicy.CAPABILITIES_HEADER]: ProductModePolicy.CAPABILITY_CUSTOM_V1 }
const AdmittedResponse = Schema.toCodecJson(
  Schema.Struct({
    // `admittedSeq` is what makes the exact-retry assertion below real: the
    // caller supplies `id`, so comparing it proves nothing, while a second inbox
    // row would necessarily carry a new sequence number.
    data: Schema.Struct({
      kind: Schema.Literal("command"),
      command: Schema.String,
      id: SessionMessage.ID,
      admittedSeq: Schema.Number,
    }),
  }),
)
const CustomCreateResponse = Schema.toCodecJson(
  Schema.Struct({
    data: Schema.Struct({ id: SessionV2.ID }),
    snapshot: Composition.Snapshot,
  }),
)

function post(path: string, directory: string, body: unknown, capable = true) {
  return requestInDirectory(path, directory, {
    method: "POST",
    headers: { "content-type": "application/json", ...(capable ? capableHeaders : {}) },
    body: JSON.stringify(body),
  })
}

const enableCustomMode = Effect.gen(function* () {
  const saved = process.env["AIGCFROGE_CUSTOM_MODE"]
  process.env["AIGCFROGE_CUSTOM_MODE"] = "true"
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (saved === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
      else process.env["AIGCFROGE_CUSTOM_MODE"] = saved
    }),
  )
})

describe.serial("Canonical session.command endpoint (S5 leg 3)", () => {
  it.instance(
    "admits a frozen snapshot command through /api/session/:id/command and drains it expanded",
    () =>
      Effect.gen(function* () {
        yield* enableCustomMode
        const test = yield* TestInstance
        const fs = yield* FileSystem.FileSystem
        yield* fs.makeDirectory(`${test.directory}/.aigcfroge/agents`, { recursive: true })
        const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
        yield* fs.writeFileString(`${test.directory}/.aigcfroge/agents/coder.md`, agentRaw)
        yield* fs.makeDirectory(`${test.directory}/.aigcfroge/commands`, { recursive: true })
        const commandRaw = `---\nkind: command\nname: review\ndescription: Review the change\ninvocation: /review $1\n---\nReview it without executing.\n`
        yield* fs.writeFileString(`${test.directory}/.aigcfroge/commands/review.md`, commandRaw)
        const commandRev = Hash.sha256(Buffer.from(commandRaw))

        const create = yield* post(`/api/session/custom`, test.directory, {
          composition: {
            source: "temporary",
            agents: [{ kind: "agent", relativePath: "coder.md", revision: Hash.sha256(Buffer.from(agentRaw)) }],
            bindings: {
              orchestrator: {
                prompts: [],
                skills: [],
                commands: [{ kind: "command", relativePath: "review.md", revision: commandRev }],
              },
            },
            presentation: "native",
            requestedCapabilities: [],
          },
          location: { directory: test.directory },
          title: "command endpoint custom",
        })
        expect(create.status).toBe(200)
        const body = Schema.decodeUnknownSync(CustomCreateResponse)(yield* create.json)
        const sessionID = body.data.id

        const messageID = SessionMessage.ID.make(`msg_cmd_http_${Date.now()}`)
        const admitted = yield* post(`/api/session/${sessionID}/command`, test.directory, {
          id: messageID,
          command: "review",
          arguments: "src/main.ts",
          resume: false,
        })
        expect(admitted.status).toBe(200)
        const decoded = Schema.decodeUnknownSync(AdmittedResponse)(yield* admitted.json)
        expect(decoded.data.kind).toBe("command")
        expect(decoded.data.command).toBe("review")

        // Exact retry with the same message ID is idempotent: the same admission
        // comes back, so no second inbox row was created. `admittedSeq` is the
        // discriminator — a fresh row would increment it. The durable row/wake
        // counts themselves are pinned in core (session-command.test.ts:216).
        const retry = yield* post(`/api/session/${sessionID}/command`, test.directory, {
          id: messageID,
          command: "review",
          arguments: "src/main.ts",
          resume: false,
        })
        expect(retry.status).toBe(200)
        const retryDecoded = Schema.decodeUnknownSync(AdmittedResponse)(yield* retry.json)
        expect(retryDecoded.data.command).toBe("review")
        expect(retryDecoded.data.id).toBe(messageID)
        expect(retryDecoded.data.admittedSeq).toBe(decoded.data.admittedSeq)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "fails closed with a typed 400 for a command that is not in the frozen consumer catalog",
    () =>
      Effect.gen(function* () {
        yield* enableCustomMode
        const test = yield* TestInstance
        const fs = yield* FileSystem.FileSystem
        yield* fs.makeDirectory(`${test.directory}/.aigcfroge/agents`, { recursive: true })
        const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
        yield* fs.writeFileString(`${test.directory}/.aigcfroge/agents/coder.md`, agentRaw)

        const create = yield* post(`/api/session/custom`, test.directory, {
          composition: {
            source: "temporary",
            agents: [{ kind: "agent", relativePath: "coder.md", revision: Hash.sha256(Buffer.from(agentRaw)) }],
            bindings: {
              orchestrator: { prompts: [], skills: [], commands: [] },
            },
            presentation: "native",
            requestedCapabilities: [],
          },
          location: { directory: test.directory },
          title: "command endpoint empty",
        })
        expect(create.status).toBe(200)
        const body = Schema.decodeUnknownSync(CustomCreateResponse)(yield* create.json)
        const sessionID = body.data.id

        const response = yield* post(`/api/session/${sessionID}/command`, test.directory, {
          command: "no-such-command",
          resume: false,
        })
        expect(response.status).toBe(400)
        const error = Schema.decodeUnknownSync(Schema.Struct({ _tag: Schema.String, message: Schema.String }))(
          yield* response.json,
        )
        expect(error._tag).toBe("InvalidRequestError")
        expect(error.message).toContain("unavailable")
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects a command admission for clients without the custom capability as a typed unsupported error",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const session = yield* Session.use.create({ title: "custom-but-incapable" })
        const { db } = yield* Database.Service
        yield* db.update(SessionTable).set({ mode: "custom" }).where(eq(SessionTable.id, session.id))
        const response = yield* post(`/api/session/${session.id}/command`, test.directory, { command: "review" }, false)
        expect({ status: response.status, body: yield* response.json }).toMatchObject({
          status: 400,
          body: { _tag: "UnsupportedProductModeError" },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
