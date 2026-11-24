import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Agent } from "@omnixa/core/agent"
import { AgentAsset } from "@omnixa/core/agent-asset"
import { Bus } from "@omnixa/core/bus"
import { CompositionDigest } from "@omnixa/core/composition/digest"
import { Database } from "@omnixa/core/database/database"
import { DelegationService } from "@omnixa/core/delegation/service"
import { CustomProfile } from "@omnixa/core/custom-profile"
import { Command } from "@omnixa/core/command"
import { Environment } from "@omnixa/core/environment/index"
import { EventSequenceTable, EventTable } from "@omnixa/core/event/sql"
import { LayerNodePlatform } from "@omnixa/core/effect/app-node-platform"
import { LocationServiceMap } from "@omnixa/core/location-services"
import { McpConnection } from "@omnixa/core/mcp/connection"
import { MetaAgentSessionTable } from "@omnixa/core/meta-agent/sql"
import { Model } from "@omnixa/core/model"
import { Plugin } from "@omnixa/core/plugin"
import { Provider } from "@omnixa/core/provider"
import { Session } from "@omnixa/core/session"
import { SessionEvent } from "@omnixa/core/session/event"
import { SessionInbox } from "@omnixa/core/session/inbox"
import { SessionComposition } from "@omnixa/core/session/composition"
import { SessionSchema } from "@omnixa/core/session/schema"
import { Workspace } from "@omnixa/core/workspace"
import { WorkspaceDriver } from "@omnixa/core/workspace/driver"
import {
  SessionCompositionSnapshotTable,
  SessionInboxTable,
  SessionMessageTable,
  SessionTable,
} from "@omnixa/core/session/sql"
import { AssetYaml } from "@omnixa/core/util/asset-yaml"
import { CompositionResolveError } from "@omnixa/protocol/errors"
import { CustomCompositionReferencesResponse } from "@omnixa/protocol/groups/custom-composition"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { Composition } from "@omnixa/schema/composition"
import { AbsolutePath } from "@omnixa/schema/schema"
import { decodeProfile, Info, Revision } from "@omnixa/schema/custom-profile"
import { Hash } from "@omnixa/util/hash"
import { Context, DateTime, Deferred, Effect, Layer, Schema } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { LLMClient } from "../../ai/src"
import { TestLLM } from "../../ai/src/testing"
import { withEnv } from "../../core/test/fixture/env"
import { initRepo } from "../../core/test/fixture/git"
import { createLegacySession, useOfflineCatalog } from "../../core/test/fixture/models"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { awaitWithTimeout, it } from "../../core/test/lib/effect"
import { locationRefForRoute } from "../src/middleware/workspace-routing"
import { createRoutes } from "../src/routes"

const reference = <K extends Composition.AllowedKind>(kind: K, relativePath: string, content: string) => ({
  kind,
  relativePath,
  revision: Composition.Revision.make(Hash.sha256(Buffer.from(content))),
})

const agent = {
  path: ".omnixa/agents/pool/coder.md",
  content: "---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n",
}
const prompt = {
  path: ".omnixa/prompts/shared/precise.md",
  content: "---\nkind: prompt\nname: precise\ndescription: Precise prompt\n---\nBe precise.\n",
}
const skill = {
  path: ".omnixa/skills/review/SKILL.md",
  content: "---\nname: review\ndescription: Review changes\n---\nInspect the actual diff.\n",
}
const command = {
  path: ".omnixa/commands/check.md",
  content:
    "---\nkind: command\nname: check\ndescription: Check changes\ninvocation: check\nargs: target\n---\nCheck $ARGUMENTS.\n",
}
const workflow = {
  path: ".omnixa/workflows/review.yaml",
  content: AssetYaml.stringify({
    kind: "workflow",
    name: "review",
    description: "Review workflow",
    version: "1",
    steps: [{ id: "review", name: "Review", agent: "coder" }],
  }),
}
const mcp = {
  path: ".omnixa/mcps/probe.md",
  content: "---\nkind: mcp\nname: probe\ndescription: Probe server\ncommand: bun\n---\nProbe metadata.\n",
}
const refs = {
  agent: reference("agent", "pool/coder.md", agent.content),
  prompt: reference("prompt", "shared/precise.md", prompt.content),
  skill: reference("skill", "review/SKILL.md", skill.content),
  command: reference("command", "check.md", command.content),
  workflow: reference("workflow", "review.yaml", workflow.content),
  mcp: reference("mcp", "probe.md", mcp.content),
}
const temporary = new Composition.TemporaryInput({
  source: "temporary",
  agents: [refs.agent],
  workflow: refs.workflow,
  bindings: {
    orchestrator: new Composition.Binding({ prompts: [refs.prompt], skills: [refs.skill], commands: [refs.command] }),
    "agents/coder": new Composition.Binding({ prompts: [refs.prompt], skills: [refs.skill], commands: [refs.command] }),
  },
  presentation: "native",
  requestedCapabilities: ["workspace.read", "workspace.write", "terminal.exec", "browser.navigate", "unknown.power"],
})
const healthyProfile = decodeProfile({
  kind: "custom-profile",
  name: "Healthy",
  description: "Healthy profile",
  agents: temporary.agents,
  workflow: temporary.workflow,
  bindings: temporary.bindings,
  presentation: temporary.presentation,
  requestedCapabilities: temporary.requestedCapabilities,
})
const profileContent = AssetYaml.stringify(healthyProfile)

const setup = (
  extraFiles: ReadonlyArray<{ path: string; content: string }> = [],
  otherFiles: ReadonlyArray<{ path: string; content: string }> = [],
  drivers: Readonly<Record<string, WorkspaceDriver.Interface>> = {},
  waitForActivation = true,
  initializeProject = false,
) =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("omnixa-composition-%2F-http-")
    const directory = path.join(tmp.path, "project")
    const other = path.join(tmp.path, "other")
    yield* Effect.promise(() => Promise.all([fs.mkdir(directory), fs.mkdir(other)]))
    if (initializeProject) yield* Effect.promise(() => initRepo(directory))
    yield* Effect.forEach(
      [
        ...[
          agent,
          prompt,
          skill,
          command,
          workflow,
          mcp,
          { path: ".omnixa/custom-profiles/healthy.yaml", content: profileContent },
          ...extraFiles,
        ].map((file) => ({ ...file, directory })),
        ...otherFiles.map((file) => ({ ...file, directory: other })),
      ],
      (file) =>
        Effect.gen(function* () {
          const target = path.join(file.directory, file.path)
          yield* Effect.promise(() => fs.mkdir(path.dirname(target), { recursive: true }))
          yield* Effect.promise(() => Bun.write(target, file.content))
        }),
    )
    const model = yield* Layer.build(TestLLM.testLayer())
    const llm = Context.get(model, TestLLM.Test)
    const defaultModel = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("test-model") })
    const context = yield* Layer.build(
      createRoutes(
        {
          password: "secret",
          app: { version: "test" },
          database: { path: ":memory:" },
          events: { persist: true },
          config: {
            directory: path.join(tmp.path, "config"),
            project: false,
            content: JSON.stringify({
              model: "test/test-model",
              providers: {
                test: { package: "@omnixa/ai/providers/openai/responses", models: { "test-model": {} } },
              },
            }),
          },
          models: { fetch: false },
          fs: { filewatcher: false },
        },
        () => [],
        [
          LayerNodePlatform.llmClient.replace(Layer.succeed(LLMClient.Service, llm)),
          WorkspaceDriver.node.replace(WorkspaceDriver.registryNode(drivers)),
        ],
      ).pipe(Layer.provide(HttpServer.layerServices)),
    )
    const handler = Context.get(context, HttpRouter.HttpRouter)
      .asHttpEffect()
      .pipe(HttpEffect.toWebHandlerWith(context))
    const locations = Context.get(context, LocationServiceMap.Service)
    const readyLocation = Effect.fnUntraced(function* (directory: string) {
      const location = yield* locations.contextEffect(locationRefForRoute({ directory }))
      // Location boot schedules production plugin activation asynchronously.
      yield* Plugin.awaitActivation.pipe(Effect.provideContext(location))
      yield* useOfflineCatalog([
        {
          info: Provider.Info.make({
            ...Provider.Info.empty(defaultModel.providerID),
            activation: "enabled",
            package: "@omnixa/ai/providers/openai/responses",
          }),
          models: [Model.Info.make(Model.Info.default(defaultModel.providerID, defaultModel.id))],
        },
      ]).pipe(Effect.provideContext(location))
      const models = Context.get(location, Model.Service)
      yield* models.transform((editor) => editor.default.set(defaultModel.providerID, defaultModel.id))
      return location
    })
    const location = yield* waitForActivation
      ? readyLocation(directory)
      : locations.contextEffect(locationRefForRoute({ directory }))
    const request = (
      route: string,
      input: {
        body?: unknown
        directory?: string
        workspace?: string
        authenticated?: boolean
        headers?: Record<string, string>
      } = {},
    ) =>
      Effect.promise(() => {
        const url = new URL(route, "http://omnixa.local")
        url.searchParams.set("directory", input.directory ?? directory)
        if (input.workspace !== undefined) url.searchParams.set("workspace", input.workspace)
        return handler(
          new Request(url, {
            method: input.body === undefined ? "GET" : "POST",
            headers: {
              "content-type": "application/json",
              ...(input.authenticated === false ? {} : { authorization: `Basic ${btoa("omnixa:secret")}` }),
              ...input.headers,
            },
            body: input.body === undefined ? undefined : JSON.stringify(input.body),
          }),
        )
      })
    return { request, directory, other, context, location, locations, readyLocation, llm, defaultModel }
  })

const storedState = Effect.fnUntraced(function* (test: Effect.Success<ReturnType<typeof setup>>) {
  const database = Context.get(test.context, Database.Service)
  return {
    sessions: yield* database.db.select().from(SessionTable).all(),
    inbox: yield* database.db.select().from(SessionInboxTable).all(),
    messages: yield* database.db.select().from(SessionMessageTable).all(),
    snapshots: yield* database.db.select().from(SessionCompositionSnapshotTable).all(),
    events: yield* database.db.select().from(EventTable).all(),
    sequences: yield* database.db.select().from(EventSequenceTable).all(),
  }
})

const observedSessionEvents = Effect.fnUntraced(function* (test: Effect.Success<ReturnType<typeof setup>>) {
  const published = new Array<string>()
  const bus = Context.get(test.context, Bus.Service)
  const unsubscribe = yield* bus.listen((event) =>
    Effect.sync(() => {
      if (event.type.startsWith("session.")) published.push(event.type)
    }),
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  return published
})

const lifecycleResult = Effect.fnUntraced(function* (response: Response) {
  if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Composition.StartResponse)(yield* Effect.promise(() => response.json()))
})

const createSession = Effect.fnUntraced(function* (
  test: Effect.Success<ReturnType<typeof setup>>,
  input: Record<string, unknown> = {},
) {
  const response = yield* test.request("/api/session", {
    body: { location: { directory: test.directory }, ...input },
  })
  if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(yield* Effect.promise(() => response.json()))
    .data
})

