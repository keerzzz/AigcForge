type Identity = { id: string; sessionID: string }

export type Event<Request extends Identity> =
  | { revision: number; type: "asked"; request: Request }
  | { revision: number; type: "replied"; sessionID: string; requestID: string }

const capacity = 500

export function append<Request extends Identity>(events: Event<Request>[], event: Event<Request>) {
  const next = [...events, event]
  return next.length > capacity ? next.slice(next.length - capacity) : next
}

export function replay<Request extends Identity>(
  snapshot: Request[],
  events: Event<Request>[],
  revision: { after: number; current: number },
) {
  const updates = events.filter((event) => event.revision > revision.after)
  // An evicted update makes this snapshot unsafe. The loader must fetch a new
  // authoritative snapshot rather than resurrect or discard a pending request.
  if (updates.length !== revision.current - revision.after) return undefined
  const pending = new Map(snapshot.map((request) => [`${request.sessionID}\0${request.id}`, request]))
  updates.forEach((event) => {
    if (event.type === "asked") {
      pending.set(`${event.request.sessionID}\0${event.request.id}`, event.request)
      return
    }
    pending.delete(`${event.sessionID}\0${event.requestID}`)
  })
  return [...pending.values()]
}

export * as PendingEvents from "./pending-events"
