export * as ConfigSkillsV1 from "./skills.js"

import { Schema } from "effect"
import { optional } from "../../schema.js"

export const Info = Schema.Struct({
  paths: optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to skill folders",
  }),
  urls: optional(Schema.Array(Schema.String)).annotate({
    description: "URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
