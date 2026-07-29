import { Schema } from "effect"

export class ScanResult extends Schema.Class<ScanResult>("CredentialScan.ScanResult")({
  hits: Schema.Array(
    Schema.Struct({
      type: Schema.Literals(["api_key", "bearer_token", "private_key", "env_line"]),
      lineIndex: Schema.Number,
      positionHint: Schema.String,
    }),
  ),
  stripped: Schema.String,
}) {}

export * as CredentialScan from "./credential-scan"
