/**
 * End-to-end exerciser for the Effect HttpApi routes.
 *
 * The goal is not to be a normal unit test file. This is a route-coverage harness:
 * every public route should have a small scenario that proves the route decodes
 * requests, uses the right instance context, mutates storage when expected, and
 * returns the expected response shape.
 *
 * The script intentionally isolates `AIGCFROGE_DB` before importing modules that touch
 * storage. Scenarios may create/delete sessions and reset the database after each run,
 * so this must never point at a developer's real session database.
 *
 * DSL shape:
 * - `http.protected.get/post/...` starts a scenario for one OpenAPI route key.
 * - `.seeded(...)` creates typed per-scenario state using Effect helpers on `ctx`.
 * - `.at(...)` builds the request from that typed state.
 * - `.json(...)` / `.jsonEffect(...)` assert response shape and optional side effects.
 * - `.mutating()` tells the runner to reset isolated state after destructive routes.
 */
import { $ } from "bun"
import {
  AGENTS_DIR,
  COMMANDS_DIR,
  CUSTOM_PROFILES_DIR,
  MCPS_DIR,
  PLUGINS_DIR,
  PROMPTS_DIR,
  SKILLS_DIR,
  WORKFLOWS_DIR,
} from "@aigcfroge/core/constants"
import { Effect } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import fs from "fs/promises"
import { TestLLMServer } from "../../lib/llm-server"
import path from "path"
import { Hash } from "@aigcfroge/core/util/hash"
import { array, boolean, check, isRecord, message, object, stable } from "./assertions"
import { controlledPtyInput, http, route } from "./dsl"
import {
  cleanupExercisePaths,
  exerciseConfigDirectory,
  exerciseDataDirectory,
  exerciseDatabasePath,
  exerciseGlobalRoot,
} from "./environment"
import { color, printHeader, printResults } from "./report"
import { coverageResult, parseOptions, routeKey, routeKeys, selectedScenarios } from "./routing"
import { runScenario } from "./runner"
import { disposeApps } from "./backend"
import { runtime } from "./runtime"
import { type Scenario, type ScenarioContext } from "./types"

function cursor(input: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(input)).toString("base64url")
}

function data(validate: (value: any) => void) {
  return (body: any) => {
    object(body)
    validate(body.data)
  }
}

function locationData(validate: (value: any) => void) {
  return (body: any) => {
    object(body)
    object(body.location)
    object(body.location.project)
    validate(body.data)
  }
}

type AssetFixture = {
  readonly kind: string
  readonly name: string
  readonly directory: string
  readonly relativePath: string
  readonly content: string
  readonly candidate: Readonly<Record<string, unknown>>
}

const assetFixtures: readonly AssetFixture[] = [
  {
    kind: "prompt",
    name: "httpapi-prompt",
    directory: PROMPTS_DIR,
    relativePath: "httpapi-prompt.md",
    content: "---\nkind: prompt\nname: httpapi-prompt\ndescription: exerciser\n---\nPrompt body",
    candidate: {
      name: "httpapi-prompt",
      description: "exerciser",
      template: "Prompt body",
      relativePath: "",
    },
  },
  {
    kind: "skill",
    name: "httpapi-skill",
    directory: SKILLS_DIR,
    relativePath: "httpapi-skill.md",
    content:
      "---\nname: httpapi-skill\ndescription: exerciser\nslash: true\ntriggers:\n  - review\ntags:\n  - test\n---\nSkill body",
    candidate: {
      name: "httpapi-skill",
      description: "exerciser",
      slash: true,
      content: "Skill body",
      triggers: ["review"],
      tags: ["test"],
      relativePath: "",
    },
  },
  {
    kind: "mcp",
    name: "httpapi-mcp",
    directory: MCPS_DIR,
    relativePath: "httpapi-mcp.md",
    content: '---\nkind: mcp\nname: httpapi-mcp\ndescription: exerciser\ncommand: bun\nargs: ["--version"]\n---\n{}',
    candidate: {
      name: "httpapi-mcp",
      description: "exerciser",
      command: "bun",
      args: ["--version"],
      env: {},
      configJson: "{}",
      relativePath: "",
    },
  },
  {
    kind: "command",
    name: "httpapi-command",
    directory: COMMANDS_DIR,
    relativePath: "httpapi-command.md",
    content:
      "---\nkind: command\nname: httpapi-command\ndescription: exerciser\ninvocation: /httpapi-command\n---\nprintf command",
    candidate: {
      name: "httpapi-command",
      description: "exerciser",
      invocation: "/httpapi-command",
      source: "printf command",
      relativePath: "",
    },
  },
  {
    kind: "agent",
    name: "httpapi-agent",
    directory: AGENTS_DIR,
    relativePath: "httpapi-agent.md",
    content: '---\nkind: agent\nname: httpapi-agent\ndescription: exerciser\nconfig: "{}"\n---\nAgent instructions',
    candidate: {
      name: "httpapi-agent",
      description: "exerciser",
      config: "{}",
      source: "Agent instructions",
      relativePath: "",
    },
  },
  {
    kind: "workflow",
    name: "httpapi-workflow",
    directory: WORKFLOWS_DIR,
    relativePath: "httpapi-workflow.yaml",
    content:
      "kind: workflow\nname: httpapi-workflow\ndescription: exerciser\nversion: 1.0.0\ntriggers: []\nsteps:\n  - id: review\n    name: Review\n    agent: builtin\n    input: {}",
    candidate: {
      name: "httpapi-workflow",
      description: "exerciser",
      content:
        "kind: workflow\nname: httpapi-workflow\ndescription: exerciser\nversion: 1.0.0\ntriggers: []\nsteps:\n  - id: review\n    name: Review\n    agent: builtin\n    input: {}",
    },
  },
  {
    kind: "plugin",
    name: "httpapi-plugin",
    directory: PLUGINS_DIR,
    relativePath: "httpapi-plugin.plugin.yaml",
    content: "kind: plugin\nname: httpapi-plugin\ndescription: exerciser\nversion: 1.0.0\nhooks: []",
    candidate: {
      name: "httpapi-plugin",
      description: "exerciser",
      content: "kind: plugin\nname: httpapi-plugin\ndescription: exerciser\nversion: 1.0.0\nhooks: []",
    },
  },
]

function seedAsset(ctx: ScenarioContext, fixture: AssetFixture) {
  if (!ctx.directory) return Effect.die(new Error(`${fixture.kind} asset scenario needs a project directory`))
  const target = path.join(ctx.directory, fixture.directory, fixture.relativePath)
  return Effect.promise(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await Bun.write(target, fixture.content)
    return target
  })
}

