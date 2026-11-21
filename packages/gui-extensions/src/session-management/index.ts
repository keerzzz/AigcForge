import { Schema } from "effect"
import { Extension, Store } from "../sdk"
import { ArtifactDraft, CollaborationDraft, MetaDraft, WorkflowDraft } from "./panel-drafts"
import en from "./i18n/en"

class Display extends Schema.Class<Display>("SessionManagement.Display")({
  collaborations: Schema.Boolean,
  subagents: Schema.Boolean,
  meta: Schema.Boolean,
  workflow: Schema.Boolean,
  artifacts: Schema.Boolean,
  composition: Schema.optional(Schema.Boolean),
}) {}

class SessionTarget extends Schema.Class<SessionTarget>("SessionManagement.SessionTarget")({
  serverID: Schema.String,
  sessionID: Schema.String,
  interaction: Schema.Literals(["interactive", "readonly"]),
}) {}

export default Extension.define({
  id: "session-management",
  stores: {
    // Storage edits plain JSON drafts; the classes remain the source of their field schemas.
    display: Store.global(Schema.Struct(Display.fields), {
      collaborations: true,
      subagents: true,
      meta: true,
      workflow: true,
      artifacts: true,
      composition: true,
    }),
    meta: Store.session(Schema.Struct(MetaDraft.fields), { keyword: "" }),
    collaboration: Store.session(Schema.Struct(CollaborationDraft.fields), {}),
    workflow: Store.session(Schema.Struct(WorkflowDraft.fields), {}),
    artifact: Store.session(Schema.Struct(ArtifactDraft.fields), {}),
    views: Store.session(
      Schema.Struct({
        targets: Schema.Array(Schema.Struct(SessionTarget.fields)),
        selected: Schema.optional(Schema.Struct({ serverID: Schema.String, sessionID: Schema.String })),
      }),
      {
        targets: [],
      },
    ),
  },
  i18n: { en, zh: () => import("./i18n/zh"), zht: () => import("./i18n/zht") },
})
