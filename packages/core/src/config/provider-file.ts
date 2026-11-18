export * as ConfigProviderFile from "./provider-file.js"

import { Effect, Option, Schema } from "effect"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { ConfigProvider } from "@aigcfroge/schema/config/provider"
import { ProviderDefinition } from "@aigcfroge/schema/provider-definition"
import { Provider } from "@aigcfroge/schema/provider"
import { Model } from "@aigcfroge/schema/model"
import { ModelGroup } from "@aigcfroge/schema/model-group"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Hash } from "@aigcfroge/util/hash"
import { FileMutation } from "../file-mutation.js"

type Json = Schema.Schema.Type<typeof Schema.Json>

export interface File {
  readonly target: ProviderDefinition.TargetRevision
  readonly text: string
  readonly data: Readonly<Record<string, Json>>
  readonly definitions: Readonly<Record<string, ConfigProvider.Info>>
  readonly modelGroups: Readonly<Record<string, ModelGroup.Definition>>
}

export type Edit =
  | {
      readonly type: "patch"
      readonly providerID: Provider.ID
      readonly patch: ProviderDefinition.Patch
      readonly adoption?: ConfigProvider.Adoption
    }
  | { readonly type: "adoption"; readonly providerID: Provider.ID; readonly adoption: ConfigProvider.Adoption }
  | { readonly type: "remove"; readonly providerID: Provider.ID }
  | { readonly type: "group-set"; readonly groupID: Model.GroupID; readonly definition: ModelGroup.Definition }
  | { readonly type: "group-remove"; readonly groupID: Model.GroupID }

export class InvalidTargetError extends Schema.TaggedError<InvalidTargetError>()("ConfigProviderFile.InvalidTarget", {
  message: Schema.String,
}) {}

export class InvalidDocumentError extends Schema.TaggedError<InvalidDocumentError>()(
  "ConfigProviderFile.InvalidDocument",
  {
    target: ProviderDefinition.TargetRevision,
    message: Schema.String,
  },
) {}

export class ConflictError extends Schema.TaggedError<ConflictError>()("ConfigProviderFile.Conflict", {
  target: ProviderDefinition.TargetRevision,
  message: Schema.String,
}) {}

export class ReadError extends Schema.TaggedError<ReadError>()("ConfigProviderFile.Read", {
  message: Schema.String,
}) {}

export class WriteError extends Schema.TaggedError<WriteError>()("ConfigProviderFile.Write", {
  target: ProviderDefinition.TargetRevision,
  message: Schema.String,
}) {}

export type Error = InvalidTargetError | InvalidDocumentError | ConflictError | ReadError | WriteError

const decodeObject = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Json))
const decodeDefinition = Schema.decodeUnknownOption(ConfigProvider.Info)
const decodeGroups = Schema.decodeUnknownOption(Schema.Record(Model.GroupID, ModelGroup.Definition))

export const read = Effect.fn("ConfigProviderFile.read")(function* (
  fs: FSUtil.Interface,
  target: ProviderDefinition.Target,
  preferred: boolean,
): Effect.fn.Return<File, ReadError | InvalidDocumentError> {
  const text = yield* fs.readFileString(target.path).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.undefined),
    Effect.mapError(() => new ReadError({ message: `Cannot read configuration: ${target.path}` })),
  )
  const revision: ProviderDefinition.TargetRevision = {
    ...target,
    digest: text === undefined ? null : Hash.sha256(text),
    preferred,
    writable: true,
  }
  if (text === undefined)
    return { target: revision, text: "{}\n", data: {}, definitions: {}, modelGroups: {} } satisfies File
  const errors: ParseError[] = []
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true })
  const data = decodeObject(parsed)
  if (errors.length || Option.isNone(data))
    return yield* new InvalidDocumentError({
      target: { ...revision, writable: false },
      message: "Configuration must be a valid JSON or JSONC object",
    })
  const definitions = data.value.providers === undefined ? Option.some({}) : decodeObject(data.value.providers)
  if (Option.isNone(definitions))
    return yield* new InvalidDocumentError({
      target: { ...revision, writable: false },
      message: "The providers field must be an object",
    })
  const decoded: Record<string, ConfigProvider.Info> = {}
  for (const [id, value] of Object.entries(definitions.value)) {
    const definition = decodeDefinition(value)
    if (Option.isNone(definition))
      return yield* new InvalidDocumentError({
        target: { ...revision, writable: false },
        message: `Invalid provider definition: ${id}`,
      })
    decoded[id] = definition.value
  }
  const modelGroups = data.value.modelGroups === undefined ? Option.some({}) : decodeGroups(data.value.modelGroups)
  if (Option.isNone(modelGroups))
    return yield* new InvalidDocumentError({
      target: { ...revision, writable: false },
      message: "The modelGroups field must contain complete model group definitions",
    })
  return {
    target: revision,
    text,
    data: data.value,
    definitions: decoded,
    modelGroups: modelGroups.value,
  } satisfies File
})

