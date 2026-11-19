import { NonNegativeInt } from "@aigcfroge/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ApiNotFoundError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import {
  InstanceContext,
  WorkspaceRouting,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
export const FileQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
}).annotate({ identifier: "File.Query" })

export const FindTextQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  pattern: Schema.String,
}).annotate({ identifier: "Find.TextQuery" })

export const FindFileQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  query: Schema.String,
  dirs: Schema.optional(Schema.Literals(["true", "false"])),
  type: Schema.optional(Schema.Literals(["file", "directory"])),
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200)),
  ),
}).annotate({ identifier: "Find.FileQuery" })

export const FindSymbolQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  query: Schema.String,
}).annotate({ identifier: "Find.SymbolQuery" })

export const LegacyMatch = Schema.Struct({
  path: Schema.Struct({ text: Schema.String }),
  lines: Schema.Struct({ text: Schema.String }),
  line_number: NonNegativeInt,
  absolute_offset: NonNegativeInt,
  submatches: Schema.Array(
    Schema.Struct({
      match: Schema.Struct({ text: Schema.String }),
      start: NonNegativeInt,
      end: NonNegativeInt,
    }),
  ),
}).annotate({ identifier: "Find.Match" })

export const LegacyEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  absolute: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  ignored: Schema.Boolean,
}).annotate({ identifier: "File.Node" })

export const LegacyContent = Schema.Struct({
  type: Schema.Literals(["text", "binary"]),
  content: Schema.String,
  diff: Schema.optional(Schema.String),
  patch: Schema.optional(
    Schema.Struct({
      oldFileName: Schema.String,
      newFileName: Schema.String,
      oldHeader: Schema.optional(Schema.String),
      newHeader: Schema.optional(Schema.String),
      hunks: Schema.Array(
        Schema.Struct({
          oldStart: NonNegativeInt,
          oldLines: NonNegativeInt,
          newStart: NonNegativeInt,
          newLines: NonNegativeInt,
          lines: Schema.Array(Schema.String),
        }),
      ),
      index: Schema.optional(Schema.String),
    }),
  ),
  encoding: Schema.optional(Schema.Literal("base64")),
  mimeType: Schema.optional(Schema.String),
}).annotate({ identifier: "File.Content" })

export const LegacyStatus = Schema.Struct({
  path: Schema.String,
  added: NonNegativeInt,
  removed: NonNegativeInt,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "File.Status" })

/** Lifted from the fork entry LSP service: workspace symbol wire shape. */
const LSPPosition = Schema.Struct({
  line: NonNegativeInt,
  character: NonNegativeInt,
}).annotate({ identifier: "LSP.Position" })

const LSPRange = Schema.Struct({
  start: LSPPosition,
  end: LSPPosition,
}).annotate({ identifier: "LSP.Range" })

export const LSPSymbol = Schema.Struct({
  name: Schema.String,
  kind: NonNegativeInt,
  location: Schema.Struct({
    uri: Schema.String,
    range: LSPRange,
  }),
}).annotate({ identifier: "LSP.Symbol" })

export const FileGroup = HttpApiGroup.make("file-instance")
  .add(
    HttpApiEndpoint.get("file.findText", "/find", {
      query: FindTextQuery,
      success: described(Schema.Array(LegacyMatch), "Matches"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "find.text",
        summary: "Find text",
        description: "Search for text patterns across files in the project using ripgrep.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("file.findFile", "/find/file", {
      query: FindFileQuery,
      success: described(Schema.Array(Schema.String), "File paths"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "find.files",
        summary: "Find files",
        description: "Search for files or directories by name or pattern in the project directory.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("file.findSymbol", "/find/symbol", {
      query: FindSymbolQuery,
      success: described(Schema.Array(LSPSymbol), "Symbols"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "find.symbols",
        summary: "Find symbols",
        description: "Search for workspace symbols like functions, classes, and variables using LSP.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("file.list", "/file", {
      query: FileQuery,
      success: described(Schema.Array(LegacyEntry), "Files and directories"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "file.list",
        summary: "List files",
        description: "List files and directories in a specified path.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("file.content", "/file/content", {
      query: FileQuery,
      success: described(LegacyContent, "File content"),
      // Missing/unreadable file is a typed 404 (S6 debt closure).
      error: [ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "file.read",
        summary: "Read file",
        description: "Read the content of a specified file.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("file.status", "/file/status", {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(LegacyStatus), "File status"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "file.status",
        summary: "Get file status",
        description: "Get the git status of all files in the project.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "file",
      description: "Experimental HttpApi file routes.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
