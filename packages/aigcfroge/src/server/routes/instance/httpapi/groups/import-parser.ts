export * as ImportParserApiGroup from "./import-parser"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ImportParser as SchemaImportParser } from "@aigcfroge/schema/import-parser"
import { described } from "./metadata"

export const ImportParserApi = HttpApi.make("import-parser").add(
  HttpApiGroup.make("import-parser")
    .add(
      HttpApiEndpoint.post("parse", "/import-asset/parse", {
        payload: Schema.Struct({ content: Schema.String }),
        success: described(SchemaImportParser.Result, "Parsed import candidates"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "import-parser.parse",
          summary: "Parse raw text into asset candidates",
          description: "Parse raw import text using the deterministic Core ImportParser service.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "import-parser",
        description: "Import parsing endpoint for asset creation.",
      }),
    ),
)
