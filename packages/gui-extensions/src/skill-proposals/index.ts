import { Schema } from "effect"
import { Extension, Store } from "../sdk"
import en from "./i18n/en"

/** The persisted assistant/tool selection used by response actions and the existing candidate list. */
export function candidateKey(messageID: string, toolID: string) {
  return messageID + ":" + toolID
}

export default Extension.define({
  id: "skill-proposals",
  stores: {
    responses: Store.session(
      Schema.Struct({
        targets: Schema.Record(
          Schema.String,
          Schema.Struct({ serverID: Schema.String, sessionID: Schema.String, candidateKey: Schema.String }),
        ),
      }),
      { targets: {} },
    ),
    display: Store.global(
      Schema.Struct({
        main: Schema.Boolean,
        commands: Schema.Boolean,
        prompts: Schema.Boolean,
        agents: Schema.Boolean,
        mcps: Schema.Boolean,
        plugins: Schema.Boolean,
        workflows: Schema.Boolean,
      }),
      { main: true, commands: true, prompts: true, agents: true, mcps: true, plugins: true, workflows: true },
    ),
  },
  i18n: { en, zh: () => import("./i18n/zh"), zht: () => import("./i18n/zht") },
})
