export * as FileMutation from "./file-mutation"

import { Context, Effect, Layer, Schema } from "effect"
import { dirname } from "path"
import { KeyedMutex } from "./effect/keyed-mutex"
import { FSUtil } from "./fs-util"

export interface Target {
  readonly canonical: string
  readonly resource: string
}

export interface WriteInput {
  readonly target: Target
  readonly content: string | Uint8Array
}

export interface TextWriteInput {
  readonly target: Target
  readonly content: string
}

export interface ConditionalWriteInput extends WriteInput {
  readonly expected: Uint8Array
}

export interface RemoveInput {
  readonly target: Target
}

export class StaleContentError extends Schema.TaggedErrorClass<StaleContentError>()("FileMutation.StaleContentError", {
  path: Schema.String,
}) {}

export class TargetExistsError extends Schema.TaggedErrorClass<TargetExistsError>()("FileMutation.TargetExistsError", {
  path: Schema.String,
}) {}

export interface WriteResult {
  readonly operation: "write"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface RemoveResult {
  readonly operation: "remove"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface AtomicWriteInput {
  readonly target: Target
  readonly content: string | Uint8Array
}

export interface AtomicWriteResult {
  readonly operation: "atomic_write"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
  readonly priorBytes: Uint8Array | null
}

export interface Interface {
  /** Create without replacing an existing target. */
  readonly create: (input: WriteInput) => Effect.Effect<WriteResult, TargetExistsError | FSUtil.Error>
  readonly write: (input: WriteInput) => Effect.Effect<WriteResult, FSUtil.Error>
  /** Write text while retaining an existing UTF-8 BOM and emitting at most one BOM. */
  readonly writeTextPreservingBom: (input: TextWriteInput) => Effect.Effect<WriteResult, FSUtil.Error>
  /** Commit only if an existing target still has the expected bytes. */
  readonly writeIfUnchanged: (
    input: ConditionalWriteInput,
  ) => Effect.Effect<WriteResult, StaleContentError | FSUtil.Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<RemoveResult, FSUtil.Error>
  /** Atomically write to a temp file then rename to target. Returns prior bytes for rollback. */
  readonly writeAtomic: (input: AtomicWriteInput) => Effect.Effect<AtomicWriteResult, FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/FileMutation") {}

/**
 * Serialize file changes by canonical target. Conditional writes compare and
 * write under the same process-local lock so cooperating Aigcfroge mutations do
 * not overwrite changes made from the same stale content.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const withTargetLock =
      (target: Target) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        locks.withLock(target.canonical)(Effect.uninterruptible(effect))

    const writeResult = (target: Target, existed: boolean): WriteResult => ({
      operation: "write",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    const removeResult = (target: Target, existed: boolean): RemoveResult => ({
      operation: "remove",
      target: target.canonical,
      resource: target.resource,
      existed,
    })

    const write = Effect.fn("FileMutation.write")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* fs.exists(input.target.canonical)
          yield* fs.writeWithDirs(input.target.canonical, input.content)
          return writeResult(input.target, existed)
        }),
      ),
    )

    const writeTextPreservingBom = Effect.fn("FileMutation.writeTextPreservingBom")((input: TextWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const next = splitBom(input.content)
          const current = yield* fs
            .readFile(input.target.canonical)
            .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)))
          yield* fs.writeWithDirs(
            input.target.canonical,
            joinBom(next.text, Boolean(current && hasUtf8Bom(current)) || next.bom),
          )
          return writeResult(input.target, current !== undefined)
        }),
      ),
    )

    const create = Effect.fn("FileMutation.create")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const write =
            typeof input.content === "string"
              ? fs.writeFileString(input.target.canonical, input.content, { flag: "wx" })
              : fs.writeFile(input.target.canonical, input.content, { flag: "wx" })
          yield* write.pipe(
            Effect.catchReason("PlatformError", "NotFound", () =>
              fs.ensureDir(dirname(input.target.canonical)).pipe(Effect.andThen(write)),
            ),
            Effect.catchReason("PlatformError", "AlreadyExists", () =>
              Effect.fail(new TargetExistsError({ path: input.target.canonical })),
            ),
          )
          return writeResult(input.target, false)
        }),
      ),
    )

    const writeIfUnchanged = Effect.fn("FileMutation.writeIfUnchanged")((input: ConditionalWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const current = yield* fs.readFile(input.target.canonical)
          if (!sameBytes(current, input.expected)) {
            return yield* new StaleContentError({ path: input.target.canonical })
          }
          yield* typeof input.content === "string"
            ? fs.writeFileString(input.target.canonical, input.content)
            : fs.writeFile(input.target.canonical, input.content)
          return writeResult(input.target, true)
        }),
      ),
    )

    const remove = Effect.fn("FileMutation.remove")((input: RemoveInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* fs.remove(input.target.canonical).pipe(
            Effect.as(true),
            Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(false)),
          )
          return removeResult(input.target, existed)
        }),
      ),
    )

    const writeAtomic = Effect.fn("FileMutation.writeAtomic")((input: AtomicWriteInput) =>
      withTargetLock(input.target)(
        Effect.scoped(
          Effect.gen(function* () {
            const { canonical } = input.target
            const tmp = `${canonical}.tmp.${process.pid}.${randomHex()}`
            const existed = yield* fs.exists(canonical)
            // Tolerate a TOCTOU delete between exists and read (file removed after
            // exists=true) by treating the missing file as no prior bytes; any other
            // read error still propagates.
            const priorBytes: Uint8Array | null = existed
              ? yield* fs
                  .readFile(canonical)
                  .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)))
              : null

            // Register temp cleanup on any failure or interruption
            yield* Effect.addFinalizer(() =>
              fs.exists(tmp).pipe(
                Effect.andThen((exists) => (exists ? fs.remove(tmp) : Effect.void)),
                Effect.catch(() => Effect.void),
              ),
            )

            yield* (
              typeof input.content === "string"
                ? fs.writeFileString(tmp, input.content)
                : fs.writeFile(tmp, input.content)
            ).pipe(
              Effect.catchReason("PlatformError", "NotFound", () =>
                fs
                  .makeDirectory(dirname(tmp), { recursive: true })
                  .pipe(
                    Effect.andThen(
                      typeof input.content === "string"
                        ? fs.writeFileString(tmp, input.content)
                        : fs.writeFile(tmp, input.content),
                    ),
                  ),
              ),
            )
            yield* fs.rename(tmp, canonical)

            return {
              operation: "atomic_write" as const,
              target: canonical,
              resource: input.target.resource,
              existed,
              priorBytes,
            } satisfies AtomicWriteResult
          }),
        ),
      ),
    )

    return Service.of({ create, write, writeTextPreservingBom, writeIfUnchanged, remove, writeAtomic })
  }),
)

function splitBom(text: string) {
  const stripped = text.replace(/^\uFEFF+/, "")
  return { bom: stripped.length !== text.length, text: stripped }
}

function joinBom(text: string, bom: boolean) {
  const stripped = splitBom(text).text
  return bom ? `\uFEFF${stripped}` : stripped
}

function hasUtf8Bom(content: Uint8Array) {
  return content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  return left.every((byte, index) => byte === right[index])
}

function randomHex() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export const locationLayer = layer

/**
 * Deferred until the corresponding V2 integrations exist.
 */
// TODO: Add formatter integration after V2 formatter runtime exists.
// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add snapshots / undo after V2 snapshot design exists.
// TODO: Notify LSP and collect diagnostics after V2 LSP runtime exists.
// TODO: Design multi-file transactions / rollback if apply_patch needs atomic edits.
// Until then, edits are sequential and report partial application.
// TODO: Define crash recovery and idempotency for side effects between Tool.Called and durable settlement.
