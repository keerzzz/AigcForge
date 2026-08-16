import { Show, createEffect, createMemo, createResource } from "solid-js"
import { useNavigate, useSearchParams } from "@solidjs/router"
import { useLayout } from "@/context/layout"
import { PromptInput } from "@/components/prompt-input"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useSync } from "@/context/sync"
import { Icon } from "@aigcfroge/ui/icon"
import { showToast } from "@/utils/toast"
import { getSessionHandoff, setSessionHandoff } from "@/pages/session/handoff"
import { useSessionKey } from "@/pages/session/session-layout"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { PermissionTierSelector } from "@/pages/session/composer/permission-tier-selector"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionRevertDock } from "@/pages/session/composer/session-revert-dock"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import { createQuery } from "@tanstack/solid-query"
import { useQueryOptions } from "@/context/server-sync"
import { useSDK } from "@/context/sdk"
import { pathKey } from "@/utils/path-key"
import { useLocal } from "@/context/local"
import { useProviders } from "@/hooks/use-providers"
import { useSettings } from "@/context/settings"
import { ServerConnection, useServer } from "@/context/server"
import { type DraftTab, useTabs } from "@/context/tabs"
import { useDirectoryPicker } from "@/components/directory-picker"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { requireServerKey, sessionHref } from "@/utils/session-route"
import { useGlobal } from "@/context/global"

