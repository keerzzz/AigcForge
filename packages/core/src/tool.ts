export * as Tool from "./tool.js"
export { CallID, Content, Error, FileContent, TextContent } from "@omnixa/schema/tool"
export type { Context, Metadata, Namespace, Options, Result } from "@omnixa/schema/tool"

import { ToolDefinition, type ToolCall } from "@omnixa/ai"
import { Tool } from "@omnixa/schema/tool"
import { Cause, Context, Effect, Layer, Ref, Result, Schema, SchemaIssue, Types } from "effect"
import { makeLocationNode } from "@omnixa/util/effect/app-node"
import type { Agent } from "./agent.js"
import { CodeModeCatalog } from "./codemode/catalog.js"
import { CodeModeTool } from "./codemode/tool.js"
import { CompositionDigest } from "./composition/digest.js"
import { Image } from "./image.js"
import { Permission } from "./permission.js"
import { PluginHooks } from "./plugin/hooks.js"
import { Producer } from "./plugin/service.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { State } from "./state.js"
import { definition, effectiveName, execute, normalizedName, normalizeContent } from "./tool/runtime.js"
import { Wildcard } from "./util/wildcard.js"

export class RegistrationError extends Schema.TaggedError<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export interface Editor {
  readonly list: () => readonly (Tool.Info & { readonly id: string; readonly producer?: Producer })[]
  readonly get: (id: string) => (Tool.Info & { readonly id: string; readonly producer?: Producer }) | undefined
  readonly namespace: (namespace: Tool.Namespace) => void
  readonly add: (tool: Tool.Info) => void
  readonly update: (id: string, update: (tool: Types.Mutable<Tool.Info>) => void) => void
  readonly remove: (id: string) => void
}

type Data = {
  tools: Map<string, Tool.Info & { readonly id: string; readonly producer?: Producer }>
  namespaces: Map<string, Tool.Namespace>
  errors: { kind: "tool" | "namespace"; name: string; namespace?: string; error: RegistrationError }[]
}

export interface Interface extends State.Transformable<Editor> {
  readonly transform: (
    callback: Parameters<State.Transform<Editor>>[0],
    producer?: Producer,
  ) => ReturnType<State.Transform<Editor>>
  readonly list: () => Effect.Effect<ReadonlyArray<Tool.Info & { readonly id: string; readonly producer?: Producer }>>
  /** Selects registrations by effective name; the synthetic Code Mode entry follows permission rules. */
  readonly snapshot: (
    permissions?: Permission.Ruleset,
    includeRegistered?: (name: string) => boolean,
  ) => Effect.Effect<Snapshot>
}

/** A local execution result after hooks and content normalization. */
export interface NormalizedResult extends Tool.Result {
  readonly content: ReadonlyArray<Tool.Content>
}

