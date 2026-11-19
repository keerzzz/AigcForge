import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Hash } from "@aigcfroge/util/hash"
import { Composition } from "@aigcfroge/schema/composition"
import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir, tmpdirScoped } from "./fixture/tmpdir"
import fs from "fs/promises"
import path from "path"
import { CustomProfile } from "../src/custom-profile"
import { decodeProfile, Description, Name, Profile, Revision } from "@aigcfroge/schema/custom-profile"
import { NodeFileSystem } from "@effect/platform-node"
import { AssetYaml } from "../src/util/asset-yaml"
import { testEffect } from "./lib/effect"

const fsLayer = FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer))
const it = testEffect(fsLayer)

function profileLayer(directory: string) {
  return CustomProfile.layer.pipe(
    Layer.provide(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
    Layer.provide(fsLayer),
    Layer.fresh,
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

const sampleYaml = `kind: custom-profile
name: Dev Profile
description: Developer profile for coding tasks
agents:
  - kind: agent
    relativePath: coder.md
    revision: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
bindings:
  agents/coder:
    prompts:
      - kind: prompt
        relativePath: system-prompt.md
        revision: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    skills:
      - kind: skill
        relativePath: git-tools/SKILL.md
        revision: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
presentation: native
requestedCapabilities:
  - workspace.read
`

describe("CustomProfile Registry", () => {
  it.live("cold reload preserves captured roots and raw bytes revisions while rejecting uncaptured roots", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const filesystem = yield* FSUtil.Service
      const legacy = path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "legacy.yaml")
      yield* filesystem.writeWithDirs(legacy, sampleYaml)
      yield* Effect.forEach(["build", "plan", "meta"] as const, (id) =>
        filesystem.writeWithDirs(
          path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, `${id}.yaml`),
          AssetYaml.stringify({
            kind: "custom-profile",
            name: `${id} Profile`,
            description: "Captured builtin root",
            root: { source: "builtin", id, revision: "d".repeat(64) },
            agents: [],
            bindings: {},
            presentation: "native",
            requestedCapabilities: [],
          }),
        ),
      )
      yield* filesystem.writeWithDirs(
        path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "uncaptured.yaml"),
        AssetYaml.stringify({
          kind: "custom-profile",
          name: "Uncaptured",
          description: "Missing builtin revision",
          root: { source: "builtin", id: "build" },
          agents: [],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        }),
      )
      const first = yield* Effect.gen(function* () {
        const registry = yield* CustomProfile.Service
        yield* registry.reload()
        const profiles = yield* registry.list()
        expect(profiles).toHaveLength(4)
        expect(yield* registry.getInvalid("uncaptured.yaml")).toEqual({
          relativePath: "uncaptured.yaml",
          errorTag: "bad_yaml",
        })
        yield* Effect.forEach(["build", "plan", "meta"] as const, (id) =>
          Effect.gen(function* () {
            const profile = yield* registry.getByPath(`${id}.yaml`)
            expect(profile.profile.root).toBeInstanceOf(Composition.BuiltinRoot)
            expect(profile.profile.root).toEqual(
              new Composition.BuiltinRoot({
                source: "builtin",
                id,
                revision: Composition.Revision.make("d".repeat(64)),
              }),
            )
            expect(profile.profile.agents).toEqual([])
            expect(profile.revision).toBe(
              Revision.make(
                Hash.sha256(
                  Buffer.from(
                    yield* filesystem.readFile(
                      path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, `${id}.yaml`),
                    ),
                  ),
                ),
              ),
            )
          }),
        )
        const old = yield* registry.getByPath("legacy.yaml")
        expect(old.profile.root).toBeUndefined()
        expect(old.revision).toBe(Revision.make(Hash.sha256(sampleYaml)))
        return profiles
      }).pipe(Effect.provide(profileLayer(directory.path)))
      const reloaded = yield* Effect.gen(function* () {
        const registry = yield* CustomProfile.Service
        return yield* registry.list()
      }).pipe(Effect.provide(profileLayer(directory.path)))
      expect(reloaded).toEqual(first)
      expect(new TextDecoder().decode(yield* filesystem.readFile(legacy))).toBe(sampleYaml)
    }),
  )

  test("empty location yields empty list", async () => {
    await withTmp(async (dir) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomProfile.Service
          yield* service.reload()
          const list = yield* service.list()
          expect(list).toHaveLength(0)
          const invalid = yield* service.listInvalid()
          expect(invalid).toHaveLength(0)
        }).pipe(Effect.provide(profileLayer(dir)), Effect.scoped),
      )
    })
  })

  test("loads valid custom profile YAML file", async () => {
    await withTmp(async (dir) => {
      const profilesDir = path.join(dir, ".aigcfroge", "custom-profiles")
      await fs.mkdir(profilesDir, { recursive: true })
      await fs.writeFile(path.join(profilesDir, "dev.yaml"), sampleYaml)

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomProfile.Service
          yield* service.reload()
          const list = yield* service.list()
          expect(list).toHaveLength(1)
          expect(list[0].name).toBe(Name.make("Dev Profile"))
          expect(list[0].description).toBe(Description.make("Developer profile for coding tasks"))
          expect(list[0].relativePath).toBe("dev.yaml")
          expect(list[0].profile.agents).toHaveLength(1)
          expect(list[0].profile.agents[0].relativePath).toBe("coder.md")
          expect(list[0].revision).toHaveLength(64)

          const byPath = yield* service.getByPath("dev.yaml")
          expect(byPath.name).toBe(Name.make("Dev Profile"))

          const byName = yield* service.findByName("Dev Profile")
          expect(byName).toBeDefined()
          expect(byName?.relativePath).toBe("dev.yaml")

          const notFound = yield* service.getByPath("nonexistent.yaml").pipe(Effect.flip)
          expect(notFound._tag).toBe("CustomProfile.NotFound")
        }).pipe(Effect.provide(profileLayer(dir)), Effect.scoped),
      )
    })
  })

  test("marks invalid YAML as parse_error and non-conforming schema as bad_yaml", async () => {
    await withTmp(async (dir) => {
      const profilesDir = path.join(dir, ".aigcfroge", "custom-profiles")
      await fs.mkdir(profilesDir, { recursive: true })
      await fs.writeFile(path.join(profilesDir, "corrupt.yaml"), ": bad : yaml :")
      const emptyAgentYaml = `kind: custom-profile
name: Empty Agent
description: Invalid because 0 agents
agents: []
bindings: {}
presentation: native
requestedCapabilities: []
`
      await fs.writeFile(path.join(profilesDir, "empty.yaml"), emptyAgentYaml)

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomProfile.Service
          yield* service.reload()
          const list = yield* service.list()
          expect(list).toHaveLength(0)

          const invalid = yield* service.listInvalid()
          expect(invalid).toHaveLength(2)
          const tags = new Map(invalid.map((i) => [i.relativePath, i.errorTag]))
          expect(tags.get("corrupt.yaml")).toBe("parse_error")
          expect(tags.get("empty.yaml")).toBe("bad_yaml")
        }).pipe(Effect.provide(profileLayer(dir)), Effect.scoped),
      )
    })
  })

  test("marks duplicate names as name_conflict and excludes both from active list", async () => {
    await withTmp(async (dir) => {
      const profilesDir = path.join(dir, ".aigcfroge", "custom-profiles")
      await fs.mkdir(profilesDir, { recursive: true })
      await fs.writeFile(path.join(profilesDir, "first.yaml"), sampleYaml)
      await fs.writeFile(path.join(profilesDir, "second.yaml"), sampleYaml)

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomProfile.Service
          yield* service.reload()
          const list = yield* service.list()
          expect(list).toHaveLength(0)

          const invalid = yield* service.listInvalid()
          expect(invalid).toHaveLength(2)
          expect(invalid.every((i) => i.errorTag === "name_conflict")).toBe(true)
        }).pipe(Effect.provide(profileLayer(dir)), Effect.scoped),
      )
    })
  })
})

