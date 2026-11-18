export * as ConfigConsoleStateV1 from "./console-state.js"

import { Schema } from "effect"
import { optional, NonNegativeInt } from "../../schema.js"

export class ConsoleState extends Schema.Class<ConsoleState>("ConsoleState")({
  consoleManagedProviders: Schema.Array(Schema.String),
  activeOrgName: optional(Schema.String),
  switchableOrgCount: NonNegativeInt,
}) {}

export const emptyConsoleState: ConsoleState = ConsoleState.make({
  consoleManagedProviders: [],
  activeOrgName: undefined,
  switchableOrgCount: 0,
})
