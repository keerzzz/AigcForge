import { Button } from "@aigcfroge/ui/button"
import { Collapsible } from "@aigcfroge/ui/collapsible"
import { Icon } from "@aigcfroge/ui/icon"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { For, Show, createMemo } from "solid-js"
import { createLatest, useExtension, type MountedSession, type SessionScreen, type SessionTargetRef } from "../sdk"
import type definition from "./index"
import { isChildSession } from "./panel-drafts"

export function SessionPanel(props: {
  session: MountedSession
  screen: SessionScreen
  active: boolean
  ready: boolean
  onBack?: () => void
  binding:
    | { readonly serverID: string; readonly sessionID: string; readonly interaction: "interactive" | "readonly" }
    | undefined
  onSelectTarget: (target: { readonly serverID: string; readonly sessionID: string }) => void
  openSession: (input: {
    source: MountedSession
    target: SessionTargetRef
    interaction: "interactive" | "readonly"
  }) => void
}) {
  const ctx = useExtension<typeof definition>()

  const target = createMemo(() => {
    const binding = props.binding
    const server = binding ? ctx.servers.get(binding.serverID) : undefined

    return binding && server ? ctx.sessions.target({ server, sessionID: binding.sessionID }) : undefined
  })

  const child = () => {
    const value = target()

    return isChildSession(value?.server.data.session.get(value.id))
  }

  const choices = createMemo(() => {
    if (!props.ready) return []

    return (ctx.stores.views(props.session).value?.targets ?? []).filter((binding) => {
      const info = ctx.servers.get(binding.serverID)?.data.session.get(binding.sessionID)

      return isChildSession(info) === child()
    })
  })

  const childSource = createMemo(
    () => {
      const value = target()

      if (!props.active || !child() || !value?.server.connected) return

      return { server: value.server, client: value.server.client, attempt: value.server.attempt, id: value.id }
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.client === next?.client && previous?.attempt === next?.attempt && previous?.id === next?.id,
    },
  )

  createLatest(childSource, async (value, signal) => {
    await value.server.data.session.readback(value.id, { children: true })

    if (signal.aborted || ctx.signal.aborted) return
  })

  const status = createMemo(() => {
    const value = target()

    if (!value?.server.connected) return "disconnected"

    if (
      (value.server.data.session.permission.list(value.id)?.length ?? 0) ||
      (value.server.data.session.form.list(value.id)?.length ?? 0)
    )
      return "waiting"

    const runtime = value.server.data.session.status(value.id) ?? "idle"

    if (runtime !== "idle") return runtime

    const outcome = value.server.data.session.get(value.id)?.outcome

    if (outcome === "succeeded") return "completed"
    if (outcome === "failed") return "failed"
    if (outcome === "interrupted") return "interrupted"

    return "idle"
  })

  return (
    <section data-component="session-content-panel" aria-label={ctx.t("session.content.title")}>
      <Show when={props.ready} fallback={<p data-slot="session-content-status">{ctx.t("session.content.loading")}</p>}>
        <Show
          when={props.binding}
          fallback={
            <div data-slot="session-content-picker">
              <h3>{ctx.t("session.content.choose")}</h3>
              <For each={choices()}>
                {(choice) => (
                  <article
                    data-slot="session-content-choice"
                    aria-label={ctx.t("session.content.session", { id: choice.sessionID })}
                  >
                    <div data-slot="session-content-identity">
                      <h4>
                        {ctx.servers.get(choice.serverID)?.data.session.get(choice.sessionID)?.title ??
                          choice.sessionID}
                      </h4>
                      <div data-slot="session-content-metadata">
                        <code>{choice.sessionID}</code>
                        <code>{choice.serverID}</code>
                        <span>{ctx.t(`session.content.${choice.interaction}`)}</span>
                      </div>
                    </div>
                    <Button type="button" size="small" variant="ghost" onClick={() => props.onSelectTarget(choice)}>
                      {ctx.t("session.content.select")}
                    </Button>
                  </article>
                )}
              </For>
            </div>
          }
        >
          {(binding) => (
            <>
              <Collapsible variant="ghost" data-slot="session-content-heading">
                <Show when={child() && props.onBack}>
                  <IconButton
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    aria-label={ctx.t("session.content.backToSubagents")}
                    title={ctx.t("session.content.backToSubagents")}
                    icon={<Icon name="outline-arrow-left" size="small" />}
                    onClick={() => props.onBack?.()}
                  />
                </Show>
                <div data-slot="session-content-identity">
                  <h3>
                    {target()?.server.data.session.get(binding().sessionID)?.title ?? ctx.t("session.content.loading")}
                  </h3>
                </div>
                <div data-slot="session-content-metadata">
                  <div data-slot="session-content-summary">
                    <div data-slot="session-content-status-line" data-state={status()} role="status">
                      <Icon
                        name={
                          status() === "completed"
                            ? "circle-check"
                            : status() === "failed"
                              ? "circle-x"
                              : status() === "interrupted"
                                ? "circle-ban-sign"
                                : status() === "running"
                                  ? "refresh"
                                  : status() === "idle"
                                    ? "dash"
                                    : "circle-exclamation"
                        }
                        size="small"
                      />
                      <span>{ctx.t(`session.collaboration.status.${status()}`)}</span>
                    </div>
                    <Show when={!child()}>
                      <span>{ctx.t(`session.content.${binding().interaction}`)}</span>
                    </Show>
                    <Collapsible.Trigger type="button">
                      {ctx.t("session.collaboration.details")}
                      <Collapsible.Arrow />
                    </Collapsible.Trigger>
                    <Show when={target()}>
                      {(session) => (
                        <IconButton
                          type="button"
                          size="small"
                          variant="ghost-muted"
                          aria-label={ctx.t("session.collaboration.openSession")}
                          title={ctx.t("session.collaboration.openSession")}
                          icon={<Icon name="outline-square-arrow" size="small" />}
                          onClick={() =>
                            ctx.sessions.open({
                              source: props.session,
                              server: session().server,
                              sessionID: session().id,
                            })
                          }
                        />
                      )}
                    </Show>
                  </div>
                  <Collapsible.Content>
                    <code>{binding().sessionID}</code>
                    <span>{target()?.server.name ?? binding().serverID}</span>
                    <code>{binding().serverID}</code>
                  </Collapsible.Content>
                </div>
              </Collapsible>
              <div data-slot="session-content-body">
                <Show
                  when={target()}
                  fallback={
                    <p data-slot="session-content-status" role="status">
                      {ctx.t("session.content.serverUnavailable", { server: binding().serverID })}
                    </p>
                  }
                >
                  {(session) =>
                    ctx.sessions.content({
                      get source() {
                        return props.session
                      },
                      get screen() {
                        return props.screen
                      },
                      get target() {
                        return session()
                      },
                      get active() {
                        return props.active
                      },
                      get interaction() {
                        return binding().interaction
                      },
                      onNavigateToSession: (sessionID) =>
                        props.openSession({
                          source: props.session,
                          target: ctx.sessions.target({ server: session().server, sessionID }),
                          interaction: "readonly",
                        }),
                    })
                  }
                </Show>
              </div>
            </>
          )}
        </Show>
      </Show>
    </section>
  )
}

export default SessionPanel
