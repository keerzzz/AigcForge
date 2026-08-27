import type { McpScopeScopedGrantInfo } from "@aigcfroge/sdk/v2/client"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Dialog, DialogFooter } from "@aigcfroge/ui/v2/dialog-v2"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { useSDK, type DirectorySDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useSync, type DirectorySync } from "@/context/sync"
import { PermissionPendingModel, type PermissionV2Pending } from "@/context/global-sync/permission-pending"

type ApprovalScope = "reject" | "once" | "session" | "location"
type ApprovalTransport = "reply" | "grant"

type ApprovalCenterState = {
  submitting?: string
  error?: string
  grants: McpScopeScopedGrantInfo[]
  grantsLoading: boolean
  grantsError?: string
  revoking?: string
}

export function approvalScopeTransport(scope: ApprovalScope): ApprovalTransport {
  if (scope === "session" || scope === "location") return "grant"
  return "reply"
}

export function pendingForLocation(
  permission: Record<string, PermissionV2Pending[] | undefined>,
): PermissionV2Pending[] {
  return Object.values(permission)
    .flatMap((requests) => requests ?? [])
    .toSorted((a, b) => a.sessionID.localeCompare(b.sessionID) || a.id.localeCompare(b.id))
}

/**
 * Titlebar approval surface for V2 pending requests and scoped grants.
 *
 * Routes that sit inside `SDKProvider`/`DirectoryDataProvider` (session, draft)
 * mount it bare and it reads both from context. `/mode/:mode` has neither —
 * `ModeWorkspace` is server-scoped and resolves its directory itself — so it
 * passes the accessors in. That mount is not cosmetic: the app's one global SSE
 * connection binds the responder fact for every route (`handlers/global.ts`),
 * so a route without this component leaves `ask` parked for the full TTL with
 * nothing on screen to answer it.
 */
