import { For, Show, createMemo } from "solid-js"
import { PermissionPendingModel } from "@/context/global-sync/permission-pending"
import { Button } from "@aigcfroge/ui/button"
import { DockPrompt } from "@aigcfroge/session-ui/dock-prompt"
import { Icon } from "@aigcfroge/ui/icon"
import { useLanguage } from "@/context/language"

export function SessionPermissionDock(props: {
  request: PermissionPendingModel.PermissionPending
  responding: boolean
  sessionID?: string
  /**
   * Takes the request/decision PAIR rather than a bare decision, so `always` on a
   * V2 request and `session`/`location` on a legacy one are compile errors. Each
   * button below can only build the pair its own narrowed branch permits.
   */
  onDecide: (input: PermissionPendingModel.PermissionDecisionInput) => void
}) {
  const language = useLanguage()
  const request = createMemo(() => PermissionPendingModel.permissionPresentation(props.request))
  const legacyRequest = createMemo(() => (props.request.kind === "legacy" ? props.request : undefined))
  const scopedRequest = createMemo(() => (props.request.kind === "v2" ? props.request : undefined))
  /** `once` / `reject` are legal for both runtimes; narrow so the pair still typechecks. */
  const shared = (decision: "once" | "reject"): PermissionPendingModel.PermissionDecisionInput =>
    props.request.kind === "legacy"
      ? { request: props.request, decision }
      : { request: props.request, decision }
  const isChildRequest = createMemo(() => props.sessionID !== undefined && request().sessionID !== props.sessionID)

  const toolDescription = () => {
    const key = `settings.permissions.tool.${request().action}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  const metaDescription = () => {
    const value = request().metadata?.description
    return typeof value === "string" && value ? value : ""
  }
  const metaCliTarget = () => {
    const value = request().metadata?.cli_target
    return typeof value === "string" && value ? value : ""
  }
  const metaExecutionType = () => {
    const value = request().metadata?.execution_type
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
            <Button variant="ghost" size="normal" onClick={() => props.onDecide(shared("reject"))} disabled={props.responding}>
              {language.t("ui.permission.deny")}
            </Button>
            <Show
              when={scopedRequest()}
              fallback={
                <Show when={legacyRequest()}>
                  {(legacy) => (
                    <Button
                      variant="secondary"
                      size="normal"
                      onClick={() => props.onDecide({ request: legacy(), decision: "always" })}
                      disabled={props.responding}
                    >
                      {language.t("ui.permission.allowAlways")}
                    </Button>
                  )}
                </Show>
              }
            >
              {(scoped) => (
                <>
                  <Show when={props.sessionID === scoped().request.sessionID}>
                    <Button
                      variant="secondary"
                      size="normal"
                      onClick={() => props.onDecide({ request: scoped(), decision: "session" })}
                      disabled={props.responding}
                    >
                      {language.t("approval.center.sessionScope")}
                    </Button>
                  </Show>
                  <Button
                    variant="secondary"
                    size="normal"
                    onClick={() => props.onDecide({ request: scoped(), decision: "location" })}
                    disabled={props.responding}
                  >
                    {language.t("approval.center.locationScope")}
                  </Button>
                </>
              )}
            </Show>
            <Button variant="primary" size="normal" onClick={() => props.onDecide(shared("once"))} disabled={props.responding}>
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

      <div data-slot="permission-row">
        <span data-slot="permission-spacer" aria-hidden="true" />
        <code data-slot="permission-action" class="text-12-regular text-text-base break-all">
          {request().action}
        </code>
      </div>

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

      <Show when={request().resources.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={request().resources}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