function assetScenarios(fixture: AssetFixture): Scenario[] {
  const root = `/${fixture.kind}-asset`
  const sessionRoot = `/session/{sessionID}${root}`
  return [
    http.protected
      .get(root, `${fixture.kind}-asset.list`)
      .seeded((ctx) => seedAsset(ctx, fixture))
      .json(200, (body) => {
        object(body)
        array(body.assets)
        check(
          body.assets.some((asset) => isRecord(asset) && asset.kind === fixture.kind && asset.name === fixture.name),
          `${fixture.kind} asset list should include the seeded asset`,
        )
        array(body.invalid)
      }),
    http.protected
      .get(`${root}/content`, `${fixture.kind}-asset.content`)
      .seeded((ctx) => seedAsset(ctx, fixture))
      .at((ctx) => ({
        path: `${root}/content?${new URLSearchParams({ path: fixture.relativePath })}`,
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        check(body.kind === fixture.kind, `${fixture.kind} asset content should preserve kind`)
        check(body.name === fixture.name, `${fixture.kind} asset content should preserve name`)
        check(body.relativePath === fixture.relativePath, `${fixture.kind} asset content should preserve path`)
      }),
    http.protected
      .post(`${sessionRoot}/apply`, `${fixture.kind}-asset.apply`)
      .mutating()
      .seeded((ctx) => ctx.session({ title: `${fixture.kind} asset apply` }))
      .at((ctx) => ({
        path: route(`${sessionRoot}/apply`, { sessionID: ctx.state.id }),
        headers: ctx.headers(),
        body: { candidate: fixture.candidate, overwrite: false },
      }))
      .jsonEffect(
        200,
        (body, ctx) =>
          Effect.gen(function* () {
            object(body)
            check(body.kind === fixture.kind, `${fixture.kind} asset apply should preserve kind`)
            check(body.name === fixture.name, `${fixture.kind} asset apply should preserve name`)
            if (typeof body.relativePath !== "string") {
              throw new Error(`${fixture.kind} asset apply should return a path`)
            }
            if (!ctx.directory) throw new Error(`${fixture.kind} asset apply needs a project directory`)
            const directory = ctx.directory
            const relativePath = body.relativePath
            const exists = yield* Effect.promise(() =>
              Bun.file(path.join(directory, fixture.directory, relativePath)).exists(),
            )
            check(exists, `${fixture.kind} asset apply should persist the file`)
          }),
        "status",
      ),
    http.protected
      .post(`${sessionRoot}/delete`, `${fixture.kind}-asset.delete`)
      .mutating()
      .seeded((ctx) =>
        Effect.gen(function* () {
          const target = yield* seedAsset(ctx, fixture)
          const session = yield* ctx.session({ title: `${fixture.kind} asset delete` })
          return { session, target }
        }),
      )
      .at((ctx) => ({
        path: route(`${sessionRoot}/delete`, { sessionID: ctx.state.session.id }),
        headers: ctx.headers(),
        body: { relativePath: fixture.relativePath },
      }))
      .status(
        200,
        (ctx) =>
          Effect.gen(function* () {
            const exists = yield* Effect.promise(() => Bun.file(ctx.state.target).exists())
            check(!exists, `${fixture.kind} asset delete should remove the file`)
          }),
        "status",
      ),
  ]
}

function seedCustomProfile(ctx: ScenarioContext) {
  if (!ctx.directory) return Effect.die(new Error("custom-profile scenario needs a project directory"))
  const target = path.join(ctx.directory, CUSTOM_PROFILES_DIR, "httpapi-profile.yaml")
  const content = `kind: custom-profile
name: httpapi-profile
description: exerciser profile
agents:
  - kind: agent
    relativePath: httpapi-agent.md
    revision: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
bindings: {}
presentation: native
requestedCapabilities: []
`
  return Effect.promise(async () => {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await Bun.write(target, content)
    return target
  })
}

function customProfileScenarios(): Scenario[] {
  const root = "/custom-profile"
  const sessionRoot = "/session/{sessionID}/custom-profile"
  return [
    http.protected
      .get(root, "custom-profile.list")
      .seeded(seedCustomProfile)
      .json(200, (body) => {
        object(body)
        array(body.assets)
        check(
          body.assets.some((p: any) => isRecord(p) && p.name === "httpapi-profile"),
          "custom profile list should include seeded profile",
        )
        array(body.invalid)
      }),
    http.protected
      .get(`${root}/content`, "custom-profile.content")
      .seeded(seedCustomProfile)
      .at((ctx) => ({
        path: `${root}/content?${new URLSearchParams({ path: "httpapi-profile.yaml" })}`,
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        check(body.name === "httpapi-profile", "custom profile content should preserve name")
        check(typeof body.rawYaml === "string", "custom profile content should return rawYaml")
      }),
    http.protected
      .post(`${sessionRoot}/apply`, "custom-profile.apply")
      .mutating()
      .seeded((ctx) => ctx.session({ title: "custom profile apply" }))
      .at((ctx) => ({
        path: route(`${sessionRoot}/apply`, { sessionID: ctx.state.id }),
        headers: ctx.headers(),
        body: {
          candidate: {
            name: "httpapi-profile-apply",
            description: "exerciser profile apply",
            relativePath: "httpapi-profile-apply.yaml",
            profile: {
              kind: "custom-profile",
              name: "httpapi-profile-apply",
              description: "exerciser profile apply",
              agents: [
                {
                  kind: "agent",
                  relativePath: "httpapi-agent.md",
                  revision: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                },
              ],
              bindings: {},
              presentation: "native",
              requestedCapabilities: [],
            },
          },
          overwrite: false,
        },
      }))
      .jsonEffect(
        200,
        (body, ctx) =>
          Effect.gen(function* () {
            object(body)
            check(body.name === "httpapi-profile-apply", "custom profile apply should return profile name")
            if (!ctx.directory) throw new Error("custom profile apply needs a project directory")
            const exists = yield* Effect.promise(() =>
              Bun.file(path.join(ctx.directory!, CUSTOM_PROFILES_DIR, "httpapi-profile-apply.yaml")).exists(),
            )
            check(exists, "custom profile apply should persist the file")
          }),
        "status",
      ),
    http.protected
      .post(`${sessionRoot}/delete`, "custom-profile.delete")
      .mutating()
      .seeded((ctx) =>
        Effect.gen(function* () {
          const target = yield* seedCustomProfile(ctx)
          const session = yield* ctx.session({ title: "custom profile delete" })
          return { session, target }
        }),
      )
      .at((ctx) => ({
        path: route(`${sessionRoot}/delete`, { sessionID: ctx.state.session.id }),
        headers: ctx.headers(),
        body: { relativePath: "httpapi-profile.yaml" },
      }))
      .status(
        200,
        (ctx) =>
          Effect.gen(function* () {
            const exists = yield* Effect.promise(() => Bun.file(ctx.state.target).exists())
            check(!exists, "custom profile delete should remove the file")
          }),
        "status",
      ),
  ]
}

function customCompositionScenarios(): Scenario[] {
  const root = "/custom-composition"
  const agentFixture = assetFixtures.find((f) => f.kind === "agent")!
  const capabilitiesHeaders = { "x-aigcfroge-capabilities": "product-mode-custom-v1" }
  return [
    http.protected
      .post(`${root}/plan`, "custom-composition.plan")
      .seeded((ctx) =>
        Effect.gen(function* () {
          yield* seedAsset(ctx, assetFixtures.find((f) => f.kind === "agent")!)
          yield* seedCustomProfile(ctx)
        }),
      )
      .at((ctx) => ({
        path: `${root}/plan`,
        headers: ctx.headers(),
        body: {
          source: "temporary",
          agents: [],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        },
      }))
      .json(200, (body) => {
        object(body)
        boolean(body.valid)
        array(body.diagnostics)
      }),
    http.protected
      .post(`${root}/start`, "custom-composition.start")
      .seeded((ctx) =>
        Effect.gen(function* () {
          yield* seedAsset(ctx, agentFixture)
          const revision = yield* Effect.promise(() => Hash.sha256(Buffer.from(agentFixture.content)))
          return { revision }
        }),
      )
      .at((ctx) => ({
        path: `${root}/start`,
        headers: { ...ctx.headers(), ...capabilitiesHeaders },
        body: {
          composition: {
            source: "temporary",
            agents: [{ kind: "agent", relativePath: agentFixture.relativePath, revision: ctx.state.revision }],
            bindings: {},
            presentation: "native",
            requestedCapabilities: [],
          },
          title: "httpapi custom start",
        },
      }))
      .json(200, (body) => {
        object(body)
        check(isRecord(body.session) && body.session.mode === "custom", "custom start should create a custom session")
        check(isRecord(body.snapshot) && typeof body.snapshot.digest === "string", "custom start should return a snapshot")
      }),
    http.protected
      .post(`${root}/upgrade`, "custom-composition.upgrade")
      .seeded((ctx) =>
        Effect.gen(function* () {
          yield* seedAsset(ctx, agentFixture)
          const revision = yield* Effect.promise(() => Hash.sha256(Buffer.from(agentFixture.content)))
          const custom = yield* ctx.customSession({ title: "httpapi upgrade source" })
          return { sessionID: custom.session.id, revision }
        }),
      )
      .at((ctx) => ({
        path: `${root}/upgrade`,
        headers: { ...ctx.headers(), ...capabilitiesHeaders },
        body: {
          sessionID: ctx.state.sessionID,
          composition: {
            source: "temporary",
            agents: [{ kind: "agent", relativePath: agentFixture.relativePath, revision: ctx.state.revision }],
            bindings: {},
            presentation: "native",
            requestedCapabilities: [],
          },
          title: "httpapi upgraded session",
        },
      }))
      .json(200, (body, ctx) => {
        object(body)
        check(isRecord(body.session) && body.session.mode === "custom", "custom upgrade should create a custom session")
        check(isRecord(body.snapshot) && typeof body.snapshot.digest === "string", "custom upgrade should return a snapshot")
        check(isRecord(body.session) && body.session.id !== ctx.state.sessionID, "custom upgrade should not reuse the source session id")
      }),
    http.protected
      .get(`${root}/health`, "custom-composition.health")
      .seeded((ctx) =>
        Effect.gen(function* () {
          yield* seedAsset(ctx, assetFixtures.find((f) => f.kind === "agent")!)
          yield* seedCustomProfile(ctx)
        }),
      )
      .at((ctx) => ({
        path: `${root}/health?${new URLSearchParams({ path: "httpapi-profile.yaml" })}`,
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        check(typeof body.status === "string", "custom composition health should report status")
        array(body.staleRevisions)
        array(body.diagnostics)
      }),
    http.protected
      .get(`${root}/references`, "custom-composition.references")
      .seeded(seedCustomProfile)
      .at((ctx) => ({
        path: `${root}/references?${new URLSearchParams({ kind: "agent", path: "httpapi-agent.md" })}`,
        headers: ctx.headers(),
      }))
      .json(200, (body) => {
        object(body)
        array(body.profiles)
      }),
  ]
}

const scenarios: Scenario[] = [
  http.protected
    .get("/global/health", "global.health")
    .global()
    .json(200, (body) => {
      object(body)
      check(body.healthy === true, "server should report healthy")
    }),
  http.protected
    .get("/global/event", "global.event")
    .global()
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "global event should be an SSE stream")
          check(result.text.includes("server.connected"), "global event should emit initial connection event")
        }),
      "status",
    ),
  http.protected.get("/global/config", "global.config.get").global().json(),
  http.protected
    .patch("/global/config", "global.config.update")
    .global()
    .seeded(() =>
      Effect.promise(() =>
        Bun.write(
          path.join(exerciseConfigDirectory, "aigcfroge.jsonc"),
          JSON.stringify({ username: "httpapi-global" }, null, 2),
        ),
      ),
    )
    .at(() => ({ path: "/global/config", body: { username: "httpapi-global" } }))
    .jsonEffect(
      200,
      (body) =>
        Effect.gen(function* () {
          object(body)
          check(body.username === "httpapi-global", "global config update should return patched config")
          const text = yield* Effect.promise(() =>
            Bun.file(path.join(exerciseConfigDirectory, "aigcfroge.jsonc")).text(),
          )
          check(text.includes('"username": "httpapi-global"'), "global config update should write isolated config file")
        }),
      "status",
    ),
  http.protected
    .post("/global/dispose", "global.dispose")
    .global()
    .mutating()
    .json(
      200,
      (body) => {
        check(body === true, "global dispose should return true")
      },
      "status",
    ),
  http.protected.get("/path", "path.get").json(200, (body, ctx) => {
    object(body)
    check(body.directory === ctx.directory, "directory should resolve from x-aigcfroge-directory")
    check(body.worktree === ctx.directory, "worktree should resolve from x-aigcfroge-directory")
  }),
  http.protected.get("/vcs", "vcs.get").json(),
  http.protected.get("/vcs/status", "vcs.status").json(200, array),
  http.protected
    .get("/vcs/diff", "vcs.diff")
    .at((ctx) => ({ path: "/vcs/diff?mode=git", headers: ctx.headers() }))
    .json(200, array),
  http.protected.get("/vcs/diff/raw", "vcs.diff.raw").status(
    200,
    (_ctx, result) =>
      Effect.sync(() => {
        check(typeof result.text === "string", "raw VCS diff should return text")
      }),
    "status",
  ),
  http.protected
    .post("/vcs/apply", "vcs.apply")
    .inProject({ git: false })
    .at((ctx) => ({ path: "/vcs/apply", headers: ctx.headers(), body: { patch: "" } }))
    .status(400, undefined, "status"),
  http.protected
    .get("/vcs/log", "vcs.log")
    .at((ctx) => ({ path: "/vcs/log", headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length >= 1, "vcs log should include the seeded root commit")
      const first = body[0]
      object(first)
      check(typeof first.hash === "string", "commit entry should expose a hash")
      check(typeof first.message === "string", "commit entry should expose a message")
      check(typeof first.author === "string", "commit entry should expose an author")
      check(typeof first.date === "string", "commit entry should expose a date")
    }),
  http.protected
    .post("/vcs/stage", "vcs.stage")
    .mutating()
    .seeded((ctx) => ctx.file("stage-me.txt", "stage content\n"))
    .at((ctx) => ({ path: "/vcs/stage", headers: ctx.headers(), body: { files: ["stage-me.txt"] } }))
    .status(
      204,
      (ctx) =>
        Effect.gen(function* () {
          const dir = ctx.directory
          if (!dir) throw new Error("vcs stage needs a project directory")
          const status = yield* Effect.promise(() => $`git -C ${dir} status --porcelain`.text())
          check(status.includes("A  stage-me.txt"), "vcs stage should stage the seeded file")
        }),
      "status",
    ),
  http.protected
    .post("/vcs/unstage", "vcs.unstage")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        yield* ctx.file("unstage-me.txt", "unstage content\n")
        const dir = ctx.directory
        if (!dir) throw new Error("vcs unstage needs a project directory")
        yield* Effect.promise(async () => {
          await $`git -C ${dir} add unstage-me.txt`.quiet()
        })
      }),
    )
    .at((ctx) => ({ path: "/vcs/unstage", headers: ctx.headers(), body: { files: ["unstage-me.txt"] } }))
    .status(
      204,
      (ctx) =>
        Effect.gen(function* () {
          const dir = ctx.directory
          if (!dir) throw new Error("vcs unstage needs a project directory")
          const status = yield* Effect.promise(() => $`git -C ${dir} status --porcelain`.text())
          check(
            status.includes("?? unstage-me.txt") && !status.includes("A  unstage-me.txt"),
            "vcs unstage should remove the file from the index",
          )
        }),
      "status",
    ),
  http.protected
    .post("/vcs/commit", "vcs.commit")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        yield* ctx.file("commit-me.txt", "commit content\n")
        const dir = ctx.directory
        if (!dir) throw new Error("vcs commit needs a project directory")
        yield* Effect.promise(async () => {
          await $`git -C ${dir} add commit-me.txt`.quiet()
        })
      }),
    )
    .at((ctx) => ({ path: "/vcs/commit", headers: ctx.headers(), body: { message: "httpapi commit" } }))
    .status(
      204,
      (ctx) =>
        Effect.gen(function* () {
          const dir = ctx.directory
          if (!dir) throw new Error("vcs commit needs a project directory")
          const subject = yield* Effect.promise(() => $`git -C ${dir} log -1 --format=%s`.text())
          check(subject.trim() === "httpapi commit", "vcs commit should record the staged message")
        }),
      "status",
    ),
  http.protected.get("/command", "command.list").json(200, array, "status"),
  http.protected.get("/agent", "app.agents").json(200, array, "status"),
  http.protected.get("/skill", "app.skills").json(200, array, "status"),
  ...assetFixtures.flatMap(assetScenarios),
  ...customProfileScenarios(),
  ...customCompositionScenarios(),
  // Assistant: knowledge base (kb_note/kb_link). Routes are project-scoped and
  // back onto KBService through the location layer.
  http.protected
    .get("/kb", "kb.list")
    .seeded((ctx) => ctx.kbNote({ title: "Meeting", content: "Q3 goals", scope: "project", tags: ["work"] }))
    .at((ctx) => ({ path: "/kb", headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "kb list should return the seeded note")
      const note = body[0]
      object(note)
      check(note.title === "Meeting", "kb note should round-trip its title")
    }),
  http.protected
    .post("/kb", "kb.create")
    .mutating()
    .at((ctx) => ({
      path: "/kb",
      headers: ctx.headers(),
      body: { title: "New note", content: "fresh content", scope: "project", tags: ["work"] },
    }))
    .json(200, (body) => {
      object(body)
      check(body.title === "New note", "kb create should return the created note")
      check(typeof body.id === "string", "kb create should return a note id")
      check(body.scope === "project", "kb create should echo the scope")
    }),
  http.protected
    .get("/kb/{id}", "kb.get")
    .seeded((ctx) => ctx.kbNote({ title: "Single", content: "one", scope: "project" }).pipe(Effect.map((n) => n.id)))
    .at((ctx) => ({ path: route("/kb/{id}", { id: String(ctx.state) }), headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(body.title === "Single", "kb get should return the seeded note")
    }),
  http.protected
    .post("/kb/{id}", "kb.update")
    .mutating()
    .seeded((ctx) => ctx.kbNote({ title: "Editable", content: "v1", scope: "project" }).pipe(Effect.map((n) => n.id)))
    .at((ctx) => ({
      path: route("/kb/{id}", { id: String(ctx.state) }),
      headers: ctx.headers(),
      body: { content: "v2" },
    }))
    .json(200, (body) => {
      object(body)
      check(body.content === "v2", "kb update should persist the new content")
    }),
  http.protected
    .post("/kb/{id}/remove", "kb.remove")
    .mutating()
    .seeded((ctx) => ctx.kbNote({ title: "Doomed", content: "gone", scope: "project" }).pipe(Effect.map((n) => n.id)))
    .at((ctx) => ({ path: route("/kb/{id}/remove", { id: String(ctx.state) }), headers: ctx.headers(), body: {} }))
    .status(200, undefined, "status"),
  http.protected
    .get("/kb/dangling", "kb.dangling")
    .seeded((ctx) => ctx.kbNote({ title: "Linker", content: "see [[Missing]]", scope: "project" }))
    .at((ctx) => ({ path: "/kb/dangling", headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "kb dangling should report the unresolved wikilink")
      const edge = body[0]
      object(edge)
      check(edge.targetTitle === "Missing", "dangling edge should name the missing target")
    }),
  http.protected
    .get("/kb/search", "kb.search")
    .seeded((ctx) => ctx.kbNote({ title: "Meeting", content: "quarterly goals", scope: "project" }))
    .at((ctx) => ({ path: "/kb/search?query=quarterly", headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "kb search should find the seeded note")
      const note = body[0]
      object(note)
      check(note.title === "Meeting", "kb search should return the matching note")
    }),
  // kb.backlinks: single-sided edge storage + index derivation — the note that
  // links TO the target is listed as a backlink (批次 3 G4 契约)。
  http.protected
    .get("/kb/{id}/backlinks", "kb.backlinks")
    .seeded((ctx) =>
      ctx
        .kbNote({ title: "Cited", content: "references [[Original]]", scope: "project" })
        .pipe(Effect.zip(ctx.kbNote({ title: "Original", content: "the source", scope: "project" }))),
    )
    .at((ctx) => ({
      path: route("/kb/{id}/backlinks", { id: (ctx.state as [unknown, { id: string }])[1].id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "kb backlinks should list the note referencing the target")
      const note = body[0]
      object(note)
      check(note.title === "Cited", "kb backlinks should return the referencing note")
    }),
  // Assistant: personal memory (confirm-first propose flow).
  http.protected
    .get("/memory", "memory.list")
    .seeded((ctx) =>
      ctx.memoryPropose({ content: "user prefers concise", source: "derived", trustLevel: "medium", sensitivityLevel: "low" }),
    )
    .at((ctx) => ({ path: "/memory", headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "memory list should include the proposed entry")
      const entry = body[0]
      object(entry)
      check(entry.content === "user prefers concise", "memory entry should round-trip content")
    }),
  http.protected
    .get("/memory/pending", "memory.pending")
    .seeded((ctx) =>
      ctx.memoryPropose({ content: "pending entry", source: "derived", trustLevel: "medium", sensitivityLevel: "low" }),
    )
    .at((ctx) => ({ path: "/memory/pending", headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "memory pending should include the proposed entry")
      const entry = body[0]
      object(entry)
      check(entry.status === "pending", "proposed memory should be pending")
    }),
  http.protected
    .post("/memory/{id}/confirm", "memory.confirm")
    .mutating()
    .seeded((ctx) =>
      ctx
        .memoryPropose({ content: "confirm me", source: "explicit", trustLevel: "high", sensitivityLevel: "low" })
        .pipe(Effect.map((m) => m.id)),
    )
    .at((ctx) => ({
      path: route("/memory/{id}/confirm", { id: String(ctx.state) }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(200, (body) => {
      object(body)
      check(body.status === "confirmed", "confirm should flip the entry to confirmed")
    }),
  http.protected
    .post("/memory/{id}/reject", "memory.reject")
    .mutating()
    .seeded((ctx) =>
      ctx
        .memoryPropose({ content: "reject me", source: "derived", trustLevel: "medium", sensitivityLevel: "low" })
        .pipe(Effect.map((m) => m.id)),
    )
    .at((ctx) => ({
      path: route("/memory/{id}/reject", { id: String(ctx.state) }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(200, (body) => {
      object(body)
      check(body.status === "rejected", "reject should flip the entry to rejected")
    }),
  http.protected
    .post("/memory/{id}", "memory.edit")
    .mutating()
    .seeded((ctx) =>
      ctx
        .memoryPropose({ content: "edit me", source: "derived", trustLevel: "medium", sensitivityLevel: "low" })
        .pipe(Effect.map((m) => m.id)),
    )
    .at((ctx) => ({
      path: route("/memory/{id}", { id: String(ctx.state) }),
      headers: ctx.headers(),
      body: { content: "edited" },
    }))
    .json(200, (body) => {
      object(body)
      check(body.content === "edited", "memory edit should persist the new content")
    }),
  http.protected
    .post("/memory/{id}/remove", "memory.remove")
    .mutating()
    .seeded((ctx) =>
      ctx
        .memoryPropose({ content: "delete me", source: "explicit", trustLevel: "high", sensitivityLevel: "low" })
        .pipe(Effect.flatMap((m) => ctx.memoryConfirm(m.id).pipe(Effect.map(() => m.id)))),
    )
    .at((ctx) => ({
      path: route("/memory/{id}/remove", { id: String(ctx.state) }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(200, (body) => {
      object(body)
      check(body.status === "deleted", "memory remove should mark the entry deleted")
    }),
  // Assistant: schedules + deliveries.
  http.protected
    .get("/schedule/pending", "schedule.pending")
    .seeded((ctx) =>
      ctx.session().pipe(
        Effect.flatMap((s) =>
          ctx.scheduleCreate({
            sessionID: s.id,
            kind: "reminder",
            content: "standup",
            dueAt: Date.now() + 60_000,
            timezone: "Asia/Shanghai",
            deliveryKey: "reminder:ex:1",
          }),
        ),
      ),
    )
    .at((ctx) => ({ path: "/schedule/pending", headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "schedule pending should include the seeded reminder")
      const item = body[0]
      object(item)
      check(item.status === "pending", "seeded schedule should be pending")
    }),
  http.protected
    .get("/schedule/{sessionID}", "schedule.list")
    .seeded((ctx) =>
      ctx.session().pipe(
        Effect.flatMap((s) =>
          ctx
            .scheduleCreate({
              sessionID: s.id,
              kind: "reminder",
              content: "mail",
              dueAt: Date.now() + 60_000,
              timezone: "Asia/Shanghai",
              deliveryKey: "reminder:ex:2",
            })
            .pipe(Effect.as(s.id)),
        ),
      ),
    )
    .at((ctx) => ({
      path: route("/schedule/{sessionID}", { sessionID: String(ctx.state) }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "schedule list should include the session's reminder")
      const item = body[0]
      object(item)
      check(item.content === "mail", "schedule list should round-trip the reminder content")
    }),
  http.protected
    .post("/schedule/{id}/cancel", "schedule.cancel")
    .mutating()
    .seeded((ctx) =>
      ctx.session().pipe(
        Effect.flatMap((s) =>
          ctx
            .scheduleCreate({
              sessionID: s.id,
              kind: "reminder",
              content: "cancel me",
              dueAt: Date.now() + 60_000,
              timezone: "Asia/Shanghai",
              deliveryKey: "reminder:ex:3",
            })
            .pipe(Effect.map((sched) => sched.id)),
        ),
      ),
    )
    .at((ctx) => ({
      path: route("/schedule/{id}/cancel", { id: String(ctx.state) }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(200, (body) => {
      object(body)
      check(body.status === "cancelled", "cancel should flip the reminder to cancelled")
    }),
  http.protected
    .get("/delivery/recent", "schedule.delivery.recent")
    .seeded((ctx) =>
      ctx.session().pipe(
        Effect.flatMap((s) =>
          ctx
            .scheduleCreate({
              sessionID: s.id,
              kind: "reminder",
              content: "inbox me",
              dueAt: Date.now() + 60_000,
              timezone: "Asia/Shanghai",
              deliveryKey: "reminder:ex:4",
            })
            .pipe(
              Effect.flatMap((sched) =>
                ctx.deliveryDeliver({
                  deliveryKey: "reminder:ex:4",
                  scheduleID: sched.id,
                  sessionID: s.id,
                  kind: "reminder",
                  content: "inbox me",
                  deliveredAt: Date.now(),
                  caughtUp: false,
                }),
              ),
            ),
        ),
      ),
    )
    .at((ctx) => ({ path: "/delivery/recent", headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "delivery recent should include the delivered reminder")
      const item = body[0]
      object(item)
      check(item.content === "inbox me", "delivery should round-trip content")
    }),
  http.protected
    .get("/delivery/{sessionID}", "schedule.delivery.inbox")
    .seeded((ctx) =>
      ctx.session().pipe(
        Effect.flatMap((s) =>
          ctx
            .scheduleCreate({
              sessionID: s.id,
              kind: "reminder",
              content: "inbox me",
              dueAt: Date.now() + 60_000,
              timezone: "Asia/Shanghai",
              deliveryKey: "reminder:ex:5",
            })
            .pipe(
              Effect.flatMap((sched) =>
                ctx.deliveryDeliver({
                  deliveryKey: "reminder:ex:5",
                  scheduleID: sched.id,
                  sessionID: s.id,
                  kind: "reminder",
                  content: "inbox me",
                  deliveredAt: Date.now(),
                  caughtUp: false,
                }),
              ),
              Effect.as(s.id),
            ),
        ),
      ),
    )
    .at((ctx) => ({
      path: route("/delivery/{sessionID}", { sessionID: String(ctx.state) }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      array(body)
      check(body.length === 1, "delivery inbox should include the delivered reminder")
    }),
  http.protected
    .post("/delivery/{deliveryKey}/read", "schedule.delivery.read")
    .mutating()
    .seeded((ctx) =>
      ctx.session().pipe(
        Effect.flatMap((s) =>
          ctx
            .scheduleCreate({
              sessionID: s.id,
              kind: "reminder",
              content: "read me",
              dueAt: Date.now() + 60_000,
              timezone: "Asia/Shanghai",
              deliveryKey: "reminder:ex:6",
            })
            .pipe(
              Effect.flatMap((sched) =>
                ctx.deliveryDeliver({
                  deliveryKey: "reminder:ex:6",
                  scheduleID: sched.id,
                  sessionID: s.id,
                  kind: "reminder",
                  content: "read me",
                  deliveredAt: Date.now(),
                  caughtUp: false,
                }),
              ),
            ),
        ),
      ),
    )
    .at((ctx) => ({ path: "/delivery/{deliveryKey}/read", headers: ctx.headers(), body: {} }))
    .status(200, undefined, "status"),
  http.protected.post("/import-asset/parse", "import-parser.parse")
    .global()
    .at(() => ({ path: "/import-asset/parse", body: { content: "# HTTP API Import\n\nPrompt body" } }))
    .json(200, (body) => {
      object(body)
      array(body.candidates)
      check(body.candidates.length === 1, "import parser should return one candidate")
      const candidate = body.candidates[0]
      object(candidate)
      check(candidate.kind === "prompt", "import parser should infer a prompt")
      check(candidate.name === "HTTP API Import", "import parser should infer the heading as name")
      array(body.warnings)
      array(body.errors)
    }),
  http.protected.get("/lsp", "lsp.status").json(200, array),
  http.protected.get("/formatter", "formatter.status").json(200, array),
  http.protected.get("/config", "config.get").json(200, undefined, "status"),
  http.protected
    .patch("/config", "config.update")
    .mutating()
    .at((ctx) => ({ path: "/config", headers: ctx.headers(), body: { username: "httpapi-local" } }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.username === "httpapi-local", "local config update should return patched config")
      },
      "status",
    ),
  http.protected
    .patch("/config", "config.update.invalid")
    .at((ctx) => ({ path: "/config", headers: ctx.headers(), body: { username: 1 } }))
    .status(400),
  http.protected.get("/config/providers", "config.providers").json(),
  http.protected.get("/project", "project.list").json(200, array, "status"),
  http.protected.get("/project/current", "project.current").json(
    200,
    (body, ctx) => {
      object(body)
      check(body.worktree === ctx.directory, "current project should resolve from scenario directory")
    },
    "status",
  ),
  http.protected
    .patch("/project/{projectID}", "project.update")
    .mutating()
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/project/{projectID}", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: { name: "HTTP API Project", commands: { start: "bun --version" } },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.name === "HTTP API Project", "project update should return patched name")
        check(
          isRecord(body.commands) && body.commands.start === "bun --version",
          "project update should return patched command",
        )
      },
      "status",
    ),
  http.protected
    .patch("/project/{projectID}", "project.update.missing")
    .mutating()
    .at((ctx) => ({
      path: route("/project/{projectID}", { projectID: "project_httpapi_missing" }),
      headers: ctx.headers(),
      body: { name: "Missing Project" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/project/git/init", "project.initGit")
    .mutating()
    .inProject({ git: false })
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.worktree === ctx.directory, "git init should return current project")
        check(body.vcs === "git", "git init should mark the project as git-backed")
      },
      "status",
    ),
  http.protected
    .get("/project/{projectID}/directories", "project.directories")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/project/{projectID}/directories", { projectID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, array, "status"),
  http.protected
    .post("/experimental/project/{projectID}/copy/generate-name", "experimental.projectCopy.generateName")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy/generate-name", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(200, (body) => {
      object(body)
      check(typeof body.name === "string" && body.name.length > 0, "generated copy name should be non-empty")
    }),
  http.protected
    .post("/experimental/project/{projectID}/copy", "experimental.projectCopy.create")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http.protected
    .delete("/experimental/project/{projectID}/copy", "experimental.projectCopy.remove")
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy", { projectID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http.protected
    .post("/experimental/project/{projectID}/copy/refresh", "experimental.projectCopy.refresh")
    .mutating()
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: route("/experimental/project/{projectID}/copy/refresh", { projectID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "status"),
  http.protected.get("/provider", "provider.list").json(),
  http.protected.get("/provider/auth", "provider.auth").json(),
  http.protected
    .post("/provider/{providerID}/oauth/authorize", "provider.oauth.authorize")
    .at((ctx) => ({
      path: route("/provider/{providerID}/oauth/authorize", { providerID: "httpapi" }),
      headers: ctx.headers(),
      body: { method: "bad" },
    }))
    .status(400),
  http.protected
    .post("/provider/{providerID}/oauth/callback", "provider.oauth.callback")
    .at((ctx) => ({
      path: route("/provider/{providerID}/oauth/callback", { providerID: "httpapi" }),
      headers: ctx.headers(),
      body: { method: "bad" },
    }))
    .status(400),
  http.protected.get("/permission", "permission.list").json(200, array),
  http.protected
    .post("/permission/{requestID}/reply", "permission.reply.invalid")
    .at((ctx) => ({
      path: route("/permission/{requestID}/reply", { requestID: "per_httpapi" }),
      headers: ctx.headers(),
      body: { reply: "bad" },
    }))
    .status(400),
  http.protected
    .post("/permission/{requestID}/reply", "permission.reply")
    .at((ctx) => ({
      path: route("/permission/{requestID}/reply", { requestID: "per_httpapi" }),
      headers: ctx.headers(),
      body: { reply: "once" },
    }))
    .json(404, object, "status"),
  http.protected.get("/question", "question.list").json(200, array),
  http.protected
    .post("/question/{requestID}/reply", "question.reply.invalid")
    .at((ctx) => ({
      path: route("/question/{requestID}/reply", { requestID: "que_httpapi_reply" }),
      headers: ctx.headers(),
      body: { answers: "Yes" },
    }))
    .status(400),
  http.protected
    .post("/question/{requestID}/reply", "question.reply")
    .at((ctx) => ({
      path: route("/question/{requestID}/reply", { requestID: "que_httpapi_reply" }),
      headers: ctx.headers(),
      body: { answers: [["Yes"]] },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/question/{requestID}/reject", "question.reject")
    .at((ctx) => ({
      path: route("/question/{requestID}/reject", { requestID: "que_httpapi_reject" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/file", "file.list")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/file?${new URLSearchParams({ path: "." })}`, headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/file/content", "file.read")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/file/content?${new URLSearchParams({ path: "hello.txt" })}`, headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(body.content === "hello", `content should match seeded file: ${JSON.stringify(body)}`)
    }),
  http.protected
    .get("/file/content", "file.read.missing")
    .at((ctx) => ({ path: `/file/content?${new URLSearchParams({ path: "missing.txt" })}`, headers: ctx.headers() }))
    .json(200, (body) => {
      object(body)
      check(body.type === "text" && body.content === "", "missing file content should return an empty text result")
    }),
  http.protected.get("/file/status", "file.status").json(200, array),
  http.protected
    .get("/find", "find.text")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: `/find?${new URLSearchParams({ pattern: "hello" })}`, headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/find/file", "find.files")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({
      path: `/find/file?${new URLSearchParams({ query: "hello", dirs: "false" })}`,
      headers: ctx.headers(),
    }))
    .json(200, array),
  http.protected
    .get("/find/symbol", "find.symbols")
    .seeded((ctx) => ctx.file("hello.ts", "export const hello = 1\n"))
    .at((ctx) => ({ path: `/find/symbol?${new URLSearchParams({ query: "hello" })}`, headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/event", "event.stream")
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "event should be an SSE stream")
          check(result.text.includes("server.connected"), "event should emit initial connection event")
        }),
      "status",
    ),
  http.protected.get("/mcp", "mcp.status").json(),
  http.protected
    .post("/mcp", "mcp.add")
    .mutating()
    .at((ctx) => ({
      path: "/mcp",
      headers: ctx.headers(),
      body: { name: "httpapi-disabled", config: { type: "local", command: ["bun", "--version"], enabled: false } },
    }))
    .json(
      200,
      (body) => {
        object(body)
        object(body["httpapi-disabled"])
        check(body["httpapi-disabled"].status === "disabled", "disabled MCP server should be added without spawning")
      },
      "status",
    ),
  http.protected
    .post("/mcp", "mcp.add.invalid")
    .at((ctx) => ({
      path: "/mcp",
      headers: ctx.headers(),
      body: { name: "httpapi-invalid", config: { type: "invalid" } },
    }))
    .status(400),
  http.protected
    .post("/mcp/{name}/auth", "mcp.auth.start")
    .at((ctx) => ({ path: route("/mcp/{name}/auth", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .delete("/mcp/{name}/auth", "mcp.auth.remove")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/auth", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/auth/authenticate", "mcp.auth.authenticate")
    .at((ctx) => ({
      path: route("/mcp/{name}/auth/authenticate", { name: "httpapi-missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/auth/callback", "mcp.auth.callback")
    .at((ctx) => ({
      path: route("/mcp/{name}/auth/callback", { name: "httpapi-missing" }),
      headers: ctx.headers(),
      body: { code: "code" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/connect", "mcp.connect")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/connect", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .post("/mcp/{name}/disconnect", "mcp.disconnect")
    .mutating()
    .at((ctx) => ({ path: route("/mcp/{name}/disconnect", { name: "httpapi-missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected.get("/pty/shells", "pty.shells").json(200, array),
  http.protected.get("/pty", "pty.list").json(200, array),
  http.protected
    .post("/pty", "pty.create")
    .mutating()
    .at((ctx) => ({ path: "/pty", headers: ctx.headers(), body: controlledPtyInput("HTTP API PTY") }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.title === "HTTP API PTY", "PTY create should return requested title")
        check(body.command === "/bin/sh", "PTY create should use controlled shell command")
        check(body.cwd === ctx.directory, "PTY create should default cwd to scenario directory")
      },
      "status",
    ),
  http.protected
    .post("/pty", "pty.create.invalid")
    .at((ctx) => ({ path: "/pty", headers: ctx.headers(), body: { command: 1 } }))
    .status(400),
  http.protected
    .post("/pty/{ptyID}/connect-token", "pty.connectToken.invalid")
    .at((ctx) => ({
      path: route("/pty/{ptyID}/connect-token", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(403, undefined, "status"),
  http.protected
    .get("/pty/{ptyID}", "pty.get")
    .at((ctx) => ({ path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .status(404),
  http.protected
    .put("/pty/{ptyID}", "pty.update")
    .mutating()
    .at((ctx) => ({
      path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
      body: { size: { rows: 0, cols: 0 } },
    }))
    .status(400),
  http.protected
    .delete("/pty/{ptyID}", "pty.remove")
    .mutating()
    .at((ctx) => ({ path: route("/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .get("/pty/{ptyID}/connect", "pty.connect")
    .at((ctx) => ({ path: route("/pty/{ptyID}/connect", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .status(404, undefined, "none"),
  http.protected.get("/experimental/console", "experimental.console.get").json(),
  http.protected.get("/experimental/console/orgs", "experimental.console.listOrgs").json(),
  http.protected
    .post("/experimental/console/switch", "experimental.console.switchOrg")
    .at((ctx) => ({
      path: "/experimental/console/switch",
      headers: ctx.headers(),
      body: { accountID: "httpapi-account", orgID: "httpapi-org" },
    }))
    .status(400, undefined, "none"),
  http.protected.get("/experimental/workspace/adapter", "experimental.workspace.adapter.list").json(200, array),
  http.protected.get("/experimental/workspace", "experimental.workspace.list").json(200, array),
  http.protected.get("/experimental/workspace/status", "experimental.workspace.status").json(200, array),
  http.protected
    .post("/experimental/workspace", "experimental.workspace.create")
    .at((ctx) => ({ path: "/experimental/workspace", headers: ctx.headers(), body: {} }))
    .status(400),
  http.protected
    .post("/experimental/workspace/sync-list", "experimental.workspace.syncList")
    .status(204, undefined, "status"),
  http.protected
    .delete("/experimental/workspace/{id}", "experimental.workspace.remove")
    .mutating()
    .at((ctx) => ({
      path: route("/experimental/workspace/{id}", { id: "wrk_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(200),
  http.protected
    .post("/experimental/workspace/warp", "experimental.workspace.warp")
    .at((ctx) => ({
      path: "/experimental/workspace/warp",
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http.protected
    .post("/experimental/control-plane/move-session", "experimental.controlPlane.moveSession")
    .global()
    .at(() => ({
      path: "/experimental/control-plane/move-session",
      body: {},
    }))
    .status(400),
  http.protected
    .get("/experimental/tool", "tool.list")
    .at((ctx) => ({
      path: `/experimental/tool?${new URLSearchParams({ provider: "aigcfroge", model: "test" })}`,
      headers: ctx.headers(),
    }))
    .json(200, array, "status"),
  http.protected.get("/experimental/tool/ids", "tool.ids").json(200, array),
  http.protected.get("/experimental/worktree", "worktree.list").json(200, array),
  http.protected
    .post("/experimental/worktree", "worktree.create")
    .mutating()
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { name: "api-dsl" } }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(typeof body.directory === "string", "created worktree should include directory")
          yield* ctx.worktreeRemove(body.directory)
        }),
      "status",
    ),
  http.protected
    .post("/experimental/worktree", "worktree.create.invalid")
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { name: 1 } }))
    .status(400),
  http.protected
    .delete("/experimental/worktree", "worktree.remove")
    .mutating()
    .seeded((ctx) => ctx.worktree({ name: "api-remove" }))
    .at((ctx) => ({ path: "/experimental/worktree", headers: ctx.headers(), body: { directory: ctx.state.directory } }))
    .json(200, (body) => {
      check(body === true, "worktree remove should return true")
    }),
  http.protected
    .post("/experimental/worktree/reset", "worktree.reset")
    .mutating()
    .seeded((ctx) => ctx.worktree({ name: "api-reset" }))
    .at((ctx) => ({
      path: "/experimental/worktree/reset",
      headers: ctx.headers(),
      body: { directory: ctx.state.directory },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "worktree reset should return true")
        yield* ctx.worktreeRemove(ctx.state.directory)
      }),
    ),
  http.protected
    .get("/experimental/session", "experimental.session.list")
    .at((ctx) => ({ path: "/experimental/session?roots=false&archived=false", headers: ctx.headers() }))
    .json(200, array),
  http.protected.get("/experimental/capabilities", "experimental.capabilities.get").json(200, (body) => {
    check(typeof body === "object" && body !== null, "capabilities should be an object")
    check("backgroundSubagents" in body, "capabilities should report background subagents")
  }),
  http.protected
    .post("/experimental/session/{sessionID}/background", "experimental.session.background")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Background route owner" }))
    .at((ctx) => ({
      path: route("/experimental/session/{sessionID}/background", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      check(body === false, "background route should be a no-op without running subagents")
    }),
  http.protected.get("/experimental/resource", "experimental.resource.list").json(),
  http.protected
    .post("/sync/history", "sync.history.list")
    .at((ctx) => ({ path: "/sync/history", headers: ctx.headers(), body: {} }))
    .json(200, array),
  http.protected
    .post("/sync/replay", "sync.replay")
    .at((ctx) => ({ path: "/sync/replay", headers: ctx.headers(), body: { directory: ctx.directory, events: [] } }))
    .status(400),
  http.protected
    .post("/sync/steal", "sync.steal.invalid")
    .at((ctx) => ({ path: "/sync/steal", headers: ctx.headers(), body: {} }))
    .status(400, undefined, "status"),
  http.protected
    .post("/sync/start", "sync.start")
    .mutating()
    .preserveDatabase()
    .json(200, (body) => {
      check(body === true, "sync start should return true when no workspace sessions exist")
    }),
  http.protected
    .post("/instance/dispose", "instance.dispose")
    .mutating()
    .json(200, (body) => {
      check(body === true, "instance dispose should return true")
    }),
  http.protected
    .post("/log", "app.log")
    .global()
    .at(() => ({ path: "/log", body: { service: "httpapi-exercise", level: "info", message: "route coverage" } }))
    .json(200, (body) => {
      check(body === true, "log route should return true")
    }),
  http.protected
    .put("/auth/{providerID}", "auth.set")
    .global()
    .at(() => ({ path: route("/auth/{providerID}", { providerID: "test" }), body: { type: "api", key: "test-key" } }))
    .jsonEffect(200, (body) =>
      Effect.gen(function* () {
        check(body === true, "auth set should return true")
        const auth = yield* Effect.promise(() => Bun.file(path.join(exerciseDataDirectory, "auth.json")).json())
        object(auth)
        check(isRecord(auth.test) && auth.test.key === "test-key", "auth set should write isolated auth file")
      }),
    ),
  http.protected
    .delete("/auth/{providerID}", "auth.remove")
    .global()
    .seeded(() =>
      Effect.promise(() =>
        Bun.write(
          path.join(exerciseDataDirectory, "auth.json"),
          JSON.stringify({ test: { type: "api", key: "remove-me" } }),
        ),
      ),
    )
    .at(() => ({ path: route("/auth/{providerID}", { providerID: "test" }) }))
    .jsonEffect(200, (body) =>
      Effect.gen(function* () {
        check(body === true, "auth remove should return true")
        const auth = yield* Effect.promise(() => Bun.file(path.join(exerciseDataDirectory, "auth.json")).json())
        object(auth)
        check(auth.test === undefined, "auth remove should delete provider from isolated auth file")
      }),
    ),
  http.protected.get("/api/health", "v2.health.get").json(200, (body) => {
    object(body)
    check(body.healthy === true, "v2 server should report healthy")
  }),
  http.protected.get("/api/location", "v2.location.get").json(200, object),
  http.protected.get("/api/agent", "v2.agent.list").json(200, locationData(array)),
  http.protected.get("/api/model", "v2.model.list").json(200, locationData(array)),
  http.protected.get("/api/provider", "v2.provider.list").json(200, locationData(array)),
  http.protected.get("/api/integration", "v2.integration.list").json(200, locationData(array)),
  http.protected
    .get("/api/integration/{integrationID}", "v2.integration.get")
    .at((ctx) => ({
      path: route("/api/integration/{integrationID}", { integrationID: "missing" }),
      headers: ctx.headers(),
    }))
    .json(200, object),
  http.protected
    .post("/api/integration/{integrationID}/connect/key", "v2.integration.connect.key")
    .at((ctx) => ({
      path: route("/api/integration/{integrationID}/connect/key", { integrationID: "missing" }),
      headers: ctx.headers(),
      body: { key: "test" },
    }))
    .status(500, undefined, "status"),
  http.protected
    .post("/api/integration/{integrationID}/connect/oauth", "v2.integration.connect.oauth")
    .at((ctx) => ({
      path: route("/api/integration/{integrationID}/connect/oauth", { integrationID: "missing" }),
      headers: ctx.headers(),
      body: { methodID: "missing", inputs: {} },
    }))
    .status(500, undefined, "status"),
  http.protected
    .get("/api/integration/attempt/{attemptID}", "v2.integration.attempt.status")
    .at((ctx) => ({
      path: route("/api/integration/attempt/{attemptID}", { attemptID: "con_missing" }),
      headers: ctx.headers(),
    }))
    .status(500, undefined, "status"),
  http.protected
    .post("/api/integration/attempt/{attemptID}/complete", "v2.integration.attempt.complete")
    .at((ctx) => ({
      path: route("/api/integration/attempt/{attemptID}/complete", { attemptID: "con_missing" }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(500, undefined, "status"),
  http.protected
    .delete("/api/integration/attempt/{attemptID}", "v2.integration.attempt.cancel")
    .at((ctx) => ({
      path: route("/api/integration/attempt/{attemptID}", { attemptID: "con_missing" }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "status"),
  http.protected
    .delete("/api/credential/{credentialID}", "v2.credential.remove")
    .at((ctx) => ({
      path: route("/api/credential/{credentialID}", { credentialID: "cred_missing" }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "status"),
  http.protected
    .patch("/api/credential/{credentialID}", "v2.credential.update")
    .at((ctx) => ({
      path: route("/api/credential/{credentialID}", { credentialID: "cred_missing" }),
      headers: ctx.headers(),
      body: { label: "Work" },
    }))
    .status(204, undefined, "status"),
  http.protected.get("/api/command", "v2.command.list").json(200, locationData(array)),
  http.protected.get("/api/skill", "v2.skill.list").json(200, locationData(array)),
  http.protected
    .get("/api/event", "v2.event.subscribe")
    .stream()
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.contentType.includes("text/event-stream"), "v2 event should be an SSE stream")
          check(result.text.includes("server.connected"), "v2 event should emit initial connection event")
          check(!result.text.includes('"location"'), "v2 connection event should not be scoped to a location")
        }),
      "status",
    ),
  http.protected
    .get("/api/fs/read/*", "v2.fs.read")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: "/api/fs/read/hello.txt", headers: ctx.headers() }))
    .status(
      200,
      (_ctx, result) =>
        Effect.sync(() => {
          check(result.text === "hello\n", "v2 fs read should return the file body")
          check(result.contentType.includes("text/plain"), "v2 fs read should return the file content type")
        }),
      "status",
    ),
  http.protected.get("/api/fs/list", "v2.fs.list").json(200, locationData(array)),
  http.protected
    .get("/api/fs/find", "v2.fs.find")
    .seeded((ctx) => ctx.file("hello.txt", "hello\n"))
    .at((ctx) => ({ path: "/api/fs/find?query=hello&type=file", headers: ctx.headers() }))
    .json(200, locationData(array)),
  http.protected.get("/api/pty", "v2.pty.list").json(200, locationData(array)),
  http.protected
    .post("/api/pty", "v2.pty.create")
    .mutating()
    .at((ctx) => ({ path: "/api/pty", headers: ctx.headers(), body: controlledPtyInput("HTTP API V2 PTY") }))
    .json(200, locationData(object)),
  http.protected
    .get("/api/pty/{ptyID}", "v2.pty.get")
    .at((ctx) => ({ path: route("/api/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .put("/api/pty/{ptyID}", "v2.pty.update")
    .mutating()
    .at((ctx) => ({
      path: route("/api/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
      body: { title: "missing" },
    }))
    .json(404, object, "status"),
  http.protected
    .delete("/api/pty/{ptyID}", "v2.pty.remove")
    .mutating()
    .at((ctx) => ({ path: route("/api/pty/{ptyID}", { ptyID: "pty_httpapi_missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected
    .post("/api/pty/{ptyID}/connect-token", "v2.pty.connectToken")
    .at((ctx) => ({
      path: route("/api/pty/{ptyID}/connect-token", { ptyID: "pty_httpapi_missing" }),
      headers: { ...ctx.headers(), "x-aigcfroge-ticket": "1" },
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/pty/{ptyID}/connect", "v2.pty.connect")
    .at((ctx) => ({
      path: route("/api/pty/{ptyID}/connect", { ptyID: "pty_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404, undefined, "none"),
  http.protected.get("/api/reference", "v2.reference.list").json(200, object),
  http.protected
    .get("/api/provider/{providerID}", "v2.provider.get")
    .at((ctx) => ({ path: route("/api/provider/{providerID}", { providerID: "missing" }), headers: ctx.headers() }))
    .json(404, object, "status"),
  http.protected.get("/api/permission/request", "v2.permission.request.list").json(200, (body) => {
    object(body)
    object(body.location)
    array(body.data)
  }),
  http.protected.get("/api/question/request", "v2.question.request.list").json(200, (body) => {
    object(body)
    object(body.location)
    array(body.data)
  }),
  http.protected
    .get("/api/session/{sessionID}/permission", "v2.session.permission.list")
    .seeded((ctx) => ctx.session({ title: "Permission list owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/permission", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(array)),
  http.protected
    .get("/api/session/{sessionID}/question", "v2.session.question.list")
    .seeded((ctx) => ctx.session({ title: "Question list owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/question", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(array)),
  http.protected
    .post("/api/session/{sessionID}/permission/{requestID}/reply", "v2.session.permission.reply")
    .seeded((ctx) => ctx.session({ title: "Permission owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/permission/{requestID}/reply", {
        sessionID: ctx.state.id,
        requestID: "per_httpapi_missing",
      }),
      headers: ctx.headers(),
      body: { reply: "once" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/api/session/{sessionID}/question/{requestID}/reply", "v2.session.question.reply")
    .seeded((ctx) => ctx.session({ title: "Question reply owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/question/{requestID}/reply", {
        sessionID: ctx.state.id,
        requestID: "que_httpapi_missing",
      }),
      headers: ctx.headers(),
      body: { answers: [] },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/api/session/{sessionID}/question/{requestID}/reject", "v2.session.question.reject")
    .seeded((ctx) => ctx.session({ title: "Question reject owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/question/{requestID}/reject", {
        sessionID: ctx.state.id,
        requestID: "que_httpapi_missing",
      }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected.get("/api/permission/saved", "v2.permission.saved.list").json(200, (body) => {
    object(body)
    array(body.data)
  }),
  http.protected
    .delete("/api/permission/saved/{id}", "v2.permission.saved.remove")
    .at((ctx) => ({ path: route("/api/permission/saved/{id}", { id: "psv_httpapi_missing" }), headers: ctx.headers() }))
    .status(204, undefined, "status"),
  http.protected
    .get("/api/session", "v2.session.list")
    .at((ctx) => ({ path: "/api/session?roots=true", headers: ctx.headers() }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        object(body.cursor)
      },
      "none",
    ),
  http.protected
    .get("/api/session", "v2.session.list.filters")
    .at((ctx) => ({
      path: `/api/session?${new URLSearchParams({
        limit: "2",
        order: "asc",
        path: ".",
        roots: "false",
        start: "0",
        search: "missing",
        directory: ctx.directory ?? "",
      })}`,
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        object(body.cursor)
      },
      "none",
    ),
  http.protected
    .get("/api/session", "v2.session.list.cursor")
    .at((ctx) => ({
      path: `/api/session?${new URLSearchParams({
        limit: "2",
        cursor: cursor({
          order: "desc",
          directory: ctx.directory,
          anchor: { id: "ses_httpapi_missing", time: 0, direction: "next" },
        }),
      })}`,
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body) => {
        object(body)
        array(body.data)
        object(body.cursor)
      },
      "none",
    ),
  http.protected
    .get("/api/session", "v2.session.list.cursor.invalid")
    .at((ctx) => ({
      path: `/api/session?${new URLSearchParams({
        cursor: "invalid",
      })}`,
      headers: ctx.headers(),
    }))
    .status(400, undefined, "none"),
  http.protected
    .post("/api/session", "v2.session.create")
    .at((ctx) => ({
      path: "/api/session",
      headers: { ...ctx.headers(), "content-type": "application/json" },
      body: {},
    }))
    .json(200, data(object)),
  http.protected
    .post("/api/session/custom", "v2.session.custom")
    .seeded((ctx) =>
      Effect.gen(function* () {
        yield* seedAsset(ctx, assetFixtures.find((f) => f.kind === "agent")!)
        const revision = yield* Effect.promise(() =>
          Hash.sha256(Buffer.from(assetFixtures.find((f) => f.kind === "agent")!.content)),
        )
        return { revision }
      }),
    )
    .at((ctx) => ({
      path: "/api/session/custom",
      headers: { ...ctx.headers(), "content-type": "application/json", "x-aigcfroge-capabilities": "product-mode-custom-v1" },
      body: {
        location: { directory: ctx.directory },
        title: "httpapi v2 custom",
        composition: {
          source: "temporary",
          agents: [
            {
              kind: "agent",
              relativePath: assetFixtures.find((f) => f.kind === "agent")!.relativePath,
              revision: ctx.state.revision,
            },
          ],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        },
      },
    }))
    .json(200, (body) => {
      object(body)
      check(isRecord(body.data) && body.data.mode === "custom", "v2 session.custom should create a custom session")
      check(isRecord(body.snapshot) && typeof body.snapshot.digest === "string", "v2 session.custom should return a snapshot")
    }),
  http.protected
    .get("/api/session/{sessionID}", "v2.session.get")
    .seeded((ctx) => ctx.session({ title: "Session get" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, data(object)),
  http.protected
    .post("/api/session/{sessionID}/agent", "v2.session.switchAgent")
    .seeded((ctx) => ctx.session({ title: "Switch agent" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/agent", { sessionID: ctx.state.id }),
      headers: { ...ctx.headers(), "content-type": "application/json" },
      body: { agent: "plan" },
    }))
    .status(204, undefined, "none"),
  http.protected
    .post("/api/session/{sessionID}/model", "v2.session.switchModel")
    .seeded((ctx) => ctx.session({ title: "Switch model" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/model", { sessionID: ctx.state.id }),
      headers: { ...ctx.headers(), "content-type": "application/json" },
      body: { model: { providerID: "aigcfroge", id: "big-pickle" } },
    }))
    .status(204, undefined, "none"),
  http.protected
    .get("/api/session/{sessionID}/context", "v2.session.context")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/context", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/message", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages.params")
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/message", { sessionID: "ses_httpapi_missing" })}?${new URLSearchParams({
        limit: "2",
        order: "asc",
      })}`,
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages.cursor")
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/message", { sessionID: "ses_httpapi_missing" })}?${new URLSearchParams({
        limit: "2",
        directory: ctx.directory ?? "",
        cursor: cursor({ id: "msg_httpapi_missing", time: 0, order: "desc", direction: "next" }),
      })}`,
      headers: ctx.headers(),
    }))
    .json(404, object, "status"),
  http.protected
    .get("/api/session/{sessionID}/message", "v2.session.messages.cursor.invalid")
    .seeded((ctx) => ctx.session({ title: "Invalid message cursor owner" }))
    .at((ctx) => ({
      path: `${route("/api/session/{sessionID}/message", { sessionID: ctx.state.id })}?${new URLSearchParams({
        cursor: cursor({ id: "msg_httpapi_missing", time: 0, order: "desc", direction: "next" }),
        order: "asc",
      })}`,
      headers: ctx.headers(),
    }))
    .status(400, undefined, "none"),
  http.protected
    .post("/api/session/{sessionID}/prompt", "v2.session.prompt.invalid")
    .seeded((ctx) => ctx.session({ title: "Invalid prompt owner" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/prompt", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(400, undefined, "none"),
  http.protected
    .post("/api/session/{sessionID}/compact", "v2.session.compact")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/compact", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404, undefined, "status"),
  http.protected
    .post("/api/session/{sessionID}/wait", "v2.session.wait")
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/wait", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404, undefined, "status"),
  http.protected
    .get("/api/session/{sessionID}/children", "v2.session.children")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const parent = yield* ctx.session({ title: "V2 children parent" })
        const child = yield* ctx.session({ title: "V2 child", parentID: parent.id })
        return { parent, child }
      }),
    )
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/children", { sessionID: ctx.state.parent.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      array(body.data)
      check(
        body.data.some((item) => isRecord(item) && item.id === ctx.state.child.id),
        "v2 session children should include the seeded child",
      )
    }),
  http.protected
    .post("/api/session/{sessionID}/interrupt", "v2.session.interrupt")
    .seeded((ctx) => ctx.session({ title: "Interrupt session" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/interrupt", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .status(204, undefined, "status"),
  http.protected
    .post("/api/session/{sessionID}/shell", "v2.session.shell")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "V2 shell session" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/shell", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { command: "printf v2-shell-ok", resume: false },
    }))
    .json(200, (body, ctx) => {
      object(body)
      object(body.data)
      check(body.data.kind === "shell", "v2 shell should admit a shell input")
      check(body.data.sessionID === ctx.state.id, "v2 shell should target the seeded session")
      check(body.data.command === "printf v2-shell-ok", "v2 shell should preserve the command")
    }),
  http.protected
    .post("/api/session/{sessionID}/skill", "v2.session.skill")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "V2 skill session" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/skill", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { skill: "init", resume: false },
    }))
    .json(200, (body, ctx) => {
      object(body)
      object(body.data)
      check(body.data.kind === "skill", "v2 skill should admit a skill input")
      check(body.data.sessionID === ctx.state.id, "v2 skill should target the seeded session")
      check(body.data.skill === "init", "v2 skill should preserve the skill name")
    }),
  http.protected
    .post("/api/session/{sessionID}/share", "v2.session.share")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const source = yield* ctx.session({ title: "V2 share source" })
        const target = yield* ctx.session({ title: "V2 share target" })
        return { source, target }
      }),
    )
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/share", { sessionID: ctx.state.source.id }),
      headers: ctx.headers(),
      body: { targetSessionID: ctx.state.target.id, scope: "reference" },
    }))
    .status(204, undefined, "status"),
  http.protected
    .post("/api/session/{sessionID}/fork", "v2.session.fork")
    .mutating()
    .preserveDatabase()
    .seeded((ctx) => ctx.session({ title: "V2 fork source" }))
    .at((ctx) => ({
      path: route("/api/session/{sessionID}/fork", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(typeof body.sessionID === "string", "v2 fork should return a child session id")
        check(body.sessionID !== ctx.state.id, "v2 fork should create a new session")
      },
      "status",
    ),
  http.protected
    .get("/session", "session.list")
    .seeded((ctx) => ctx.session({ title: "List me" }))
    .at((ctx) => ({ path: "/session?roots=true", headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.id && item.title === "List me"),
        "seeded session should be listed",
      )
    }),
  http.protected
    .get("/session/status", "session.status")
    .seeded((ctx) => ctx.session({ title: "Status session" }))
    .json(200, object),
  http.protected
    .post("/session", "session.create")
    .mutating()
    .at((ctx) => ({ path: "/session", headers: ctx.headers(), body: { title: "Created session" } }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.title === "Created session", "created session should use requested title")
        check(body.directory === ctx.directory, "created session should use scenario directory")
      },
      "status",
    ),
  http.protected
    .get("/session/{sessionID}", "session.get")
    .seeded((ctx) => ctx.session({ title: "Get me" }))
    .at((ctx) => ({ path: route("/session/{sessionID}", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.id === ctx.state.id, "should return requested session")
      check(body.title === "Get me", "should preserve seeded title")
    }),
  http.protected
    .get("/session/{sessionID}", "session.get.missing")
    .at((ctx) => ({
      path: route("/session/{sessionID}", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404),
  http.protected
    .patch("/session/{sessionID}", "session.update")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Before rename" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { title: "After rename" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.title === "After rename", "updated session should use new title")
      },
      "status",
    ),
  http.protected
    .patch("/session/{sessionID}", "session.update.invalid")
    .mutating()
    .at((ctx) => ({
      path: route("/session/{sessionID}", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
      body: { title: 1 },
    }))
    .status(400),
  http.protected
    .delete("/session/{sessionID}", "session.delete")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Delete me" }))
    .at((ctx) => ({ path: route("/session/{sessionID}", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "delete should return true")
        check((yield* ctx.sessionGet(ctx.state.id)) === undefined, "deleted session should not remain in storage")
      }),
    ),
  http.protected
    .get("/session/{sessionID}/permission-override", "permission.override.get")
    .seeded((ctx) => ctx.session({ title: "Override status session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/permission-override", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(body.enabled === false, "fresh session should have break-glass override disabled")
    }),
  http.protected
    .put("/session/{sessionID}/permission-override", "permission.override.put")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Override enable session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/permission-override", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { acknowledged: true },
    }))
    .json(200, (body) => {
      object(body)
      check(body.enabled === true, "acknowledged enable should activate break-glass override")
    }),
  http.protected
    .delete("/session/{sessionID}/permission-override", "permission.override.delete")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Override disable session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/permission-override", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(body.enabled === false, "disable should deactivate break-glass override")
    }),
  http.protected
    .get("/session/{sessionID}/children", "session.children")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const parent = yield* ctx.session({ title: "Parent" })
        const child = yield* ctx.session({ title: "Child", parentID: parent.id })
        return { parent, child }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/children", { sessionID: ctx.state.parent.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some((item) => isRecord(item) && item.id === ctx.state.child.id && item.parentID === ctx.state.parent.id),
        "children should include seeded child",
      )
    }),
  http.protected
    .get("/session/{sessionID}/composition", "session.composition")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const custom = yield* ctx.customSession({ title: "Composition snapshot session" })
        return custom.session.id
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/composition", { sessionID: ctx.state }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(body.version === 1, "composition snapshot should be version 1")
      check(typeof body.digest === "string", "composition snapshot should carry a digest")
    }),
  http.protected
    .get("/session/{sessionID}/cache-diagnostics", "session.cacheDiagnostics")
    .seeded((ctx) => ctx.session({ title: "Cache diagnostics session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/cache-diagnostics", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(typeof body.sessionHitRate === "number", "cache diagnostics should expose session hit rate")
      check(typeof body.sessionCacheRead === "number", "cache diagnostics should expose cache read")
      check(typeof body.sessionCacheWrite === "number", "cache diagnostics should expose cache write")
      check(typeof body.sessionTotalInput === "number", "cache diagnostics should expose total input")
      check(
        body.confidence === "high" || body.confidence === "estimated" || body.confidence === "unavailable",
        "cache diagnostics should expose a confidence level",
      )
      array(body.perStep)
    }),
  http.protected
    .get("/session/{sessionID}/tool-summary", "session.toolSummary")
    .seeded((ctx) => ctx.session({ title: "Tool summary session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/tool-summary", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, array),
  http.protected
    .get("/session/{sessionID}/todo", "session.todo")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Todo session" })
        const todos = [{ content: "cover session todo", status: "pending", priority: "high" }]
        yield* ctx.todos(session.id, todos)
        return { session, todos }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/todo", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      check(stable(body) === stable(ctx.state.todos), "todos should match seeded state")
    }),
  http.protected
    .get("/session/{sessionID}/task", "session.task.get")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Task list session" })
        const tasks = yield* ctx.tasks(session.id, [{ content: "listed", status: "in_progress", priority: "high" }])
        return { session, tasks }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/task", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some(
          (task) =>
            isRecord(task) &&
            task.id === ctx.state.tasks[0].id &&
            task.content === "listed" &&
            task.status === "in_progress",
        ),
        "task list should include the seeded task",
      )
    }),
  http.protected
    .patch("/session/{sessionID}/task", "session.task.update")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Task reconcile session" })
        const tasks = yield* ctx.tasks(session.id, [
          { content: "keep", status: "pending", priority: "low" },
          { content: "drop", status: "pending", priority: "low" },
        ])
        return { session, tasks }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/task", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
      // Full-list reconcile over WriteInfo: the kept task flips status in place,
      // the id-less entry is minted a fresh tsk_ id, and the omitted seeded task
      // is removed.
      body: [
        { id: ctx.state.tasks[0].id, content: "keep", status: "completed", priority: "low" },
        { content: "fresh", status: "in_progress", priority: "high" },
      ],
    }))
    .json(
      200,
      (body, ctx) => {
        array(body)
        check(body.length === 2, "reconcile should return the kept and fresh tasks")
        check(
          body.some((task) => isRecord(task) && task.id === ctx.state.tasks[0].id && task.status === "completed"),
          "reconcile should update the kept task in place",
        )
        check(
          body.every((task) => isRecord(task) && task.id !== ctx.state.tasks[1].id),
          "reconcile should remove the omitted task",
        )
        check(
          body.some((task) => isRecord(task) && task.content === "fresh" && task.sessionID === ctx.state.session.id),
          "reconcile should mint the fresh task under the path session",
        )
      },
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/task", "session.task.create")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Task create session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/task", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { content: "created via route", status: "pending", priority: "medium" },
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(typeof body.id === "string" && body.id.startsWith("tsk_"), "create should mint a tsk_ id")
        check(body.sessionID === ctx.state.id, "created task should belong to the seeded session")
        check(body.content === "created via route", "created task should preserve content")
        check(body.status === "pending", "created task should preserve status")
      },
      "status",
    ),
  http.protected
    .patch("/session/{sessionID}/task/{taskID}", "session.task.patch")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Task patch session" })
        const tasks = yield* ctx.tasks(session.id, [
          { content: "one", status: "pending", priority: "medium" },
          { content: "two", status: "pending", priority: "medium" },
        ])
        return { session, tasks }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/task/{taskID}", {
        sessionID: ctx.state.session.id,
        taskID: ctx.state.tasks[0].id,
      }),
      headers: ctx.headers(),
      // The single-task payload only accepts { status }; outputDigest is written
      // by internal settle paths and deliberately absent from the public API.
      body: { status: "completed" },
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.tasks[0].id, "patch should return the targeted task")
        check(body.status === "completed", "patch should apply the new status")
      },
      "status",
    ),
  http.protected
    .delete("/session/{sessionID}/task/{taskID}", "session.task.delete")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Task delete session" })
        const tasks = yield* ctx.tasks(session.id, [
          { content: "remove me", status: "pending", priority: "medium" },
          { content: "survivor", status: "pending", priority: "medium" },
        ])
        return { session, tasks }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/task/{taskID}", {
        sessionID: ctx.state.session.id,
        taskID: ctx.state.tasks[0].id,
      }),
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.tasks[0].id, "delete should return the removed task")
        check(body.content === "remove me", "delete should preserve the removed task content")
      },
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/task/reorder", "session.task.reorder")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Task reorder session" })
        const tasks = yield* ctx.tasks(session.id, [
          { content: "first", status: "pending", priority: "medium" },
          { content: "second", status: "pending", priority: "medium" },
        ])
        return { session, tasks }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/task/reorder", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
      // ids must be a permutation of the current task ids; the order is flipped
      // so the response proves the server applied it.
      body: { ids: [ctx.state.tasks[1].id, ctx.state.tasks[0].id] },
    }))
    .json(
      200,
      (body, ctx) => {
        array(body)
        check(body.length === 2, "reorder should return the full task list")
        const first = body[0]
        const second = body[1]
        check(
          isRecord(first) &&
            isRecord(second) &&
            first.id === ctx.state.tasks[1].id &&
            second.id === ctx.state.tasks[0].id,
          "reorder should apply the submitted id order",
        )
        check(
          body.every((task: unknown) => isRecord(task) && typeof task.revision === "number"),
          "reorder should bump every task's revision",
        )
      },
      "status",
    ),
  http.protected
    .get("/agent-task", "agent-task.list")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Agent task session" })
        const tasks = yield* ctx.tasks(session.id, [
          { content: "hub task", status: "in_progress", priority: "high", agentID: "build" },
        ])
        return { session, tasks }
      }),
    )
    .at((ctx) => ({ path: "/agent-task", headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      array(body)
      check(
        body.some(
          (task) =>
            isRecord(task) &&
            task.id === ctx.state.tasks[0].id &&
            task.sessionID === ctx.state.session.id &&
            task.agentID === "build",
        ),
        "agent task aggregation should include the seeded task with its owner",
      )
    }),
  http.protected
    .post("/session/{sessionID}/work-artifact/apply", "work-artifact.apply")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Work artifact session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/work-artifact/apply", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {
        title: "Drafted artifact",
        relativePath: "notes/artifact.md",
        content: "# Artifact\n",
        overwrite: false,
      },
    }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(typeof body.id === "string" && body.id.startsWith("art_"), "apply should mint an art_ id")
          check(body.sessionID === ctx.state.id, "applied artifact should belong to the seeded session")
          check(body.kind === "document", "applied artifact should keep the document kind")
          check(body.title === "Drafted artifact", "applied artifact should preserve the title")
          check(body.mediaType === "text/markdown", "applied artifact should keep the markdown media type")
          check(body.relativePath === "notes/artifact.md", "applied artifact should keep the location-relative path")
          check(body.status === "available", "applied artifact should be available after the write")
          if (!ctx.directory) throw new Error("work artifact apply needs a project directory")
          const directory = ctx.directory
          const exists = yield* Effect.promise(() => Bun.file(path.join(directory, "notes/artifact.md")).exists())
          check(exists, "work artifact apply should persist the file")
        }),
      "status",
    ),
  http.protected
    .get("/session/{sessionID}/diff", "session.diff")
    .seeded((ctx) => ctx.session({ title: "Diff session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/diff", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/session/{sessionID}/message", "session.messages")
    .seeded((ctx) => ctx.session({ title: "Messages session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/message", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, (body) => {
      array(body)
      check(body.length === 0, "new session should have no messages")
    }),
  http.protected
    .get("/session/{sessionID}/message/{messageID}", "session.message")
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Message get session" })
        const message = yield* ctx.message(session.id, { text: "read me" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
      }),
      headers: ctx.headers(),
    }))
    .json(200, (body, ctx) => {
      object(body)
      check(isRecord(body.info) && body.info.id === ctx.state.message.info.id, "should return requested message")
      check(
        Array.isArray(body.parts) && body.parts.some((part) => isRecord(part) && part.id === ctx.state.message.part.id),
        "message should include seeded part",
      )
    }),
  http.protected
    .patch("/session/{sessionID}/message/{messageID}/part/{partID}", "part.update")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Part update session" })
        const message = yield* ctx.message(session.id, { text: "before" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}/part/{partID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
        partID: ctx.state.message.part.id,
      }),
      headers: ctx.headers(),
      body: { ...ctx.state.message.part, text: "after" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.type === "text" && body.text === "after", "updated part should be returned")
      },
      "status",
    ),
  http.protected
    .delete("/session/{sessionID}/message/{messageID}/part/{partID}", "part.delete")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Part delete session" })
        const message = yield* ctx.message(session.id, { text: "delete part" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}/part/{partID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
        partID: ctx.state.message.part.id,
      }),
      headers: ctx.headers(),
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "delete part should return true")
        const messages = yield* ctx.messages(ctx.state.session.id)
        check(messages[0]?.parts.length === 0, "deleted part should not remain on message")
      }),
    ),
  http.protected
    .delete("/session/{sessionID}/message/{messageID}", "session.deleteMessage")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Message delete session" })
        const message = yield* ctx.message(session.id, { text: "delete message" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message/{messageID}", {
        sessionID: ctx.state.session.id,
        messageID: ctx.state.message.info.id,
      }),
      headers: ctx.headers(),
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "delete message should return true")
        check((yield* ctx.messages(ctx.state.session.id)).length === 0, "deleted message should not remain")
      }),
    ),
  http.protected
    .post("/session/{sessionID}/fork", "session.fork")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Fork source" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/fork", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {},
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(typeof body.id === "string", "fork should return a session")
      },
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/abort", "session.abort")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Abort session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/abort", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(200, (body) => {
      check(body === true, "abort should return true")
    }),
  http.protected
    .post("/session/{sessionID}/abort", "session.abort.missing")
    .at((ctx) => ({
      path: route("/session/{sessionID}/abort", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      check(body === true, "missing session abort should remain a no-op success")
    }),
  http.protected
    .post("/session/{sessionID}/init", "session.init")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Init session" })
        const message = yield* ctx.message(session.id, { text: "initialize" })
        yield* ctx.llmText("initialized")
        yield* ctx.llmText("initialized")
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/init", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
      body: { providerID: "test", modelID: "test-model", messageID: ctx.state.message.info.id },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "init should return true")
        yield* ctx.llmWait(1)
      }),
    ),
  http.protected
    .post("/session/{sessionID}/message", "session.prompt")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "LLM prompt session" })
        yield* ctx.llmText("fake assistant")
        yield* ctx.llmText("fake assistant")
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/message", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        parts: [{ type: "text", text: "hello llm" }],
      },
    }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(isRecord(body.info) && body.info.role === "assistant", "prompt should return assistant message")
          check(
            Array.isArray(body.parts) && body.parts.some((part) => isRecord(part) && part.text === "fake assistant"),
            "assistant message should use fake LLM text",
          )
          yield* ctx.llmWait(1)
        }),
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/prompt_async", "session.prompt_async")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Async prompt session" })
        yield* ctx.llmText("fake async assistant")
        yield* ctx.llmText("fake async assistant")
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/prompt_async", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: {
        agent: "build",
        model: { providerID: "test", modelID: "test-model" },
        parts: [{ type: "text", text: "hello async" }],
      },
    }))
    .status(204, (ctx) =>
      Effect.gen(function* () {
        yield* ctx.llmWait(1)
      }),
    ),
  http.protected
    .post("/session/{sessionID}/command", "session.command")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Command session" })
        yield* ctx.llmText("command done")
        yield* ctx.llmText("command done")
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/command", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { command: "init", arguments: "", model: "test/test-model" },
    }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          object(body)
          check(isRecord(body.info) && body.info.role === "assistant", "command should return assistant message")
          yield* ctx.llmWait(1)
        }),
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/shell", "session.shell")
    .preserveDatabase()
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Shell session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/shell", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { agent: "build", model: { providerID: "test", modelID: "test-model" }, command: "printf shell-ok" },
    }))
    .json(
      200,
      (body) => {
        object(body)
        check(isRecord(body.info) && body.info.role === "assistant", "shell should return assistant message")
        check(
          Array.isArray(body.parts) && body.parts.some((part) => isRecord(part) && part.type === "tool"),
          "shell should return a tool part",
        )
      },
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/summarize", "session.summarize")
    .preserveDatabase()
    .withLlm()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Summarize session" })
        yield* ctx.message(session.id, { text: "summarize this work" })
        const summary = [
          "## Goal",
          "- Exercise session summarize.",
          "",
          "## Constraints & Preferences",
          "- Use fake LLM.",
          "",
          "## Progress",
          "### Done",
          "- Summary generated.",
          "",
          "### In Progress",
          "- (none)",
          "",
          "### Blocked",
          "- (none)",
          "",
          "## Key Decisions",
          "- Keep route local.",
          "",
          "## Next Steps",
          "- (none)",
          "",
          "## Critical Context",
          "- Test fixture.",
          "",
          "## Relevant Files",
          "- test/server/httpapi-exercise/index.ts: scenario",
        ].join("\n")
        yield* ctx.llmText(summary)
        yield* ctx.llmText(summary)
        return session
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/summarize", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
      body: { providerID: "test", modelID: "test-model", auto: false },
    }))
    .jsonEffect(
      200,
      (body, ctx) =>
        Effect.gen(function* () {
          check(body === true, "summarize should return true")
          const messages = yield* ctx.messages(ctx.state.id)
          check(
            messages.some((message) => message.info.role === "assistant" && message.info.summary === true),
            "summarize should create a summary assistant message",
          )
          yield* ctx.llmWait(1)
        }),
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/revert", "session.revert")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Revert session" })
        const message = yield* ctx.message(session.id, { text: "revert me" })
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: route("/session/{sessionID}/revert", { sessionID: ctx.state.session.id }),
      headers: ctx.headers(),
      body: { messageID: ctx.state.message.info.id },
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.session.id, "revert should return the session")
        check(
          isRecord(body.revert) && body.revert.messageID === ctx.state.message.info.id,
          "revert should record reverted message",
        )
      },
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/unrevert", "session.unrevert")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Unrevert session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/unrevert", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.id, "unrevert should return the session")
      },
      "status",
    ),
  http.protected
    .post("/session/{sessionID}/permissions/{permissionID}", "permission.respond")
    .seeded((ctx) => ctx.session({ title: "Deprecated permission session" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/permissions/{permissionID}", {
        sessionID: ctx.state.id,
        permissionID: "per_httpapi_deprecated",
      }),
      headers: ctx.headers(),
      body: { response: "once" },
    }))
    .json(404, object, "status"),
  http.protected
    .post("/session/{sessionID}/share", "session.share")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Share session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/share", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.id, "share should return the session")
      },
      "status",
    ),
  http.protected
    .delete("/session/{sessionID}/share", "session.unshare")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Unshare session" }))
    .at((ctx) => ({ path: route("/session/{sessionID}/share", { sessionID: ctx.state.id }), headers: ctx.headers() }))
    .json(
      200,
      (body, ctx) => {
        object(body)
        check(body.id === ctx.state.id, "unshare should return the session")
      },
      "status",
    ),
  http.protected
    .post("/tui/append-prompt", "tui.appendPrompt")
    .at((ctx) => ({ path: "/tui/append-prompt", headers: ctx.headers(), body: { text: "hello" } }))
    .json(200, boolean, "status"),
  http.protected
    .post("/tui/select-session", "tui.selectSession.invalid")
    .at((ctx) => ({ path: "/tui/select-session", headers: ctx.headers(), body: { sessionID: "invalid" } }))
    .status(400),
  http.protected.post("/tui/open-help", "tui.openHelp").json(200, boolean, "status"),
  http.protected.post("/tui/open-sessions", "tui.openSessions").json(200, boolean, "status"),
  http.protected.post("/tui/open-themes", "tui.openThemes").json(200, boolean, "status"),
  http.protected.post("/tui/open-models", "tui.openModels").json(200, boolean, "status"),
  http.protected.post("/tui/submit-prompt", "tui.submitPrompt").json(200, boolean, "status"),
  http.protected.post("/tui/clear-prompt", "tui.clearPrompt").json(200, boolean, "status"),
  http.protected
    .post("/tui/execute-command", "tui.executeCommand")
    .at((ctx) => ({ path: "/tui/execute-command", headers: ctx.headers(), body: { command: "agent_cycle" } }))
    .json(200, boolean, "status"),
  http.protected
    .post("/tui/show-toast", "tui.showToast")
    .at((ctx) => ({
      path: "/tui/show-toast",
      headers: ctx.headers(),
      body: { title: "Exercise", message: "covered", variant: "info", duration: 1000 },
    }))
    .json(200, boolean, "status"),
  http.protected
    .post("/tui/publish", "tui.publish")
    .at((ctx) => ({
      path: "/tui/publish",
      headers: ctx.headers(),
      body: { type: "tui.prompt.append", properties: { text: "published" } },
    }))
    .json(200, boolean, "status"),
  http.protected
    .post("/tui/select-session", "tui.selectSession")
    .seeded((ctx) => ctx.session({ title: "TUI select" }))
    .at((ctx) => ({ path: "/tui/select-session", headers: ctx.headers(), body: { sessionID: ctx.state.id } }))
    .json(200, boolean, "status"),
  http.protected
    .post("/tui/control/response", "tui.control.response")
    .at((ctx) => ({ path: "/tui/control/response", headers: ctx.headers(), body: { ok: true } }))
    .json(200, boolean, "status"),
  http.protected
    .get("/tui/control/next", "tui.control.next")
    .mutating()
    .seeded((ctx) => ctx.tuiRequest({ path: "/tui/exercise", body: { text: "queued" } }))
    .json(
      200,
      (body) => {
        object(body)
        check(body.path === "/tui/exercise", "control next should return queued path")
        object(body.body)
        check(body.body.text === "queued", "control next should return queued body")
      },
      "status",
    ),
  http.protected
    .post("/global/upgrade", "global.upgrade")
    .global()
    .probe({ path: "/global/upgrade", body: { target: 1 } })
    .at(() => ({ path: "/global/upgrade", body: { target: 1 } }))
    .status(400),
]

const llmScenarios = new Set([
  "session.init",
  "session.prompt",
  "session.prompt_async",
  "session.command",
  "session.summarize",
])

const main = Effect.gen(function* () {
  yield* Effect.addFinalizer(() => Effect.promise(() => disposeApps()).pipe(Effect.andThen(cleanupExercisePaths)))
  const options = parseOptions(Bun.argv.slice(2))
  const modules = yield* Effect.promise(() => runtime())
  const effectRoutes = routeKeys(OpenApi.fromApi(modules.PublicApi))
  const selected = selectedScenarios(options, scenarios)
  const missing = effectRoutes.filter((route) => !scenarios.some((scenario) => route === routeKey(scenario)))
  const extra = scenarios.filter((scenario) => !effectRoutes.includes(routeKey(scenario)))

  for (const scenario of scenarios) {
    if (scenario.kind === "active" && llmScenarios.has(scenario.name) && !scenario.project?.llm) {
      return yield* Effect.fail(new Error(`${scenario.name} must use TestLLMServer via .withLlm()`))
    }
  }

  printHeader(options, effectRoutes, selected, missing, extra, {
    database: exerciseDatabasePath,
    global: exerciseGlobalRoot,
  })

  const results =
    options.mode === "coverage"
      ? selected.map(coverageResult)
      : yield* Effect.forEach(
          selected,
          (scenario) =>
            Effect.gen(function* () {
              if (options.progress) console.log(`${color.dim}RUN ${routeKey(scenario)} ${scenario.name}${color.reset}`)
              return yield* runScenario(options)(scenario)
            }),
          { concurrency: 1 },
        )
  printResults(results, missing, extra)

  if (results.some((result) => result.status === "fail"))
    return yield* Effect.fail(new Error("one or more scenarios failed"))
  if (options.failOnSkip && results.some((result) => result.status === "skip"))
    return yield* Effect.fail(new Error("one or more scenarios are skipped"))
  if (options.failOnMissing && missing.length > 0)
    return yield* Effect.fail(new Error("one or more routes have no scenario"))
  return undefined
})

Effect.runPromise(main.pipe(Effect.provide(TestLLMServer.layer), Effect.scoped) as never).then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`${color.red}${message(error)}${color.reset}`)
    process.exit(1)
  },
)
