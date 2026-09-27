import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Release } from "./release"
import { ReleaseMetadata } from "./release-metadata"

const directories: string[] = []
const servers: Array<ReturnType<typeof Bun.serve>> = []
const source = "a".repeat(40)
const other = "b".repeat(40)

afterEach(async () => {
  servers.splice(0).forEach((server) => server.stop(true))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function directory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aigcforge-release-"))
  directories.push(dir)
  return dir
}

async function repository() {
  const root = await directory()
  await Bun.write(
    path.join(root, "package.json"),
    JSON.stringify({ version: "0.0.2", workspaces: { packages: ["packages/*", "packages/sdk/js"] } }, null, 2) + "\n",
  )
  await Bun.write(
    path.join(root, "packages/app/package.json"),
    JSON.stringify({ name: "app", version: "0.0.2", dependencies: { value: "1.0.0" } }, null, 2) + "\n",
  )
  await Bun.write(
    path.join(root, "packages/sdk/js/package.json"),
    JSON.stringify({ name: "sdk", version: "0.0.1" }, null, 2) + "\n",
  )
  await Bun.write(path.join(root, "bun.lock"), "unchanged lock\n")
  await $`git -C ${root} init -b main`.quiet()
  await $`git -C ${root} config user.email release@example.invalid`.quiet()
  await $`git -C ${root} config user.name release-test`.quiet()
  await $`git -C ${root} add .`.quiet()
  await $`git -C ${root} commit -m initial`.quiet()
  const base = (await $`git -C ${root} rev-parse HEAD`.quiet().text()).trim()
  await $`git -C ${root} update-ref refs/remotes/origin/main ${base}`.quiet()
  return { root, base }
}

function github(handler: (url: URL, request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      return handler(new URL(request.url), request)
    },
  })
  servers.push(server)
  return new Release.GitHub("owner/repo", "test-token", server.url.toString().replace(/\/$/, ""))
}

function pull(overrides: Partial<Release.Pull> = {}) {
  return new Release.Pull({
    number: 11,
    title: "feat(app): feature",
    body: null,
    state: "closed",
    draft: false,
    merged_at: "2026-09-27T00:00:00.000Z",
    merge_commit_sha: source,
    user: { login: "someone" },
    head: { ref: "feature", sha: source, repo: { full_name: "owner/repo" } },
    base: { ref: "main" },
    labels: [],
    ...overrides,
  })
}

function release(overrides: Partial<Release.Published> = {}) {
  return new Release.Published({
    id: 1,
    tag_name: "v0.0.3",
    target_commitish: source,
    draft: true,
    prerelease: false,
    body: "Release notes",
    assets: [],
    ...overrides,
  })
}

function event(overrides: Partial<NonNullable<Release.Event["workflow_run"]>> = {}) {
  return new Release.Event({
    workflow_run: {
      event: "push",
      conclusion: "success",
      head_branch: "main",
      head_sha: source,
      head_repository: { full_name: "owner/repo" },
      ...overrides,
    },
  })
}

