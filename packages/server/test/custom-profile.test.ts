import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { AssetYaml } from "@aigcfroge/core/util/asset-yaml"
import { CustomCompositionReferencesResponse } from "@aigcfroge/protocol/groups/custom-composition"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { Agent } from "@aigcfroge/schema/agent"
import { Session } from "@aigcfroge/schema/session"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Effect, Schema } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const candidate = CustomProfile.Candidate.make({
  name: CustomProfile.Name.make("review-team"),
  description: CustomProfile.Description.make("Review changes"),
  relativePath: "team/review.yaml",
  profile: CustomProfile.decodeProfile({
    kind: "custom-profile",
    name: "review-team",
    description: "Review changes",
    agents: [{ kind: "agent", relativePath: "reviewer.md", revision: "a".repeat(64) }],
    bindings: { "agents/reviewer": { prompts: [], skills: [] } },
    presentation: "native",
    requestedCapabilities: [],
  }),
})

const referencePaths = {
  agent: "shared/reviewer.md",
  prompt: "shared/reviewer.md",
  skill: "git-tools/SKILL.md",
  workflow: "flows/review.yaml",
  command: "shared/check.md",
  mcp: "servers/probe.md",
}

const referenceProfile = {
  ...candidate.profile,
  agents: [
    { kind: "agent", relativePath: referencePaths.agent, revision: "a".repeat(64) },
    { kind: "agent", relativePath: referencePaths.agent.replaceAll("/", "\\"), revision: "b".repeat(64) },
  ],
  workflow: { kind: "workflow", relativePath: referencePaths.workflow, revision: "a".repeat(64) },
  bindings: {
    orchestrator: {
      prompts: [
        { kind: "prompt", relativePath: referencePaths.prompt, revision: "a".repeat(64) },
        { kind: "prompt", relativePath: referencePaths.prompt, revision: "b".repeat(64) },
      ],
      skills: [{ kind: "skill", relativePath: referencePaths.skill, revision: "a".repeat(64) }],
      commands: [{ kind: "command", relativePath: referencePaths.command, revision: "a".repeat(64) }],
    },
    "agents/reviewer": {
      prompts: [{ kind: "prompt", relativePath: referencePaths.prompt, revision: "a".repeat(64) }],
      skills: [{ kind: "skill", relativePath: referencePaths.skill, revision: "b".repeat(64) }],
      commands: [{ kind: "command", relativePath: referencePaths.command, revision: "b".repeat(64) }],
    },
  },
  mcpBindings: ["probe-a", "probe-b"].map((serverName) => ({
    serverName,
    ref: { relativePath: referencePaths.mcp, revision: "a".repeat(64) },
    transport: "remote",
    url: "https://example.com/mcp",
  })),
}

const referenceFiles = [
  { directory: "project", path: "zeta.yaml", profile: { ...referenceProfile, name: "Alpha name" } },
  { directory: "project", path: "team/alpha.yaml", profile: { ...referenceProfile, name: "Zulu name" } },
  {
    directory: "project",
    path: "middle.yaml",
    profile: {
      ...candidate.profile,
      name: "Prompt only",
      agents: [{ kind: "agent", relativePath: "different.md", revision: "a".repeat(64) }],
      bindings: {
        orchestrator: {
          prompts: [{ kind: "prompt", relativePath: referencePaths.prompt, revision: "a".repeat(64) }],
          skills: [],
        },
      },
    },
  },
  {
    directory: "project",
    path: "prefix.yaml",
    profile: {
      ...candidate.profile,
      name: "Literal prefix",
      agents: [{ kind: "agent", relativePath: `.aigcfroge/agents/${referencePaths.agent}`, revision: "a".repeat(64) }],
      bindings: {},
    },
  },
  {
    directory: "project",
    path: "percent.yaml",
    profile: {
      ...candidate.profile,
      name: "Literal percent",
      agents: [{ kind: "agent", relativePath: "shared/%2Freviewer.md", revision: "a".repeat(64) }],
      bindings: {},
    },
  },
  { directory: "project", path: "conflict-a.yaml", profile: { ...referenceProfile, name: "Conflict" } },
  { directory: "project", path: "conflict-b.yaml", profile: { ...referenceProfile, name: "Conflict" } },
  { directory: "project", path: "invalid.yaml", profile: { ...referenceProfile, name: "Invalid", agents: [] } },
  { directory: "other", path: "other.yaml", profile: { ...referenceProfile, name: "Other Location" } },
].map((file) => ({
  directory: file.directory,
  path: `.aigcfroge/custom-profiles/${file.path}`,
  content: AssetYaml.stringify(file.profile),
}))

