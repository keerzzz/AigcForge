export * as DelegationReceipt from "./receipt"

import { Schema } from "effect"
import { createHash } from "node:crypto"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { SessionID } from "@aigcfroge/schema/session-id"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { Location } from "@aigcfroge/schema/location"
import { Delegation } from "@aigcfroge/schema/delegation"
import { Permission } from "@aigcfroge/schema/permission"
import { DelegationFold } from "./fold"

const reference = {
  kind: Schema.Literal("external-cli"),
  delegationID: DelegationID.ID,
  participantID: ParticipantID,
  turnID: TurnID,
  deliveryOrigin: Schema.String,
  senderParticipantID: ParticipantID,
  attempt: Schema.Int,
  parentSessionID: SessionID,
  source: Schema.Struct({ type: Schema.Literal("tool"), messageID: SessionMessage.ID, id: Schema.String }),
}

export class External extends Schema.Class<External>("DelegationReceipt.External")({
  ...reference,
  externalThreadID: Schema.String,
  externalTurnID: Schema.String,
}) {}

/** Admission and unknown start facts cannot claim a native turn. */
export class Pending extends Schema.Class<Pending>("DelegationReceipt.Pending")({
  ...reference,
  execution: Schema.Literals(["queued", "start_unknown", "admitted"]),
  externalThreadID: Schema.optionalKey(Schema.String),
  externalTurnID: Schema.optionalKey(Schema.Never),
}) {}

export class SdkMessage extends Schema.Class<SdkMessage>("DelegationReceipt.SdkMessage")({
  sessionID: Schema.String,
  messageID: Schema.String,
}) {}

export class Sdk extends Schema.Class<Sdk>("DelegationReceipt.Sdk")({
  ...reference,
  target: Schema.Literal("claude-code"),
  transport: Schema.Literal("sdk"),
  sdkMessage: SdkMessage,
  externalTurnID: Schema.optionalKey(Schema.Never),
}) {}

export class JsonlMessage extends Schema.Class<JsonlMessage>("DelegationReceipt.JsonlMessage")({
  sessionID: Schema.String,
  messageID: Schema.String,
}) {}

export class Jsonl extends Schema.Class<Jsonl>("DelegationReceipt.Jsonl")({
  ...reference,
  target: Schema.Literal("claude-code"),
  transport: Schema.Literal("jsonl"),
  jsonlMessage: JsonlMessage,
  externalTurnID: Schema.optionalKey(Schema.Never),
}) {}

export class SdkLifecycle extends Schema.Class<SdkLifecycle>("DelegationReceipt.SdkLifecycle")({
  type: Schema.Literal("command_lifecycle"),
  command_uuid: Schema.String,
  state: Schema.Literals(["queued", "started", "completed", "cancelled", "discarded"]),
  uuid: Schema.String,
  session_id: Schema.String,
}) {}

export class SdkResultObservation extends Schema.Class<SdkResultObservation>("DelegationReceipt.SdkResultObservation")({
  type: Schema.Literal("result"),
  subtype: Schema.optionalKey(Schema.String),
  is_error: Schema.optionalKey(Schema.Boolean),
  result: Schema.optionalKey(Schema.String),
  errors: Schema.optionalKey(Schema.Array(Schema.String)),
  session_id: Schema.optionalKey(Schema.String),
  uuid: Schema.optionalKey(Schema.String),
  user_message_uuid: Schema.optionalKey(Schema.String),
  terminal_reason: Schema.optionalKey(Schema.String),
}) {}

export class SdkSessionObservation extends Schema.Class<SdkSessionObservation>(
  "DelegationReceipt.SdkSessionObservation",
)({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  session_id: Schema.String,
  uuid: Schema.optionalKey(Schema.String),
}) {}

export const SdkObservation = Schema.Union([SdkLifecycle, SdkResultObservation, SdkSessionObservation])
export type SdkObservation = typeof SdkObservation.Type

export class SdkInput extends Schema.Class<SdkInput>("DelegationReceipt.SdkInput")({
  uuid: Schema.TemplateLiteral([
    Schema.String,
    "-",
    Schema.String,
    "-",
    Schema.String,
    "-",
    Schema.String,
    "-",
    Schema.String,
  ]),
  observations: Schema.Array(SdkObservation),
}) {}

export class AcpPrompt extends Schema.Class<AcpPrompt>("DelegationReceipt.AcpPrompt")({
  sessionID: Schema.String,
  requestID: Schema.Union([Schema.String, Schema.Number]),
  userMessageID: Schema.optionalKey(Schema.NullOr(Schema.String)),
  agentMessageIDs: Schema.optionalKey(Schema.Array(Schema.NullOr(Schema.String))),
}) {}