describe("release intent", () => {
  test("automation is opt-in and main push never falls through to full", () => {
    expect(Release.route("workflow_run", event(), "off", "owner/repo", "refs/heads/main", source).mode).toBe("skip")
    expect(Release.route("push", new Release.Event({}), "publish", "owner/repo", "refs/heads/main", source).mode).toBe(
      "skip",
    )
    expect(Release.route("push", new Release.Event({}), "off", "owner/repo", "refs/heads/dev", source).mode).toBe(
      "full",
    )
  })

  test("trusted CI selects preparation, not the legacy publisher", () => {
    const plan = Release.route("workflow_run", event(), "publish", "owner/repo", "refs/heads/main", other)
    expect(plan.mode).toBe("prepare")
    expect(plan.sha).toBe(source)
  })

  test.each([
    { event: "pull_request" },
    { conclusion: "failure" },
    { head_branch: "feature" },
    { head_repository: { full_name: "attacker/fork" } },
  ])("rejects an untrusted or failed CI source %j", (overrides) => {
    expect(
      Release.route("workflow_run", event(overrides), "publish", "owner/repo", "refs/heads/main", other).mode,
    ).toBe("skip")
  })

  test("manual releases stay explicit and main-only", () => {
    expect(
      Release.route("workflow_dispatch", new Release.Event({}), "publish", "owner/repo", "refs/heads/main", source)
        .mode,
    ).toBe("desktop-draft")
    expect(
      Release.route(
        "workflow_dispatch",
        new Release.Event({ inputs: { release_mode: "full" } }),
        "off",
        "owner/repo",
        "refs/heads/main",
        source,
      ).mode,
    ).toBe("full")
    expect(() =>
      Release.route("workflow_dispatch", new Release.Event({}), "off", "owner/repo", "refs/heads/feature", source),
    ).toThrow("main")
    expect(() =>
      Release.route(
        "workflow_dispatch",
        new Release.Event({ inputs: { release_mode: "desktop-release" } }),
        "off",
        "owner/repo",
        "refs/heads/main",
        source,
      ),
    ).toThrow("mode")
  })

  test("invalid automation modes fail rather than silently enabling publishing", () => {
    expect(() => Release.route("workflow_run", event(), "yes", "owner/repo", "refs/heads/main", source)).toThrow(
      "off, draft, or publish",
    )
  })

  test.each(["HEAD", "v0.0.3", "0.0", "0.0.3-preview", "0.0.3\n", "01.0.0"])(
    "rejects noncanonical stable version %s",
    (input) => {
      expect(() => Release.version(input)).toThrow()
    },
  )

  test("bump policy is explicit and aggregates stronger release intent", () => {
    expect(Release.bump([])).toBe("patch")
    expect(Release.next("0.0.2", "patch")).toBe("0.0.3")
    expect(Release.bump(["release:patch", "release:minor", "release:major"])).toBe("major")
    expect(Release.bump(["release:none"])).toBe("none")
    expect(() => Release.bump(["release:none", "release:minor"])).toThrow("conflicts")
    expect(() => Release.bump(["release:unknown"])).toThrow("Unknown")
  })

  test.each([
    "packages/core/src/session.ts",
    "packages/llm/package.json",
    "packages/sdk/js/src/v2/gen/sdk.gen.ts",
    "packages/ui/src/theme.css",
    "packages/desktop/electron-builder.config.ts",
    "bun.lock",
    ".github/workflows/publish.yml",
  ])("includes desktop dependency or packaging changes: %s", (file) => {
    expect(Release.affectsDesktop(file)).toBe(true)
  })

  test.each([
    "docs/guide.md",
    "packages/core/src/value.test.ts",
    "packages/app/e2e/app.spec.ts",
    "packages/aigcfroge/test/session.test.ts",
    "packages/storybook/src/story.tsx",
    ".github/workflows/test.yml",
  ])("does not release for isolated docs/test/showcase changes: %s", (file) => {
    expect(Release.affectsDesktop(file)).toBe(false)
  })

  test("candidate markers are single, validated and round-trip", () => {
    const data = new Release.Candidate({ version: "0.0.3", previous: "0.0.2", base: source, issue: 12 })
    expect(Release.candidate(Release.marker(data))).toEqual(data)
    expect(() => Release.candidate(`${Release.marker(data)}\n${Release.marker(data)}`)).toThrow("one")
    expect(() => Release.candidate(null)).toThrow()
    expect(() => Release.marker(new Release.Candidate({ ...data, base: "main" }))).toThrow("SHA")
  })
})