const createCustomChild = Effect.fnUntraced(function* (
  test: Effect.Success<ReturnType<typeof setup>>,
  root: Composition.StartResponse,
  title: string,
) {
  if (root.snapshot.version !== 2) throw new Error("Custom child requires a v2 snapshot")
  const executor = root.snapshot.data.executors?.[0]
  if (executor === undefined) throw new Error("Custom child requires a frozen executor")
  const sessions = Context.get(test.context, Session.Service)
  const delegations = Context.get(test.context, DelegationService.Service)
  const delegation = yield* delegations.create({ parentSessionID: root.session.id, agent: executor.id, title })
  const participant = yield* delegations.addParticipant({
    delegationID: delegation.id,
    provider: "internal",
    target: executor.id,
    role: "implementer",
    context: "fresh",
  })
  const child = yield* sessions.create({
    parentID: root.session.id,
    agent: executor.id,
    title,
    source: new SessionSchema.TaskControllerSource({
      kind: "task",
      delegationID: delegation.id,
      participantID: participant.id,
    }),
  })
  yield* delegations.bindParticipant({
    delegationID: delegation.id,
    participantID: participant.id,
    childSessionID: child.id,
  })
  return child
})

const assertNoExecution = Effect.fnUntraced(function* (test: Effect.Success<ReturnType<typeof setup>>) {
  const connections = Context.get(test.location, McpConnection.Service)
  expect(yield* test.llm.requests()).toEqual([])
  expect(yield* connections.facts()).toEqual([])
  expect(yield* connections.connections()).toEqual([])
})

const plan = Effect.fnUntraced(function* (
  test: Effect.Success<ReturnType<typeof setup>>,
  input: unknown = temporary,
  directory = test.directory,
) {
  yield* test.readyLocation(directory)
  const response = yield* test.request("/custom-composition/plan", { body: input, directory })
  if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Composition.Plan)(yield* Effect.promise(() => response.json()))
})

const profileInput = Effect.fnUntraced(function* (
  test: Effect.Success<ReturnType<typeof setup>>,
  profilePath = "healthy.yaml",
  directory = test.directory,
) {
  const response = yield* test.request(`/custom-profile/content?${new URLSearchParams({ path: profilePath })}`, {
    directory,
  })
  if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
  expect(response.status).toBe(200)
  const profile = Schema.decodeUnknownSync(Info)(yield* Effect.promise(() => response.json()))
  return new Composition.ProfileInput({
    source: "profile",
    profilePath: profile.relativePath,
    profileRevision: Composition.Revision.make(profile.revision),
  })
})

const health = Effect.fnUntraced(function* (
  test: Effect.Success<ReturnType<typeof setup>>,
  profilePath = "healthy.yaml",
  directory = test.directory,
) {
  yield* test.readyLocation(directory)
  const response = yield* test.request(`/custom-composition/health?${new URLSearchParams({ path: profilePath })}`, {
    directory,
  })
  if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
  expect(response.status).toBe(200)
  return Schema.decodeUnknownSync(Composition.Health)(yield* Effect.promise(() => response.json()))
})

it.live("saves a captured builtin root without a Session and explicitly adopts the saved Profile over HTTP", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true", OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const rootAsset = {
        path: ".omnixa/agents/roots/release.md",
        content: `---\n${AssetYaml.stringify({
          kind: "agent",
          name: "release-root",
          description: "An asset root",
          config: AssetYaml.stringify({ mode: "primary" }),
        })}---\nFrozen asset root.\n`,
      }
      const test = yield* setup([rootAsset])
      const selected = yield* plan(
        test,
        new Composition.TemporaryInput({
          source: "temporary",
          root: new Composition.BuiltinRoot({ source: "builtin", id: "build" }),
          agents: [],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        }),
        test.other,
      )
      expect(selected.valid).toBe(true)
      if (selected.input.source !== "temporary" || selected.input.root?.revision === undefined)
        throw new Error("Expected a captured builtin root before saving the Profile")
      const candidate = {
        name: "Saved build",
        description: "Build from a saved Profile",
        relativePath: "team/build.yaml",
        profile: {
          kind: "custom-profile",
          name: "Saved build",
          description: "Build from a saved Profile",
          root: selected.input.root,
          agents: selected.input.agents,
          bindings: selected.input.bindings,
          presentation: selected.input.presentation,
          requestedCapabilities: selected.input.requestedCapabilities,
        },
      }
      const before = yield* storedState(test)
      expect(before.sessions).toEqual([])
      expect(before.snapshots).toEqual([])
      const published = yield* observedSessionEvents(test)
      const response = yield* test.request("/custom-profile/apply", {
        directory: `${test.other}/.`,
        body: { candidate, overwrite: false },
      })
      if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
      expect(response.status).toBe(200)
      const saved = Schema.decodeUnknownSync(Info)(yield* Effect.promise(() => response.json()))
      expect(saved.profile.root).toEqual(selected.input.root)
      expect(saved.profile.agents).toEqual([])
      const bytes = yield* Effect.promise(() =>
        Bun.file(path.join(test.other, ".omnixa/custom-profiles/team/build.yaml")).text(),
      )
      expect(saved.revision).toBe(Revision.make(Hash.sha256(Buffer.from(bytes))))
      const listed = yield* test.request("/custom-profile?search=Saved", { directory: test.other })
      expect(listed.status).toBe(200)
      expect(yield* Effect.promise(() => listed.json())).toMatchObject({
        assets: [{ relativePath: saved.relativePath, revision: saved.revision }],
        invalid: [],
      })
      const content = yield* test.request(
        `/custom-profile/content?${new URLSearchParams({ path: saved.relativePath })}`,
        { directory: test.other },
      )
      expect(content.status).toBe(200)
      expect(Schema.decodeUnknownSync(Info)(yield* Effect.promise(() => content.json()))).toEqual(saved)
      const foreign = yield* test.request(
        `/custom-profile/content?${new URLSearchParams({ path: saved.relativePath })}`,
      )
      expect(foreign.status).toBe(404)
      const composition = new Composition.ProfileInput({
        source: "profile",
        profilePath: saved.relativePath,
        profileRevision: Composition.Revision.make(saved.revision),
      })
      const preview = yield* plan(test, composition, test.other)
      expect(preview.valid).toBe(true)
      expect(preview.input).toEqual(composition)
      expect(preview.orchestrator?.id).toBe(Agent.ID.make("build"))
      expect(preview.agents).toEqual([])
      const foreignStart = yield* test.request("/custom-composition/start", {
        body: { composition: preview.input, expectedPlanDigest: preview.digest },
      })
      expect(foreignStart.status).toBe(422)
      const failure = Schema.decodeUnknownSync(CompositionResolveError)(
        yield* Effect.promise(() => foreignStart.json()),
      )
      expect(failure.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("profile_not_found")
      expect(yield* storedState(test)).toEqual(before)
      expect(published).toEqual([])
      const sessionID = Session.ID.create()
      const created = yield* lifecycleResult(
        yield* test.request("/custom-composition/start", {
          directory: test.other,
          body: { sessionID, composition: preview.input, expectedPlanDigest: preview.digest },
        }),
      )
      expect(created.session).toMatchObject({
        id: sessionID,
        mode: "custom",
        agent: "build",
        location: { directory: test.other },
      })
      expect(created.session.controller).toBeUndefined()
      expect(created.snapshot).toMatchObject({
        version: 2,
        sessionID,
        digest: preview.digest,
        profilePath: saved.relativePath,
        profileRevision: saved.revision,
        data: { root: saved.profile.root, agents: [], executors: [], sourceLocation: { directory: test.other } },
      })
      const readback = yield* test.request(`/api/session/${sessionID}`)
      expect(readback.status).toBe(200)
      expect(yield* Effect.promise(() => readback.json())).toMatchObject({
        data: { id: sessionID, agent: "build", location: { directory: created.session.location.directory } },
      })
      const after = yield* storedState(test)
      expect(after.sessions).toHaveLength(1)
      expect(after.snapshots).toHaveLength(1)
      expect(after.inbox.some((input) => input.type === "user")).toBe(false)
      expect(after.messages.some((message) => message.type === "user")).toBe(false)
      expect(after.events.filter((event) => event.aggregate_id === sessionID).map((event) => event.type)).toEqual([
        Bus.versionedType(SessionEvent.Created.type, SessionEvent.Created.durable.version),
      ])
      const database = Context.get(test.context, Database.Service)
      expect(yield* database.db.select().from(MetaAgentSessionTable).all()).toEqual([])
      const aliasInput = new Composition.TemporaryInput({
        source: "temporary",
        root: new Composition.AssetRoot({
          source: "asset",
          id: Agent.ID.make("release-root"),
          kind: "agent",
          relativePath: " roots\\release.md ",
          revision: Composition.Revision.make(Hash.sha256(rootAsset.content)),
        }),
        agents: [],
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      })
      const aliasPlan = yield* plan(test, aliasInput)
      expect(aliasPlan.valid).toBe(true)
      expect(aliasPlan.input).toEqual(aliasInput)
      expect(aliasPlan.digest).toBe(CompositionDigest.computeCompositionDigest(aliasInput))
      const aliasID = Session.ID.create()
      const aliasCreated = yield* lifecycleResult(
        yield* test.request("/custom-composition/start", {
          body: { sessionID: aliasID, composition: aliasInput, expectedPlanDigest: aliasPlan.digest },
        }),
      )
      expect(aliasCreated.session).toMatchObject({ id: aliasID, mode: "custom", agent: "release-root" })
      expect(aliasCreated.session.controller).toBeUndefined()
      expect(aliasCreated.snapshot).toMatchObject({
        version: 2,
        sessionID: aliasID,
        digest: CompositionDigest.computeCompositionDigest(aliasInput),
        data: {
          root: { source: "asset", id: "release-root", relativePath: "roots/release.md" },
          orchestrator: {
            id: "release-root",
            mode: "primary",
            system: "Frozen asset root.",
            originRelativePath: "roots/release.md",
          },
          agents: [],
          executors: [],
        },
      })
      yield* Effect.promise(() => fs.unlink(path.join(test.directory, rootAsset.path)))
      const assets = Context.get(test.location, AgentAsset.Service)
      yield* assets.reload()
      expect(yield* assets.getByPath("roots/release.md").pipe(Effect.flip)).toBeInstanceOf(AgentAsset.NotFoundError)
      expect((yield* plan(test, aliasInput)).valid).toBe(false)
      const committed = yield* storedState(test)
      const aliasRetry = yield* lifecycleResult(
        yield* test.request("/custom-composition/start", {
          body: { sessionID: aliasID, composition: aliasInput, expectedPlanDigest: aliasPlan.digest },
        }),
      )
      expect(aliasRetry).toEqual(aliasCreated)
      expect(yield* storedState(test)).toEqual(committed)
      expect(committed.sessions).toHaveLength(after.sessions.length + 1)
      expect(committed.snapshots).toHaveLength(after.snapshots.length + 1)
      expect(committed.sessions.filter((session) => session.id === aliasID)).toHaveLength(1)
      expect(committed.snapshots.filter((snapshot) => snapshot.session_id === aliasID)).toHaveLength(1)
      expect(committed.events.filter((event) => event.aggregate_id === aliasID).map((event) => event.type)).toEqual([
        Bus.versionedType(SessionEvent.Created.type, SessionEvent.Created.durable.version),
      ])
      expect(yield* database.db.select().from(MetaAgentSessionTable).all()).toEqual([])
      yield* assertNoExecution(test)
    }),
  ),
)

