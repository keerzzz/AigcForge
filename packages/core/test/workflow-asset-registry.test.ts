import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { WorkflowAsset } from "@aigcfroge/core/workflow-asset"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { EventV2 } from "@aigcfroge/core/event"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"

function locationLayer(dir: string) {
  return Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(dir) })))
}

function fullLayer(dir: string) {
  return WorkflowAsset.locationLayer.pipe(
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

async function createWorkflow(dir: string, name: string, description: string) {
  const assetDir = path.join(dir, ".aigcfroge", "workflows")
  await fs.mkdir(assetDir, { recursive: true })
  await fs.writeFile(
    path.join(assetDir, `${name}.yaml`),
    [
      "kind: workflow",
      `name: ${name}`,
      `description: ${description}`,
      "version: 1.0.0",
      "triggers: []",
      "steps:",
      "  - id: s1",
      '    name: "Step 1"',
      '    agent: "builtin"',
      "    input: {}",
    ].join("\n"),
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runNow<A>(effect: Effect.Effect<A, unknown, any>): Promise<A> {
  return (Effect as any).runPromise(effect)
}

describe("WorkflowAsset registry", () => {
  test("lists assets from empty directory", async () => {
    await withTmp(async (dir) => {
      const list = await runNow(
        Effect.gen(function* () {
          return yield* (yield* WorkflowAsset.Service).list()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(list).toEqual([])
    })
  })

  test("loads a single workflow from disk", async () => {
    await withTmp(async (dir) => {
      await createWorkflow(dir, "code-review", "Automated code review")
      const list = await runNow(
        Effect.gen(function* () {
          return yield* (yield* WorkflowAsset.Service).list()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(list.length).toBe(1)
      expect(list[0].kind).toBe("workflow")
      expect(list[0].name).toBe("code-review")
      expect(list[0].description).toBe("Automated code review")
      expect(list[0].version).toBe("1.0.0")
      expect(list[0].relativePath).toBe("code-review.yaml")
      expect(list[0].revision.length).toBe(64)
    })
  })

  test("loads multiple workflows", async () => {
    await withTmp(async (dir) => {
      await createWorkflow(dir, "review", "Code review")
      await createWorkflow(dir, "deploy", "Deploy pipeline")
      const list = await runNow(
        Effect.gen(function* () {
          return yield* (yield* WorkflowAsset.Service).list()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(list.length).toBe(2)
      const names = list.map((a) => a.name).toSorted()
      expect(names).toEqual(["deploy", "review"])
    })
  })

  test("finds a workflow by path", async () => {
    await withTmp(async (dir) => {
      await createWorkflow(dir, "my-workflow", "A workflow")
      const info = await runNow(
        Effect.gen(function* () {
          return yield* (yield* WorkflowAsset.Service).getByPath("my-workflow.yaml")
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(info.name).toBe("my-workflow")
    })
  })

  test("returns error for unknown path", async () => {
    await withTmp(async (dir) => {
      const error = await runNow(
        Effect.gen(function* () {
          return yield* (yield* WorkflowAsset.Service).getByPath("nonexistent.yaml").pipe(Effect.flip)
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(error).toMatchObject({ _tag: "WorkflowAsset.NotFound" })
    })
  })

  test("finds a workflow by name", async () => {
    await withTmp(async (dir) => {
      await createWorkflow(dir, "find-me", "test")
      const info = await runNow(
        Effect.gen(function* () {
          return yield* (yield* WorkflowAsset.Service).findByName("find-me")
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(info).toBeDefined()
      expect(info!.name).toBe("find-me")
    })
  })

  test("reloads after adding a new workflow", async () => {
    await withTmp(async (dir) => {
      const reg = await runNow(
        Effect.gen(function* () {
          return yield* WorkflowAsset.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect((await runNow(reg.list())).length).toBe(0)
      await createWorkflow(dir, "added-later", "new")
      await runNow(reg.reload())
      const list = await runNow(reg.list())
      expect(list.length).toBe(1)
      expect(list[0].name).toBe("added-later")
    })
  })

  test("marks YAML parse error as parse_error", async () => {
    await withTmp(async (dir) => {
      const workflowsDir = path.join(dir, ".aigcfroge", "workflows")
      await fs.mkdir(workflowsDir, { recursive: true })
      await fs.writeFile(path.join(workflowsDir, "bad.yaml"), "not: valid: yaml: [[[")
      const invalid = await runNow(
        Effect.gen(function* () {
          return yield* (yield* WorkflowAsset.Service).listInvalid()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(invalid.length).toBeGreaterThanOrEqual(1)
      expect(invalid.some((e) => e.errorTag === "parse_error")).toBe(true)
    })
  })

  test("marks schema decode failure as bad_frontmatter", async () => {
    await withTmp(async (dir) => {
      const workflowsDir = path.join(dir, ".aigcfroge", "workflows")
      await fs.mkdir(workflowsDir, { recursive: true })
      // Valid YAML but missing required field 'name'
      await fs.writeFile(path.join(workflowsDir, "badfm.yaml"), "kind: workflow\nsteps: []")
      const invalid = await runNow(
        Effect.gen(function* () {
          return yield* (yield* WorkflowAsset.Service).listInvalid()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(invalid.some((e) => e.errorTag === "bad_frontmatter")).toBe(true)
    })
  })

  test("marks duplicate-name files as name_conflict", async () => {
    await withTmp(async (dir) => {
      const workflowsDir = path.join(dir, ".aigcfroge", "workflows")
      await fs.mkdir(workflowsDir, { recursive: true })
      const c = () =>
        [
          "kind: workflow",
          'name: "dup"',
          'description: "test"',
          'version: "1.0"',
          "triggers: []",
          "steps:",
          "  - id: s1",
          '    name: "S1"',
          '    agent: "builtin"',
          "    input: {}",
        ].join("\n")
      await fs.writeFile(path.join(workflowsDir, "first.yaml"), c())
      await fs.writeFile(path.join(workflowsDir, "second.yaml"), c())
      const [list, invalid] = await runNow(
        Effect.gen(function* () {
          const svc = yield* WorkflowAsset.Service
          return [yield* svc.list(), yield* svc.listInvalid()] as const
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(list).toEqual([])
      expect(invalid).toHaveLength(2)
      expect(invalid.map((e) => e.errorTag)).toEqual(["name_conflict", "name_conflict"])
    })
  })

  test("isolates location A and B registries", async () => {
    const [dirA, dirB] = await Promise.all([tmpdir(), tmpdir()])
    try {
      await createWorkflow(dirA.path, "wf-a", "a")
      await createWorkflow(dirB.path, "wf-b", "b")

      const [listA, listB] = await Promise.all([
        runNow(
          Effect.gen(function* () {
            return yield* (yield* WorkflowAsset.Service).list()
          }).pipe(Effect.provide(fullLayer(dirA.path)), Effect.scoped),
        ),
        runNow(
          Effect.gen(function* () {
            return yield* (yield* WorkflowAsset.Service).list()
          }).pipe(Effect.provide(fullLayer(dirB.path)), Effect.scoped),
        ),
      ])
      expect(listA.length).toBe(1)
      expect(listB.length).toBe(1)
      expect(listA[0].name).toBe("wf-a")
      expect(listB[0].name).toBe("wf-b")
    } finally {
      await Promise.all([dirA[Symbol.asyncDispose](), dirB[Symbol.asyncDispose]()])
    }
  })

  test("cross-kind .yaml and .md files do not conflict", async () => {
    await withTmp(async (dir) => {
      const workflowsDir = path.join(dir, ".aigcfroge", "workflows")
      await fs.mkdir(workflowsDir, { recursive: true })
      const validYaml = [
        "kind: workflow",
        'name: "hello"',
        'description: "wf"',
        'version: "1.0"',
        "triggers: []",
        "steps:",
        "  - id: s1",
        '    name: "S1"',
        '    agent: "builtin"',
        "    input: {}",
      ].join("\n")
      await fs.writeFile(path.join(workflowsDir, "hello.yaml"), validYaml)
      // .md file in workflows dir should be ignored (glob is **/*.yaml)
      await fs.writeFile(
        path.join(workflowsDir, "hello.md"),
        "---\nkind: prompt\nname: hello\ndescription: p\n---\nbody",
      )
      const list = await runNow(
        Effect.gen(function* () {
          return yield* (yield* WorkflowAsset.Service).list()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(list.length).toBe(1)
      expect(list[0].relativePath).toBe("hello.yaml")
    })
  })

  test("listInvalid is empty when all assets valid", async () => {
    await withTmp(async (dir) => {
      await createWorkflow(dir, "good", "desc")
      const invalid = await runNow(
        Effect.gen(function* () {
          return yield* (yield* WorkflowAsset.Service).listInvalid()
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect(invalid).toEqual([])
    })
  })

  test("listInvalid reload reflects fixed files", async () => {
    await withTmp(async (dir) => {
      const workflowsDir = path.join(dir, ".aigcfroge", "workflows")
      await fs.mkdir(workflowsDir, { recursive: true })
      await fs.writeFile(path.join(workflowsDir, "broken.yaml"), "not: valid: yaml: [[[")
      const reg = await runNow(
        Effect.gen(function* () {
          return yield* WorkflowAsset.Service
        }).pipe(Effect.provide(fullLayer(dir)), Effect.scoped),
      )
      expect((await runNow(reg.listInvalid())).length).toBeGreaterThanOrEqual(1)
      const goodYaml = [
        "kind: workflow",
        'name: "fixed"',
        'description: "ok"',
        'version: "1.0"',
        "triggers: []",
        "steps:",
        "  - id: s1",
        '    name: "Step 1"',
        '    agent: "builtin"',
        "    input: {}",
      ].join("\n")
      await fs.writeFile(path.join(workflowsDir, "broken.yaml"), goodYaml)
      await runNow(reg.reload())
      expect(await runNow(reg.listInvalid())).toEqual([])
      expect((await runNow(reg.list())).length).toBe(1)
    })
  })
})
