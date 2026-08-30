import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { Server } from "../../src/server/server"
import { Global } from "@aigcfroge/core/global"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { Effect } from "effect"
import { pollWithTimeout } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("reference HttpApi", () => {
  test("lists usable references resolved in the server workspace", async () => {
    await using tmp = await tmpdir({
      config: {
        formatter: false,
        lsp: false,
        references: {
          docs: "./docs",
          effect: { repository: "Effect-TS/effect", branch: "main" },
          bad: "not-a-repo",
        },
      },
    })

    // This test is part of the test/server hard gate, so it must not touch the
    // network (S5): AIGCFROGE_REPO_CLONE_GITHUB_BASE_URL rewrites the github.com
    // clone remote to a file:// fixture — the cache path under Global.Path.repos
    // is unaffected. A stale cache with a mismatched origin is removed and
    // re-cloned, so the fixture wins even on dev machines with a warm cache.
    await using fixture = await tmpdir()
    const repoRoot = path.join(fixture.path, "Effect-TS", "effect.git")
    await fs.mkdir(repoRoot, { recursive: true })
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot })
      if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`)
    }
    git("init", "-b", "main")
    git("-c", "user.email=fixture@aigcfroge.dev", "-c", "user.name=fixture", "commit", "--allow-empty", "-m", "fixture")

    const previous = process.env.AIGCFROGE_REPO_CLONE_GITHUB_BASE_URL
    process.env.AIGCFROGE_REPO_CLONE_GITHUB_BASE_URL = `${pathToFileURL(fixture.path).href}/`
    try {
      const body = await Effect.runPromise(
        pollWithTimeout(
          Effect.promise(async () => {
            const response = await Server.Default().app.request("/api/reference", {
              headers: { "x-aigcfroge-directory": tmp.path },
            })
            expect(response.status).toBe(200)
            const body = await response.json()
            return body.data.length === 0 ? undefined : body
          }),
          "references were not loaded",
        ),
      )
      expect(body).toMatchObject({ location: { directory: tmp.path } })

      const head = await Server.Default().app.request("/api/reference", {
        method: "HEAD",
        headers: { "x-aigcfroge-directory": tmp.path },
      })
      expect(head.status).toBe(200)
      expect(await head.text()).toBe("")

      expect(body.data).toEqual([
        {
          name: "docs",
          path: path.join(tmp.path, "docs"),
          description: null,
          hidden: null,
          source: {
            type: "local",
            path: path.join(tmp.path, "docs"),
            description: null,
            hidden: null,
          },
        },
        {
          name: "effect",
          path: path.join(Global.Path.repos, "github.com", "Effect-TS", "effect"),
          description: null,
          hidden: null,
          source: {
            type: "git",
            repository: "Effect-TS/effect",
            branch: "main",
            description: null,
            hidden: null,
          },
        },
      ])
    } finally {
      if (previous === undefined) delete process.env.AIGCFROGE_REPO_CLONE_GITHUB_BASE_URL
      else process.env.AIGCFROGE_REPO_CLONE_GITHUB_BASE_URL = previous
    }
  })
})
