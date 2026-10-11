import type { UserMessage } from "@aigcfroge/sdk/v2"

type Local = {
  session: {
    reset(): void
    restore(msg: {
      sessionID: string
      agent: string
      model: { providerID: string; modelID: string; variant?: string }
    }): void
  }
}

type SessionSelection = {
  id: string
  agent?: string
  model?: { providerID: string; id: string; variant?: string }
}

export const resetSessionModel = (local: Local) => {
  local.session.reset()
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  local.session.restore(msg)
}

export const syncSessionSelection = (local: Local, session: SessionSelection) => {
  if (!session.agent || !session.model) return
  local.session.restore({
    sessionID: session.id,
    agent: session.agent,
    model: {
      providerID: session.model.providerID,
      modelID: session.model.id,
      variant: session.model.variant,
    },
  })
}
