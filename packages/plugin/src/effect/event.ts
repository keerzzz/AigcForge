import type { EventApi } from "@omnixa/client/effect/api"

export interface EventDomain extends Pick<EventApi<unknown>, "subscribe"> {}
