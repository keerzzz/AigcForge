import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { CustomProfile as SchemaCustomProfile } from "@aigcfroge/schema/custom-profile"
import { CustomProfileService } from "@aigcfroge/core/custom-profile-service"
import { CustomProfile } from "@aigcfroge/core/custom-profile"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { EventV2 } from "@aigcfroge/core/event"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"

function locationLayer(dir: string) {
  return Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(dir) })))
}

interface Injection {
  /** While count > 0, the registry decorator fails reload() once per count. */
  readonly reloadFailures?: { count: number }
  /** While on, the FileMutation decorator fails writeAtomic. */
  readonly failWriteAtomic?: { on: boolean }
  /** While on, the FileMutation decorator reports remove success without deleting. */
  readonly noopRemove?: { on: boolean }
  /** While on with info set, the registry decorator returns that stale entry from getByPath. */
  readonly staleRegistryHit?: { on: boolean; info: CustomProfile.Info | undefined }
}

function fullLayer(dir: string, inject: Injection = {}) {
  const reloadFailures = inject.reloadFailures ?? { count: 0 }
  const failWriteAtomic = inject.failWriteAtomic ?? { on: false }
  const noopRemove = inject.noopRemove ?? { on: false }
  const staleRegistryHit = inject.staleRegistryHit ?? { on: false, info: undefined }

  // Decorators over the real layers: only the injected method deviates,
  // everything else delegates to the real implementation.
  const registryLayer = Layer.effect(
    CustomProfile.Service,
    Effect.gen(function* () {
      const real = yield* CustomProfile.Service
      return CustomProfile.Service.of({
        list: () => real.list(),
        getByPath: (relativePath) => {
          if (staleRegistryHit.on && staleRegistryHit.info !== undefined) {
            return Effect.succeed(staleRegistryHit.info)
          }
          return real.getByPath(relativePath)
        },
        findByName: (name) => real.findByName(name),
        listInvalid: () => real.listInvalid(),
        getInvalid: (relativePath) => real.getInvalid(relativePath),
        reload: () => {
          if (reloadFailures.count > 0) {
            reloadFailures.count -= 1
            return Effect.fail(
              new FSUtil.FileSystemError({ method: "reload", cause: new Error("injected reload failure") }),
            )
          }
          return real.reload()
        },
      } satisfies CustomProfile.Interface)
    }),
  ).pipe(Layer.provide(CustomProfile.locationLayer))

  const fileMutationLayer = Layer.effect(
    FileMutation.Service,
    Effect.gen(function* () {
      const real = yield* FileMutation.Service
      return FileMutation.Service.of({
        create: (input) => real.create(input),
        write: (input) => real.write(input),
        writeTextPreservingBom: (input) => real.writeTextPreservingBom(input),
        writeIfUnchanged: (input) => real.writeIfUnchanged(input),
        remove: (input) =>
          noopRemove.on
            ? Effect.succeed({
                operation: "remove",
                target: input.target.canonical,
                resource: input.target.resource,
                existed: true,
              } satisfies FileMutation.RemoveResult)
            : real.remove(input),
        writeAtomic: (input) =>
          failWriteAtomic.on
            ? Effect.fail(
                new FSUtil.FileSystemError({ method: "writeAtomic", cause: new Error("injected write failure") }),
              )
            : real.writeAtomic(input),
      } satisfies FileMutation.Interface)
    }),
  ).pipe(Layer.provide(FileMutation.locationLayer))

  return CustomProfileService.locationLayer.pipe(
    Layer.provide(fileMutationLayer),
    Layer.provide(LocationMutation.locationLayer),
    // provideMerge keeps CustomProfile.Service in the output so tests can
    // assert on registry state after compensation runs.
    Layer.provideMerge(registryLayer),
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(locationLayer(dir)),
    Layer.provide(FSUtil.defaultLayer),
  )
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const tmp = await tmpdir()
  try {
    return await fn(tmp.path)
  } finally {
    await tmp[Symbol.asyncDispose]()
  }
}