it.live("rejects saved Profile and builtin root drift over HTTP without Session residue", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true", OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const selected = yield* plan(
        test,
        new Composition.TemporaryInput({
          source: "temporary",
          root: new Composition.BuiltinRoot({ source: "builtin", id: "build" }),
          agents: [],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        }),
        test.other,
      )
      expect(selected.valid).toBe(true)
      if (selected.input.source !== "temporary" || selected.input.root?.revision === undefined)
        throw new Error("Expected a captured builtin root before saving the Profile")
      const candidate = {
        name: "Drift build",
        description: "Original saved definition",
        relativePath: "drift.yaml",
        profile: {
          kind: "custom-profile",
          name: "Drift build",
          description: "Original saved definition",
          root: selected.input.root,
          agents: [],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        },
      }
      const response = yield* test.request("/custom-profile/apply", {
        directory: test.other,
        body: { candidate, overwrite: false },
      })
      if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
      const saved = Schema.decodeUnknownSync(Info)(yield* Effect.promise(() => response.json()))
      const preview = yield* plan(
        test,
        new Composition.ProfileInput({
          source: "profile",
          profilePath: saved.relativePath,
          profileRevision: Composition.Revision.make(saved.revision),
        }),
        test.other,
      )
      expect(preview.valid).toBe(true)
      const before = yield* storedState(test)
      expect(before.sessions).toEqual([])
      expect(before.snapshots).toEqual([])
      const published = yield* observedSessionEvents(test)
      const wrongDigest = yield* test.request("/custom-composition/start", {
        directory: test.other,
        body: { composition: preview.input, expectedPlanDigest: "b".repeat(64) },
      })
      expect(wrongDigest.status).toBe(422)
      expect(yield* Effect.promise(() => wrongDigest.json())).toMatchObject({ code: "plan_digest_mismatch" })
      const updatedResponse = yield* test.request("/custom-profile/apply", {
        directory: test.other,
        body: {
          candidate: {
            ...candidate,
            description: "Updated saved definition",
            profile: { ...candidate.profile, description: "Updated saved definition" },
          },
          baseRevision: saved.revision,
          overwrite: true,
        },
      })
      expect(updatedResponse.status).toBe(200)
      const updated = Schema.decodeUnknownSync(Info)(yield* Effect.promise(() => updatedResponse.json()))
      expect(updated.revision).not.toBe(saved.revision)
      const staleProfile = yield* test.request("/custom-composition/start", {
        directory: test.other,
        body: { composition: preview.input, expectedPlanDigest: preview.digest },
      })
      expect(staleProfile.status).toBe(422)
      const profileFailure = Schema.decodeUnknownSync(CompositionResolveError)(
        yield* Effect.promise(() => staleProfile.json()),
      )
      expect(profileFailure.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("profile_stale_revision")
      const current = yield* plan(test, yield* profileInput(test, updated.relativePath, test.other), test.other)
      expect(current.valid).toBe(true)
      const location = yield* test.readyLocation(test.other)
      const agents = Context.get(location, Agent.Service)
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (info) => {
          info.system = "Changed after the saved Profile preview."
        }),
      )
      const staleRoot = yield* test.request("/custom-composition/start", {
        directory: test.other,
        body: { composition: current.input, expectedPlanDigest: current.digest },
      })
      expect(staleRoot.status).toBe(422)
      const rootFailure = Schema.decodeUnknownSync(CompositionResolveError)(
        yield* Effect.promise(() => staleRoot.json()),
      )
      expect(rootFailure.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("builtin_root_stale_revision")
      yield* agents.transform((editor) =>
        editor.update(Agent.ID.make("build"), (info) => {
          info.hidden = true
        }),
      )
      const unavailable = yield* plan(test, current.input, test.other)
      expect(unavailable.valid).toBe(false)
      expect(unavailable.orchestrator).toBeUndefined()
      expect(unavailable.diagnostics.map((diagnostic) => diagnostic.code)).toContain("builtin_root_unavailable")
      const unavailableStart = yield* test.request("/custom-composition/start", {
        directory: test.other,
        body: { composition: current.input, expectedPlanDigest: current.digest },
      })
      expect(unavailableStart.status).toBe(422)
      const unavailableFailure = Schema.decodeUnknownSync(CompositionResolveError)(
        yield* Effect.promise(() => unavailableStart.json()),
      )
      expect(unavailableFailure.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("builtin_root_unavailable")
      expect(yield* storedState(test)).toEqual(before)
      expect(published).toEqual([])
      yield* assertNoExecution(test)
    }),
  ),
)

it.live("plans and adopts each selected builtin root over HTTP with an empty user inventory", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const database = Context.get(test.context, Database.Service)
      yield* Effect.forEach(["build", "plan", "meta"] as const, (id) =>
        Effect.gen(function* () {
          const preview = yield* plan(
            test,
            new Composition.TemporaryInput({
              source: "temporary",
              root: new Composition.BuiltinRoot({ source: "builtin", id }),
              agents: [],
              bindings: {},
              presentation: "native",
              requestedCapabilities: [],
            }),
            test.other,
          )
          expect(preview.valid).toBe(true)
          expect(preview.orchestrator?.id).toBe(Agent.ID.make(id))
          if (preview.input.source !== "temporary" || preview.orchestrator === undefined)
            throw new Error("Expected the selected builtin root plan")
          expect(preview.input.root?.revision).toBeDefined()
          const model = id === "meta" ? test.defaultModel : undefined
          const sessionID = Session.ID.create()
          const admitted = yield* Deferred.make<SessionEvent.InboxEnqueued>()
          const bus = Context.get(test.context, Bus.Service)
          const unsubscribe = yield* bus.listen((event) => {
            if (
              !Schema.is(SessionEvent.InboxEnqueued)(event) ||
              event.data.sessionID !== sessionID ||
              event.data.item.type !== "synthetic"
            )
              return Effect.void
            return Deferred.succeed(admitted, event).pipe(Effect.asVoid)
          })
          yield* Effect.addFinalizer(() => unsubscribe)
          const created = yield* lifecycleResult(
            yield* test.request("/custom-composition/start", {
              directory: test.other,
              body: {
                sessionID,
                composition: preview.input,
                expectedPlanDigest: preview.digest,
                model,
              },
            }),
          )
          // Plan's Created subscriber admits its reminder asynchronously, without resuming the Session.
          const reminder = yield* id === "plan"
            ? awaitWithTimeout(Deferred.await(admitted), "Plan reminder was not durably admitted after Custom Created")
            : Effect.void
          expect(created.session.agent).toBe(Agent.ID.make(id))
          expect(created.session.model).toEqual(model)
          expect(created.snapshot.data).toMatchObject({
            root: preview.input.root,
            orchestrator: preview.orchestrator,
            agents: [],
            executors: [],
          })
          const owners = yield* database.db.select().from(MetaAgentSessionTable).all()
          expect(owners.filter((owner) => owner.session_id === created.session.id)).toHaveLength(id === "meta" ? 1 : 0)
          expect(created.session.controller?.kind).toBe(id === "meta" ? "root" : undefined)
          const readback = yield* test.request(`/api/session/${sessionID}`, { directory: test.other })
          expect(readback.status).toBe(200)
          const currentSession = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
            yield* Effect.promise(() => readback.json()),
          ).data
          const state = yield* storedState(test)
          expect(state.sessions.find((session) => session.id === currentSession.id)?.time_updated).toBe(
            DateTime.toEpochMillis(currentSession.time.updated),
          )
          if (reminder) {
            expect(reminder.data.item).toMatchObject({
              type: "synthetic",
              payload: { text: expect.stringContaining("You are in Plan mode.") },
            })
            expect(state.inbox.find((input) => input.id === reminder.data.inboxID)).toMatchObject({
              session_id: sessionID,
              type: "synthetic",
              enqueued_seq: reminder.durable.seq,
              time_created: reminder.created,
            })
            expect(state.events.find((event) => event.id === reminder.id)).toMatchObject({
              aggregate_id: sessionID,
              seq: reminder.durable.seq,
              created: reminder.created,
              type: Bus.versionedType(SessionEvent.InboxEnqueued.type, SessionEvent.InboxEnqueued.durable.version),
            })
            expect(DateTime.toEpochMillis(currentSession.time.updated)).toBe(reminder.created)
          }
          expect(state.inbox.some((input) => input.type === "user")).toBe(false)
          expect(state.messages.some((message) => message.type === "user")).toBe(false)
          expect(yield* test.llm.requests()).toEqual([])
          const retried = yield* lifecycleResult(
            yield* test.request("/custom-composition/start", {
              directory: test.other,
              body: {
                sessionID: created.session.id,
                composition: preview.input,
                expectedPlanDigest: preview.digest,
                model,
              },
            }),
          )
          expect(retried).toEqual(
            new Composition.StartResponse({ session: currentSession, snapshot: created.snapshot }),
          )
          expect(yield* storedState(test)).toEqual(state)
          expect(yield* database.db.select().from(MetaAgentSessionTable).all()).toEqual(owners)
          expect(yield* test.llm.requests()).toEqual([])
        }),
      )
      expect(yield* Effect.promise(() => fs.readdir(test.other))).toEqual([])
    }),
  ),
)

it.live(
  "rejects stale builtin root confirmation over HTTP without Session residue",
  () =>
    withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
      Effect.gen(function* () {
        const test = yield* setup()
        const preview = yield* plan(
          test,
          new Composition.TemporaryInput({
            source: "temporary",
            root: new Composition.BuiltinRoot({ source: "builtin", id: "build" }),
            agents: [],
            bindings: {},
            presentation: "native",
            requestedCapabilities: [],
          }),
          test.other,
        )
        expect(preview.valid).toBe(true)
        const location = yield* test.readyLocation(test.other)
        yield* Context.get(location, Agent.Service).transform((editor) =>
          editor.update(Agent.ID.make("build"), (info) => {
            info.system = "Changed after the preview."
          }),
        )
        const before = yield* storedState(test)
        const response = yield* test.request("/custom-composition/start", {
          directory: test.other,
          body: { composition: preview.input, expectedPlanDigest: preview.digest },
        })
        expect(response.status).toBe(422)
        const failure = Schema.decodeUnknownSync(CompositionResolveError)(yield* Effect.promise(() => response.json()))
        expect(failure).toMatchObject({ _tag: "CompositionResolveError", code: "invalid_composition_plan" })
        expect(failure.diagnostics?.map((diagnostic) => diagnostic.code)).toContain("builtin_root_stale_revision")
        expect(yield* storedState(test)).toEqual(before)
        expect(yield* test.llm.requests()).toEqual([])
      }),
    ),
  30_000,
)

it.live("keeps rejected builtin root credentials out of the HTTP Plan", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const location = yield* test.readyLocation(test.other)
      yield* Context.get(location, Agent.Service).transform((editor) =>
        editor.update(Agent.ID.make("build"), (info) => {
          info.request.headers = { Authorization: "Bearer builtin-http-secret-fixture" }
        }),
      )
      const response = yield* test.request("/custom-composition/plan", {
        directory: test.other,
        body: {
          source: "temporary",
          root: { source: "builtin", id: "build" },
          agents: [],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        },
      })
      expect(response.status).toBe(200)
      expect(yield* Effect.promise(() => response.clone().text())).not.toContain("builtin-http-secret-fixture")
      const rejected = Schema.decodeUnknownSync(Composition.Plan)(yield* Effect.promise(() => response.json()))
      expect(rejected.valid).toBe(false)
      expect(rejected.orchestrator).toBeUndefined()
      expect(rejected.diagnostics.map((diagnostic) => diagnostic.code)).toContain("orchestrator_request_credentials")
      expect(yield* test.llm.requests()).toEqual([])
    }),
  ),
)

