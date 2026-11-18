import { describe, expect } from "bun:test"
import path from "path"
import { parse } from "jsonc-parser"
import { Context, Deferred, Effect, Fiber, Layer, Exit, Cause } from "effect"
import { SqlError, ConnectionError } from "effect/sql/SqlError"
import { Config } from "@aigcfroge/core/config"
import { ConfigProviderFile } from "@aigcfroge/core/config/provider-file"
import { ConfigProviderPlugin } from "@aigcfroge/core/config/plugin/provider"
import { ConfigPolicyPlugin } from "@aigcfroge/core/config/plugin/policy"
import { ProviderDefinition } from "@aigcfroge/core/provider/definition"
import { Credential } from "@aigcfroge/core/credential"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Watcher } from "@aigcfroge/core/filesystem/watcher"
import { Integration } from "@aigcfroge/core/integration"
import { Plugin } from "@aigcfroge/core/plugin"
import { PluginHost } from "@aigcfroge/core/plugin/host"
import { Provider } from "@aigcfroge/core/provider"
import { Model } from "@aigcfroge/core/model"
import { WellKnown } from "@aigcfroge/core/wellknown"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { ConfigProvider } from "@aigcfroge/schema/config/provider"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Global } from "@aigcfroge/util/global"
import { emptyWellknownNode } from "./fixture/config-nodes"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it, awaitWithTimeout } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const decode = <T extends { readonly target: { readonly scope: string; readonly path: string } }>(input: T) =>
  ProviderDefinition.decodeSave({ ...input, target: { scope: input.target.scope, path: input.target.path } })
const providerID = Provider.ID.make("manual")
const editable = {
  name: "Manual",
  package: "@aigcfroge/ai/providers/openai-compatible",
  settings: { baseURL: "http://127.0.0.1:8899/v1" },
  models: { chat: { modelID: Model.ID.make("api-chat"), name: "Chat" } },
}