const setup = (files: ReadonlyArray<{ directory: string; path: string; content: string }> = []) =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("aigcfroge-profile-%2F-http-")
    const project = path.join(tmp.path, "project")
    const other = path.join(tmp.path, "other")
    yield* Effect.promise(() => Promise.all([fs.mkdir(project), fs.mkdir(other)]))
    yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const target = path.join(tmp.path, file.directory, file.path)
        yield* Effect.promise(() => fs.mkdir(path.dirname(target), { recursive: true }))
        yield* Effect.promise(() => Bun.write(target, file.content))
      }),
    )
    const handler = yield* ServerFetch.make({
      password: "secret",
      app: { version: "test" },
      database: { path: ":memory:" },
      config: { directory: path.join(tmp.path, "config"), project: false, content: "{}" },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const request = (route: string, options: { body?: unknown; directory?: string; authenticated?: boolean } = {}) =>
      Effect.promise(() => {
        const url = new URL(route, "http://aigcfroge.local")
        url.searchParams.set("directory", options.directory ?? project)
        return handler(
          new Request(url, {
            method: options.body === undefined ? "GET" : "POST",
            headers: {
              "content-type": "application/json",
              ...(options.authenticated === false ? {} : { authorization: `Basic ${btoa("aigcfroge:secret")}` }),
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
          }),
        )
      })
    const sessionID = Session.ID.create()
    return {
      request,
      project,
      other,
      sessionID,
      root: "/custom-profile",
      sessionRoot: `/session/${sessionID}/custom-profile`,
    }
  })

const references = Effect.fnUntraced(function* (
  test: Effect.Success<ReturnType<typeof setup>>,
  kind: string,
  referencePath: string,
  directory = test.project,
) {
  const response = yield* test.request(
    `/custom-composition/references?${new URLSearchParams({ kind, path: referencePath })}`,
    { directory },
  )
  if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(CustomCompositionReferencesResponse)(yield* Effect.promise(() => response.json()))
    .profiles
})

it.live("serves Custom Profile CRUD through the production router with revision conflicts and location isolation", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const created = yield* test.request(`${test.root}/apply`, { body: { candidate, overwrite: false } })
    if (created.status !== 200) throw new Error(yield* Effect.promise(() => created.clone().text()))
    expect(created.status).toBe(200)
    const profile = Schema.decodeUnknownSync(CustomProfile.Info)(yield* Effect.promise(() => created.json()))
    expect(profile.relativePath).toBe("team/review.yaml")
    expect(profile.profile).toEqual(candidate.profile)
    expect(
      yield* Effect.promise(() =>
        fs.readFile(path.join(test.project, ".aigcfroge/custom-profiles/team/review.yaml"), "utf8"),
      ),
    ).toContain("kind: custom-profile")

    const listed = yield* test.request("/custom-profile?search=REVIEW")
    expect(listed.status).toBe(200)
    expect(yield* Effect.promise(() => listed.json())).toMatchObject({
      assets: [{ name: candidate.name, relativePath: candidate.relativePath, revision: profile.revision }],
      invalid: [],
    })
    const other = yield* test.request("/custom-profile", { directory: test.other })
    expect(other.status).toBe(200)
    expect(yield* Effect.promise(() => other.json())).toEqual({ assets: [], invalid: [] })
    const content = yield* test.request("/custom-profile/content?path=team%2Freview.yaml")
    expect(content.status).toBe(200)
    expect(Schema.decodeUnknownSync(CustomProfile.Info)(yield* Effect.promise(() => content.json()))).toEqual(profile)

    const stale = yield* test.request(`${test.root}/apply`, {
      body: { candidate, overwrite: true, baseRevision: "b".repeat(64) },
    })
    expect(stale.status).toBe(409)
    const overwrite = yield* test.request(`${test.root}/apply`, {
      body: { candidate, overwrite: false, baseRevision: profile.revision },
    })
    expect(overwrite.status).toBe(409)
    const staleDelete = yield* test.request(`${test.sessionRoot}/delete`, {
      body: { relativePath: candidate.relativePath, baseRevision: "b".repeat(64) },
    })
    expect(staleDelete.status).toBe(409)
    const update = {
      ...candidate,
      description: "Review updated changes",
      profile: { ...candidate.profile, description: "Review updated changes" },
    }
    const updatedResponse = yield* test.request(`${test.root}/apply`, {
      body: { candidate: update, overwrite: true, baseRevision: profile.revision },
    })
    expect(updatedResponse.status).toBe(200)
    const updated = Schema.decodeUnknownSync(CustomProfile.Info)(yield* Effect.promise(() => updatedResponse.json()))
    expect(updated.description).toBe(CustomProfile.Description.make(update.description))
    expect(updated.revision).not.toBe(profile.revision)
    const latest = yield* test.request("/custom-profile/content?path=team%2Freview.yaml")
    expect(latest.status).toBe(200)
    expect(Schema.decodeUnknownSync(CustomProfile.Info)(yield* Effect.promise(() => latest.json()))).toEqual(updated)
    const deleted = yield* test.request(`${test.sessionRoot}/delete`, {
      body: { relativePath: candidate.relativePath, baseRevision: updated.revision },
    })
    expect(deleted.status).toBe(200)
    expect(yield* Effect.promise(() => deleted.json())).toMatchObject({
      relativePath: candidate.relativePath,
      referencingProfiles: [],
    })
    const missing = yield* test.request("/custom-profile/content?path=team%2Freview.yaml")
    expect(missing.status).toBe(404)
    expect(yield* Effect.promise(() => missing.json())).toMatchObject({ name: "NotFoundError" })
    const absentDelete = yield* test.request(`${test.sessionRoot}/delete`, {
      body: { relativePath: candidate.relativePath },
    })
    expect(absentDelete.status).toBe(404)
  }),
)