it.live("plans and freezes cold Locations through production plugin activation", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const planning = yield* setup([], [], {}, false)
      const planned = yield* planning.request("/custom-composition/plan", { body: temporary })
      if (planned.status !== 200) throw new Error(yield* Effect.promise(() => planned.clone().text()))
      expect(planned.status).toBe(200)
      expect(Schema.decodeUnknownSync(Composition.Plan)(yield* Effect.promise(() => planned.json()))).toMatchObject({
        valid: true,
        diagnostics: [],
        agents: [{ name: "coder" }],
      })
      expect((yield* storedState(planning)).sessions).toEqual([])
      expect((yield* storedState(planning)).snapshots).toEqual([])
      yield* assertNoExecution(planning)

      const starting = yield* setup([], [], {}, false)
      const created = yield* lifecycleResult(
        yield* starting.request("/custom-composition/start", { body: { composition: temporary } }),
      )
      expect(created.session).toMatchObject({ mode: "custom", agent: "meta" })
      expect(created.snapshot).toMatchObject({
        version: 2,
        sessionID: created.session.id,
        data: {
          orchestrator: { id: "meta" },
          executors: [{ relativePath: refs.agent.relativePath, revision: refs.agent.revision }],
        },
      })
      expect((yield* storedState(starting)).snapshots).toMatchObject([
        { session_id: created.session.id, version: 2, digest: created.snapshot.digest },
      ])
      yield* assertNoExecution(starting)
    }),
  ),
)

it.live("plans real assets and capabilities without sessions, model calls, snapshots, or MCP connections", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const before = yield* storedState(test)
      const connections = Context.get(test.location, McpConnection.Service)
      expect(yield* connections.facts()).toEqual([])
      const result = yield* plan(test)
      expect(result.valid).toBe(true)
      expect(result.diagnostics).toEqual([])
      expect(result.agents).toMatchObject([
        { name: "coder", consumerKey: "agents/coder", revision: refs.agent.revision },
      ])
      expect(result.workflow).toMatchObject({ name: "review", steps: [{ id: "review", agent: "coder" }] })
      expect(result.instructions.some((instruction) => instruction.content.includes("Be precise."))).toBe(true)
      expect(result.skills).toMatchObject([
        { name: "review", revision: refs.skill.revision },
        { name: "review", revision: refs.skill.revision },
      ])
      expect(result.commands).toMatchObject([
        { name: "check", invocation: "check", args: "target", source: "Check $ARGUMENTS.\n" },
      ])
      expect(result.capabilities.map((capability) => [capability.id, capability.status])).toEqual([
        ["workspace.read", "unsupported"],
        ["workspace.write", "unsupported"],
        ["terminal.exec", "unsupported"],
        ["browser.navigate", "unsupported"],
        ["unknown.power", "unsupported"],
      ])
      expect(result.costPreview).toMatchObject({ agentCount: 1, maxConcurrency: 1 })
      expect((yield* plan(test)).digest).toBe(result.digest)
      const profile = yield* plan(test, yield* profileInput(test))
      expect(profile.valid).toBe(true)
      expect(profile.agents).toEqual(result.agents)
      expect(profile.commands).toEqual(result.commands)
      expect(profile.instructions).toEqual(result.instructions)
      expect(yield* health(test)).toEqual(
        new Composition.Health({ status: "healthy", diagnostics: [], staleRevisions: [] }),
      )
      expect(yield* connections.facts()).toEqual([])
      expect(yield* connections.connections()).toEqual([])
      expect(yield* test.llm.requests()).toEqual([])
      expect(yield* storedState(test)).toEqual(before)
      expect(before.sessions).toEqual([])
      expect(before.snapshots).toEqual([])
    }),
  ),
)

it.live("returns profile freshness and missing-asset diagnostics from the current owner state", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const before = yield* storedState(test)
      const input = yield* profileInput(test)
      const original = yield* plan(test, input)
      const content = `${prompt.content}Use the current sources.\n`
      yield* Effect.promise(() => Bun.write(path.join(test.directory, prompt.path), content))
      yield* test.locations.invalidate(locationRefForRoute({ directory: test.directory }))
      const degraded = yield* health(test)
      expect(degraded.status).toBe("degraded")
      expect(degraded.staleRevisions).toEqual([
        new Composition.StaleRevision({
          kind: "prompt",
          relativePath: refs.prompt.relativePath,
          expectedRevision: refs.prompt.revision,
          currentRevision: Composition.Revision.make(Hash.sha256(Buffer.from(content))),
          target: new AssetPlacement.Target({
            scope: "location",
            root: AbsolutePath.make(path.join(test.directory, ".omnixa/prompts")),
          }),
        }),
      ])
      const stale = yield* plan(test, input)
      expect(stale.valid).toBe(false)
      expect(stale.digest).toBe(original.digest)
      expect(stale.diagnostics.map((diagnostic) => diagnostic.code)).toContain("prompt_stale_revision")
      expect(stale.instructions.some((instruction) => instruction.content.includes("Use the current sources."))).toBe(
        true,
      )
      yield* Effect.promise(() => fs.unlink(path.join(test.directory, prompt.path)))
      yield* test.locations.invalidate(locationRefForRoute({ directory: test.directory }))
      const broken = yield* health(test)
      expect(broken.status).toBe("broken")
      expect(broken.diagnostics.map((diagnostic) => diagnostic.code)).toContain("prompt_not_found")
      expect(broken.staleRevisions).toEqual([])
      expect(yield* test.llm.requests()).toEqual([])
      expect(yield* storedState(test)).toEqual(before)
    }),
  ),
)

it.live("gates planning while profiles, health and references remain readable without custom capability headers", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "false", OMNIXA_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const before = yield* storedState(test)
      const input = yield* profileInput(test)
      yield* Effect.forEach([temporary, input], (composition) =>
        Effect.gen(function* () {
          const response = yield* test.request("/custom-composition/plan", { body: composition })
          expect(response.status).toBe(400)
          expect(yield* Effect.promise(() => response.json())).toMatchObject({
            _tag: "UnsupportedProductModeError",
            mode: "custom",
          })
        }),
      )
      expect((yield* health(test)).status).toBe("healthy")
      const references = yield* test.request(
        `/custom-composition/references?${new URLSearchParams({ kind: "agent", path: refs.agent.relativePath })}`,
      )
      expect(references.status).toBe(200)
      expect(yield* Effect.promise(() => references.json())).toMatchObject({
        profiles: [{ name: "Healthy", relativePath: "healthy.yaml" }],
      })
      expect((yield* withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () => plan(test, input))).valid).toBe(true)
      expect(yield* test.llm.requests()).toEqual([])
      expect(yield* storedState(test)).toEqual(before)
    }),
  ),
)

it.live("maps malformed requests and routing failures without turning composition diagnostics into HTTP errors", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup([{ path: ".omnixa/custom-profiles/invalid.yaml", content: "name: Invalid\n" }])
      const before = yield* storedState(test)
      yield* Effect.forEach(
        [
          {},
          { ...temporary, source: "unknown" },
          { ...temporary, agents: [{ ...refs.agent, revision: "invalid" }] },
          { ...temporary, agents: [{ ...refs.agent, kind: "plugin" }] },
          { ...temporary, bindings: { "agents/bad/slash": { prompts: [], skills: [] } } },
        ],
        (body) =>
          Effect.gen(function* () {
            const response = yield* test.request("/custom-composition/plan", { body })
            expect(response.status).toBe(400)
            expect(yield* Effect.promise(() => response.json())).toMatchObject({
              _tag: "InvalidRequestError",
              kind: "Payload",
            })
          }),
      )
      const absent = yield* plan(
        test,
        new Composition.ProfileInput({
          source: "profile",
          profilePath: "missing.yaml",
          profileRevision: refs.agent.revision,
        }),
      )
      expect(absent.valid).toBe(false)
      expect(absent.diagnostics.map((diagnostic) => diagnostic.code)).toContain("profile_not_found")
      const empty = yield* plan(test, { ...temporary, agents: [], workflow: undefined, bindings: {} })
      expect(empty.valid).toBe(false)
      expect(empty.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid_agent_cardinality")
      expect(empty.costPreview).toMatchObject({ agentCount: 0, maxConcurrency: 1 })
      yield* Effect.forEach(
        ["missing.yaml", "invalid.yaml", "../healthy.yaml", "/healthy.yaml", "NUL.yaml", "healthy.txt", ""],
        (profilePath) =>
          Effect.gen(function* () {
            const response = yield* test.request(
              `/custom-composition/health?${new URLSearchParams({ path: profilePath })}`,
            )
            expect(response.status).toBe(400)
            expect(yield* Effect.promise(() => response.json())).toMatchObject({
              _tag: "InvalidRequestError",
              field: "path",
            })
          }),
      )
      const missingQuery = yield* test.request("/custom-composition/health")
      expect(missingQuery.status).toBe(400)
      expect(yield* Effect.promise(() => missingQuery.json())).toMatchObject({
        _tag: "InvalidRequestError",
        kind: "Query",
      })
      const unsafe = yield* plan(test, {
        ...temporary,
        agents: [{ ...refs.agent, relativePath: "../escape.md" }],
        workflow: undefined,
        bindings: {},
      })
      expect(unsafe.valid).toBe(false)
      expect(unsafe.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid_asset_path")
      const disconnected = yield* plan(test, {
        ...temporary,
        bindings: { "agents/missing": new Composition.Binding({ prompts: [refs.prompt], skills: [], commands: [] }) },
      })
      expect(disconnected.valid).toBe(false)
      expect(disconnected.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unknown_consumer_key")
      expect(disconnected.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unconnected_asset")
      yield* Effect.forEach(
        [
          {
            route: "/custom-profile/apply",
            body: {
              candidate: {
                name: healthyProfile.name,
                description: healthyProfile.description,
                relativePath: "routing.yaml",
                profile: healthyProfile,
              },
              overwrite: false,
            },
          },
          { route: "/custom-composition/plan", body: temporary },
          { route: "/custom-composition/health?path=healthy.yaml", body: undefined },
          {
            route: `/custom-composition/references?${new URLSearchParams({ kind: "agent", path: refs.agent.relativePath })}`,
            body: undefined,
          },
        ],
        (operation) =>
          Effect.gen(function* () {
            const response = yield* test.request(operation.route, {
              body: operation.body,
              directory: path.join(test.directory, "missing-location"),
            })
            expect(response.status).toBe(404)
            expect(yield* Effect.promise(() => response.json())).toMatchObject({ name: "NotFoundError" })
            const denied = yield* test.request(operation.route, { body: operation.body, authenticated: false })
            expect(denied.status).toBe(401)
            const invalidWorkspace = yield* test.request(operation.route, {
              body: operation.body,
              workspace: "not-a-workspace",
            })
            expect(invalidWorkspace.status).toBe(400)
            expect(yield* Effect.promise(() => invalidWorkspace.json())).toMatchObject({
              _tag: "InvalidRequestError",
              field: "workspace",
            })
            const workspace = Workspace.ID.create()
            const missingWorkspace = yield* test.request(operation.route, { body: operation.body, workspace })
            expect(missingWorkspace.status).toBe(404)
            expect(yield* Effect.promise(() => missingWorkspace.json())).toMatchObject({
              name: "NotFoundError",
              data: { message: `Workspace not found: ${workspace}` },
            })
            expect(
              (yield* test.request(operation.route, { body: operation.body, workspace, authenticated: false })).status,
            ).toBe(401)
          }),
      )
      expect(yield* test.llm.requests()).toEqual([])
      expect(yield* storedState(test)).toEqual(before)
    }),
  ),
)

it.live("routes identical profile and asset paths to their owning Location", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const otherAgent = {
        ...agent,
        content: agent.content.replace("You write code.", "You inspect the second project."),
      }
      const otherReference = reference("agent", refs.agent.relativePath, otherAgent.content)
      const otherProfile = decodeProfile({
        ...healthyProfile,
        name: "Other",
        agents: [otherReference],
        workflow: undefined,
        bindings: {},
        requestedCapabilities: [],
      })
      const test = yield* setup(
        [],
        [otherAgent, { path: ".omnixa/custom-profiles/healthy.yaml", content: AssetYaml.stringify(otherProfile) }],
      )
      const before = yield* storedState(test)
      const input = yield* profileInput(test)
      const own = yield* plan(test, input)
      const otherInput = yield* profileInput(test, "healthy.yaml", test.other)
      const other = yield* plan(test, otherInput, test.other)
      expect(other.valid).toBe(true)
      expect(other.agent?.revision).toBe(otherReference.revision)
      expect(own.agent?.revision).toBe(refs.agent.revision)
      expect((yield* plan(test, input, `${test.directory}/.`)).digest).toBe(own.digest)
      expect((yield* plan(test, otherInput, test.other)).digest).toBe(other.digest)
      const foreign = yield* plan(test, input, test.other)
      expect(foreign.valid).toBe(false)
      expect(foreign.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["profile_stale_revision"])
      expect(foreign.agent?.revision).toBe(otherReference.revision)
      expect((yield* health(test)).status).toBe("healthy")
      expect((yield* health(test, "healthy.yaml", test.other)).status).toBe("healthy")
      expect((yield* plan(test, input)).agents).toEqual(own.agents)
      const absent = yield* plan(test, temporary, test.other)
      expect(absent.valid).toBe(false)
      expect(absent.diagnostics.map((diagnostic) => diagnostic.code)).toContain("agent_stale_revision")
      expect(absent.diagnostics.map((diagnostic) => diagnostic.code)).toContain("prompt_not_found")
      expect(yield* test.llm.requests()).toEqual([])
      expect(yield* storedState(test)).toEqual(before)
    }),
  ),
)

