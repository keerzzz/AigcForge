import type { EventApi } from "@omnixa/client/promise/api"

export interface EventDomain extends Pick<EventApi, "subscribe"> {}
