import { afterEach, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Schema } from "effect"

const roots: string[] = []
const selector = path.join(import.meta.dir, "pr-ci.mjs")
const validator = path.join(import.meta.dir, "check-readmes.ts")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "omnixa-ci-"))
  roots.push(root)
  await $`git -C ${root} init -b main`.quiet()
  await $`git -C ${root} config user.email ci@example.invalid`.quiet()
  await $`git -C ${root} config user.name ci-test`.quiet()
  await Bun.write(path.join(root, "README.md"), "# English\n")
  await Bun.write(path.join(root, "README.zh.md"), "# 中文\n")
  await Bun.write(path.join(root, "product.md"), "runtime instructions\n")
  await $`git -C ${root} add .`.quiet()
  await $`git -C ${root} commit -m base`.quiet()
  return root
}

async function preview(root: string, change: () => Promise<unknown>) {
  const base = (await $`git -C ${root} rev-parse HEAD`.text()).trim()
  await $`git -C ${root} switch -c topic`.quiet()
  await change()
  await $`git -C ${root} add -A`.quiet()
  await $`git -C ${root} commit --allow-empty -m topic`.quiet()
  const head = (await $`git -C ${root} rev-parse HEAD`.text()).trim()
  await $`git -C ${root} switch main`.quiet()
  await $`git -C ${root} merge --no-ff --no-edit topic`.quiet()
  return { base: { sha: base }, head: { ref: "topic", sha: head } }
}

async function select(root: string, event: object, name = "pull_request") {
  const payload = path.join(root, ".git", "pr-event.json")
  await Bun.write(payload, JSON.stringify(event))
  return (
    await $`node ${selector}`
      .cwd(root)
      .env({ ...process.env, GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: payload })
      .text()
  ).trim()
}

test("only edits limited to the PR title and body leave existing product checks alone", async () => {
  const root = await repository()
  const pr = { head: { ref: "topic" } }
  for (const changes of [{ title: { from: "old" } }, { body: { from: "" } }, { title: {}, body: {} }]) {
    expect(await select(root, { action: "edited", pull_request: pr, changes })).toBe("lane=metadata")
  }
  for (const changes of [{ base: { ref: { from: "dev" } }, title: {} }, {}, { body: {}, other: {} }, undefined]) {
    expect(await select(root, { action: "edited", pull_request: pr, changes })).toBe("lane=full")
  }
  expect(
    await select(root, {
      action: "edited",
      pull_request: { head: { ref: "release-candidate" } },
      changes: { body: {} },
    }),
  ).toBe("lane=full")
})

test("a README-only merge preview is bound to its actual base and head; pushes and releases stay full", async () => {
  const root = await repository()
  const pr = await preview(root, async () => {
    await Bun.write(path.join(root, "README.md"), "# Revised\n")
    await Bun.write(path.join(root, "README.zh.md"), "# 更新\n")
  })
  const event = { action: "synchronize", pull_request: pr }
  expect(await select(root, event)).toBe("lane=readme")
  expect(await select(root, { ...event, pull_request: { ...pr, base: pr.head } })).toBe("lane=full")
  expect(
    await select(root, { ...event, pull_request: { ...pr, head: { ...pr.head, ref: "release-candidate" } } }),
  ).toBe("lane=full")
  for (const name of ["push", "workflow_dispatch"]) expect(await select(root, event, name)).toBe("lane=full")
  expect(await select(root, { ...event, action: "unknown" })).toBe("lane=full")
})

test.each(["empty", "mixed", "rename"])("%s diffs still run product checks", async (kind) => {
  const root = await repository()
  const pr = await preview(root, async () => {
    if (kind === "empty") return
    if (kind === "rename") {
      await $`git -C ${root} rm README.md`.quiet()
      await $`git -C ${root} mv product.md README.md`.quiet()
      return
    }
    await Bun.write(path.join(root, "README.md"), "# Updated\n")
    await Bun.write(path.join(root, "product.md"), "updated runtime instructions\n")
  })
  expect(await select(root, { action: "opened", pull_request: pr })).toBe("lane=full")
})

test("README checks resolve Markdown and HTML links, images and anchors against the committed tree", async () => {
  const root = await repository()
  const readme = path.join(root, "README.md")
  const check = () => $`${process.execPath} ${validator}`.cwd(root).quiet().nothrow()
  const commit = async () => {
    await $`git -C ${root} add -u`.quiet()
    await $`git -C ${root} commit -m readme`.quiet()
  }
  await Bun.write(path.join(root, "README.zh.md"), '# 中文\n# **中文**\n# A &amp; B\n\n<a name="explicit"></a>\n')
  await Bun.write(path.join(root, "image.svg"), "<svg/>\n")
  await $`git -C ${root} add image.svg`.quiet()
  await Bun.write(
    readme,
    '# Guide\n\n[中文][cn]\n\n[cn]: README.zh.md#%E4%B8%AD%E6%96%87\n\n[duplicate](README.zh.md#中文-1) [entity](README.zh.md#a--b) [named](README.zh.md#explicit)\n\n<img src="/image.svg">\n\n[external](https://offline.invalid/example)\n\n`[example](not-a-file)`\n',
  )
  await commit()
  expect((await check()).exitCode).toBe(0)

  await Bun.write(path.join(root, "local-only.md"), "not published")
  for (const [content, target] of [
    ["[old](local-only.md)", "local-only.md"],
    ['<img src="missing.png">', "missing.png"],
    ["[section](README.zh.md#gone)", "README.zh.md#gone"],
  ]) {
    await Bun.write(readme, content)
    await commit()
    const failed = await check()
    expect(failed.exitCode).not.toBe(0)
    expect(failed.stderr.toString()).toContain(target)
  }
  await Bun.write(readme, "# Guide\n")
  await $`git -C ${root} rm README.zh.md`.quiet()
  await commit()
  const missing = await check()
  expect(missing.exitCode).not.toBe(0)
  expect(missing.stderr.toString()).toContain("Missing regular Markdown file: README.zh.md")
})

// The aggregate runs on Ubuntu using Bash; exercise the workflow's real decision, not a copy.
test.skipIf(process.platform === "win32")(
  "the required aggregate rejects missing, cancelled and failed coverage",
  async () => {
    const workflow = Schema.decodeUnknownSync(
      Schema.Struct({
        jobs: Schema.Struct({
          "lint-test-typecheck": Schema.Struct({ steps: Schema.Array(Schema.Struct({ run: Schema.String })) }),
        }),
      }),
    )(Bun.YAML.parse(await Bun.file(path.join(import.meta.dir, "../../../.github/workflows/ci.yml")).text()))
    const verify = (lane: string, scope: string, results: string) =>
      $`bash -eo pipefail -c ${workflow.jobs["lint-test-typecheck"].steps[0].run}`
        .env({ ...process.env, LANE: lane, SCOPE_RESULT: scope, PRODUCT_RESULTS: results })
        .quiet()
        .nothrow()
    for (const [lane, result] of [
      ["full", "success"],
      ["readme", "skipped"],
    ]) {
      const jobs = Array<string>(5).fill(result)
      expect((await verify(lane, "success", jobs.join(" "))).exitCode).toBe(0)
      expect((await verify(lane, "failure", jobs.join(" "))).exitCode).not.toBe(0)
      for (const bad of ["failure", "cancelled", lane === "full" ? "skipped" : "success", ""]) {
        expect((await verify(lane, "success", [...jobs.slice(1), bad].join(" "))).exitCode).not.toBe(0)
      }
    }
    expect((await verify("unknown", "success", "success success success success success")).exitCode).not.toBe(0)
  },
)