describe("version commit integrity", () => {
  test("includes nested SDK, preserves non-version data and lockfile, and is repeatable", async () => {
    const repo = await repository()
    expect(await Release.manifests(repo.root)).toEqual([
      "package.json",
      "packages/app/package.json",
      "packages/sdk/js/package.json",
    ])
    const commit = await Release.commitCandidate(repo.root, repo.base, "0.0.3")
    expect(await Release.verifyVersionCommit(repo.root, repo.base, commit, "0.0.3")).toHaveLength(3)
    expect(await $`git -C ${repo.root} show ${`${commit}:bun.lock`}`.quiet().text()).toBe("unchanged lock\n")
    expect(
      JSON.parse(await $`git -C ${repo.root} show ${`${commit}:packages/sdk/js/package.json`}`.quiet().text()).version,
    ).toBe("0.0.3")
    expect(await $`git -C ${repo.root} diff --cached --name-only`.quiet().text()).not.toContain("bun.lock")
  })

  test("updates candidates with a fast-forward parent, without force-push", async () => {
    const repo = await repository()
    const first = await Release.commitCandidate(repo.root, repo.base, "0.0.3")
    await $`git -C ${repo.root} reset --hard ${repo.base}`.quiet()
    await Bun.write(path.join(repo.root, "packages/app/new.ts"), "export const feature = true\n")
    await $`git -C ${repo.root} add packages/app/new.ts`.quiet()
    await $`git -C ${repo.root} commit -m feature`.quiet()
    const next = (await $`git -C ${repo.root} rev-parse HEAD`.quiet().text()).trim()
    const updated = await Release.commitCandidate(repo.root, next, "0.1.0", first)
    expect((await $`git -C ${repo.root} merge-base --is-ancestor ${first} ${updated}`.quiet().nothrow()).exitCode).toBe(
      0,
    )
    expect(await Release.verifyVersionCommit(repo.root, next, updated, "0.1.0")).toHaveLength(3)
  })

  test("refuses dirty workspaces and manifest traversal", async () => {
    const repo = await repository()
    await Bun.write(path.join(repo.root, "unrelated.txt"), "keep me")
    await expect(Release.commitCandidate(repo.root, repo.base, "0.0.3")).rejects.toThrow("clean")
    await Bun.write(
      path.join(repo.root, "package.json"),
      JSON.stringify({ version: "0.0.2", workspaces: { packages: ["../outside"] } }),
    )
    await expect(Release.manifests(repo.root)).rejects.toThrow("inside")
  })

  test("rejects a version PR with business changes or an omitted SDK", async () => {
    const repo = await repository()
    await Release.updateVersions(repo.root, "0.0.3")
    await Bun.write(path.join(repo.root, "packages/app/hidden.ts"), "export const hidden = true\n")
    await $`git -C ${repo.root} add .`.quiet()
    await $`git -C ${repo.root} commit -m bad`.quiet()
    const bad = (await $`git -C ${repo.root} rev-parse HEAD`.quiet().text()).trim()
    await expect(Release.verifyVersionCommit(repo.root, repo.base, bad, "0.0.3")).rejects.toThrow("outside")
    await $`git -C ${repo.root} reset --hard ${repo.base}`.quiet()
    await Release.updateVersions(repo.root, "0.0.3")
    await $`git -C ${repo.root} restore --source=${repo.base} packages/sdk/js/package.json`.quiet()
    await $`git -C ${repo.root} add .`.quiet()
    await $`git -C ${repo.root} commit -m incomplete`.quiet()
    const incomplete = (await $`git -C ${repo.root} rev-parse HEAD`.quiet().text()).trim()
    await expect(Release.verifyVersionCommit(repo.root, repo.base, incomplete, "0.0.3")).rejects.toThrow(
      "packages/sdk/js",
    )
  })
})

describe("change selection", () => {
  test("counts desktop work but never the managed version PR itself", async () => {
    const repo = await repository()
    await Bun.write(path.join(repo.root, "packages/app/feature.ts"), "export const feature = true\n")
    await $`git -C ${repo.root} add packages/app/feature.ts`.quiet()
    await $`git -C ${repo.root} commit -m "feat(app): add feature"`.quiet()
    const feature = (await $`git -C ${repo.root} rev-parse HEAD`.quiet().text()).trim()
    const candidate = await Release.commitCandidate(repo.root, feature, "0.0.3")
    await $`git -C ${repo.root} update-ref refs/heads/main ${candidate}`.quiet()
    const pulls = new Map<string, unknown[]>([
      [
        feature,
        [
          pull({
            number: 21,
            merge_commit_sha: feature,
            head: { ref: "feature-branch", sha: feature, repo: { full_name: "owner/repo" } },
          }),
        ],
      ],
      [
        candidate,
        [
          pull({
            number: 22,
            merge_commit_sha: candidate,
            head: { ref: Release.branch, sha: candidate, repo: { full_name: "owner/repo" } },
          }),
        ],
      ],
    ])
    const client = github((url) => {
      const sha = url.pathname.split("/commits/")[1]?.split("/")[0] ?? ""
      return Response.json(pulls.get(sha) ?? [])
    })
    const changes = await Release.changesSince(repo.root, client, repo.base, candidate)
    expect(changes.kind).toBe("patch")
    expect(changes.pulls).toHaveLength(1)
    expect(changes.pulls[0].head.ref).toBe("feature-branch")
    expect(changes.pulls.map((item) => item.number)).toEqual([21])
  })

  test("documentation-only ranges produce no release", async () => {
    const repo = await repository()
    await Bun.write(path.join(repo.root, "docs/guide.md"), "# Guide\n")
    await $`git -C ${repo.root} add docs/guide.md`.quiet()
    await $`git -C ${repo.root} commit -m "docs: guide"`.quiet()
    const head = (await $`git -C ${repo.root} rev-parse HEAD`.quiet().text()).trim()
    const client = github(() => Response.json([pull()]))
    expect((await Release.changesSince(repo.root, client, repo.base, head)).kind).toBe("none")
  })
})