it.live("preserves auth, the asset feature gate, and candidate path validation", () =>
  Effect.gen(function* () {
    const test = yield* setup()
    const denied = yield* test.request(`${test.root}/apply`, {
      authenticated: false,
      body: { candidate, overwrite: false },
    })
    expect(denied.status).toBe(401)
    const disabled = yield* withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
      test.request(`${test.root}/apply`, { body: { candidate, overwrite: false } }),
    )
    expect(disabled.status).toBe(400)
    const invalid = yield* test.request(`${test.root}/apply`, {
      body: { candidate: { ...candidate, relativePath: "../escape.yaml" }, overwrite: false },
    })
    expect(invalid.status).toBe(400)
    const mismatched = yield* test.request(`${test.root}/apply`, {
      body: { candidate: { ...candidate, name: "wrong-name" }, overwrite: false },
    })
    expect(mismatched.status).toBe(400)
    yield* Effect.forEach(
      [
        { ...candidate.profile, agents: [] },
        { ...candidate.profile, root: { source: "builtin", id: "build" }, agents: [] },
        { ...candidate.profile, root: { source: "builtin", id: "unknown", revision: "a".repeat(64) }, agents: [] },
      ],
      (profile) =>
        Effect.gen(function* () {
          const rejected = yield* test.request(`${test.root}/apply`, {
            body: { candidate: { ...candidate, profile }, overwrite: false },
          })
          expect(rejected.status).toBe(400)
          expect(yield* Effect.promise(() => rejected.json())).toMatchObject({
            _tag: "InvalidRequestError",
            kind: "Payload",
          })
        }),
    )
    const secretBearing = yield* test.request(`${test.root}/apply`, {
      body: {
        candidate: {
          ...candidate,
          profile: {
            ...candidate.profile,
            mcpBindings: [
              {
                serverName: "probe",
                ref: { relativePath: "probe.yaml", revision: "a".repeat(64) },
                transport: "remote",
                url: "https://example.com/mcp",
                headers: { Authorization: "Bearer fixture-value" },
              },
            ],
          },
        },
        overwrite: false,
      },
    })
    expect(secretBearing.status).toBe(400)
    expect(yield* Effect.promise(() => secretBearing.json())).toMatchObject({
      _tag: "InvalidRequestError",
      kind: "Payload",
    })
    expect(
      yield* Effect.promise(() =>
        Bun.file(path.join(test.project, ".aigcfroge/custom-profiles/team/review.yaml")).exists(),
      ),
    ).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(path.join(test.project, ".aigcfroge/escape.yaml")).exists())).toBe(
      false,
    )
    const list = yield* test.request("/custom-profile")
    if (list.status !== 200) throw new Error(yield* Effect.promise(() => list.clone().text()))
    expect(list.status).toBe(200)
    expect(yield* Effect.promise(() => list.json())).toEqual({ assets: [], invalid: [] })
  }),
)

