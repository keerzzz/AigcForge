export * as WorkPresetTool from "./work-preset"

import { Effect } from "effect"
import { WorkPresetRegistry } from "@aigcfroge/core/session/work-preset"
import { WorkPresetTool as WorkPresetToolV2 } from "@aigcfroge/core/tool/work-preset"
import { define } from "./tool"

type Metadata = {
  presetID: string
  found: boolean
}

export const WorkPresetV1 = define<typeof WorkPresetToolV2.Input, Metadata, never>(
  "work-preset",
  Effect.succeed({
    description: WorkPresetToolV2.description,
    parameters: WorkPresetToolV2.Input,
    execute: (params) =>
      Effect.gen(function* () {
        const preset = WorkPresetRegistry.byId(params.presetID)
        if (!preset) {
          return {
            title: "Load work preset",
            metadata: { presetID: params.presetID, found: false },
            output: `Unknown work preset: ${params.presetID}`,
          }
        }
        const [part] = WorkPresetToolV2.toModelOutput({ output: { preset } })
        return {
          title: `Load work preset: ${preset.title}`,
          metadata: { presetID: params.presetID, found: true },
          output: part.text,
        }
      }).pipe(Effect.orDie),
  }),
)