export function SessionComposerRegion(props: {
  state: SessionComposerState
  centered: boolean
  placement?: "dock" | "inline"
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  onResponseSubmit: () => void
  followup?: {
    queue: () => boolean
    items: { id: string; text: string }[]
    sending?: string
    edit?: { id: string; prompt: FollowupDraft["prompt"]; context: FollowupDraft["context"] }
    onQueue: (draft: FollowupDraft) => void
    onAbort: () => void
    onSend: (id: string) => void
    onEdit: (id: string) => void
    onEditLoaded: () => void
  }
  revert?: {
    items: { id: string; text: string }[]
    restoring?: string
    disabled?: boolean
    onRestore: (id: string) => void
  }
  setPromptDockRef: (el: HTMLDivElement) => void
}) {
  const navigate = useNavigate()
  const layout = useLayout()
  const prompt = usePrompt()
  const language = useLanguage()
  const route = useSessionKey()
  const sync = useSync()
  const sdk = useSDK()
  const queryOptions = useQueryOptions()
  const local = useLocal()
  const providers = useProviders()
  const settings = useSettings()
  const server = useServer()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const [search] = useSearchParams<{ draftId?: string }>()
  const view = layout.view(route.sessionKey)

  const draft = createMemo(() => {
    if (!search.draftId) return
    return tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId)
  })
  const projectServer = createMemo(() => {
    if (!search.draftId) return server.current
    const target = draft()?.server
    if (!target) return
    return server.list.find((conn) => ServerConnection.key(conn) === target)
  })
  const projectServerCtx = createMemo(() => {
    const conn = projectServer()
    if (conn) return global.ensureServerCtx(conn)
  })
  const projects = createMemo(() =>
    search.draftId ? (projectServerCtx()?.projects.list() ?? []) : layout.projects.list(),
  )

  const agentsQuery = createQuery(() => queryOptions().agents(pathKey(sdk().directory)))
  const globalProvidersQuery = createQuery(() => queryOptions().providers(null))
  const providersQuery = createQuery(() => queryOptions().providers(pathKey(sdk().directory)))
  const selectProject = (worktree: string) => {
    const conn = projectServer()
    const target = projectServerCtx()
    if (search.draftId) {
      if (!conn || !target) return
      target.projects.open(worktree)
      target.projects.touch(worktree)
      tabs.updateDraft(search.draftId, { server: ServerConnection.key(conn), directory: worktree })
      return
    }

    layout.projects.open(worktree)
    server.projects.touch(worktree)
    navigate(`/${base64Encode(worktree)}/session`)
  }
  const addProject = (title: string) => {
    const conn = projectServer()
    if (!conn) return
    pickDirectory({
      server: conn,
      title,
      onSelect: (result) => {
        const directory = Array.isArray(result) ? result[0] : result
        if (directory) selectProject(directory)
      },
    })
  }
  const controls = createMemo(() => {
    // local.agent.list() already pins the current mode's orchestrator per ADR-13; no extra filter needed.
    const agentOptions = local.agent.list().map((agent) => agent.name)
    return {
      agents: {
        available: sync().data.agent,
        options: agentOptions,
        current: local.agent.current()?.name ?? "",
        loading: agentsQuery.isLoading,
        visible: settings.visibility.customAgents(),
        select: local.agent.set,
      },
      model: {
        selection: local.model,
        paid: providers.paid().length > 0,
        loading: agentsQuery.isLoading || providersQuery.isLoading || globalProvidersQuery.isLoading,
      },
      projects: {
        available: projects(),
        directory: sdk().directory,
        select: selectProject,
        add: addProject,
      },
      session: {
        id: route.params.id,
        tabs: layout.tabs(route.sessionKey),
        reviewPanel: view.reviewPanel,
      },
    }
  })

  const handoffPrompt = createMemo(() => getSessionHandoff(route.sessionKey())?.prompt)
  const info = createMemo(() => (route.params.id ? sync().session.get(route.params.id) : undefined))
  const parentID = createMemo(() => info()?.parentID)
  const child = createMemo(() => !!parentID())
  const showComposer = createMemo(() => !props.state.blocked() || child())

  // 权限档位 selector：draft（new-session）与已有会话双场景；仅
  // chat/work/assistant × meta 显示（组件内部判断）。
  const tierMode = createMemo(() => draft()?.mode ?? info()?.mode)
  const tierAgent = createMemo(() => draft()?.agent ?? info()?.agent)
  const tierValue = createMemo<"propose" | "full" | undefined>(
    () => draft()?.permissionTier ?? info()?.permissionTier,
  )
  const onTierChange = async (tier: "propose" | "full") => {
    if (search.draftId) {
      tabs.updateDraft(search.draftId, { permissionTier: tier })
      return
    }
    const id = route.params.id
    if (!id) return
    await sdk()
      .client.session.update({ sessionID: id, permissionTier: tier })
      .catch(() => {
        showToast({ title: language.t("common.requestFailed") })
      })
  }

  const previewPrompt = () =>
    prompt
      .current()
      .map((part) => {
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        if (part.type === "image") return `[image:${part.filename}]`
        return part.content
      })
      .join("")
      .trim()

  createEffect(() => {
    if (!prompt.ready()) return
    setSessionHandoff(route.sessionKey(), { prompt: previewPrompt() })
  })

  const rolled = createMemo(() => (props.revert?.items.length ? props.revert : undefined))
  const lift = createMemo(() => (rolled() ? 18 : 0))

  const openParent = () => {
    const id = parentID()
    if (!id) return
    const key = route.params.serverKey
    if (!key) return
    navigate(sessionHref(requireServerKey(key), id))
  }

  const ready = Promise.resolve()
  const [promptReadyResource] = createResource(
    () => prompt.ready.promise ?? ready,
    (promise) => promise.then(() => true),
  )

  return (
    <div
      ref={props.setPromptDockRef}
      data-component="session-prompt-dock"
      classList={{
        "w-full flex flex-col justify-center items-center pointer-events-none": true,
        "shrink-0 pb-3 bg-background-stronger": props.placement !== "inline",
      }}
    >
      <div
        classList={{
          "w-full pointer-events-auto": true,
          "px-3": props.placement !== "inline",
          [NEW_SESSION_CONTENT_WIDTH]: props.placement === "inline",
          "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
        }}
      >
        <Show when={props.state.questionRequest()} keyed>
          {(request) => (
            <div>
              <SessionQuestionDock request={request} sessionID={route.params.id} onSubmit={props.onResponseSubmit} />
            </div>
          )}
        </Show>

        <Show when={props.state.permissionRequest()} keyed>
          {(request) => (
            <div>
              <SessionPermissionDock
                request={request}
                responding={props.state.permissionResponding()}
                sessionID={route.params.id}
                onDecide={(response) => {
                  props.onResponseSubmit()
                  props.state.decide(response)
                }}
              />
            </div>
          )}
        </Show>

        <PermissionTierSelector mode={tierMode()} agent={tierAgent()} value={tierValue()} onChange={onTierChange} />

        <Show when={showComposer()}>
          <Show
            when={promptReadyResource()}
            fallback={
              <>
                <Show when={rolled()} keyed>
                  {(revert) => (
                    <div class="pb-2">
                      <SessionRevertDock
                        items={revert.items}
                        restoring={revert.restoring}
                        disabled={revert.disabled}
                        onRestore={revert.onRestore}
                      />
                    </div>
                  )}
                </Show>
                <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                  {handoffPrompt() || language.t("prompt.loading")}
                </div>
              </>
            }
          >
            <Show when={rolled()} keyed>
              {(revert) => (
                <div>
                  <SessionRevertDock
                    items={revert.items}
                    restoring={revert.restoring}
                    disabled={revert.disabled}
                    onRestore={revert.onRestore}
                  />
                </div>
              )}
            </Show>
            <div
              classList={{
                "relative z-10": true,
              }}
              style={{
                "margin-top": `${-lift()}px`,
              }}
            >
              <Show when={props.followup?.items.length}>
                <SessionFollowupDock
                  items={props.followup!.items}
                  sending={props.followup!.sending}
                  onSend={props.followup!.onSend}
                  onEdit={props.followup!.onEdit}
                />
              </Show>
              <Show
                when={child()}
                fallback={
                  <Show when={!props.state.blocked()}>
                    <PromptInput
                      controls={controls()}
                      variant={props.placement === "inline" ? "new-session" : undefined}
                      ref={props.inputRef}
                      newSessionWorktree={props.newSessionWorktree}
                      onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                      edit={props.followup?.edit}
                      onEditLoaded={props.followup?.onEditLoaded}
                      shouldQueue={props.followup?.queue}
                      onQueue={props.followup?.onQueue}
                      onAbort={props.followup?.onAbort}
                      onSubmit={props.onSubmit}
                    />
                  </Show>
                }
              >
                <div
                  ref={props.inputRef}
                  class="flex items-center gap-3 w-full rounded-[12px] border border-border-weak-base bg-v2-background-bg-layer-01 p-4 text-14-regular"
                >
                  <div class="shrink-0 size-8 flex items-center justify-center rounded-full bg-v2-background-bg-deep">
                    <Icon name="circle-ban-sign" class="text-icon-muted" size="small" />
                  </div>
                  <div class="flex flex-col gap-1 min-w-0">
                    <span class="text-text-weak">{language.t("session.child.promptDisabled")}</span>
                    <Show when={parentID()}>
                      <button
                        type="button"
                        class="flex items-center gap-1 text-text-base font-medium transition-colors hover:text-text-strong w-fit"
                        onClick={openParent}
                      >
                        <Icon name="arrow-left" size="small" />
                        {language.t("session.child.backToParent")}
                      </button>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
