import { describe, expect, test } from "bun:test"
import path from "path"
import { parse } from "jsonc-parser"
import { Context, Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { Config } from "@omnixa/core/config"
import { ConfigProviderFile } from "@omnixa/core/config/provider-file"
import { Credential } from "@omnixa/core/credential"
import { Database } from "@omnixa/core/database/database"
import { Watcher } from "@omnixa/core/filesystem/watcher"
import { Location } from "@omnixa/core/location"
import { Model } from "@omnixa/core/model"
import { ModelGroup } from "@omnixa/core/model-group"
import { Provider } from "@omnixa/core/provider"
import { WellKnown } from "@omnixa/core/wellknown"
import { Document, Info } from "@omnixa/schema/config"
import { AbsolutePath } from "@omnixa/schema/schema"
import { FSUtil } from "@omnixa/util/fs-util"
import { Global } from "@omnixa/util/global"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { emptyCredentialNode, emptyWellknownNode } from "./fixture/config-nodes"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it, testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const groupID = Model.GroupID.make("fallback")
const first = Model.Ref.parse("manual/first")
const second = Model.Ref.parse("manual/second")
const definition = (members: readonly Model.Ref[] = [first, second]) =>
  new ModelGroup.Definition({
    name: "Fallback",
    enabled: true,
    members: [...members],
    strategy: "order",
    affinity: "turn",
  })
const document = (modelGroups: Record<string, ModelGroup.Definition>) =>
  new Document({
    type: "document",
    info: Schema.decodeUnknownSync(Info)({ modelGroups }),
  })
const modelIt = testEffect(PluginTestLayer)

function configLayer(directory: string, globalDirectory: string, options: Config.Options = {}) {
  return AppNodeBuilder.build(LayerNode.group([Config.node, FSUtil.node]), [
    Config.node.replace(Config.configured(options)),
    Location.node.replace(Layer.succeed(Location.Service, location({ directory: AbsolutePath.make(directory) }))),
    Global.node.replace(
      Global.layerWith({
        config: globalDirectory,
        home: path.join(globalDirectory, "home"),
        data: path.join(globalDirectory, "data"),
        state: path.join(globalDirectory, "state"),
        cache: path.join(globalDirectory, "cache"),
        tmp: path.join(globalDirectory, "tmp"),
        bin: path.join(globalDirectory, "bin"),
        log: path.join(globalDirectory, "log"),
        repos: path.join(globalDirectory, "repos"),
      }),
    ),
    Database.node.replace(Database.configured({ path: ":memory:" })),
    WellKnown.node.replace(emptyWellknownNode),
    Credential.node.replace(emptyCredentialNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
}

const target = Effect.fnUntraced(function* (scope: "global" | "project") {
  const selected = (yield* ModelGroup.get()).targets.find((item) => item.scope === scope && item.preferred)
  if (!selected) return yield* Effect.die(new Error(`Missing ${scope} target`))
  return selected
})

describe("ModelGroup", () => {
  test("uses the complete highest definition per ID and retains other groups", () => {
    const entries = [
      document({ fallback: definition(), kept: definition([first]) }),
      document({ fallback: new ModelGroup.Definition({ ...definition([second]), name: "Project", enabled: false }) }),
    ]
    expect(ModelGroup.effectiveGroup(entries, groupID)).toMatchObject({
      definition: { name: "Project", enabled: false, members: [second] },
      unavailable: "disabled",
    })
    expect(ModelGroup.effectiveGroup(entries, Model.GroupID.make("kept")).definition?.members).toEqual([first])
    expect(ModelGroup.effectiveGroup(entries, Model.GroupID.make("missing")).unavailable).toBe("missing")
    expect(ModelGroup.effectiveGroup([document({ fallback: definition([]) })], groupID).unavailable).toBe("empty")
  })

  test("normalizes default variants and hashes only member order and execution behavior", () => {
    const original = ModelGroup.snapshot(groupID, definition())
    const renamed = ModelGroup.snapshot(
      groupID,
      new ModelGroup.Definition({ ...definition(), name: "Renamed", enabled: false }),
    )
    const defaultVariant = ModelGroup.snapshot(
      groupID,
      definition([{ ...first, variant: Model.VariantID.make("default") }, second]),
    )
    expect(renamed.behaviorDigest).toBe(original.behaviorDigest)
    expect(defaultVariant).toEqual(original)
    expect(ModelGroup.snapshot(groupID, definition([second, first])).behaviorDigest).not.toBe(original.behaviorDigest)
    expect(
      ModelGroup.snapshot(groupID, definition([{ ...first, variant: Model.VariantID.make("high") }, second]))
        .behaviorDigest,
    ).not.toBe(original.behaviorDigest)
  })

  test("P4 normalizes equivalent weights and hashes connection choices, strategy and affinity", () => {
    const original = ModelGroup.snapshot(groupID, definition())
    const unit = ModelGroup.snapshot(
      groupID,
      new ModelGroup.Definition({ ...definition(), members: [{ ...first, weight: 1 }, second] }),
    )
    expect(unit.behaviorDigest).toBe(original.behaviorDigest)
    const connected = new ModelGroup.Definition({
      ...definition(),
      members: [{ ...first, weight: 3, connections: [{ ref: { type: "env", name: "KEY_A" }, weight: 1 }] }, second],
      strategy: "rotate",
      affinity: "session",
    })
    const frozen = ModelGroup.snapshot(groupID, connected)
    expect(frozen.members).toEqual(connected.members)
    expect(frozen.behaviorDigest).not.toBe(original.behaviorDigest)
    expect(
      ModelGroup.snapshot(groupID, new ModelGroup.Definition({ ...connected, name: "Renamed", enabled: false }))
        .behaviorDigest,
    ).toBe(frozen.behaviorDigest)
    expect(
      ModelGroup.snapshot(groupID, new ModelGroup.Definition({ ...connected, strategy: "weight" })).behaviorDigest,
    ).not.toBe(frozen.behaviorDigest)
    expect(
      ModelGroup.snapshot(groupID, new ModelGroup.Definition({ ...connected, affinity: "off" })).behaviorDigest,
    ).not.toBe(frozen.behaviorDigest)
    expect(
      ModelGroup.snapshot(
        groupID,
        new ModelGroup.Definition({ ...connected, members: [{ ...first, weight: 3, connections: [] }, second] }),
      ).behaviorDigest,
    ).not.toBe(frozen.behaviorDigest)
    expect(
      ModelGroup.snapshot(
        groupID,
        new ModelGroup.Definition({
          ...connected,
          members: [{ ...first, weight: 3, connections: [{ ref: { type: "env", name: "KEY_B" }, weight: 1 }] }, second],
        }),
      ).behaviorDigest,
    ).not.toBe(frozen.behaviorDigest)
  })

  it.live("inherits a complete base only for a new target and replaces members without losing JSONC", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const globalDirectory = path.join(tmp.path, "global")
      yield* Effect.gen(function* () {
        const fs = yield* FSUtil.Service
        const config = yield* Config.Service
        const global = yield* target("global")
        yield* fs.writeWithDirs(
          global.path,
          `// retain this comment\n${JSON.stringify({ shell: "/bin/sh", providers: { manual: { name: "Manual" } }, modelGroups: { fallback: definition(), kept: definition([first]) }, custom: { kept: true } })}\n`,
        )
        if (!config.provider) return yield* Effect.die(new Error("Authored configuration is missing"))
        yield* config.provider.reload(global)
        const project = yield* target("project")
        const inherited = yield* ModelGroup.save(
          ModelGroup.decodeSave({
            groupID,
            target: { scope: project.scope, path: project.path },
            expectedDigest: project.digest,
            patch: { set: { name: "Project" } },
          }),
        )
        expect(inherited.definition.status).toBe("saved")
        expect(inherited.readback?.effective[0]?.definition).toMatchObject({
          name: "Project",
          members: [first, second],
        })
        const replaced = yield* ModelGroup.save(
          ModelGroup.decodeSave({
            groupID,
            target: { scope: project.scope, path: project.path },
            expectedDigest: inherited.definition.target?.digest,
            patch: { set: { members: [second] } },
          }),
        )
        expect(replaced.definition.status).toBe("saved")
        expect(replaced.readback?.effective[0]?.definition?.members).toEqual([second])
        const globalTarget = yield* target("global")
        const ownBase = yield* ModelGroup.save(
          ModelGroup.decodeSave({
            groupID,
            target: { scope: global.scope, path: global.path },
            expectedDigest: globalTarget.digest,
            patch: { set: { name: "Global edited" } },
          }),
        )
        expect(ownBase.definition.status).toBe("saved")
        expect(ownBase.readback?.definitions[0]?.definition.members).toEqual([first, second])
        expect(ownBase.readback?.effective[0]?.definition?.members).toEqual([second])
        const text = yield* fs.readFileString(global.path)
        expect(text).toContain("// retain this comment")
        expect(parse(text)).toMatchObject({
          shell: "/bin/sh",
          providers: { manual: { name: "Manual" } },
          custom: { kept: true },
          modelGroups: { kept: { members: [first] } },
        })
        const reopened = Context.get(
          yield* Layer.build(Layer.fresh(configLayer(tmp.path, globalDirectory))),
          Config.Service,
        )
        const reopenedRead = yield* ModelGroup.get(groupID).pipe(Effect.provideService(Config.Service, reopened))
        expect(reopenedRead.effective[0]?.definition?.members).toEqual([second])
        const removed = yield* ModelGroup.remove(
          ModelGroup.decodeRemove({
            groupID,
            target: { scope: project.scope, path: project.path },
            expectedDigest: replaced.definition.target?.digest,
          }),
        )
        expect(removed.definition.status).toBe("saved")
        expect(removed.inherited).toContainEqual({ scope: "global", path: global.path })
        expect(removed.readback?.effective[0]?.definition).toMatchObject({
          name: "Global edited",
          members: [first, second],
        })
        expect((yield* ModelGroup.get(Model.GroupID.make("kept"))).effective[0]?.definition?.members).toEqual([first])
      }).pipe(Effect.provide(configLayer(tmp.path, globalDirectory)))
    }),
  )

  it.live("starts a fresh group with the approved defaults and preserves an unchanged digest", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const selected = yield* target("global")
        const input = {
          groupID,
          target: { scope: selected.scope, path: selected.path },
          expectedDigest: selected.digest,
          patch: { set: { name: "First" } },
        }
        const firstSave = yield* ModelGroup.save(ModelGroup.decodeSave(input))
        expect(firstSave.definition.status).toBe("saved")
        expect(firstSave.readback?.effective[0]).toMatchObject({
          definition: { name: "First", enabled: true, members: [], strategy: "order", affinity: "turn" },
          unavailable: "empty",
        })
        const again = yield* ModelGroup.save(
          ModelGroup.decodeSave({ ...input, expectedDigest: firstSave.definition.target?.digest }),
        )
        expect(again.definition.status).toBe("unchanged")
        expect(again.definition.target?.digest).toBe(firstSave.definition.target?.digest)
      }).pipe(Effect.provide(configLayer(tmp.path, path.join(tmp.path, "global"), { project: false })))
    }),
  )

  it.live("serializes group, provider and shell writes through the existing shared file lock", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const globalDirectory = path.join(tmp.path, "global")
      const firstConfig = Context.get(
        yield* Layer.build(configLayer(tmp.path, globalDirectory, { project: false })),
        Config.Service,
      )
      const secondConfig = Context.get(
        yield* Layer.build(Layer.fresh(configLayer(tmp.path, globalDirectory, { project: false }))),
        Config.Service,
      )
      if (!firstConfig.provider || !secondConfig.provider || !secondConfig.update)
        return yield* Effect.die(new Error("Authored configuration is missing"))
      const selected = (yield* firstConfig.provider.list()).targets.find((item) => item.preferred)
      if (!selected) return yield* Effect.die(new Error("Global target is missing"))
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const written = yield* firstConfig.provider
        .transaction(selected, (_file, write) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
            return yield* write({ type: "group-set", groupID, definition: definition() })
          }),
        )
        .pipe(Effect.forkScoped)
      yield* Deferred.await(started)
      const shell = yield* secondConfig.update({ shell: "/bin/group-shell" }).pipe(Effect.forkScoped)
      const provider = yield* secondConfig.provider
        .transaction(selected, (_file, write) =>
          write({ type: "patch", providerID: Provider.ID.make("manual"), patch: { set: { name: "Manual" } } }),
        )
        .pipe(Effect.forkScoped)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(written)
      yield* Fiber.join(shell)
      yield* Fiber.join(provider)
      const text = yield* Effect.promise(() => Bun.file(selected.path).text())
      expect(parse(text)).toMatchObject({
        shell: "/bin/group-shell",
        modelGroups: { fallback: { members: [first, second] } },
        providers: { manual: { name: "Manual" } },
      })
    }),
  )

  it.live("rejects a stale group revision after another Location graph writes the same file", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const globalDirectory = path.join(tmp.path, "global")
      const firstConfig = Context.get(
        yield* Layer.build(configLayer(tmp.path, globalDirectory, { project: false })),
        Config.Service,
      )
      const secondConfig = Context.get(
        yield* Layer.build(Layer.fresh(configLayer(tmp.path, globalDirectory, { project: false }))),
        Config.Service,
      )
      const selected = yield* target("global").pipe(Effect.provideService(Config.Service, firstConfig))
      const firstSave = yield* ModelGroup.save(
        ModelGroup.decodeSave({
          groupID,
          target: { scope: selected.scope, path: selected.path },
          expectedDigest: null,
          patch: { set: definition() },
        }),
      ).pipe(Effect.provideService(Config.Service, firstConfig))
      const stale = yield* ModelGroup.save(
        ModelGroup.decodeSave({
          groupID,
          target: { scope: selected.scope, path: selected.path },
          expectedDigest: null,
          patch: { set: { members: [second] } },
        }),
      ).pipe(Effect.provideService(Config.Service, secondConfig))
      expect(firstSave.definition.status).toBe("saved")
      expect(stale.definition.status).toBe("conflict")
      expect(stale.definition.target?.digest).toBe(firstSave.definition.target?.digest)
      expect(stale.readback?.effective[0]?.definition?.members).toEqual([first, second])
    }),
  )

  it.live("preserves a malformed group document and rejects an unrelated target", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* Effect.gen(function* () {
        const selected = yield* target("global")
        const fs = yield* FSUtil.Service
        const malformed = '{"modelGroups":{"fallback":{"name":"Incomplete"}}}\n'
        yield* fs.writeWithDirs(selected.path, malformed)
        const result = yield* ModelGroup.save(
          ModelGroup.decodeSave({
            groupID,
            target: { scope: selected.scope, path: selected.path },
            expectedDigest: null,
            patch: { set: definition() },
          }),
        )
        expect(result.definition.status).toBe("failed")
        expect(yield* fs.readFileString(selected.path)).toBe(malformed)
        const unrelated = yield* ModelGroup.save(
          ModelGroup.decodeSave({
            groupID,
            target: { scope: "global", path: path.join(tmp.path, "unrelated.json") },
            expectedDigest: null,
            patch: { set: definition() },
          }),
        ).pipe(Effect.flip)
        expect(unrelated).toBeInstanceOf(ConfigProviderFile.InvalidTargetError)
      }).pipe(Effect.provide(configLayer(tmp.path, path.join(tmp.path, "global"), { project: false })))
    }),
  )

  modelIt.effect("keeps one logical default and returns the first enabled text model with an available variant", () =>
    Effect.gen(function* () {
      const config = yield* Config.Test
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const selected = new Model.GroupRef({ type: "group", groupID })
      yield* config.setEntries([
        document({
          fallback: definition([
            Model.Ref.parse("manual/disabled"),
            Model.Ref.parse("manual/image"),
            Model.Ref.parse("manual/first#missing"),
            Model.Ref.parse("manual/second#high"),
            first,
          ]),
        }),
      ])
      yield* providers.transform((editor) =>
        editor.add({
          info: { ...Provider.Info.empty(first.providerID), activation: "enabled" },
          models: [
            { ...Model.Info.default(first.providerID, Model.ID.make("disabled")), enabled: false },
            {
              ...Model.Info.default(first.providerID, Model.ID.make("image")),
              capabilities: { tools: false, input: ["image"], output: ["image"] },
            },
            Model.Info.default(first.providerID, first.id),
            { ...Model.Info.default(second.providerID, second.id), variants: [{ id: Model.VariantID.make("high") }] },
          ],
        }),
      )
      const observed: unknown[] = []
      yield* models.transform((editor) => {
        editor.default.select(selected)
        observed.push(editor.default.get())
      })
      expect(yield* models.selection()).toEqual(selected)
      expect(yield* models.default()).toMatchObject(second)
      expect(observed.at(-1)).toEqual({ providerID: second.providerID, modelID: second.id })
      expect(yield* models.all()).toHaveLength(4)
      yield* config.setEntries([document({ fallback: definition([first]) })])
      yield* models.reload()
      expect(yield* models.default()).toMatchObject(first)
      expect(observed.at(-1)).toEqual({ providerID: first.providerID, modelID: first.id })
    }),
  )

  for (const reason of ["missing", "disabled", "empty", "no-candidates"] as const) {
    modelIt.effect(`returns the same typed ${reason} failure from synchronous and Effect default readers`, () =>
      Effect.gen(function* () {
        const config = yield* Config.Test
        const providers = yield* Provider.Service
        const models = yield* Model.Service
        yield* providers.transform((editor) =>
          editor.add({
            info: { ...Provider.Info.empty(first.providerID), activation: "enabled" },
            models: [Model.Info.default(first.providerID, first.id)],
          }),
        )
        yield* config.setEntries(
          reason === "missing"
            ? []
            : [
                document({
                  fallback: new ModelGroup.Definition({
                    ...definition(reason === "empty" ? [] : [Model.Ref.parse("manual/unavailable")]),
                    enabled: reason !== "disabled",
                  }),
                }),
              ],
        )
        yield* models.transform((editor) => {
          editor.default.select(new Model.GroupRef({ type: "group", groupID }))
          expect(() => editor.default.get()).toThrow(ModelGroup.UnavailableError)
        })
        expect(yield* models.selection()).toEqual(new Model.GroupRef({ type: "group", groupID }))
        const error = yield* models.default().pipe(Effect.flip)
        expect(error).toBeInstanceOf(ModelGroup.UnavailableError)
        expect(error.reason).toBe(reason)
      }),
    )
  }
})
