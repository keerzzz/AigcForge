import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { CompositionConsumerView } from "@aigcfroge/core/composition/consumer-view"

// D5-A consumer scoping. The load-bearing property is negative: inside a scoped graph, a session
// that cannot be mapped to a consumer must see NOTHING, never the flat `data.*` arrays — those span
// every consumer in the composition, so leaking them hands a child agent the whole graph.

const FLAT_MARKER = "flat-visible-to-every-consumer"
const rev = "a".repeat(64)

const tools = { fingerprints: [], catalogDigest: "b".repeat(64), catalog: [] }
const mcp = { bindings: [], tools: [] }

const agent = (name: string, consumerKey?: string) => ({
  id: name,
  name,
  description: `${name} agent`,
  relativePath: `${name}.md`,
  revision: rev,
  ...(consumerKey === undefined ? {} : { consumerKey }),
})

const instruction = (source: string) => ({ source, content: `content of ${source}` })

const decode = (json: unknown) => Schema.decodeUnknownSync(Composition.Snapshot)(json)

const scopedSnapshot = (bindings: Record<string, unknown>, agents: ReadonlyArray<unknown>) =>
  decode({
    version: 2,
    digest: "c".repeat(64),
    createdAt: Date.now(),
    data: {
      agents,
      workflow: null,
      bindings,
      maxConcurrency: 1,
      commands: [],
      instructions: [instruction(FLAT_MARKER)],
      prompts: [],
      skills: [],
      tools,
      mcp,
    },
  })

const binding = (instructions: ReadonlyArray<unknown> = []) => ({
  instructions,
  prompts: [],
  skills: [],
  commands: [],
})

const preBindingSnapshot = () =>
  decode({
    version: 2,
    digest: "d".repeat(64),
    createdAt: Date.now(),
    data: {
      agents: [agent("coder")],
      workflow: null,
      maxConcurrency: 1,
      commands: [],
      instructions: [instruction(FLAT_MARKER)],
      prompts: [],
      skills: [],
      tools,
      mcp,
    },
  })

