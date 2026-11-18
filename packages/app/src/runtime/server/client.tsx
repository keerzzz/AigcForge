import type { AigcForgeEvent } from "@aigcfroge/client/promise"
import { createClientConnection, createPtyClient, type ClientConnectionStatus } from "@aigcfroge/client/solid"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { type Accessor, batch, createEffect, createSignal, on, onCleanup } from "solid-js"
import { createApiForServer, type ServerApi } from "@/runtime/server/api"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "./registry"
import { createRefCountMap } from "@/runtime/server/refcount"
import { createRequestQueue } from "@/runtime/server/request-queue"
import { ServerScope } from "@/runtime/server/scope"
import { useServer } from "./current"

type AigcForgeEventMap = { [Type in AigcForgeEvent["type"]]: Extract<AigcForgeEvent, { type: Type }> }

export type AigcForgeEventStream = {
  on<Type extends AigcForgeEvent["type"]>(type: Type, handler: (event: AigcForgeEventMap[Type]) => void): VoidFunction
  listen(handler: (event: AigcForgeEvent) => void): VoidFunction
}

type AigcForgeEventSource = AigcForgeEventStream & {
  location(directory: string): AigcForgeEventStream
}

export function createAigcForgeEventSource() {
  const emitter = createGlobalEmitter<AigcForgeEventMap>()

  function stream(directory?: string): AigcForgeEventStream {
    return {
      on(type, handler) {
        return emitter.on(type, (event) => {
          if (directory !== undefined && event.location?.directory !== directory) return
          handler(event)
        })
      },
      listen(handler) {
        return emitter.listen((event) => {
          if (directory !== undefined && event.details.location?.directory !== directory) return
          handler(event.details)
        })
      },
    }
  }

  const event: AigcForgeEventSource = {
    ...stream(),
    location: (directory) => stream(directory),
  }

  onCleanup(() => emitter.clear())

  return {
    event,
    publish(event: AigcForgeEvent) {
      emitter.emit(event.type, event)
    },
  }
}

export type ServerConnectionStatus = ClientConnectionStatus

type ServerSDKBase = {
  server: ServerConnection.Any
  scope: ServerScope
  url: string
  api: ServerApi
  pty: ReturnType<typeof createPtyClient>
  connection: {
    status: Accessor<ServerConnectionStatus>
    attempt: Accessor<number>
    error: Accessor<string | undefined>
  }
  event: AigcForgeEventSource
}

function createServerSdkContextBase(server: ServerConnection.Any, scope: ServerScope): ServerSDKBase {
  const platform = usePlatform()
  const transport = createServerTransport({ http: server.http, fetch: platform.fetch })

  const events = createAigcForgeEventSource()
  const reconnect = server.type === "extension" || server.type === "sidecar" ? server.reconnect : undefined

  const connection = createClientConnection(transport.api, {
    reconnect: reconnect
      ? async (signal) => {
          const http = await reconnect(signal)
          signal.throwIfAborted()

          return transport.update(http)
        }
      : undefined,
    flushInterval: 16,
    pageLifecycle: true,
    onEvent(event) {
      events.publish(event)
    },
    log: {
      info(message, data) {
        if (message !== "event stream disconnected") return
        console.info("[global-sdk] event stream disconnected", { url: transport.url, managed: !!reconnect, ...data })
      },
    },
  })

  if (server.type === "extension") {
    createEffect(
      on(
        () => `${server.http.url}\0${server.http.password ?? ""}`,
        () => batch(() => connection.internal.replaceApi(transport.update(server.http))),
        { defer: true },
      ),
    )
  }

  return {
    server,
    scope,
    get url() {
      return transport.url
    },
    get api() {
      return transport.api
    },
    get pty() {
      return transport.pty
    },
    connection,
    event: events.event,
  }
}

type ServerTransport = Readonly<Pick<ServerSDKBase, "url" | "api" | "pty">> & {
  update(http: ServerConnection.HttpBase): ServerApi
}

export function createServerTransport(input: { http: ServerConnection.HttpBase; fetch?: Parameters<typeof createRequestQueue>[0]["fetch"] }): ServerTransport {
  const queue = createRequestQueue({ fetch: input.fetch ?? globalThis.fetch })

  const build = (http: ServerConnection.HttpBase) => {
    const api = createApiForServer({ server: http, fetch: queue.fetch })

    return { http, api, pty: createPtyClient(api, { url: http.url }) }
  }

  // Opaque clients keep their raw identity while their replacement remains observable.
  const [current, setCurrent] = createSignal(build(input.http))

  return {
    update(http: ServerConnection.HttpBase) {
      const next = build(http)
      setCurrent(next)

      return next.api
    },
    get url() {
      return current().http.url
    },
    get api() {
      return current().api
    },
    get pty() {
      return current().pty
    },
  }
}

export type ServerSDK = ServerSDKBase & {
  ensureDirSdkContext: (directory: string) => ReturnType<typeof createDirSdkContext>
}

export function createServerSdkContext(server: ServerConnection.Any, scope: ServerScope): ServerSDK {
  const sdk = createServerSdkContextBase(server, scope)

  return Object.assign(sdk, {
    ensureDirSdkContext: createRefCountMap((dir) => createDirSdkContext(dir, sdk)),
  })
}

export const useServerSDK = () => {
  const server = useServer()

  return server.ctx.sdk
}

export type LocationContext = {
  directory: string
  event: AigcForgeEventStream
}

function createDirSdkContext(directory: string, serverSDK: ServerSDKBase): LocationContext {
  return {
    directory,
    event: serverSDK.event.location(directory),
  }
}