export interface Snapshot {
  /** Local identity of the immutable registry state captured by this snapshot. */
  readonly revision?: object
  readonly definitions: ReadonlyArray<ToolDefinition>
  /** All captured callables, including tools reached through Code Mode. */
  readonly catalog: ReadonlyArray<
    ToolDefinition & {
      readonly placement: "direct" | "codemode"
      readonly options?: Tool.Options
      readonly producer?: Producer
      /** Root-to-leaf namespace metadata used by Code Mode guidance and discovery. */
      readonly namespaceMetadata?: ReadonlyArray<Tool.Namespace>
    }
  >
  readonly codeModeCatalog?: CodeModeCatalog.Inventory
  readonly execute: (input: {
    readonly sessionID: SessionSchema.ID
    readonly agent: Agent.ID
    readonly messageID: SessionMessage.ID
    readonly call: ToolCall
    readonly progress?: (update: Tool.Metadata) => Effect.Effect<void>
    /** Surviving request definitions, keyed by the names advertised after session context hooks. */
    readonly definitions?: ReadonlyMap<string, ToolDefinition>
  }) => Effect.Effect<NormalizedResult, Tool.Error>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/Tool") {}

/** Reuse the normal post-execution pipeline when recovering an already executed tool. */
export const finalizeResult = Effect.fn("Tool.finalizeResult")(function* (
  event: Extract<PluginHooks.Domains["tool"]["execute.after"], { status: "completed" }>,
) {
  const hooks = yield* PluginHooks.Service
  const image = yield* Image.Service
  type NormalizedItem = Tool.Content | "decode" | "size"
  const normalizeImages = Effect.fnUntraced(function* (content: ReadonlyArray<Tool.Content>) {
    const normalized = yield* Effect.forEach(content, (item): Effect.Effect<NormalizedItem> => {
      if (item.type !== "file" || !item.mime.startsWith("image/")) return Effect.succeed(item)
      const base64 = /^data:[^,]*;base64,(.*)$/s.exec(item.uri)?.[1]
      if (base64 === undefined) return Effect.succeed(item)
      const resource = item.name ?? `${item.mime} tool output`
      return image.normalize(resource, { uri: resource, content: base64, encoding: "base64", mime: item.mime }).pipe(
        Effect.map((result) => ({
          ...item,
          uri: `data:${result.mime};base64,${result.content}`,
          mime: result.mime,
        })),
        Effect.catchTag("Image.ResizerUnavailableError", () => Effect.succeed(item)),
        Effect.catchTag("Image.DecodeError", () => Effect.succeed("decode" as const)),
        Effect.catchTag("Image.SizeError", () => Effect.succeed("size" as const)),
      )
    })
    const note = (reason: "decode" | "size", text: string) => {
      const count = normalized.filter((item) => item === reason).length
      if (count === 0) return []
      return [{ type: "text" as const, text: `[${count} image${count === 1 ? "" : "s"} omitted: ${text}]` }]
    }
    return [
      ...normalized.filter((item) => typeof item !== "string"),
      ...note("decode", "could not be decoded."),
      ...note("size", "could not be resized below the image size limit."),
    ]
  })
  yield* hooks.trigger("tool", "execute.after", event)
  const content = yield* normalizeImages(normalizeContent(event.result.content, event.result.output))
  return {
    ...(event.result.output === undefined ? {} : { output: event.result.output }),
    content,
    ...(event.result.metadata === undefined ? {} : { metadata: event.result.metadata }),
  }
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const image = yield* Image.Service

    const beforeExecute = (name: string, input: unknown, context: Tool.Context) =>
      hooks.trigger("tool", "execute.before", {
        tool: name,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        id: context.id,
        input,
      })

    const executeTool = Effect.fn("Tool.execute")(function* (
      tool: Tool.Info,
      name: string,
      input: unknown,
      context: Tool.Context,
    ) {
      const execution = yield* execute(tool, input, context).pipe(
        Effect.map((value) => ({ value })),
        Effect.catchTag("Tool.Error", (failure) => Effect.succeed({ failure })),
      )
      const base = {
        tool: name,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        id: context.id,
        input,
      }
      if ("failure" in execution) {
        const afterEvent: PluginHooks.Domains["tool"]["execute.after"] = {
          ...base,
          status: "error",
          error: execution.failure,
        }
        yield* hooks.trigger("tool", "execute.after", afterEvent)
        return yield* afterEvent.error
      }
      const afterEvent: PluginHooks.Domains["tool"]["execute.after"] = {
        ...base,
        status: "completed",
        result: {
          ...(execution.value.output === undefined ? {} : { output: execution.value.output }),
          content: execution.value.content,
          ...(execution.value.metadata === undefined ? {} : { metadata: execution.value.metadata }),
        },
      }
      return yield* finalizeResult(afterEvent).pipe(
        Effect.provideService(PluginHooks.Service, hooks),
        Effect.provideService(Image.Service, image),
      )
    })

    let catalog: { data: Data; names: string; value: CodeModeCatalog.Inventory } | undefined
    const state = State.create<
      Data,
      Omit<Editor, "add" | "update"> & {
        readonly add: (tool: Tool.Info, producer?: Producer) => void
        readonly update: (id: string, update: (tool: Types.Mutable<Tool.Info>) => void, producer?: Producer) => void
      }
    >({
      name: "tool",
      initial: () => ({
        tools: new Map(),
        namespaces: new Map(),
        errors: [],
      }),
      editor: (editor) => ({
        list: () => Array.from(editor.tools.values()),
        get: (id) => editor.tools.get(id),
        namespace: (namespace) => {
          const error = namespaceError(namespace.name)
          if (error) {
            editor.errors.push({ kind: "namespace", name: namespace.name, namespace: namespace.name, error })
            return
          }
          editor.namespaces.set(namespace.name, { ...namespace })
        },
        add: (tool, producer) => {
          const error = registrationError(tool)
          if (error) {
            editor.errors.push({ kind: "tool", name: tool.name, namespace: tool.options?.namespace, error })
            return
          }
          const id = effectiveName(tool)
          const registered = { ...tool, id, producer, options: tool.options && { ...tool.options } }
          if (producer === undefined) delete registered.producer
          editor.tools.set(id, registered)
        },
        update: (id, update, producer) => {
          const current = editor.tools.get(id)
          if (!current) return
          const tool = { ...current, options: current.options && { ...current.options } }
          update(tool)
          tool.name = current.name
          tool.id = id
          if (tool.options?.namespace !== current.options?.namespace)
            tool.options = { ...tool.options, namespace: current.options?.namespace }
          const error = registrationError(tool)
          if (error) {
            editor.errors.push({ kind: "tool", name: tool.name, namespace: tool.options?.namespace, error })
            return
          }
          // An unproven replacement must not inherit the previous implementation's identity.
          tool.producer =
            producer === undefined || current.producer === undefined
              ? undefined
              : new Producer({
                  id: producer.id,
                  revision: CompositionDigest.computeDigest({ base: current.producer, update: producer }),
                })
          if (tool.producer === undefined) delete tool.producer
          editor.tools.set(id, tool)
        },
        remove: (id) => {
          editor.tools.delete(id)
        },
      }),
      notify: (value) => {
        catalog = undefined
        return Effect.forEach(
          value.errors,
          ({ kind, name, namespace, error }) =>
            Effect.logError(`Skipping invalid ${kind} registration`, {
              name,
              namespace,
              error: error.message,
            }),
          { discard: true },
        )
      },
    })

    return Service.of({
      transform: (callback, producer) =>
        state.transform((editor) =>
          callback({
            ...editor,
            add: (tool) => editor.add(tool, producer),
            update: (id, update) => editor.update(id, update, producer),
          }),
        ),
      reload: state.reload,
      list: () => Effect.sync(() => Array.from(state.get().tools.values())),
      snapshot: Effect.fn("Tool.snapshot")((permissions, includeRegistered) =>
        Effect.sync(() => {
          const data = state.get()
          const active = new Map<string, Tool.Info & { readonly producer?: Producer }>()
          const rules = permissions ?? []
          for (const [name, tool] of data.tools) {
            if (includeRegistered !== undefined && !includeRegistered(name)) continue
            if (whollyDisabled(tool.options?.permission ?? name, rules)) continue
            active.set(name, tool)
          }
          const direct = new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode === false))
          const codeModeTools = new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode !== false))
          const namespaces = data.namespaces
          const codeModeInventory = { tools: codeModeTools, namespaces }
          const codeModeEnabled = !whollyDisabled("execute", rules)
          const createCodeModeTool = (fatal?: Ref.Ref<Cause.Cause<Tool.Error> | undefined>) =>
            CodeModeTool.create(codeModeInventory, (name, tool, input, context) =>
              beforeExecute(name, input, context).pipe(
                Effect.flatMap((event) => executeTool(tool, name, event.input, context)),
                Effect.catchCause((cause) => {
                  const fatalCause =
                    Cause.hasDies(cause) || (Cause.hasInterrupts(cause) && !Cause.hasInterruptsOnly(cause))
                  if (fatal === undefined || !fatalCause) return Effect.failCause(cause)
                  // The interpreter permits catching ordinary tool errors. Defects must leave
                  // that sandbox through its interruption path and retain their original cause.
                  return Ref.update(fatal, (current) => current ?? cause).pipe(Effect.andThen(Effect.interrupt))
                }),
              ),
            )
          const codeModeTool = codeModeEnabled ? createCodeModeTool() : undefined
          const names = Array.from(codeModeTools.keys()).join("\0")
          // Discovery is immutable for a registry revision and visible tool set. Keep request
          // definitions/executors fresh, but share the much larger rendered catalog across steps.
          const codeModeCatalog = !codeModeEnabled
            ? undefined
            : catalog?.data === data && catalog.names === names
              ? catalog.value
              : CodeModeTool.catalog(codeModeInventory)
          if (codeModeCatalog) catalog = { data, names, value: codeModeCatalog }
          const definitions = structuredClone([
            ...Array.from(direct)
              .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
              .map(([, tool]) => definition(tool)),
            ...(codeModeTool ? [definition(codeModeTool)] : []),
          ])
          return {
            revision: data,
            ...(codeModeCatalog === undefined ? {} : { codeModeCatalog }),
            definitions,
            // Separate JSON data from producer schemas and request-hook mutations. Captured
            // executors deliberately retain their producer-owned services and state.
            catalog: structuredClone([
              ...definitions.map((tool) => {
                const options = captureOptions(direct.get(tool.name)?.options)
                const producer = direct.get(tool.name)?.producer
                return {
                  ...tool,
                  placement: "direct" as const,
                  ...(options === undefined ? {} : { options }),
                  ...(producer === undefined ? {} : { producer }),
                }
              }),
              ...(codeModeEnabled
                ? Array.from(codeModeTools.values()).map((tool) => {
                    const options = captureOptions(tool.options)
                    const namespaceMetadata = (
                      tool.options?.namespace === undefined
                        ? normalizedName(tool)
                        : `${tool.options.namespace}.${normalizedName(tool)}`
                    )
                      .split(".")
                      .flatMap((_, index, segments) => {
                        const namespace = namespaces.get(segments.slice(0, index + 1).join("."))
                        return namespace === undefined
                          ? []
                          : [{ name: namespace.name, description: namespace.description }]
                      })
                    return {
                      ...definition(tool),
                      placement: "codemode" as const,
                      ...(options === undefined ? {} : { options }),
                      ...(tool.producer === undefined ? {} : { producer: tool.producer }),
                      // An empty capture freezes an unregistered namespace; historical omission
                      // cannot silently adopt its current discovery metadata during restoration.
                      ...(namespaceMetadata.length === 0 && tool.options?.namespace === undefined
                        ? {}
                        : { namespaceMetadata }),
                    }
                  })
                : []),
            ]).toSorted((left, right) => {
              if (left.name < right.name) return -1
              if (left.name > right.name) return 1
              if (left.placement < right.placement) return -1
              if (left.placement > right.placement) return 1
              return 0
            }),
            execute: Effect.fnUntraced(function* (input: Parameters<Snapshot["execute"]>[0]) {
              const context: Tool.Context = {
                sessionID: input.sessionID,
                agent: input.agent,
                messageID: input.messageID,
                id: Tool.CallID.make(input.call.id),
                progress: input.progress ?? (() => Effect.void),
              }
              const event = yield* beforeExecute(input.call.name, input.call.input, context)
              const requested = input.definitions?.get(event.tool)
              // Preserve session context removal and alias resolution, now after the repair hook.
              if (!requested && input.definitions && (direct.has(event.tool) || codeModeTool?.name === event.tool))
                return yield* new Tool.Error({ message: `Tool is not available for this request: ${event.tool}` })
              const name = requested?.name ?? event.tool
              if (name === "execute" && codeModeTool)
                return yield* Effect.uninterruptibleMask((restore) =>
                  Effect.gen(function* () {
                    // Each invocation owns its cause, including concurrent uses of one snapshot.
                    const fatal = yield* Ref.make<Cause.Cause<Tool.Error> | undefined>(undefined)
                    const result = yield* Effect.exit(
                      restore(executeTool(createCodeModeTool(fatal), name, event.input, context)),
                    )
                    const cause = yield* Ref.get(fatal)
                    if (cause !== undefined) return yield* Effect.failCause(cause)
                    return yield* result
                  }),
                )
              const tool = direct.get(name)
              if (tool) return yield* executeTool(tool, name, event.input, context)
              return yield* new Tool.Error({
                message: `No tool named "${name}" is currently available. Please use a tool from the available tool list.`,
              })
            }),
          }
        }),
      ),
    })
  }),
)

