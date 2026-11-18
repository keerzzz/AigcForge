import path from "node:path"
import { expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Candidate, StepDef } from "@aigcfroge/schema/workflow-asset"
import { Environment } from "@aigcfroge/core/environment/index"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { Location } from "@aigcfroge/core/location"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { WorkflowAsset } from "@aigcfroge/core/workflow-asset"
import { WorkflowAssetService } from "@aigcfroge/core/workflow-asset-service"
import { ProposeWorkflowAssetTool } from "@aigcfroge/core/tool/propose-workflow-asset"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Effect, Layer, Schema } from "effect"
import { systemError } from "effect/PlatformError"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const dependencies = Layer.mergeAll(
  FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer)),
  tempLocationLayer,
  hostEnvironmentLayer,
)
const it = testEffect(
  WorkflowAssetService.layer.pipe(
    Layer.provideMerge(FileMutation.layer),
    Layer.provideMerge(LocationMutation.locationLayer),
    Layer.provideMerge(WorkflowAsset.layer),
    Layer.provideMerge(dependencies),
  ),
)
const content =
  '# Preserve this comment\nkind: workflow\nname: review\ndescription: Review changes\nversion: "1.0.0"\ntriggers: [manual]\nsteps:\n  - id: review\n    name: Review\n    agent: reviewer\nextra: preserved\n'
const candidate = (raw = content) =>
  Schema.decodeUnknownSync(Candidate)({ name: "review", description: "Review changes", content: raw })

it.live("uses the real registry short path and round-trips the original workflow declaration", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const registry = yield* WorkflowAsset.Service
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const proposed = yield* service.propose(candidate())
    expect(proposed).toEqual({
      relativePath: "review.yaml",
      exists: false,
      revision: null,
      nameConflict: false,
      pathConflict: false,
    })
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    expect(saved.content).toBe(content)
    expect(saved.triggers).toEqual(["manual"])
    expect(saved.steps).toEqual([
      expect.objectContaining({
        id: "review",
        name: "Review",
        agent: "reviewer",
        input: {},
        failurePolicy: "abort",
        maxAttempts: 1,
      }),
    ])
    expect(yield* fs.readFileString(path.join(location.directory, ".aigcfroge/workflows/review.yaml"))).toBe(content)
    expect(yield* registry.getByPath("review.yaml")).toEqual(saved)
    expect(yield* service.propose(candidate())).toEqual({ ...proposed, exists: true, revision: saved.revision })
    expect(yield* ProposeWorkflowAssetTool.propose(candidate(), service)).toEqual({
      ...proposed,
      exists: true,
      revision: saved.revision,
    })
  }),
)

it.live("rejects YAML identity drift and a different reviewed target before writing", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const registry = yield* WorkflowAsset.Service
    for (const value of [
      candidate(content.replace("name: review\n", "name: another\n")),
      candidate(content.replace("description: Review changes", "description: Different")),
      Schema.decodeUnknownSync(Candidate)({ ...candidate(), relativePath: "another.yaml" }),
    ]) {
      expect(yield* service.propose(value).pipe(Effect.flip)).toBeInstanceOf(WorkflowAssetService.InvalidCandidateError)
      expect(
        yield* service.apply({ candidate: value, baseRevision: null, overwrite: false }).pipe(Effect.flip),
      ).toBeInstanceOf(WorkflowAssetService.InvalidCandidateError)
    }
    expect(yield* registry.list()).toEqual([])
  }),
)

it.live("requires the displayed revision for overwrite and rejects stale delete", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const first = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    expect(
      yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: true }).pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.StaleRevisionError)
    expect(
      yield* service
        .apply({ candidate: candidate(), baseRevision: first.revision, overwrite: false })
        .pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.OverwriteRequiredError)
    const replacement = candidate(content.replace('"1.0.0"', '"2.0.0"'))
    const next = yield* service.apply({ candidate: replacement, baseRevision: first.revision, overwrite: true })
    expect(next.content).toBe(replacement.content)
    expect(next.revision).not.toBe(first.revision)
    expect(
      yield* service.delete({ relativePath: next.relativePath, baseRevision: first.revision }).pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.StaleRevisionError)
    expect(
      yield* service.delete({ relativePath: next.relativePath, baseRevision: null }).pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.StaleRevisionError)
    yield* service.delete({ relativePath: next.relativePath, baseRevision: next.revision })
    expect(
      yield* service.delete({ relativePath: next.relativePath, baseRevision: next.revision }).pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.StaleRevisionError)
    yield* service.delete({ relativePath: next.relativePath, baseRevision: null })
    const registry = yield* WorkflowAsset.Service
    expect(yield* registry.list()).toEqual([])
  }),
)

