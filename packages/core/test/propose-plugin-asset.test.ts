import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { PluginAsset } from "@aigcfroge/core/plugin-asset"
import { ProposePluginAssetTool } from "@aigcfroge/core/tool/propose-plugin-asset"
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
  const d = path.join(dir, ".aigcfroge", "plugins")
  await fs.mkdir(d, { recursive: true })
  await fs.writeFile(
    path.join(d, `${name}.plugin.yaml`),
    `kind: plugin\nname: ${name}\ndescription: "test plugin"\nversion: "1.0.0"\nhooks: []`,
  )
}

function makeRegistry(dir: string): PluginAsset.Interface {
  const assets = new Map<string, PluginAsset.Info>()

  const reload = Effect.fn("test.plugin.reload")(() =>
    Effect.promise(async () => {
      assets.clear()
      const pluginsDir = path.join(dir, ".aigcfroge", "plugins")
      const entries = await fs.readdir(pluginsDir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".plugin.yaml")) continue
        const name = entry.name.replace(/\.plugin\.yaml$/, "")
        assets.set(`.aigcfroge/plugins/${entry.name}`, {
          kind: "plugin" as const,
          name,
          description: "",
          relativePath: `.aigcfroge/plugins/${entry.name}`,
          version: "1.0.0",
          hooks: [],
          revision: "test-revision",
        })
      }
    }),
  )

  return {
    list: () => Effect.succeed(Array.from(assets.values())),
    getByPath: (relativePath: string) => {
      const entry = assets.get(relativePath)
      if (!entry) return Effect.fail(new PluginAsset.NotFoundError({ relativePath }))
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

describe("ProposePluginAssetTool", () => {
  test("valid candidate returns not-exists without conflicts", async () => {
    await withTmp(async (dir) => {
      const deps = { pluginAsset: makeRegistry(dir), fs: makeFs(), directory: dir }
      const result = await runNow(
        ProposePluginAssetTool.propose(
          {
            name: "new-plugin",
            description: "a test",
            content: 'kind: plugin\nname: new-plugin\ndescription: a test\nversion: "1.0.0"\nhooks: []',
          },
          deps,
        ),
      )
      expect(result.exists).toBe(false)
      expect(result.nameConflict).toBe(false)
      expect(result.pathConflict).toBe(false)
      expect(result.relativePath).toMatch(/\.plugin\.yaml$/)
    })
  })

  test("rejects invalid YAML", async () => {
    await withTmp(async (dir) => {
      const deps = { pluginAsset: makeRegistry(dir), fs: makeFs(), directory: dir }
      const result = ProposePluginAssetTool.propose({ name: "bad", description: "x", content: "{invalid yaml: " }, deps)
      await expect(runNow(result)).rejects.toThrow()
    })
  })

  test("rejects valid YAML missing required Frontmatter fields", async () => {
    await withTmp(async (dir) => {
      const deps = { pluginAsset: makeRegistry(dir), fs: makeFs(), directory: dir }
      const result = ProposePluginAssetTool.propose(
        { name: "bad-schema", description: "x", content: 'name: bad-schema\ndescription: x\nversion: "1.0.0"' },
        deps,
      )
      await expect(runNow(result)).rejects.toThrow(/required schema/)
    })
  })

  test("detects existing file on disk with revision", async () => {
    await withTmp(async (dir) => {
      await initAsset(dir, "existing-plugin")
      const deps = { pluginAsset: makeRegistry(dir), fs: makeFs(), directory: dir }
      await runNow(deps.pluginAsset.reload())
      const result = await runNow(
        ProposePluginAssetTool.propose(
          {
            name: "existing-plugin",
            description: "x",
            content: 'kind: plugin\nname: existing-plugin\ndescription: x\nversion: "1.0.0"\nhooks: []',
          },
          deps,
        ),
      )
      expect(result.exists).toBe(true)
      expect(result.revision).toBeTruthy()
    })
  })
})
