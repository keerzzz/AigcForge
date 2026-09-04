import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { AgentAsset } from "@aigcfroge/schema/agent-asset"
import { SessionEvent } from "@aigcfroge/core/session/event"

// S0 RED: D5, D4, Synthetic — assert FIXED behavior via Schema, RED before S1/S3

describe("S0 RED: D5 Snapshot distinguishability", () => {
  test("pre-binding V2 (missing bindings) must be distinguishable from new empty bindings", () => {
    const preBinding = {
      version: 2 as const,
      digest: "c".repeat(64),
      createdAt: Date.now(),
      data: {
        agents: [],
        workflow: null,
        maxConcurrency: 1,
        commands: [],
        instructions: [],
        prompts: [],
        skills: [],
        tools: { fingerprints: [], catalogDigest: "d".repeat(64), catalog: [] },
        mcp: { bindings: [], tools: [] },
      },
    }
    const newEmpty = {
      version: 2 as const,
      digest: "e".repeat(64),
      createdAt: Date.now(),
      data: {
        agents: [],
        workflow: null,
        bindings: {} as Record<string, never>,
        maxConcurrency: 1,
        commands: [],
        instructions: [],
        prompts: [],
        skills: [],
        tools: { fingerprints: [], catalogDigest: "f".repeat(64), catalog: [] },
        mcp: { bindings: [], tools: [] },
      },
    }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const decodedPre = Schema.decodeUnknownSync(Composition.Snapshot)(preBinding as unknown) as unknown as {
      data: { bindings?: unknown }
    }
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const decodedNew = Schema.decodeUnknownSync(Composition.Snapshot)(newEmpty as unknown) as unknown as {
      data: { bindings?: unknown }
    }
    expect(decodedPre.data.bindings).toBeUndefined()
    expect(decodedNew.data.bindings).toBeDefined()
    expect(JSON.stringify(decodedPre.data.bindings)).not.toBe(JSON.stringify(decodedNew.data.bindings))
  })
})

describe("S0 RED: D4-A consumerKey direction", () => {
  test("AgentInfo should have consumerKey, ConsumerKey stays restricted, display allows Unicode", () => {
    expect("consumerKey" in Composition.AgentInfo.fields).toBe(true)
    expect(() => Schema.decodeUnknownSync(Composition.ConsumerKey)("agents/测试-1")).toThrow()
    expect(() => Schema.decodeUnknownSync(AgentAsset.Name)("测试_代理")).not.toThrow()
  })
})

describe("S0 RED: SyntheticAdmitted in Durable union", () => {
  test("SyntheticAdmitted must be a member of the Durable and All unions", () => {
    // Assert union MEMBERSHIP, not a payload round-trip. A decodeUnknownSync probe cannot work
    // here: every union member also requires the event envelope's `id` field, so a hand-built
    // payload keeps throwing (`Missing key at ["id"]`) even after the tag is added — the test
    // would stay red after the fix. `cases` is the tag->member map produced by
    // Schema.toTaggedUnion("type"), so this goes green exactly when S3 adds the definition to
    // DurableDefinitions (session/event.ts, the array feeding Durable/All).
    expect(Object.keys(SessionEvent.Durable.cases)).toContain(SessionEvent.SyntheticAdmitted.type)
    expect(Object.keys(SessionEvent.All.cases)).toContain(SessionEvent.SyntheticAdmitted.type)
  })
})
