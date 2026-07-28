type Definition = {
  [method: string]: (input: any) => any
}

export function listen(rpc: Definition) {
  self.onmessage = async (evt: MessageEvent) => {
    let parsed: any
    try {
      parsed = JSON.parse(evt.data)
    } catch {
      return
    }
    if (parsed.type === "rpc.request") {
      const handler = rpc[parsed.method]
      if (typeof handler !== "function") {
        postMessage(JSON.stringify({ type: "rpc.result", error: `Unknown method: ${parsed.method}`, id: parsed.id }))
        return
      }
      try {
        const result = await handler(parsed.input)
        postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
      } catch (error) {
        postMessage(JSON.stringify({ type: "rpc.result", error: String(error), id: parsed.id }))
      }
    }
  }
}

export function emit(event: string, data: unknown) {
  postMessage(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage: ((this: Worker, ev: MessageEvent) => any) | null
}) {
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: any) => void }>()
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  target.onmessage = async (evt) => {
    let parsed: any
    try {
      parsed = JSON.parse(evt.data)
    } catch {
      return
    }
    if (parsed.type === "rpc.result") {
      const entry = pending.get(parsed.id)
      if (entry) {
        if ("error" in parsed) entry.reject(new Error(parsed.error))
        else entry.resolve(parsed.result)
        pending.delete(parsed.id)
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(parsed.data)
          } catch { /* handler error does not affect other handlers */ }
        }
      }
    }
  }
  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
      })
    },
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- callers type event payloads without assertions
    on<E = unknown>(event: string, handler: (data: E) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }
}

export * as Rpc from "./rpc"
