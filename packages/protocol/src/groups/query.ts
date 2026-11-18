import { Schema, SchemaGetter } from "effect"

/**
 * Query booleans travel as the strings "true"/"false" (fork-retained helper
 * from the instance API; used by groups that accept boolean query params).
 */
export const QueryBoolean = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value) => (value ? "true" : "false")),
  }),
)

export const QueryBooleanOpenApi = {
  anyOf: [{ type: "boolean" }, { type: "string", enum: ["true", "false"] }],
}
