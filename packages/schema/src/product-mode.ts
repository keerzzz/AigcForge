export * as ProductMode from "./product-mode"

import { Schema } from "effect"

export const ID = Schema.Literals(["chat", "coding", "work", "assistant"]).annotate({
  identifier: "ProductMode",
})
export type ID = typeof ID.Type

export const Default = "coding" as const