export class Acp extends Schema.Class<Acp>("DelegationReceipt.Acp")({
  ...reference,
  target: Schema.Literal("claude-code"),
  transport: Schema.Literal("acp"),
  acpPrompt: AcpPrompt,
  externalTurnID: Schema.optionalKey(Schema.Never),
}) {}

export const Outcome = Schema.Union([External, Pending, Sdk, Acp, Jsonl])
export type Outcome = typeof Outcome.Type

export class ArtifactEvidence extends Schema.Class<ArtifactEvidence>("DelegationService.ArtifactEvidence")({
  location: Location.Ref,
  repository: Schema.String,
  path: Schema.String,
  commitSha: Schema.String,
  baseSha256: Schema.String,
  targetSha256: Schema.String,
  normalizedDiff: Schema.String,
  revisionDigest: Delegation.RevisionDigest,
  changeKind: Schema.Literals(["no_change", "no_code_change", "rework", "formatting_only"]),
}) {}

export class RevisionReference extends Schema.Class<RevisionReference>("DelegationService.RevisionReference")({
  receipt: Delegation.Receipt,
  source: Permission.Source,
  path: Schema.String,
  revisionDigest: Delegation.RevisionDigest,
  artifact: Schema.optionalKey(ArtifactEvidence),
}) {}

export const ReviewReceipt = Schema.Union([Delegation.Receipt, External, Schema.toCodecJson(Sdk)])
export type ReviewReceipt = typeof ReviewReceipt.Type

export const Governance = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("revision"),
    receipt: Delegation.Receipt,
    source: Permission.Source,
    artifact: ArtifactEvidence,
    producer: Schema.optionalKey(RevisionReference),
  }),
  Schema.Struct({
    kind: Schema.Literal("review"),
    status: Schema.Literal("valid"),
    receipt: ReviewReceipt,
    source: Permission.Source,
    reviewedRevisionDigest: Delegation.RevisionDigest,
    envelope: Delegation.ReviewEnvelope,
  }),
  Schema.Struct({
    kind: Schema.Literal("revision"),
    status: Schema.Literal("invalid"),
    reason: Schema.String,
    receipt: Delegation.Receipt,
    source: Permission.Source,
  }),
  Schema.Struct({
    kind: Schema.Literal("review"),
    status: Schema.Literal("invalid"),
    reason: Schema.String,
    receipt: ReviewReceipt,
    source: Permission.Source,
  }),
])
export type Governance = typeof Governance.Type

/** Native execution references and the retained governed review result. */
export class Binding extends Schema.Class<Binding>("DelegationReceipt.Binding")({
  ...reference,
  location: Location.Ref,
  agent: Schema.String,
  target: Schema.Literals(["codex", "claude-code"]),
  transport: Schema.Literals(["app-server", "sdk", "acp", "jsonl"]),
  command: Schema.String,
  parentTaskID: Schema.String,
  parentTaskRevision: Schema.Int,
  background: Schema.optionalKey(Schema.Boolean),
  execution: Schema.optionalKey(Schema.Literals(["queued", "start_unknown", "admitted"])),
  externalThreadID: Schema.optionalKey(Schema.String),
  externalTurnID: Schema.optionalKey(Schema.String),
  sdkMessage: Schema.optionalKey(SdkMessage),
  jsonlMessage: Schema.optionalKey(JsonlMessage),
  sdkInput: Schema.optionalKey(SdkInput),
  sdkObservations: Schema.optionalKey(Schema.Array(SdkObservation)),
  acpPrompt: Schema.optionalKey(AcpPrompt),
  model: Schema.optionalKey(Schema.String),
  modelProvider: Schema.optionalKey(Schema.String),
  cliVersion: Schema.optionalKey(Schema.String),
  review: Schema.optionalKey(RevisionReference),
  reviewText: Schema.optionalKey(Schema.String),
  settlement: Schema.optionalKey(
    Schema.Struct({
      status: Schema.Literals(["completed", "failed", "cancelled", "recovery_required"]),
      text: Schema.String,
      governance: Schema.optionalKey(Governance),
    }),
  ),
  archiveReceipts: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        status: Schema.Literals(["completed", "failed"]),
        timestamp: Schema.Int,
        source: Schema.optionalKey(Permission.Source),
        error: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
}) {}

const outputReference = {
  kind: Schema.Literal("external-cli"),
  parentSessionID: SessionID,
  delegationID: DelegationID.ID,
  participantID: ParticipantID,
  turnID: TurnID,
  parentTaskID: Schema.String,
  output: Schema.String,
}

