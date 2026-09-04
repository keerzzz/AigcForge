import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { AttachmentResolver } from "@aigcfroge/core/session/runner/attachment-resolver"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionV2 } from "@aigcfroge/core/session"
import { FileAttachment } from "@aigcfroge/core/session/prompt"
import { NodeFileSystem } from "@effect/platform-node"
import { testEffect } from "./lib/effect"

// D2 (b): deferred `file://` attachments are resolved at provider-lowering time,
// and the URI is CLIENT-SUPPLIED — `POST /api/session/:id/prompt` takes the
// canonical Prompt straight from the request body. So the security property under
// test is not "does it read the file" but "does it refuse everything outside the
// session's Location, without reading it".

const it = testEffect(NodeFileSystem.layer)

const userMessage = (uri: string, mime = "image/png") =>
  SessionMessage.User.make({
    id: SessionMessage.ID.make("msg_attach"),
    type: "user",
    text: "look at this",
    files: [FileAttachment.make({ uri, mime, name: path.basename(uri) })],
    time: { created: DateTime.makeUnsafe(1) },
  })

const temp = (prefix: string) =>
  fs.mkdtemp(path.join(process.env["TMPDIR"] ?? process.env["TEMP"] ?? process.env["TMP"] ?? "/tmp", prefix))

const resolveIn = (root: string, uri: string, mime?: string) =>
  AttachmentResolver.resolveDeferred([userMessage(uri, mime)], root)

describe("AttachmentResolver.resolveDeferred", () => {
  it.effect("an in-project file becomes a data URI", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => temp("attach-"))
      const file = path.join(dir, "shot.png")
      yield* Effect.promise(() => fs.writeFile(file, Buffer.from([1, 2, 3])))

      const out = yield* resolveIn(dir, `file://${file}`)

      const message = out[0]
      expect(message?.type).toBe("user")
      if (message?.type !== "user") return
      expect(message.files?.[0]?.uri).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString("base64")}`)
      expect(message.text).toBe("look at this")
    }),
  )

  it.effect("a file outside the project is refused and never read", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => temp("attach-"))
      const outside = yield* Effect.promise(() => temp("outside-"))
      const secret = path.join(outside, "secret.png")
      yield* Effect.promise(() => fs.writeFile(secret, "top secret"))

      const out = yield* resolveIn(dir, `file://${secret}`)

      const message = out[0]
      if (message?.type !== "user") throw new Error("expected a user message")
      expect(message.files).toHaveLength(0)
      expect(message.text).toContain("outside this session's project")
      // The refusal must not smuggle the bytes into the marker.
      expect(message.text).not.toContain("top secret")
    }),
  )

  it.effect("a traversal path is refused", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => temp("attach-"))
      const nested = path.join(dir, "nested")
      yield* Effect.promise(() => fs.mkdir(nested))
      const escape = path.join(nested, "..", "..", "etc-passwd-stand-in")

      const out = yield* resolveIn(dir, `file://${escape}`)

      const message = out[0]
      if (message?.type !== "user") throw new Error("expected a user message")
      expect(message.files).toHaveLength(0)
      expect(message.text).toContain("outside this session's project")
    }),
  )

  it.effect("a symlink pointing out of the project is refused", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => temp("attach-"))
      const outside = yield* Effect.promise(() => temp("outside-"))
      const secret = path.join(outside, "secret.png")
      yield* Effect.promise(() => fs.writeFile(secret, "top secret"))
      const link = path.join(dir, "innocent.png")
      yield* Effect.promise(() => fs.symlink(secret, link))

      // The raw path is inside the project; only realPath reveals the escape.
      const out = yield* resolveIn(dir, `file://${link}`)

      const message = out[0]
      if (message?.type !== "user") throw new Error("expected a user message")
      expect(message.files).toHaveLength(0)
      expect(message.text).not.toContain("top secret")
    }),
  )

  it.effect("a directory is refused rather than read", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() => temp("attach-"))
      const nested = path.join(dir, "nested")
      yield* Effect.promise(() => fs.mkdir(nested))

      const out = yield* resolveIn(dir, `file://${nested}`)

      const message = out[0]
      if (message?.type !== "user") throw new Error("expected a user message")
      expect(message.files).toHaveLength(0)
    }),
  )

  it.effect("data URIs and messages without attachments pass through untouched", () =>
    Effect.gen(function* () {
      const inline = userMessage("data:image/png;base64,AAAA")
      const plain = SessionMessage.Synthetic.make({
        id: SessionMessage.ID.make("msg_plain"),
        sessionID: SessionV2.ID.make("ses_attach"),
        type: "synthetic",
        text: "no files here",
        time: { created: DateTime.makeUnsafe(2) },
      })

      const out = yield* AttachmentResolver.resolveDeferred([inline, plain], "/anywhere")

      // A data: attachment is already lowerable, so its content must survive
      // untouched — it is rebuilt rather than returned by identity because the
      // message goes through the rewrite branch, which is why this is toEqual.
      expect(out[0]).toEqual(inline)
      // A message with no attachments takes the fast path and is not copied.
      expect(out[1]).toBe(plain)
    }),
  )
})