it.live("finds six profile reference kinds with normalized paths, deduplication, and deleted targets", () =>
  Effect.gen(function* () {
    const test = yield* setup([
      ...referenceFiles,
      {
        directory: "project",
        path: `.aigcfroge/prompts/${referencePaths.prompt}`,
        content: "---\nkind: prompt\nname: referenced-prompt\ndescription: Referenced prompt\n---\nReview carefully\n",
      },
    ])
    const listed = yield* test.request("/custom-profile")
    expect(listed.status).toBe(200)
    const profiles = Schema.decodeUnknownSync(
      Schema.Struct({ assets: Schema.Array(CustomProfile.Summary), invalid: Schema.Array(CustomProfile.InvalidEntry) }),
    )(yield* Effect.promise(() => listed.json()))
    expect(profiles.assets).toHaveLength(5)
    expect(profiles.invalid.map((entry) => entry.relativePath).toSorted()).toEqual([
      "conflict-a.yaml",
      "conflict-b.yaml",
      "invalid.yaml",
    ])
    yield* Effect.forEach(Object.entries(referencePaths), ([kind, referencePath]) =>
      Effect.gen(function* () {
        const found = yield* references(test, kind, referencePath)
        const expectedPaths =
          kind === "prompt" ? ["middle.yaml", "team/alpha.yaml", "zeta.yaml"] : ["team/alpha.yaml", "zeta.yaml"]
        expect(found.map((profile) => profile.relativePath)).toEqual(expectedPaths)
        expect(found).toEqual(
          expectedPaths
            .map((relativePath) => profiles.assets.find((profile) => profile.relativePath === relativePath))
            .filter((profile) => profile !== undefined),
        )
        expect(yield* references(test, kind, `  ${referencePath.replaceAll("/", "\\")}  `)).toEqual(found)
        expect(yield* references(test, kind, kind === "workflow" ? "missing.yaml" : "missing.md")).toEqual([])
      }),
    )
    expect(
      (yield* references(test, "agent", `.aigcfroge/agents/${referencePaths.agent}`)).map(
        (profile) => profile.relativePath,
      ),
    ).toEqual(["prefix.yaml"])
    expect((yield* references(test, "agent", "shared/%2Freviewer.md")).map((profile) => profile.relativePath)).toEqual([
      "percent.yaml",
    ])
    expect((yield* references(test, "agent", referencePaths.agent)).map((profile) => profile.relativePath)).toEqual([
      "team/alpha.yaml",
      "zeta.yaml",
    ])
    expect(yield* references(test, "agent", referencePaths.command)).toEqual([])
    const beforeDeletion = yield* references(test, "prompt", referencePaths.prompt)
    const target = path.join(test.project, ".aigcfroge/prompts", referencePaths.prompt)
    expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(true)
    yield* Effect.promise(() => fs.unlink(target))
    expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
    expect(yield* references(test, "prompt", referencePaths.prompt)).toEqual(beforeDeletion)
  }),
)

