export * as SessionSchema from "./schema"

import { Session } from "@aigcfroge/schema/session"

export const ID = Session.ID
export type ID = typeof ID.Type

export const Info = Session.Info
export type Info = Session.Info

export const Revert = Session.Revert
export type Revert = typeof Revert.Type

export const Summary = Session.Summary
export type Summary = typeof Summary.Type
