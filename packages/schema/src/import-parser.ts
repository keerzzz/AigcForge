export * as ImportParser from "./import-parser"

import { Schema } from "effect"

const Name = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => Array.from(input).length >= 1, { message: "Name must be at least 1 code point" })),
  Schema.check(Schema.makeFilter<string>((input) => Array.from(input).length <= 80, { message: "Name must be at most 80 code points" })),
)

const Description = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => Array.from(input).length <= 300, { message: "Description must be at most 300 code points" })),
)

const Template = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => new TextEncoder().encode(input).length <= 100_000, { message: "Template must be at most 100,000 UTF-8 bytes" })),
  Schema.check(Schema.makeFilter<string>((input) => input.length >= 1, { message: "Template must be at least 1 character" })),
)

export class Candidate extends Schema.Class<Candidate>("ImportParser.Candidate")({
  kind: Schema.String,
  name: Name,
  description: Description,
  template: Template,
}) {}

export class ParseError extends Schema.Class<ParseError>("ImportParser.ParseError")({
  section: Schema.String,
  reason: Schema.String,
}) {}

export class Result extends Schema.Class<Result>("ImportParser.Result")({
  candidates: Schema.Array(Candidate),
  warnings: Schema.Array(Schema.String),
  errors: Schema.Array(ParseError),
}) {}
