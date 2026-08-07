export * as ConfigCliAgent from "./cli-agent"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export const OutputType = Schema.Literals(["claude-jsonl", "codex-jsonl", "plain"])
export type OutputType = typeof OutputType.Type

export const Transport = Schema.Literals(["jsonl", "sdk", "acp"])
export type Transport = typeof Transport.Type

export class Info extends Schema.Class<Info>("ConfigV2.CliAgent")({
  command: Schema.String.annotate({
    description: "Executable name or absolute path of the CLI.",
  }),
  description: Schema.String.pipe(Schema.optional).annotate({
    description: "Human-readable label shown in the agent list and permission prompts.",
  }),
  args: Schema.Array(Schema.String).pipe(Schema.optional).annotate({
    description:
      "Static argv prefix. `{prompt}` and `{resumeId}` placeholders are interpolated before spawning.",
  }),
  output: OutputType.pipe(Schema.optional).annotate({
    description: "Stdout parsing strategy: claude-jsonl, codex-jsonl, or plain (default).",
  }),
  transport: Transport.pipe(Schema.optional).annotate({
    description: "Execution transport: jsonl (spawn + parse, default), sdk (official SDK), or acp.",
  }),
  timeout: PositiveInt.pipe(Schema.optional).annotate({
    description: "Execution timeout in milliseconds.",
  }),
}) {}
