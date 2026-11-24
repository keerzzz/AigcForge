import type { OmnixaEvent } from "@omnixa/client"
import { useClient } from "./client"

type EventMetadata = {
  directory: string | undefined
}
type OmnixaEventMap = { [Type in OmnixaEvent["type"]]: Extract<OmnixaEvent, { type: Type }> }

export function useEvent() {
  const client = useClient()

  function subscribe(handler: (event: OmnixaEvent, metadata: EventMetadata) => void) {
    return client.event.listen(({ details }) => {
      if (details.type === "server.connected") return
      handler(details, { directory: details.location?.directory })
    })
  }

  function on<T extends OmnixaEvent["type"]>(
    type: T,
    handler: (event: OmnixaEventMap[T], metadata: EventMetadata) => void,
  ) {
    return client.event.on(type, (event) => {
      handler(event, { directory: event.location?.directory })
    })
  }

  return {
    subscribe,
    on,
  }
}
