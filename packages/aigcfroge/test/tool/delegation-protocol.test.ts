import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { buildProtocol } from "../../src/tool/delegation-protocol"
import { it } from "../lib/effect"

describe("tool.generate_delegation_protocol", () => {
  it.effect("combines explicit Claude constraints with indexed Agent Card metadata for simple work", () =>
    Effect.gen(function* () {
      const output = yield* buildProtocol(
        {
          engine: "build",
          task_description: "Make the smallest safe change",
          constraints: "Follow the Claude protocol text",
          include_protocol: false,
        },
        "/repo",
      )

      expect(output).toContain("Project: /repo")
      expect(output).toContain("Follow the Claude protocol text")
      expect(output).toContain("Agent: build (primary)")
      expect(output).toContain("Capabilities: code_modification")
      expect(output).not.toContain("--- build protocol ---")
    }),
  )

  it.effect("injects the target protocol card for complex work", () =>
    Effect.gen(function* () {
      const output = yield* buildProtocol(
        {
          engine: "build",
          task_description: "Implement and verify a complex change",
          include_protocol: true,
        },
        "/repo",
      )

      expect(output).toContain("--- build protocol ---")
      expect(output).toContain("Always check existing code conventions and AGENTS.md")
      expect(output).toContain("Verify changes: run the relevant test suite")
    }),
  )

  it.effect("does not invent metadata or protocol text for external engines", () =>
    Effect.gen(function* () {
      const output = yield* buildProtocol(
        {
          engine: "codex",
          task_description: "Review the current revision",
          include_protocol: true,
        },
        "/repo",
      )

      expect(output).toContain("Engine: codex")
      expect(output).not.toContain("Agent: codex")
      expect(output).not.toContain("--- codex protocol ---")
    }),
  )
})
