export * as ProductMode from "./product-mode"

import { Schema } from "effect"

export const ID = Schema.Literals(["chat", "coding", "work", "assistant", "custom"]).annotate({
  identifier: "ProductMode",
})
export type ID = typeof ID.Type

/** Whether a string is one of the product modes at all, as opposed to creatable. */
export const isID = Schema.is(ID)

export const Default = "coding" as const

/**
 * Whether each mode can be created through the ordinary "new session" path.
 *
 * One declaration, two guarantees. `satisfies Record<ID, boolean>` makes it total, so adding a
 * sixth mode to `ID` fails to compile until someone says whether it can be created generically
 * — which is the actual defect this replaces: `custom` cannot, and every one of the ~20 client
 * call sites assumed it could because the parameter was the full mode union.
 *
 * `as const` keeps the values literal so `GenericSessionMode` below is derived from the same
 * object rather than being a second list to keep in sync.
 */
const GENERIC_CREATION = {
  chat: true,
  coding: true,
  work: true,
  assistant: true,
  // Custom sessions are created atomically from a composition snapshot, not from an empty
  // draft. `core/product-mode-policy.assertCreationSupported` is where that is enforced.
  custom: false,
} as const satisfies Record<ID, boolean>

/**
 * The modes an ordinary session can be created in.
 *
 * This is the type clients narrow their "new session" parameters to, so passing a mode that
 * has no generic creation path stops compiling instead of failing on the first send.
 */
export type GenericSessionMode = { [M in ID]: (typeof GENERIC_CREATION)[M] extends true ? M : never }[ID]

export function isGenericSessionMode(mode: string): mode is GenericSessionMode {
  // Widened by assignment rather than asserted: the table is the authority on which keys
  // exist, and `hasOwn` keeps an inherited property from answering for a mode.
  const table: Readonly<Record<string, boolean>> = GENERIC_CREATION
  return Object.hasOwn(GENERIC_CREATION, mode) && table[mode] === true
}

/**
 * Client capability negotiation for custom mode. These live in `schema` rather
 * than `core/product-mode-policy` because the browser app has to send the header
 * too, and `core/product-mode-policy` transitively imports `core/flag/flag`,
 * which reads `process.env` while the module is evaluated.
 */
export const CAPABILITY_CUSTOM_V1 = "product-mode-custom-v1"
export const CAPABILITIES_HEADER = "x-aigcfroge-capabilities"
