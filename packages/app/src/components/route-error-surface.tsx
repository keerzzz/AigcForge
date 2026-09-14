/**
 * Route-scoped error surface (closure plan §7.1). Renders inside the app shell
 * so the titlebar and navigation stay usable — the user is never trapped on a
 * broken URL. Unlike `pages/error.tsx` (the fatal renderer-error page that
 * records incidents and offers app updates), this surface is for recoverable
 * routing failures and offers routing recovery: go home, retry the resolution,
 * or copy sanitized diagnostics.
 */
import { createSignal, Show, type Component } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { routeDiagnostics, routeErrorKey, type RouteError } from "@/utils/route-error"

export const RouteErrorSurface: Component<{ error: RouteError; onRetry?: () => void }> = (props) => {
  const language = useLanguage()
  const navigate = useNavigate()
  const [copied, setCopied] = createSignal(false)
  const copy = (suffix: "title" | "description") => `route.error.${routeErrorKey[props.error.kind]}.${suffix}`

  async function copyDiagnostics() {
    const payload = routeDiagnostics(props.error)
    await navigator.clipboard?.writeText(payload).catch(() => undefined)
    setCopied(true)
  }

  return (
    <div
      data-component="route-error"
      data-route-error-kind={props.error.kind}
      class="flex h-full w-full items-center justify-center p-6"
    >
      <div class="flex w-full max-w-xl flex-col gap-4">
        <div class="flex flex-col gap-1">
          <h1 class="text-lg font-medium">{language.t(copy("title"))}</h1>
          <p class="text-sm text-text-weak">{language.t(copy("description"))}</p>
        </div>

        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded border border-border-weak p-3 text-xs">
          <dt class="text-text-weak">{language.t("route.error.diagnostics")}</dt>
          <dd class="font-mono">{props.error.kind}</dd>
          <Show when={props.error.serverKey}>
            {(value) => (
              <>
                <dt class="text-text-weak">server</dt>
                <dd class="truncate font-mono">{value()}</dd>
              </>
            )}
          </Show>
          <Show when={props.error.sessionID}>
            {(value) => (
              <>
                <dt class="text-text-weak">session</dt>
                <dd class="truncate font-mono">{value()}</dd>
              </>
            )}
          </Show>
          <Show when={props.error.parentID}>
            {(value) => (
              <>
                <dt class="text-text-weak">parent</dt>
                <dd class="truncate font-mono">{value()}</dd>
              </>
            )}
          </Show>
          <Show when={props.error.status}>
            {(value) => (
              <>
                <dt class="text-text-weak">status</dt>
                <dd class="font-mono">{value()}</dd>
              </>
            )}
          </Show>
          <Show when={props.error.detail}>
            {(value) => (
              <>
                <dt class="text-text-weak">detail</dt>
                <dd class="break-all font-mono">{value()}</dd>
              </>
            )}
          </Show>
        </dl>

        <div class="flex flex-wrap items-center gap-2">
          <ButtonV2 variant="contrast" onClick={() => navigate("/")}>
            {language.t("route.error.action.home")}
          </ButtonV2>
          <Show when={props.onRetry}>
            <ButtonV2 onClick={() => props.onRetry?.()}>{language.t("route.error.action.retry")}</ButtonV2>
          </Show>
          <ButtonV2 onClick={() => void copyDiagnostics()}>
            {copied() ? language.t("route.error.action.copied") : language.t("route.error.action.copyDiagnostics")}
          </ButtonV2>
        </div>
      </div>
    </div>
  )
}
