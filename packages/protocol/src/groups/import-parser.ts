import { ImportParser } from "@aigcfroge/schema/import-parser"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Authorization } from "../middleware/authorization.js"
import { described } from "./metadata.js"

// Fork-retained cross-tool import surface: unlike the instance-scoped groups,
// parsing is stateless and only requires Authorization (fork shape).
export const ImportParserGroup = HttpApiGroup.make("import-parser")
  .add(
    HttpApiEndpoint.post("import-parser.parse", "/import-asset/parse", {
      payload: Schema.Struct({ content: Schema.String }),
      success: described(ImportParser.Result, "Parsed import candidates"),
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
  )
  .middleware(Authorization)
