import type {
  AgentAssetSummary,
  AssetPlacementTarget,
  CustomCompositionReferencesResponse,
  MCPAssetInfo,
  PluginAssetBridgeEntry,
  PluginInfo,
} from "@aigcfroge/client/promise"
import type { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { Badge } from "@aigcfroge/ui/badge"
import { Button } from "@aigcfroge/ui/button"
import { Select } from "@aigcfroge/ui/select"
import { createMediaQuery } from "@solid-primitives/media"
import { createEffect, createMemo, For, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"
import {
  ASSET_KINDS,
  consumerKeyForAgent,
  isScopedAssetKind,
  MAX_COMPOSITION_AGENTS,
  type AssetKind,
  type ComposeDraft,
  type ScopedAssetKind,
  type StoredBinding,
} from "./draft"
import type { CustomOwner } from "./shared"

const scopes: readonly AssetPlacement.Scope[] = ["location", "project", "global"]

type AssetListItem = {
  kind: AssetKind
  name: string
  description: string
  relativePath: string
  revision: string
  agentMeta?: Pick<AgentAssetSummary, "mode" | "hidden" | "disabled">
  sourceTag?: string
}

type InvalidItem = {
  relativePath: string
  errorTag: string
}

type DetailContent = {
  relativePath: string
  title: string
  revision: string
  body: string
  mcpInfo?: MCPAssetInfo
}

export function AssetLibrary(props: {
  owner: CustomOwner
  active: () => boolean
  current: () => boolean
  storageReady: () => boolean
  composeDraft: ComposeDraft
  updateCompose: (mutate: (draft: ComposeDraft) => ComposeDraft) => void
  openCompose: () => void
  openChatDraft: (prompt: string) => void
}) {
  const language = useLanguage()
  const mobile = createMediaQuery("(max-width: 767px)")

  const lifetime = {
    active: true,
    listRev: 0,
    detailRev: 0,
    refsRev: 0,
    pluginRev: 0,
    listAbort: new AbortController(),
    detailAbort: new AbortController(),
    refsAbort: new AbortController(),
    pluginAbort: new AbortController(),
  }

  const [state, setState] = createStore<{
    kind: AssetKind
    scope: AssetPlacement.Scope
    search: string
    items: AssetListItem[]
    invalid: InvalidItem[]
    target: AssetPlacementTarget | undefined
    bridged: PluginAssetBridgeEntry[]
    runtimePlugins: PluginInfo[]
    runtimePluginsError: string
    loading: boolean
    error: string
    selectedPath: string | undefined
    detail: DetailContent | undefined
    detailLoading: boolean
    detailError: string
    refs: CustomCompositionReferencesResponse | undefined
    refsLoading: boolean
    refsError: string
    mountRole: string
    notice: string
    deleteConfirm: boolean
    deleting: boolean
    deleteError: string
  }>({
    kind: "agent",
    scope: "location",
    search: "",
    items: [],
    invalid: [],
    target: undefined,
    bridged: [],
    runtimePlugins: [],
    runtimePluginsError: "",
    loading: false,
    error: "",
    selectedPath: undefined,
    detail: undefined,
    detailLoading: false,
    detailError: "",
    refs: undefined,
    refsLoading: false,
    refsError: "",
    mountRole: "orchestrator",
    notice: "",
    deleteConfirm: false,
    deleting: false,
    deleteError: "",
  })

  const current = () => lifetime.active && props.current() && props.active()
  const connected = () => props.owner.context?.sdk.connection.status() === "connected"
  const ready = () =>
    current() && props.storageReady() && connected() && !!props.owner.directory && !!props.owner.client

  const selectedItem = createMemo(() => state.items.find((item) => item.relativePath === state.selectedPath))

  const filteredItems = createMemo(() => {
    const q = state.search.trim().toLowerCase()

    if (!q) return state.items

    return state.items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.relativePath.toLowerCase().includes(q),
    )
  })

  const composeRoles = createMemo(() => [
    { key: "orchestrator", label: language.t("home.custom.compose.roleOrchestrator") },
    ...props.composeDraft.agents.map((agent) => {
      const name = agent.name ?? agent.relativePath.replace(/\.md$/i, "").split("/").at(-1) ?? agent.relativePath

      return { key: consumerKeyForAgent(name, agent.relativePath), label: name }
    }),
  ])

  const liveMcpServers = createMemo(
    () => props.owner.context?.data.location.mcp.server.list({ directory: props.owner.directory ?? "" }) ?? [],
  )

  onCleanup(() => {
    lifetime.active = false
    lifetime.listAbort.abort()
    lifetime.detailAbort.abort()
    lifetime.refsAbort.abort()
    lifetime.pluginAbort.abort()
  })

  // Load selected category ONLY when Asset Library tab is active and storage is hydrated.
  createEffect(() => {
    const active = props.active()
    const hydrated = props.storageReady()
    const isConnected = connected()
    const attempt = props.owner.context?.sdk.connection.attempt()
    const kind = state.kind
    const scope = state.scope

    if (!active || !hydrated || !isConnected || attempt === undefined) {
      untrack(() => {
        lifetime.listRev += 1
        lifetime.detailRev += 1
        lifetime.refsRev += 1
        lifetime.pluginRev += 1
        lifetime.listAbort.abort()
        lifetime.listAbort = new AbortController()
        lifetime.detailAbort.abort()
        lifetime.detailAbort = new AbortController()
        lifetime.refsAbort.abort()
        lifetime.refsAbort = new AbortController()
        lifetime.pluginAbort.abort()
        lifetime.pluginAbort = new AbortController()
        setState({ loading: false, detailLoading: false, refsLoading: false })
      })

      return
    }

    untrack(() => {
      void loadCategory(kind, scope)

      if (kind === "plugin") void loadRuntimePlugins()
    })
  })

  async function loadCategory(kind: AssetKind, scope: AssetPlacement.Scope) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    lifetime.listAbort.abort()
    const controller = new AbortController()
    lifetime.listAbort = controller
    const rev = ++lifetime.listRev
    setState({
      loading: true,
      error: "",
      items: [],
      invalid: [],
      target: undefined,
      bridged: [],
      selectedPath: undefined,
      detail: undefined,
      detailError: "",
      refs: undefined,
      refsError: "",
      deleteConfirm: false,
      deleteError: "",
      notice: "",
    })

    try {
      if (kind === "agent") {
        const res = await client["agent-asset"].list({ directory }, { signal: controller.signal })

        if (!current() || rev !== lifetime.listRev) return
        setState({
          items: res.assets.map((asset) => ({
            kind,
            name: asset.name,
            description: asset.description,
            relativePath: asset.relativePath,
            revision: asset.revision,
            agentMeta: { mode: asset.mode, hidden: asset.hidden, disabled: asset.disabled },
          })),
          invalid: res.invalid,
          loading: false,
        })

        return
      }

      if (kind === "prompt") {
        const res = await client["prompt-asset"].list({ directory, scope }, { signal: controller.signal })

        if (!current() || rev !== lifetime.listRev) return
        setState({
          items: res.assets.map((asset) => ({
            kind,
            name: asset.name,
            description: asset.description,
            relativePath: asset.relativePath,
            revision: asset.revision,
          })),
          invalid: res.invalid,
          target: res.target,
          loading: false,
        })

        return
      }

      if (kind === "skill") {
        const res = await client["skill-asset"].list({ directory, scope }, { signal: controller.signal })

        if (!current() || rev !== lifetime.listRev) return
        setState({
          items: res.assets.map((asset) => ({
            kind,
            name: asset.name,
            description: asset.description,
            relativePath: asset.relativePath,
            revision: asset.revision,
          })),
          invalid: res.invalid,
          target: res.target,
          loading: false,
        })

        return
      }

      if (kind === "command") {
        const res = await client["command-asset"].list({ directory, scope }, { signal: controller.signal })

        if (!current() || rev !== lifetime.listRev) return
        setState({
          items: res.assets.map((asset) => ({
            kind,
            name: asset.name,
            description: asset.description,
            relativePath: asset.relativePath,
            revision: asset.revision,
          })),
          invalid: res.invalid,
          target: res.target,
          loading: false,
        })

        return
      }

      if (kind === "workflow") {
        const res = await client["workflow-asset"].list({ directory }, { signal: controller.signal })

        if (!current() || rev !== lifetime.listRev) return
        setState({
          items: res.assets.map((asset) => ({
            kind,
            name: asset.name,
            description: asset.description,
            relativePath: asset.relativePath,
            revision: asset.revision,
          })),
          invalid: res.invalid,
          loading: false,
        })

        return
      }

      if (kind === "mcp") {
        const res = await client["mcp-asset"].list({ directory }, { signal: controller.signal })

        if (!current() || rev !== lifetime.listRev) return
        setState({
          items: res.assets.map((asset) => ({
            kind,
            name: asset.name,
            description: asset.description,
            relativePath: asset.relativePath,
            revision: asset.revision,
          })),
          invalid: res.invalid,
          loading: false,
        })

        return
      }

      const res = await client["plugin-asset"].list({ directory }, { signal: controller.signal })

      if (!current() || rev !== lifetime.listRev) return
      setState({
        items: res.assets.map((asset) => ({
          kind,
          name: asset.name,
          description: asset.description,
          relativePath: asset.relativePath,
          revision: asset.revision,
          sourceTag: asset.source,
        })),
        invalid: res.invalid,
        bridged: res.bridged,
        loading: false,
      })
    } catch (error) {
      if (!current() || rev !== lifetime.listRev) return
      setState({ loading: false, error: errorMessage(error, language.t("home.custom.assets.error")) })
    }
  }

  async function loadRuntimePlugins() {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    lifetime.pluginAbort.abort()
    const controller = new AbortController()
    lifetime.pluginAbort = controller
    const rev = ++lifetime.pluginRev
    setState("runtimePluginsError", "")

    try {
      // Strictly read-only runtime list: never triggers plugin check/update/install/activate.
      const response = await client.plugin.list({ location: { directory } }, { signal: controller.signal })

      if (!current() || rev !== lifetime.pluginRev) return
      setState("runtimePlugins", response.data)
    } catch (error) {
      if (!current() || rev !== lifetime.pluginRev) return
      setState("runtimePluginsError", errorMessage(error, language.t("home.custom.assets.error")))
    }
  }

  async function selectAsset(item: AssetListItem) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory) return
    lifetime.detailAbort.abort()
    const controller = new AbortController()
    lifetime.detailAbort = controller
    const rev = ++lifetime.detailRev
    setState({
      selectedPath: item.relativePath,
      detail: undefined,
      detailLoading: true,
      detailError: "",
      refs: undefined,
      refsError: "",
      deleteConfirm: false,
      deleteError: "",
      notice: "",
    })

    try {
      if (item.kind === "agent") {
        const info = await client["agent-asset"].content(
          { directory, path: item.relativePath },
          { signal: controller.signal },
        )

        if (!current() || rev !== lifetime.detailRev) return
        setState({
          detailLoading: false,
          detail: {
            relativePath: info.relativePath,
            title: info.name,
            revision: info.revision,
            body: [info.config, info.source].filter(Boolean).join("\n\n"),
          },
        })

        return
      }

      if (item.kind === "prompt") {
        const info = await client["prompt-asset"].content(
          { directory, path: item.relativePath, scope: state.scope },
          { signal: controller.signal },
        )

        if (!current() || rev !== lifetime.detailRev) return
        setState({
          detailLoading: false,
          detail: { relativePath: info.relativePath, title: info.name, revision: info.revision, body: info.template },
        })

        return
      }

      if (item.kind === "skill") {
        const info = await client["skill-asset"].content(
          { directory, path: item.relativePath, scope: state.scope },
          { signal: controller.signal },
        )

        if (!current() || rev !== lifetime.detailRev) return
        setState({
          detailLoading: false,
          detail: { relativePath: info.relativePath, title: info.name, revision: info.revision, body: info.content },
        })

        return
      }

      if (item.kind === "command") {
        const info = await client["command-asset"].content(
          { directory, path: item.relativePath, scope: state.scope },
          { signal: controller.signal },
        )

        if (!current() || rev !== lifetime.detailRev) return
        setState({
          detailLoading: false,
          detail: {
            relativePath: info.relativePath,
            title: `${info.name} (${info.invocation})`,
            revision: info.revision,
            body: info.source,
          },
        })

        return
      }

      if (item.kind === "workflow") {
        const info = await client["workflow-asset"].content(
          { directory, path: item.relativePath },
          { signal: controller.signal },
        )

        if (!current() || rev !== lifetime.detailRev) return
        setState({
          detailLoading: false,
          detail: {
            relativePath: info.relativePath,
            title: info.name,
            revision: info.revision,
            body: info.content,
          },
        })

        return
      }

      if (item.kind === "mcp") {
        const info = await client["mcp-asset"].content(
          { directory, path: item.relativePath },
          { signal: controller.signal },
        )

        if (!current() || rev !== lifetime.detailRev) return
        setState({
          detailLoading: false,
          detail: {
            relativePath: info.relativePath,
            title: info.name,
            revision: info.revision,
            body: `command: ${[info.command, ...info.args].join(" ")}\n\n${info.configJson}`,
            mcpInfo: info,
          },
        })

        return
      }

      const info = await client["plugin-asset"].content(
        { directory, path: item.relativePath },
        { signal: controller.signal },
      )

      if (!current() || rev !== lifetime.detailRev) return
      setState({
        detailLoading: false,
        detail: { relativePath: info.relativePath, title: info.name, revision: info.revision, body: info.content },
      })
    } catch (error) {
      if (!current() || rev !== lifetime.detailRev) return
      setState({
        detailLoading: false,
        detailError: errorMessage(error, language.t("home.custom.agents.contentError")),
      })
    }
  }

  async function checkReferences(item: AssetListItem) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || item.kind === "plugin") return
    lifetime.refsAbort.abort()
    const controller = new AbortController()
    lifetime.refsAbort = controller
    const rev = ++lifetime.refsRev
    setState({ refsLoading: true, refsError: "", refs: undefined })

    try {
      // Scoped kinds (Prompt/Skill/Command) MUST pass scope and targetRoot paired together.
      const scopedTarget = isScopedAssetKind(item.kind) ? state.target : undefined
      const response = await client["custom-composition"].references(
        {
          directory,
          kind: item.kind,
          path: item.relativePath,
          ...(scopedTarget ? { scope: scopedTarget.scope, targetRoot: scopedTarget.root } : {}),
        },
        { signal: controller.signal },
      )

      if (!current() || rev !== lifetime.refsRev) return
      setState({ refs: response, refsLoading: false })
    } catch (error) {
      if (!current() || rev !== lifetime.refsRev) return
      setState({ refsLoading: false, refsError: errorMessage(error, language.t("home.custom.assets.refsError")) })
    }
  }

  async function deleteSelected(item: AssetListItem) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!ready() || !client || !directory || state.deleting) return
    setState({ deleting: true, deleteError: "", deleteConfirm: false })

    try {
      const target = isScopedAssetKind(item.kind) ? state.target : undefined

      if (item.kind === "agent") {
        await client["agent-asset"].remove({ directory, relativePath: item.relativePath, baseRevision: item.revision })
      } else if (item.kind === "prompt") {
        await client["prompt-asset"].remove({
          directory,
          relativePath: item.relativePath,
          baseRevision: item.revision,
          ...(target ? { target } : {}),
        })
      } else if (item.kind === "skill") {
        await client["skill-asset"].remove({
          directory,
          relativePath: item.relativePath,
          baseRevision: item.revision,
          ...(target ? { target } : {}),
        })
      } else if (item.kind === "command") {
        await client["command-asset"].remove({
          directory,
          relativePath: item.relativePath,
          baseRevision: item.revision,
          ...(target ? { target } : {}),
        })
      } else if (item.kind === "workflow") {
        await client["workflow-asset"].remove({
          directory,
          relativePath: item.relativePath,
          baseRevision: item.revision,
        })
      } else if (item.kind === "mcp") {
        await client["mcp-asset"].remove({ directory, relativePath: item.relativePath, baseRevision: item.revision })
      } else {
        await client["plugin-asset"].remove({ directory, relativePath: item.relativePath, baseRevision: item.revision })
      }

      if (!current()) return
      setState({ deleting: false, selectedPath: undefined, detail: undefined, refs: undefined })
      await loadCategory(state.kind, state.scope)

      if (!current()) return
      setState("notice", language.t("home.custom.assets.deleteDone"))
    } catch (error) {
      if (!current()) return
      setState({ deleting: false, deleteError: errorMessage(error, language.t("home.custom.assets.deleteError")) })
    }
  }

  function mountScopedAsset(kind: ScopedAssetKind, item: AssetListItem) {
    const role = composeRoles().some((entry) => entry.key === state.mountRole) ? state.mountRole : "orchestrator"
    const target = state.target ? { scope: state.target.scope, root: state.target.root } : undefined

    props.updateCompose((draft) => {
      const existing = draft.bindings[role] ?? { prompts: [], skills: [], commands: [] }
      const sameTarget = (refTarget: { scope: string; root: string } | undefined) =>
        (refTarget?.scope ?? "location") === (target?.scope ?? "location") &&
        (refTarget?.root ?? "") === (target?.root ?? "")

      const nextBinding: StoredBinding = {
        prompts:
          kind === "prompt"
            ? [
                ...existing.prompts.filter(
                  (ref) => !(ref.relativePath === item.relativePath && sameTarget(ref.target)),
                ),
                {
                  kind: "prompt",
                  relativePath: item.relativePath,
                  revision: item.revision,
                  ...(target ? { target } : {}),
                },
              ]
            : existing.prompts,
        skills:
          kind === "skill"
            ? [
                ...existing.skills.filter((ref) => !(ref.relativePath === item.relativePath && sameTarget(ref.target))),
                {
                  kind: "skill",
                  relativePath: item.relativePath,
                  revision: item.revision,
                  ...(target ? { target } : {}),
                },
              ]
            : existing.skills,
        commands:
          kind === "command"
            ? [
                ...existing.commands.filter(
                  (ref) => !(ref.relativePath === item.relativePath && sameTarget(ref.target)),
                ),
                {
                  kind: "command",
                  relativePath: item.relativePath,
                  revision: item.revision,
                  ...(target ? { target } : {}),
                },
              ]
            : existing.commands,
      }

      return {
        ...draft,
        selectedConsumer: role,
        dirty: true,
        editVersion: draft.editVersion + 1,
        bindings: { ...draft.bindings, [role]: nextBinding },
      }
    })
    setState("notice", language.t("home.custom.assets.mountedNotice", { role }))
  }

  function addMcpToCompose(item: AssetListItem) {
    const mcpInfo = state.detail?.mcpInfo
    const command = mcpInfo ? [mcpInfo.command, ...mcpInfo.args].filter(Boolean) : ["npx", item.name]
    props.updateCompose((draft) => ({
      ...draft,
      dirty: true,
      editVersion: draft.editVersion + 1,
      mcpBindings: [
        ...draft.mcpBindings.filter((entry) => entry.serverName !== item.name),
        {
          serverName: item.name,
          ref: { relativePath: item.relativePath, revision: item.revision },
          transport: "stdio",
          command,
        },
      ],
    }))
    setState("notice", language.t("home.custom.assets.mcpAddedNotice"))
  }

  const showList = () => !mobile() || !state.selectedPath
  const showDetail = () => !mobile() || !!state.selectedPath

  return (
    <section role="region" aria-label={language.t("home.custom.assets.title")} class="flex min-w-0 flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 class="text-[14px] font-medium leading-[var(--line-height-base)]">
            {language.t("home.custom.assets.title")}
          </h2>
          <p class="text-v2-text-text-muted">{language.t("home.custom.assets.description")}</p>
        </div>
        <Button
          type="button"
          size="small"
          variant="ghost"
          disabled={!ready() || state.loading}
          onClick={() => void loadCategory(state.kind, state.scope)}
        >
          {language.t("home.custom.assets.refresh")}
        </Button>
      </div>

      {/* 7-Kind Category Tabs (CustomProfile intentionally excluded) */}
      <div role="tablist" aria-label={language.t("home.custom.assets.title")} data-slot="custom-tablist">
        <For each={ASSET_KINDS}>
          {(kind) => (
            <button
              type="button"
              role="tab"
              data-slot="custom-tab"
              aria-selected={state.kind === kind}
              onClick={() => setState("kind", kind)}
            >
              {language.t(`home.custom.assets.kind.${kind}`)}
            </button>
          )}
        </For>
      </div>

      {/* Search + Explicit Scope Selector (ONLY for Prompt, Skill, Command) */}
      <div class="flex flex-wrap items-center gap-2">
        <input
          type="search"
          data-slot="custom-input"
          class="flex-1"
          aria-label={language.t("home.custom.assets.search")}
          placeholder={language.t("home.custom.assets.search")}
          value={state.search}
          onInput={(event) => setState("search", event.currentTarget.value)}
        />
        <Show when={isScopedAssetKind(state.kind)}>
          <div role="group" aria-label={language.t("home.custom.assets.scope.label")} class="flex flex-wrap gap-1">
            <For each={scopes}>
              {(scope) => (
                <Button
                  type="button"
                  size="small"
                  variant={state.scope === scope ? "neutral" : "ghost"}
                  aria-pressed={state.scope === scope}
                  onClick={() => setState("scope", scope)}
                >
                  {language.t(`home.custom.assets.scope.${scope}`)}
                </Button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show when={state.notice}>
        <p role="status" data-slot="custom-alert">
          {state.notice}
        </p>
      </Show>
      <Show when={state.error}>
        <p role="alert" data-slot="custom-alert">
          {state.error}
        </p>
      </Show>

      {/* Master-detail layout */}
      <div data-component="custom-assets-layout">
        <Show when={showList()}>
          <div data-component="custom-card">
            <Show when={state.kind === "plugin"}>
              <h3 class="text-[12px] font-medium text-v2-text-text-muted">
                {language.t("home.custom.assets.plugin.savedTitle")}
              </h3>
            </Show>
            <Show when={state.loading}>
              <p role="status" class="text-[12px] text-v2-text-text-muted">
                {language.t("home.custom.assets.loading")}
              </p>
            </Show>
            <Show
              when={filteredItems().length > 0}
              fallback={
                <Show when={!state.loading}>
                  <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.assets.empty")}</p>
                </Show>
              }
            >
              <ul class="flex flex-col gap-1.5">
                <For each={filteredItems()}>
                  {(item) => (
                    <li>
                      <button
                        type="button"
                        data-slot="custom-pick-item"
                        class="w-full"
                        aria-pressed={state.selectedPath === item.relativePath}
                        onClick={() => void selectAsset(item)}
                      >
                        <div class="flex w-full min-w-0 items-center justify-between gap-2">
                          <bdi class="truncate font-medium">{item.name}</bdi>
                          <Show when={item.agentMeta?.mode}>{(mode) => <Badge>{mode()}</Badge>}</Show>
                          <Show when={item.sourceTag}>{(src) => <Badge>{src()}</Badge>}</Show>
                        </div>
                        <Show when={item.description}>
                          <span class="line-clamp-2 break-words text-[12px] text-v2-text-text-muted">
                            {item.description}
                          </span>
                        </Show>
                        <code class="max-w-full truncate text-[11px] text-v2-text-text-muted">{item.relativePath}</code>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            <Show when={state.invalid.length > 0}>
              <details class="text-[12px] text-v2-text-text-muted">
                <summary class="cursor-pointer">
                  {language.t("home.custom.assets.invalidTitle", { count: state.invalid.length })}
                </summary>
                <ul class="mt-1 flex flex-col gap-1">
                  <For each={state.invalid}>
                    {(entry) => (
                      <li class="break-all">
                        <code>{entry.relativePath}</code> · {entry.errorTag}
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </Show>
          </div>
        </Show>

        <Show when={showDetail()}>
          <div data-component="custom-card">
            <Show when={mobile() && state.selectedPath}>
              <Button
                type="button"
                size="small"
                variant="ghost"
                onClick={() => setState({ selectedPath: undefined, detail: undefined })}
              >
                {language.t("home.custom.assets.backToList")}
              </Button>
            </Show>

            <Show
              when={selectedItem()}
              fallback={
                <p class="text-[12px] text-v2-text-text-muted">{language.t("home.custom.assets.detailEmpty")}</p>
              }
            >
              {(item) => (
                <div class="flex min-w-0 flex-col gap-2.5">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="min-w-0">
                      <h3 class="break-words font-medium">{item().name}</h3>
                      <p class="break-all text-[12px] text-v2-text-text-muted">
                        {item().relativePath} · <code class="text-[11px]">{item().revision.slice(0, 12)}</code>
                      </p>
                    </div>
                    <Badge>{language.t(`home.custom.assets.kind.${item().kind}`)}</Badge>
                  </div>

                  {/* Type-dispatched actions */}
                  <div class="flex flex-wrap items-center gap-1.5">
                    <Show when={item().kind === "agent"}>
                      <Button
                        type="button"
                        size="small"
                        variant="outline"
                        disabled={
                          item().agentMeta?.disabled ||
                          item().agentMeta?.hidden ||
                          item().agentMeta?.mode === "subagent" ||
                          item().agentMeta?.mode === undefined
                        }
                        onClick={() => {
                          props.updateCompose((draft) => ({
                            ...draft,
                            dirty: true,
                            editVersion: draft.editVersion + 1,
                            root: {
                              source: "asset",
                              kind: "agent",
                              id: item().name,
                              relativePath: item().relativePath,
                              revision: item().revision,
                            },
                            agents: draft.agents.filter((entry) => entry.relativePath !== item().relativePath),
                          }))
                          props.openCompose()
                        }}
                      >
                        {language.t("home.custom.agents.root")}
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="outline"
                        disabled={
                          item().agentMeta?.disabled ||
                          item().agentMeta?.hidden ||
                          item().agentMeta?.mode === "primary" ||
                          item().agentMeta?.mode === undefined ||
                          props.composeDraft.agents.length >= MAX_COMPOSITION_AGENTS
                        }
                        onClick={() => {
                          props.updateCompose((draft) => ({
                            ...draft,
                            dirty: true,
                            editVersion: draft.editVersion + 1,
                            agents: [
                              ...draft.agents.filter((entry) => entry.relativePath !== item().relativePath),
                              {
                                kind: "agent",
                                relativePath: item().relativePath,
                                revision: item().revision,
                                name: item().name,
                              },
                            ],
                          }))
                          props.openCompose()
                        }}
                      >
                        {language.t("home.custom.agents.add")}
                      </Button>
                    </Show>

                    <Show when={isScopedAssetKind(item().kind)}>
                      <Select
                        aria-label={language.t("home.custom.assets.mountRoleLabel")}
                        options={composeRoles()}
                        value={(option) => option.key}
                        label={(option) => option.label}
                        current={composeRoles().find((entry) => entry.key === state.mountRole) ?? composeRoles()[0]}
                        onSelect={(option) => {
                          if (option) setState("mountRole", option.key)
                        }}
                      />
                      <Button
                        type="button"
                        size="small"
                        variant="outline"
                        onClick={() => {
                          const currentItem = item()

                          if (isScopedAssetKind(currentItem.kind)) mountScopedAsset(currentItem.kind, currentItem)
                        }}
                      >
                        {language.t("home.custom.compose.mountAsset")}
                      </Button>
                    </Show>

                    <Show when={item().kind === "workflow"}>
                      <Button
                        type="button"
                        size="small"
                        variant="outline"
                        onClick={() => {
                          props.updateCompose((draft) => ({
                            ...draft,
                            dirty: true,
                            editVersion: draft.editVersion + 1,
                            workflow: {
                              kind: "workflow",
                              relativePath: item().relativePath,
                              revision: item().revision,
                              name: item().name,
                            },
                          }))
                          setState("notice", language.t("home.custom.assets.workflowSelectedNotice"))
                        }}
                      >
                        {language.t("home.custom.compose.workflowSelect")}
                      </Button>
                    </Show>

                    <Show when={item().kind === "mcp"}>
                      <Button type="button" size="small" variant="outline" onClick={() => addMcpToCompose(item())}>
                        {language.t("home.custom.compose.mcpAdd")}
                      </Button>
                    </Show>

                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!props.owner.directory}
                      onClick={() =>
                        props.openChatDraft(
                          `Review and propose an updated ${item().kind} asset for ${item().relativePath} (${item().name}).`,
                        )
                      }
                    >
                      {language.t("home.custom.assets.editInChat")}
                    </Button>

                    <Show when={item().kind !== "plugin"}>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        disabled={!ready() || state.refsLoading}
                        onClick={() => void checkReferences(item())}
                      >
                        {language.t(
                          state.refsLoading ? "home.custom.assets.checkingRefs" : "home.custom.assets.checkRefs",
                        )}
                      </Button>
                    </Show>

                    <Show when={!state.deleteConfirm}>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        disabled={!ready() || state.deleting}
                        onClick={() => setState("deleteConfirm", true)}
                      >
                        {language.t("home.custom.assets.delete")}
                      </Button>
                    </Show>
                  </div>

                  <Show when={item().kind === "plugin"}>
                    <p class="text-[12px] text-v2-text-text-muted">
                      {language.t("home.custom.assets.plugin.notMountable")}
                    </p>
                  </Show>

                  <Show when={state.deleteConfirm}>
                    <div role="alert" data-slot="custom-alert" class="flex flex-col gap-2">
                      <p>{language.t("home.custom.assets.deleteConfirm", { path: item().relativePath })}</p>
                      <div class="flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="small"
                          variant="contrast"
                          disabled={state.deleting}
                          onClick={() => void deleteSelected(item())}
                        >
                          {language.t(state.deleting ? "home.custom.assets.deleting" : "home.custom.assets.delete")}
                        </Button>
                        <Button
                          type="button"
                          size="small"
                          variant="ghost"
                          onClick={() => setState("deleteConfirm", false)}
                        >
                          {language.t("common.cancel")}
                        </Button>
                      </div>
                    </div>
                  </Show>

                  <Show when={state.deleteError}>
                    <p role="alert" class="text-[12px]">
                      {state.deleteError}
                    </p>
                  </Show>

                  {/* References display with explicit incomplete-snapshot warning */}
                  <Show when={state.refsError}>
                    <p role="alert" class="text-[12px]">
                      {state.refsError}
                    </p>
                  </Show>
                  <Show when={state.refs}>
                    {(refs) => (
                      <div data-slot="custom-alert" class="flex flex-col gap-1.5">
                        <Show when={!refs().snapshotsComplete}>
                          <p role="alert" class="font-medium">
                            {language.t("home.custom.assets.refsSnapshotsIncomplete")}
                          </p>
                        </Show>
                        <Show
                          when={refs().profiles.length > 0 || refs().snapshots.length > 0 || !refs().snapshotsComplete}
                          fallback={<p class="text-v2-text-text-muted">{language.t("home.custom.assets.refsNone")}</p>}
                        >
                          <p class="font-medium">
                            {language.t("home.custom.assets.refsProfiles", { count: refs().profiles.length })}
                          </p>
                          <Show when={refs().profiles.length > 0}>
                            <ul class="flex flex-col gap-0.5">
                              <For each={refs().profiles}>
                                {(profile) => (
                                  <li class="break-all">
                                    {profile.name} (<code>{profile.relativePath}</code>)
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                          <p class="font-medium">
                            {language.t("home.custom.assets.refsSnapshots", { count: refs().snapshots.length })}
                          </p>
                          <Show when={refs().snapshots.length > 0}>
                            <ul class="flex flex-col gap-0.5">
                              <For each={refs().snapshots}>
                                {(snap) => (
                                  <li class="break-all">
                                    <code>{snap.sessionID}</code> · {snap.digest.slice(0, 12)}
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                        </Show>
                      </div>
                    )}
                  </Show>

                  {/* Asset Content Preview */}
                  <Show when={state.detailLoading}>
                    <p role="status" class="text-[12px] text-v2-text-text-muted">
                      {language.t("home.custom.agents.contentLoading")}
                    </p>
                  </Show>
                  <Show when={state.detailError}>
                    <p role="alert" class="text-[12px]">
                      {state.detailError}
                    </p>
                  </Show>
                  <Show when={state.detail}>
                    {(detail) => <pre data-slot="custom-code-block">{detail().body}</pre>}
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>

      {/* Live MCP Runtime Status on MCP Tab (strictly read-only, zero connect probes) */}
      <Show when={state.kind === "mcp"}>
        <div data-component="custom-card" class="text-[12px]">
          <h3 class="font-medium">{language.t("home.custom.compose.mcpRuntimeTitle")}</h3>
          <Show
            when={liveMcpServers().length > 0}
            fallback={<p class="text-v2-text-text-muted">{language.t("home.custom.compose.mcpRuntimeEmpty")}</p>}
          >
            <ul class="flex flex-wrap gap-1.5">
              <For each={liveMcpServers()}>
                {(server) => (
                  <li data-slot="custom-chip">
                    <span>{server.name}</span>
                    <Badge>{server.status.status}</Badge>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>

      {/* Plugin 4-Way Separation (Saved Definitions above; Bridged, Runtime Server, GUI Extensions below) */}
      <Show when={state.kind === "plugin"}>
        <div data-component="custom-card" class="text-[12px]">
          <h3 class="font-medium">{language.t("home.custom.assets.plugin.bridgedTitle")}</h3>
          <Show
            when={state.bridged.length > 0}
            fallback={<p class="text-v2-text-text-muted">{language.t("home.custom.assets.plugin.bridgedEmpty")}</p>}
          >
            <ul class="flex flex-col gap-1">
              <For each={state.bridged}>
                {(entry) => (
                  <li class="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-v2-border-border-base px-2 py-1">
                    <span class="break-all">
                      <strong>{entry.name}</strong> · <Badge>{entry.source}</Badge> · {entry.originPath}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <h3 class="mt-2 font-medium">{language.t("home.custom.assets.plugin.runtimeTitle")}</h3>
          <Show when={state.runtimePluginsError}>
            <p role="alert">{state.runtimePluginsError}</p>
          </Show>
          <Show
            when={state.runtimePlugins.length > 0}
            fallback={<p class="text-v2-text-text-muted">{language.t("home.custom.assets.plugin.runtimeEmpty")}</p>}
          >
            <ul class="flex flex-col gap-1">
              <For each={state.runtimePlugins}>
                {(plugin) => (
                  <li class="flex flex-wrap items-center gap-2 rounded-[4px] border border-v2-border-border-base px-2 py-1">
                    <strong>
                      {plugin.id ??
                        (plugin.source.type === "package"
                          ? plugin.source.target
                          : plugin.source.type === "local"
                            ? plugin.source.path
                            : plugin.source.type)}
                    </strong>
                    <Badge>{plugin.state.status}</Badge>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <p class="mt-2 text-v2-text-text-muted">{language.t("home.custom.assets.plugin.guiNote")}</p>
        </div>
      </Show>
    </section>
  )
}

export default AssetLibrary