describe("CompositionConsumerView.resolveScope", () => {
  test("a pre-binding V2 snapshot is unscoped, so the flat arrays remain the contract", () => {
    const snapshot = preBindingSnapshot()
    const scope = CompositionConsumerView.resolveScope(snapshot, { parentID: undefined, agent: "meta" })
    expect(scope._tag).toBe("unscoped")
    expect(CompositionConsumerView.isBindingSatisfied(snapshot, scope)).toBe(true)
    expect(CompositionConsumerView.getInstructions(snapshot, scope).map((i) => i.source)).toEqual([FLAT_MARKER])
  })

  test("a root session maps to the orchestrator and sees only its own binding", () => {
    const snapshot = scopedSnapshot(
      { orchestrator: binding([instruction("agent:meta")]), "agents/coder": binding([instruction("agent:coder")]) },
      [agent("coder")],
    )
    const scope = CompositionConsumerView.resolveScope(snapshot, { parentID: undefined, agent: "meta" })
    expect(scope).toEqual({ _tag: "scoped", key: "orchestrator" })
    expect(CompositionConsumerView.isBindingSatisfied(snapshot, scope)).toBe(true)
    expect(CompositionConsumerView.getInstructions(snapshot, scope).map((i) => i.source)).toEqual(["agent:meta"])
  })

  test("a root session whose orchestrator binds nothing still runs, with an empty asset set", () => {
    // Binding everything to child agents and nothing to the orchestrator is a legitimate
    // composition. "Present but empty" must not be treated as "absent", or the root cannot run.
    const snapshot = scopedSnapshot(
      { orchestrator: binding(), "agents/coder": binding([instruction("agent:coder")]) },
      [agent("coder")],
    )
    const scope = CompositionConsumerView.resolveScope(snapshot, { parentID: undefined, agent: "meta" })
    expect(CompositionConsumerView.isBindingSatisfied(snapshot, scope)).toBe(true)
    expect(CompositionConsumerView.getInstructions(snapshot, scope)).toEqual([])
    expect(CompositionConsumerView.getSkills(snapshot, scope)).toEqual([])
  })

  test("a child session sees its own binding and not a sibling's", () => {
    const snapshot = scopedSnapshot(
      {
        orchestrator: binding([instruction("agent:meta")]),
        "agents/coder": binding([instruction("agent:coder")]),
        "agents/writer": binding([instruction("agent:writer")]),
      },
      [agent("coder"), agent("writer")],
    )
    const scope = CompositionConsumerView.resolveScope(snapshot, { parentID: "ses_root", agent: "coder" })
    expect(scope).toEqual({ _tag: "scoped", key: "agents/coder" })
    const sources = CompositionConsumerView.getInstructions(snapshot, scope).map((i) => i.source)
    expect(sources).toEqual(["agent:coder"])
    expect(sources).not.toContain("agent:writer")
    expect(sources).not.toContain(FLAT_MARKER)
  })

  test("an agent outside the frozen pool is unresolved and leaks nothing", () => {
    const snapshot = scopedSnapshot({ orchestrator: binding([instruction("agent:meta")]) }, [agent("coder")])
    const scope = CompositionConsumerView.resolveScope(snapshot, { parentID: "ses_root", agent: "impostor" })
    expect(scope).toEqual({ _tag: "unresolved", agent: "impostor" })
    // Fail closed, and above all: do not hand back the cross-consumer flat arrays.
    expect(CompositionConsumerView.isBindingSatisfied(snapshot, scope)).toBe(false)
    expect(CompositionConsumerView.getInstructions(snapshot, scope)).toEqual([])
    expect(CompositionConsumerView.getPrompts(snapshot, scope)).toEqual([])
    expect(CompositionConsumerView.getSkills(snapshot, scope)).toEqual([])
    expect(CompositionConsumerView.getCommands(snapshot, scope)).toEqual([])
  })

  test("a scoped key with no entry is not satisfied and yields nothing", () => {
    const snapshot = scopedSnapshot({ orchestrator: binding() }, [agent("coder")])
    const scope = CompositionConsumerView.resolveScope(snapshot, { parentID: "ses_root", agent: "coder" })
    expect(scope).toEqual({ _tag: "scoped", key: "agents/coder" })
    expect(CompositionConsumerView.isBindingSatisfied(snapshot, scope)).toBe(false)
    expect(CompositionConsumerView.getInstructions(snapshot, scope)).toEqual([])
  })

  test("resolveScopeForAgent maps meta to the orchestrator and an impostor to unresolved", () => {
    const snapshot = scopedSnapshot({ orchestrator: binding([instruction("agent:meta")]) }, [agent("coder")])
    expect(CompositionConsumerView.resolveScopeForAgent(snapshot, "meta")).toEqual({
      _tag: "scoped",
      key: "orchestrator",
    })
    expect(CompositionConsumerView.resolveScopeForAgent(snapshot, "impostor")).toEqual({
      _tag: "unresolved",
      agent: "impostor",
    })
    expect(CompositionConsumerView.resolveScopeForAgent(preBindingSnapshot(), "anything")).toEqual({
      _tag: "unscoped",
    })
  })

  test("an explicit consumerKey on AgentInfo decouples the machine key from the display name", () => {
    const snapshot = scopedSnapshot({ orchestrator: binding(), "agents/a1b2": binding([instruction("agent:测试")]) }, [
      agent("测试", "agents/a1b2"),
    ])
    const scope = CompositionConsumerView.resolveScope(snapshot, { parentID: "ses_root", agent: "测试" })
    expect(scope).toEqual({ _tag: "scoped", key: "agents/a1b2" })
    expect(CompositionConsumerView.isBindingSatisfied(snapshot, scope)).toBe(true)
    expect(CompositionConsumerView.getInstructions(snapshot, scope).map((i) => i.source)).toEqual(["agent:测试"])
  })
})
