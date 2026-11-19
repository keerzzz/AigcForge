export * as ConfigAgentPlugin from "./agent.js"

import { define } from "@aigcfroge/plugin/effect/plugin"
import { Document, Info, type Entry } from "@aigcfroge/schema/config"
import { ConfigAgent } from "@aigcfroge/schema/config/agent"
import { AgentAsset } from "@aigcfroge/schema/agent-asset"
import path from "path"
import { Effect, Option, PubSub, Schema, Stream } from "effect"
import { Agent } from "../../agent.js"
import { Model } from "../../model.js"
import { Config } from "../../config.js"
import { ConfigMarkdown } from "../markdown.js"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { ConfigAgentV1 } from "../../v1/config/agent.js"
import { ConfigMigrateV1 } from "../../v1/config/migrate.js"
import { Global } from "@aigcfroge/util/global"
import { Permission } from "../../permission.js"
import type { FileAccess } from "../../file-access.js"
import type { ReadTool } from "../../tool/plugin/read.js"
import type { EditTool } from "../../tool/plugin/edit.js"
import { AbsolutePath } from "../../schema.js"
import { AgentProtocol } from "../../agent/protocol.js"
import { AssetYaml } from "../../util/asset-yaml.js"

const legacySources = [
  { pattern: "{agent,agents}/**/*.md", primary: false },
  { pattern: "{mode,modes}/*.md", primary: true },
] as const
// Keep in sync with the legacySources patterns and the name-strip regex in decode.
const sourceDirectories = ["agent", "agents", "mode", "modes"] as const
const decodeAgent = Schema.decodeUnknownOption(ConfigAgent.Info)
const decodeLegacyAgent = Schema.decodeUnknownOption(ConfigAgentV1.Info)
const decodeConfig = Schema.decodeUnknownOption(Info)
type PathAction = FileAccess.ExternalDirectoryAuthorization["action"] | typeof ReadTool.name | typeof EditTool.name
const pathActions = ["external_directory", "read", "edit"] as const satisfies readonly PathAction[]
const agentKeys = new Set(["variant", ...Object.keys(ConfigAgent.Info.fields)])

export const Plugin = define({
  id: "aigcfroge.config.agent",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const load = () => loadDocuments(config, fs)
    const loaded = { documents: [] as Document[] }
    const reload = load().pipe(
      Effect.tap((documents) => Effect.sync(() => (loaded.documents = documents))),
      Effect.andThen(ctx.agent.reload()),
    )
    // One trigger feed serializes reloads and shares one debounce window;
    // subscribing before the initial scan means updates racing the scan still
    // trigger a rebuild. Each source is subscribed eagerly on its own fiber
    // (Stream.merge and Stream.debounce both open upstream a fiber hop later)
    // so no update slips through while the debounce starts its pull.
    const changes = yield* PubSub.sliding<void>(1)
    const notify = () => PubSub.publish(changes, undefined)
    yield* config.changes().pipe(
      Stream.filterEffect((update) => Effect.map(config.entries(), (entries) => isAgentSource(entries, update.path))),
      Stream.runForEach(notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.documents = yield* load()
    yield* ctx.agent.transform((editor) => {
      const origins = new Map(editor.list().map((agent) => [agent.id, agent.originKind]))
      const permissions = expandPermissions(
        loaded.documents.flatMap((document) => document.info.permissions ?? []),
        global.home,
      )
      const configuredDefault = Config.latest(loaded.documents, "default_agent")
      if (configuredDefault !== undefined) editor.default(Agent.ID.make(configuredDefault))
      for (const current of editor.list()) {
        editor.update(current.id, (agent) => agent.permissions.push(...permissions))
      }

      for (const [id, merged] of declarations(loaded.documents)) {
        const item = merged.info
        const agentID = Agent.ID.make(id)
        if (item.disabled) {
          editor.remove(agentID)
          continue
        }

        if (merged.reset) editor.remove(agentID)
        const exists = editor.get(agentID) !== undefined
        editor.update(agentID, (agent) => {
          agent.originKind = origins.get(agentID) ?? "user"
          if (!exists) agent.permissions.push(...permissions)
          if (item.model !== undefined) agent.model = Model.fromConfig(item.model)
          if (item.request !== undefined) {
            Object.assign(agent.request.headers, item.request.headers ?? {})
            Object.assign(agent.request.body, item.request.body ?? {})
          }
          if (item.system !== undefined) agent.system = item.system
          if (item.description !== undefined) agent.description = item.description
          if (item.card !== undefined) Object.assign(agent, { card: item.card })
          if (item.mode !== undefined) agent.mode = item.mode
          if (item.hidden !== undefined) agent.hidden = item.hidden
          if (item.color !== undefined) agent.color = item.color
          if (item.steps !== undefined) agent.steps = item.steps
          if (item.handoffs !== undefined) agent.handoffs = Array.from(item.handoffs)
          if (item.permissions !== undefined) {
            agent.permissions.push(...expandPermissions(item.permissions, global.home))
          }
        })
      }
    })
  }),
})

export const candidate = Effect.fn("ConfigAgentPlugin.candidate")(function* (id: Agent.ID) {
  const agents = yield* Agent.Service
  if ((yield* agents.get(id))?.originKind !== "user") return
  const config = yield* Config.Service
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const documents = yield* loadDocuments(config, fs)
  const definition = declarations(documents).get(id)?.info
  if (!definition || definition.disabled) return
  const defaults = Agent.Info.default(id)
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(AgentAsset.Candidate)({
      name: id,
      description: definition.description ?? "",
      config: AssetYaml.stringify(
        Schema.encodeSync(ConfigAgent.Info)(
          new ConfigAgent.Info({
            ...definition,
            system: undefined,
            mode: definition.mode ?? defaults.mode,
            hidden: definition.hidden ?? defaults.hidden,
            handoffs: definition.handoffs ?? defaults.handoffs,
            permissions: expandPermissions(
              [
                ...defaults.permissions,
                ...documents.flatMap((document) => document.info.permissions ?? []),
                ...(definition.permissions ?? []),
              ],
              global.home,
            ),
          }),
        ),
      ),
      source: definition.system ?? "",
      relativePath: "",
    }),
  )
})

