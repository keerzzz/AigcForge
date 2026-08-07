import { For, Show, createMemo } from "solid-js"
import type { PermissionRequest } from "@aigcfroge/sdk/v2"
import { Button } from "@aigcfroge/ui/button"
import { DockPrompt } from "@aigcfroge/session-ui/dock-prompt"
import { Icon } from "@aigcfroge/ui/icon"
import { useLanguage } from "@/context/language"

export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  sessionID?: string
  onDecide: (response: "once" | "always" | "reject") => void
}) {
  const language = useLanguage()
  const isChildRequest = createMemo(() => props.sessionID !== undefined && props.request.sessionID !== props.sessionID)

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  const metaDescription = () => {
    const value = props.request.metadata?.description
    return typeof value === "string" && value ? value : ""
  }
  const metaCliTarget = () => {
    const value = props.request.metadata?.cli_target
    return typeof value === "string" && value ? value : ""
  }
  const metaExecutionType = () => {
    const value = props.request.metadata?.execution_type
    return typeof value === "string" && value ? value : ""
  }
  const hasMetadata = createMemo(() => Boolean(metaDescription() || metaCliTarget() || metaExecutionType()))

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Button
              variant="secondary"
              size="normal"
              onClick={() => props.onDecide("always")}
              disabled={props.responding}
            >
              {language.t("ui.permission.allowAlways")}
            </Button>
            <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
              {language.t("ui.permission.allowOnce")}
            </Button>
          </div>
        </>
      }
    >
      <Show when={isChildRequest()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-subagent-badge" class="flex items-center gap-1 text-text-weak text-12-regular">
            <Icon name="branch" size="small" />
            <span>{language.t("notification.permission.fromSubagent")}</span>
          </div>
        </div>
      </Show>

      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={hasMetadata()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-metadata">
            <Show when={metaExecutionType()}>
              <code class="text-12-regular text-text-base break-all">{metaExecutionType()}</code>
            </Show>
            <Show when={metaCliTarget()}>
              <code class="text-12-regular text-text-base break-all">{metaCliTarget()}</code>
            </Show>
            <Show when={metaDescription()}>
              <div class="text-12-regular text-text-weak">{metaDescription()}</div>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
