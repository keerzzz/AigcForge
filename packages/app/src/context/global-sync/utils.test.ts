import { describe, expect, test } from "bun:test"
import type { Agent, ProductMode } from "@aigcfroge/sdk/v2/client"
import { directoryKey, filterAgentList, normalizeAgentList } from "./utils"

const agent = (name = "build"): Agent => ({
  name,
  mode: "primary",
  permission: [],
  options: {},
  primaryModes: [],
})

describe("normalizeAgentList", () => {
  test("keeps array payloads", () => {
    expect(normalizeAgentList([agent("build"), agent("docs")])).toEqual([agent("build"), agent("docs")])
  })

  test("wraps a single agent payload", () => {
    expect(normalizeAgentList(agent("docs"))).toEqual([agent("docs")])
  })

  test("extracts agents from keyed objects", () => {
    expect(
      normalizeAgentList({
        build: agent("build"),
        docs: agent("docs"),
      }),
    ).toEqual([agent("build"), agent("docs")])
  })

  test("drops invalid payloads", () => {
    expect(normalizeAgentList({ name: "AbortError" })).toEqual([])
    expect(normalizeAgentList([{ name: "build" }, agent("docs")])).toEqual([agent("docs")])
  })

  test("preserves handoffs field", () => {
    const agentWithHandoffs = {
      ...agent("build"),
      handoffs: [{ label: "Ask docs", agent: "docs", prompt: "Review this" }],
    } as Agent
    const result = normalizeAgentList([agentWithHandoffs])
    expect(result).toHaveLength(1)
    expect(result[0]?.handoffs).toEqual([{ label: "Ask docs", agent: "docs", prompt: "Review this" }])
  })
})

describe("filterAgentList", () => {
  const mode: ProductMode = "coding"
  const primary = { ...agent("build"), primaryModes: [mode] } satisfies Agent
  const asset = { ...agent("custom"), primaryModes: [mode], originRelativePath: "custom.md" } satisfies Agent

  test("includes asset-backed agents only when the setting permits them", () => {
    expect(filterAgentList([primary, asset], mode, true).map((item) => item.name)).toEqual(["build", "custom"])
    expect(filterAgentList([primary, asset], mode, false).map((item) => item.name)).toEqual(["build"])
  })

  test("keeps an agent whose provenance is unknown, without guessing it is official", () => {
    expect(filterAgentList([primary], mode, false).map((item) => item.name)).toEqual(["build"])
  })
})

describe("directoryKey", () => {
  test("normalizes slashes", () => {
    expect(String(directoryKey("C:\\Repos\\sst\\aigcfroge"))).toBe("C:/Repos/sst/aigcfroge")
    expect(String(directoryKey("C:/Repos/sst/aigcfroge"))).toBe("C:/Repos/sst/aigcfroge")
  })

  test("preserves backslashes in posix paths", () => {
    expect(String(directoryKey("/tmp/foo\\bar"))).toBe("/tmp/foo\\bar")
  })

  test("trims trailing slashes without breaking roots", () => {
    expect(String(directoryKey("C:/Repos/sst/aigcfroge/"))).toBe("C:/Repos/sst/aigcfroge")
    expect(String(directoryKey("C:/"))).toBe("C:/")
    expect(String(directoryKey("/"))).toBe("/")
  })
})

describe("AI-TDD-S04-R01 primary visibility owner", () => {
  test("keeps primary mode authorization separate from subagent eligibility", () => {
    const candidates = [
      { ...agent("build"), primaryModes: ["coding"] },
      { ...agent("reviewer"), mode: "subagent", primaryModes: ["coding"] },
      { ...agent("work-orchestrator"), primaryModes: ["work"] },
      { ...agent("hidden"), hidden: true, primaryModes: ["coding"] },
      { ...agent("unclassified"), primaryModes: [] },
    ] satisfies Agent[]

    expect(filterAgentList(candidates, "coding", true).map((item) => item.name)).toEqual(["build"])
  })

  test("uses provenance rather than names or native transport as the visibility rule", () => {
    const candidates = [
      { ...agent("custom-looking-name"), primaryModes: ["coding"] },
      {
        ...agent("official-looking-name"),
        primaryModes: ["coding"],
        source: "native",
        originRelativePath: "agents/official-looking-name.md",
      },
      { ...agent("hidden-asset"), primaryModes: ["coding"], hidden: true, originRelativePath: "hidden.md" },
    ] satisfies Agent[]

    expect(filterAgentList(candidates, "coding", false).map((item) => item.name)).toEqual(["custom-looking-name"])
    expect(filterAgentList(candidates, "coding", true).map((item) => item.name)).toEqual([
      "custom-looking-name",
      "official-looking-name",
    ])
  })

  test("does not advertise a primary mode when the server omitted its primaryModes projection", () => {
    const candidates = normalizeAgentList([{ name: "reviewer", mode: "all", permission: [], options: {} }])
    expect(candidates).toHaveLength(1)
    expect(filterAgentList(candidates, "coding", true)).toEqual([])
  })
})

describe("AI-TDD-S04-R06 visibility preference is not primary-mode authorization", () => {
  test.each(["chat", "coding", "work", "assistant", "custom"] as const)(
    "showing asset-backed agents cannot grant missing server eligibility in %s mode",
    (mode) => {
      const candidates = [
        { ...agent("meta"), primaryModes: [mode] },
        { ...agent("forbidden-asset"), primaryModes: [], originRelativePath: "agents/forbidden.md" },
      ] satisfies Agent[]

      expect(filterAgentList(candidates, mode, false).map((item) => item.name)).toEqual(["meta"])
      expect(filterAgentList(candidates, mode, true).map((item) => item.name)).toEqual(["meta"])
    },
  )
})