function makeCandidate(name: string, description = "test profile"): SchemaCustomProfile.Candidate {
  return Schema.decodeUnknownSync(SchemaCustomProfile.Candidate)({
    name,
    description,
    relativePath: `${name}.yaml`,
    profile: {
      kind: "custom-profile",
      name,
      description,
      agents: [
        {
          kind: "agent",
          relativePath: "coder.md",
          revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
      ],
      bindings: {
        "agents/coder": {
          prompts: [],
          skills: [],
        },
      },
      presentation: "native",
      requestedCapabilities: ["workspace.read"],
    },
  })
}

describe("CustomProfileService", () => {
  test("propose returns not-exists for new profile and exists for on-disk profile", async () => {
    await withTmp(async (dir) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CustomProfileService.Service
          const r1 = yield* svc.propose(makeCandidate("my-profile"))
          expect(r1.exists).toBe(false)
          expect(r1.revision).toBeNull()

          // Apply profile
          const created = yield* svc.apply({
            candidate: makeCandidate("my-profile"),
            baseRevision: null,
            overwrite: false,
          })
          expect(created.name).toBe("my-profile")
          expect(created.revision).toHaveLength(64)

          // Propose again
          const r2 = yield* svc.propose(makeCandidate("my-profile"))
          expect(r2.exists).toBe(true)
          expect(r2.revision).toBe(created.revision)
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
    })
  })

  test("apply fails with StaleRevisionError when file exists and baseRevision is null", async () => {
    await withTmp(async (dir) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CustomProfileService.Service
          yield* svc.apply({
            candidate: makeCandidate("profile-1"),
            baseRevision: null,
            overwrite: false,
          })

          // Apply without overwrite
          const err = yield* svc
            .apply({
              candidate: makeCandidate("profile-1", "updated desc"),
              baseRevision: null,
              overwrite: false,
            })
            .pipe(Effect.flip)

          expect(err._tag).toBe("CustomProfileService.StaleRevision")
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
    })
  })

  test("apply updates profile when matching baseRevision and overwrite: true", async () => {
    await withTmp(async (dir) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CustomProfileService.Service
          const created = yield* svc.apply({
            candidate: makeCandidate("profile-2"),
            baseRevision: null,
            overwrite: false,
          })

          const updated = yield* svc.apply({
            candidate: makeCandidate("profile-2", "new description"),
            baseRevision: created.revision,
            overwrite: true,
          })

          expect(updated.description).toBe("new description")
          expect(updated.revision).not.toBe(created.revision)
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
    })
  })

  test("delete removes profile with matching baseRevision and rejects stale revision", async () => {
    await withTmp(async (dir) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CustomProfileService.Service
          const created = yield* svc.apply({
            candidate: makeCandidate("to-delete"),
            baseRevision: null,
            overwrite: false,
          })

          // Stale revision delete fails
          const badDel = yield* svc
            .delete({
              relativePath: created.relativePath,
              baseRevision: "0000000000000000000000000000000000000000000000000000000000000000",
            })
            .pipe(Effect.flip)
          expect(badDel._tag).toBe("CustomProfileService.StaleRevision")

          // Valid delete succeeds
          const deleteRes = yield* svc.delete({
            relativePath: created.relativePath,
            baseRevision: created.revision,
          })
          expect(deleteRes.relativePath).toBe(created.relativePath)
          expect(deleteRes.referencingProfiles).toHaveLength(0)

          const afterDel = yield* svc.propose(makeCandidate("to-delete"))
          expect(afterDel.exists).toBe(false)
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
    })
  })

  test("apply rejects candidate when top-level name and profile name mismatch", async () => {
    await withTmp(async (dir) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CustomProfileService.Service
          const candidate = Schema.decodeUnknownSync(SchemaCustomProfile.Candidate)({
            name: "mismatched-name",
            description: "test",
            relativePath: "mismatched-name.yaml",
            profile: {
              kind: "custom-profile",
              name: "other-name",
              description: "test",
              agents: [
                {
                  kind: "agent",
                  relativePath: "coder.md",
                  revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                },
              ],
              bindings: {
                "agents/coder": {
                  prompts: [],
                  skills: [],
                },
              },
              presentation: "native",
              requestedCapabilities: [],
            },
          })

          const err = yield* svc
            .apply({
              candidate,
              baseRevision: null,
              overwrite: false,
            })
            .pipe(Effect.flip)
          expect(err._tag).toBe("CustomProfileService.InvalidCandidate")
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
    })
  })

  test("propose and apply preserve nested relativePath without flattening", async () => {
    await withTmp(async (dir) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CustomProfileService.Service
          const candidate = Schema.decodeUnknownSync(SchemaCustomProfile.Candidate)({
            name: "nested-profile",
            description: "nested profile description",
            relativePath: "nested/team/nested-profile.yaml",
            profile: {
              kind: "custom-profile",
              name: "nested-profile",
              description: "nested profile description",
              agents: [
                {
                  kind: "agent",
                  relativePath: "coder.md",
                  revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                },
              ],
              bindings: {
                "agents/coder": {
                  prompts: [],
                  skills: [],
                },
              },
              presentation: "native",
              requestedCapabilities: [],
            },
          })

          const proposed = yield* svc.propose(candidate)
          expect(proposed.relativePath).toBe("nested/team/nested-profile.yaml")
          expect(proposed.exists).toBe(false)

          const applied = yield* svc.apply({
            candidate,
            baseRevision: null,
            overwrite: false,
          })
          expect(applied.relativePath).toBe("nested/team/nested-profile.yaml")
          expect(applied.name).toBe("nested-profile")

          const proposedAfter = yield* svc.propose(candidate)
          expect(proposedAfter.exists).toBe(true)
          expect(proposedAfter.relativePath).toBe("nested/team/nested-profile.yaml")
          expect(proposedAfter.revision).toBe(applied.revision)

          const delRes = yield* svc.delete({
            relativePath: "nested/team/nested-profile.yaml",
            baseRevision: applied.revision,
          })
          expect(delRes.relativePath).toBe("nested/team/nested-profile.yaml")
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
    })
  })
})