it.live("rejects unavailable MCP starts and upgrades without executing or publishing Session events", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const marker = path.join(test.directory, "mcp-started.txt")
      const profile = decodeProfile({
        ...healthyProfile,
        name: "MCP profile",
        mcpBindings: [
          {
            serverName: "probe",
            ref: { relativePath: refs.mcp.relativePath, revision: refs.mcp.revision },
            transport: "stdio",
            command: ["bun", "-e", `await Bun.write(${JSON.stringify(marker)}, "started")`],
          },
        ],
      })
      yield* Effect.promise(() =>
        Bun.write(path.join(test.directory, ".omnixa/custom-profiles/mcp.yaml"), AssetYaml.stringify(profile)),
      )
      const profiles = Context.get(test.location, CustomProfile.Service)
      yield* profiles.reload()
      const source = yield* createSession(test, { title: "Ordinary source" })
      const before = yield* storedState(test)
      const published = yield* observedSessionEvents(test)
      const input = yield* profileInput(test, "mcp.yaml")
      const result = yield* plan(test, input)
      expect(result.valid).toBe(false)
      expect(result.mcp.requested).toMatchObject([{ serverName: "probe", ref: { revision: refs.mcp.revision } }])
      expect(result.mcp.effective).toEqual([])
      expect(result.mcp.denied).toMatchObject([{ serverName: "probe", reason: "not_connected" }])
      expect((yield* health(test, "mcp.yaml")).status).toBe("broken")
      expect(JSON.stringify(result)).not.toContain(marker)
      const connections = Context.get(test.location, McpConnection.Service)
      expect(yield* connections.facts()).toEqual([])
      expect(yield* connections.connections()).toEqual([])
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
      yield* Effect.forEach(
        [
          { route: "/custom-composition/start", body: { composition: input }, status: 422 },
          {
            route: "/custom-composition/upgrade",
            body: { sessionID: source.id, composition: input },
            status: 422,
          },
          {
            route: "/custom-composition/upgrade",
            body: { sessionID: Session.ID.create(), composition: input },
            status: 404,
          },
        ],
        (operation) =>
          Effect.gen(function* () {
            const response = yield* test.request(operation.route, { body: operation.body })
            expect(response.status).toBe(operation.status)
            expect(yield* Effect.promise(() => response.json())).toMatchObject({
              _tag: operation.status === 422 ? "CompositionResolveError" : "SessionNotFoundError",
              ...(operation.status === 422 ? { code: "invalid_composition_plan" } : {}),
            })
            expect(yield* storedState(test)).toEqual(before)
          }),
      )
      expect(published).toEqual([])
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
      yield* assertNoExecution(test)
    }),
  ),
)

it.live("commits Custom roots and snapshots atomically and adopts exact frozen retries", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const composition = yield* profileInput(test)
      const expectedPlanDigest = (yield* plan(test, composition)).digest
      const sessionID = Session.ID.create()
      const observed = new Array<{ session: boolean; snapshot: boolean }>()
      const committed = yield* Deferred.make<void>()
      const bus = Context.get(test.context, Bus.Service)
      // Global owners are private dependencies of the Location graph; listen on the host Bus.
      const unsubscribe = yield* bus.listen((event) => {
        if (!Schema.is(SessionEvent.Created)(event) || event.data.sessionID !== sessionID) return Effect.void
        return Effect.gen(function* () {
          const state = yield* storedState(test)
          observed.push({
            session: state.sessions.some(
              (row) => row.id === sessionID && row.mode === "custom" && row.agent === "meta",
            ),
            snapshot: state.snapshots.some((row) => row.session_id === sessionID && row.version === 2),
          })
        }).pipe(
          Effect.provideContext(test.context),
          Effect.orDie,
          Effect.onExit((exit) => Deferred.done(committed, exit)),
        )
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      const created = yield* lifecycleResult(
        yield* test.request("/custom-composition/start", {
          body: { sessionID, composition, expectedPlanDigest, title: "Frozen root" },
        }),
      )
      yield* awaitWithTimeout(Deferred.await(committed), "Custom Created event was not observed after HTTP start")
      expect(created.session).toMatchObject({
        id: sessionID,
        mode: "custom",
        agent: "meta",
        title: "Frozen root",
        location: { directory: test.directory },
      })
      expect(created.session.parentID).toBeUndefined()
      expect(created.session.fork).toBeUndefined()
      expect(created.snapshot).toMatchObject({
        version: 2,
        sessionID,
        digest: expectedPlanDigest,
        profilePath: composition.profilePath,
        profileRevision: composition.profileRevision,
        data: { executors: [{ relativePath: refs.agent.relativePath, revision: refs.agent.revision }] },
      })
      const before = yield* storedState(test)
      expect(before.sessions).toMatchObject([{ id: sessionID, mode: "custom", agent: "meta" }])
      expect(before.snapshots).toMatchObject([
        {
          session_id: sessionID,
          version: created.snapshot.version,
          digest: created.snapshot.digest,
          profile_path: created.snapshot.profilePath,
          profile_revision: created.snapshot.profileRevision,
          data: Schema.encodeSync(Composition.SnapshotData)(created.snapshot.data),
          time_created: created.snapshot.createdAt,
        },
      ])
      expect(before.inbox).toEqual([])
      expect(before.messages).toEqual([])
      expect(before.events.filter((event) => event.aggregate_id === sessionID)).toMatchObject([
        { type: Bus.versionedType(SessionEvent.Created.type, SessionEvent.Created.durable.version) },
      ])
      expect(observed).toEqual([{ session: true, snapshot: true }])

      yield* Effect.promise(() => fs.unlink(path.join(test.directory, ".omnixa/custom-profiles/healthy.yaml")))
      const profiles = Context.get(test.location, CustomProfile.Service)
      yield* profiles.reload()
      const retried = yield* lifecycleResult(
        yield* test.request("/custom-composition/start", {
          body: { sessionID, composition, expectedPlanDigest, title: "Retry title" },
        }),
      )
      expect(retried).toEqual(created)
      expect(yield* storedState(test)).toEqual(before)
      const changed = yield* test.request("/custom-composition/start", {
        body: { sessionID, composition: { ...composition, profileRevision: "b".repeat(64) } },
      })
      expect(changed.status).toBe(409)
      expect(yield* Effect.promise(() => changed.json())).toMatchObject({ _tag: "ConflictError", resource: sessionID })
      const mismatch = yield* test.request("/custom-composition/start", {
        body: { sessionID, composition, expectedPlanDigest: "b".repeat(64) },
      })
      expect(mismatch.status).toBe(422)
      expect(yield* Effect.promise(() => mismatch.json())).toMatchObject({
        _tag: "CompositionResolveError",
        code: "plan_digest_mismatch",
      })
      const missingProfile = yield* test.request("/custom-composition/start", { body: { composition } })
      expect(missingProfile.status).toBe(422)
      expect(yield* Effect.promise(() => missingProfile.json())).toMatchObject({
        _tag: "CompositionResolveError",
        code: "invalid_composition_plan",
      })
      expect(yield* storedState(test)).toEqual(before)
      expect(observed).toEqual([{ session: true, snapshot: true }])

      const roots = yield* Effect.forEach(["First anonymous root", "Second anonymous root"], (title) =>
        Effect.gen(function* () {
          return yield* lifecycleResult(
            yield* test.request("/custom-composition/start", { body: { composition: temporary, title } }),
          )
        }),
      )
      expect(new Set([sessionID, ...roots.map((root) => root.session.id)]).size).toBe(3)
      roots.forEach((root) => {
        expect(root.session).toMatchObject({ mode: "custom", agent: "meta" })
        expect(root.session.parentID).toBeUndefined()
        expect(root.session.fork).toBeUndefined()
        expect(root.snapshot.sessionID).toBe(root.session.id)
      })
      const after = yield* storedState(test)
      expect(after.sessions).toHaveLength(3)
      expect(after.snapshots).toHaveLength(3)
      expect(after.inbox).toEqual([])
      expect(after.messages).toEqual([])
      expect(after.events).toHaveLength(3)
      yield* assertNoExecution(test)
    }),
  ),
)

it.live("leaves no Session, snapshot, inbox, message, or event residue after invalid starts", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const before = yield* storedState(test)
      const published = yield* observedSessionEvents(test)
      yield* Effect.forEach(
        [
          {
            body: { composition: { ...temporary, agents: [], workflow: undefined, bindings: {} } },
            status: 422,
            error: { _tag: "CompositionResolveError", code: "invalid_composition_plan" },
          },
          {
            body: { composition: { ...temporary, agents: [{ ...refs.agent, revision: "b".repeat(64) }] } },
            status: 422,
            error: { _tag: "CompositionResolveError", code: "invalid_composition_plan" },
          },
          {
            body: { composition: temporary, expectedPlanDigest: "b".repeat(64) },
            status: 422,
            error: { _tag: "CompositionResolveError", code: "plan_digest_mismatch" },
          },
          {
            body: { composition: temporary, expectedPlanDigest: "invalid" },
            status: 400,
            error: { _tag: "InvalidRequestError", kind: "Payload" },
          },
        ],
        (operation) =>
          Effect.gen(function* () {
            const response = yield* test.request("/custom-composition/start", {
              body: { sessionID: Session.ID.create(), ...operation.body },
            })
            expect(response.status).toBe(operation.status)
            expect(yield* Effect.promise(() => response.json())).toMatchObject(operation.error)
            expect(yield* storedState(test)).toEqual(before)
            expect(published).toEqual([])
          }),
      )
      yield* assertNoExecution(test)
    }),
  ),
)

