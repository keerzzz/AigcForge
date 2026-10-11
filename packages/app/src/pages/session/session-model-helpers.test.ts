import { describe, expect, test } from "bun:test"
import type { UserMessage } from "@aigcfroge/sdk/v2"
import { resetSessionModel, syncSessionModel, syncSessionSelection } from "./session-model-helpers"

const message = (input?: { agent?: string; model?: UserMessage["model"] }) =>
  ({
    id: "msg",
    sessionID: "session",
    role: "user",
    time: { created: 1 },
    agent: input?.agent ?? "build",
    model: input?.model ?? { providerID: "anthropic", modelID: "claude-sonnet-4" },
  }) as UserMessage

describe("syncSessionModel", () => {
  test("restores the last message through session state", () => {
    const calls: unknown[] = []

    syncSessionModel(
      {
        session: {
          restore(value) {
            calls.push(value)
          },
          reset() {},
        },
      },
      message({ model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "high" } }),
    )

    expect(calls).toEqual([
      message({ model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "high" } }),
    ])
  })
})

describe("resetSessionModel", () => {
  test("clears draft session state", () => {
    const calls: string[] = []

    resetSessionModel({
      session: {
        reset() {
          calls.push("reset")
        },
        restore() {},
      },
    })

    expect(calls).toEqual(["reset"])
  })
})

describe("syncSessionSelection", () => {
  test("restores the server-owned agent and model before the first prompt", () => {
    const calls: unknown[] = []

    syncSessionSelection(
      {
        session: {
          restore(value) {
            calls.push(value)
          },
          reset() {},
        },
      },
      {
        id: "session",
        agent: "work-orchestrator",
        model: { providerID: "e4-real", id: "e4-deterministic", variant: "max" },
      },
    )

    expect(calls).toEqual([
      {
        sessionID: "session",
        agent: "work-orchestrator",
        model: { providerID: "e4-real", modelID: "e4-deterministic", variant: "max" },
      },
    ])
  })

  test("does not overwrite local selection when the server has no complete selection", () => {
    const calls: unknown[] = []
    syncSessionSelection(
      {
        session: {
          restore(value) {
            calls.push(value)
          },
          reset() {},
        },
      },
      { id: "session", agent: "meta" },
    )
    expect(calls).toEqual([])
  })
})