function configLayer(directory: string, globalDirectory: string, options: Config.Options = {}) {
  return AppNodeBuilder.build(Config.node, [
    Config.node.replace(Config.configured(options)),
    Location.node.replace(Layer.succeed(Location.Service, location({ directory: AbsolutePath.make(directory) }))),
    Global.node.replace(Global.layerWith({
      config: globalDirectory,
      home: path.join(globalDirectory, "home"),
      data: path.join(globalDirectory, "data"),
      state: path.join(globalDirectory, "state"),
      cache: path.join(globalDirectory, "cache"),
      tmp: path.join(globalDirectory, "tmp"),
      bin: path.join(globalDirectory, "bin"),
      log: path.join(globalDirectory, "log"),
      repos: path.join(globalDirectory, "repos"),
    })),
    Database.node.replace(Database.configured({ path: ":memory:" })),
    WellKnown.node.replace(emptyWellknownNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
}

const withConfigured = <A, E, R>(directory: string, globalDirectory: string, body: Effect.Effect<A, E, R>, options: Config.Options = {}) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(configLayer(directory, globalDirectory, options))
    const config = Context.get(context, Config.Service)
    const host = yield* PluginHost.make(yield* Plugin.Service)
    yield* ConfigProviderPlugin.Plugin.effect(host).pipe(Effect.provideService(Config.Service, config))
    yield* ConfigPolicyPlugin.Plugin.effect(host).pipe(Effect.provideService(Config.Service, config))
    return yield* body.pipe(Effect.provideService(Config.Service, config))
  }).pipe(Effect.provide(PluginTestLayer))

const target = Effect.fnUntraced(function* (scope: "global" | "project") {
  const selected = (yield* ProviderDefinition.get()).targets.find((item) => item.scope === scope && item.preferred)
  if (!selected) return yield* Effect.die(new Error(`Missing ${scope} target`))
  return selected
})

describe("ProviderDefinition", () => {
  it.live("places a preview for a missing global layer below project and explicit content without writing it", () => Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const globalDirectory = path.join(tmp.path, "global")
    yield* withConfigured(tmp.path, globalDirectory, Effect.gen(function* () {
      const config = yield* Config.Service
      const fs = yield* FSUtil.Service
      const global = yield* target("global")
      const project = yield* target("project")
      yield* fs.writeWithDirs(project.path, '{"providers":{"manual":{"name":"Project","settings":{"baseURL":"http://127.0.0.1:8899/project/v1"}}}}\n')
      yield* config.provider!.reload(project)
      const before = yield* config.entries()
      const preview = yield* config.provider!.list({ providerID, target: global, definition: new ConfigProvider.Info(editable) })
      const layers = preview.definitions.filter((item) => item.providerID === providerID)
      expect(layers.map((item) => item.source.scope)).toEqual(["global", "project", "virtual"])
      expect(layers.at(-1)?.definition.name).toBe("Content")
      expect(yield* fs.isFile(global.path)).toBe(false)
      expect(yield* config.entries()).toBe(before)
    }), { content: '{"providers":{"manual":{"name":"Content"}}}' })
  }))

  it.live("patches global and project JSONC, reopens, and removes only the selected layer", () => Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const globalDirectory = path.join(tmp.path, "global")
    yield* withConfigured(tmp.path, globalDirectory, Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const global = yield* target("global")
      yield* fs.writeWithDirs(global.path, '// global comment\n{"shell":"/bin/sh","providers":{"manual":{"name":"Global"}},"custom":{"kept":true}}\n')
      const globalRevision = (yield* target("global")).digest
      const first = yield* ProviderDefinition.save(decode({ providerID, submissionID: "global-one", target: global, expectedDigest: globalRevision, patch: { set: editable }, credential: { type: "keep" } }))
      expect(first.definition.status).toBe("saved")
      expect(first.catalog.status).toBe("ready")
      expect(yield* fs.readFileString(global.path)).toContain("// global comment")
      expect(parse(yield* fs.readFileString(global.path))).toMatchObject({ shell: "/bin/sh", custom: { kept: true } })
      const project = yield* target("project")
      const second = yield* ProviderDefinition.save(decode({ providerID, submissionID: "project-one", target: project, expectedDigest: project.digest, patch: { set: { name: "Project", settings: { timeout: 1000 } } }, credential: { type: "keep" } }))
      expect(second.definition.status).toBe("saved")
      expect((yield* ProviderDefinition.get(providerID)).definitions.at(-1)).toMatchObject({ definition: { name: "Project" }, inherited: [{ scope: "global", path: global.path }] })
      const removed = yield* ProviderDefinition.remove({ providerID, target: project, expectedDigest: second.definition.target!.digest })
      expect(removed.definition.status).toBe("saved")
      expect(removed.inherited).toContainEqual({ scope: "global", path: global.path })
      expect((yield* (yield* Provider.Service).get(providerID))?.name).toBe("Manual")
      const reopened = Context.get(yield* Layer.build(configLayer(tmp.path, globalDirectory)), Config.Service)
      expect((yield* reopened.provider!.list()).definitions.find((item) => item.providerID === providerID)?.definition.name).toBe("Manual")
      const quoteTarget = yield* target("global")
      const quoted = yield* ProviderDefinition.save(decode({ providerID, submissionID: "dated-quote", target: quoteTarget, expectedDigest: quoteTarget.digest,
        patch: { set: { models: { chat: { quote: { status: "known", prices: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }], validFrom: 100, validUntil: 200, source: "authored" } } } } }, credential: { type: "keep" } }))
      expect(quoted.definition.status).toBe("saved")
      const cleared = yield* ProviderDefinition.save(decode({ providerID, submissionID: "clear-quote-date", target: quoteTarget, expectedDigest: quoted.definition.target!.digest,
        patch: { unset: [["models", "chat", "quote", "validUntil"]] }, credential: { type: "keep" } }))
      expect(cleared.definition.status).toBe("saved")
      const quoteReopened = Context.get(yield* Layer.build(configLayer(tmp.path, globalDirectory)), Config.Service)
      const quote = (yield* quoteReopened.provider!.list()).definitions.find((item) => item.providerID === providerID)?.definition.models?.chat.quote
      expect(quote).toMatchObject({ status: "known", validFrom: 100, source: "authored", prices: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }] })
      expect(quote).not.toHaveProperty("validUntil")
    }))
  }))

  it.live("uses a shared file lock for two Location graphs and rejects stale expected absence", () => Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const globalDirectory = path.join(tmp.path, "global")
    const projectA = path.join(tmp.path, "project-a")
    const projectB = path.join(tmp.path, "project-b")
    const first = Context.get(yield* Layer.build(configLayer(projectA, globalDirectory, { project: false })), Config.Service)
    const second = Context.get(yield* Layer.build(configLayer(projectB, globalDirectory, { project: false })), Config.Service)
    const selected = (yield* first.provider!.list()).targets.find((item) => item.preferred)!
    expect(selected.digest).toBeNull()
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const written = yield* first.provider!.transaction(selected, (file, write) => Effect.gen(function* () {
      expect(file.target.digest).toBeNull()
      yield* Deferred.succeed(started, undefined)
      yield* Deferred.await(release)
      return yield* write({ type: "patch", providerID, patch: { set: editable } })
    })).pipe(Effect.forkScoped)
    yield* awaitWithTimeout(Deferred.await(started), "First writer did not enter transaction")
    const stale = yield* second.provider!.transaction(selected, (file) => file.target.digest !== selected.digest
      ? Effect.fail(new ConfigProviderFile.ConflictError({ target: file.target, message: "stale expected absence" }))
      : Effect.void).pipe(Effect.flip, Effect.forkScoped)
    yield* Deferred.succeed(release, undefined)
    expect((yield* Fiber.join(written)).target.digest).not.toBeNull()
    expect(yield* Fiber.join(stale)).toMatchObject({ _tag: "ConfigProviderFile.Conflict" })
  }))

  it.live("rejects malformed input without normalizing it to a successful empty write", () => Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const globalDirectory = path.join(tmp.path, "global")
    yield* withConfigured(tmp.path, globalDirectory, Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const selected = yield* target("global")
      yield* fs.writeWithDirs(selected.path, '{"providers":')
      const malformed = yield* ProviderDefinition.save(decode({ providerID, submissionID: "bad-json", target: selected, expectedDigest: null, patch: { set: editable }, credential: { type: "keep" } }))
      expect(malformed.definition.status).toBe("failed")
      expect(yield* fs.readFileString(selected.path)).toBe('{"providers":')
      const unrelated = yield* ProviderDefinition.save(decode({ providerID, submissionID: "bad-path", target: { scope: "global", path: path.join(tmp.path, "unrelated.json") }, expectedDigest: null, patch: { set: editable }, credential: { type: "keep" } })).pipe(Effect.flip)
      expect(unrelated._tag).toBe("ConfigProviderFile.InvalidTarget")
    }))
  }))

  it.live("keeps configuration content above authored files in inherited sources", () => Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* withConfigured(tmp.path, path.join(tmp.path, "global"), Effect.gen(function* () {
      const selected = yield* target("global")
      const saved = yield* ProviderDefinition.save(decode({ providerID, submissionID: "lower-authored", target: selected, expectedDigest: selected.digest, patch: { set: editable }, credential: { type: "keep" } }))
      expect(saved.definition.status).toBe("saved")
      const readback = yield* ProviderDefinition.get(providerID)
      expect(readback.definitions.map((item) => item.source.scope)).toEqual(["global", "virtual"])
      expect(readback.definitions[0].inherited).toEqual([])
      expect(readback.definitions[1].inherited).toEqual([{ scope: "global", path: selected.path }])
      expect((yield* (yield* Provider.Service).get(providerID))?.name).toBe("Content override")
    }), { content: JSON.stringify({ providers: { manual: { name: "Content override" } } }) })
  }))

  it.live("serializes the existing shell update with an authored provider transaction", () => Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const globalDirectory = path.join(tmp.path, "global")
    const first = Context.get(yield* Layer.build(configLayer(tmp.path, globalDirectory, { project: false })), Config.Service)
    const second = Context.get(yield* Layer.build(configLayer(tmp.path, globalDirectory, { project: false })), Config.Service)
    const selected = (yield* first.provider!.list()).targets.find((item) => item.preferred)!
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const written = yield* first.provider!.transaction(selected, (_file, write) => Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.andThen(write({ type: "patch", providerID, patch: { set: editable } })),
    )).pipe(Effect.forkScoped)
    yield* Deferred.await(started)
    const shell = yield* second.update!({ shell: "/bin/test-shell" }).pipe(Effect.forkScoped)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(written)
    yield* Fiber.join(shell)
    const writtenFile = yield* Config.Service.pipe(Effect.flatMap((config) => config.provider!.list()), Effect.provide(configLayer(tmp.path, globalDirectory, { project: false })))
    expect(writtenFile.definitions.find((item) => item.providerID === providerID)?.definition.name).toBe("Manual")
    yield* second.provider!.reload(selected)
    expect((yield* second.entries()).some((item) => item.type === "document" && item.info.shell === "/bin/test-shell")).toBe(true)
  }))

  it.live("persists pending before credential creation and resumes without storing secrets in the editor", () => Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* withConfigured(tmp.path, path.join(tmp.path, "global"), Effect.gen(function* () {
      const selected = yield* target("global")
      const input = decode({ providerID, submissionID: "draft-one", target: selected, expectedDigest: selected.digest, patch: { set: editable }, credential: { type: "create", label: "Work" } })
      const draft = yield* ProviderDefinition.save(input)
      expect(draft.credential.status).toBe("pending")
      expect(draft.info?.definition.adoption).toMatchObject({ phase: "draft", stage: "credential", credentialAction: "create" })
      const credentials = yield* Credential.Service
      expect(yield* credentials.get(draft.info!.definition.adoption!.credentialID!)).toBeUndefined()
      expect(yield* (yield* Provider.Service).available()).not.toContainEqual(expect.objectContaining({ id: providerID }))
      const observed: unknown[] = []
      const sourceConfig = yield* Config.Service
      const recording = Credential.Service.of({ ...credentials, create: (createInput) => Effect.gen(function* () {
        const authored = (yield* sourceConfig.provider!.list().pipe(Effect.orDie)).definitions.find((item) => item.providerID === providerID)!
        observed.push(authored.definition.adoption)
        expect(authored.definition.adoption?.credentialID).toBe(createInput.id)
        expect(authored.definition.settings?.baseURL).toBe(editable.settings.baseURL)
        return yield* credentials.create(createInput)
      }) })
      const ready = yield* ProviderDefinition.save({ ...input, credential: { type: "create", key: "stored-secret", label: "Work" } }).pipe(Effect.provideService(Credential.Service, recording))
      expect(observed).toHaveLength(1)
      expect(ready.info?.definition.adoption?.phase).toBe("ready")
      expect(ready.credential.status).toBe("created")
      expect(JSON.stringify(ready)).not.toContain("stored-secret")
      expect((yield* ProviderDefinition.get(providerID)).definitions[0]?.connections).toContainEqual(expect.objectContaining({ type: "credential", label: "Work" }))
    }))
  }))

  it.live("keeps the ready receipt across lost responses and uses a new submission for a new account", () => Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* withConfigured(tmp.path, path.join(tmp.path, "global"), Effect.gen(function* () {
      const selected = yield* target("global")
      const input = decode({ providerID, submissionID: "account-one", target: selected, expectedDigest: selected.digest, patch: { set: editable }, credential: { type: "create", key: "first-secret", label: "One" } })
      const first = yield* ProviderDefinition.save(input)
      const credentials = yield* Credential.Service
      const previous = yield* credentials.create({ integrationID: Integration.ID.make(providerID), label: "Alternative", value: Credential.Key.make({ type: "key", key: "alternative" }) })
      const retry = yield* ProviderDefinition.save(input)
      expect(retry.definition.status).toBe("unchanged")
      expect(retry.info?.definition.adoption?.credentialID).toBe(first.info?.definition.adoption?.credentialID)
      expect(yield* credentials.list(Integration.ID.make(providerID))).toHaveLength(2)
      expect((yield* (yield* Integration.Service).connection.active(Integration.ID.make(providerID)))?.type).toBe("credential")
      expect((yield* (yield* Integration.Service).connection.active(Integration.ID.make(providerID)))).toMatchObject({ id: previous.id })
      const conflict = yield* ProviderDefinition.save({ ...input, credential: { type: "create", key: "different-secret", label: "One" } })
      expect(conflict.definition.status).toBe("conflict")
      const second = yield* ProviderDefinition.save({ ...input, submissionID: "account-two", expectedDigest: retry.info!.target!.digest, credential: { type: "create", key: "second-secret", label: "Two" } })
      expect(second.definition.status).toBe("saved")
      expect(second.info?.definition.adoption?.credentialID).not.toBe(first.info?.definition.adoption?.credentialID)
      expect(yield* credentials.list(Integration.ID.make(providerID))).toHaveLength(3)
    }))
  }))

  it.live("resumes a failed credential effect and rejects changed secret overlays on the same submission", () => Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* withConfigured(tmp.path, path.join(tmp.path, "global"), Effect.gen(function* () {
      const selected = yield* target("global")
      const input = decode({ providerID, submissionID: "recoverable", target: selected, expectedDigest: selected.digest, patch: { set: { ...editable, settings: { ...editable.settings, authToken: "literal-auth-token-secret" }, headers: { Authorization: "Bearer header-secret", "X-Private-Key": "private-header" } } }, credential: { type: "create", key: "stored-secret" } })
      const credentials = yield* Credential.Service
      const failed = yield* ProviderDefinition.save(input).pipe(Effect.provideService(Credential.Service, { ...credentials, create: () => Effect.die(new SqlError({ reason: new ConnectionError({ cause: new Error("fixture storage failure") }) })) }))
      expect(failed.definition.status).toBe("saved")
      expect(failed.credential.status).toBe("failed")
      expect(failed.info?.definition.adoption?.phase).toBe("applying")
      expect(failed.info?.definition.adoption?.credentialID).toBeDefined()
      const defect = new Error("fixture programmer defect")
      const unexpected = yield* ProviderDefinition.save(input).pipe(Effect.provideService(Credential.Service, { ...credentials, create: () => Effect.die(defect) }), Effect.exit)
      expect(Exit.isFailure(unexpected) && Cause.squash(unexpected.cause)).toBe(defect)
      const restored = yield* ProviderDefinition.save(input)
      expect(restored.info?.definition.adoption?.phase).toBe("ready")
      expect(restored.info?.definition.adoption?.credentialID).toBe(failed.info?.definition.adoption?.credentialID)
      expect(restored.info?.redactedPaths).toContainEqual(["headers", "Authorization"])
      expect(restored.info?.redactedPaths).toContainEqual(["headers", "X-Private-Key"])
      expect(JSON.stringify(restored)).not.toContain("header-secret")
      const changed = yield* ProviderDefinition.save({ ...input, patch: { set: { headers: { Authorization: "Bearer changed-secret" } } } })
      expect(changed.definition.status).toBe("conflict")
      const unchanged = yield* ProviderDefinition.save({ ...input, submissionID: "name-edit", expectedDigest: restored.info!.target!.digest, patch: { set: { name: "Renamed" } }, credential: { type: "keep" } })
      expect(unchanged.definition.status).toBe("saved")
      expect((yield* (yield* Config.Service).entries()).some((entry) => entry.type === "document" && entry.info.providers?.[providerID]?.settings?.authToken === "literal-auth-token-secret")).toBe(true)
      const readback = (yield* ProviderDefinition.get(providerID)).definitions[0]
      expect(readback?.redactedPaths).toContainEqual(["settings", "authToken"])
      expect(readback?.definition.settings?.authToken).toBeUndefined()
      const fs = yield* FSUtil.Service
      expect(parse(yield* fs.readFileString(selected.path)).providers.manual.headers.Authorization).toBe("Bearer header-secret")
    }))
  }))

  it.live("suspends endpoint and auth edits, and keeps terminal provider policy authoritative", () => Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* withConfigured(tmp.path, path.join(tmp.path, "global"), Effect.gen(function* () {
      const selected = yield* target("global")
      const saved = yield* ProviderDefinition.save(decode({ providerID, submissionID: "existing", target: selected, expectedDigest: selected.digest, patch: { set: editable }, credential: { type: "create", key: "old-secret" } }))
      const credentials = yield* Credential.Service
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const changed = yield* ProviderDefinition.save(decode({ providerID, submissionID: "changed", target: selected, expectedDigest: saved.info!.target!.digest, patch: { set: { settings: { baseURL: "http://127.0.0.1:9999/v1" } } }, credential: { type: "create", key: "new-secret" } })).pipe(
        Effect.provideService(Credential.Service, { ...credentials, create: (input) => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(credentials.create(input))) }),
        Effect.forkScoped,
      )
      yield* awaitWithTimeout(Deferred.await(started), "Credential create was not reached")
      expect(yield* (yield* Provider.Service).available()).not.toContainEqual(expect.objectContaining({ id: providerID }))
      yield* Deferred.succeed(release, undefined)
      const edited = yield* Fiber.join(changed)
      expect(edited.catalog.status).toBe("ready")
      const fs = yield* FSUtil.Service
      const current = yield* fs.readFileString(selected.path)
      const doc = parse(current)
      yield* fs.writeFileString(selected.path, JSON.stringify({ ...doc, experimental: { policies: [{ action: "provider.use", resource: providerID, effect: "deny" }] } }))
      const deniedTarget = yield* target("global")
      const denied = yield* ProviderDefinition.save(decode({ providerID, submissionID: "denied", target: selected, expectedDigest: deniedTarget.digest, patch: { set: { name: "Still authored" } }, credential: { type: "keep" } }))
      expect(denied.definition.status).toBe("saved")
      expect(denied.catalog.status).toBe("unavailable")
      expect(yield* (yield* Provider.Service).get(providerID)).toBeUndefined()
    }))
  }))
})
