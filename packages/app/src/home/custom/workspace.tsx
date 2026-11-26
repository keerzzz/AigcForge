import { pathKey } from "@/workspaces/path-key"
import { useLocation, useNavigate } from "@solidjs/router"
import type { ModelSelection } from "@omnixa/client/promise"
import { Button } from "@omnixa/ui/button"
import { Dialog, DialogHeader, DialogTitleGroup, DialogFooter } from "@omnixa/ui/dialog"
import { useDialog } from "@omnixa/ui/context/dialog"
import { uuid } from "@/runtime/persistence/uuid"
import { createEffect, createMemo, For, lazy, onCleanup, Show, Suspense, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection } from "@/runtime/server/registry"
import { errorMessage } from "@/shell/layout/helpers"
import { useTabs } from "@/shell/tabs/tabs"
import type { HomeController } from "../model"
import {
  CUSTOM_WORKSPACE_STORAGE_KEY,
  CustomWorkspaceState,
  initialCustomWorkspaceState,
  type ComposeDraft,
  type CustomTab,
  type PendingTaskStart,
  type SelectedUse,
  type TaskMaterial,
} from "./draft"
import { clearStagedComposeDraft, peekPendingComposeHandoff, peekStagedComposeDraft } from "./handoff"
import type { CustomOwner } from "./shared"
import { CustomUseHome } from "./use-home"
import "./workspace.css"

const ComposeWorkspace = lazy(() => import("./compose-workspace"))
const AssetLibrary = lazy(() => import("./asset-library"))

const tabsOrder: readonly CustomTab[] = ["use", "compose", "assets"]

export function CustomWorkspace(props: { home: HomeController }) {
  const owner = createMemo(
    () => {
      const connection = props.home.server.focused()
      const server = connection ? ServerConnection.key(connection) : undefined
      const context = props.home.server.focusedContext()
      const selection = props.home.selection.value()

      return {
        connection,
        server,
        context,
        client: context?.sdk.api,
        directory:
          server && selection.server === server && !!props.home.project.selected() ? selection.directory : undefined,
      }
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.server === next?.server &&
        previous?.context === next?.context &&
        previous?.client === next?.client &&
        previous?.directory === next?.directory,
    },
  )

  // When arriving from Session Detail ("Edit in Compose workspace"), select the matching project automatically.
  createEffect(() => {
    const connection = props.home.server.focused()
    const context = props.home.server.focusedContext()

    if (!connection || !context) return
    const pending = peekPendingComposeHandoff(context.sdk.scope)

    if (!pending) return
    const projects = props.home.project.list()
    const match = projects.find((project) =>
      [project.worktree, ...(project.sandboxes ?? [])].some(
        (directory) => pathKey(directory) === pathKey(pending.directory),
      ),
    )

    if (!match) return
    const server = ServerConnection.key(connection)
    const selection = props.home.selection.value()

    if (selection.server === server && selection.directory === pending.directory) return
    untrack(() => props.home.selection.set({ server, directory: pending.directory }))
  })

  return (
    <Show when={owner()} keyed>
      {(selected) => <CustomWorkspaceContent home={props.home} owner={selected} current={() => owner() === selected} />}
    </Show>
  )
}

