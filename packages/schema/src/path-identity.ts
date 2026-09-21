export * as PathIdentity from "./path-identity"

import { Schema } from "effect"
import { AbsolutePath } from "./schema"

/** One local path reference. The server that receives it owns interpretation. */
export class Ref extends Schema.Class<Ref>("PathIdentity.Ref")({
  path: AbsolutePath,
}) {}

/** The exact pair compared by the resolver, preserved in a proved result. */
export class CompareInput extends Schema.Class<CompareInput>("PathIdentity.CompareInput")({
  left: Ref,
  right: Ref,
}) {}

/** Stable protocol reasons. Addition is compatible; renaming is a protocol break. */
export const UnknownReason = Schema.Literals([
  "no-local-proof",
  "stat-unavailable",
  "inode-unavailable",
  "not-same-realpath",
  "recorded-relation-unverified",
]).annotate({ identifier: "PathIdentity.UnknownReason" })
export type UnknownReason = typeof UnknownReason.Type

export class RealPathEvidence extends Schema.Class<RealPathEvidence>("PathIdentity.RealPathEvidence")({
  method: Schema.Literal("realpath"),
  path: AbsolutePath,
}) {}

export class DeviceInodeEvidence extends Schema.Class<DeviceInodeEvidence>("PathIdentity.DeviceInodeEvidence")({
  method: Schema.Literal("device-inode"),
  device: Schema.Number,
  inode: Schema.Number,
}) {}

export const Evidence = Schema.Union([RealPathEvidence, DeviceInodeEvidence]).annotate({
  identifier: "PathIdentity.Evidence",
})
export type Evidence = typeof Evidence.Type

export class Same extends Schema.Class<Same>("PathIdentity.Same")({
  status: Schema.Literal("same"),
  refs: CompareInput,
  evidence: Evidence,
}) {}

export class Unknown extends Schema.Class<Unknown>("PathIdentity.Unknown")({
  status: Schema.Literal("unknown"),
  reason: UnknownReason,
}) {}

/** A comparison can prove sameness or admit insufficient proof. It never claims difference. */
export const Result = Schema.Union([Same, Unknown]).annotate({ identifier: "PathIdentity.Result" })
export type Result = typeof Result.Type
