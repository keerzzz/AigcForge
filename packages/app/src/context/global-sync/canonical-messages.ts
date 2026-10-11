import type {
  AigcfrogeClient,
  Event,
  Message,
  Part,
  Session,
  SessionMessage,
  SessionMessageAssistantTool,
  ToolPart,
} from "@aigcfroge/sdk/v2/client"

/** Presentation only: canonical records remain the sole persisted conversation. */
export function project(session: Session, messages: SessionMessage[]) {
  const rows: { info: Message; parts: Part[] }[] = []
  let parentID = ""
  let agent = session.agent ?? ""
  let model = session.model
  for (const message of messages) {
    if (message.type === "agent-switched") {
      agent = message.agent
      continue
    }
    if (message.type === "model-switched") {
      model = message.model
      continue
    }
    if (message.type === "user") {
      parentID = message.id
      const next = messages.slice(messages.indexOf(message) + 1).find((item) => item.type === "assistant")
      const selected = next?.type === "assistant" ? next.model : model
      const base = { sessionID: session.id, messageID: message.id }
      rows.push({
        info: {
          id: message.id,
          sessionID: session.id,
          role: "user",
          time: message.time,
          agent: next?.type === "assistant" ? next.agent : agent,
          model: { providerID: selected?.providerID ?? "", modelID: selected?.id ?? "", variant: selected?.variant },
          delegationOrigin: message.delegationOrigin,
        },
        parts: [
          { ...base, id: `${message.id}_000000`, type: "text", text: message.text },
          ...(message.files ?? []).map(
            (file, index): Part => ({
              ...base,
              id: `${message.id}_${String(index + 1).padStart(6, "0")}`,
              type: "file",
              url: file.uri,
              mime: file.mime,
              filename: file.name,
            }),
          ),
          ...(message.agents ?? []).map(
            (attachment, index): Part => ({
              ...base,
              id: `${message.id}_agent_${index}`,
              type: "agent",
              name: attachment.name,
            }),
          ),
        ],
      })
      continue
    }
    if (message.type !== "assistant") continue
    rows.push({
      info: {
        id: message.id,
        sessionID: session.id,
        role: "assistant",
        time: message.time,
        parentID,
        agent: message.agent,
        mode: message.agent,
        modelID: message.model.id,
        providerID: message.model.providerID,
        variant: message.model.variant,
        path: { cwd: session.directory, root: session.directory },
        cost: message.cost ?? 0,
        tokens: message.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: message.finish,
        error: message.error ? { name: "UnknownError", data: { message: message.error.message } } : undefined,
      },
      parts: message.content.map((content, index): Part => {
        const base = {
          id: `${message.id}_${String(index).padStart(6, "0")}_${content.id}`,
          sessionID: session.id,
          messageID: message.id,
        }
        if (content.type === "text") return { ...base, type: "text", text: content.text }
        if (content.type === "reasoning")
          return {
            ...base,
            type: "reasoning",
            text: content.text,
            time: { start: message.time.created, end: message.time.completed },
          }
        return { ...base, type: "tool", callID: content.id, tool: content.name, state: toolState(content) }
      }),
    })
  }
  return { session: rows.map((row) => row.info), part: rows.map((row) => ({ id: row.info.id, part: row.parts })) }
}

function toolState(tool: SessionMessageAssistantTool): ToolPart["state"] {
  const state = tool.state
  if (state.status === "pending") return { status: "pending", input: {}, raw: state.input }
  const start = tool.time.ran ?? tool.time.created
  if (state.status === "running")
    return { status: "running", input: state.input, metadata: state.structured, time: { start } }
  const time = { start, end: tool.time.completed ?? start }
  if (state.status === "error")
    return { status: "error", input: state.input, error: state.error.message, metadata: state.structured, time }
  return {
    status: "completed",
    input: state.input,
    title: tool.name,
    metadata: state.structured,
    output: state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n"),
    time,
  }
}

export async function page(
  client: AigcfrogeClient,
  session: Session,
  limit: number,
  before?: string,
  through?: string,
) {
  const messages: SessionMessage[] = []
  let cursor = before
  let visible = 0
  // Fetch through the preceding user boundary so every rendered assistant has its
  // real parent, even when a provider's tool loop spans more than one API page.
  for (;;) {
    const response = await client.v2.session.messages(
      {
        sessionID: session.id,
        limit: Math.min(200, Math.max(50, limit - visible)),
        ...(cursor ? { cursor } : { order: "desc" as const }),
      },
      { throwOnError: true },
    )
    const data = response.data
    if (!data || data.data.length === 0)
      return { ...project(session, messages.toReversed()), cursor: undefined, complete: true, canonical: true as const }
    messages.push(...data.data)
    visible += data.data.filter((message) => message.type === "user" || message.type === "assistant").length
    cursor = data.cursor.next
    const oldest = messages.findLast((message) => message.type === "user" || message.type === "assistant")
    if (
      !cursor ||
      (visible >= limit && oldest?.type === "user" && (!through || messages.some((message) => message.id === through)))
    )
      return { ...project(session, messages.toReversed()), cursor, complete: !cursor, canonical: true as const }
  }
}

/** Deltas are live-only; the durable Started/Ended projection owns empty/full text. */
export function createStream() {
  const pending = new Map<string, { sessionID: string; text: string; ended: boolean }>()
  const key = (messageID: string, type: string, contentID: string) => `${messageID}\n${type}\n${contentID}`
  const overlay = (parts: Part[], snapshot: boolean) =>
    parts.map((part) => {
      if (part.type !== "text" && part.type !== "reasoning") return part
      // project() prefixes content IDs with the message ID and six-digit content index.
      const id = key(part.messageID, part.type, part.id.slice(part.messageID.length + 8))
      const live = pending.get(id)
      if (!live) return part
      if (snapshot && (part.text !== "" || (live.ended && part.text === live.text))) {
        pending.delete(id)
        return part
      }
      return { ...part, text: live.text }
    })
  return {
    snapshot: (parts: Part[]) => overlay(parts, true),
    update(event: Event, parts: Record<string, Part[] | undefined>) {
      if (
        event.type !== "session.next.text.delta" &&
        event.type !== "session.next.reasoning.delta" &&
        event.type !== "session.next.text.ended" &&
        event.type !== "session.next.reasoning.ended"
      )
        return undefined
      const props = event.properties
      const contentID = "textID" in props ? props.textID : props.reasoningID
      const type = "textID" in props ? "text" : "reasoning"
      const id = key(props.assistantMessageID, type, contentID)
      const current = parts[props.assistantMessageID]
      const part = current?.find(
        (part) => part.type === type && part.id.slice(props.assistantMessageID.length + 8) === contentID,
      )
      const live = pending.get(id)
      if ("text" in props) pending.set(id, { sessionID: props.sessionID, text: props.text, ended: true })
      // A snapshot may contain Ended before the corresponding queued delta arrives.
      if ("delta" in props && !live?.ended && (live || !part || !("text" in part) || part.text === ""))
        pending.set(id, { sessionID: props.sessionID, text: (live?.text ?? "") + props.delta, ended: false })
      return {
        messageID: props.assistantMessageID,
        parts: current ? overlay(current, false) : undefined,
        present: !!part,
      }
    },
    clear(sessionID: string) {
      pending.forEach((value, id) => {
        if (value.sessionID === sessionID) pending.delete(id)
      })
    },
  }
}

export * as CanonicalMessages from "./canonical-messages"
