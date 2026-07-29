export * as ImportParserHandlers from "./import-parser"

import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ImportParser } from "@aigcfroge/core/import-parser"

export const importParserHandlers = HttpApiBuilder.group(InstanceHttpApi, "import-parser", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle("parse", (ctx: { payload: { content: string } }) =>
      ImportParser.Service.pipe(
        Effect.flatMap((svc) => svc.parse(ctx.payload.content)),
        Effect.provide(ImportParser.ImportParserLive),
      )
    )
  }),
)
