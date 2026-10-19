import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { createAigcfrogeClient } from "@aigcfroge/sdk/v2"
import { cliIt } from "../../lib/cli-process"

describe("non-interactive CLI terminal errors", () => {
  cliIt.live("ends a rejected command without emitting late Session errors", ({ aigcfroge }) =>
    Effect.gen(function* () {
      const result = yield* aigcfroge.run("unused arguments", {
        command: "missing-command-error-regression",
        format: "json",
      })

      aigcfroge.expectExit(result, 1)
      const events = aigcfroge.parseJsonEvents(result.stdout)
      expect(events.map((event) => event.type)).toEqual(["error"])
      expect(events[0]?.error).toEqual(expect.objectContaining({ name: "UnknownError" }))
    }),
  )

  cliIt.live(
    "reports an HTTP-only canonical command rejection without waiting for a Session event",
    ({ home, llm, aigcfroge }) =>
      Effect.gen(function* () {
        const server = yield* aigcfroge.serve()
        const sdk = createAigcfrogeClient({ baseUrl: server.url, directory: home, throwOnError: true })
        const response = yield* Effect.promise(() => sdk.session.create({ mode: "assistant" }))
        const session = response.data
        if (!session) throw new Error("The real server must create the Assistant Session")
        expect(session.mode).toBe("assistant")

        const result = yield* aigcfroge.run("unused arguments", {
          command: "missing-command-error-regression",
          format: "json",
          extraArgs: ["--attach", server.url, "--session", session.id],
        })

        aigcfroge.expectExit(result, 1)
        const events = aigcfroge.parseJsonEvents(result.stdout)
        expect(events).toEqual([
          {
            type: "error",
            timestamp: expect.any(Number),
            sessionID: session.id,
            error: expect.objectContaining({ _tag: "UnsupportedProductModeError", mode: "assistant" }),
          },
        ])
        expect(yield* llm.inputs).toHaveLength(0)
      }),
  )

  cliIt.live("reports a provider failure once after successful request admission", ({ llm, aigcfroge }) =>
    Effect.gen(function* () {
      yield* llm.error(400, { error: { message: "terminal provider error regression" } })
      const result = yield* aigcfroge.run("trigger provider rejection", {
        agent: "build",
        format: "json",
        extraArgs: ["--title", "terminal provider failure"],
      })

      aigcfroge.expectExit(result, 1)
      const events = aigcfroge.parseJsonEvents(result.stdout)
      expect(events.filter((event) => event.type === "error")).toHaveLength(1)
      expect(result.stdout).toContain("terminal provider error regression")
      expect(yield* llm.inputs).toHaveLength(1)
    }),
  )

  cliIt.live("preserves recoverable overflow and the later compaction failure", ({ llm, aigcfroge }) =>
    Effect.gen(function* () {
      yield* llm.error(400, { type: "error", error: { code: "context_length_exceeded" } })
      yield* llm.error(400, { error: { message: "terminal compaction failure after overflow" } })
      const result = yield* aigcfroge.run("trigger overflow then compaction rejection", {
        agent: "build",
        format: "json",
        extraArgs: ["--title", "overflow followed by compaction failure"],
        env: { AIGCFROGE_DISABLE_AUTOCOMPACT: "0" },
      })

      aigcfroge.expectExit(result, 1)
      const errors = aigcfroge.parseJsonEvents(result.stdout).filter((event) => event.type === "error")
      expect(errors).toHaveLength(2)
      expect(errors[0]?.error).toEqual(expect.objectContaining({ name: "ContextOverflowError" }))
      expect(JSON.stringify(errors[1]?.error)).toContain("terminal compaction failure after overflow")
      expect(errors[1]?.sessionID).toBe(errors[0]?.sessionID)
      expect(yield* llm.inputs).toHaveLength(2)
      expect(yield* llm.pending).toBe(0)
    }),
  )
})
