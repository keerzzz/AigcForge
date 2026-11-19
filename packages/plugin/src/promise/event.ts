import type { EventApi } from "@aigcfroge/client/promise/api"

export interface EventDomain extends Pick<EventApi, "subscribe"> {}
