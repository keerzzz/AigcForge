import { SessionProgressIndicatorV2 } from "@omnixa/session-ui/v2/session-progress-indicator-v2"
import { resolveAgentColor } from "@omnixa/ui/theme"
import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createAnimatedPresence } from "@/runtime/animated-presence"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"

export function SessionWorkingIndicator(props: { sessionID?: string }) {
  const language = useLanguage()
  const server = useServer()
  const sdk = useServerSDK()
  const [elements, setElements] = createStore<{ indicator?: HTMLSpanElement }>({})

  const coreColor = createMemo(() => {
    const child = props.sessionID ? server.ctx.data.session.get(props.sessionID) : undefined
    const agent = child?.agent
      ? server.ctx.data.location.agent
          .list(child.location)
          ?.find((agent) => agent.id === child.agent || agent.name === child.agent)
      : undefined

    return agent ? resolveAgentColor(agent.name, agent.color).v2Color : "currentColor"
  })

  const presence = createAnimatedPresence(
    () => {
      const id = props.sessionID

      return id &&
        sdk.connection.status() === "connected" &&
        server.ctx.data.session.get(id)?.parentID &&
        server.ctx.data.session.status(id) === "running" &&
        !server.ctx.data.session.permission.list(id)?.length &&
        !server.ctx.data.session.form.list(id)?.length
        ? true
        : undefined
    },
    () => elements.indicator ?? null,
    () => props.sessionID,
  )

  return (
    <Show when={presence.present()}>
      <span
        ref={(element) => setElements("indicator", element)}
        role="status"
        aria-label={language.t("session.timeline.working")}
        data-visible={presence.show()}
        // Cancel the header's 2px gap at the end of the collapse so unmounting doesn't nudge the title.
        class="ms-1 me-0.5 flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden text-v2-icon-icon-muted duration-200 ease-out data-[visible=false]:ms-0 data-[visible=false]:-me-0.5 data-[visible=false]:w-0 data-[visible=false]:opacity-0 motion-reduce:animate-none motion-reduce:transition-none"
        classList={{
          "transition-[width,margin,opacity]": presence.animate(),
          // Presence waits for animationend; transitions alone would unmount the icon immediately.
          "animate-out fade-out fill-mode-forwards": presence.animate() && !presence.show(),
        }}
      >
        <SessionProgressIndicatorV2 variant="agent" coreColor={coreColor()} class="shrink-0" />
      </span>
    </Show>
  )
}