describe("GitHub release lifecycle", () => {
  test("creating and retrying the same draft is idempotent", async () => {
    const state = { releases: Array<Release.Published>(), creates: 0 }
    const client = github(async (url, request) => {
      expect(request.headers.get("authorization")).toBe("Bearer test-token")
      if (url.pathname.includes("/git/ref/")) return new Response("missing", { status: 404 })
      if (request.method === "POST") {
        const body = await request.json()
        expect(body).toMatchObject({ tag_name: "v0.0.3", target_commitish: source, draft: true })
        state.creates++
        state.releases.push(release())
        return Response.json(state.releases[0])
      }
      return Response.json(state.releases)
    })
    expect((await client.draft("0.0.3", source, "notes"))?.draft).toBe(true)
    expect((await client.draft("0.0.3", source, "different notes"))?.id).toBe(1)
    expect(state.creates).toBe(1)
  })

  test("creation does not depend on immediate release-list visibility", async () => {
    const client = github((url, request) => {
      if (url.pathname.includes("/git/ref/")) return new Response("missing", { status: 404 })
      if (request.method === "POST") return Response.json(release())
      return Response.json([])
    })
    expect((await client.draft("0.0.3", source, "notes"))?.id).toBe(1)
  })

  test("published releases are a no-op only when the immutable source matches", async () => {
    const methods: string[] = []
    const client = github((url, request) => {
      methods.push(request.method)
      if (url.pathname.includes("/git/ref/")) return Response.json({ object: { type: "commit", sha: source } })
      return Response.json([release({ draft: false })])
    })
    expect((await client.publish("0.0.3", source)).draft).toBe(false)
    expect(methods.every((method) => method === "GET")).toBe(true)
    await expect(client.draft("0.0.3", other, "notes")).rejects.toThrow("never moved")
  })

  test("rejects duplicate drafts and never publishes a conflicting source", async () => {
    const client = github((url) =>
      url.pathname.includes("/git/ref/")
        ? new Response("missing", { status: 404 })
        : Response.json([release(), release({ id: 2 })]),
    )
    await expect(client.draft("0.0.3", source)).rejects.toThrow("Multiple")
  })

  test("refuses to move latest backwards", async () => {
    const client = github((url, request) => {
      expect(request.method).toBe("GET")
      if (url.pathname.includes("/git/ref/")) return new Response("missing", { status: 404 })
      if (url.pathname.endsWith("/latest")) return Response.json(release({ draft: false, tag_name: "v0.0.4" }))
      return Response.json([release()])
    })
    await expect(client.publish("0.0.3", source)).rejects.toThrow("older")
  })

  test("API errors do not echo response payloads or credentials", async () => {
    const client = github(() => new Response("sensitive-probe", { status: 403 }))
    await expect(client.latest()).rejects.toThrow("HTTP 403")
    const failure = await client.latest().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Release.Failure)
    if (!(failure instanceof Release.Failure)) throw new Error("expected typed failure")
    expect(failure.message).not.toContain("sensitive-probe")
    expect(failure.message).not.toContain("test-token")
  })

  test("auto-merge requires strict, complete main checks", async () => {
    const good = github((url) =>
      Response.json(
        url.pathname.endsWith("/owner/repo")
          ? { allow_auto_merge: true }
          : { strict: true, contexts: Release.requiredChecks },
      ),
    )
    await good.policy()
    const bad = github((url) =>
      Response.json(
        url.pathname.endsWith("/owner/repo")
          ? { allow_auto_merge: true }
          : { strict: false, contexts: ["Lint, Test, and Typecheck"] },
      ),
    )
    await expect(bad.policy()).rejects.toThrow("every")
  })
})

