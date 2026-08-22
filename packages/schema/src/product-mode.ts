export * as ProductMode from "./product-mode"

import { Schema } from "effect"

export const ID = Schema.Literals(["chat", "coding", "work", "assistant", "custom"]).annotate({
  identifier: "ProductMode",
})
export type ID = typeof ID.Type

export const Default = "coding" as const

/**
 * Client capability negotiation for custom mode. These live in `schema` rather
 * than `core/product-mode-policy` because the browser app has to send the header
 * too, and `core/product-mode-policy` transitively imports `core/flag/flag`,
 * which reads `process.env` while the module is evaluated.
 */
export const CAPABILITY_CUSTOM_V1 = "product-mode-custom-v1"
export const CAPABILITIES_HEADER = "x-aigcfroge-capabilities"
