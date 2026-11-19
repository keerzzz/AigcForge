export * as ImportParser from "./import-parser.js"

import { Schema } from "effect"

const Name = Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(80)))

const Description = Schema.String.pipe(Schema.check(Schema.isMaxLength(300)))

const Template = Schema.String.pipe(Schema.check(Schema.isMaxLength(100_000)), Schema.check(Schema.isMinLength(1)))

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