it.live("rolls back a new file that would duplicate another registry name", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const registry = yield* WorkflowAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const original = path.join(location.directory, ".aigcfroge/workflows/original.yaml")
    yield* fs.writeWithDirs(original, content)
    yield* registry.reload()
    expect((yield* service.propose(candidate())).nameConflict).toBe(true)
    expect(
      yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false }).pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.ReadbackMismatchError)
    expect(yield* fs.exists(path.join(location.directory, ".aigcfroge/workflows/review.yaml"))).toBe(false)
    expect(yield* fs.readFileString(original)).toBe(content)
    expect(yield* registry.listInvalid()).toEqual([])
    expect((yield* registry.list()).map((asset) => asset.relativePath)).toEqual(["original.yaml"])
  }),
)

it.live("propagates a proposal read failure without inventing new-file facts", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const registry = yield* WorkflowAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const target = path.join(location.directory, ".aigcfroge/workflows/review.yaml")
    const failure = systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "readFile",
      pathOrDescriptor: target,
    })
    const calls = { reads: 0 }
    const injected = yield* faultService({
      readFile: (file) =>
        Effect.gen(function* () {
          if (file !== target) return yield* fs.readFile(file)
          calls.reads++
          return yield* Effect.fail(failure)
        }),
    })

    expect(yield* injected.propose(candidate()).pipe(Effect.flip)).toBe(failure)
    expect(calls.reads).toBe(1)
    expect(yield* fs.readFileString(target)).toBe(content)
    expect(yield* registry.getByPath(saved.relativePath)).toEqual(saved)
  }),
)

for (const existing of [false, true]) {
  it.live(
    existing
      ? "restores the previous workflow bytes when the first read after overwrite fails"
      : "removes a new workflow file when its first written-content read fails",
    () =>
      Effect.gen(function* () {
        const service = yield* WorkflowAssetService.Service
        const registry = yield* WorkflowAsset.Service
        const fs = yield* FSUtil.Service
        const files = yield* FileMutation.Service
        const location = yield* Location.Service
        const target = path.join(location.directory, ".aigcfroge/workflows/review.yaml")
        const saved = existing
          ? yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
          : undefined
        const replacement = candidate(content.replace('"1.0.0"', '"2.0.0"'))
        const calls = { writes: 0, failures: 0 }
        const injected = yield* faultService({
          writeAtomic: (input) =>
            files.writeAtomic(input).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  calls.writes++
                }),
              ),
            ),
          readFile: (file) =>
            Effect.gen(function* () {
              if (file === target && calls.writes > 0 && calls.failures === 0) {
                calls.failures++
                return yield* Effect.fail(
                  systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "readFile",
                    pathOrDescriptor: target,
                  }),
                )
              }
              return yield* fs.readFile(file)
            }),
        })

        expect(
          yield* injected
            .apply({ candidate: replacement, baseRevision: saved?.revision ?? null, overwrite: existing })
            .pipe(Effect.flip),
        ).toBeInstanceOf(WorkflowAssetService.WriteFailedError)
        expect(calls.failures).toBe(1)
        expect(calls.writes).toBe(existing ? 2 : 1)
        expect(yield* registry.listInvalid()).toEqual([])
        if (!saved) {
          expect(yield* fs.exists(target)).toBe(false)
          expect(yield* registry.list()).toEqual([])
          return
        }
        expect(yield* fs.readFile(target)).toEqual(new TextEncoder().encode(content))
        expect(yield* registry.getByPath(saved.relativePath)).toEqual(saved)
      }),
  )
}

it.live("reports a rollback write failure and leaves the unconfirmed replacement observable", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const registry = yield* WorkflowAsset.Service
    const fs = yield* FSUtil.Service
    const files = yield* FileMutation.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const target = path.join(location.directory, ".aigcfroge/workflows/review.yaml")
    const replacement = candidate(content.replace('"1.0.0"', '"2.0.0"'))
    const calls = { writes: 0, reloads: 0 }
    const injected = yield* faultService({
      writeAtomic: (input) =>
        Effect.gen(function* () {
          calls.writes++
          if (calls.writes === 2)
            return yield* new Environment.Failed({
              path: input.target.absolute,
              cause: new Error("Injected rollback write failure"),
            })
          return yield* files.writeAtomic(input)
        }),
      reload: () =>
        Effect.gen(function* () {
          calls.reloads++
          if (calls.reloads === 1)
            return yield* new FSUtil.FileSystemError({ method: "reload", cause: new Error("Injected reload failure") })
          yield* registry.reload()
        }),
    })

    expect(
      yield* injected
        .apply({ candidate: replacement, baseRevision: saved.revision, overwrite: true })
        .pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.RollbackFailedError)
    expect(calls).toEqual({ writes: 2, reloads: 1 })
    expect(yield* fs.readFileString(target)).toBe(replacement.content)
    yield* registry.reload()
    expect((yield* registry.getByPath(saved.relativePath)).content).toBe(replacement.content)
  }),
)

