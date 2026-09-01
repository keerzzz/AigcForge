import { describe, expect, test } from "bun:test"
import { CommandParse } from "../src/command-parse"

describe("CommandParse.splitCommandLine", () => {
  test("splits a slash line into command name and verbatim arguments", () => {
    const parsed = CommandParse.splitCommandLine("/review src/main.ts")
    expect(parsed).toEqual({ command: "review", arguments: "src/main.ts" })
  })

  test("preserves the raw argument remainder verbatim (no space normalization)", () => {
    const parsed = CommandParse.splitCommandLine(`/review   "a b"  'c'`)
    expect(parsed).toEqual({ command: "review", arguments: `  "a b"  'c'` })
  })

  test("returns undefined for non-slash text", () => {
    expect(CommandParse.splitCommandLine("plain text")).toBeUndefined()
    expect(CommandParse.splitCommandLine("")).toBeUndefined()
  })

  test("returns undefined for a bare slash", () => {
    expect(CommandParse.splitCommandLine("/")).toBeUndefined()
  })

  test("returns empty arguments for a slash command with no remainder", () => {
    expect(CommandParse.splitCommandLine("/review")).toEqual({ command: "review", arguments: "" })
  })
})

describe("CommandParse.tokenizeArguments", () => {
  test("splits on whitespace", () => {
    expect(CommandParse.tokenizeArguments("a b\tc\n d")).toEqual(["a", "b", "c", "d"])
  })

  test("groups double-quoted spans verbatim", () => {
    expect(CommandParse.tokenizeArguments(`a "b c" d`)).toEqual(["a", "b c", "d"])
  })

  test("groups single-quoted spans verbatim", () => {
    expect(CommandParse.tokenizeArguments(`a 'b c' d`)).toEqual(["a", "b c", "d"])
  })

  test("keeps Unicode code points intact", () => {
    expect(CommandParse.tokenizeArguments(`hello 世界 "東京 café"`)).toEqual(["hello", "世界", "東京 café"])
  })

  test("produces an empty token for an empty quoted span", () => {
    expect(CommandParse.tokenizeArguments(`a "" b`)).toEqual(["a", "", "b"])
    expect(CommandParse.tokenizeArguments(`a '' b`)).toEqual(["a", "", "b"])
  })

  test("returns no tokens for an empty argument string", () => {
    expect(CommandParse.tokenizeArguments("")).toEqual([])
    expect(CommandParse.tokenizeArguments("   ")).toEqual([])
  })
})

describe("CommandParse.expandInvocation", () => {
  const text = (input: Parameters<typeof CommandParse.expandInvocation>[0]) => {
    const result = CommandParse.expandInvocation(input)
    expect(result._tag).toBe("ok")
    return result._tag === "ok" ? result.text : ""
  }

  test("expands $1..$N positionally", () => {
    expect(text({ invocation: "/cmd $1 $2", arguments: "a b" })).toBe("/cmd a b")
  })

  test("the last positional placeholder consumes the remaining arguments", () => {
    expect(text({ invocation: "/cmd $1 $2", arguments: "a b c d" })).toBe("/cmd a b c d")
    expect(text({ invocation: "/cmd $1", arguments: "a b c" })).toBe("/cmd a b c")
  })

  test("$ARGUMENTS keeps the raw arguments verbatim", () => {
    expect(text({ invocation: "/cmd $ARGUMENTS", arguments: `"a b" 'c'` })).toBe(`/cmd "a b" 'c'`)
  })

  test("a template with no placeholder appends the arguments", () => {
    expect(text({ invocation: "/cmd", arguments: "a b" })).toBe("/cmd a b")
    expect(text({ invocation: "/cmd", arguments: "" })).toBe("/cmd")
  })

  test("expands quoted tokens positionally from the tokenizer", () => {
    expect(text({ invocation: "/cmd $1", arguments: `"a b" c` })).toBe("/cmd a b c")
  })

  test("missing arguments are a typed reject", () => {
    const result = CommandParse.expandInvocation({ invocation: "/cmd $1", arguments: "" })
    expect(result._tag).toBe("missing-args")
  })

  test("missing arguments for a non-last placeholder are a typed reject", () => {
    const result = CommandParse.expandInvocation({ invocation: "/cmd $1 $2", arguments: "only-one" })
    expect(result._tag).toBe("missing-args")
  })

  test("extra arguments beyond the args schema are a typed reject", () => {
    const result = CommandParse.expandInvocation({
      invocation: "/review $1",
      argsSchema: "$1: path",
      arguments: "a b",
    })
    expect(result._tag).toBe("extra-args")
  })

  test("a template consuming more positions than the args schema declares is a typed reject", () => {
    const result = CommandParse.expandInvocation({
      invocation: "/cmd $1 $2",
      argsSchema: "$1: path",
      arguments: "a b",
    })
    expect(result._tag).toBe("args-schema-mismatch")
  })

  test("an args-schema-bound command accepts exactly its declared arity", () => {
    expect(text({ invocation: "/review $1", argsSchema: "$1: path", arguments: "src/main.ts" })).toBe(
      "/review src/main.ts",
    )
  })
})
