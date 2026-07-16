import type { Message, Part } from "@aigcfroge/sdk/v2/client"

/** Count tool parts across all assistant messages in a session */
export function toolCountFromParts(parts: Record<string, Part[] | undefined>, messages: Message[]): number {
  let count = 0
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    const messageParts = parts[msg.id]
    if (!messageParts) continue
    for (const part of messageParts) {
      if (part.type === "tool") count++
    }
  }
  return count
}