it.live("preserves an external overwrite that arrives before the first written-content read", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const registry = yield* WorkflowAsset.Service
    const fs = yield* FSUtil.Service
    const files = yield* FileMutation.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const target = path.join(location.directory, ".aigcfroge/workflows/review.yaml")
    const replacement = candidate(content.replace('"1.0.0"', '"2.0.0"'))
    const external = content.replace('"1.0.0"', '"3.0.0"')
    const calls = { writes: 0 }
    const injected = yield* faultService({
      writeAtomic: (input) =>
        Effect.gen(function* () {
          const result = yield* files.writeAtomic(input)
          calls.writes++
          // Bypass the cooperating FileMutation lock to model another process replacing the target.
          if (calls.writes === 1) yield* fs.writeFileString(target, external).pipe(Effect.orDie)
          return result
        }),
    })

    expect(
      yield* injected
        .apply({ candidate: replacement, baseRevision: saved.revision, overwrite: true })
        .pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.ConcurrentModificationError)
    expect(calls.writes).toBe(1)
    expect(yield* fs.readFileString(target)).toBe(external)
    yield* registry.reload()
    expect((yield* registry.getByPath(saved.relativePath)).content).toBe(external)
  }),
)

it.live("restores deleted workflow bytes and reloads the registry after a transient reload failure", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const registry = yield* WorkflowAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const target = path.join(location.directory, ".aigcfroge/workflows/review.yaml")
    const calls = { reloads: 0 }
    const injected = yield* faultService({
      reload: () =>
        Effect.gen(function* () {
          calls.reloads++
          if (calls.reloads === 1)
            return yield* new FSUtil.FileSystemError({
              method: "reload",
              cause: new Error("Injected delete reload failure"),
            })
          yield* registry.reload()
        }),
    })

    expect(
      yield* injected.delete({ relativePath: saved.relativePath, baseRevision: saved.revision }).pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.WriteFailedError)
    expect(calls.reloads).toBe(2)
    expect(yield* fs.readFile(target)).toEqual(new TextEncoder().encode(content))
    expect(yield* registry.getByPath(saved.relativePath)).toEqual(saved)
    expect(yield* registry.listInvalid()).toEqual([])
  }),
)

it.live("preserves a file recreated by an external writer before deletion rollback", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const registry = yield* WorkflowAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const target = path.join(location.directory, ".aigcfroge/workflows/review.yaml")
    const external = content.replace('"1.0.0"', '"3.0.0"')
    const calls = { reloads: 0 }
    const injected = yield* faultService({
      reload: () =>
        Effect.gen(function* () {
          calls.reloads++
          expect(yield* fs.exists(target)).toBe(false)
          yield* fs.writeFileString(target, external)
          return yield* new FSUtil.FileSystemError({
            method: "reload",
            cause: new Error("Injected external recreation"),
          })
        }),
    })

    expect(
      yield* injected.delete({ relativePath: saved.relativePath, baseRevision: saved.revision }).pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.ConcurrentModificationError)
    expect(calls.reloads).toBe(1)
    expect(yield* fs.readFileString(target)).toBe(external)
    yield* registry.reload()
    expect((yield* registry.getByPath(saved.relativePath)).content).toBe(external)
  }),
)

