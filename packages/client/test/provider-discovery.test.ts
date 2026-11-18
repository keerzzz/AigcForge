import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { AigcForge, type AigcForgeEvent } from "../src/promise"

const location = { directory: "/project" }
const account = { type: "credential", id: "cred_directory" } as const
const environment = { type: "env", name: "DIRECTORY_KEY" } as const

function directory(phase: "ready" | "failed", generation: number) {
  return {
    status: {
      providerID: "custom",
      phase,
      generation,
      cachePersisted: true,
      lastSuccessAt: 1,
      ...(phase === "failed" ? { error: { kind: "network", message: "Directory unavailable" } } : {}),
    },
    inventory: {
      identity: {
        providerID: "custom",
        listURL: "https://directory.example/v1/models",
        protocol: "openai",
        auth: "bearer",
        configurationDigest: "a".repeat(64),
      },
      complete: true,
      digest: "b".repeat(64),
      observedAt: 1,
      models: [],
    },
    candidates: [],
    managed: [],
  }
}

function fixture(fetch: (request: Request) => Promise<Response>) {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const owner = { api: AigcForge.make({ baseUrl: "http://aigcfroge.local", fetch: (input, init) => fetch(new Request(input, init)) }) }
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => owner.api,
      directory: location.directory,
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  return {
    ...setup,
    owner,
    emit(event: AigcForgeEvent) {
      listeners.forEach((listener) => listener({ name: event.type, details: event }))
    },
  }
}

test("directory diagnostics refresh observed connections in both windows without changing the inventory", async () => {
  const requests: string[] = []
  const state = { phase: "ready" as "ready" | "failed", generation: 1 }
  const fetch = async (request: Request) => {
    const url = new URL(request.url)
    expect(url.pathname).toBe("/api/provider/discovery")
    expect(url.searchParams.get("providerID")).toBe("custom")
    requests.push(url.searchParams.get("connection[id]") ?? url.searchParams.get("connection[name]") ?? "active")
    return Response.json({ location, data: directory(state.phase, state.generation) })
  }
  const windows = [fixture(fetch), fixture(fetch)]
  const event: AigcForgeEvent = {
    id: "evt_directory",
    created: 2,
    type: "provider.discovery.updated",
    location,
    data: { providerID: "custom", connection: account },
  }
  try {
    windows.forEach((window) => window.emit(event))
    expect(requests).toEqual([])
    await Promise.all(windows.flatMap((window) => [
      window.data.location.provider.discovery.sync("custom"),
      window.data.location.provider.discovery.sync("custom", account),
      window.data.location.provider.discovery.sync("custom", environment),
    ]))
    expect(requests.filter((value) => value === "active")).toHaveLength(2)
    expect(requests.filter((value) => value === account.id)).toHaveLength(2)
    expect(requests.filter((value) => value === environment.name)).toHaveLength(2)
    state.phase = "failed"
    state.generation = 2
    windows.forEach((window) => window.emit(event))
    await Promise.all(windows.flatMap((window) => [
      window.data.location.provider.discovery.sync("custom"),
      window.data.location.provider.discovery.sync("custom", account),
    ]))
    expect(requests.filter((value) => value === "active")).toHaveLength(4)
    expect(requests.filter((value) => value === account.id)).toHaveLength(4)
    expect(requests.filter((value) => value === environment.name)).toHaveLength(2)
    windows.forEach((window) => {
      const value = window.data.location.provider.discovery.get("custom", account)
      expect(value?.status).toMatchObject({ phase: "failed", generation: 2, error: { kind: "network" } })
      expect(value?.inventory?.digest).toBe("b".repeat(64))
      expect(window.data.location.provider.discovery.get("custom", environment)?.status.generation).toBe(1)
    })
  } finally {
    windows.forEach((window) => window.dispose())
  }
})

test("an invalidated directory read cannot replace its queued response", async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  let requests = 0
  const setup = fixture(async () => {
    requests++
    if (requests > 1) return Response.json({ location, data: directory("failed", 2) })
    started.resolve()
    return release.promise
  })
  try {
    const before = setup.data.location.provider.discovery.sync("custom", account)
    await started.promise
    setup.data.location.provider.discovery.invalidate("custom", account)
    const after = setup.data.location.provider.discovery.sync("custom", account)
    release.resolve(Response.json({ location, data: directory("ready", 1) }))
    await Promise.all([before, after])
    expect(requests).toBe(2)
    expect(setup.data.location.provider.discovery.get("custom", account)?.status).toMatchObject({ phase: "failed", generation: 2 })
  } finally {
    release.resolve(Response.json({ location, data: directory("ready", 1) }))
    setup.dispose()
  }
})

test("replacing the server hides old directory data and rejects its pending publication", async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<Response>()
  const replacementStarted = Promise.withResolvers<void>()
  const replacementRelease = Promise.withResolvers<Response>()
  let requests = 0
  const setup = fixture(async () => {
    requests++
    if (requests === 1) return Response.json({ location, data: directory("ready", 1) })
    started.resolve()
    return release.promise
  })
  try {
    await setup.data.location.provider.discovery.sync("custom", account)
    setup.data.location.provider.discovery.invalidate("custom", account)
    const before = setup.data.location.provider.discovery.sync("custom", account)
    await started.promise
    setup.owner.api = AigcForge.make({
      baseUrl: "http://replacement.local",
      fetch: async () => {
        replacementStarted.resolve()
        return replacementRelease.promise
      },
    })
    expect(setup.data.location.provider.discovery.get("custom", account)).toBeUndefined()
    const after = setup.data.location.provider.discovery.sync("custom", account)
    await replacementStarted.promise
    expect(setup.data.location.provider.discovery.get("custom", account)).toBeUndefined()
    release.resolve(Response.json({ location, data: directory("ready", 1) }))
    replacementRelease.resolve(Response.json({ location, data: directory("failed", 3) }))
    await Promise.all([before, after])
    expect(setup.data.location.provider.discovery.get("custom", account)?.status.generation).toBe(3)
  } finally {
    release.resolve(Response.json({ location, data: directory("ready", 1) }))
    replacementRelease.resolve(Response.json({ location, data: directory("failed", 3) }))
    setup.dispose()
  }
})