const referenceTargets = [
  { kind: "agent", path: "shared/reviewer.md", owner: ".aigcfroge/agents" },
  { kind: "prompt", path: "shared/policy.md", owner: ".aigcfroge/prompts" },
  { kind: "skill", path: "git-tools/SKILL.md", owner: ".aigcfroge/skills" },
  { kind: "workflow", path: "flows/review.yaml", owner: ".aigcfroge/workflows" },
  { kind: "command", path: "shared/check.md", owner: ".aigcfroge/commands" },
  { kind: "mcp", path: "servers/probe.md", owner: ".aigcfroge/mcps" },
] as const

function referenceProfile(name: string, revision = "0".repeat(64)) {
  return {
    kind: "custom-profile",
    name,
    description: "Profile with all supported reference kinds",
    agents: [{ kind: "agent", relativePath: "shared/reviewer.md", revision }],
    workflow: { kind: "workflow", relativePath: "flows/review.yaml", revision },
    bindings: {
      orchestrator: {
        prompts: [{ kind: "prompt", relativePath: "shared/policy.md", revision }],
        skills: [{ kind: "skill", relativePath: "git-tools/SKILL.md", revision }],
        commands: [{ kind: "command", relativePath: "shared/check.md", revision }],
      },
    },
    mcpBindings: [
      {
        serverName: "probe",
        ref: { relativePath: "servers/probe.md", revision },
        transport: "remote",
        url: "https://example.test/mcp",
      },
    ],
    presentation: "native",
    requestedCapabilities: [],
  }
}