const faultService = Effect.fnUntraced(function* (input: {
  readonly readFile?: FSUtil.Interface["readFile"]
  readonly writeAtomic?: FileMutation.Interface["writeAtomic"]
  readonly reload?: WorkflowAsset.Interface["reload"]
  readonly getByPath?: WorkflowAsset.Interface["getByPath"]
}) {
  const fs = yield* FSUtil.Service
  const files = yield* FileMutation.Service
  const registry = yield* WorkflowAsset.Service
  // A fresh service captures these wrappers instead of reusing the test's memoized normal instance.
  // All other operations, registry state and transaction locks remain real.
  return yield* WorkflowAssetService.Service.pipe(
    Effect.provide(Layer.fresh(WorkflowAssetService.layer)),
    Effect.provideService(FSUtil.Service, FSUtil.Service.of({ ...fs, readFile: input.readFile ?? fs.readFile })),
    Effect.provideService(
      FileMutation.Service,
      FileMutation.Service.of({ ...files, writeAtomic: input.writeAtomic ?? files.writeAtomic }),
    ),
    Effect.provideService(
      WorkflowAsset.Service,
      WorkflowAsset.Service.of({
        ...registry,
        reload: input.reload ?? registry.reload,
        getByPath: input.getByPath ?? registry.getByPath,
      }),
    ),
  )
})

const withSteps = (steps: readonly unknown[]) =>
  JSON.stringify({
    kind: "workflow",
    name: "review",
    description: "Review changes",
    version: "1.0.0",
    steps,
  })
const entry = { id: "entry", name: "Entry", agent: "reviewer" }
const fullContent = withSteps([
  {
    ...entry,
    input: { nested: { values: [1, null, { enabled: true }] } },
    parallel: ["left", "right"],
    failurePolicy: "retry",
    maxAttempts: 3,
    timeoutSeconds: 45,
  },
  { id: "left", name: "Left", agent: "reviewer", next: "choose" },
  { id: "right", name: "Right", agent: "reviewer", next: "choose" },
  { id: "choose", name: "Choose", agent: "reviewer", branches: { accept: "END", finish: "finish" } },
  { id: "finish", name: "Finish", agent: "reviewer", next: "END" },
])

it.live("round-trips a BOM and the complete nested step definition", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const registry = yield* WorkflowAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const value = candidate("\uFEFF" + fullContent)
    const saved = yield* service.apply({ candidate: value, baseRevision: null, overwrite: false })
    expect(saved.content).toBe(value.content)
    expect(saved.steps[0]).toEqual(
      expect.objectContaining({
        ...entry,
        input: { nested: { values: [1, null, { enabled: true }] } },
        parallel: ["left", "right"],
        failurePolicy: "retry",
        maxAttempts: 3,
        timeoutSeconds: 45,
      }),
    )
    expect(saved.steps[3].branches).toEqual({ accept: "END", finish: "finish" })
    expect(saved.triggers).toEqual([])
    expect(yield* fs.readFile(path.join(location.directory, ".aigcfroge/workflows/review.yaml"))).toEqual(
      new TextEncoder().encode(value.content),
    )
    expect(yield* registry.getByPath(saved.relativePath)).toEqual(saved)
  }),
)

it.live("preserves the empty graph contract and reads larger existing disk declarations", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const registry = yield* WorkflowAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(withSteps([])), baseRevision: null, overwrite: false })
    expect(saved.steps).toEqual([])
    const raw = content + "#" + "x".repeat(100_001)
    yield* fs.writeFileString(path.join(location.directory, ".aigcfroge/workflows/review.yaml"), raw)
    yield* registry.reload()
    expect((yield* registry.getByPath(saved.relativePath)).content).toBe(raw)
    expect(ProposeWorkflowAssetTool.validateContent(raw)).toContain("100000 UTF-8 bytes")
  }),
)

it.live("preserves the historical disk size boundary while retaining the leading BOM", () =>
  Effect.gen(function* () {
    const registry = yield* WorkflowAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const prefix = withSteps([]) + "\n#"
    const raw = "\uFEFF" + prefix + "x".repeat(5_000_000 - prefix.length)
    const target = path.join(location.directory, ".aigcfroge/workflows/review.yaml")
    yield* fs.writeWithDirs(target, raw)
    yield* registry.reload()
    expect((yield* registry.getByPath("review.yaml")).content).toBe(raw)
    yield* fs.writeFileString(target, raw + " ")
    yield* registry.reload()
    expect(yield* registry.getInvalid("review.yaml")).toEqual({ relativePath: "review.yaml", errorTag: "parse_error" })
  }),
)

