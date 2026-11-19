# @aigcfroge/client

Private generation target for clients derived directly from AigcForge's authoritative Effect `HttpApi`.

## Entrypoints

- `@aigcfroge/client`: zero-Effect Promise client using `fetch`.
- `@aigcfroge/client/effect`: rich Effect network client using an environment-provided `HttpClient`.

The generated surface includes every standard HTTP group from Server's concrete API. The build compiler reads `@aigcfroge/server/api`; the generated Effect runtime imports a client-local projection built from Protocol, with a generation-equivalence test preventing transport drift. Custom transports such as the PTY WebSocket connection remain outside the generic HTTP client. Run `bun run generate` after changing the contract and `bun run check:generated` to detect committed-output drift.

The Effect entrypoint uses canonical decoded values such as `Session.ID`, `Location.Ref`, and `Prompt`. These datatypes come from the lightweight `@aigcfroge/schema` package and are re-exported so callers depend only on the client surface. Protocol owns endpoint construction and middleware placement; Server supplies the concrete middleware keys used by the build-time API.

The Promise root remains structural and has no Core or Effect runtime dependency. `/effect` depends only on Effect, Schema, and Protocol and is browser-bundle safe. Bundle-boundary tests enforce both import graphs.

Effect consumers construct canonical decoded inputs:

```ts
import { AbsolutePath, Location, AigcForge, Prompt } from "@aigcfroge/client/effect"

const client = yield * AigcForge.make({ baseUrl: "https://aigcfroge.example" })
yield *
  client.sessions.create({
    location: Location.Ref.make({ directory: AbsolutePath.make("/workspace") }),
  })
yield * client.sessions.prompt({ sessionID, prompt: Prompt.make({ text: "Hello" }) })
```

## Authored provider definitions in Solid Data

`data.location.provider` continues to cache the executable provider catalog.
Its `definition` resource reads the authored layers and their writable targets,
including disabled providers and pending adoptions:

```ts
await data.location.provider.definition.sync(location)
const definitions = data.location.provider.definition.list(location)?.definitions
```

The collection carries target paths and digests for conditional edits, source
layers, safe connection metadata, and the current adoption stage. Stored secrets
are omitted with `redactedPaths`; an editor preserves those paths until the user
explicitly replaces or removes them.

Definition reads are opt-in. Configuration and credential events invalidate the
resource and refresh it when an owner has already loaded it. Location invalidation
and reconnection preserve the existing value until the next successful read.
Mutations use the generated `provider.definition.save` and `remove` APIs, then
invalidate the definition and executable catalog resources for their Location.

## Provider directory snapshots in Solid Data

The `discovery` resource reads a saved provider's directory snapshot and fetch
diagnostics. Each provider and explicit credential or environment connection has
its own entry within a Location:

```ts
await data.location.provider.discovery.sync(providerID, connection, location)
const directory = data.location.provider.discovery.get(providerID, connection, location)
```

Omitting `connection` reads the current active connection. `sync` calls the
read-only `provider.discovery.get` API. Fetching an upstream list is an explicit
`provider.discovery.refresh` or draft `preview` operation. Import selected
candidates through `provider.definition.save`; `managedRefs` identifies local
aliases that already use the same API model ID.

`provider.discovery.updated` refreshes observed entries even when the successful
inventory digest is unchanged, so a new failure remains visible beside the last
successful list. Config, integration and credential changes invalidate observed
reads. Reconnection and server replacement revoke pending publication; an older
response cannot replace its queued successor.
