import { base64Encode } from "@aigcfroge/core/util/encode"
import { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function sessionHref(server: ServerConnection.Key, sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

export function requireServerKey(segment: string | undefined) {
  const key = decode64(segment)
  if (!key || base64Encode(key) !== segment) throw new Error("Invalid server route")
  // Old bookmarks may carry the raw `localhost` spelling — canonicalize on the
  // way in so route keys always compare equal to registry keys (plan §7.1 附则).
  return ServerConnection.canonicalKey(ServerConnection.Key.make(key))
}

type SessionParent = { id: string; parentID?: string }

export async function rootSession(session: SessionParent, get: (sessionID: string) => Promise<SessionParent>) {
  let current = session
  while (current.parentID) current = await get(current.parentID)
  return current
}