async function metadataFixture() {
  const root = await directory()
  const files = [
    "aigcfroge-desktop-win-x64.exe",
    "aigcfroge-desktop-win-arm64.exe",
    "aigcfroge-desktop-linux-x86_64.AppImage",
    "aigcfroge-desktop-linux-arm64.AppImage",
    "aigcfroge-desktop-mac-arm64.zip",
  ]
  const entries: ReleaseMetadata.File[] = []
  for (const name of files) {
    const file = path.join(root, name)
    await Bun.write(file, `installer bytes for ${name}`)
    entries.push(
      new ReleaseMetadata.File({
        url: name,
        size: Bun.file(file).size,
        sha512: (await ReleaseMetadata.hashes(file)).sha512,
      }),
    )
  }
  const groups = [entries.slice(0, 2), entries.slice(2, 3), entries.slice(3, 4), entries.slice(4)]
  for (const [index, name] of ReleaseMetadata.names.entries()) {
    await Bun.write(
      path.join(root, name),
      ReleaseMetadata.serialize({ version: "0.0.3", files: groups[index], releaseDate: "2026-09-27T00:00:00.000Z" }),
    )
  }
  const assets = await Promise.all(
    [...files, ...ReleaseMetadata.names].map(
      async (name, index) =>
        new Release.Asset({
          id: index + 1,
          name,
          state: "uploaded",
          size: Bun.file(path.join(root, name)).size,
          digest: (await ReleaseMetadata.hashes(path.join(root, name))).sha256,
        }),
    ),
  )
  return { root, assets, entries }
}

describe("desktop update metadata", () => {
  test("verifies all five targets and local/remote digests", async () => {
    const fixture = await metadataFixture()
    expect(await ReleaseMetadata.verify(fixture.root, fixture.root, "0.0.3", fixture.assets)).toEqual({
      platforms: 5,
      assets: 9,
    })
  })

  test("incomplete entries, duplicate URLs and traversal fail closed", async () => {
    const fixture = await metadataFixture()
    const valid = await Bun.file(path.join(fixture.root, "latest.yml")).text()
    expect(() => ReleaseMetadata.parse(valid.replace(/    size: \d+\n/, ""))).toThrow("entry")
    expect(() => ReleaseMetadata.parse(valid.replace(fixture.entries[0].url, "../outside.exe"))).toThrow("asset name")
    expect(() =>
      ReleaseMetadata.serialize({
        version: "0.0.3",
        files: [fixture.entries[0], fixture.entries[0]],
        releaseDate: "2026-09-27",
      }),
    ).toThrow("duplicate")
  })

  test("preserves valid prerelease metadata for legacy full releases", async () => {
    const fixture = await metadataFixture()
    const value = {
      version: "0.0.0-beta-20260927",
      files: [fixture.entries[0]],
      releaseDate: "2026-09-27T00:00:00.000Z",
    }
    expect(ReleaseMetadata.parse(ReleaseMetadata.serialize(value)).version).toBe(value.version)
  })

  test("rejects corrupt local installers and stale remote assets", async () => {
    const fixture = await metadataFixture()
    const file = path.join(fixture.root, fixture.entries[0].url)
    const original = await Bun.file(file).text()
    await Bun.write(file, original.replace("installer", "corrupted"))
    await expect(ReleaseMetadata.verify(fixture.root, fixture.root, "0.0.3", fixture.assets)).rejects.toThrow("SHA-512")
    await Bun.write(file, original)
    await expect(
      ReleaseMetadata.verify(fixture.root, fixture.root, "0.0.3", [
        ...fixture.assets,
        new Release.Asset({ id: 99, name: "stale.exe", state: "uploaded", size: 1, digest: "sha256:bad" }),
      ]),
    ).rejects.toThrow("stale")
    await expect(ReleaseMetadata.verify(fixture.root, fixture.root, "0.0.4", fixture.assets)).rejects.toThrow(
      "Mixed versions",
    )
  })
})
