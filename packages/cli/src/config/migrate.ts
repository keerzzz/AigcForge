export * as ConfigMigration from "./migrate"

import { TuiKeybind } from "@omnixa/tui/config/v1/keybind"
import { Definitions } from "@omnixa/tui/config/keybind"
import { Effect, FileSystem, Option, Schema } from "effect"
import { randomUUID } from "crypto"
import { applyEdits, createScanner, modify, parse, parseTree, type Node, type ParseError } from "jsonc-parser"
import path from "path"
import { Info } from "./schema"

const decodeInfo = Schema.decodeUnknownOption(Info)
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))
const LegacyKeybinds = new Map<string, string>(Object.entries(TuiKeybind.CommandMap))
const LegacyKeybindTargets = new Set(LegacyKeybinds.values())

export const run = Effect.fn("cli.config.migrate")(function* (input: {
  readonly file: string
  readonly config: string
  readonly state: string
}) {
  const fs = yield* FileSystem.FileSystem
  const persist = Effect.fnUntraced(function* (text: string, info: Info) {
    const temp = `${input.file}.${process.pid}.${randomUUID()}.tmp`
    const cause = yield* Effect.gen(function* () {
      yield* fs.makeDirectory(path.dirname(input.file), { recursive: true })
      yield* fs.writeFileString(temp, text, { mode: 0o600 })
      yield* fs.rename(temp, input.file)
    }).pipe(
      Effect.as(undefined),
      Effect.catchCause((cause) => Effect.succeed(cause)),
      Effect.ensuring(fs.remove(temp).pipe(Effect.ignore)),
    )
    return cause === undefined ? { info } : { info, cause }
  })

  if (!(yield* fs.exists(input.file).pipe(Effect.orElseSucceed(() => false)))) return undefined
  const text = yield* fs.readFileString(input.file)
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) return undefined
  const config = Option.getOrUndefined(decodeRecord(value))
  if (config === undefined) return undefined
  const terminal = Option.getOrUndefined(decodeRecord(config.terminal))
  const legacyCopy = terminal?.copy_on_select
  const copy =
    typeof legacyCopy === "boolean" && terminal?.copy === undefined ? (legacyCopy ? "select" : "manual") : undefined
  const renamed =
    typeof legacyCopy !== "boolean"
      ? text
      : [
          ...(copy === undefined ? [] : [{ path: ["terminal", "copy"], value: copy }]),
          { path: ["terminal", "copy_on_select"], value: undefined },
        ].reduce(
          (text, edit) =>
            applyEdits(
              text,
              modify(text, edit.path, edit.value, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
            ),
          text,
        )
  const keybinds = Option.getOrUndefined(decodeRecord(config.keybinds))
  const updated =
    keybinds === undefined
      ? renamed
      : Object.keys(keybinds).reduce(
          (text, name) => {
            const target =
              LegacyKeybinds.get(name) ?? (name in Definitions || LegacyKeybindTargets.has(name) ? name : undefined)
            if (target === undefined) return text
            const properties = findKeybindProperties(text, name)
            if (!properties.length) return text
            const remove = !(target in Definitions) || (target !== name && target in keybinds)
            // The parser gives the final duplicate precedence, so remove earlier properties before renaming it.
            const cleaned = properties.slice(0, remove ? properties.length : -1).reduce((text) => {
              const property = findKeybindProperties(text, name)[0]
              return property === undefined ? text : removeProperty(text, property)
            }, text)
            if (remove) return cleaned
            if (target === name) return cleaned
            const key = findKeybindProperties(cleaned, name)[0]?.children?.[0]
            if (key === undefined) return text
            return cleaned.slice(0, key.offset) + JSON.stringify(target) + cleaned.slice(key.offset + key.length)
          },
          findKeybindObjects(renamed)
            .slice(0, -1)
            .reduce((text) => {
              const property = findKeybindObjects(text)[0]
              return property === undefined ? text : removeProperty(text, property)
            }, renamed),
        )
  if (updated === text) return undefined
  const updatedErrors: ParseError[] = []
  const info = Option.getOrUndefined(decodeInfo(parse(updated, updatedErrors, { allowTrailingComma: true })))
  if (updatedErrors.length || info === undefined) return undefined
  return yield* persist(updated, info)
})

function findKeybindProperties(text: string, name: string) {
  const keybinds = findKeybindObjects(text).at(-1)?.children?.[1]
  return keybinds?.children?.filter((property) => property.children?.[0]?.value === name) ?? []
}

function findKeybindObjects(text: string) {
  const tree = parseTree(text)
  if (tree === undefined) return []
  return tree.children?.filter((property) => property.children?.[0]?.value === "keybinds") ?? []
}

function removeProperty(text: string, property: Node) {
  const properties = property.parent?.children ?? []
  const index = properties.indexOf(property)
  const end = property.offset + property.length
  const next = properties[index + 1]
  if (next) {
    const comma = findComma(text, end, next.offset)
    if (comma !== undefined) return text.slice(0, property.offset) + text.slice(end, comma) + text.slice(comma + 1)
  }
  const previous = properties[index - 1]
  if (previous) {
    const comma = findComma(text, previous.offset + previous.length, property.offset)
    if (comma !== undefined) return text.slice(0, comma) + text.slice(comma + 1, property.offset) + text.slice(end)
  }
  const comma = findComma(text, end, (property.parent?.offset ?? 0) + (property.parent?.length ?? 0))
  if (comma !== undefined) return text.slice(0, property.offset) + text.slice(end, comma) + text.slice(comma + 1)
  return text.slice(0, property.offset) + text.slice(end)
}

function findComma(text: string, start: number, end: number) {
  const scanner = createScanner(text, false)
  scanner.setPosition(start)
  while (true) {
    scanner.scan()
    const offset = scanner.getTokenOffset()
    if (scanner.getTokenLength() === 0 || offset >= end) return
    if (text[offset] === ",") return offset
  }
}
