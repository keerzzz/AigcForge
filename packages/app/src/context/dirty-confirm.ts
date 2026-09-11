/**
 * Serializes "leave a dirty tab?" confirmations behind a single presenter.
 *
 * The close transaction and the route guard both ask the same question for the same
 * tab key, so the queue enforces:
 *
 * - at most one request per key: every concurrent caller shares one promise;
 * - one presenter at a time, different keys FIFO — a confirmation dialog is never
 *   replaced by another confirmation;
 * - exactly one settlement per request; the presenter decides true (leave) / false
 *   (stay, cancel, dialog replaced, presenter torn down).
 */

type Request = {
  key: string
  promise: Promise<boolean>
  resolve: (value: boolean) => void
}

export type DirtyConfirmQueue = {
  confirm: (key: string) => Promise<boolean>
  dispose: () => void
  pending: () => number
}

export function createDirtyConfirmQueue(present: (key: string) => Promise<boolean>): DirtyConfirmQueue {
  const queued: Request[] = []
  const byKey = new Map<string, Request>()
  let active: Request | undefined
  let disposed = false

  const settle = (request: Request, value: boolean) => {
    if (byKey.get(request.key) !== request) return
    byKey.delete(request.key)
    request.resolve(value)
    if (active === request) active = undefined
    showNext()
  }

  const showNext = () => {
    if (active || disposed) return
    const request = queued.shift()
    if (!request) return
    active = request
    void present(request.key).then((value) => settle(request, value))
  }

  const confirm = (key: string) => {
    if (disposed) return Promise.resolve(false)
    const pending = byKey.get(key)
    if (pending) return pending.promise
    let resolve = (_value: boolean) => {}
    const promise = new Promise<boolean>((done) => {
      resolve = done
    })
    const request = { key, promise, resolve }
    byKey.set(key, request)
    queued.push(request)
    showNext()
    return promise
  }

  const dispose = () => {
    disposed = true
    for (const request of byKey.values()) request.resolve(false)
    byKey.clear()
    queued.length = 0
    active = undefined
  }

  return { confirm, dispose, pending: () => byKey.size }
}
