import { describe, expect, test } from "bun:test"
import { resolveSessionComposerSelection } from "./selection"

describe("resolveSessionComposerSelection", () => {
  test("prefers durable Session state over historical message metadata", () => {
    expect(
      resolveSessionComposerSelection(
        { agent: "build", model: { id: "claude", providerID: "anthropic" } },
        { agent: "review", model: { modelID: "gpt", providerID: "openai" } },
      ),
    ).toEqual({
      agent: "build",
      model: { modelID: "claude", providerID: "anthropic", variant: undefined },
    })
  })

  test("falls back to historical metadata while durable state is unavailable", () => {
    expect(
      resolveSessionComposerSelection(undefined, {
        agent: "review",
        model: { modelID: "gpt", providerID: "openai", variant: "high" },
      }),
    ).toEqual({
      agent: "review",
      model: { modelID: "gpt", providerID: "openai", variant: "high" },
    })
  })
})

test("Meta selection reads both canonical domains without historical executor fallback", () => {
  expect(
    resolveSessionComposerSelection(
      {
        agent: "meta",
        model: { id: "meta", providerID: "meta-provider", variant: "default" },
        controller: { kind: "root", metaAgentID: "meta-1", rootSessionID: "session-1" },
        executorPreference: { agent: "build", model: { id: "worker", providerID: "worker-provider" } },
      },
      { agent: "explore", model: { modelID: "other", providerID: "other-provider", variant: "high" } },
    ),
  ).toEqual({
    agent: "meta",
    model: { modelID: "meta", providerID: "meta-provider", variant: "default" },
    executorPreference: { agent: "build", model: { id: "worker", providerID: "worker-provider" } },
  })
})

test.each(["build", "plan"])("%s ignores a historical Meta delegation preference", (agent) => {
  expect(
    resolveSessionComposerSelection(
      {
        agent,
        model: { id: "ordinary", providerID: "provider" },
        controller: { kind: "root", metaAgentID: "meta-1", rootSessionID: "session-1" },
        executorPreference: { agent: "explore", model: { id: "worker", providerID: "worker-provider" } },
      },
      { agent: "meta" },
    ),
  ).toEqual({
    agent,
    model: { modelID: "ordinary", providerID: "provider", variant: undefined },
    executorPreference: undefined,
  })
})
