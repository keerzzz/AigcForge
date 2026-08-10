export * as ConfigMeta from "./meta"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Memory extends Schema.Class<Memory>("ConfigV2.Meta.Memory")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  top_n: PositiveInt.pipe(Schema.optional),
}) {}

export class DoomLoop extends Schema.Class<DoomLoop>("ConfigV2.Meta.DoomLoop")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  threshold: PositiveInt.pipe(Schema.optional),
}) {}

export class CorrectionStore extends Schema.Class<CorrectionStore>("ConfigV2.Meta.CorrectionStore")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  max_entries: PositiveInt.pipe(Schema.optional),
}) {}

export class ReferenceCheck extends Schema.Class<ReferenceCheck>("ConfigV2.Meta.ReferenceCheck")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  timeout_ms: PositiveInt.pipe(Schema.optional),
}) {}

export class Verifier extends Schema.Class<Verifier>("ConfigV2.Meta.Verifier")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  timeout_ms: PositiveInt.pipe(Schema.optional),
  max_consecutive_failures: PositiveInt.pipe(Schema.optional),
  escalation_enabled: Schema.Boolean.pipe(Schema.optional),
  escalation_threshold: PositiveInt.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Meta")({
  memory: Memory.pipe(Schema.optional),
  doom_loop: DoomLoop.pipe(Schema.optional),
  correction_store: CorrectionStore.pipe(Schema.optional),
  reference_check: ReferenceCheck.pipe(Schema.optional),
  verifier: Verifier.pipe(Schema.optional),
}) {}
