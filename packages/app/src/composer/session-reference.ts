import { decode64 } from "@/runtime/persistence/base64"

/** Finds unambiguous Session IDs and existing app links without consuming adjacent user text. */
export function parseSessionReferences(text: string) {
  const matches = Array.from(
    text.matchAll(
      /(?:https?:\/\/[^\s]+)?\/server\/([A-Za-z0-9_=-]+)\/session\/(ses_[A-Za-z0-9_-]+)|(?<![A-Za-z0-9_-])(ses_[A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/g,
    ),
  )

  return matches.flatMap((match) => {
    const sessionID = match[2] ?? match[3]
    const serverID = match[1] ? decode64(match[1]) : undefined

    if (!sessionID || (match[1] && !serverID)) return []

    return [
      {
        content: match[0],
        start: match.index,
        end: match.index + match[0].length,
        sessionID,
        serverID,
      },
    ]
  })
}