export function ApprovalCenter(props: {
  readonly sdk?: () => DirectorySDK | undefined
  readonly sync?: () => DirectorySync | undefined
}) {
  const sdkFromContext = props.sdk ?? useSDK()
  const syncFromContext = props.sync ?? useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const [mount, setMount] = createSignal<HTMLElement | null>(null)
  const [state, setState] = createStore<ApprovalCenterState>({ grants: [], grantsLoading: true })
  const pending = createMemo(() => {
    const current = syncFromContext()
    return current === undefined ? [] : pendingForLocation(current.data.permission_v2)
  })

  const loadGrants = async () => {
    const client = sdkFromContext()?.client
    if (!client) return
    setState({ grantsLoading: true, grantsError: undefined })
    try {
      const result = await client.v2.permission.grant.list(undefined, { throwOnError: true })
      setState({ grants: result.data?.data ?? [], grantsLoading: false })
    } catch (error: unknown) {
      setState({
        grantsLoading: false,
        grantsError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  onMount(() => {
    setMount(document.getElementById("aigcfroge-titlebar-right"))
  })

  // `ModeWorkspace` resolves its directory SDK in an effect, so the first load is
  // keyed on the client becoming available rather than fired once at mount.
  createEffect(() => {
    if (sdkFromContext()?.client === undefined) return
    void loadGrants()
  })

  const submit = async (request: PermissionV2Pending, scope: ApprovalScope) => {
    const key = `${request.sessionID}\0${request.id}`
    const client = sdkFromContext()?.client
    if (!client) return
    setState({ submitting: key, error: undefined })
    try {
      await (approvalScopeTransport(scope) === "grant"
        ? client.v2.session.permission.grant({
            sessionID: request.sessionID,
            requestID: request.id,
            level: scope === "session" ? "session" : "location",
          })
        : PermissionPendingModel.decidePermission(client, { request: { kind: "v2", request }, decision: scope }))
      dialog.close()
    } catch (error: unknown) {
      setState({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      setState("submitting", undefined)
    }
  }

  const revoke = async (grant: McpScopeScopedGrantInfo) => {
    const client = sdkFromContext()?.client
    if (!client) return
    setState({ revoking: grant.grant.id, grantsError: undefined })
    try {
      await client.v2.permission.grant.revoke(
        { grantID: grant.grant.id, expectedRevision: grant.grantRevision },
        { throwOnError: true },
      )
    } catch (error: unknown) {
      setState("grantsError", error instanceof Error ? error.message : String(error))
    } finally {
      setState("revoking", undefined)
      await loadGrants()
    }
  }

  const open = () => {
    setState({ error: undefined, submitting: undefined })
    void loadGrants()
    dialog.show(() => (
      <ApprovalDialog requests={pending} state={state} onSubmit={submit} onReload={loadGrants} onRevoke={revoke} />
    ))
  }

  return (
    <Show when={mount()}>
      {(target) => (
        <Show when={pending().length > 0 || state.grants.length > 0}>
          <Portal mount={target()}>
            <ButtonV2
              type="button"
              size="small"
              variant="ghost"
              data-slot="approval-center-trigger"
              aria-label={language.t("approval.center.pending", { count: pending().length })}
              onClick={open}
            >
              <span aria-hidden="true">⚠</span>
              <Show when={pending().length > 0}>
                <span>{pending().length}</span>
              </Show>
            </ButtonV2>
          </Portal>
        </Show>
      )}
    </Show>
  )
}

function ApprovalDialog(props: {
  requests: () => PermissionV2Pending[]
  state: ApprovalCenterState
  onSubmit: (request: PermissionV2Pending, scope: ApprovalScope) => Promise<void>
  onReload: () => Promise<void>
  onRevoke: (grant: McpScopeScopedGrantInfo) => Promise<void>
}) {
  const language = useLanguage()
  const request = () => props.requests()[0]
  const busy = (scope: ApprovalScope) =>
    props.state.submitting === `${request()?.sessionID}\0${request()?.id}` && scope !== "reject"

  return (
    <div data-slot="approval-center-dialog">
      <Dialog title={language.t("approval.center.title")} size="large">
        <Show
          when={request()}
          fallback={<p data-slot="approval-center-empty">{language.t("approval.center.empty")}</p>}
        >
          {(current) => (
            <div class="flex min-w-0 flex-col gap-4" data-slot="approval-center-request">
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-v2-text-text-faint text-10-medium uppercase tracking-wider">
                  {language.t("approval.center.action")}
                </span>
                <code
                  class="min-w-0 break-words font-mono text-v2-text-text-base text-13-medium"
                  data-slot="approval-center-action"
                >
                  {current().action}
                </code>
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-v2-text-text-faint text-10-medium uppercase tracking-wider">
                  {language.t("approval.center.resources")}
                </span>
                <Show
                  when={current().resources.length > 0}
                  fallback={
                    <span class="text-v2-text-text-muted text-12-regular">{language.t("approval.center.none")}</span>
                  }
                >
                  <ul class="flex min-w-0 flex-col gap-1" data-slot="approval-center-resources">
                    <For each={current().resources}>
                      {(resource) => (
                        <li class="break-words font-mono text-v2-text-text-base text-12-regular">{resource}</li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-v2-text-text-faint text-10-medium uppercase tracking-wider">
                  {language.t("approval.center.session")}
                </span>
                <code
                  class="break-all font-mono text-v2-text-text-muted text-11-regular"
                  data-slot="approval-center-session"
                >
                  {current().sessionID}
                </code>
              </div>
              <Show when={props.state.error}>
                {(error) => (
                  <p class="break-words text-v2-state-fg-danger text-12-regular" role="alert">
                    {error()}
                  </p>
                )}
              </Show>
              <DialogFooter>
                <ButtonV2
                  type="button"
                  variant="ghost"
                  disabled={props.state.submitting !== undefined}
                  onClick={() => void props.onSubmit(current(), "reject")}
                  data-slot="approval-center-reject"
                >
                  {language.t("approval.center.reject")}
                </ButtonV2>
                <ButtonV2
                  type="button"
                  variant="neutral"
                  disabled={props.state.submitting !== undefined}
                  onClick={() => void props.onSubmit(current(), "once")}
                  data-slot="approval-center-once"
                >
                  {busy("once") ? language.t("approval.center.working") : language.t("approval.center.once")}
                </ButtonV2>
                <ButtonV2
                  type="button"
                  variant="neutral"
                  disabled={props.state.submitting !== undefined}
                  onClick={() => void props.onSubmit(current(), "session")}
                  data-slot="approval-center-session-scope"
                >
                  {busy("session") ? language.t("approval.center.working") : language.t("approval.center.sessionScope")}
                </ButtonV2>
                <ButtonV2
                  type="button"
                  variant="contrast"
                  disabled={props.state.submitting !== undefined}
                  onClick={() => void props.onSubmit(current(), "location")}
                  data-slot="approval-center-location-scope"
                >
                  {busy("location")
                    ? language.t("approval.center.working")
                    : language.t("approval.center.locationScope")}
                </ButtonV2>
              </DialogFooter>
            </div>
          )}
        </Show>
        <GrantHistory state={props.state} onReload={props.onReload} onRevoke={props.onRevoke} />
      </Dialog>
    </div>
  )
}

function GrantHistory(props: {
  state: ApprovalCenterState
  onReload: () => Promise<void>
  onRevoke: (grant: McpScopeScopedGrantInfo) => Promise<void>
}) {
  const language = useLanguage()

  return (
    <section
      class="mt-5 flex min-w-0 flex-col gap-3 border-t border-v2-border-weak pt-4"
      data-slot="approval-center-grants"
    >
      <div class="flex items-center justify-between gap-3">
        <h3 class="text-v2-text-text-base text-13-medium">{language.t("approval.center.grants")}</h3>
        <ButtonV2
          type="button"
          size="small"
          variant="ghost"
          disabled={props.state.grantsLoading || props.state.revoking !== undefined}
          onClick={() => void props.onReload()}
          data-slot="approval-center-grants-reload"
        >
          {language.t("approval.center.reload")}
        </ButtonV2>
      </div>
      <Show when={props.state.grantsLoading}>
        <p class="text-v2-text-text-muted text-12-regular" data-slot="approval-center-grants-loading">
          {language.t("common.loading")}
        </p>
      </Show>
      <Show when={!props.state.grantsLoading && props.state.grantsError}>
        {(error) => (
          <p
            class="break-words text-v2-state-fg-danger text-12-regular"
            role="alert"
            data-slot="approval-center-grants-error"
          >
            {error()}
          </p>
        )}
      </Show>
      <Show when={!props.state.grantsLoading && props.state.grants.length === 0}>
        <p class="text-v2-text-text-muted text-12-regular" data-slot="approval-center-grants-empty">
          {language.t("approval.center.grantsEmpty")}
        </p>
      </Show>
      <Show when={props.state.grants.length > 0}>
        <ul class="flex min-w-0 flex-col gap-2" data-slot="approval-center-grant-list">
          <For each={props.state.grants}>
            {(info) => (
              <li class="flex min-w-0 items-start justify-between gap-3 rounded-md border border-v2-border-weak p-3">
                <div class="flex min-w-0 flex-col gap-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <code class="break-all font-mono text-v2-text-text-base text-12-medium">{info.grant.action}</code>
                    <span class="text-v2-text-text-muted text-11-regular" data-slot="approval-center-grant-scope">
                      {info.grant.scope.level}
                    </span>
                    <span class="text-v2-text-text-muted text-11-regular" data-slot="approval-center-grant-status">
                      {info.status}
                    </span>
                  </div>
                  <span class="break-words font-mono text-v2-text-text-faint text-11-regular">
                    {info.grant.resources.join(", ")}
                  </span>
                </div>
                <Show when={info.status === "active"}>
                  <ButtonV2
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={props.state.revoking !== undefined}
                    onClick={() => void props.onRevoke(info)}
                    data-slot="approval-center-grant-revoke"
                  >
                    {props.state.revoking === info.grant.id
                      ? language.t("approval.center.working")
                      : language.t("approval.center.revoke")}
                  </ButtonV2>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  )
}
