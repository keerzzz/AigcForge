import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { WorkflowAsset } from "@aigcfroge/core/workflow-asset"
import { ProposeWorkflowAssetTool } from "@aigcfroge/core/tool/propose-workflow-asset"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"

function runNow<A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> {
  return (Effect as unknown as { runPromise: (e: Effect.Effect<A, unknown>) => Promise<A> }).runPromise(
    effect as unknown as Effect.Effect<A, unknown>,
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

async function initAsset(dir: string, name: string) {
  const d = path.join(dir, ".aigcfroge", "workflows")
  await fs.mkdir(d, { recursive: true })
  await fs.writeFile(
    path.join(d, `${name}.yaml`),
    `name: ${name}\ndescription: "test"\ntriggers: []\nsteps:\n  - name: step1\n    run: echo hello`,
  )
}

/** Minimal WorkflowAsset.Interface that reads from a tmpdir. */
function makeRegistry(dir: string): WorkflowAsset.Interface {
  const assets = new Map<string, WorkflowAsset.Info>()

  const reload = Effect.fn("test.reload")(() =>
    Effect.promise(async () => {
      assets.clear()
      const workflowsDir = path.join(dir, ".aigcfroge", "workflows")
      const entries = await fs.readdir(workflowsDir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue
        const name = entry.name.replace(/\.yaml$/, "")
        assets.set(`.aigcfroge/workflows/${entry.name}`, {
          kind: "workflow" as const,
          name,
          description: "",
          relativePath: `.aigcfroge/workflows/${entry.name}`,
          version: "1.0.0",
          triggers: [],
          steps: [],
          revision: "test-revision",
        })
      }
    }),
  )

  return {
    list: () => Effect.succeed(Array.from(assets.values())),
    getByPath: (relativePath: string) => {
      const entry = assets.get(relativePath)
      if (!entry) return Effect.fail(new WorkflowAsset.NotFoundError({ relativePath }))
      return Effect.succeed(entry)
    },
    findByName: (name: string) => {
      for (const entry of assets.values()) {
        if (entry.name === name) return Effect.succeed(entry)
      }
      return Effect.succeed(undefined)
    },
    listInvalid: () => Effect.succeed([]),
    getInvalid: () => Effect.succeed(undefined),
    reload,
  }
}

/** Minimal FSUtil.Interface that wraps fs.promises. */
function makeFs(): FSUtil.Interface {
  return {
    exists: Effect.fn("test.exists")((p: string) =>
      Effect.promise(async () =>
        fs
          .stat(p)
          .then(() => true)
          .catch(() => false),
      ),
    ),
    readFile: Effect.fn("test.readFile")((p: string) =>
      Effect.promise(async () => new Uint8Array(await fs.readFile(p))),
    ),
    readFileString: Effect.fn("test.readFileString")((p: string) =>
      Effect.promise(async () => await fs.readFile(p, "utf-8")),
    ),
  } as unknown as FSUtil.Interface
}

const wfYaml = (name: string, desc = "test") =>
  `kind: workflow\nname: ${name}\ndescription: ${desc}\nversion: "1.0.0"\ntriggers: []\nsteps:\n  - id: s1\n    name: S1\n    agent: builtin\n    input: {}`

describe("ProposeWorkflowAssetTool", () => {
  test("valid candidate returns not-exists without conflicts", async () => {
    await withTmp(async (dir) => {
      const deps = { workflowAsset: makeRegistry(dir), fs: makeFs(), directory: dir }
      const result = await runNow(
        ProposeWorkflowAssetTool.propose(
          { name: "new-workflow", description: "a test", content: wfYaml("new-workflow") },
          deps,
        ),
      )
      expect(result.exists).toBe(false)
      expect(result.nameConflict).toBe(false)
      expect(result.pathConflict).toBe(false)
      expect(result.relativePath).toMatch(/\.yaml$/)
    })
  })

  test("rejects invalid YAML", async () => {
    await withTmp(async (dir) => {
      const deps = { workflowAsset: makeRegistry(dir), fs: makeFs(), directory: dir }
      const result = ProposeWorkflowAssetTool.propose(
        { name: "bad", description: "x", content: "{invalid yaml: " },
        deps,
      )
      await expect(runNow(result)).rejects.toThrow()
    })
  })

  test("rejects valid YAML missing required Frontmatter fields", async () => {
    await withTmp(async (dir) => {
      const deps = { workflowAsset: makeRegistry(dir), fs: makeFs(), directory: dir }
      const result = ProposeWorkflowAssetTool.propose(
        { name: "bad-schema", description: "x", content: "name: bad-schema\ndescription: x\nsteps: []" },
        deps,
      )
      await expect(runNow(result)).rejects.toThrow(/required schema/)
    })
  })

  test("detects existing file on disk with revision", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "existing")
      const deps = { workflowAsset: makeRegistry(dir), fs: makeFs(), directory: dir }
      await runNow(deps.workflowAsset.reload())
      const result = await runNow(
        ProposeWorkflowAssetTool.propose({ name: "existing", description: "x", content: wfYaml("existing") }, deps),
      )
      expect(result.exists).toBe(true)
      expect(result.revision).toBeTruthy()
    })
  })
})
