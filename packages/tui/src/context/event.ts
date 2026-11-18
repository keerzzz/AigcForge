import type { AigcForgeEvent } from "@aigcfroge/client"
import { useClient } from "./client"

type EventMetadata = {
  directory: string | undefined
}
type AigcForgeEventMap = { [Type in AigcForgeEvent["type"]]: Extract<AigcForgeEvent, { type: Type }> }

export function useEvent() {
  const client = useClient()

  function subscribe(handler: (event: AigcForgeEvent, metadata: EventMetadata) => void) {
    return client.event.listen(({ details }) => {
      if (details.type === "server.connected") return
      handler(details, { directory: details.location?.directory })
    })
  }

  function on<T extends AigcForgeEvent["type"]>(
    type: T,
    handler: (event: AigcForgeEventMap[T], metadata: EventMetadata) => void,
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
