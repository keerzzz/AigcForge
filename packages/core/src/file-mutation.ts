export * as FileMutation from "./file-mutation.js"

import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { dirname } from "path"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Bom } from "@aigcfroge/util/bom"
import { Environment } from "./environment/index.js"
import type { Files } from "./environment/index.js"
import type { FileAccess } from "./file-access.js"

export type Target = Pick<FileAccess.Target, "absolute" | "resource">

export interface WriteInput {
  readonly target: Target
  readonly content: string | Uint8Array
}

export interface TextWriteInput {
  readonly target: Target
  readonly content: string
}

export class TargetExistsError extends Schema.TaggedError<TargetExistsError>()("FileMutation.TargetExistsError", {
  path: Schema.String,
}) {}

export class StaleContentError extends Schema.TaggedError<StaleContentError>()("FileMutation.StaleContentError", {
  path: Schema.String,
}) {}

export interface ConditionalWriteInput extends WriteInput {
  readonly expected: Uint8Array
}

export interface WriteResult {
  readonly operation: "write"
  readonly target: string
  readonly resource: string
  readonly existed: boolean
}

export interface RemoveInput {
  readonly target: Target
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
  /** Serialize a complete read/prepare/write mutation transaction by resolved path. */
  readonly withLock: (
    targets: ReadonlyArray<string>,
  ) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly write: (input: WriteInput) => Effect.Effect<WriteResult, Environment.Failed>
  /** Create without replacing an existing target. */
  readonly create: (input: WriteInput) => Effect.Effect<WriteResult, TargetExistsError | Environment.Failed>
  /** Commit only if an existing target still has the expected bytes. */
  readonly writeIfUnchanged: (
    input: ConditionalWriteInput,
  ) => Effect.Effect<WriteResult, StaleContentError | Environment.Failed>
  /** Write text while retaining an existing UTF-8 BOM and emitting at most one BOM. */
  readonly writeTextPreservingBom: (
    input: TextWriteInput,
  ) => Effect.Effect<WriteResult, Environment.WrongKind | Environment.Failed>
  readonly remove: (input: RemoveInput) => Effect.Effect<RemoveResult, Environment.Failed>
  /** Atomically write to a temp file then move to target. Returns prior bytes for rollback. */
  readonly writeAtomic: (
    input: AtomicWriteInput,
  ) => Effect.Effect<AtomicWriteResult, Environment.NotFound | Environment.WrongKind | Environment.Failed>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/FileMutation") {}

export const readText = Effect.fn("FileMutation.readText")(function* (files: Files, target: string) {
  return Bom.decodeBytes((yield* files.read(target)).bytes)
})

export const syncTextBom = Effect.fn("FileMutation.syncTextBom")(function* (
  files: Files,
  target: string,
  bom: boolean,
) {
  const synced = Bom.syncBytes((yield* files.read(target)).bytes, bom)
  if (synced.bytes) yield* files.write(target, synced.bytes)
  return synced.text
})

/** Share transaction locks across Location graphs that address the same file. */
const transactionLocks = KeyedMutex.makeUnsafe<string>()

/**
 * Mutation locking is process-local and serializes cooperating AigcForge
 * changes; external writes can still race.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const withLock: Interface["withLock"] = (targets) => (effect) =>
      [...new Set(targets.map(FSUtil.resolve))]
        .sort()
        .reduceRight((result, target) => transactionLocks.withLock(target)(result), effect)
    const withTargetLock =
      (target: Target) =>
      <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        locks.withLock(target.absolute)(Effect.uninterruptible(effect))

    const writeResult = (target: Target, existed: boolean): WriteResult => ({
      operation: "write",
      target: target.absolute,
      resource: target.resource,
      existed,
    })

    const write = Effect.fn("FileMutation.write")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* environment.files.stat(input.target.absolute).pipe(
            Effect.as(true),
            Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
          )
          yield* environment.files.write(
            input.target.absolute,
            typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content,
          )
          return writeResult(input.target, existed)
        }),
      ),
    )

    const create = Effect.fn("FileMutation.create")((input: WriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const exists = yield* environment.files.stat(input.target.absolute).pipe(
            Effect.as(true),
            Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
          )
          if (exists) return yield* new TargetExistsError({ path: input.target.absolute })
          yield* environment.files.mkdir(dirname(input.target.absolute)).pipe(Effect.catch(() => Effect.void))
          yield* environment.files.write(
            input.target.absolute,
            typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content,
          )
          return writeResult(input.target, false)
        }),
      ),
    )

    const writeIfUnchanged = Effect.fn("FileMutation.writeIfUnchanged")((input: ConditionalWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const current = yield* environment.files.read(input.target.absolute).pipe(
            Effect.map((result) => result.bytes),
            Effect.orDie,
          )
          if (!sameBytes(current, input.expected)) {
            return yield* new StaleContentError({ path: input.target.absolute })
          }
          yield* environment.files.write(
            input.target.absolute,
            typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content,
          )
          return writeResult(input.target, true)
        }),
      ),
    )

    const writeTextPreservingBom = Effect.fn("FileMutation.writeTextPreservingBom")((input: TextWriteInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const next = Bom.split(input.content)
          const current = yield* environment.files.read(input.target.absolute, { offset: 0, length: 3 }).pipe(
            Effect.map((result) => result.bytes),
            Effect.catchTag("Environment.NotFound", () => Effect.undefined),
          )
          yield* environment.files.write(
            input.target.absolute,
            new TextEncoder().encode(Bom.join(next.text, Boolean(current && Bom.has(current)) || next.bom)),
          )
          return writeResult(input.target, current !== undefined)
        }),
      ),
    )

    const remove = Effect.fn("FileMutation.remove")((input: RemoveInput) =>
      withTargetLock(input.target)(
        Effect.gen(function* () {
          const existed = yield* environment.files.stat(input.target.absolute).pipe(
            Effect.as(true),
            Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
          )
          if (existed) yield* environment.files.remove(input.target.absolute)
          return {
            operation: "remove" as const,
            target: input.target.absolute,
            resource: input.target.resource,
            existed,
          }
        }),
      ),
    )

    const writeAtomic = Effect.fn("FileMutation.writeAtomic")((input: AtomicWriteInput) =>
      withTargetLock(input.target)(
        Effect.scoped(
          Effect.gen(function* () {
            const absolute = input.target.absolute
            const tmp = `${absolute}.tmp.${process.pid}.${randomHex()}`
            const existed = yield* environment.files.stat(absolute).pipe(
              Effect.as(true),
              Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
            )
            // Tolerate a TOCTOU delete between stat and read (file removed after
            // existed=true) by treating the missing file as no prior bytes; any other
            // read error still propagates.
            const priorBytes: Uint8Array | null = existed
              ? yield* environment.files.read(absolute).pipe(
                  Effect.map((result) => result.bytes),
                  Effect.catchTag("Environment.NotFound", () => Effect.succeed(null)),
                )
              : null

            // Register temp cleanup on any failure or interruption.
            yield* Effect.addFinalizer(() => environment.files.remove(tmp).pipe(Effect.catch(() => Effect.void)))

            // The process-backed environment writes create the file but not the parent;
            // an absent directory surfaces as Failed, so ensure it first (mkdir on an
            // existing directory also fails and is ignored).
            yield* environment.files.mkdir(dirname(absolute)).pipe(Effect.catch(() => Effect.void))
            const bytes = typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content
            yield* environment.files.write(tmp, bytes)
            yield* environment.files.move(tmp, absolute)

            return {
              operation: "atomic_write" as const,
              target: absolute,
              resource: input.target.resource,
              existed,
              priorBytes,
            }
          }),
        ),
      ),
    )

    return Service.of({ withLock, write, create, writeIfUnchanged, writeTextPreservingBom, remove, writeAtomic })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Environment.node] })

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  return left.every((byte, index) => byte === right[index])
}

function randomHex() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Deferred until the corresponding integrations exist.
 */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after snapshot design exists.
// TODO: Notify LSP and collect diagnostics after LSP runtime exists.
// TODO: Design multi-file transactions / rollback if patch needs atomic edits.
// Until then, edits are sequential and report partial application.
// TODO: Define crash recovery and idempotency for side effects between Tool.Called and durable settlement.