export class NativeOutput extends Schema.Class<NativeOutput>("Task.ExternalOutput")({
  ...outputReference,
  externalThreadID: Schema.String,
  externalTurnID: Schema.String,
  status: Schema.Literals(["running", "completed", "failed", "cancelled", "recovery_required"]),
  governance: Schema.optionalKey(Governance),
}) {}

export class PendingOutput extends Schema.Class<PendingOutput>("Task.PendingExternalOutput")({
  ...outputReference,
  execution: Schema.Literals(["queued", "start_unknown", "admitted"]),
  externalThreadID: Schema.optionalKey(Schema.String),
  externalTurnID: Schema.optionalKey(Schema.Never),
  status: Schema.Literals(["running", "queued", "failed", "cancelled", "recovery_required"]),
}) {}

export class SdkOutput extends Schema.Class<SdkOutput>("Task.SdkExternalOutput")({
  ...outputReference,
  target: Schema.Literal("claude-code"),
  transport: Schema.Literal("sdk"),
  sdkMessage: SdkMessage,
  externalTurnID: Schema.optionalKey(Schema.Never),
  status: Schema.Literals(["completed", "failed", "cancelled", "recovery_required"]),
  governance: Schema.optionalKey(Governance),
}) {}

export class AcpOutput extends Schema.Class<AcpOutput>("Task.AcpExternalOutput")({
  ...outputReference,
  target: Schema.Literal("claude-code"),
  transport: Schema.Literal("acp"),
  acpPrompt: AcpPrompt,
  externalTurnID: Schema.optionalKey(Schema.Never),
  status: Schema.Literals(["completed", "failed", "cancelled", "recovery_required"]),
}) {}

export class JsonlOutput extends Schema.Class<JsonlOutput>("Task.JsonlExternalOutput")({
  ...outputReference,
  target: Schema.Literal("claude-code"),
  transport: Schema.Literal("jsonl"),
  jsonlMessage: JsonlMessage,
  externalTurnID: Schema.optionalKey(Schema.Never),
  status: Schema.Literals(["completed", "failed", "cancelled", "recovery_required"]),
}) {}

export const Output = Schema.Union([NativeOutput, PendingOutput, SdkOutput, AcpOutput, JsonlOutput])
export type Output = typeof Output.Type

/** Project only this input's admission facts; a Pending never borrows a native turn. */
export const pending = (binding: Binding, execution: Pending["execution"]) =>
  new Pending({
    kind: "external-cli",
    delegationID: binding.delegationID,
    participantID: binding.participantID,
    turnID: binding.turnID,
    deliveryOrigin: binding.deliveryOrigin,
    senderParticipantID: binding.senderParticipantID,
    attempt: binding.attempt,
    parentSessionID: binding.parentSessionID,
    source: binding.source,
    execution,
    ...(binding.transport !== "sdk" && execution !== "admitted" && binding.externalThreadID !== undefined
      ? { externalThreadID: binding.externalThreadID }
      : {}),
  })

export const fromBinding = (binding: Binding): Outcome | undefined => {
  if (binding.target === "claude-code" && binding.transport === "jsonl")
    return binding.jsonlMessage && binding.externalTurnID === undefined
      ? new Jsonl({
          kind: "external-cli",
          delegationID: binding.delegationID,
          participantID: binding.participantID,
          turnID: binding.turnID,
          deliveryOrigin: binding.deliveryOrigin,
          senderParticipantID: binding.senderParticipantID,
          attempt: binding.attempt,
          parentSessionID: binding.parentSessionID,
          source: binding.source,
          target: "claude-code",
          transport: "jsonl",
          jsonlMessage: binding.jsonlMessage,
        })
      : undefined
  if (binding.target === "claude-code" && binding.transport === "acp")
    return binding.acpPrompt && binding.externalTurnID === undefined
      ? new Acp({
          kind: "external-cli",
          delegationID: binding.delegationID,
          participantID: binding.participantID,
          turnID: binding.turnID,
          deliveryOrigin: binding.deliveryOrigin,
          senderParticipantID: binding.senderParticipantID,
          attempt: binding.attempt,
          parentSessionID: binding.parentSessionID,
          source: binding.source,
          target: "claude-code",
          transport: "acp",
          acpPrompt: binding.acpPrompt,
        })
      : undefined
  if (binding.target === "claude-code" && binding.transport === "sdk")
    return binding.sdkMessage && binding.externalTurnID === undefined
      ? new Sdk({
          kind: "external-cli",
          delegationID: binding.delegationID,
          participantID: binding.participantID,
          turnID: binding.turnID,
          deliveryOrigin: binding.deliveryOrigin,
          senderParticipantID: binding.senderParticipantID,
          attempt: binding.attempt,
          parentSessionID: binding.parentSessionID,
          source: binding.source,
          target: "claude-code",
          transport: "sdk",
          sdkMessage: binding.sdkMessage,
        })
      : binding.background === true && binding.execution && binding.externalTurnID === undefined
        ? pending(binding, binding.execution)
        : undefined
  if (binding.target !== "codex" || binding.transport !== "app-server") return
  if (binding.externalThreadID && binding.externalTurnID)
    return new External({
      ...binding,
      externalThreadID: binding.externalThreadID,
      externalTurnID: binding.externalTurnID,
    })
  if (binding.externalTurnID === undefined && binding.execution && binding.execution !== "admitted")
    return pending(binding, binding.execution)
}

