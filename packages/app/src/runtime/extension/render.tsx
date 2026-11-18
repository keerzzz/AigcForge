import { createMemo, ErrorBoundary, For, onMount, Show, untrack, type JSX, type ParentProps } from "solid-js"
import { Portal } from "solid-js/web"
import { MarkdownProvider, useMarkdown } from "@aigcfroge/session-ui/context/markdown"
import { DataProvider, useData } from "@aigcfroge/session-ui/context"
import { ExtensionContext, Slot, Style, type MountedSession, type SlotMap } from "@aigcfroge/gui-extensions/sdk"
import { useExtensionHost } from "./host"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"

/**
 * Renders one extension contribution with its context and error isolation: a contribution that throws records the
 * error and renders nothing, and the rest of the window keeps working. Timeline response actions read supplied
 * facts; the session header slot is per timeline.
 */
export function Contribution(props: { extension: string; children: () => JSX.Element }) {
  const host = useExtensionHost()

  return (
    <Show when={host.context(props.extension)} keyed>
      {(context) => (
        <ErrorBoundary
          fallback={(error) => {
            onMount(() => host.fail(props.extension, error, "render"))

            return null
          }}
        >
          {/* Untracked: a contribution renders once; its own reactivity updates it in place. */}
          <ExtensionContext.Provider value={context}>{untrack(props.children)}</ExtensionContext.Provider>
        </ErrorBoundary>
      )}
    </Show>
  )
}

export function ExtensionSlot<At extends keyof SlotMap>(props: { at: At; input: SlotMap[At] }) {
  const host = useExtensionHost()

  const items = createMemo(() =>
    host
      .items(Slot)
      .filter((item) => item.value.at === props.at)
      .toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0)),
  )

  return (
    <For each={items()}>
      {(item) => (
        <Contribution extension={item.extension}>
          {() =>
            // SAFETY: items are filtered to `at === props.at`, and a slot's render takes that slot's input.
            (item.value.render as (input: SlotMap[At]) => JSX.Element)(props.input)
          }
        </Contribution>
      )}
    </For>
  )
}

export function ExtensionStyles() {
  const host = useExtensionHost()

  return (
    <Portal mount={document.head}>
      <For each={host.items(Style)}>{(item) => <style data-extension={item.extension}>{item.value}</style>}</For>
    </Portal>
  )
}

/** Routes local markdown links in the session to extension LinkHandler contributions, keeping image loading. */
export function ExtensionLinks(props: ParentProps<{ session: MountedSession }>) {
  const host = useExtensionHost()
  const markdown = useMarkdown()
  const data = useData()
  const global = useGlobal()

  return (
    <DataProvider
      data={data.store}
      directory={data.directory}
      sessionID={data.sessionID}
      shellRunning={data.shellRunning}
      shellOutput={data.shellOutput}
      onSessionHref={data.sessionHref}
      onOpenTask={(reference) => {
        host.links.open({ href: "", session: props.session, task: { server: props.session.server, sourceSessionID: reference.sourceSessionID, operationID: reference.operationID } })
      }}
      onCommunication={(reference) => props.session.server.data.session.communication.get(reference.sessionID, reference.communicationID)}
      onOpenCommunication={(reference) => {
        host.links.open({ href: "", session: props.session, communication: { server: props.session.server, sessionID: reference.sessionID, communicationID: reference.communicationID } })
      }}
      onOpenSessionReference={(reference) => {
        host.links.open({ href: "", session: props.session, reference })
      }}
      onSessionReferenceState={(reference) => {
        const connection = global.servers.list().find((server) => ServerConnection.key(server) === reference.serverID)

        if (!connection) return { title: reference.title, status: "disconnected" }
        // Reading an existing controller never connects a referenced server just to paint its label.
        const cached = global.serverCtx(ServerConnection.key(connection))
        const session = cached?.data.session.get(reference.sessionID)
        const title = session?.title ?? reference.title

        if (cached?.data.session.deleted(reference.sessionID)) return { title, status: "missing" }

        if (cached && cached.sdk.connection.status() !== "connected") return { title, status: "disconnected" }

        return { title, status: session ? "available" : "unknown" }
      }}
      onNavigateToSession={(sessionID) => {
        if (host.links.open({ href: data.sessionHref?.(sessionID) ?? "", session: props.session, sessionID })) return

        data.navigateToSession?.(sessionID)
      }}
    >
      <MarkdownProvider
        readImage={markdown?.readImage}
        openLocalFile={(href) => void host.links.open({ href, session: props.session })}
        // Untracked: markdown calls this inside its render effect, which must not follow the routed session.
        localFileExists={(href) => untrack(() => host.links.exists({ href, session: props.session }))}
      >
        {props.children}
      </MarkdownProvider>
    </DataProvider>
  )
}