describe("CustomProfile references", () => {
  it.live("preserves byte revisions and root-only agent references after the asset is removed", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const filesystem = yield* FSUtil.Service
      const relativePath = "roots/release.md"
      const file = path.join(directory.path, ".aigcfroge/agents", relativePath)
      const bytes = "---\nkind: agent\nname: release-root\ndescription: Root\n---\nFrozen root.\n"
      yield* filesystem.writeWithDirs(file, bytes)
      const root = Schema.decodeUnknownSync(Composition.AssetRoot)({
        source: "asset",
        id: "release-root",
        kind: "agent",
        relativePath,
        revision: Hash.sha256(bytes),
      })
      const profile = decodeProfile({
        kind: "custom-profile",
        name: "Root only",
        description: "Root reference",
        root,
        agents: [],
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      })
      const yaml = AssetYaml.stringify(Schema.encodeSync(Profile)(profile))
      yield* filesystem.writeWithDirs(path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "root.yaml"), yaml)
      yield* Effect.gen(function* () {
        const registry = yield* CustomProfile.Service
        const saved = yield* registry.getByPath("root.yaml")
        expect(saved.profile.root).toEqual(root)
        expect(saved.revision).toBe(Revision.make(Hash.sha256(yaml)))
        expect(
          (yield* registry.references({ kind: "agent", path: relativePath })).map((entry) => entry.relativePath),
        ).toEqual(["root.yaml"])
        yield* filesystem.remove(file)
        yield* registry.reload()
        const retained = yield* registry.getByPath("root.yaml")
        expect(retained).toEqual(saved)
        expect(
          (yield* registry.references({ kind: "agent", path: " roots\\release.md " })).map(
            (entry) => entry.relativePath,
          ),
        ).toEqual(["root.yaml"])
        expect(yield* registry.references({ kind: "agent", path: "other.md" })).toEqual([])
      }).pipe(Effect.provide(profileLayer(directory.path)))
    }),
  )

  it.live("returns each Profile once in path order for all six kinds without requiring target assets", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const filesystem = yield* FSUtil.Service
      const duplicated = referenceProfile("Alpha", "a".repeat(64))
      duplicated.agents.push(duplicated.agents[0])
      duplicated.bindings.orchestrator.prompts.push(duplicated.bindings.orchestrator.prompts[0])
      duplicated.mcpBindings.push(duplicated.mcpBindings[0])
      yield* filesystem.writeWithDirs(
        path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "zeta.yaml"),
        AssetYaml.stringify(referenceProfile("Zeta", "b".repeat(64))),
      )
      yield* filesystem.writeWithDirs(
        path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "nested/alpha.yaml"),
        AssetYaml.stringify({
          ...duplicated,
          bindings: { ...duplicated.bindings, "agents/reviewer": duplicated.bindings.orchestrator },
        }),
      )

      yield* Effect.gen(function* () {
        const service = yield* CustomProfile.Service
        yield* Effect.forEach(referenceTargets, (target) =>
          Effect.gen(function* () {
            expect(yield* filesystem.exists(path.join(directory.path, target.owner, target.path))).toBe(false)
            const profiles = yield* service.references({ kind: target.kind, path: target.path })
            expect(profiles.map((profile) => profile.relativePath)).toEqual(["nested/alpha.yaml", "zeta.yaml"])
            expect(profiles.map((profile) => profile.name)).toEqual([Name.make("Alpha"), Name.make("Zeta")])
            expect(profiles.every((profile) => profile.revision.length === 64)).toBe(true)
            expect(profiles.every((profile) => !("profile" in profile) && !("rawYaml" in profile))).toBe(true)
          }),
        )
        expect(yield* service.references({ kind: "agent", path: "shared/policy.md" })).toEqual([])
        expect(yield* service.references({ kind: "prompt", path: "shared/reviewer.md" })).toEqual([])
        expect(yield* service.references({ kind: "mcp", path: "shared/check.md" })).toEqual([])
        yield* Effect.forEach(["project", "global"] as const, (scope) =>
          Effect.gen(function* () {
            const document = referenceProfile(`Selected ${scope}`)
            const targetFor = (kind: "prompt" | "skill" | "command") =>
              new AssetPlacement.Target({
                scope,
                root: AbsolutePath.make(path.join(directory.path, scope, kind)),
              })
            yield* filesystem.writeWithDirs(
              path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, `${scope}.yaml`),
              AssetYaml.stringify({
                ...document,
                bindings: {
                  orchestrator: {
                    prompts: document.bindings.orchestrator.prompts.map((ref) => ({
                      ...ref,
                      target: targetFor("prompt"),
                    })),
                    skills: document.bindings.orchestrator.skills.map((ref) => ({
                      ...ref,
                      target: targetFor("skill"),
                    })),
                    commands: document.bindings.orchestrator.commands.map((ref) => ({
                      ...ref,
                      target: targetFor("command"),
                    })),
                  },
                },
              }),
            )
            yield* service.reload()
            yield* Effect.forEach(
              referenceTargets.filter(
                (item) => item.kind === "prompt" || item.kind === "skill" || item.kind === "command",
              ),
              (item) =>
                Effect.gen(function* () {
                  const target = targetFor(item.kind)
                  expect(
                    (yield* service.references({ kind: item.kind, path: item.path, target })).map(
                      (profile) => profile.relativePath,
                    ),
                  ).toEqual([`${scope}.yaml`])
                  expect(
                    (yield* service.references({ kind: item.kind, path: item.path })).map(
                      (profile) => profile.relativePath,
                    ),
                  ).toEqual(["nested/alpha.yaml", "zeta.yaml"])
                  expect(
                    yield* service.references({
                      kind: item.kind,
                      path: item.path,
                      target: new AssetPlacement.Target({ ...target, root: AbsolutePath.make(`${target.root}-other`) }),
                    }),
                  ).toEqual([])
                  expect(yield* filesystem.exists(path.join(target.root, item.path))).toBe(false)
                }),
            )
            expect(
              yield* service
                .references({ kind: "agent", path: "shared/reviewer.md", target: targetFor("prompt") })
                .pipe(Effect.flip),
            ).toBeInstanceOf(CustomProfile.InvalidPathError)
          }),
        )
      }).pipe(Effect.provide(profileLayer(directory.path)))
    }),
  )

  it.live("normalizes both stored and query paths while keeping owner prefixes and basenames distinct", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const filesystem = yield* FSUtil.Service
      const aliases = referenceProfile("Aliases")
      aliases.agents[0].relativePath = " shared\\reviewer.md "
      aliases.workflow.relativePath = " flows\\review.yaml "
      aliases.bindings.orchestrator.prompts[0].relativePath = " shared\\policy.md "
      aliases.bindings.orchestrator.skills[0].relativePath = " git-tools\\SKILL.md "
      aliases.bindings.orchestrator.commands[0].relativePath = " shared\\check.md "
      aliases.mcpBindings[0].ref.relativePath = " servers\\probe.md "
      const prefixed = referenceProfile("Prefixed")
      prefixed.agents[0].relativePath = ".aigcfroge/agents/shared/reviewer.md"
      prefixed.workflow.relativePath = ".aigcfroge/workflows/flows/review.yaml"
      prefixed.bindings.orchestrator.prompts[0].relativePath = ".aigcfroge/prompts/shared/policy.md"
      prefixed.bindings.orchestrator.skills[0].relativePath = ".aigcfroge/skills/git-tools/SKILL.md"
      prefixed.bindings.orchestrator.commands[0].relativePath = ".aigcfroge/commands/shared/check.md"
      prefixed.mcpBindings[0].ref.relativePath = ".aigcfroge/mcps/servers/probe.md"
      yield* filesystem.writeWithDirs(
        path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "aliases.yaml"),
        AssetYaml.stringify(aliases),
      )
      yield* filesystem.writeWithDirs(
        path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "prefixed.yaml"),
        AssetYaml.stringify(prefixed),
      )

      yield* Effect.gen(function* () {
        const service = yield* CustomProfile.Service
        yield* Effect.forEach(referenceTargets, (target) =>
          Effect.gen(function* () {
            const canonical = yield* service.references({ kind: target.kind, path: target.path })
            const alias = yield* service.references({
              kind: target.kind,
              path: ` ${target.path.replaceAll("/", "\\")} `,
            })
            expect(canonical.map((profile) => profile.relativePath)).toEqual(["aliases.yaml"])
            expect(alias).toEqual(canonical)
            const prefixed = yield* service.references({ kind: target.kind, path: `${target.owner}/${target.path}` })
            expect(prefixed.map((profile) => profile.relativePath)).toEqual(["prefixed.yaml"])
            expect(yield* service.references({ kind: target.kind, path: path.posix.basename(target.path) })).toEqual([])
          }),
        )
      }).pipe(Effect.provide(profileLayer(directory.path)))
    }),
  )

  it.live("fails invalid query paths with a typed error for every asset kind", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const service = yield* CustomProfile.Service
        yield* Effect.forEach(referenceTargets, (target) =>
          Effect.forEach(
            [
              "",
              ` ../${target.path} `,
              `/${target.path}`,
              target.path.replace("/", "//"),
              target.path.replace("/", "/./"),
              target.kind === "workflow" ? "CON.yaml" : "CON.md",
              target.kind === "workflow" ? "wrong.md" : "wrong.yaml",
            ],
            (invalid) =>
              Effect.gen(function* () {
                const error = yield* service.references({ kind: target.kind, path: invalid }).pipe(Effect.flip)
                expect(error).toBeInstanceOf(CustomProfile.InvalidPathError)
                expect(error._tag).toBe("CustomProfile.InvalidPath")
                expect(error.kind).toBe(target.kind)
                expect(error.path).toBe(invalid)
                expect(error.reason.length).toBeGreaterThan(0)
              }),
          ),
        )
      }).pipe(Effect.provide(profileLayer(directory.path)))
    }),
  )

  it.live("ignores invalid stored references without removing a Profile or hiding its valid references", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const filesystem = yield* FSUtil.Service
      const document = referenceProfile("Mixed paths")
      document.agents.push({ ...document.agents[0], relativePath: "../shared/reviewer.md" })
      document.workflow.relativePath = "../flows/review.yaml"
      document.bindings.orchestrator.prompts.push({
        ...document.bindings.orchestrator.prompts[0],
        relativePath: "../shared/policy.md",
      })
      document.bindings.orchestrator.skills[0].relativePath = "../git-tools/SKILL.md"
      document.bindings.orchestrator.commands[0].relativePath = "../shared/check.md"
      document.mcpBindings[0].ref.relativePath = "../servers/probe.md"
      yield* filesystem.writeWithDirs(
        path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "mixed.yaml"),
        AssetYaml.stringify(document),
      )

      yield* Effect.gen(function* () {
        const service = yield* CustomProfile.Service
        expect(yield* service.listInvalid()).toEqual([])
        expect(yield* service.list()).toHaveLength(1)
        expect(
          (yield* service.references({ kind: "agent", path: "shared/reviewer.md" })).map((p) => p.relativePath),
        ).toEqual(["mixed.yaml"])
        expect(
          (yield* service.references({ kind: "prompt", path: "shared/policy.md" })).map((p) => p.relativePath),
        ).toEqual(["mixed.yaml"])
        yield* Effect.forEach(referenceTargets.slice(2), (target) =>
          Effect.gen(function* () {
            expect(yield* service.references({ kind: target.kind, path: target.path })).toEqual([])
          }),
        )
      }).pipe(Effect.provide(profileLayer(directory.path)))
    }),
  )

  it.live(
    "keeps references after target deletion and excludes invalid or name-conflicted Profiles across reloads",
    () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const filesystem = yield* FSUtil.Service
        yield* filesystem.writeWithDirs(
          path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "valid.yaml"),
          AssetYaml.stringify(referenceProfile("Valid")),
        )
        yield* filesystem.writeWithDirs(
          path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "conflict-a.yaml"),
          AssetYaml.stringify(referenceProfile("Duplicate")),
        )
        yield* filesystem.writeWithDirs(
          path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "conflict-b.yaml"),
          AssetYaml.stringify(referenceProfile("Duplicate")),
        )
        yield* filesystem.writeWithDirs(
          path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "invalid.yaml"),
          AssetYaml.stringify({ ...referenceProfile("Bad schema"), agents: [] }),
        )
        yield* filesystem.writeWithDirs(
          path.join(directory.path, ".aigcfroge/agents/shared/reviewer.md"),
          "target asset",
        )

        yield* Effect.gen(function* () {
          const service = yield* CustomProfile.Service
          expect(yield* service.listInvalid()).toHaveLength(3)
          const before = yield* service.references({ kind: "agent", path: "shared/reviewer.md" })
          expect(before.map((profile) => profile.relativePath)).toEqual(["valid.yaml"])
          yield* filesystem.remove(path.join(directory.path, ".aigcfroge/agents/shared/reviewer.md"))
          expect(yield* service.references({ kind: "agent", path: "shared/reviewer.md" })).toEqual(before)
          yield* service.reload()
          expect(yield* service.references({ kind: "agent", path: "shared/reviewer.md" })).toEqual(before)
        }).pipe(Effect.provide(profileLayer(directory.path)))

        yield* Effect.gen(function* () {
          const service = yield* CustomProfile.Service
          expect(
            (yield* service.references({ kind: "agent", path: "shared/reviewer.md" })).map((p) => p.relativePath),
          ).toEqual(["valid.yaml"])
          yield* filesystem.writeWithDirs(
            path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "a-added.yaml"),
            AssetYaml.stringify(referenceProfile("Added")),
          )
          yield* service.reload()
          expect(
            (yield* service.references({ kind: "agent", path: "shared/reviewer.md" })).map((p) => p.relativePath),
          ).toEqual(["a-added.yaml", "valid.yaml"])
          const changed = referenceProfile("Added")
          changed.agents[0].relativePath = "shared/other.md"
          yield* filesystem.writeWithDirs(
            path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "a-added.yaml"),
            AssetYaml.stringify(changed),
          )
          yield* service.reload()
          expect(
            (yield* service.references({ kind: "agent", path: "shared/reviewer.md" })).map((p) => p.relativePath),
          ).toEqual(["valid.yaml"])
          expect(
            (yield* service.references({ kind: "agent", path: "shared/other.md" })).map((p) => p.relativePath),
          ).toEqual(["a-added.yaml"])
          yield* filesystem.remove(path.join(directory.path, CustomProfile.CUSTOM_PROFILES_DIR, "valid.yaml"))
          yield* service.reload()
          expect(yield* service.references({ kind: "agent", path: "shared/reviewer.md" })).toEqual([])
          expect(
            (yield* service.references({ kind: "agent", path: "shared/other.md" })).map((p) => p.relativePath),
          ).toEqual(["a-added.yaml"])
        }).pipe(Effect.provide(profileLayer(directory.path)))
      }),
  )

  it.live("isolates identical reference paths between Locations", () =>
    Effect.gen(function* () {
      const first = yield* tmpdirScoped()
      const second = yield* tmpdirScoped()
      const filesystem = yield* FSUtil.Service
      yield* filesystem.writeWithDirs(
        path.join(first.path, CustomProfile.CUSTOM_PROFILES_DIR, "first.yaml"),
        AssetYaml.stringify(referenceProfile("First")),
      )
      yield* filesystem.writeWithDirs(
        path.join(second.path, CustomProfile.CUSTOM_PROFILES_DIR, "second.yaml"),
        AssetYaml.stringify(referenceProfile("Second")),
      )

      yield* Effect.gen(function* () {
        const service = yield* CustomProfile.Service
        expect(
          (yield* service.references({ kind: "agent", path: "shared/reviewer.md" })).map((p) => p.relativePath),
        ).toEqual(["first.yaml"])
        yield* Effect.gen(function* () {
          const secondService = yield* CustomProfile.Service
          expect(
            (yield* secondService.references({ kind: "agent", path: "shared/reviewer.md" })).map((p) => p.relativePath),
          ).toEqual(["second.yaml"])
        }).pipe(Effect.provide(profileLayer(second.path)))
        expect(
          (yield* service.references({ kind: "agent", path: "shared/reviewer.md" })).map((p) => p.relativePath),
        ).toEqual(["first.yaml"])
      }).pipe(Effect.provide(profileLayer(first.path)))
    }),
  )
})