it.live("rejects unsupported reference kinds and unsafe paths with typed HTTP errors", () =>
  Effect.gen(function* () {
    const test = yield* setup(referenceFiles)
    const target = path.join(test.project, ".aigcfroge/custom-profiles/team/alpha.yaml")
    const before = yield* Effect.promise(() => Bun.file(target).text())
    yield* Effect.forEach(["", "plugin", "custom-profile", "unknown"], (kind) =>
      Effect.gen(function* () {
        const response = yield* test.request(
          `/custom-composition/references?${new URLSearchParams({ kind, path: "safe.md" })}`,
        )
        expect(response.status).toBe(400)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          _tag: "InvalidRequestError",
          field: "kind",
        })
      }),
    )
    yield* Effect.forEach(Object.keys(referencePaths), (kind) =>
      Effect.forEach(
        ["", "../escape.md", "folder/../escape.md", "/absolute.md", "C:\\escape.md", "NUL.md", "wrong.txt"],
        (referencePath) =>
          Effect.gen(function* () {
            const response = yield* test.request(
              `/custom-composition/references?${new URLSearchParams({ kind, path: referencePath })}`,
            )
            expect(response.status).toBe(400)
            expect(yield* Effect.promise(() => response.json())).toMatchObject({
              _tag: "InvalidRequestError",
              field: "path",
            })
          }),
      ),
    )
    expect(yield* Effect.promise(() => Bun.file(target).text())).toBe(before)
  }),
)

it.live("borrows profile references by Location and distinguishes disabled composition from a missing source", () =>
  Effect.gen(function* () {
    const test = yield* setup(referenceFiles)
    const own = yield* references(test, "agent", referencePaths.agent)
    expect(own.map((profile) => profile.relativePath)).toEqual(["team/alpha.yaml", "zeta.yaml"])
    expect(yield* references(test, "agent", referencePaths.agent, `${test.project}/.`)).toEqual(own)
    const other = yield* references(test, "agent", referencePaths.agent, test.other)
    expect(other.map((profile) => profile.name)).toEqual([CustomProfile.Name.make("Other Location")])
    expect(other.map((profile) => profile.relativePath)).toEqual(["other.yaml"])
    expect(yield* references(test, "agent", referencePaths.agent)).toEqual(own)
    const denied = yield* test.request("/custom-composition/references?kind=unknown&path=../escape.md", {
      authenticated: false,
    })
    expect(denied.status).toBe(401)
    expect(
      yield* withEnv({ AIGCFROGE_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
        references(test, "agent", referencePaths.agent),
      ),
    ).toEqual(own)
    const composition = {
      source: "temporary",
      agents: candidate.profile.agents,
      bindings: candidate.profile.bindings,
      presentation: "native",
      requestedCapabilities: [],
    }
    yield* withEnv({ AIGCFROGE_CUSTOM_MODE: "false" }, () =>
      Effect.gen(function* () {
        const start = yield* test.request("/custom-composition/start", { body: { composition } })
        expect(start.status).toBe(400)
        expect(yield* Effect.promise(() => start.json())).toMatchObject({
          _tag: "UnsupportedProductModeError",
          mode: "custom",
        })

        const created = yield* test.request("/api/session", {
          body: { agent: "build", mode: "coding", location: { directory: test.project } },
        })
        expect(created.status).toBe(200)
        const source = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
          yield* Effect.promise(() => created.json()),
        ).data
        expect(source.agent).toBe(Agent.ID.make("build"))
        expect(source.mode).toBe("coding")
        expect(source.location.directory).toBe(AbsolutePath.make(test.project))
        expect(source.controller).toBeUndefined()
        const upgrade = yield* test.request("/custom-composition/upgrade", {
          body: { sessionID: source.id, composition },
        })
        expect(upgrade.status).toBe(400)
        expect(yield* Effect.promise(() => upgrade.json())).toMatchObject({
          _tag: "UnsupportedProductModeError",
          mode: "custom",
        })

        const missing = yield* test.request("/custom-composition/upgrade", {
          body: { sessionID: test.sessionID, composition },
        })
        expect(missing.status).toBe(404)
        expect(yield* Effect.promise(() => missing.json())).toEqual({
          _tag: "SessionNotFoundError",
          sessionID: test.sessionID,
          message: `Session not found: ${test.sessionID}`,
        })
      }),
    )
  }),
)
