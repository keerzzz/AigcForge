import { describe, expect, test } from "bun:test"
import { Result, Schema } from "effect"
import { Composition } from "@omnixa/schema/composition"
import {
  captureTools,
  computeCompositionDigest,
  computeDigest,
  validateCapturedTools,
  validateCurrentTools,
} from "../src/composition/digest"
import { Producer } from "../src/plugin/service"

describe("computeCompositionDigest", () => {
  const input1 = Schema.decodeUnknownSync(Composition.CompositionInput)({
    source: "temporary",
    agents: [
      {
        kind: "agent",
        relativePath: "coder.md",
        revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    ],
    bindings: {
      "agents/coder": {
        prompts: [
          {
            kind: "prompt",
            relativePath: "system.md",
            revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        ],
        skills: [
          {
            kind: "skill",
            relativePath: "git/SKILL.md",
            revision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        ],
      },
    },
    presentation: "native",
    requestedCapabilities: ["workspace.read"],
  })

  test("produces deterministic 64-char hex digest", () => {
    const d1 = computeCompositionDigest(input1)
    const d2 = computeCompositionDigest(input1)
    expect(d1).toBe(d2)
    expect(d1).toMatch(/^[0-9a-f]{64}$/)
  })

  test("different inputs produce different digests", () => {
    const input2 = Schema.decodeUnknownSync(Composition.CompositionInput)({
      source: "profile",
      profilePath: "dev.yaml",
      profileRevision: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    })
    const d1 = computeCompositionDigest(input1)
    const d2 = computeCompositionDigest(input2)
    expect(d1).not.toBe(d2)
  })
})

describe("captured tool integrity", () => {
  const placement = "/workspace/project#local"
  const version = "test-host"
  const direct = {
    type: "tool" as const,
    name: "read",
    description: "Read a file",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    outputSchema: { type: "string" },
    placement: "direct" as const,
    options: { codemode: false, permission: "read" },
  }
  const child = {
    type: "tool" as const,
    name: "execute",
    description: "A Code Mode child named execute",
    inputSchema: { type: "object", properties: { value: { type: "string" } } },
    outputSchema: { type: "string" },
    placement: "codemode" as const,
    options: { pinned: true, permission: "child" },
  }
  const entry = {
    type: "tool" as const,
    name: "execute",
    description: "Run Code Mode",
    inputSchema: { type: "object", properties: { code: { type: "string" } } },
    placement: "direct" as const,
  }
  const catalog = [
    direct,
    { ...child, name: "mcp_git_list-files", options: { codemode: true } },
    entry,
    { ...child, name: "mcp_git_list_files", options: { codemode: true } },
    child,
  ]
  const frozenTools = () => {
    const tools = captureTools(catalog, placement, version)
    if (tools.capture === undefined) throw new Error("Expected frozen tool definitions")
    return { ...tools, capture: tools.capture }
  }
  const expectReason = (tools: Composition.SnapshotToolInfo, reason: string) => {
    const validation = validateCapturedTools(tools)
    expect(Result.isFailure(validation)).toBe(true)
    if (!Result.isFailure(validation)) throw new Error(`Expected ${reason}`)
    expect(validation.failure.reason).toBe(reason)
    expect(validation.failure.details.length).toBeGreaterThan(0)
  }

  test("compares historical captures using their original fields without rewriting their digest", () => {
    const historical = captureTools([direct], placement, version)
    const stored = JSON.stringify(historical)
    const producer = new Producer({ id: "local-read", revision: "a".repeat(64) })
    const current = [{ ...direct, producer }]
    expect(Result.isSuccess(validateCurrentTools(historical, current, placement, version))).toBe(true)
    expect(JSON.stringify(historical)).toBe(stored)
    expect(
      Result.isFailure(
        validateCurrentTools(historical, [{ ...direct, producer, description: "Changed" }], placement, version),
      ),
    ).toBe(true)
  })

  test("requires the actual proven producer and rejects absent or foreign evidence", () => {
    const producer = new Producer({ id: "local-read", revision: "a".repeat(64) })
    const frozen = captureTools([{ ...direct, producer }], placement, version)
    expect(Result.isSuccess(validateCurrentTools(frozen, [{ ...direct, producer }], placement, version))).toBe(true)
    for (const current of [
      direct,
      { ...direct, producer: new Producer({ id: "other-plugin", revision: producer.revision }) },
      { ...direct, producer: new Producer({ id: producer.id, revision: "b".repeat(64) }) },
    ]) {
      const validation = validateCurrentTools(frozen, [current], placement, version)
      expect(Result.isFailure(validation)).toBe(true)
      if (Result.isFailure(validation)) expect(validation.failure.reason).toBe("tool_runtime_definition_mismatch")
    }
  })

  test("uses one ordered capture for catalog, fingerprints, and MCP audit", () => {
    const tools = frozenTools()
    expect(Result.isSuccess(validateCapturedTools(tools))).toBe(true)
    expect(tools.catalog).toEqual(tools.fingerprints.map((tool) => tool.name))
    expect(tools.fingerprints.map((tool) => tool.placement)).toEqual(tools.catalog.map(() => placement))
    expect(tools.fingerprints.map((tool) => tool.installationVersion)).toEqual(tools.catalog.map(() => version))
    expect(tools.catalogDigest).toBe(computeDigest(tools.fingerprints))
    expect(
      Composition.mcpAuditMatchesCatalog({
        catalog: tools.catalog,
        auditToolNames: ["mcp_git_list-files", "mcp_git_list_files"],
      }).matches,
    ).toBe(true)
  })

  test("permits the same tool name in different execution placements", () => {
    const tools = captureTools([entry, child], placement, version)
    expect(tools.catalog).toEqual(["execute", "execute"])
    expect(tools.capture).toEqual([child, entry])
    expect(tools.fingerprints[0].digest).not.toBe(tools.fingerprints[1].digest)
    expect(Result.isSuccess(validateCapturedTools(tools))).toBe(true)
  })

  test("rejects repeated composite identity even when definitions differ", () => {
    const tools = frozenTools()
    expectReason(
      {
        ...tools,
        capture: [direct, { ...direct, description: "A conflicting read definition" }],
      },
      "duplicate_tool_capture",
    )
    expect(() =>
      captureTools([direct, { ...direct, description: "A conflicting read definition" }], placement, version),
    ).toThrow("duplicate_tool_capture")
  })

  test("rejects reordered data even when fingerprints and their digest were reordered together", () => {
    const tools = frozenTools()
    const fingerprints = tools.fingerprints.toReversed()
    expectReason(
      {
        ...tools,
        capture: tools.capture.toReversed(),
        fingerprints,
        catalog: tools.catalog.toReversed(),
        catalogDigest: computeDigest(fingerprints),
      },
      "unsorted_tool_capture",
    )
  })

  test("rejects reversed execution placement order when tool names are equal", () => {
    const tools = captureTools([entry, child], placement, version)
    const fingerprints = tools.fingerprints.toReversed()
    expectReason(
      {
        ...tools,
        capture: [entry, child],
        fingerprints,
        catalogDigest: computeDigest(fingerprints),
      },
      "unsorted_tool_capture",
    )
  })

  test("requires captured definitions even for historical self-consistent fingerprints", () => {
    expectReason({ ...frozenTools(), capture: undefined }, "missing_tool_capture")
  })

  test.each([
    { name: "JSON primitive", capture: [0] },
    { name: "null", capture: [null] },
    { name: "array", capture: [[]] },
    { name: "missing definition fields", capture: [{ name: "read" }] },
    { name: "unknown execution placement", capture: [{ ...direct, placement: "remote" }] },
    { name: "non-record input schema", capture: [{ ...direct, inputSchema: [] }] },
    { name: "non-record output schema", capture: [{ ...direct, outputSchema: null }] },
    { name: "non-record options", capture: [{ ...direct, options: [] }] },
    { name: "non-JSON number", capture: [Number.NaN] },
  ])("rejects $name capture entries", (scenario) => {
    expectReason({ ...frozenTools(), capture: scenario.capture }, "invalid_tool_capture")
  })

  test("rejects missing captured callables", () => {
    const tools = frozenTools()
    expectReason({ ...tools, capture: tools.capture.slice(1) }, "tool_capture_length_mismatch")
  })

  test("rejects fingerprints that no longer identify their captured callable", () => {
    const tools = frozenTools()
    const fingerprints = tools.fingerprints.map((tool, index) =>
      index === 0 ? { ...tool, name: "another_tool" } : tool,
    )
    expectReason(
      {
        ...tools,
        fingerprints,
        catalog: fingerprints.map((tool) => tool.name),
        catalogDigest: computeDigest(fingerprints),
      },
      "tool_capture_fingerprint_mismatch",
    )
  })

  test.each([
    { name: "description", capture: { ...direct, description: "Read a different file" } },
    { name: "input schema", capture: { ...direct, inputSchema: { type: "object", properties: {} } } },
    { name: "output schema", capture: { ...direct, outputSchema: { type: "number" } } },
    { name: "permission options", capture: { ...direct, options: { ...direct.options, permission: "write" } } },
    { name: "execution placement", capture: { ...direct, placement: "codemode" as const } },
  ])("detects changed $name even when the fingerprint list digest is intact", (scenario) => {
    expectReason(
      { ...captureTools([direct], placement, version), capture: [scenario.capture] },
      "tool_capture_digest_mismatch",
    )
  })

  test("checks raw JSON extensions rather than only schema-decoded fields", () => {
    const extended = { ...direct, "x-producer": { revision: 1, values: ["a", "b"] } }
    const tools = captureTools([extended], placement, version)
    expect(tools.capture).toEqual([extended])
    expect(Result.isSuccess(validateCapturedTools(tools))).toBe(true)
    expectReason(
      { ...tools, capture: [{ ...extended, "x-producer": { revision: 2, values: ["a", "b"] } }] },
      "tool_capture_digest_mismatch",
    )
  })

  test("does not share captured JSON with the caller's schema objects", () => {
    const tool = { ...direct, inputSchema: { type: "object", properties: { path: { type: "string" } } } }
    const tools = captureTools([tool], placement, version)
    tool.inputSchema.properties.path.type = "number"
    expect(Result.isSuccess(validateCapturedTools(tools))).toBe(true)
    expect(tools.capture).toEqual([
      { ...tool, inputSchema: { type: "object", properties: { path: { type: "string" } } } },
    ])
  })

  test("includes authored __proto__ JSON properties in captured tool digests", () => {
    const inputSchema = Object.fromEntries([
      ["type", "object"],
      ["__proto__", { "x-revision": 1 }],
    ])
    const tools = captureTools([{ ...direct, inputSchema }], placement, version)
    expect(Result.isSuccess(validateCapturedTools(tools))).toBe(true)
    const changedInputSchema = Object.fromEntries([
      ["type", "object"],
      ["__proto__", { "x-revision": 2 }],
    ])
    expect(computeDigest(inputSchema)).not.toBe(computeDigest(changedInputSchema))
    expectReason(
      { ...tools, capture: [{ ...direct, inputSchema: changedInputSchema }] },
      "tool_capture_digest_mismatch",
    )
  })

  test("rejects reordered catalog names independently of fingerprints", () => {
    const tools = frozenTools()
    expectReason({ ...tools, catalog: tools.catalog.toReversed() }, "tool_catalog_mismatch")
    expectReason({ ...tools, catalog: tools.catalog.slice(1) }, "tool_catalog_mismatch")
  })

  test("rejects a forged fingerprint digest even when its catalog digest is recomputed", () => {
    const tools = frozenTools()
    const fingerprints = tools.fingerprints.map((tool, index) =>
      index === 0 ? { ...tool, digest: computeDigest("forged") } : tool,
    )
    expectReason({ ...tools, fingerprints, catalogDigest: computeDigest(fingerprints) }, "tool_capture_digest_mismatch")
  })

  test.each(["placement", "installationVersion"] as const)("requires a nonempty host %s", (field) => {
    const tools = frozenTools()
    const fingerprints = tools.fingerprints.map((tool) => ({ ...tool, [field]: "   " }))
    expectReason({ ...tools, fingerprints, catalogDigest: computeDigest(fingerprints) }, "empty_tool_host_identity")
  })

  test.each(["placement", "installationVersion"] as const)("requires one shared host %s", (field) => {
    const tools = frozenTools()
    const fingerprints = tools.fingerprints.map((tool, index) =>
      index === 1 ? { ...tool, [field]: "another-host" } : tool,
    )
    expectReason({ ...tools, fingerprints, catalogDigest: computeDigest(fingerprints) }, "tool_host_identity_mismatch")
  })

  test("rejects a catalog digest that does not match its fingerprints", () => {
    expectReason({ ...frozenTools(), catalogDigest: computeDigest("unrelated") }, "tool_catalog_digest_mismatch")
  })
})
