import { describe, expect, test } from "bun:test"
import type { Agent, ProductMode } from "@aigcfroge/sdk/v2/client"
import { directoryKey, filterAgentList, normalizeAgentList } from "./utils"

const agent = (name = "build") =>
  ({
    name,
    mode: "primary",
    permission: {},
    options: {},
  }) as Agent

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
