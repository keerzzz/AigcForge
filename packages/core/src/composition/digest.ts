export * as CompositionDigest from "./digest"

import { ToolDefinition } from "@omnixa/ai"
import { Result, Schema } from "effect"
import { Composition } from "@omnixa/schema/composition"
import { Hash } from "@omnixa/util/hash"
import type { Tool } from "../tool"
import { Producer } from "../plugin/service"

const CapturedTool = Schema.Struct({
  ...ToolDefinition.fields,
  placement: Schema.Literals(["direct", "codemode"]),
  options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  producer: Schema.optionalKey(Producer),
  namespaceMetadata: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, description: Schema.String })),
  ),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function canonicalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj
  if (Array.isArray(obj)) return obj.map(canonicalize)
  if (isRecord(obj)) {
    // Define own data properties so authored JSON keys such as __proto__ are preserved.
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((key) => [key, canonicalize(obj[key])]),
    )
  }
  return obj
}

export function computeDigest(value: unknown): Composition.Digest {
  return Schema.decodeUnknownSync(Composition.Digest)(Hash.sha256(JSON.stringify(canonicalize(value))))
}

export function computeCompositionDigest(input: Composition.CompositionInput): Composition.Digest {
  return computeDigest(input)
}

/** The same ordered capture must determine stored names and fingerprints. */
export function captureTools(catalog: Tool.Snapshot["catalog"], placement: string, hostVersion: string) {
  const capture = structuredClone(catalog).toSorted(compareCapturedTools)
  const fingerprints = capture.map((tool) => ({
    placement,
    name: tool.name,
    digest: computeDigest(tool),
    // This is the host build version, not independent plugin provenance.
    installationVersion: hostVersion,
  }))
  const snapshot = new Composition.SnapshotToolInfo({
    capture: Schema.decodeUnknownSync(Schema.Array(Schema.Json))(capture),
    fingerprints,
    catalog: fingerprints.map((tool) => tool.name),
    catalogDigest: computeDigest(fingerprints),
  })
  const validation = validateCapturedTools(snapshot)
  if (Result.isFailure(validation)) {
    throw new Error(`${validation.failure.reason}: ${validation.failure.details}`)
  }
  return snapshot
}

/** Validate stored ordering and identity without repairing or rehashing the stored data. */
export function validateCapturedTools(tools: Composition.SnapshotToolInfo) {
  const missing = (reason: string, details: string) => Result.fail({ reason, details })
  if (tools.capture === undefined) {
    return missing("missing_tool_capture", "snapshot has no captured tool definitions")
  }
  if (!Schema.is(Schema.Array(Schema.Json))(tools.capture)) {
    return missing("invalid_tool_capture", "captured tool definitions contain non-JSON values")
  }
  const capture = Schema.decodeUnknownResult(Schema.Array(CapturedTool))(tools.capture)
  if (Result.isFailure(capture)) {
    return missing("invalid_tool_capture", capture.failure.message)
  }
  const unsorted = capture.success.findIndex(
    (tool, index) => index > 0 && compareCapturedTools(capture.success[index - 1], tool) > 0,
  )
  if (unsorted >= 0) {
    return missing("unsorted_tool_capture", `captured tool at index ${unsorted} is out of order`)
  }
  const duplicate = capture.success.findIndex(
    (tool, index) =>
      index > 0 &&
      tool.name === capture.success[index - 1].name &&
      tool.placement === capture.success[index - 1].placement,
  )
  if (duplicate >= 0) {
    return missing("duplicate_tool_capture", `captured tool at index ${duplicate} repeats the preceding identity`)
  }
  if (capture.success.length !== tools.fingerprints.length) {
    return missing(
      "tool_capture_length_mismatch",
      `${capture.success.length} captured tools do not match ${tools.fingerprints.length} fingerprints`,
    )
  }
  const mismatchedName = capture.success.findIndex((tool, index) => tool.name !== tools.fingerprints[index].name)
  if (mismatchedName >= 0) {
    return missing(
      "tool_capture_fingerprint_mismatch",
      `captured tool name at index ${mismatchedName} does not match its fingerprint`,
    )
  }
  // The shape decoder may discard producer extensions. Hash the original JSON
  // so every captured field, including those extensions, remains part of identity.
  const mismatchedDigest = tools.capture.findIndex(
    (tool, index) => computeDigest(tool) !== tools.fingerprints[index].digest,
  )
  if (mismatchedDigest >= 0) {
    return missing(
      "tool_capture_digest_mismatch",
      `captured tool digest at index ${mismatchedDigest} does not match its fingerprint`,
    )
  }
  if (
    tools.catalog.length !== tools.fingerprints.length ||
    tools.catalog.some((name, index) => name !== tools.fingerprints[index].name)
  ) {
    return missing("tool_catalog_mismatch", "tool catalog does not match the ordered fingerprint names")
  }
  const emptyHost = tools.fingerprints.findIndex(
    (tool) => tool.placement.trim().length === 0 || tool.installationVersion.trim().length === 0,
  )
  if (emptyHost >= 0) {
    return missing(
      "empty_tool_host_identity",
      `tool fingerprint at index ${emptyHost} has no host placement or version`,
    )
  }
  const host = tools.fingerprints[0]
  if (
    host !== undefined &&
    tools.fingerprints.some(
      (tool) => tool.placement !== host.placement || tool.installationVersion !== host.installationVersion,
    )
  ) {
    return missing("tool_host_identity_mismatch", "tool fingerprints do not share one host placement and version")
  }
  if (computeDigest(tools.fingerprints) !== tools.catalogDigest) {
    return missing("tool_catalog_digest_mismatch", "tool catalog digest does not match the stored fingerprints")
  }
  return Result.succeed(capture.success)
}

/** Check the same captured registrations that will execute, before and after permission filtering. */
export function validateCurrentTools(
  tools: Composition.SnapshotToolInfo,
  catalog: Tool.Snapshot["catalog"],
  placement: string,
  hostVersion: string,
  complete = true,
) {
  const captured = validateCapturedTools(tools)
  if (Result.isFailure(captured)) return captured
  const missing = (reason: string, details: string) => Result.fail({ reason, details })
  if (tools.fingerprints.some((tool) => tool.placement !== placement || tool.installationVersion !== hostVersion))
    return missing("tool_runtime_host_mismatch", "the frozen tool host placement or version is unavailable")
  if (complete && catalog.length !== captured.success.length)
    return missing("tool_runtime_catalog_mismatch", "the frozen tool catalog is no longer complete")
  for (const tool of catalog) {
    const index = captured.success.findIndex((entry) => entry.name === tool.name && entry.placement === tool.placement)
    if (index < 0) return missing("tool_runtime_catalog_mismatch", `tool '${tool.name}' has no frozen registration`)
    // Historical captures compare their original fields; they carry no producer freeze evidence.
    const current = captured.success[index].producer === undefined ? { ...tool, producer: undefined } : tool
    if (computeDigest(current) !== tools.fingerprints[index].digest)
      return missing("tool_runtime_definition_mismatch", `tool '${tool.name}' has changed since the freeze`)
  }
  return Result.succeed(undefined)
}

function compareCapturedTools(
  left: Pick<Tool.Snapshot["catalog"][number], "name" | "placement">,
  right: Pick<Tool.Snapshot["catalog"][number], "name" | "placement">,
) {
  return left.name.localeCompare(right.name) || left.placement.localeCompare(right.placement)
}
