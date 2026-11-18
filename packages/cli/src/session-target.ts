import type {
  LocationGetOutput,
  ModelSelection,
  AigcForgeClient,
  SessionInfo,
  SessionExecutorPreference,
} from "@aigcfroge/client/promise"
import { Model } from "@aigcfroge/schema/model"
import { errorMessage } from "./util/error"
import { sameModelSelection } from "@aigcfroge/tui/model-preference"

const SESSION_PAGE_LIMIT = 50

export type SessionTarget = {
  session: SessionInfo
  location: LocationGetOutput
  model: ModelSelection | undefined
  agent: string | undefined
  executorPreference?: SessionExecutorPreference
  resume: boolean
}

export type SessionTargetPreparation = (input: {
  client: AigcForgeClient
  location: LocationGetOutput
  session: SessionInfo | undefined
  model: ModelSelection | undefined
  agent: string | undefined
  signal?: AbortSignal
}) => Promise<{ model: ModelSelection | undefined; agent: string | undefined }>

export class SessionTargetMutationError extends Error {
  override readonly name = "SessionTargetMutationError"

  constructor(cause: unknown) {
    super(errorMessage(cause), { cause })
  }
}

export async function resolveSessionTarget(input: {
  client: AigcForgeClient
  location?: { directory?: string; workspace?: string }
  continue?: boolean
  session?: string
  fork?: boolean
  model?: ModelSelection
  agent?: string
  executorPreference?: SessionExecutorPreference
  environment?: Readonly<Record<string, string>>
  prepare: SessionTargetPreparation
  signal?: AbortSignal
}): Promise<SessionTarget> {
  const selection = await selectSession(input)
  const selected = selection.session
  const location =
    selection.location ??
    (await resolveLocation(
      input.client,
      selected ? { directory: selected.location.directory } : input.location,
      input.signal,
    ))
  const prepared = await input.prepare({
    client: input.client,
    location,
    session: selected,
    model: input.model ?? selected?.model,
    agent: input.agent ?? selected?.agent,
    signal: input.signal,
  })
  const preference = input.executorPreference ?? selected?.executorPreference
  const created =
    selected ??
    (await input.client.session
      .create(
        {
          id: input.session,
          agent: prepared.agent,
          model: prepared.model,
          executorPreference: preference,
          location: { directory: location.directory },
        },
        ...requestOptions(input.signal),
      )
      .catch((error) => {
        throw new SessionTargetMutationError(error)
      }))
  const session = selected
    ? await (async () => {
        const selectAgent = input.agent !== undefined && prepared.agent !== undefined
        if (selectAgent && prepared.agent !== undefined)
          await input.client.session.switchAgent(
            { sessionID: selected.id, agent: prepared.agent, model: prepared.model },
            ...requestOptions(input.signal),
          )
        const switched = selectAgent
          ? await input.client.session.get({ sessionID: selected.id }, ...requestOptions(input.signal))
          : selected
        const current =
          switched.controller?.kind === "root" && input.executorPreference !== undefined
            ? await input.client.session.selectExecutor(
                { sessionID: selected.id, payload: input.executorPreference },
                ...requestOptions(input.signal),
              )
            : switched
        if (
          !selectAgent &&
          prepared.model &&
          !sameModelSelection(prepared.model, current.model)
        ) {
          await input.client.session.switchModel(
            { sessionID: selected.id, model: prepared.model },
            ...requestOptions(input.signal),
          )
          return input.client.session.get({ sessionID: selected.id }, ...requestOptions(input.signal))
        }
        return current
      })().catch((error) => {
        throw new SessionTargetMutationError(error)
      })
    : created
  if (input.environment !== undefined)
    await input.client.session
      .environment({ sessionID: session.id, variables: input.environment }, ...requestOptions(input.signal))
      .catch((error) => {
        throw new SessionTargetMutationError(error)
      })
  return {
    session,
    location,
    model: session.model ?? prepared.model,
    agent: session.agent ?? prepared.agent,
    executorPreference: session.executorPreference,
    resume: selected !== undefined,
  }
}

export function parseSessionTargetModel(value?: string): ModelSelection | undefined {
  if (!value) return
  const model = Model.Selection.parse(value)
  if (Model.Selection.isGroup(model)) return { type: "group", groupID: model.groupID }
  return { providerID: model.providerID, id: model.id, variant: model.variant }
}

async function selectSession(input: {
  client: AigcForgeClient
  location?: { directory?: string }
  continue?: boolean
  session?: string
  fork?: boolean
  signal?: AbortSignal
}) {
  const explicit = input.session ? await findSession(input.client, input.session, input.signal) : undefined
  if (input.session && !explicit) {
    if (input.fork) throw new Error("Session not found")
    return { session: undefined }
  }
  if (explicit)
    return {
      session: input.fork
        ? await input.client.session
            .fork({ sessionID: explicit.id }, ...requestOptions(input.signal))
            .catch((error) => {
              throw new SessionTargetMutationError(error)
            })
        : explicit,
    }
  if (!input.continue) return { session: undefined }

  const location = await resolveLocation(input.client, input.location, input.signal)
  const selected = await latestSession(input.client, location, undefined, input.signal)
  if (!selected) return { session: undefined, location }
  return {
    session: input.fork
      ? await input.client.session.fork({ sessionID: selected.id }, ...requestOptions(input.signal)).catch((error) => {
          throw new SessionTargetMutationError(error)
        })
      : selected,
  }
}

export function findSession(client: AigcForgeClient, sessionID: string, signal?: AbortSignal) {
  return client.session.get({ sessionID }, ...requestOptions(signal)).catch((error) => {
    if (error && typeof error === "object" && "_tag" in error && error._tag === "SessionNotFoundError") return undefined
    throw error
  })
}

async function latestSession(
  client: AigcForgeClient,
  location: LocationGetOutput,
  cursor?: string,
  signal?: AbortSignal,
): Promise<SessionInfo | undefined> {
  const page = await client.session.list(
    {
      directory: location.directory,
      parentID: null,
      limit: SESSION_PAGE_LIMIT,
      order: "desc",
      ...(cursor ? { cursor } : {}),
    },
    ...requestOptions(signal),
  )
  const selected = page.data.find((session) => session.location.directory === location.directory)
  if (selected) return selected
  if (!page.cursor.next || page.data.length === 0) return
  return latestSession(client, location, page.cursor.next, signal)
}

function resolveLocation(client: AigcForgeClient, location?: { directory?: string }, signal?: AbortSignal) {
  if (!location && !signal) return client.location.get()
  if (!location) return client.location.get(undefined, { signal })
  return client.location.get({ location }, ...requestOptions(signal))
}

function requestOptions(signal?: AbortSignal): [] | [{ signal: AbortSignal }] {
  return signal ? [{ signal }] : []
}