function CustomWorkspaceContent(props: { home: HomeController; owner: CustomOwner; current: () => boolean }) {
  const language = useLanguage()
  const tabs = useTabs()
  const dialog = useDialog()
  const lifetime = {
    active: true,
    modelAbort: new AbortController(),
    dialogAbort: new AbortController(),
    handoffNonce: 0,
  }

  // Persisted per server + Location; falls back to in-memory state when no project directory is selected yet.
  const persistedPair =
    props.owner.context && props.owner.directory
      ? persisted(
          Persist.serverWorkspace(props.owner.context.sdk.scope, props.owner.directory, CUSTOM_WORKSPACE_STORAGE_KEY),
          CustomWorkspaceState,
          initialCustomWorkspaceState(),
        )
      : undefined

  const [fallbackStore, setFallbackStore] = createStore<CustomWorkspaceState>(initialCustomWorkspaceState())
  const workspace = persistedPair ? persistedPair[0] : fallbackStore
  const storageReady = persistedPair ? persistedPair[3] : () => true

  function patchWorkspace(patch: Partial<CustomWorkspaceState>) {
    if (persistedPair) {
      persistedPair[1](patch)

      return
    }

    setFallbackStore(patch)
  }

  const [modelState, setModelState] = createStore<{
    model: ModelSelection | undefined
    defaultModel: ModelSelection | undefined
    loading: boolean
    error: string
  }>({
    model: undefined,
    defaultModel: undefined,
    loading: false,
    error: "",
  })

  const current = () => lifetime.active && props.current()
  const connected = () => props.owner.context?.sdk.connection.status() === "connected"

  onCleanup(() => {
    lifetime.active = false
    lifetime.modelAbort.abort()
    lifetime.dialogAbort.abort()
  })

  async function confirmDraftReplacement() {
    if (!current()) return false
    if (!workspace.compose.dirty) return true
    const editVersion = workspace.compose.editVersion
    const id = uuid()
    const confirmed = await new Promise<boolean>((resolve) => {
      const finish = (discard: boolean) => {
        resolve(discard)
        dialog.close(id)
      }
      const abort = () => finish(false)
      lifetime.dialogAbort.signal.addEventListener("abort", abort, { once: true })
      void dialog.show(
        () => (
          <Dialog fit>
            <DialogHeader>
              <DialogTitleGroup
                title={language.t("home.custom.compose.unsavedTitle")}
                description={language.t("home.custom.compose.unsavedDescription")}
              />
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" autofocus onClick={() => finish(false)}>
                {language.t("home.custom.compose.keepEditing")}
              </Button>
              <Button variant="contrast" onClick={() => finish(true)}>
                {language.t("home.custom.compose.discardContinue")}
              </Button>
            </DialogFooter>
          </Dialog>
        ),
        () => {
          lifetime.dialogAbort.signal.removeEventListener("abort", abort)
          resolve(false)
        },
        id,
        lifetime.dialogAbort.signal,
      )
    })
    return confirmed && current() && workspace.compose.editVersion === editVersion
  }

  async function openCompose(draft?: ComposeDraft) {
    if (draft && !(await confirmDraftReplacement())) return
    if (!current()) return
    patchWorkspace(draft ? { compose: draft, activeTab: "compose" } : { activeTab: "compose" })
  }

  const location = useLocation()
  const navigate = useNavigate()

  // Consume one-shot ?tab=compose handoff from the global navigation rail after storage hydration.
  createEffect(() => {
    if (!storageReady()) return
    const params = new URLSearchParams(location.search)
    if (params.get("tab") !== "compose") return
    params.delete("tab")
    const nextSearch = params.toString()
    untrack(() => {
      patchWorkspace({ activeTab: "compose" })
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`, { replace: true })
    })
  })

  // Consume any staged SnapshotV2 handoff from Session Detail once persisted storage has hydrated.
  createEffect(() => {
    const context = props.owner.context
    const directory = props.owner.directory

    if (!context || !directory || !storageReady()) return
    const staged = peekStagedComposeDraft(context.sdk.scope, directory)

    if (!staged || lifetime.handoffNonce === staged.nonce) return
    untrack(() => {
      lifetime.handoffNonce = staged.nonce
      void openCompose(staged.draft).then(() => {
        if (current()) clearStagedComposeDraft(staged.nonce)
      })
    })
  })

  // Load Session models ONLY after storage is hydrated and connection is up.
  createEffect(() => {
    const hydrated = storageReady()
    const isConnected = connected()
    const attempt = props.owner.context?.sdk.connection.attempt()

    if (!hydrated || !isConnected || !props.owner.directory || attempt === undefined) return
    untrack(() => void loadModels())
  })

  async function loadModels() {
    const context = props.owner.context
    const client = props.owner.client
    const directory = props.owner.directory

    if (!current() || !storageReady() || !connected() || !context || !client || !directory) return
    lifetime.modelAbort.abort()
    const controller = new AbortController()
    lifetime.modelAbort = controller
    setModelState({ loading: true, error: "" })

    try {
      const [, selected] = await Promise.all([
        context.data.location.model.sync({ directory }),
        client.model.default({ location: { directory } }, { signal: controller.signal }),
        context.data.location.model.group.definition.sync({ directory }),
      ])

      if (!current() || controller.signal.aborted) return
      const groups = context.data.location.model.group.definition.list({ directory })
      setModelState({ defaultModel: groups?.defaultSelection ?? selected.data ?? undefined, loading: false })
    } catch (error) {
      if (!current() || controller.signal.aborted) return
      setModelState({ loading: false, error: errorMessage(error, language.t("home.custom.error.models")) })
    }
  }

  function openChatDraft(prompt: string) {
    const server = props.owner.server
    const directory = props.owner.directory

    if (!server || !directory) return
    void tabs.newDraft({ server, directory, mode: "chat" }, prompt)
  }

  function handleTabKeyDown(event: KeyboardEvent, index: number) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return
    event.preventDefault()

    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabsOrder.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % tabsOrder.length
            : (index - 1 + tabsOrder.length) % tabsOrder.length

    const nextTab = tabsOrder[nextIndex]

    if (nextTab) patchWorkspace({ activeTab: nextTab })
  }

  return (
    <div data-component="custom-workspace">
      <div data-component="custom-workspace-tabs">
        <div role="tablist" aria-label={language.t("home.custom.tabs.label")} data-slot="custom-tablist">
          <For each={tabsOrder}>
            {(tab, index) => (
              <button
                type="button"
                role="tab"
                data-slot="custom-tab"
                aria-selected={workspace.activeTab === tab}
                tabIndex={workspace.activeTab === tab ? 0 : -1}
                onClick={() => patchWorkspace({ activeTab: tab })}
                onKeyDown={(event) => handleTabKeyDown(event, index())}
              >
                <span>{language.t(`home.custom.tabs.${tab}`)}</span>
                <Show when={tab === "compose" && workspace.compose.dirty}>
                  <span data-slot="custom-unsaved">{language.t("home.custom.tabs.unsaved")}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>

      <Show
        when={storageReady()}
        fallback={
          <p role="status" class="text-[12px] text-v2-text-text-muted">
            {language.t("home.custom.compose.storageLoading")}
          </p>
        }
      >
        <Show when={workspace.activeTab === "use"}>
          <CustomUseHome
            home={props.home}
            owner={props.owner}
            active={() => workspace.activeTab === "use"}
            current={current}
            storageReady={storageReady}
            workspace={workspace}
            setSelectedUse={(next: SelectedUse) => patchWorkspace({ selectedUse: next })}
            setTaskInput={(text: string, materials: TaskMaterial[], pending?: PendingTaskStart) => {
              patchWorkspace({ taskText: text, taskMaterials: materials, pendingStart: pending })
            }}
            setPendingStart={(pending: PendingTaskStart | undefined) => patchWorkspace({ pendingStart: pending })}
            openCompose={(draft) => void openCompose(draft)}
            openAssets={() => patchWorkspace({ activeTab: "assets" })}
            openChatDraft={openChatDraft}
            model={() => modelState.model}
            defaultModel={() => modelState.defaultModel}
            modelsLoading={() => modelState.loading}
            modelError={() => modelState.error}
            onSelectModel={(model) => setModelState("model", model)}
            onRetryModels={() => void loadModels()}
          />
        </Show>

        <Show when={workspace.activeTab === "compose"}>
          <Suspense
            fallback={
              <p role="status" class="text-[12px] text-v2-text-text-muted">
                {language.t("common.loading")}
              </p>
            }
          >
            <ComposeWorkspace
              home={props.home}
              owner={props.owner}
              active={() => workspace.activeTab === "compose"}
              current={current}
              storageReady={storageReady}
              draft={workspace.compose}
              updateDraft={(mutate) => patchWorkspace({ compose: mutate(workspace.compose) })}
              replaceDraft={(next) => patchWorkspace({ compose: next })}
              confirmDraftReplacement={confirmDraftReplacement}
              openChatDraft={openChatDraft}
              model={() => modelState.model}
              defaultModel={() => modelState.defaultModel}
              modelsLoading={() => modelState.loading}
              modelError={() => modelState.error}
              onSelectModel={(model) => setModelState("model", model)}
              onRetryModels={() => void loadModels()}
            />
          </Suspense>
        </Show>

        <Show when={workspace.activeTab === "assets"}>
          <Suspense
            fallback={
              <p role="status" class="text-[12px] text-v2-text-text-muted">
                {language.t("common.loading")}
              </p>
            }
          >
            <AssetLibrary
              owner={props.owner}
              active={() => workspace.activeTab === "assets"}
              current={current}
              storageReady={storageReady}
              composeDraft={workspace.compose}
              updateCompose={(mutate) => patchWorkspace({ compose: mutate(workspace.compose) })}
              openCompose={() => patchWorkspace({ activeTab: "compose" })}
              openChatDraft={openChatDraft}
            />
          </Suspense>
        </Show>
      </Show>
    </div>
  )
}
