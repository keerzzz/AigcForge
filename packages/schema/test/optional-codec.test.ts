import { expect, test } from "bun:test"
import { Schema } from "effect"
import { optionalOmitUndefined } from "../src/schema"

class Value extends Schema.Class<Value>("OptionalCodecTest.Value")({ name: Schema.String }) {}
const optional = Schema.Struct({ value: optionalOmitUndefined(Value) })

test("optionalOmitUndefined applies a class codec only once when encoding", () => {
  const decoded = Schema.decodeUnknownSync(optional)({ value: { name: "real" } })
  expect(decoded.value).toBeInstanceOf(Value)
  expect(Schema.encodeSync(optional)(decoded)).toEqual({ value: { name: "real" } })
})

test("optionalOmitUndefined drops undefined and retains a truly missing field", () => {
  expect(Schema.encodeSync(optional)({ value: undefined })).toEqual({})
  expect(Schema.encodeSync(optional)(Schema.decodeUnknownSync(optional)({}))).toEqual({})
})