it.live("upgrades idle ordinary Sessions into independent Custom roots while preserving the source", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const source = yield* createSession(test, { title: "Ordinary source", metadata: { source: "upgrade" } })
      const admitted = yield* test.request(`/api/session/${source.id}/prompt`, {
        body: { text: "Keep the source transcript", resume: false },
      })
      expect(admitted.status).toBe(200)
      const database = Context.get(test.context, Database.Service)
      const bus = Context.get(test.context, Bus.Service)
      yield* SessionInbox.promote(database.db, bus, source.id, "steer")
      const before = yield* storedState(test)
      expect(before.messages).toHaveLength(1)
      expect(before.snapshots).toEqual([])
      const first = yield* lifecycleResult(
        yield* test.request("/custom-composition/upgrade", { body: { sessionID: source.id, composition: temporary } }),
      )
      const second = yield* lifecycleResult(
        yield* test.request("/custom-composition/upgrade", {
          body: { sessionID: source.id, composition: temporary, title: "Independent root" },
        }),
      )
      expect(first.session).toMatchObject({
        mode: "custom",
        agent: "meta",
        title: source.title,
        location: source.location,
      })
      expect(second.session).toMatchObject({ mode: "custom", agent: "meta", title: "Independent root" })
      expect(new Set([source.id, first.session.id, second.session.id]).size).toBe(3)
      const after = yield* storedState(test)
      expect(after.sessions.filter((row) => row.id === source.id)).toEqual(before.sessions)
      expect(after.inbox).toEqual(before.inbox)
      expect(after.messages).toEqual(before.messages)
      expect(after.events.filter((event) => event.aggregate_id === source.id)).toEqual(before.events)
      expect(after.sequences.filter((row) => row.aggregate_id === source.id)).toEqual(before.sequences)
      expect(after.sessions).toHaveLength(3)
      expect(after.snapshots).toHaveLength(2)
      expect(after.snapshots.map((row) => row.session_id).sort()).toEqual([first.session.id, second.session.id].sort())
      Array.of(first, second).forEach((result) => {
        expect(result.session.parentID).toBeUndefined()
        expect(result.session.fork).toBeUndefined()
        expect(result.snapshot.sessionID).toBe(result.session.id)
        expect(
          after.events.filter((event) => event.aggregate_id === result.session.id).map((event) => event.type),
        ).toEqual([Bus.versionedType(SessionEvent.Created.type, SessionEvent.Created.durable.version)])
      })
      yield* assertNoExecution(test)
    }),
  ),
)

it.live("upgrades ordinary Sessions whose stored directory has an equivalent route spelling", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const alias = AbsolutePath.make(`${test.directory}${path.sep}.`)
      const source = yield* createSession(test, { location: { directory: alias } })
      expect(source.location.directory).toBe(alias)
      const before = yield* storedState(test)
      const result = yield* lifecycleResult(
        yield* test.request("/custom-composition/upgrade", {
          body: { sessionID: source.id, composition: temporary },
        }),
      )
      expect(result.session).toMatchObject({ mode: "custom", agent: "meta", location: source.location })
      expect(result.snapshot.sessionID).toBe(result.session.id)
      expect(result.session.id).not.toBe(source.id)
      const after = yield* storedState(test)
      expect(after.sessions.filter((row) => row.id === source.id)).toEqual(before.sessions)
      expect(after.events.filter((event) => event.aggregate_id === source.id)).toEqual(before.events)
      expect(after.snapshots).toHaveLength(1)
      yield* assertNoExecution(test)
    }),
  ),
)

it.live("executes frozen Custom command templates through HTTP after their source is deleted", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const root = yield* lifecycleResult(
        yield* test.request("/custom-composition/start", { body: { composition: temporary } }),
      )
      const commands = Context.get(test.location, Command.Service)
      yield* commands.transform((editor) =>
        editor.add({ name: "check", execute: () => Effect.die("Live callback must not execute for Custom") }),
      )
      yield* Effect.promise(() => fs.unlink(path.join(test.directory, command.path)))
      const response = yield* test.request(`/api/session/${root.session.id}/command`, {
        body: { name: "check", text: "$& $$", delivery: "queue" },
      })
      expect(response.status).toBe(204)
      const state = yield* storedState(test)
      expect(state.sessions).toHaveLength(1)
      expect(state.inbox).toMatchObject([
        { session_id: root.session.id, type: "user", delivery: "queue", payload: { text: "Check $& $$." } },
      ])
      yield* withEnv({ OMNIXA_CUSTOM_MODE: "false" }, () =>
        Effect.gen(function* () {
          const disabled = yield* test.request(`/api/session/${root.session.id}/command`, {
            body: { name: "check", text: "blocked" },
          })
          expect(disabled.status).toBe(400)
          expect(yield* storedState(test)).toEqual(state)
        }),
      )
      yield* assertNoExecution(test)
    }),
  ),
)

it.live("rejects foreign Locations, unauthenticated upgrades, and Custom upgrade sources without writes", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const memory = Environment.makeMemoryDriver()
      const test = yield* setup([], [], {
        memory: WorkspaceDriver.make({
          create: ({ workspaceID }) => Effect.succeed({ binding: { workspaceID } }),
          connect: () => Effect.succeed(memory),
          suspendForIdle: () => Effect.void,
          destroy: () => Effect.void,
        }),
      })
      const workspace = Context.get(test.context, Workspace.Service)
      const workspaceID = yield* workspace.create({ provider: "memory" })
      const files = Environment.makeFiles(memory)
      yield* files.mkdir(test.directory)
      const source = yield* createSession(test, { title: "Ordinary source" })
      const custom = yield* lifecycleResult(
        yield* test.request("/custom-composition/start", { body: { composition: temporary } }),
      )
      const before = yield* storedState(test)
      const published = yield* observedSessionEvents(test)
      yield* Effect.forEach(
        [
          { sessionID: source.id, directory: test.other, status: 409, error: { _tag: "ConflictError" } },
          { sessionID: source.id, workspace: workspaceID, status: 409, error: { _tag: "ConflictError" } },
          { sessionID: source.id, authenticated: false, status: 401, error: { _tag: "UnauthorizedError" } },
          {
            sessionID: source.id,
            workspace: "not-a-workspace",
            status: 400,
            error: { _tag: "InvalidRequestError", field: "workspace" },
          },
          {
            sessionID: source.id,
            workspace: Workspace.ID.create(),
            status: 404,
            error: { name: "NotFoundError" },
          },
          { sessionID: custom.session.id, status: 409, error: { _tag: "ConflictError" } },
        ],
        (operation) =>
          Effect.gen(function* () {
            const response = yield* test.request("/custom-composition/upgrade", {
              directory: operation.directory,
              workspace: operation.workspace,
              authenticated: operation.authenticated,
              body: { sessionID: operation.sessionID, composition: temporary },
            })
            expect(response.status).toBe(operation.status)
            expect(yield* Effect.promise(() => response.json())).toMatchObject(operation.error)
            expect(yield* storedState(test)).toEqual(before)
            expect(published).toEqual([])
          }),
      )
      const workspaceLocation = yield* test.locations.contextEffect(
        locationRefForRoute({ directory: test.directory, workspaceID }),
      )
      const connections = Context.get(workspaceLocation, McpConnection.Service)
      expect(yield* connections.facts()).toEqual([])
      expect(yield* connections.connections()).toEqual([])
      yield* assertNoExecution(test)
    }),
  ),
)

it.live("enforces frozen root and child agent selections through ordinary Session endpoints", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const root = yield* lifecycleResult(
        yield* test.request("/custom-composition/start", { body: { composition: temporary } }),
      )
      if (root.snapshot.version !== 2) throw new Error("Custom lifecycle must freeze a v2 snapshot")
      const executor = root.snapshot.data.executors?.[0]
      if (executor === undefined) throw new Error("Custom lifecycle must freeze the selected executor")
      const sessions = Context.get(test.context, Session.Service)
      const delegations = Context.get(test.context, DelegationService.Service)
      const delegation = yield* delegations.create({
        parentSessionID: root.session.id,
        agent: executor.id,
        title: "Generic Custom selection fixture",
      })
      const participant = yield* delegations.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: executor.id,
        role: "implementer",
        context: "fresh",
      })
      const child = yield* sessions.create({
        parentID: root.session.id,
        agent: Agent.ID.make("coder"),
        title: "Executor child",
        source: new SessionSchema.TaskControllerSource({
          kind: "task",
          delegationID: delegation.id,
          participantID: participant.id,
        }),
      })
      yield* delegations.bindParticipant({
        delegationID: delegation.id,
        participantID: participant.id,
        childSessionID: child.id,
      })
      expect(child).toMatchObject({ parentID: root.session.id, mode: "custom", agent: executor.id })
      const before = yield* storedState(test)
      const published = yield* observedSessionEvents(test)
      yield* Effect.forEach(
        [
          { sessionID: root.session.id, agent: "coder" },
          { sessionID: root.session.id, agent: executor.id },
          { sessionID: root.session.id, agent: "unselected" },
          { sessionID: child.id, agent: "meta" },
          { sessionID: child.id, agent: "unselected" },
        ],
        (operation) =>
          Effect.gen(function* () {
            const response = yield* test.request(`/api/session/${operation.sessionID}/agent`, {
              body: { agent: operation.agent },
            })
            expect(response.status).toBe(400)
            expect(yield* Effect.promise(() => response.json())).toMatchObject({
              _tag: "InvalidRequestError",
              kind: "custom_composition",
            })
            expect(yield* storedState(test)).toEqual(before)
            expect(published).toEqual([])
          }),
      )
      yield* Effect.forEach(
        [
          { sessionID: root.session.id, agent: "meta" },
          { sessionID: child.id, agent: "coder" },
        ],
        (operation) =>
          Effect.gen(function* () {
            const response = yield* test.request(`/api/session/${operation.sessionID}/agent`, {
              body: { agent: operation.agent },
            })
            expect(response.status).toBe(204)
          }),
      )
      expect(yield* storedState(test)).toEqual(before)
      expect(published).toEqual([])
      yield* assertNoExecution(test)
    }),
  ),
)

it.live("blocks Custom lifecycle, admission, and execution through HTTP while the kill switch is off", () =>
  withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
    Effect.gen(function* () {
      const test = yield* setup()
      const root = yield* lifecycleResult(
        yield* test.request("/custom-composition/start", { body: { composition: temporary } }),
      )
      const child = yield* createCustomChild(test, root, "Kill-switch child")
      const source = yield* createSession(test)
      const before = yield* storedState(test)
      const published = yield* observedSessionEvents(test)
      yield* withEnv({ OMNIXA_CUSTOM_MODE: "false" }, () =>
        Effect.forEach(
          [
            { route: "/custom-composition/start", body: { composition: temporary } },
            {
              route: "/custom-composition/start",
              body: { sessionID: root.session.id, composition: temporary },
            },
            {
              route: "/custom-composition/upgrade",
              body: { sessionID: source.id, composition: temporary },
            },
            {
              route: "/api/session",
              body: { parentID: root.session.id, agent: "coder" },
              error: { _tag: "InvalidRequestError", field: "parentID", kind: "meta_child_source_required" },
            },
            { route: `/api/session/${child.id}/fork`, body: {} },
            { route: `/api/session/${root.session.id}/agent`, body: { agent: "meta" } },
            { route: `/api/session/${child.id}/agent`, body: { agent: "coder" } },
            {
              route: `/api/session/${root.session.id}/model`,
              body: { model: { id: "test-model", providerID: "test" } },
            },
            ...[root.session.id, child.id].flatMap((sessionID) => [
              {
                route: `/api/session/${sessionID}/prompt`,
                body: { text: "Must not be admitted", resume: false },
              },
              {
                route: `/api/experimental/session/${sessionID}/skill`,
                body: { id: "review", resume: false },
              },
              { route: `/api/session/${sessionID}/generate`, body: { prompt: "Must not reach the provider" } },
              { route: `/api/session/${sessionID}/compact`, body: {} },
            ]),
          ],
          (operation) =>
            Effect.gen(function* () {
              const response = yield* test.request(operation.route, { body: operation.body })
              expect(response.status).toBe(400)
              expect(yield* Effect.promise(() => response.json())).toMatchObject(
                ("error" in operation ? operation.error : undefined) ?? {
                  _tag: "UnsupportedProductModeError",
                  mode: "custom",
                },
              )
              expect(yield* storedState(test)).toEqual(before)
              expect(published).toEqual([])
            }),
        ),
      )
      yield* assertNoExecution(test)
    }),
  ),
)

