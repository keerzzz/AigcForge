export * as DelegationID from "./delegation-id.js"

import { Schema } from "effect"
import { descending } from "./identifier.js"
import { statics } from "./schema.js"

export const ID = Schema.String.check(
  Schema.isPattern(/^dlg_[A-Za-z0-9][A-Za-z0-9_-]*$/),
  Schema.isMaxLength(128),
).pipe(
  Schema.brand("DelegationID"),
  Schema.annotate({ identifier: "Delegation.ID" }),
  statics((schema) => {
    const create = () => schema.make("dlg_" + descending())
    return {
      create,
      descending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type ID = typeof ID.Type

export const ParticipantID = Schema.String.check(
  Schema.isPattern(/^par_[A-Za-z0-9][A-Za-z0-9_-]*$/),
  Schema.isMaxLength(128),
).pipe(
  Schema.brand("ParticipantID"),
  Schema.annotate({ identifier: "Delegation.ParticipantID" }),
  statics((schema) => {
    const create = () => schema.make("par_" + descending())
    return {
      create,
      descending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type ParticipantID = typeof ParticipantID.Type

export const TurnID = Schema.String.check(
  Schema.isPattern(/^trn_[A-Za-z0-9][A-Za-z0-9_-]*$/),
  Schema.isMaxLength(128),
).pipe(
  Schema.brand("TurnID"),
  Schema.annotate({ identifier: "Delegation.TurnID" }),
  statics((schema) => {
    const create = () => schema.make("trn_" + descending())
    return {
      create,
      descending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type TurnID = typeof TurnID.Type
