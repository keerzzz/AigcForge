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

export class Info extends Schema.Class<Info>("ConfigV2.Meta")({
  memory: Memory.pipe(Schema.optional),
  doom_loop: DoomLoop.pipe(Schema.optional),
  correction_store: CorrectionStore.pipe(Schema.optional),
}) {}
