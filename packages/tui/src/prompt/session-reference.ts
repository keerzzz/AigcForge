import type { SessionInfo } from "@omnixa/client"

/** Plain text preserves the server and Session identity on terminal and external clients. */
export function sessionReferenceText(session: Pick<SessionInfo, "id" | "title">, server: string) {
  return `Referenced Session: ${(session.title ?? "Untitled session").replace(/[\r\n]/g, " ")} (server ${server}, Session ${session.id}, scope identity)`
}
