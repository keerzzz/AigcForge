import { base64Encode } from "@omnixa/util/encode"
import { ServerConnection } from "@/runtime/server/registry"
import { decode64 } from "@/runtime/persistence/base64"
import { useNavigate } from "@solidjs/router"
import { useTabs } from "@/shell/tabs/tabs"

/** Opens an existing related session and remembers its route in the source shell tab. */
export function useRelatedSessionRoute() {
  const tabs = useTabs()
  const navigate = useNavigate()

  return (input: {
    server: ServerConnection.Key
    from: string
    sessionID: string
    parentID?: string
    reveal?: string
  }) => {
    const tab = tabs.store.find(
      (item) =>
        item.type === "session" &&
        item.server === input.server &&
        (item.sessionId === input.from || item.routeSessionId === input.from),
    )

    if (tab?.type === "session") tabs.rememberSessionRoute(tab, input.sessionID, input.parentID)
    navigate(sessionHref(input.server, input.sessionID), input.reveal ? { state: { reveal: input.reveal } } : undefined)
  }
}

export function sessionHref(server: ServerConnection.Key, sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

export function requireServerKey(segment: string | undefined) {
  const key = decode64(segment)

  if (!key || base64Encode(key) !== segment) throw new Error("Invalid server route")

  return ServerConnection.Key.make(key)
}

type SessionParent = { id: string; parentID?: string }

export async function rootSession<T extends SessionParent>(session: T, get: (sessionID: string) => Promise<T>) {
  const seen = new Set([session.id])
  let current = session

  while (current.parentID) {
    if (seen.has(current.parentID)) throw new Error(`Session parent cycle: ${current.parentID}`)
    seen.add(current.parentID)
    current = await get(current.parentID)
  }

  return current
}