const whollyDisabled = (action: string, rules: Permission.Ruleset) => {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

const formatSchemaIssue = SchemaIssue.makeFormatterDefault()

function schemaMakeError(error: unknown) {
  if (error instanceof Error && SchemaIssue.isIssue(error.cause)) return formatSchemaIssue(error.cause)
  return error instanceof Error ? error.message : String(error)
}

function registrationError(tool: Tool.Info) {
  const namespace = tool.options?.namespace
  if (namespace !== undefined) {
    const error = namespaceError(namespace)
    if (error) return error
  }
  const name = normalizedName(tool)
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return new RegistrationError({ name, message: `Invalid tool name: ${name}` })
  const id = effectiveName(tool)
  if (tool.options?.codemode === false && id === "execute")
    return new RegistrationError({ name: id, message: 'Tool name "execute" is reserved for CodeMode' })
  const result = Result.try({
    try: () => {
      const captured = definition(tool)
      ToolDefinition.make(captured)
      const options = captureOptions(tool.options)
      // Raw JSON Schema extensions must remain JSON values, so an invalid tool
      // cannot make the whole request snapshot fail during capture.
      return Schema.decodeUnknownSync(Schema.Json)({
        ...captured,
        ...(options === undefined ? {} : { options }),
      })
    },
    catch: (error) =>
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: ${schemaMakeError(error)}` }),
  })
  return Result.isFailure(result) ? result.failure : undefined
}

function captureOptions(options?: Tool.Options) {
  if (options === undefined) return
  const captured = { ...options }
  if (captured.namespace === undefined) delete captured.namespace
  if (captured.permission === undefined) delete captured.permission
  if (captured.codemode === undefined) delete captured.codemode
  if (captured.pinned === undefined) delete captured.pinned
  return captured
}

function namespaceError(name: string) {
  if (name.split(".").every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))) return
  return new RegistrationError({ name, message: `Invalid tool namespace: ${JSON.stringify(name)}` })
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, Image.node],
})