it.live("accepts exactly 100000 ASCII bytes and rejects oversized ASCII and multibyte proposals", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const raw = "#" + "a".repeat(100_000 - content.length - 2) + "\n" + content
    expect(new TextEncoder().encode(raw).length).toBe(100_000)
    const saved = yield* service.apply({ candidate: candidate(raw), baseRevision: null, overwrite: false })
    expect(saved.content).toBe(raw)
    expect(() => candidate(raw + " ")).toThrow()
    expect(ProposeWorkflowAssetTool.validateContent(raw + " ")).toContain("100000 UTF-8 bytes")
    const multibyte = candidate("#" + "界".repeat(34_000) + "\n" + content)
    expect(yield* service.propose(multibyte).pipe(Effect.flip)).toBeInstanceOf(
      WorkflowAssetService.InvalidCandidateError,
    )
    expect(
      yield* service.apply({ candidate: multibyte, baseRevision: saved.revision, overwrite: true }).pipe(Effect.flip),
    ).toBeInstanceOf(WorkflowAssetService.InvalidCandidateError)
    expect(ProposeWorkflowAssetTool.validateContent(multibyte.content)).toContain("100000 UTF-8 bytes")
  }),
)

it.live("reports normalization collisions as a different path identity", () =>
  Effect.gen(function* () {
    const service = yield* WorkflowAssetService.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const value = Schema.decodeUnknownSync(Candidate)({
      name: "ｒｅｖｉｅｗ",
      description: "Review changes",
      content: content.replace("name: review\n", "name: ｒｅｖｉｅｗ\n"),
    })
    expect(yield* service.propose(value)).toEqual({
      relativePath: "review.yaml",
      exists: true,
      revision: saved.revision,
      nameConflict: false,
      pathConflict: true,
    })
  }),
)

for (const name of ["../escape", "CON", " "]) {
  it.live(`rejects the unsafe workflow name ${JSON.stringify(name)} before writing`, () =>
    Effect.gen(function* () {
      const service = yield* WorkflowAssetService.Service
      const value = Schema.decodeUnknownSync(Candidate)({
        name,
        description: "Review changes",
        content: content.replace("name: review\n", `name: ${JSON.stringify(name)}\n`),
      })
      expect(yield* service.propose(value).pipe(Effect.flip)).toBeInstanceOf(WorkflowAssetService.InvalidCandidateError)
      expect(
        yield* service.apply({ candidate: value, baseRevision: null, overwrite: false }).pipe(Effect.flip),
      ).toBeInstanceOf(WorkflowAssetService.InvalidCandidateError)
      expect(
        yield* service.delete({ relativePath: "../review.yaml", baseRevision: null }).pipe(Effect.flip),
      ).toBeInstanceOf(WorkflowAssetService.InvalidCandidateError)
    }),
  )
}

if (process.platform !== "win32") {
  it.live("rejects a workflow root symlink redirected to another directory in the Location", () =>
    Effect.gen(function* () {
      const service = yield* WorkflowAssetService.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const other = path.join(location.directory, "other-workflows")
      yield* fs.makeDirectory(other)
      yield* fs.makeDirectory(path.join(location.directory, ".aigcfroge"), { recursive: true })
      yield* fs.symlink(other, path.join(location.directory, ".aigcfroge/workflows"))
      expect(yield* service.propose(candidate()).pipe(Effect.flip)).toBeInstanceOf(
        WorkflowAssetService.InvalidCandidateError,
      )
      expect(
        yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false }).pipe(Effect.flip),
      ).toBeInstanceOf(WorkflowAssetService.InvalidCandidateError)
      expect(yield* fs.exists(path.join(other, "review.yaml"))).toBe(false)
    }),
  )
}

for (const scenario of [
  { name: "duplicate step IDs", steps: [entry, entry], message: "Duplicate step ID" },
  { name: "unknown next target", steps: [{ ...entry, next: "missing" }], message: "unknown next step" },
  { name: "unknown branch target", steps: [{ ...entry, branches: { accept: "missing" } }], message: "unknown target" },
  { name: "unknown parallel target", steps: [{ ...entry, parallel: ["missing"] }], message: "unknown step" },
  { name: "parallel END target", steps: [{ ...entry, parallel: ["END"] }], message: "unknown step" },
  { name: "cycle", steps: [{ ...entry, next: "entry" }], message: "Cycle detected" },
  { name: "unreachable step", steps: [entry, { ...entry, id: "hidden" }], message: "unreachable" },
  {
    name: "step count limit",
    steps: Array.from({ length: 65 }, (_, index) => ({
      ...entry,
      id: `step-${index}`,
      next: index === 64 ? "END" : `step-${index + 1}`,
    })),
    message: "maximum step count",
  },
  {
    name: "parallel limit",
    steps: [
      { ...entry, parallel: Array.from({ length: 9 }, (_, index) => `child-${index}`) },
      ...Array.from({ length: 9 }, (_, index) => ({ ...entry, id: `child-${index}` })),
    ],
    message: "maximum parallel steps",
  },
  {
    name: "branch continuation",
    steps: [{ ...entry, branches: { accept: "END" }, failurePolicy: "continue" }],
    message: "cannot use failurePolicy=continue",
  },
]) {
  it.live(`rejects new declarations with ${scenario.name} through the canonical graph validator`, () =>
    Effect.gen(function* () {
      const service = yield* WorkflowAssetService.Service
      const registry = yield* WorkflowAsset.Service
      const value = candidate(withSteps(scenario.steps))
      const error = yield* service.propose(value).pipe(Effect.flip)
      expect(error).toBeInstanceOf(WorkflowAssetService.InvalidCandidateError)
      expect(error.message).toContain(scenario.message)
      expect(
        yield* service.apply({ candidate: value, baseRevision: null, overwrite: false }).pipe(Effect.flip),
      ).toBeInstanceOf(WorkflowAssetService.InvalidCandidateError)
      expect(yield* registry.list()).toEqual([])
    }),
  )
}

