import { ModelsDev } from "@omnixa/core/models-dev"
import { Effect } from "effect"
import { Plugin } from "@omnixa/core/plugin"
import { Provider } from "@omnixa/core/provider"
import { Bus } from "@omnixa/core/bus"
import { Project } from "@omnixa/core/project"
import { Session } from "@omnixa/core/session"
import { SessionEvent } from "@omnixa/core/session/event"

// Core is env-free, so the default ModelsDev node refreshes from models.dev
// unless the graph says otherwise. Real-Location fixtures opt out here; the
// test harness refuses any request that slips past.
export const offlineModels = ModelsDev.node.replace(ModelsDev.configured({ fetch: false }))

// Historical tool/recovery keepers seed the durable legacy admission contract.
// New CPU admission is exercised by the real CPU integration graph separately.
export const createLegacySession = Effect.fn("Keeper.createLegacySession")(function* (
  input: Parameters<Session.Interface["create"]>[0],
) {
  const sessions = yield* Session.Service
  if (input.parentID) return yield* sessions.create(input)
  if (!input.location) return yield* Effect.die(new Error("Legacy root requires a location"))
  const projects = yield* Project.Service
  const bus = yield* Bus.Service
  const project = yield* projects.resolve(input.location.directory)
  const sessionID = input.id ?? Session.ID.create()
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID: project.id,
    slug: sessionID,
    version: "keeper",
    location: input.location,
    title: input.title,
    mode: input.mode,
    agent: input.agent,
    model: input.model,
    metadata: input.metadata,
    permissions: input.permissions,
  })
  const session = yield* sessions.get(sessionID)
  if (session.controller) return yield* Effect.die(new Error("Legacy fixture has a controller"))
  return session
})

export const useOfflineCatalog = (definitions: readonly Parameters<Provider.Editor["add"]>[0][]) =>
  Effect.gen(function* () {
    yield* Plugin.awaitActivation
    const providers = yield* Provider.Service
    yield* providers.transform((editor) => {
      editor.list().forEach((entry) => editor.remove(entry.provider.id))
      definitions.forEach((definition) => editor.add(definition))
    })
  })