/** Both live completion and recovery publish the same Task result representation. */
export const response = (
  receipt: Outcome,
  parentTaskID: string,
  result: { readonly status: Output["status"]; readonly text: string; readonly governance?: Governance },
) => {
  const output = Schema.decodeUnknownSync(Output)({
    kind: "external-cli",
    parentSessionID: receipt.parentSessionID,
    delegationID: receipt.delegationID,
    participantID: receipt.participantID,
    turnID: receipt.turnID,
    ...(receipt instanceof Jsonl
      ? { target: receipt.target, transport: receipt.transport, jsonlMessage: receipt.jsonlMessage }
      : receipt instanceof Sdk
        ? { target: receipt.target, transport: receipt.transport, sdkMessage: receipt.sdkMessage }
        : receipt instanceof Acp
          ? { target: receipt.target, transport: receipt.transport, acpPrompt: receipt.acpPrompt }
          : {
              ...(receipt.externalThreadID !== undefined ? { externalThreadID: receipt.externalThreadID } : {}),
              ...(receipt instanceof External
                ? { externalTurnID: receipt.externalTurnID }
                : { execution: receipt.execution }),
            }),
    parentTaskID,
    status: result.status,
    output: result.text,
    ...(result.governance ? { governance: result.governance } : {}),
  })
  return {
    output,
    content: [{ type: "text" as const, text: JSON.stringify(Schema.encodeSync(Output)(output)) }],
    metadata: {
      // Protocol-result consumers require the complete result JSON.
      ...(receipt instanceof Sdk || receipt instanceof Acp || receipt instanceof Jsonl || receipt instanceof Pending
        ? { truncated: false }
        : {}),
      ...(result.status === "running" || result.status === "queued"
        ? {}
        : { externalReceipt: Schema.encodeSync(Schema.toCodecJson(Outcome))(receipt) }),
      parentTaskID,
      status: result.status,
      ...(result.governance
        ? { governance: Schema.encodeSync(Schema.toCodecJson(Governance))(result.governance) }
        : {}),
    },
  }
}

export const key = (
  value: Pick<
    External,
    "delegationID" | "participantID" | "turnID" | "deliveryOrigin" | "senderParticipantID" | "attempt"
  >,
) => `delegation:external:${value.delegationID}:${DelegationFold.inputID(value.delegationID, value)}`

export const matches = (binding: Binding, receipt: Outcome) => {
  if (
    key(binding) !== key(receipt) ||
    binding.parentSessionID !== receipt.parentSessionID ||
    binding.source.messageID !== receipt.source.messageID ||
    binding.source.id !== receipt.source.id
  )
    return false
  if (receipt instanceof Acp)
    return (
      binding.target === receipt.target &&
      binding.transport === "acp" &&
      binding.externalThreadID === receipt.acpPrompt.sessionID &&
      binding.externalTurnID === undefined &&
      matchesPrompt(binding.acpPrompt, receipt.acpPrompt)
    )
  if (receipt instanceof Jsonl)
    return (
      binding.target === receipt.target &&
      binding.transport === "jsonl" &&
      binding.externalThreadID === receipt.jsonlMessage.sessionID &&
      binding.externalTurnID === undefined &&
      binding.jsonlMessage?.sessionID === receipt.jsonlMessage.sessionID &&
      binding.jsonlMessage?.messageID === receipt.jsonlMessage.messageID
    )
  if (receipt instanceof Sdk)
    return (
      binding.target === "claude-code" &&
      binding.transport === "sdk" &&
      binding.externalThreadID === receipt.sdkMessage.sessionID &&
      binding.externalTurnID === undefined &&
      binding.sdkMessage?.sessionID === receipt.sdkMessage.sessionID &&
      binding.sdkMessage?.messageID === receipt.sdkMessage.messageID
    )
  if (receipt instanceof Pending && binding.target === "claude-code" && binding.transport === "sdk")
    return (
      binding.target === "claude-code" &&
      binding.transport === "sdk" &&
      binding.background === true &&
      binding.execution === receipt.execution &&
      binding.externalTurnID === undefined &&
      receipt.externalThreadID === undefined
    )
  return (
    binding.target === "codex" &&
    binding.transport === "app-server" &&
    binding.externalThreadID === receipt.externalThreadID &&
    binding.externalTurnID === receipt.externalTurnID &&
    (!("execution" in receipt) || binding.execution === receipt.execution)
  )
}

