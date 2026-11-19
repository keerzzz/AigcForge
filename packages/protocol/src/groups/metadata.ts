import { Schema } from "effect"
import { OpenApi } from "effect/http-api"

/** Attach a description annotation to a schema value without extra ceremony. */
export function described<S extends Schema.Top>(schema: S, description: string): S {
  return schema.annotate({ description }) as S
}

/** Override the 200 response description in the generated OpenAPI document. */
export function responseDescription(description: string) {
  return OpenApi.annotations({
    transform: (operation) => {
      const response = operation.responses?.["200"]
      if (response && typeof response === "object" && "description" in response) {
        response.description = description
      }
      return operation
    },
  })
}