describe("CustomProfileService delete compensation (failure injection)", () => {
  test("reload failure after delete restores the file and fails with WriteFailedError", async () => {
    await withTmp(async (dir) => {
      const inject = { reloadFailures: { count: 0 } }
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CustomProfileService.Service
          const registry = yield* CustomProfile.Service

          const created = yield* svc.apply({
            candidate: makeCandidate("reload-fail"),
            baseRevision: null,
            overwrite: false,
          })

          // Fail exactly the first registry.reload() inside delete.
          inject.reloadFailures.count = 1
          const err = yield* svc
            .delete({ relativePath: created.relativePath, baseRevision: created.revision })
            .pipe(Effect.flip)

          if (err._tag !== "CustomProfileService.WriteFailed") {
            throw new Error(`expected WriteFailed, got ${err._tag}`)
          }
          expect(err.relativePath).toBe(created.relativePath)
          expect(err.reason).toContain("reload after delete failed")
          expect(inject.reloadFailures.count).toBe(0)

          // Rollback restored the exact prior bytes on disk (propose hashes the file).
          const proposed = yield* svc.propose(makeCandidate("reload-fail"))
          expect(proposed.exists).toBe(true)
          expect(proposed.revision).toBe(created.revision)

          // The rollback reload succeeded, so the registry is consistent with disk again.
          const info = yield* registry.getByPath(created.relativePath)
          expect(info.revision).toBe(created.revision)
        }).pipe(Effect.provide(fullLayer(dir, inject)), Effect.scoped),
      )
    })
  })

  test("rollback write failure surfaces RollbackFailedError instead of swallowing it", async () => {
    await withTmp(async (dir) => {
      const inject = { reloadFailures: { count: 0 }, failWriteAtomic: { on: false } }
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CustomProfileService.Service
          const registry = yield* CustomProfile.Service

          const created = yield* svc.apply({
            candidate: makeCandidate("rollback-fail"),
            baseRevision: null,
            overwrite: false,
          })

          // Force the reload after delete to fail, then make the compensating
          // restore write fail too.
          inject.reloadFailures.count = 1
          inject.failWriteAtomic.on = true
          const err = yield* svc
            .delete({ relativePath: created.relativePath, baseRevision: created.revision })
            .pipe(Effect.flip)

          if (err._tag !== "CustomProfileService.RollbackFailed") {
            throw new Error(`expected RollbackFailed, got ${err._tag}`)
          }
          expect(err.relativePath).toBe(created.relativePath)
          expect(err.reason).toContain("writeAtomic")

          // The remove did happen on disk; the failed rollback could not restore it.
          const proposed = yield* svc.propose(makeCandidate("rollback-fail"))
          expect(proposed.exists).toBe(false)

          // The real reload never ran (the injected failure replaced it), so the
          // registry still holds the stale pre-delete entry — the inconsistency
          // that RollbackFailedError exists to signal.
          const info = yield* registry.getByPath(created.relativePath)
          expect(info.revision).toBe(created.revision)
        }).pipe(Effect.provide(fullLayer(dir, inject)), Effect.scoped),
      )
    })
  })

  test("file still on disk after remove triggers rollback and fails with WriteFailedError", async () => {
    await withTmp(async (dir) => {
      const inject = { noopRemove: { on: false } }
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CustomProfileService.Service
          const registry = yield* CustomProfile.Service

          const created = yield* svc.apply({
            candidate: makeCandidate("remove-noop"),
            baseRevision: null,
            overwrite: false,
          })

          // remove reports success without deleting, tripping the
          // "still exists on disk" readback gate.
          inject.noopRemove.on = true
          const err = yield* svc
            .delete({ relativePath: created.relativePath, baseRevision: created.revision })
            .pipe(Effect.flip)

          if (err._tag !== "CustomProfileService.WriteFailed") {
            throw new Error(`expected WriteFailed, got ${err._tag}`)
          }
          expect(err.relativePath).toBe(created.relativePath)
          expect(err.reason).toContain("still exists on disk")

          // Rollback ran against an unchanged file: bytes (and revision) are intact.
          const proposed = yield* svc.propose(makeCandidate("remove-noop"))
          expect(proposed.exists).toBe(true)
          expect(proposed.revision).toBe(created.revision)

          // The rollback reload kept the registry consistent with disk.
          const info = yield* registry.getByPath(created.relativePath)
          expect(info.revision).toBe(created.revision)
        }).pipe(Effect.provide(fullLayer(dir, inject)), Effect.scoped),
      )
    })
  })

  test("stale registry hit after reload triggers rollback and fails with ConcurrentModificationError", async () => {
    await withTmp(async (dir) => {
      const staleRegistryHit: { on: boolean; info: CustomProfile.Info | undefined } = { on: false, info: undefined }
      const inject: Injection = { staleRegistryHit }
      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* CustomProfileService.Service
          const registry = yield* CustomProfile.Service

          const created = yield* svc.apply({
            candidate: makeCandidate("stale-registry"),
            baseRevision: null,
            overwrite: false,
          })

          // The remove and reload both succeed for real, but the registry still
          // reports the pre-delete entry — the post-reload absence gate must roll
          // the file back and report the inconsistency.
          staleRegistryHit.on = true
          staleRegistryHit.info = created
          const err = yield* svc
            .delete({ relativePath: created.relativePath, baseRevision: created.revision })
            .pipe(Effect.flip)

          if (err._tag !== "CustomProfileService.ConcurrentModification") {
            throw new Error(`expected ConcurrentModification, got ${err._tag}`)
          }
          expect(err.relativePath).toBe(created.relativePath)
          staleRegistryHit.on = false

          // Rollback restored the exact prior bytes on disk.
          const proposed = yield* svc.propose(makeCandidate("stale-registry"))
          expect(proposed.exists).toBe(true)
          expect(proposed.revision).toBe(created.revision)

          // The rollback reload brought the real registry back in sync with disk.
          const info = yield* registry.getByPath(created.relativePath)
          expect(info.revision).toBe(created.revision)
        }).pipe(Effect.provide(fullLayer(dir, inject)), Effect.scoped),
      )
    })
  })
})