/** Patch leaf paths, so a redacted editor value never replaces an entire authored object. */
export function patchText(file: File, edit: Edit) {
  const formattingOptions = { tabSize: 2, insertSpaces: true }
  const set = (text: string, path: readonly string[], value: unknown) =>
    applyEdits(text, modify(text, [...path], value, { formattingOptions }))
  if (edit.type === "group-remove") return set(file.text, ["modelGroups", edit.groupID], undefined)
  if (edit.type === "group-set")
    return Object.entries(Schema.encodeSync(ModelGroup.Definition)(edit.definition)).reduce(
      (text, [field, value]) => set(text, ["modelGroups", edit.groupID, field], value),
      file.text,
    )
  const root = ["providers", edit.providerID]
  if (edit.type === "remove") return set(file.text, root, undefined)
  if (edit.type === "adoption") return set(file.text, [...root, "adoption"], edit.adoption)
  const leaves = (value: unknown, path: readonly string[]): readonly { path: readonly string[]; value: unknown }[] => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [{ path, value }]
    const entries = Object.entries(value)
    if (!entries.length) return [{ path, value }]
    return entries.flatMap(([key, value]) => leaves(value, [...path, key]))
  }
  const values = leaves(edit.patch.set ?? {}, root)
  const patched = values.reduce((text, item) => {
    if (
      typeof item.value === "object" &&
      item.value !== null &&
      !Array.isArray(item.value) &&
      !Object.keys(item.value).length
    ) {
      const present = item.path.reduce<unknown>(
        (value, key) =>
          typeof value === "object" && value !== null && !Array.isArray(value)
            ? (value as Readonly<Record<string, unknown>>)[key]
            : undefined,
        file.data,
      )
      if (present !== undefined) return text
    }
    return set(text, item.path, item.value)
  }, file.text)
  const unset = (edit.patch.unset ?? []).reduce((text, path) => set(text, [...root, ...path], undefined), patched)
  return edit.adoption ? set(unset, [...root, "adoption"], edit.adoption) : unset
}

export const preview = Effect.fnUntraced(function* (
  file: File,
  providerID: Provider.ID,
  patch: ProviderDefinition.Patch,
) {
  const data: unknown = parse(patchText(file, { type: "patch", providerID, patch }), [], { allowTrailingComma: true })
  const decoded = decodeObject(data)
  const providers = Option.isSome(decoded) ? decodeObject(decoded.value.providers) : Option.none()
  const definition = Option.isSome(providers) ? decodeDefinition(providers.value[providerID]) : Option.none()
  if (Option.isNone(definition))
    return yield* new InvalidDocumentError({
      target: file.target,
      message: "The requested provider definition is invalid",
    })
  return definition.value
})

export const write = Effect.fn("ConfigProviderFile.write")(function* (
  fs: FSUtil.Interface,
  mutation: FileMutation.Interface,
  file: File,
  edit: Edit,
) {
  const current = yield* read(fs, file.target, file.target.preferred)
  if (current.target.digest !== file.target.digest)
    return yield* new ConflictError({ target: current.target, message: "The configuration changed since it was read" })
  const patched = patchText(current, edit)
  if (patched === current.text) return current
  const text = patched.endsWith("\n") ? patched : `${patched}\n`
  yield* mutation
    .writeAtomic({ target: { absolute: file.target.path, resource: file.target.path }, content: text })
    .pipe(
      Effect.mapError(
        () => new WriteError({ target: current.target, message: `Cannot write configuration: ${file.target.path}` }),
      ),
    )
  return yield* read(fs, file.target, file.target.preferred)
})

const secretName =
  /(?:authorization|api[-_]?key|auth[-_]?token|access[-_]?token|refresh[-_]?token|secret|password|cookie)/i
const publicHeader = /^(?:accept|content-type|user-agent|anthropic-version|anthropic-beta|openai-beta)$/i
const placeholder = /^\{(?:env|file):[^}]+\}$/

export function redact(definition: ConfigProvider.Info) {
  const redactedPaths: string[][] = []
  const visit = (value: unknown, path: string[]): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => visit(item, [...path, String(index)]))
    if (typeof value !== "object" || value === null) return value
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) => {
        const field = [...path, key]
        const opaqueHeader = path.at(-1) === "headers" && !publicHeader.test(key)
        const secret = secretName.test(key) || opaqueHeader
        if (secret && !(typeof item === "string" && placeholder.test(item))) {
          redactedPaths.push(field)
          return []
        }
        return [[key, visit(item, field)]]
      }),
    )
  }
  const safe = visit(Schema.encodeSync(ConfigProvider.Info)(definition), [])
  return { definition: Schema.decodeUnknownSync(ConfigProvider.Info)(safe), redactedPaths }
}

export function digest(definition: ConfigProvider.Info) {
  const safe = redact(definition)
  const value = { ...Schema.encodeSync(ConfigProvider.Info)(safe.definition) }
  delete value.adoption
  const sorted = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sorted)
    if (typeof input !== "object" || input === null) return input
    return Object.fromEntries(
      Object.entries(input)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, sorted(value)]),
    )
  }
  return Hash.sha256(JSON.stringify({ definition: sorted(value), redactedPaths: safe.redactedPaths }))
}