it.live(
  "finds immutable snapshot references after asset deletion and Session movement, without Custom execution",
  () =>
    withEnv({ OMNIXA_CUSTOM_MODE: "true" }, () =>
      Effect.gen(function* () {
        const memory = Environment.makeMemoryDriver()
        const test = yield* setup(
          [],
          [],
          {
            memory: WorkspaceDriver.make({
              create: ({ workspaceID }) => Effect.succeed({ binding: { workspaceID } }),
              connect: () => Effect.succeed(memory),
              suspendForIdle: () => Effect.void,
              destroy: () => Effect.void,
            }),
          },
          true,
          true,
        )
        const root = yield* lifecycleResult(
          yield* test.request("/custom-composition/start", {
            body: { composition: temporary, title: "Referenced root" },
          }),
        )
        expect(root.snapshot.data.sourceLocation).toEqual({ directory: AbsolutePath.make(test.directory) })
        const sessions = Context.get(test.context, Session.Service)
        const compositions = Context.get(test.context, SessionComposition.Service)
        const child = yield* createCustomChild(test, root, "Referenced child")
        expect((yield* compositions.get(child.id)).data.sourceLocation).toEqual(root.snapshot.data.sourceLocation)
        yield* sessions.prompt({ sessionID: child.id, text: "Fork boundary", resume: false })
        yield* SessionInbox.promote(
          Context.get(test.context, Database.Service).db,
          Context.get(test.context, Bus.Service),
          child.id,
          "steer",
        )
        const fork = yield* sessions.fork({ sessionID: child.id })
        expect((yield* compositions.get(fork.id)).data.sourceLocation).toEqual(root.snapshot.data.sourceLocation)
        const selectedDirectory = path.join(test.directory, "packages", "selected")
        yield* Effect.promise(() => fs.mkdir(selectedDirectory, { recursive: true }))
        const targetFor = Effect.fnUntraced(function* (
          kind: "prompt" | "skill" | "command",
          scope: AssetPlacement.Scope,
        ) {
          const response = yield* test.request(`/${kind}-asset?${new URLSearchParams({ scope })}`, {
            directory: selectedDirectory,
          })
          if (response.status !== 200) throw new Error(yield* Effect.promise(() => response.clone().text()))
          expect(response.status).toBe(200)
          return Schema.decodeUnknownSync(Schema.Struct({ target: AssetPlacement.Target }))(
            yield* Effect.promise(() => response.json()),
          ).target
        })
        const selected = yield* Effect.forEach(["location", "project", "global"] as const, (scope) =>
          Effect.gen(function* () {
            const targets = {
              prompt: yield* targetFor("prompt", scope),
              skill: yield* targetFor("skill", scope),
              command: yield* targetFor("command", scope),
            }
            expect(Object.values(targets).map((target) => target.scope)).toEqual([scope, scope, scope])
            if (scope === "location")
              expect(targets.prompt.root).toBe(AbsolutePath.make(path.join(selectedDirectory, ".omnixa/prompts")))
            if (scope === "project")
              expect(targets.prompt.root).toBe(AbsolutePath.make(path.join(test.directory, ".omnixa/prompts")))
            const contents = {
              prompt: `${prompt.content.trimEnd()}\n${scope} owner.\n`,
              skill: `${skill.content.trimEnd()}\n${scope} owner.\n`,
              command: `${command.content.trimEnd()}\n${scope} owner.\n`,
            }
            yield* Effect.forEach(["prompt", "skill", "command"] as const, (kind) =>
              Effect.gen(function* () {
                const filename = path.join(targets[kind].root, refs[kind].relativePath)
                yield* Effect.promise(() => fs.mkdir(path.dirname(filename), { recursive: true }))
                yield* Effect.promise(() => Bun.write(filename, contents[kind]))
              }),
            )
            const input = new Composition.TemporaryInput({
              source: "temporary",
              root: new Composition.BuiltinRoot({ source: "builtin", id: "build" }),
              agents: [],
              bindings: {
                orchestrator: new Composition.Binding({
                  prompts: [
                    { ...reference("prompt", refs.prompt.relativePath, contents.prompt), target: targets.prompt },
                  ],
                  skills: [{ ...reference("skill", refs.skill.relativePath, contents.skill), target: targets.skill }],
                  commands: [
                    { ...reference("command", refs.command.relativePath, contents.command), target: targets.command },
                  ],
                }),
              },
              presentation: "native",
              requestedCapabilities: [],
            })
            const preview = yield* plan(test, input, selectedDirectory)
            expect(preview.valid).toBe(true)
            if (preview.input.source !== "temporary") throw new Error("Expected the selected-owner temporary plan")
            const candidate = {
              name: `Selected ${scope}`,
              description: `References the ${scope} owner`,
              relativePath: `${scope}.yaml`,
              profile: decodeProfile({
                kind: "custom-profile",
                name: `Selected ${scope}`,
                description: `References the ${scope} owner`,
                root: preview.input.root,
                agents: preview.input.agents,
                bindings: preview.input.bindings,
                presentation: preview.input.presentation,
                requestedCapabilities: preview.input.requestedCapabilities,
              }),
            }
            const savedResponse = yield* test.request("/custom-profile/apply", {
              directory: selectedDirectory,
              body: { candidate, overwrite: false },
            })
            if (savedResponse.status !== 200) throw new Error(yield* Effect.promise(() => savedResponse.clone().text()))
            expect(savedResponse.status).toBe(200)
            const saved = Schema.decodeUnknownSync(Info)(yield* Effect.promise(() => savedResponse.json()))
            const created = yield* lifecycleResult(
              yield* test.request("/custom-composition/start", {
                directory: selectedDirectory,
                body: { composition: preview.input, expectedPlanDigest: preview.digest, title: `Selected ${scope}` },
              }),
            )
            if (created.snapshot.version !== 2) throw new Error("Expected the selected-owner v2 snapshot")
            expect(created.snapshot.data.sourceLocation).toEqual({ directory: AbsolutePath.make(selectedDirectory) })
            expect(created.snapshot.data.prompts).toMatchObject([
              { target: targets.prompt, revision: input.bindings.orchestrator.prompts[0].revision },
            ])
            expect(created.snapshot.data.skills).toMatchObject([
              { target: targets.skill, revision: input.bindings.orchestrator.skills[0].revision },
            ])
            expect(created.snapshot.data.commands).toMatchObject([
              { target: targets.command, revision: input.bindings.orchestrator.commands[0].revision },
            ])
            expect(created.snapshot.data.prompts[0].content).toContain(`${scope} owner.`)
            expect(created.snapshot.data.skills[0].content).toContain(`${scope} owner.`)
            expect(created.snapshot.data.commands[0].source).toContain(`${scope} owner.`)
            return { scope, targets, created, profilePath: saved.relativePath }
          }),
        )
        const workspace = Context.get(test.context, Workspace.Service)
        const workspaceID = yield* workspace.create({ provider: "memory" })
        yield* Environment.makeFiles(memory).mkdir(test.other)
        const aliasDirectory = path.join(path.dirname(test.directory), "alias")
        yield* Effect.promise(() => fs.symlink(test.directory, aliasDirectory, "dir"))
        const aliasOwnerResponse = yield* test.request("/prompt-asset?scope=location", { directory: aliasDirectory })
        if (aliasOwnerResponse.status !== 200)
          throw new Error(yield* Effect.promise(() => aliasOwnerResponse.clone().text()))
        const aliasTarget = Schema.decodeUnknownSync(Schema.Struct({ target: AssetPlacement.Target }))(
          yield* Effect.promise(() => aliasOwnerResponse.json()),
        ).target
        expect(aliasTarget).toEqual(
          new AssetPlacement.Target({
            scope: "location",
            root: AbsolutePath.make(path.join(test.directory, ".omnixa/prompts")),
          }),
        )
        expect(aliasTarget.root).not.toBe(path.join(aliasDirectory, ".omnixa/prompts"))
        const aliasContent =
          "---\nkind: prompt\nname: alias-retained\ndescription: Retained alias prompt\n---\nFrozen alias prompt.\n"
        const aliasRef = reference("prompt", "aliases/retained.md", aliasContent)
        yield* Effect.promise(() => fs.mkdir(path.join(aliasTarget.root, "aliases"), { recursive: true }))
        yield* Effect.promise(() => Bun.write(path.join(aliasTarget.root, aliasRef.relativePath), aliasContent))
        const aliasInput = new Composition.TemporaryInput({
          source: "temporary",
          root: new Composition.BuiltinRoot({ source: "builtin", id: "build" }),
          agents: [],
          bindings: {
            orchestrator: new Composition.Binding({
              prompts: [{ ...aliasRef, target: aliasTarget }],
              skills: [],
              commands: [],
            }),
          },
          presentation: "native",
          requestedCapabilities: [],
        })
        const aliasPlan = yield* plan(test, aliasInput, aliasDirectory)
        expect(aliasPlan.valid).toBe(true)
        if (aliasPlan.input.source !== "temporary") throw new Error("Expected the alias temporary plan")
        const aliasCreated = yield* lifecycleResult(
          yield* test.request("/custom-composition/start", {
            directory: aliasDirectory,
            body: {
              composition: aliasPlan.input,
              expectedPlanDigest: aliasPlan.digest,
              title: "Canonical alias reference",
            },
          }),
        )
        if (aliasCreated.snapshot.version !== 2) throw new Error("Expected the alias v2 snapshot")
        const aliasData = aliasCreated.snapshot.data
        expect(aliasData.sourceLocation).toEqual({ directory: AbsolutePath.make(aliasDirectory) })
        expect(aliasData.prompts[0].target).toEqual(aliasTarget)
        const legacyInput = new Composition.TemporaryInput({
          ...aliasPlan.input,
          bindings: { orchestrator: new Composition.Binding({ prompts: [aliasRef], skills: [], commands: [] }) },
        })
        const aliasProfiles = yield* Effect.forEach(
          [
            { relativePath: "alias-legacy.yaml", name: "Legacy alias", bindings: legacyInput.bindings },
            { relativePath: "alias-target.yaml", name: "Canonical alias", bindings: aliasPlan.input.bindings },
          ],
          (candidate) =>
            Effect.gen(function* () {
              const content = AssetYaml.stringify(
                decodeProfile({
                  kind: "custom-profile",
                  name: candidate.name,
                  description: candidate.name,
                  root: legacyInput.root,
                  agents: [],
                  bindings: candidate.bindings,
                  presentation: "native",
                  requestedCapabilities: [],
                }),
              )
              const filename = path.join(test.directory, ".omnixa/custom-profiles", candidate.relativePath)
              yield* Effect.promise(() => Bun.write(filename, content))
              return { relativePath: candidate.relativePath, content, filename }
            }),
        )
        yield* Effect.forEach([aliasDirectory, test.directory], (directory) =>
          Effect.gen(function* () {
            const location = yield* test.locations.contextEffect(locationRefForRoute({ directory }))
            yield* Context.get(location, CustomProfile.Service).reload()
          }),
        )
        const legacyPrompt = new Composition.SnapshotPromptData({
          relativePath: aliasRef.relativePath,
          revision: aliasRef.revision,
          content: aliasData.prompts[0].content,
        })
        // Retained history predates Target capture. Seed it through the existing durable legacy fixture.
        const legacySnapshots = yield* Effect.forEach([aliasDirectory, test.directory], (directory) =>
          Effect.gen(function* () {
            const session = yield* createLegacySession({
              id: Session.ID.create(),
              location: locationRefForRoute({ directory }),
              mode: "custom",
              agent: Agent.ID.make("build"),
              title: directory === aliasDirectory ? "Legacy alias reference" : "Legacy physical reference",
            }).pipe(Effect.provideContext(test.context))
            const snapshot = new Composition.SnapshotV2({
              version: 2,
              sessionID: session.id,
              digest: CompositionDigest.computeCompositionDigest(legacyInput),
              createdAt: 100,
              data: new Composition.SnapshotDataV2({
                ...aliasData,
                sourceLocation: directory === aliasDirectory ? undefined : locationRefForRoute({ directory }),
                prompts: [legacyPrompt],
                bindings: {
                  orchestrator: new Composition.SnapshotBindingData({
                    prompts: [legacyPrompt],
                    skills: [],
                    commands: [],
                  }),
                },
              }),
            })
            yield* compositions.attach(session.id, snapshot)
            return { session, snapshot }
          }),
        )
        yield* Context.get(test.context, Bus.Service).publish(SessionEvent.Moved, {
          sessionID: legacySnapshots[0].session.id,
          projectID: legacySnapshots[0].session.projectID,
          location: locationRefForRoute({ directory: test.other }),
        })
        // Apply the production movement projector without scheduling model work.
        yield* Context.get(test.context, Bus.Service).publish(SessionEvent.Moved, {
          sessionID: root.session.id,
          projectID: root.session.projectID,
          location: locationRefForRoute({ directory: test.other }),
        })
        yield* Effect.forEach(
          [
            ...new Set([
              path.join(test.directory, prompt.path),
              path.join(aliasTarget.root, aliasRef.relativePath),
              ...selected.flatMap((item) =>
                (["prompt", "skill", "command"] as const).map((kind) =>
                  path.join(item.targets[kind].root, refs[kind].relativePath),
                ),
              ),
            ]),
          ],
          (filename) => Effect.promise(() => fs.unlink(filename)),
        )
        const before = yield* storedState(test)
        const published = yield* observedSessionEvents(test)
        yield* withEnv({ OMNIXA_CUSTOM_MODE: "false" }, () =>
          Effect.gen(function* () {
            const query = `/custom-composition/references?${new URLSearchParams({ kind: "prompt", path: " shared\\precise.md " })}`
            const response = yield* test.request(query, { directory: `${test.directory}/.` })
            expect(response.status).toBe(200)
            const body = yield* Effect.promise(() => response.json())
            expect(body).toMatchObject({ profiles: [{ name: "Healthy" }], snapshotsComplete: true })
            expect(body.snapshots.map((snapshot: { sessionID: string }) => snapshot.sessionID).sort()).toEqual(
              [root.session.id, child.id, fork.id].sort(),
            )
            expect(body.snapshots).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ sessionID: root.session.id, title: "Referenced root" }),
              ]),
            )
            const foreign = yield* test.request(query, { directory: test.other })
            expect(foreign.status).toBe(200)
            expect(yield* Effect.promise(() => foreign.json())).toEqual({
              profiles: [],
              snapshots: [],
              snapshotsComplete: true,
            })
            const denied = yield* test.request(query, { authenticated: false })
            expect(denied.status).toBe(401)
            const aliasQuery = `/custom-composition/references?${new URLSearchParams({ kind: "prompt", path: " aliases\\retained.md " })}`
            const implicitAliasResponse = yield* test.request(aliasQuery, { directory: aliasDirectory })
            expect(implicitAliasResponse.status).toBe(200)
            const implicitAlias = Schema.decodeUnknownSync(CustomCompositionReferencesResponse)(
              yield* Effect.promise(() => implicitAliasResponse.json()),
            )
            expect(implicitAlias.snapshotsComplete).toBe(true)
            expect(implicitAlias.profiles.map((profile) => profile.relativePath)).toEqual(
              aliasProfiles.map((profile) => profile.relativePath).toSorted(),
            )
            expect(implicitAlias.snapshots.map((snapshot) => snapshot.sessionID).toSorted()).toEqual(
              [legacySnapshots[0].session.id, aliasCreated.session.id].toSorted(),
            )
            const canonicalQuery = `/custom-composition/references?${new URLSearchParams({
              kind: "prompt",
              path: aliasRef.relativePath,
              scope: "location",
              targetRoot: aliasTarget.root,
            })}`
            const explicitAliasResponse = yield* test.request(canonicalQuery, { directory: aliasDirectory })
            expect(explicitAliasResponse.status).toBe(200)
            const explicitAlias = Schema.decodeUnknownSync(CustomCompositionReferencesResponse)(
              yield* Effect.promise(() => explicitAliasResponse.json()),
            )
            expect(explicitAlias.snapshotsComplete).toBe(true)
            expect(explicitAlias.profiles.map((profile) => profile.relativePath)).toEqual(["alias-target.yaml"])
            expect(explicitAlias.snapshots.map((snapshot) => snapshot.sessionID)).toEqual([aliasCreated.session.id])
            const explicitPhysicalResponse = yield* test.request(canonicalQuery, { directory: test.directory })
            expect(explicitPhysicalResponse.status).toBe(200)
            const explicitPhysical = Schema.decodeUnknownSync(CustomCompositionReferencesResponse)(
              yield* Effect.promise(() => explicitPhysicalResponse.json()),
            )
            expect(explicitPhysical.snapshotsComplete).toBe(true)
            expect(explicitPhysical.profiles.map((profile) => profile.relativePath)).toEqual(
              aliasProfiles.map((profile) => profile.relativePath).toSorted(),
            )
            expect(explicitPhysical.snapshots.map((snapshot) => snapshot.sessionID).toSorted()).toEqual(
              [legacySnapshots[1].session.id, aliasCreated.session.id].toSorted(),
            )
            const wrongAlias = yield* test.request(
              `/custom-composition/references?${new URLSearchParams({
                kind: "prompt",
                path: aliasRef.relativePath,
                scope: "location",
                targetRoot: path.join(aliasDirectory, ".omnixa/prompts"),
              })}`,
              { directory: aliasDirectory },
            )
            expect(wrongAlias.status).toBe(409)
            expect(yield* Effect.promise(() => wrongAlias.json())).toMatchObject({ _tag: "ConflictError" })
            const foreignAliasResponse = yield* test.request(aliasQuery, { directory: test.other })
            expect(foreignAliasResponse.status).toBe(200)
            expect(
              Schema.decodeUnknownSync(CustomCompositionReferencesResponse)(
                yield* Effect.promise(() => foreignAliasResponse.json()),
              ),
            ).toEqual({ profiles: [], snapshots: [], snapshotsComplete: true })
            expect(
              yield* compositions.references({
                location: locationRefForRoute({ directory: aliasDirectory, workspaceID }),
                kind: "prompt",
                path: aliasRef.relativePath,
                target: aliasTarget,
                includeLegacyLocation: true,
              }),
            ).toEqual({ snapshots: [], snapshotsComplete: true })
            yield* Effect.forEach(selected, (item) =>
              Effect.forEach(["prompt", "skill", "command"] as const, (kind) =>
                Effect.gen(function* () {
                  const scopedQuery = `/custom-composition/references?${new URLSearchParams({
                    kind,
                    path: ` ${refs[kind].relativePath.replaceAll("/", "\\")} `,
                    scope: item.scope,
                    targetRoot: item.targets[kind].root,
                  })}`
                  const response = yield* test.request(scopedQuery, { directory: selectedDirectory })
                  expect(response.status).toBe(200)
                  const found = Schema.decodeUnknownSync(CustomCompositionReferencesResponse)(
                    yield* Effect.promise(() => response.json()),
                  )
                  expect(found.snapshotsComplete).toBe(true)
                  expect(found.profiles.map((profile) => profile.relativePath)).toEqual([item.profilePath])
                  expect(found.snapshots.map((snapshot) => snapshot.sessionID)).toEqual([item.created.session.id])
                  const across = yield* test.request(scopedQuery, {
                    directory: item.scope === "global" ? test.other : test.directory,
                  })
                  if (item.scope === "location") {
                    expect(across.status).toBe(409)
                    expect(yield* Effect.promise(() => across.json())).toMatchObject({ _tag: "ConflictError" })
                    return
                  }
                  expect(across.status).toBe(200)
                  const adopted = Schema.decodeUnknownSync(CustomCompositionReferencesResponse)(
                    yield* Effect.promise(() => across.json()),
                  )
                  expect(adopted.profiles).toEqual([])
                  expect(adopted.snapshotsComplete).toBe(true)
                  expect(adopted.snapshots.map((snapshot) => snapshot.sessionID)).toEqual([item.created.session.id])
                  if (item.scope !== "global") return
                  const isolated = yield* test.request(scopedQuery, { directory: test.other, workspace: workspaceID })
                  expect(isolated.status).toBe(200)
                  expect(
                    Schema.decodeUnknownSync(CustomCompositionReferencesResponse)(
                      yield* Effect.promise(() => isolated.json()),
                    ),
                  ).toEqual({ profiles: [], snapshots: [], snapshotsComplete: true })
                }),
              ),
            )
            const global = selected.find((item) => item.scope === "global")
            if (global === undefined) throw new Error("Expected the selected global owner")
            yield* Effect.forEach(
              [
                {
                  params: new URLSearchParams({ kind: "prompt", path: refs.prompt.relativePath, scope: "global" }),
                  status: 400,
                  error: { _tag: "InvalidRequestError", field: "targetRoot" },
                },
                {
                  params: new URLSearchParams({
                    kind: "prompt",
                    path: refs.prompt.relativePath,
                    targetRoot: global.targets.prompt.root,
                  }),
                  status: 400,
                  error: { _tag: "InvalidRequestError", field: "scope" },
                },
                {
                  params: new URLSearchParams({
                    kind: "prompt",
                    path: refs.prompt.relativePath,
                    scope: "global",
                    targetRoot: `${global.targets.prompt.root}-other`,
                  }),
                  status: 409,
                  error: { _tag: "ConflictError" },
                },
              ],
              (operation) =>
                Effect.gen(function* () {
                  const response = yield* test.request(`/custom-composition/references?${operation.params}`, {
                    directory: selectedDirectory,
                  })
                  expect(response.status).toBe(operation.status)
                  expect(yield* Effect.promise(() => response.json())).toMatchObject(operation.error)
                }),
            )
            yield* Effect.forEach(["agent", "workflow", "mcp"] as const, (kind) =>
              Effect.gen(function* () {
                const response = yield* test.request(
                  `/custom-composition/references?${new URLSearchParams({
                    kind,
                    path: refs[kind].relativePath,
                    scope: "global",
                    targetRoot: global.targets.prompt.root,
                  })}`,
                  { directory: selectedDirectory },
                )
                expect(response.status).toBe(400)
                expect(yield* Effect.promise(() => response.json())).toMatchObject({
                  _tag: "InvalidRequestError",
                  field: "kind",
                })
              }),
            )
          }),
        )
        expect(published).toEqual([])
        yield* assertNoExecution(test)
        expect(yield* storedState(test)).toEqual(before)
        yield* Effect.forEach(aliasProfiles, (profile) =>
          Effect.gen(function* () {
            expect(yield* Effect.promise(() => Bun.file(profile.filename).text())).toBe(profile.content)
          }),
        )
        yield* Effect.forEach(legacySnapshots, (legacy) =>
          Effect.gen(function* () {
            expect(yield* compositions.get(legacy.session.id)).toEqual(legacy.snapshot)
          }),
        )
      }),
    ),
  30_000,
)