for (const scenario of [
  { name: "malformed YAML", raw: "steps: [" },
  { name: "missing Frontmatter fields", raw: "kind: workflow\nsteps: []" },
  { name: "attempt limit", raw: withSteps([{ ...entry, maxAttempts: 9 }]) },
  { name: "timeout limit", raw: withSteps([{ ...entry, timeoutSeconds: 86_401 }]) },
]) {
  it.live(`rejects workflow content with ${scenario.name}`, () =>
    Effect.gen(function* () {
      const service = yield* WorkflowAssetService.Service
      expect(yield* service.propose(candidate(scenario.raw)).pipe(Effect.flip)).toBeInstanceOf(
        WorkflowAssetService.InvalidCandidateError,
      )
      expect(
        yield* service
          .apply({ candidate: candidate(scenario.raw), baseRevision: null, overwrite: false })
          .pipe(Effect.flip),
      ).toBeInstanceOf(WorkflowAssetService.InvalidCandidateError)
    }),
  )
}

it.live("retains structurally valid disk graphs for the existing composition diagnostics", () =>
  Effect.gen(function* () {
    const registry = yield* WorkflowAsset.Service
    const service = yield* WorkflowAssetService.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const raw = withSteps([{ ...entry, next: "missing" }])
    yield* fs.writeWithDirs(path.join(location.directory, ".aigcfroge/workflows/review.yaml"), raw)
    yield* registry.reload()
    expect((yield* registry.getByPath("review.yaml")).content).toBe(raw)
    expect(yield* registry.listInvalid()).toEqual([])
    expect(yield* service.propose(candidate(raw)).pipe(Effect.flip)).toBeInstanceOf(
      WorkflowAssetService.InvalidCandidateError,
    )
  }),
)

for (const scenario of [
  { name: "version", change: (info: WorkflowAsset.Info) => ({ ...info, version: "different" }) },
  { name: "triggers", change: (info: WorkflowAsset.Info) => ({ ...info, triggers: ["different"] }) },
  {
    name: "nested input",
    change: (info: WorkflowAsset.Info) => ({
      ...info,
      steps: info.steps.map((step) =>
        StepDef.make({ ...step, input: { nested: { values: [1, null, { enabled: false }] } } }),
      ),
    }),
  },
  {
    name: "attempt count",
    change: (info: WorkflowAsset.Info) => ({
      ...info,
      steps: info.steps.map((step) => StepDef.make({ ...step, maxAttempts: 2 })),
    }),
  },
  {
    name: "graph target",
    change: (info: WorkflowAsset.Info) => ({
      ...info,
      steps: info.steps.map((step) => StepDef.make({ ...step, next: "END" })),
    }),
  },
]) {
  it.live(`rolls back a registry readback that changes ${scenario.name}`, () =>
    Effect.gen(function* () {
      const service = yield* WorkflowAssetService.Service
      const registry = yield* WorkflowAsset.Service
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
      const injected = yield* faultService({
        getByPath: (relativePath) => registry.getByPath(relativePath).pipe(Effect.map(scenario.change)),
      })
      expect(
        yield* injected
          .apply({ candidate: candidate(fullContent), baseRevision: saved.revision, overwrite: true })
          .pipe(Effect.flip),
      ).toBeInstanceOf(WorkflowAssetService.ReadbackMismatchError)
      expect(yield* fs.readFileString(path.join(location.directory, ".aigcfroge/workflows/review.yaml"))).toBe(content)
      expect(yield* registry.getByPath(saved.relativePath)).toEqual(saved)
    }),
  )
}
