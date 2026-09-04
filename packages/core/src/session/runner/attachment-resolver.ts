export * as AttachmentResolver from "./attachment-resolver"

import path from "path"
import { fileURLToPath } from "url"
import { Effect, FileSystem } from "effect"
import { SessionMessage } from "../message"
import type { FileAttachment } from "../prompt"

/**
 * Resolves deferred attachment URIs into provider-lowerable data URIs, at the
 * last moment before a provider turn.
 *
 * D2 option (b): the canonical `session.prompt` endpoint accepts a `file://`
 * attachment and stores it as-is, so a client does not have to base64 a large
 * file into the request just to reference something already on disk. Nothing
 * downstream can lower a bare URI, so resolution has to happen somewhere — here,
 * where the session's Location is known and the filesystem is reachable.
 *
 * SECURITY: the URI is client-supplied and this code runs server-side with the
 * process's filesystem rights, so every resolution is confined to the session's
 * Location. `realPath` is applied to both sides before comparing, so a symlink
 * inside the project cannot point out of it. A refusal never reads the file.
 *
 * A refused or unreadable attachment does not fail the turn. It is replaced by an
 * explicit marker in the message text, matching what the V1 path does when the
 * Read tool fails and what `to-llm-message` does for anything still unlowerable.
 * The user asked for that file, so silence is the one unacceptable outcome.
 */
const DATA_PREFIX = "data:"

const marker = (reason: string, uri: string) => `[Attachment omitted: ${uri} — ${reason}]`

const confine = (fs: FileSystem.FileSystem, root: string, uri: string) =>
  Effect.gen(function* () {
    const requested = fileURLToPath(uri)
    // Resolve both sides first: comparing raw paths lets `..` segments and any
    // symlink inside the project escape it.
    const realRoot = yield* fs.realPath(root)
    const realTarget = yield* fs.realPath(requested)
    const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`
    if (realTarget !== realRoot && !realTarget.startsWith(prefix)) return undefined
    const info = yield* fs.stat(realTarget)
    if (info.type === "Directory") return undefined
    return realTarget
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))

const resolveOne = (fs: FileSystem.FileSystem, root: string, file: FileAttachment) =>
  Effect.gen(function* () {
    if (file.uri.startsWith(DATA_PREFIX)) return { file }
    if (!file.uri.startsWith("file:")) {
      // http(s), MCP `resource:` and anything else: no resolver yet. Say so
      // rather than handing a bare URI to a provider's base64 validator.
      return { note: marker("only data: and file: attachments can be lowered", file.name ?? file.uri) }
    }
    const absolute = yield* confine(fs, root, file.uri)
    if (absolute === undefined) {
      return { note: marker("outside this session's project, or not a readable file", file.name ?? file.uri) }
    }
    const bytes = yield* fs.readFile(absolute).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (bytes === undefined) return { note: marker("could not be read", file.name ?? file.uri) }
    return {
      file: { ...file, uri: `${DATA_PREFIX}${file.mime};base64,${Buffer.from(bytes).toString("base64")}` },
    }
  })

/**
 * Rewrites every user message's attachments in place. Non-user messages and
 * messages without attachments are returned untouched, so this is a no-op for the
 * overwhelmingly common case.
 */
export const resolveDeferred = Effect.fn("AttachmentResolver.resolveDeferred")(function* (
  messages: readonly SessionMessage.Message[],
  locationDirectory: string,
) {
  if (!messages.some((message) => message.type === "user" && (message.files?.length ?? 0) > 0)) return messages
  const fs = yield* FileSystem.FileSystem
  const out: SessionMessage.Message[] = []
  for (const message of messages) {
    if (message.type !== "user" || (message.files?.length ?? 0) === 0) {
      out.push(message)
      continue
    }
    const resolved = yield* Effect.forEach(message.files ?? [], (file) => resolveOne(fs, locationDirectory, file), {
      discard: false,
    })
    const files = resolved.flatMap((item) => (item.file === undefined ? [] : [item.file]))
    const notes = resolved.flatMap((item) => (item.note === undefined ? [] : [item.note]))
    out.push({
      ...message,
      files,
      ...(notes.length === 0 ? {} : { text: [message.text, ...notes].filter((part) => part.length > 0).join("\n\n") }),
    })
  }
  return out
})
