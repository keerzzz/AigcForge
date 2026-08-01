import type { Message } from "@aigcfroge/sdk/v2/client"

/**
 * 从会话消息中提取最新含文本正文的 assistant 候选稿（D1：候选稿 = 消息正文）。
 * 跳过 tool-only 的 assistant 消息（澄清过程）；返回 null 表示尚无候选稿。
 */
export function findLatestAssistantMarkdown(
  messages: readonly Message[],
  partsByMessage: Record<string, readonly { type: string; text?: string }[] | undefined>,
): string | null {
  for (const message of messages.toReversed()) {
    if (message.role !== "assistant") continue
    const parts = partsByMessage[message.id]
    if (!parts) continue
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("")
    if (text.trim().length > 0) return text
  }
  return null
}
