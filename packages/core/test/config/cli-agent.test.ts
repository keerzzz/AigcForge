/**
 * `cli_agents` config schema contract — M3 Phase A.
 *
 * Declarative external-CLI definitions: a named entry must decode with a valid
 * output strategy, reject unknown output types and missing commands, and keep
 * the config decoder's lenient excess-property behavior.
 *
 * @see packages/core/src/config/cli-agent.ts
 */

import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "@aigcfroge/core/config"

const decode = (value: unknown) =>
  Schema.decodeUnknownSync(Config.Info, { errors: "all", onExcessProperty: "ignore" })(value)

describe("ConfigCliAgent", () => {
  test("decodes a valid cli_agents definition with placeholders and timeout", () => {
    const decoded = decode({
      cli_agents: {
        "my-cli": {
          command: "my-cli",
          description: "My custom CLI",
          args: ["exec", "{prompt}", "--resume", "{resumeId}"],
          output: "plain",
          timeout: 60000,
        },
      },
    })
    expect(decoded.cli_agents?.["my-cli"].command).toBe("my-cli")
    expect(decoded.cli_agents?.["my-cli"].description).toBe("My custom CLI")
    expect(decoded.cli_agents?.["my-cli"].args).toEqual(["exec", "{prompt}", "--resume", "{resumeId}"])
    expect(decoded.cli_agents?.["my-cli"].output).toBe("plain")
    expect(decoded.cli_agents?.["my-cli"].timeout).toBe(60000)
  })

  test("accepts the three known output strategies", () => {
    for (const output of ["claude-jsonl", "codex-jsonl", "plain"] as const) {
      const decoded = decode({ cli_agents: { ok: { command: "x", output } } })
      expect(decoded.cli_agents?.["ok"].output).toBe(output)
    }
  })

  test("rejects an unknown output type", () => {
    expect(() => decode({ cli_agents: { bad: { command: "x", output: "bogus" } } })).toThrow()
  })

  test("rejects a cli_agents entry missing command", () => {
    expect(() => decode({ cli_agents: { bad: { description: "no command" } } })).toThrow()
  })

  test("ignores undeclared fields inside an entry", () => {
    const decoded = decode({ cli_agents: { ok: { command: "x", extra_field: "ignored" } } })
    expect(decoded.cli_agents?.["ok"].command).toBe("x")
  })

  test("accepts an explicit transport strategy", () => {
    for (const transport of ["jsonl", "sdk", "acp"] as const) {
      const decoded = decode({ cli_agents: { ok: { command: "x", transport } } })
      expect(decoded.cli_agents?.["ok"].transport).toBe(transport)
    }
  })

  test("rejects an unknown transport strategy", () => {
    expect(() => decode({ cli_agents: { bad: { command: "x", transport: "telepathy" } } })).toThrow()
  })
})
