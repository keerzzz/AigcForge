export * as Config from "./config.js"

import { makeLocationNode } from "@omnixa/util/effect/app-node"
import path from "path"
import { isDeepStrictEqual } from "node:util"
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser"
import { Context, Effect, FiberMap, Layer, Option, PubSub, Ref, Schema, Semaphore, Stream } from "effect"
import { Directory, Document, Info, type Patch, type Entry, Event } from "@omnixa/schema/config"
import { Credential } from "./credential.js"
import { Bus } from "./bus.js"
import { Watcher } from "./filesystem/watcher.js"
import { FSUtil } from "@omnixa/util/fs-util"
import { Global } from "@omnixa/util/global"
import { Location } from "./location.js"
import { AbsolutePath } from "./schema.js"
import { ConfigVariable } from "./config/variable.js"
import { ConfigNormalize } from "./config/normalize.js"
import { ConfigDiscovery } from "./config/discovery.js"
import { ConfigWatch } from "./config/watch.js"
import { ConfigProviderFile } from "./config/provider-file.js"
import { ProviderDefinition } from "@omnixa/schema/provider-definition"
import { Provider } from "@omnixa/schema/provider"
import { Model } from "@omnixa/schema/model"
import { ModelGroup } from "@omnixa/schema/model-group"
import { ConfigProvider } from "@omnixa/schema/config/provider"
import { FileMutation } from "./file-mutation.js"
import { Environment } from "./environment/index.js"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@omnixa/util/cross-spawn-spawner"
import { WellKnown } from "./wellknown.js"

export function latest<K extends keyof Info>(entries: readonly Entry[], key: K): Info[K] | undefined {
  return entries.findLast((entry): entry is Document => entry.type === "document" && entry.info[key] !== undefined)
    ?.info[key]
}

