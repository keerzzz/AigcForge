import { DataProvider } from "@aigcfroge/session-ui/context"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { createLatest } from "@aigcfroge/gui-extensions/sdk"
import { MarkdownProvider, type ReadMarkdownImage } from "@aigcfroge/session-ui/context/markdown"
import { useNavigate } from "@solidjs/router"
import { createMemo, type ParentProps } from "solid-js"
import { Option, Schema } from "effect"
import { useProviders } from "@/providers/catalog/providers"
import { LocalProvider } from "@/providers/models/selection"
import type { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useTabs } from "@/shell/tabs/tabs"
import { readLocalImage } from "@/runtime/server/image"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { useSessionContent, useSessionParams } from "@/session/content-context"

const decodeCommunicationMetadata = Schema.decodeUnknownOption(
  Schema.Struct({
    communication: Schema.Struct({ id: SessionCommunication.ID }),
  }),
)

const decodeFormTool = Schema.decodeUnknownOption(
  Schema.Struct({ tool: Schema.Struct({ messageID: Schema.String, id: Schema.String }) }),
)

export function SessionUIProvider(
  props: ParentProps<{
    directory: string
    server: ServerConnection.Key
  }>,
) {
  const navigate = useNavigate()
  const params = useSessionParams()
  const content = useSessionContent()
  const data = useData()
  const serverSDK = useServerSDK()
  const tabs = useTabs()
  const language = useLanguage()
  const directory = () => props.directory

  const readImage = createMemo<ReadMarkdownImage>(() => {
    const dir = directory()

    return (path, signal) => readLocalImage(serverSDK.api, dir, path, signal)
  })

  const href = (sessionID: string) => sessionHref(props.server, sessionID)

  const navigateToSession = async (sessionID: string) => {
    if (content) return content.navigateToSession(sessionID)

    const tab = tabs.store.find(
      (item) =>
        item.type === "session" &&
        item.server === props.server &&
        (item.sessionId === params.id || item.routeSessionId === params.id),
    )

    if (tab?.type === "session") tabs.rememberSessionRoute(tab, sessionID, params.id)
    await data.session.sync(sessionID).catch(() => undefined)
    navigate(href(sessionID))
  }

  const openReferencedSession = async (sessionID: string) => {
    // The transcript may mention a session from another server (or one that was deleted).
    // Resolve it on this server before touching tabs or the current route.
    const session = await serverSDK.api.session.get({ sessionID }).catch(() => undefined)

    if (!session || session.time.archived) {
      showToast({ title: language.t("session.error.notFound") })

      return
    }

    data.session.remember(session)
    tabs.select(tabs.addSessionTab({ server: props.server, sessionId: session.id }))
  }

  const providers = useProviders(directory)

  const communicationIDs = createMemo(
    () => [
      ...new Set(
        data.session.message.list(params.id).flatMap((message) => {
          if (message.type !== "synthetic") return []
          const metadata = Option.getOrUndefined(decodeCommunicationMetadata(message.metadata))

          return metadata ? [metadata.communication.id] : []
        }),
      ),
    ],
    undefined,
    { equals: (previous, next) => previous?.join("\n") === next.join("\n") },
  )

  const communicationOwner = createMemo(
    () => {
      if (
        (content && !content.active()) ||
        serverSDK.connection.status() !== "connected" ||
        !params.id ||
        !communicationIDs().length
      )
        return undefined

      return {
        data,
        client: serverSDK.api,
        attempt: serverSDK.connection.attempt(),
        sessionID: params.id,
        location: JSON.stringify(data.session.get(params.id)?.location),
        ids: communicationIDs(),
        version: data.session.communication.version(params.id),
      }
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.data === next?.data &&
        previous?.client === next?.client &&
        previous?.attempt === next?.attempt &&
        previous?.sessionID === next?.sessionID &&
        previous?.location === next?.location &&
        previous?.ids === next?.ids &&
        previous?.version === next?.version,
    },
  )

  // The visible conversation hydrates its retained references through the original Data owner; rows only read them.
  createLatest(communicationOwner, async (value, signal) => {
    await value.data.session.communication.sync(value.sessionID)

    if (signal.aborted) return

    const missingCommunicationIDs = value.ids.filter((id) => !value.data.session.communication.get(value.sessionID, id))
    await Promise.all(
      missingCommunicationIDs.map((id) => value.data.session.communication.readback(value.sessionID, id)),
    )

    if (signal.aborted) return

    // Communication participants can be roots outside the displayed Session's loaded family.
    const missingSessionIDs = [
      ...new Set(
        value.ids.flatMap((id) => {
          const record = value.data.session.communication.get(value.sessionID, id)

          return record ? [record.actor.sessionID, record.contentSource.sessionID, record.targetSessionID] : []
        }),
      ),
    ].filter((id) => !value.data.session.get(id) && !value.data.session.deleted(id))

    await Promise.all(missingSessionIDs.map((id) => value.data.session.sync(id).catch(() => undefined)))
  })

  // Requests retain raw running tool records. Suspend only their presentation, using the original source IDs.
  const toolRequests = createMemo(() => {
    const permissions = data.session.permission.list(params.id) ?? []
    const forms = data.session.form.list(params.id) ?? []
    const sources = [
      ...permissions.flatMap((request) => (request.source?.type === "operation" ? [] : [request.source])),
      ...forms.map((form) => Option.getOrUndefined(decodeFormTool(form.metadata))?.tool),
    ]

    return {
      waiting: permissions.length > 0 || forms.length > 0,
      unscoped: sources.some((source) => !source),
      ids: new Set(sources.flatMap((source) => (source ? [source.id, `${source.messageID}:${source.id}`] : []))),
    }
  })

  const sessionUIData = createMemo(() => ({
    modelGroups: data.location.model.group.definition.list({ directory: directory() })?.effective,
    provider: providers.ready()
      ? { all: providers.all(), default: providers.default(), connected: providers.connected().map((item) => item.id) }
      : undefined,
    session: data.session.list(),
    session_status: Object.fromEntries(
      data.session
        .list()
        .map((session) => [
          session.id,
          serverSDK.connection.status() === "connected" &&
          data.session.status(session.id) === "running" &&
          !data.session.permission.list(session.id)?.length &&
          !data.session.form.list(session.id)?.length
            ? ({ type: "busy" } as const)
            : ({ type: "idle" } as const),
        ]),
    ),
    session_diff: {},
  }))

  return (
    <DataProvider
      data={sessionUIData()}
      directory={directory()}
      sessionID={params.id}
      toolMotion={(id) =>
        serverSDK.connection.status() === "connected" &&
        (id ? !toolRequests().unscoped && !toolRequests().ids.has(id) : !toolRequests().waiting)
      }
      shellRunning={(id) => !!data.shell.get(id)}
      shellOutput={(input) => serverSDK.api.shell.output(input)}
      onNavigateToSession={navigateToSession}
      onSessionHref={href}
      onOpenTask={content?.openTask}
      onCommunication={(reference) => data.session.communication.get(reference.sessionID, reference.communicationID)}
      onOpenCommunication={content?.openCommunication}
    >
      <MarkdownProvider readImage={readImage()} openSession={openReferencedSession}>
        <LocalProvider>{props.children}</LocalProvider>
      </MarkdownProvider>
    </DataProvider>
  )
}
