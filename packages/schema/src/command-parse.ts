export * as CommandParse from "./command-parse"

import { Schema } from "effect"

/**
 * Single owner for Custom Snapshot command parameter parsing.
 *
 * Both the core durable admission/promotion path and the app composer must
 * converge here; there is deliberately no second `text.split(" ")` anywhere.
 *
 * Semantics (S5):
 * - `splitCommandLine` splits a slash line into the command name and the raw
 *   argument remainder (kept verbatim for `$ARGUMENTS`).
 * - `tokenizeArguments` splits raw arguments into positional tokens honoring
 *   single quotes, double quotes, Unicode, and empty quoted spans.
 * - `expandInvocation` statically expands a frozen command template:
 *   - `$1..$N` bind positionally; the LAST positional placeholder consumes the
 *     remaining arguments.
 *   - `$ARGUMENTS` keeps the raw arguments verbatim.
 *   - a template with no placeholder appends the arguments.
 *   - missing args / extra args / args-schema mismatch are typed rejects, not
 *     defects.
 * The `args` field of a frozen command is the arity authority: when it declares
 * `$1..$M`, more than M positional arguments are rejected (extra args) and a
 * template consuming a position the schema does not declare is rejected
 * (schema mismatch). Without an args schema the last placeholder is unbounded.
 */

const POSITIONAL = /\$(\d+)/g
const ARGUMENTS = "$ARGUMENTS"

export type SlashCommandLine = {
  readonly command: string
  readonly arguments: string
}

/** The command name plus the raw argument remainder, or undefined when the text is not a slash line. */
export const splitCommandLine = (text: string): SlashCommandLine | undefined => {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith("/")) return undefined
  const firstSpace = trimmed.search(/\s/)
  if (firstSpace === -1) {
    const command = trimmed.slice(1)
    if (command === "") return undefined
    return { command, arguments: "" }
  }
  const command = trimmed.slice(1, firstSpace)
  if (command === "") return undefined
  return { command, arguments: trimmed.slice(firstSpace + 1) }
}

/** Splits raw arguments into positional tokens honoring quotes and empty spans. */
export const tokenizeArguments = (raw: string): string[] => {
  const tokens: string[] = []
  let index = 0
  while (index < raw.length) {
    while (index < raw.length && isWhitespace(raw[index])) index++
    if (index >= raw.length) break
    const char = raw[index]
    if (char === '"' || char === "'") {
      const quote = char
      index++
      let value = ""
      while (index < raw.length && raw[index] !== quote) {
        value += raw[index]
        index++
      }
      if (index < raw.length) index++
      tokens.push(value)
    } else {
      let value = ""
      while (index < raw.length && !isWhitespace(raw[index])) {
        value += raw[index]
        index++
      }
      tokens.push(value)
    }
  }
  return tokens
}

const isWhitespace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char)

/** The highest positional index `$N` present in a template, or 0 when none. */
const maxPositional = (template: string): number => {
  let max = 0
  for (const match of template.matchAll(POSITIONAL)) {
    const index = Number(match[1])
    if (index > max) max = index
  }
  return max
}

export class MissingArgsError extends Schema.TaggedErrorClass<MissingArgsError>()("CommandParse.MissingArgsError", {
  required: Schema.Int,
  provided: Schema.Int,
  message: Schema.String,
}) {}

export class ExtraArgsError extends Schema.TaggedErrorClass<ExtraArgsError>()("CommandParse.ExtraArgsError", {
  maximum: Schema.Int,
  provided: Schema.Int,
  message: Schema.String,
}) {}

export class ArgsSchemaMismatchError extends Schema.TaggedErrorClass<ArgsSchemaMismatchError>()(
  "CommandParse.ArgsSchemaMismatchError",
  {
    templateMax: Schema.Int,
    schemaMax: Schema.Int,
    message: Schema.String,
  },
) {}

export type ExpandError = MissingArgsError | ExtraArgsError | ArgsSchemaMismatchError

export type Expanded = {
  readonly text: string
  readonly args: ReadonlyArray<string>
}

export type ExpandResult =
  | { readonly _tag: "ok"; readonly text: string; readonly args: ReadonlyArray<string> }
  | { readonly _tag: "missing-args"; readonly error: MissingArgsError }
  | { readonly _tag: "extra-args"; readonly error: ExtraArgsError }
  | { readonly _tag: "args-schema-mismatch"; readonly error: ArgsSchemaMismatchError }

/**
 * Statically expands a frozen command template with the user's raw arguments.
 * Typed rejects (never defects) for missing args, extra args, or an args-schema
 * mismatch; the caller must fail closed on anything but `ok`.
 */
export const expandInvocation = (input: {
  readonly invocation: string
  readonly argsSchema?: string
  readonly arguments: string
}): ExpandResult => {
  const args = tokenizeArguments(input.arguments)
  const templateMax = maxPositional(input.invocation)
  const schemaMax = input.argsSchema === undefined ? 0 : maxPositional(input.argsSchema)
  const hasArguments = input.invocation.includes(ARGUMENTS)

  if (schemaMax >= 1 && templateMax > schemaMax) {
    return {
      _tag: "args-schema-mismatch",
      error: new ArgsSchemaMismatchError({
        templateMax,
        schemaMax,
        message: `Command template consumes $${templateMax} but its args schema declares at most $${schemaMax}`,
      }),
    }
  }
  if (schemaMax >= 1 && templateMax >= 1 && args.length > schemaMax) {
    return {
      _tag: "extra-args",
      error: new ExtraArgsError({
        maximum: schemaMax,
        provided: args.length,
        message: `Command accepts at most ${schemaMax} argument(s), received ${args.length}`,
      }),
    }
  }
  if (templateMax >= 1 && args.length < templateMax) {
    return {
      _tag: "missing-args",
      error: new MissingArgsError({
        required: templateMax,
        provided: args.length,
        message: `Command requires ${templateMax} argument(s), received ${args.length}`,
      }),
    }
  }

  if (templateMax === 0 && !hasArguments) {
    const tail = args.length === 0 ? "" : ` ${input.arguments}`
    return { _tag: "ok", text: `${input.invocation}${tail}`, args }
  }

  const text = input.invocation.replace(/\$ARGUMENTS|\$(\d+)/g, (full, index: string | undefined) => {
    if (full === ARGUMENTS) return input.arguments
    const position = Number(index)
    if (position < 1 || position > templateMax) return full
    return position === templateMax ? args.slice(templateMax - 1).join(" ") : args[position - 1]
  })
  return { _tag: "ok", text, args }
}
