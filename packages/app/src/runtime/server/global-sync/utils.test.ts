import { describe, expect, test } from "bun:test"
import type { AgentListOutput, ModelListOutput, Project, ProviderListOutput } from "@aigcfroge/client/promise"
import { directoryKey, normalizeAgentList, normalizeProjectInfo, normalizeProviderList } from "./utils"

describe("normalizeAgentList", () => {
  test("adapts current agents to the app agent shape", () => {
    const result = normalizeAgentList([
      {
        id: "build",
        name: "Build",
        mode: "primary",
        hidden: false,
        color: "primary",
        model: { id: "gpt-5", providerID: "openai", variant: "high" },
        request: { settings: { temperature: 0.2, topP: 0.9 }, headers: {}, body: {} },
        system: "Build software",
        permissions: [{ action: "read", resource: "*", effect: "allow" }],
        handoffs: [],
        originKind: "user",
        ordinaryModes: ["coding"],
        originRelativePath: "agents/build.md",
        originRevision: "revision-1",
      },
    ] satisfies AgentListOutput["data"])

    expect(result).toEqual([
      {
        name: "build",
        description: undefined,
        mode: "primary",
        hidden: false,
        temperature: 0.2,
        topP: 0.9,
        color: "primary",
        permission: [{ permission: "read", pattern: "*", action: "allow" }],
        model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
        variant: "high",
        prompt: "Build software",
        options: { temperature: 0.2, topP: 0.9 },
        steps: undefined,
        originKind: "user",
        ordinaryModes: ["coding"],
        originRelativePath: "agents/build.md",
        originRevision: "revision-1",
      },
    ])
  })
})

describe("normalizeProviderList", () => {
  test("groups current models into the app provider catalog", () => {
    const result = normalizeProviderList(
      [
        { id: "openai", name: "OpenAI", package: "@ai-sdk/openai", activation: "enabled" },
      ] satisfies ProviderListOutput["data"],
      [
        {
          id: "gpt-5",
          modelID: "gpt-5",
          providerID: "openai",
          name: "GPT-5",
          capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
          variants: [{ id: "high" }],
          time: { released: 1 },
          cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
          status: "active",
          enabled: true,
          limit: { context: 128_000, output: 8_192 },
        },
        {
          id: "gpt-old",
          modelID: "gpt-old",
          providerID: "openai",
          name: "GPT Old",
          capabilities: { tools: false, input: ["text"], output: ["text"] },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "deprecated",
          enabled: true,
          limit: { context: 1, output: 1 },
        },
      ] satisfies ModelListOutput["data"],
    )

    expect(result.connected).toEqual(["openai"])
    expect(result.default).toEqual({ openai: "gpt-5" })
    expect(result.all.get("openai")?.models["gpt-old"]).toBeUndefined()
    expect(result.all.get("openai")?.models["gpt-5"]).toMatchObject({
      id: "gpt-5",
      providerID: "openai",
      capabilities: { toolcall: true, attachment: true },
      cost: { input: 1, output: 2 },
      variants: { high: {} },
    })
  })
})

describe("normalizeProjectInfo", () => {
  test("keeps the project VCS backend", () => {
    const project: Project = { id: "prj", canonical: "/repo", time: { created: 1, updated: 1, active: 1 }, sandboxes: [] }
    expect(normalizeProjectInfo({ ...project, vcs: "git" }).vcs).toBe("git")
    expect(normalizeProjectInfo({ ...project, vcs: "hg" }).vcs).toBe("hg")
    expect(normalizeProjectInfo(project).vcs).toBeUndefined()
  })
})

test.each([
  ["C:\\Repos\\sst\\aigcfroge", "C:/Repos/sst/aigcfroge"],
  ["C:/Repos/sst/aigcfroge", "C:/Repos/sst/aigcfroge"],
  ["/tmp/foo\\bar", "/tmp/foo\\bar"],
  ["C:/Repos/sst/aigcfroge/", "C:/Repos/sst/aigcfroge"],
  ["C:/", "C:/"],
  ["/", "/"],
])("directoryKey(%p) is %p", (input, expected) => {
  expect(String(directoryKey(input))).toBe(expected)
})
