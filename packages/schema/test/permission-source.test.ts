import { describe, expect, test } from "bun:test"
import { Schema, SchemaAST } from "effect"
import { Permission } from "../src/permission.js"
import { SessionTask } from "../src/session-task.js"
import { OperationID, OperationReadonlyRef } from "../src/session-task-operation-id.js"

describe("Permission provenance", () => {
  test("keeps the canonical operation ID leaf and stable public identifiers", () => {
    expect(SessionTask.OperationID).toBe(OperationID)
    expect(SessionTask.OperationReadonlyRef).toBe(OperationReadonlyRef)
    expect(Permission.OperationSource.fields.operationID).toBe(OperationID)
    expect(
      [Permission.ToolSource, Permission.OperationSource, Permission.Source, OperationID].map((schema) =>
        SchemaAST.resolveIdentifier(schema.ast),
      ),
    ).toStrictEqual([
      "Permission.ToolSource",
      "Permission.OperationSource",
      "Permission.Source",
      "SessionTask.OperationID",
    ])
  })

  test("retains loose historical Tool message and call IDs", () => {
    const source = { type: "tool" as const, messageID: "legacy-message", id: "legacy/call" }
    expect(Schema.decodeUnknownSync(Permission.ToolSource)(source)).toStrictEqual(source)
    expect(Schema.decodeUnknownSync(Permission.Source)(source)).toStrictEqual(source)
  })

  test("operation provenance survives Permission request and asked-event encoding", () => {
    const request = {
      id: "per_operation_contract",
      sessionID: "ses_origin",
      action: "task",
      resources: ["Review root"],
      source: { type: "operation", sessionID: "ses_origin", operationID: "top_contract" },
    }
    expect(
      Schema.encodeSync(Schema.toCodecJson(Permission.Request))(Schema.decodeUnknownSync(Permission.Request)(request)),
    ).toStrictEqual(request)
    expect(
      Schema.encodeSync(Schema.toCodecJson(Permission.Event.Asked.data))(
        Schema.decodeUnknownSync(Permission.Event.Asked.data)(request),
      ),
    ).toStrictEqual(request)
  })

  test("Tool-only inputs reject operation provenance even when Tool fields are supplied", () => {
    expect(() =>
      Schema.decodeUnknownSync(Permission.ToolSource)({
        type: "operation",
        sessionID: "ses_origin",
        operationID: "top_contract",
        messageID: "legacy-message",
        id: "legacy/call",
      }),
    ).toThrow()
  })

  test("operation provenance requires both canonical session and operation identities", () => {
    expect(() =>
      Schema.decodeUnknownSync(Permission.Source)({ type: "operation", sessionID: "ses_origin" }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Permission.Source)({ type: "operation", sessionID: "ses_origin", operationID: "top_" }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Permission.Source)({ type: "operation", operationID: "top_contract" }),
    ).toThrow()
  })
})
