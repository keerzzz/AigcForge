export * as Omnixa from "./client.js"

import { SharedEvents } from "../shared-events.js"
import { Omnixa } from "./generated/index.js"
import type { ClientOptions } from "./generated/client.js"
import { makeRpc } from "./rpc.js"

export type { ClientOptions, RequestOptions } from "./generated/client.js"

export function make(options: ClientOptions) {
  const raw = Omnixa.make(options)
  const events = SharedEvents.make((signal, onActivity) => raw.event.subscribe({ signal, onActivity }))
  return {
    ...raw,
    rpc: Object.assign(makeRpc(raw, events), raw.rpc),
    event: {
      ...events,
      subscribe: Object.assign(events.subscribe, { raw: raw.event.subscribe.raw }),
    },
  }
}
