export * as DelegationID from "./delegation-id"

import { Schema } from "effect"
import { descending } from "./identifier"
import { withStatics } from "./schema"

export const ID = Schema.String.check(
  Schema.isPattern(/^dlg_[A-Za-z0-9][A-Za-z0-9_-]*$/),
  Schema.isMaxLength(128),
).pipe(
  Schema.brand("DelegationID"),
  withStatics((schema) => {
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
  withStatics((schema) => {
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
  withStatics((schema) => {
    const create = () => schema.make("trn_" + descending())
    return {
      create,
      descending: (id?: string) => (id === undefined ? create() : schema.make(id)),
    }
  }),
)
export type TurnID = typeof TurnID.Type