export const decodeOutput = Schema.decodeUnknownOption(Schema.fromJsonString(Output))

export const matchesOutput = (binding: Binding, output: Output) => {
  if (
    binding.parentSessionID !== output.parentSessionID ||
    binding.delegationID !== output.delegationID ||
    binding.participantID !== output.participantID ||
    binding.turnID !== output.turnID ||
    binding.parentTaskID !== output.parentTaskID
  )
    return false
  if (output instanceof AcpOutput)
    return (
      binding.target === output.target &&
      binding.transport === "acp" &&
      binding.externalThreadID === output.acpPrompt.sessionID &&
      binding.externalTurnID === undefined &&
      matchesPrompt(binding.acpPrompt, output.acpPrompt)
    )
  if (output instanceof JsonlOutput)
    return (
      binding.target === output.target &&
      binding.transport === "jsonl" &&
      binding.externalThreadID === output.jsonlMessage.sessionID &&
      binding.externalTurnID === undefined &&
      binding.jsonlMessage?.sessionID === output.jsonlMessage.sessionID &&
      binding.jsonlMessage?.messageID === output.jsonlMessage.messageID
    )
  if (output instanceof SdkOutput)
    return (
      binding.target === "claude-code" &&
      binding.transport === "sdk" &&
      binding.externalThreadID === output.sdkMessage.sessionID &&
      binding.externalTurnID === undefined &&
      binding.sdkMessage?.sessionID === output.sdkMessage.sessionID &&
      binding.sdkMessage?.messageID === output.sdkMessage.messageID
    )
  if (output instanceof PendingOutput && binding.target === "claude-code" && binding.transport === "sdk")
    return (
      binding.target === "claude-code" &&
      binding.transport === "sdk" &&
      binding.background === true &&
      binding.externalTurnID === undefined &&
      output.externalThreadID === undefined &&
      (output.status === "queued"
        ? output.execution === "queued"
        : binding.execution === output.execution && (output.status !== "running" || output.execution === "admitted"))
    )
  if (output instanceof PendingOutput && output.status === "running") return false
  return (
    binding.target === "codex" &&
    binding.transport === "app-server" &&
    binding.externalThreadID === output.externalThreadID &&
    (output.status === "queued"
      ? output.execution === "queued" && output.externalTurnID === undefined
      : binding.externalTurnID === output.externalTurnID &&
        (!("execution" in output) || binding.execution === output.execution))
  )
}

const matchesPrompt = (binding: AcpPrompt | undefined, prompt: AcpPrompt) =>
  binding !== undefined &&
  binding.sessionID === prompt.sessionID &&
  binding.requestID === prompt.requestID &&
  binding.userMessageID === prompt.userMessageID &&
  binding.agentMessageIDs?.length === prompt.agentMessageIDs?.length &&
  (binding.agentMessageIDs?.every((id, index) => id === prompt.agentMessageIDs?.[index]) ?? true)

export const isBackgroundAck = (binding: Binding, call: SessionMessage.AssistantTool, output: Output) =>
  binding.background === true &&
  call.state.status === "completed" &&
  call.state.input.execution_type === "external-cli" &&
  call.state.input.background === true &&
  call.state.metadata?.status === output.status &&
  call.state.metadata.externalReceipt === undefined &&
  (output.status === "running" || output.status === "queued") &&
  matchesOutput(binding, output)

export const notificationID = (inputID: string, parentTaskID: string) =>
  SessionMessage.ID.make(
    `msg_task_${createHash("sha256")
      .update(JSON.stringify([inputID, parentTaskID]))
      .digest("hex")}`,
  )

/** Keep the persisted UTF-8 prefix and its receipt comparisons identical. */
export const outputDigest = (text: string) => text.slice(0, 4096).replace(/[\uD800-\uDBFF]$/, "")
