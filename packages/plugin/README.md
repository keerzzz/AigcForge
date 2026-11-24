# `@omnixa/plugin`

Authoring interfaces and runtime loader support for Omnixa V2 plugins:

- `@omnixa/plugin` — [Promise plugin API](./src/README.md)
- `@omnixa/plugin/effect` — [Effect plugin API](./src/effect/README.md)
- `@omnixa/plugin/rpc` — portable RPC contract definitions
- `@omnixa/plugin/tui` — terminal UI plugin API

## Authored Provider Definitions

The provider domain exposes `definition.get`, `definition.save`, and
`definition.remove` alongside executable catalog reads and transforms. These
methods use the same contracts as the generated Client API, including explicit
Location and configuration targets, expected file revisions, and stable save
submission IDs. Their results separate definition, credential, and catalog
adoption states. They manage authored configuration through the existing owners;
provider transforms continue to contribute derived runtime catalog entries.

Use the returned targets and safe connection references when editing. Preserve
redacted fields unless the user explicitly replaces or removes them. A completed
save retains its safe receipt for exact retries; creating another account requires
a new submission ID.

The same domain also exposes `discovery.get`, `discovery.preview`, and
`discovery.refresh` through the generated API contracts. `get` reads a saved
connection's inventory and diagnostics; `preview` fetches a draft without
changing configuration, credentials, or registered models. `refresh` fetches a
saved provider's active or explicit connection. Select candidates and persist
their identity-bound seeds through `definition.save`.

Effect hosts resolve these operations in the requested Location through the
existing Location service map. The Promise adapter uses the same Protocol
descriptors, including connection queries and cancellation options.

## Packaging And Runtime `effect`

When the Omnixa CLI loads server or TUI plugins, it resolves imports of `effect`, exported `effect/*` subpaths, and `@omnixa/plugin` entrypoints (including imports from dependencies inside a plugin's `node_modules`) to the host's runtime module instances so fibers, loggers, and `Schema` parsers share one copy.

- Declare `"effect": "^4.0.0"` as a `peerDependency` (and `devDependency` for local type-checking and testing) rather than a bundled runtime dependency.
- Do not bundle `effect` into published plugin files; if you build with a bundler, keep `effect` and `effect/*` external. Two copies of `effect` do not share fiber, logger, or `Schema` internals.
- Plugins and their `node_modules` dependencies always receive Omnixa's host `effect` instance. Use `effect` APIs and module paths compatible with the Omnixa release you target; dependencies built on another `effect` major (such as Effect 3) are not supported.
- Only public `effect` subpaths are provided. A plugin that imports one of Effect's private `internal` modules fails to load with an error naming the path.
- The compiled Omnixa binary does not include the Scalar and Swagger UI assets used by Effect's HTTP API docs pages; serving those pages from a plugin shows a notice instead.