export interface Interface {
  /** Returns location config documents and discovery sources from lowest to highest priority. */
  readonly entries: () => Effect.Effect<Entry[]>
  /** Current loaded entries for synchronous catalog transforms. */
  readonly current?: () => readonly Entry[]
  /** Compatibility roots consumed by internal compatibility plugins. */
  readonly compatibility?: () => Effect.Effect<{
    readonly claude: readonly AbsolutePath[]
    readonly agents: readonly AbsolutePath[]
  }>
  /**
   * Streams raw filesystem updates under config roots. Config owns root
   * topology and watch reconciliation; domain owners filter this feed for the
   * source files they parse and rebuild their own state.
   */
  readonly changes: () => Stream.Stream<Watcher.Update>
  /** Updates supported global config fields while preserving unrelated JSONC content. */
  readonly update?: (patch: Patch) => Effect.Effect<void, FSUtil.Error>
  readonly provider?: {
    readonly list: (preview?: {
      readonly providerID: Provider.ID
      readonly target: ProviderDefinition.Target
      readonly definition: ConfigProvider.Info
    }) => Effect.Effect<
      {
        readonly targets: readonly ProviderDefinition.TargetRevision[]
        readonly definitions: readonly {
          readonly providerID: Provider.ID
          readonly source: ProviderDefinition.Source
          readonly target?: ProviderDefinition.TargetRevision
          readonly definition: ConfigProvider.Info
        }[]
        readonly groups: readonly {
          readonly groupID: Model.GroupID
          readonly source: ProviderDefinition.Source
          readonly target?: ProviderDefinition.TargetRevision
          readonly definition: ModelGroup.Definition
        }[]
      },
      ConfigProviderFile.Error
    >
    readonly transaction: <A, E, R>(
      target: ProviderDefinition.Target,
      body: (
        file: ConfigProviderFile.File,
        write: (edit: ConfigProviderFile.Edit) => Effect.Effect<ConfigProviderFile.File, ConfigProviderFile.Error>,
        reload: Effect.Effect<void>,
      ) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | ConfigProviderFile.Error, R>
    /** Reload this Location when the specified authored target participates in its discovery. */
    readonly reload: (target: ProviderDefinition.Target) => Effect.Effect<boolean, ConfigProviderFile.Error>
  }
}

type AuthoredDeclaration = {
  readonly source: ProviderDefinition.Source
  readonly target?: ProviderDefinition.TargetRevision
} & (
  | { readonly kind: "provider"; readonly providerID: Provider.ID; readonly definition: ConfigProvider.Info }
  | { readonly kind: "group"; readonly groupID: Model.GroupID; readonly definition: ModelGroup.Definition }
)

export const Options = Schema.Struct({
  project: Schema.optional(Schema.Boolean),
  // false skips the global config dir, ~/.claude, and ~/.agents; wellknown,
  // file, and content entries still load.
  global: Schema.optional(Schema.Boolean),
  file: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@omnixa/Config") {}

export interface TestInterface extends Interface {
  /** Replaces the entries returned by subsequent entries() calls. */
  readonly setEntries: (entries: Entry[]) => Effect.Effect<void>
  /** Emits one filesystem update to every changes() subscriber. */
  readonly emitChange: (update: Watcher.Update) => Effect.Effect<void>
}

export class Test extends Context.Service<Test, TestInterface>()("@omnixa/Config/Test") {}

/** In-memory config for tests: static entries with replaceable state and a test-driven change feed. */
export const testLayer = (
  initial: Entry[] = [],
  compatibility: { readonly claude: readonly AbsolutePath[]; readonly agents: readonly AbsolutePath[] } = {
    claude: [],
    agents: [],
  },
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const entries = yield* Ref.make(initial)
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const service = Test.of({
        entries: () => Ref.get(entries),
        compatibility: () => Effect.succeed(compatibility),
        changes: () => Stream.fromPubSub(updates),
        setEntries: (next) => Ref.set(entries, next),
        emitChange: (update) => PubSub.publish(updates, update).pipe(Effect.asVoid),
      })
      return Context.empty().pipe(Context.add(Service, service), Context.add(Test, service))
    }),
  )

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const watcher = yield* Watcher.Service
      const bus = yield* Bus.Service
      const credentials = yield* Credential.Service
      const globalService = yield* Global.Service
      const wellknown = yield* WellKnown.Service
      const spawner = yield* ChildProcessSpawner
      // Config reads host-local files even for a workspace-placed Location. Bind
      // its mutation service to that same filesystem instead of Environment.node.
      const fileMutation = yield* FileMutation.Service.pipe(
        Effect.provide(FileMutation.layer),
        Effect.provideService(Environment.Service, {
          spawner,
          files: Environment.makeFiles(Environment.makeLocalDriver(spawner)),
        }),
      )
      const reloadLock = Semaphore.makeUnsafe(1)
      const locationContext = yield* Effect.context<FSUtil.Service | Global.Service | Location.Service>()
      const decodeOptions = { errors: "all", onExcessProperty: "ignore" } as const
      const decodeInfo = Schema.decodeUnknownOption(Info, decodeOptions)
      const parseInfo = Effect.fn("Config.parseInfo")(function* (text: string, source: string) {
        const errors: ParseError[] = []
        const input: unknown = parse(text, errors, { allowTrailingComma: true })
        if (errors.length) {
          yield* Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: "$",
            kind: "invalid",
            action: "rejected malformed JSON or JSONC document",
          })
          return
        }
        const result = ConfigNormalize.normalize(input)
        yield* Effect.forEach(result.diagnostics, (diagnostic) =>
          Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: diagnostic.path[0] === "$" ? "$" : `$.${diagnostic.path.join(".")}`,
            kind: diagnostic.kind,
            action: diagnostic.message,
          }),
        )
        if (result.type === "rejected") return
        const info = Option.getOrUndefined(decodeInfo(result.encoded))
        if (info) return info
        yield* Effect.logWarning("configuration normalization diagnostic", {
          source,
          path: "$",
          kind: "invalid",
          action: "rejected canonical configuration after final validation",
        })
      })

      const loadFile = Effect.fnUntraced(function* (filepath: string) {
        const text = yield* fs.readFileStringSafe(filepath)
        if (text === undefined) return
        const substituted = yield* ConfigVariable.substitute({ type: "path", path: filepath, text })
        const info = yield* parseInfo(substituted, filepath)
        if (!info) return
        return new Document({ type: "document", path: AbsolutePath.make(filepath), info })
      })

      const loadWellknownEntry = Effect.fnUntraced(function* (entry: WellKnown.Entry) {
        const auth = entry.manifest.auth
        const credential = (yield* credentials.list(entry.integrationID)).at(-1)
        const variables = auth && credential?.value.type === "key" ? { [auth.env]: credential.value.key } : undefined
        // A failed refresh, including a missing credential, keeps the last resolved config so remote providers
        // and allowlists do not disappear; only removing the source clears it.
        const configs = yield* (
          variables ? wellknown.resolve(entry, variables) : Effect.fail(new Error("No usable wellknown credential"))
        ).pipe(
          Effect.catch((error) =>
            Effect.logWarning("failed to load wellknown config", { source: entry.origin, error }).pipe(
              Effect.andThen(wellknown.cached(entry.origin)),
            ),
          ),
        )
        return yield* Effect.forEach(configs, (config) =>
          ConfigVariable.substitute({
            type: "virtual",
            source: entry.origin,
            dir: entry.origin,
            text: JSON.stringify(config),
            env: variables,
          }).pipe(
            Effect.flatMap((text) => parseInfo(text, entry.origin)),
            Effect.map((info) => (info ? new Document({ type: "document", info }) : undefined)),
          ),
        ).pipe(Effect.map((documents) => documents.filter((document) => document !== undefined)))
      })

      const loadWellknown = Effect.fn("Config.loadWellknown")(function* () {
        const entries = yield* wellknown
          .entries()
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to discover wellknown config", { error }).pipe(Effect.as([] as const)),
            ),
          )
        return yield* Effect.forEach(entries, loadWellknownEntry).pipe(Effect.map((documents) => documents.flat()))
      })

      const loadDirectory = Effect.fnUntraced(function* (directory: AbsolutePath) {
        return [
          ...(yield* Effect.forEach(ConfigDiscovery.names, (file) => loadFile(path.join(directory, file))).pipe(
            Effect.map((configs) => configs.filter((config): config is Document => config !== undefined)),
          )),
          new Directory({ type: "directory", path: directory }),
        ]
      })

      const load = Effect.fn("Config.load")(function* (sources: ConfigDiscovery.Sources) {
        const direct = yield* Effect.forEach(sources.direct, (filepath) => loadFile(filepath)).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.filter((entry): entry is Document => entry !== undefined)),
        )

        const explicit = sources.explicit
          ? yield* loadFile(sources.explicit).pipe(
              Effect.map((config) => (config ? [config] : [])),
              Effect.orDie,
            )
          : []
        const content =
          options?.content !== undefined
            ? yield* ConfigVariable.substitute({
                type: "virtual",
                source: "OMNIXA_CONFIG_CONTENT",
                dir: location.directory,
                text: options.content,
              }).pipe(
                Effect.flatMap((text) => parseInfo(text, "OMNIXA_CONFIG_CONTENT")),
                Effect.map((info) => (info ? [new Document({ type: "document", info })] : [])),
                Effect.orDie,
              )
            : []

        // Global entries sit below explicit and direct files; project
        // directories rank above them.
        const globalSupplementary = sources.global ? yield* loadDirectory(sources.global).pipe(Effect.orDie) : []
        const projectSupplementary = yield* Effect.forEach(
          sources.project.filter((root) => root.present),
          (root) => loadDirectory(root.path),
        ).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.flat()),
        )
        return [
          ...(yield* loadWellknown().pipe(Effect.orDie)),
          ...globalSupplementary,
          ...explicit,
          ...direct,
          ...projectSupplementary,
          ...content,
        ]
      })

      const initial = yield* ConfigDiscovery.discover(options)
      let sources = initial
      let configs = yield* load(initial)
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const reloads = yield* PubSub.sliding<void>(1)
      // Readiness rescans recover writes made before a watch attached.
      const requestReload = PubSub.publish(reloads, undefined).pipe(Effect.asVoid)
      const watched = yield* FiberMap.make<string>()
      const reconcile = Effect.fn("Config.reconcileWatches")(function* (sources: ConfigDiscovery.Sources) {
        const plan = ConfigWatch.plan(sources)
        for (const key of Array.from(watched, ([key]) => key)) {
          if (!plan.has(key)) yield* FiberMap.remove(watched, key)
        }
        for (const [key, target] of plan) {
          yield* watcher
            .subscribe(target, requestReload)
            .pipe(
              Effect.flatMap(
                Stream.runForEach((update) => PubSub.publish(updates, update).pipe(Effect.andThen(requestReload))),
              ),
              FiberMap.run(watched, key, { onlyIfMissing: true, startImmediately: true }),
            )
        }
      })

      const reload = Effect.fn("Config.reload")(
        function* () {
          const discovered = yield* ConfigDiscovery.discover(options)
          const next = yield* load(discovered)
          yield* reconcile(discovered)
          const compatibilityChanged =
            !isDeepStrictEqual(sources.claude, discovered.claude) ||
            !isDeepStrictEqual(sources.agents, discovered.agents)
          if (isDeepStrictEqual(configs, next) && !compatibilityChanged) return
          sources = discovered
          configs = next
          yield* bus.publish(Event.Updated, {})
        },
        (effect) => reloadLock.withPermit(effect),
      )

      // Subscribe eagerly so synchronous watch readiness isn't dropped.
      const pendingReloads = yield* PubSub.subscribe(reloads)
      yield* Stream.fromSubscription(pendingReloads).pipe(
        Stream.debounce("100 millis"),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.filterEffect((event) =>
          wellknown.entries().pipe(
            Effect.map((entries) => entries.some((entry) => entry.integrationID === event.data.integrationID)),
            Effect.orElseSucceed(() => false),
          ),
        ),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(WellKnown.Event.Updated).pipe(
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown sources", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.sleep("10 minutes").pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (!wellknown.snapshot().length) return Effect.void
            return Effect.gen(function* () {
              const changed = yield* wellknown
                .refresh()
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to refresh wellknown manifests", { error }).pipe(Effect.as(false)),
                  ),
                )
              if (!changed) yield* reload()
            }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to refresh wellknown config", { cause })))
          }),
        ),
        Effect.forever,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* reloadLock.withPermit(reconcile(initial))

      const update = Effect.fn("Config.update")(function* (patch: Patch) {
        const directory = initial.global ?? AbsolutePath.make(globalService.config)
        const candidates = ConfigDiscovery.names.map((name) => path.join(directory, name))
        const filepath = (yield* Effect.filter(candidates, fs.isFile)).at(-1) ?? path.join(directory, "omnixa.jsonc")
        const resolved = yield* fs.resolve(filepath)
        yield* fileMutation.withLock([resolved])(
          Effect.gen(function* () {
            const text =
              (yield* fs
                .readFileString(resolved)
                .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined))) ?? "{}\n"
            const errors: ParseError[] = []
            const input: unknown = parse(text, errors, { allowTrailingComma: true })
            if (errors.length || typeof input !== "object" || input === null || Array.isArray(input))
              return yield* new FSUtil.FileSystemError({
                method: "config.update",
                cause: new Error("Configuration must be a valid JSON or JSONC object"),
              })
            const updated = yield* Effect.try({
              try: () =>
                applyEdits(
                  text,
                  modify(text, ["shell"], patch.shell ?? undefined, {
                    formattingOptions: { tabSize: 2, insertSpaces: true },
                  }),
                ),
              catch: (cause) => new FSUtil.FileSystemError({ method: "config.update", cause }),
            })
            yield* fileMutation
              .writeAtomic({
                target: { absolute: AbsolutePath.make(resolved), resource: resolved },
                content: updated.endsWith("\n") ? updated : `${updated}\n`,
              })
              .pipe(Effect.mapError((cause) => new FSUtil.FileSystemError({ method: "config.update", cause })))
            yield* requestReload
            return undefined
          }),
        )
      })

      const providerTargets = Effect.fn("Config.providerTargets")(function* () {
        const discovered = yield* ConfigDiscovery.discover(options).pipe(Effect.provideContext(locationContext))
        const candidates: ProviderDefinition.Target[] = [
          ...(discovered.global
            ? ConfigDiscovery.names.map((name) => ({
                scope: "global" as const,
                path: AbsolutePath.make(path.join(discovered.global!, name)),
              }))
            : []),
          ...(discovered.explicit ? [{ scope: "explicit" as const, path: discovered.explicit }] : []),
          ...discovered.direct.map((filepath) => ({ scope: "project" as const, path: filepath })),
          ...discovered.project.flatMap((root) =>
            ConfigDiscovery.names.map((name) => ({
              scope: "project" as const,
              path: AbsolutePath.make(path.join(root.path, name)),
            })),
          ),
        ]
        const resolved = yield* Effect.forEach(candidates, (target) =>
          fs.resolve(target.path).pipe(Effect.map((filepath) => ({ ...target, path: AbsolutePath.make(filepath) }))),
        )
        const targets = [...new Map(resolved.map((target) => [target.path, target])).values()]
        const present = new Set(
          yield* Effect.filter(
            targets.map((target) => target.path),
            fs.isFile,
          ),
        )
        const preferred = new Set([
          targets.filter((target) => target.scope === "global" && present.has(target.path)).at(-1)?.path ??
            targets.find((target) => target.scope === "global" && path.basename(target.path) === "omnixa.jsonc")?.path,
          targets.filter((target) => target.scope === "project" && present.has(target.path)).at(-1)?.path ??
            targets.find(
              (target) => target.scope === "project" && target.path === path.join(location.directory, "omnixa.jsonc"),
            )?.path,
          targets.find((target) => target.scope === "explicit")?.path,
        ])
        return targets.map((target) => ({ target, preferred: preferred.has(target.path) }))
      })

      const provider: NonNullable<Interface["provider"]> = {
        list: Effect.fn("Config.provider.list")(function* (preview?: {
          readonly providerID: Provider.ID
          readonly target: ProviderDefinition.Target
          readonly definition: ConfigProvider.Info
        }) {
          const targets = yield* providerTargets()
          const files = yield* Effect.forEach(targets, (item) =>
            ConfigProviderFile.read(fs, item.target, item.preferred).pipe(
              Effect.map((file) => ({
                target: file.target,
                definitions: file.definitions,
                modelGroups: file.modelGroups,
              })),
              Effect.catchTag("ConfigProviderFile.InvalidDocument", (error) =>
                Effect.succeed({
                  target: { ...error.target, message: error.message },
                  definitions: {},
                  modelGroups: {},
                }),
              ),
            ),
          )
          const definitions = files.flatMap<AuthoredDeclaration>((file) => {
            const providers: Readonly<Record<string, ConfigProvider.Info>> =
              preview?.target.path === file.target.path
                ? { ...file.definitions, [preview.providerID]: preview.definition }
                : file.definitions
            return [
              ...Object.entries(providers).map(([id, definition]) => ({
                kind: "provider" as const,
                providerID: Provider.ID.make(id),
                source: { scope: file.target.scope, path: file.target.path },
                target: file.target,
                definition,
              })),
              ...Object.entries(file.modelGroups).map(([id, definition]) => ({
                kind: "group" as const,
                groupID: Model.GroupID.make(id),
                source: { scope: file.target.scope, path: file.target.path },
                target: file.target,
                definition,
              })),
            ]
          })
          const ranks = yield* Effect.forEach(
            configs.filter((entry): entry is Document => entry.type === "document"),
            (entry) =>
              Effect.gen(function* () {
                const filepath = entry.path ? yield* fs.resolve(entry.path) : undefined
                return { filepath, entry }
              }),
          )
          const contentEntry = options?.content !== undefined ? configs.at(-1) : undefined
          const ordered = ranks.flatMap<AuthoredDeclaration>((rank) =>
            rank.entry === contentEntry
              ? []
              : rank.filepath
                ? definitions.filter((item) => item.target?.path === rank.filepath)
                : [
                    ...Object.entries(rank.entry.info.providers ?? {}).map(([id, definition]) => ({
                      kind: "provider" as const,
                      providerID: Provider.ID.make(id),
                      source: { scope: "virtual" as const },
                      definition,
                    })),
                    ...Object.entries(rank.entry.info.modelGroups ?? {}).map(([id, definition]) => ({
                      kind: "group" as const,
                      groupID: Model.GroupID.make(id),
                      source: { scope: "virtual" as const },
                      definition,
                    })),
                  ],
          )
          const present = new Set(ordered.flatMap((item) => (item.target ? [item.target.path] : [])))
          const omitted = definitions.filter((item) => item.target && !present.has(item.target.path))
          const inserted =
            preview &&
            omitted.find(
              (item) =>
                item.kind === "provider" &&
                item.providerID === preview.providerID &&
                item.target?.path === preview.target.path,
            )
          const rank = preview ? files.findIndex((file) => file.target.path === preview.target.path) : -1
          const after = inserted
            ? ordered.findIndex(
                (item) => item.target && files.findIndex((file) => file.target.path === item.target?.path) > rank,
              )
            : -1
          const position = after < 0 ? ordered.length : after
          // Failed/missing runtime documents still remain editable. Keep explicit
          // config content after authored files, as Config.load orders it.
          const content: AuthoredDeclaration[] =
            contentEntry?.type === "document" && !contentEntry.path
              ? [
                  ...Object.entries(contentEntry.info.providers ?? {}).map(([id, definition]) => ({
                    kind: "provider" as const,
                    providerID: Provider.ID.make(id),
                    source: { scope: "virtual" as const },
                    definition,
                  })),
                  ...Object.entries(contentEntry.info.modelGroups ?? {}).map(([id, definition]) => ({
                    kind: "group" as const,
                    groupID: Model.GroupID.make(id),
                    source: { scope: "virtual" as const },
                    definition,
                  })),
                ]
              : []
          const declarations = [
            ...ordered.slice(0, position),
            ...(inserted ? [inserted] : []),
            ...ordered.slice(position),
            ...omitted.filter((item) => item !== inserted),
            ...content,
          ]
          return {
            targets: files.map((file) => file.target),
            definitions: declarations
              .filter((item) => item.kind === "provider")
              .map((item) => ({
                providerID: item.providerID,
                source: item.source,
                target: item.target,
                definition: item.definition,
              })),
            groups: declarations
              .filter((item) => item.kind === "group")
              .map((item) => ({
                groupID: item.groupID,
                source: item.source,
                target: item.target,
                definition: item.definition,
              })),
          }
        }),
        transaction: (target, body) =>
          Effect.gen(function* () {
            const legal = (yield* providerTargets()).find(
              (item) => item.target.scope === target.scope && item.target.path === target.path,
            )
            if (!legal)
              return yield* new ConfigProviderFile.InvalidTargetError({
                message: "Choose a configuration target returned by provider.definition.get",
              })
            return yield* fileMutation.withLock([legal.target.path])(
              Effect.gen(function* () {
                let current = yield* ConfigProviderFile.read(fs, legal.target, legal.preferred)
                const write = Effect.fnUntraced(function* (edit: ConfigProviderFile.Edit) {
                  const next = yield* ConfigProviderFile.write(fs, fileMutation, current, edit)
                  current = next
                  return next
                })
                return yield* body(current, write, reload().pipe(Effect.provideContext(locationContext)))
              }),
            )
          }),
        reload: (target) =>
          Effect.gen(function* () {
            const participates = (yield* providerTargets()).some((item) => item.target.path === target.path)
            if (!participates) return false
            yield* reload().pipe(Effect.provideContext(locationContext))
            return true
          }),
      }

      return Service.of({
        current: () => configs,
        entries: Effect.fnUntraced(function* () {
          return configs
        }),
        compatibility: () =>
          Effect.all({
            claude: Effect.filter(sources.claude, fs.isDir),
            agents: Effect.filter(sources.agents, fs.isDir),
          }),
        changes: () => Stream.fromPubSub(updates),
        update,
        provider,
      })
    }),
  )

export function configured(options?: Options) {
  return makeLocationNode({
    service: Service,
    layer: layer(options),
    deps: [
      Watcher.node,
      Bus.node,
      FSUtil.node,
      Global.node,
      Location.node,
      Credential.node,
      WellKnown.node,
      CrossSpawnSpawner.node,
    ],
  })
}

export const node = configured()