function loadDocuments(config: Config.Interface, fs: FSUtil.Interface) {
  return Effect.gen(function* () {
    return yield* Effect.forEach(yield* config.entries(), (entry) => {
      if (entry.type === "document") return Effect.succeed([entry])
      if (entry.type !== "directory") return Effect.succeed([])
      return discover(fs, entry.path).pipe(
        Effect.flatMap((files) =>
          Effect.forEach(files, (file) =>
            fs.readFileStringSafe(file.filepath).pipe(
              Effect.map((content) => (content ? decode(file, content) : undefined)),
              Effect.orElseSucceed(() => undefined),
            ),
          ),
        ),
        Effect.map((documents) => documents.filter((document): document is Document => document !== undefined)),
      )
    }).pipe(Effect.map((documents) => documents.flat()))
  })
}

function declarations(documents: readonly Document[]) {
  return documents
    .flatMap((document) => Object.entries(document.info.agents ?? {}))
    .reduce((result, [id, item]) => {
      const previous = result.get(id)
      if (item.disabled) {
        result.set(id, { info: item, reset: true })
        return result
      }
      const current = previous?.info.disabled ? undefined : previous?.info
      if (previous?.info.disabled) result.delete(id)
      result.set(id, {
        reset: previous?.reset ?? false,
        info: new ConfigAgent.Info({
          ...current,
          ...item,
          request:
            current?.request || item.request
              ? {
                  headers: { ...current?.request?.headers, ...item.request?.headers },
                  body: { ...current?.request?.body, ...item.request?.body },
                }
              : undefined,
          permissions: [...(current?.permissions ?? []), ...(item.permissions ?? [])],
        }),
      })
      return result
    }, new Map<string, { info: ConfigAgent.Info; reset: boolean }>())
}

// Matches anything at or under <root>/{agent,agents,mode,modes}. No file-suffix
// check: directory-level events such as renames carry no per-file paths.
function isAgentSource(entries: Entry[], file: string) {
  return entries.some(
    (entry) =>
      entry.type === "directory" &&
      sourceDirectories.some((name) => FSUtil.contains(path.join(entry.path, name), file)),
  )
}

function expandPermissions(rules: Permission.Ruleset, home: string): Permission.Ruleset {
  // Expand only resources tools resolve as filesystem paths. Bash resources are raw shell text:
  // rewriting `$HOME/private/**` would miss `$HOME/private/key`, and safe expansion needs shell-aware parsing.
  return rules.map((rule) =>
    isPathAction(rule.action) ? { ...rule, resource: expandHome(rule.resource, home) } : rule,
  )
}

function isPathAction(action: string): action is PathAction {
  return pathActions.some((item) => item === action)
}

function expandHome(resource: string, home: string) {
  if (resource === "~" || resource === "$HOME") return home
  const relative = resource.startsWith("~/")
    ? resource.slice(2)
    : resource.startsWith("$HOME/") || resource.startsWith("$HOME\\")
      ? resource.slice(6)
      : undefined
  if (relative !== undefined) return (path.posix.isAbsolute(home) ? path.posix : path.win32).join(home, relative)
  return resource
}

function discover(fs: FSUtil.Interface, directory: string) {
  return Effect.forEach(legacySources, (source) =>
    fs
      .scan(source.pattern, { cwd: directory, absolute: true, dot: true, symlink: true })
      .pipe(
        Effect.map((files) => files.toSorted().map((filepath) => ({ directory, filepath, primary: source.primary }))),
      ),
  ).pipe(
    Effect.map((files) => files.flat()),
    Effect.orElseSucceed(() => []),
  )
}

function decode(file: { directory: string; filepath: string; primary: boolean }, content: string) {
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return
  const name = path
    .relative(file.directory, file.filepath)
    .replaceAll("\\", "/")
    .replace(/^(agent|agents|mode|modes)\//, "")
    .replace(/\.md$/, "")
  const body = markdown.content.trim()
  const normalized = AgentProtocol.normalizeDefinition(markdown.data)
  const legacy = Object.keys(normalized.definition).some((key) => !agentKeys.has(key))
  // Join legacy model + variant without sending native request/permissions through migration.
  // Embedded and structured native selections, and a variant without a model, stay unchanged.
  const data =
    typeof normalized.definition.model === "string" &&
    !normalized.definition.model.includes("#") &&
    typeof normalized.definition.variant === "string" &&
    /^[^#]+$/.test(normalized.definition.variant)
      ? { ...normalized.definition, model: `${normalized.definition.model}#${normalized.definition.variant}` }
      : normalized.definition
  const agent = legacy
    ? Option.getOrUndefined(
        Option.map(
          decodeLegacyAgent({ name, ...normalized.definition, prompt: body }, { errors: "all" }),
          ConfigMigrateV1.migrateAgent,
        ),
      )
    : Option.getOrUndefined(decodeAgent({ ...data, system: body }, { errors: "all" }))
  if (!agent) return
  const info = Option.getOrUndefined(
    decodeConfig({
      agents: {
        [name]: {
          ...agent,
          ...(file.primary ? { mode: "primary" } : {}),
          ...(normalized.card === undefined ? {} : { card: normalized.card }),
        },
      },
    }),
  )
  if (!info) return
  return new Document({ type: "document", path: AbsolutePath.make(file.filepath), info })
}
