import type { EventApi } from "@aigcfroge/client/effect/api"

export interface EventDomain extends Pick<EventApi<unknown>, "subscribe"> {}
