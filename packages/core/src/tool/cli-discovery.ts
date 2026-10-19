import { Effect, Schema } from "effect"
import { CliAdapter } from "./cli-adapter"
import { which } from "../util/which"

export class Info extends Schema.Class<Info>("CliAgentDiscovery")({
  name: Schema.String,
  command: Schema.String,
  description: Schema.String,
  available: Schema.Boolean,
  // JSON codecs turn an explicit undefined into null; absent paths must be omitted.
  path: Schema.optionalKey(Schema.String),
}) {}

/** Read-only discovery: no SDK initialization, CLI execution, installation, or login. */
export const list = Effect.fn("CliDiscovery.list")(
  (adapters: readonly CliAdapter.CliAdapter[] = CliAdapter.listCliAdapters()) =>
    Effect.sync(() =>
      adapters.map((adapter) => {
        const executable = which(adapter.command)
        return new Info({
          name: adapter.name,
          command: adapter.command,
          description: adapter.description,
          available: executable !== null,
          ...(executable === null ? {} : { path: executable }),
        })
      }),
    ),
)

export * as CliDiscovery from "./cli-discovery"
