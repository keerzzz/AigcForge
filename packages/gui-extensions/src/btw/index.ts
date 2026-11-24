import { Schema } from "effect"
import { SessionConsultation } from "@omnixa/schema/session-consultation"
import { SessionFork } from "@omnixa/schema/session-fork"
import { Location } from "@omnixa/schema/location"
import { Model } from "@omnixa/schema/model"
import { PromptInput } from "@omnixa/schema/prompt-input"
import { Extension, Store } from "../sdk"
import en from "./i18n/en"
import zh from "./i18n/zh"

const Chats = Schema.Struct({
  chats: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      question: Schema.String,
      answer: Schema.optional(Schema.String),
      intent: Schema.optional(
        Schema.Struct({
          serverID: Schema.String,
          sessionID: Schema.String,
          boundary: Schema.optional(Schema.toEncoded(SessionFork.Boundary)),
          location: Schema.optional(Schema.toEncoded(Location.Ref)),
          targetID: Schema.String,
          firstID: Schema.String,
        }),
      ),
      request: Schema.optional(
        Schema.Union([
          Schema.Struct({
            kind: Schema.Literal("consultation"),
            input: Schema.toEncoded(
              Schema.Struct({
                ...SessionConsultation.Input.fields,
                prompt: Schema.Struct({
                  id: SessionConsultation.Prompt.fields.id,
                  ...PromptInput.Prompt.fields,
                  delivery: SessionConsultation.Prompt.fields.delivery,
                }),
              }),
            ),
          }),
          Schema.Struct({
            kind: Schema.Literal("legacy"),
            input: Schema.Struct({
              agent: Schema.String,
              model: Schema.optional(Schema.toEncoded(Model.Selection)),
              location: Schema.toEncoded(Location.Ref),
              prompt: Schema.toEncoded(PromptInput.Prompt),
            }),
          }),
        ]),
      ),
      error: Schema.optional(Schema.String),
      legacyID: Schema.optional(Schema.String),
      admitted: Schema.optional(Schema.Boolean),
      attempted: Schema.optional(Schema.Boolean),
      seen: Schema.optional(Schema.Finite),
      read: Schema.optional(
        Schema.Struct({ messageID: Schema.String, length: Schema.Finite, completed: Schema.Boolean }),
      ),
    }),
  ),
})

export type BtwChat = (typeof Chats.Type.chats)[number]

export default Extension.define({
  id: "btw",
  stores: {
    // Source-owned view bindings survive closing a tab. Legacy question/answer values remain readable.
    chats: Store.session(Chats, { chats: [] }),
  },
  i18n: { en, zh },
})
