import { AgentAsset } from "@aigcfroge/schema/agent-asset"
import { Agent } from "@aigcfroge/schema/agent"
import { Composition } from "@aigcfroge/schema/composition"
import { Button } from "@aigcfroge/ui/button"
import { Schema } from "effect"
import { createEffect, createMemo, For, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { normalizeAgentList } from "@/runtime/server/global-sync/utils"
import { errorMessage } from "@/shell/layout/helpers"
import type { Owner } from "./custom-composition"

const decodeAssets = Schema.decodeUnknownSync(Schema.Array(AgentAsset.Summary))

const decodeInvalid = Schema.decodeUnknownSync(Schema.Array(AgentAsset.InvalidEntry))

const decodeInfo = Schema.decodeUnknownSync(AgentAsset.Info)

export function CustomAgentInventory(props: {
  owner: Owner
  current: () => boolean
  ready: () => boolean
  disabled: () => boolean
  root: () => Composition.Root
  agents: () => readonly Composition.AgentRef[]
  selectRoot: (root: Composition.AssetRoot) => void
  selectAgents: (agents: Composition.AgentRef[]) => void
}) {
  const language = useLanguage()
  const lifetime = { active: true, revision: 0, request: new AbortController(), read: new AbortController() }

  const [state, setState] = createStore<{
    assets: readonly AgentAsset.Summary[]
    invalid: readonly AgentAsset.InvalidEntry[]
    loading: boolean
    error: string
    reading: boolean
    contentError: string
    content: AgentAsset.Info | undefined
  }>({ assets: [], invalid: [], loading: false, error: "", reading: false, contentError: "", content: undefined })

  const current = () => lifetime.active && props.current()

  const configured = createMemo(() =>
    normalizeAgentList(
      props.owner.context?.data.location.agent.list({ directory: props.owner.directory ?? "" }) ?? [],
    ).filter((agent) => agent.originKind === "user" && !agent.originRelativePath),
  )

  const selected = (asset: AgentAsset.Summary) =>
    props.agents().some((ref) => ref.relativePath === asset.relativePath && ref.revision === String(asset.revision))

  const rootSelected = (asset: AgentAsset.Summary) => {
    const root = props.root()

    return (
      root.source === "asset" && root.relativePath === asset.relativePath && root.revision === String(asset.revision)
    )
  }

  onCleanup(() => {
    lifetime.active = false
    lifetime.request.abort()
    lifetime.read.abort()
  })
  createEffect(() => {
    const attempt = props.owner.context?.sdk.connection.attempt()

    if (!props.ready() || attempt === undefined) return
    untrack(() => void load())
  })
  createEffect(() => {
    if (props.owner.context?.sdk.connection.status() === "connected") return
    untrack(() => {
      lifetime.revision += 1
      lifetime.request.abort()
      lifetime.request = new AbortController()
      lifetime.read.abort()
      setState({ loading: false, reading: false })
    })
  })

  async function load() {
    const client = props.owner.client
    const directory = props.owner.directory
    const context = props.owner.context

    if (!props.ready() || !client || !directory || !context || state.loading) return
    const revision = ++lifetime.revision
    setState({ loading: true, error: "" })

    const [assets, catalog] = await Promise.allSettled([
      client["agent-asset"].list({ directory }, { signal: lifetime.request.signal }),
      context.data.location.agent.sync({ directory }),
    ])

    if (!current() || revision !== lifetime.revision) return
    setState("loading", false)

    if (assets.status === "fulfilled")
      setState({ assets: decodeAssets(assets.value.assets), invalid: decodeInvalid(assets.value.invalid) })

    if (assets.status === "rejected" || catalog.status === "rejected")
      setState(
        "error",
        errorMessage(
          assets.status === "rejected" ? assets.reason : catalog.status === "rejected" ? catalog.reason : undefined,
          language.t("home.custom.agents.error"),
        ),
      )
  }

  async function view(asset: AgentAsset.Summary) {
    const client = props.owner.client
    const directory = props.owner.directory

    if (!props.ready() || !client || !directory) return
    lifetime.read.abort()
    const request = new AbortController()
    lifetime.read = request
    setState({ reading: true, contentError: "", content: undefined })

    try {
      const content = decodeInfo(
        await client["agent-asset"].content({ directory, path: asset.relativePath }, { signal: request.signal }),
      )

      if (current() && !request.signal.aborted) setState({ reading: false, content })
    } catch (error) {
      if (current() && !request.signal.aborted)
        setState({ reading: false, contentError: errorMessage(error, language.t("home.custom.agents.contentError")) })
    }
  }

  function toggle(asset: AgentAsset.Summary) {
    const agents = props.agents().filter((ref) => ref.relativePath !== asset.relativePath)
    props.selectAgents(
      selected(asset)
        ? agents
        : [
            ...agents,
            new Composition.AgentRef({
              kind: "agent",
              relativePath: asset.relativePath,
              revision: Composition.Revision.make(asset.revision),
            }),
          ],
    )
  }

  return (
    <section role="region" aria-label={language.t("home.custom.agents.title")} class="flex min-w-0 flex-col gap-2">
      <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 class="font-medium">{language.t("home.custom.agents.title")}</h3>
        <Button size="small" variant="ghost" disabled={!props.ready() || state.loading} onClick={() => void load()}>
          {language.t("home.custom.agents.refresh")}
        </Button>
      </div>
      <p class="text-v2-text-text-muted">{language.t("home.custom.agents.hint")}</p>
      <Show when={state.loading}>
        <p role="status">{language.t("home.custom.agents.loading")}</p>
      </Show>
      <Show when={state.error}>
        <p role="alert">{state.error}</p>
      </Show>
      <Show
        when={state.assets.length > 0}
        fallback={<p class="text-v2-text-text-muted">{language.t("home.custom.agents.empty")}</p>}
      >
        <ul class="flex min-w-0 flex-col gap-2">
          <For each={state.assets}>
            {(asset) => (
              <li class="flex min-w-0 flex-col gap-1 rounded-[4px] border border-v2-border-border-base p-2">
                <div class="flex min-w-0 flex-wrap items-center gap-x-2">
                  <bdi class="break-all font-medium">{asset.name}</bdi>
                  <span class="text-v2-text-text-muted">
                    {asset.disabled
                      ? language.t("home.custom.agents.disabled")
                      : asset.hidden
                        ? language.t("home.custom.agents.hidden")
                        : asset.mode
                          ? language.t(`home.custom.agents.role.${asset.mode}`)
                          : language.t("home.custom.agents.invalid")}
                  </span>
                </div>
                <Show when={asset.description}>
                  <p class="break-words text-v2-text-text-muted">{asset.description}</p>
                </Show>
                <bdi class="break-all text-v2-text-text-muted">{asset.relativePath}</bdi>
                <code class="break-all text-[12px] text-v2-text-text-muted" title={asset.revision}>
                  {asset.revision}
                </code>
                <div class="flex flex-wrap gap-1">
                  <Button
                    size="small"
                    variant={rootSelected(asset) ? "neutral" : "ghost"}
                    aria-pressed={rootSelected(asset)}
                    disabled={
                      props.disabled() ||
                      asset.disabled ||
                      asset.hidden ||
                      asset.mode === "subagent" ||
                      asset.mode === undefined
                    }
                    onClick={() =>
                      props.selectRoot(
                        new Composition.AssetRoot({
                          source: "asset",
                          kind: "agent",
                          id: Agent.ID.make(asset.name),
                          relativePath: asset.relativePath,
                          revision: Composition.Revision.make(asset.revision),
                        }),
                      )
                    }
                  >
                    {language.t(rootSelected(asset) ? "home.custom.agents.rootSelected" : "home.custom.agents.root")}
                  </Button>
                  <Button
                    size="small"
                    variant={selected(asset) ? "neutral" : "ghost"}
                    aria-pressed={selected(asset)}
                    disabled={
                      props.disabled() ||
                      asset.disabled ||
                      asset.hidden ||
                      asset.mode === "primary" ||
                      asset.mode === undefined ||
                      props.root().id === asset.name
                    }
                    onClick={() => toggle(asset)}
                  >
                    {language.t(selected(asset) ? "home.custom.agents.remove" : "home.custom.agents.add")}
                  </Button>
                  <Button size="small" variant="ghost" disabled={!props.ready()} onClick={() => void view(asset)}>
                    {language.t("home.custom.agents.view")}
                  </Button>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={configured().length > 0}>
        <h3 class="font-medium">{language.t("home.custom.agents.config")}</h3>
        <p class="text-v2-text-text-muted">{language.t("home.custom.agents.configHint")}</p>
        <ul class="flex min-w-0 flex-col gap-1">
          <For each={configured()}>
            {(agent) => (
              <li>
                <bdi class="break-all">{agent.name}</bdi>
                <Show when={agent.description}>
                  <p class="text-v2-text-text-muted">{agent.description}</p>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <For each={state.invalid}>
        {(entry) => (
          <p role="status" class="break-all">
            {language.t("home.custom.agents.invalid")}: <bdi>{entry.relativePath}</bdi>
          </p>
        )}
      </For>
      <Show when={state.reading}>
        <p role="status">{language.t("home.custom.agents.contentLoading")}</p>
      </Show>
      <Show when={state.contentError}>
        <p role="alert">{state.contentError}</p>
      </Show>
      <Show when={state.content}>
        {(content) => (
          <section class="flex min-w-0 flex-col gap-1" aria-label={language.t("home.custom.agents.view")}>
            <div class="flex min-w-0 items-center justify-between gap-2">
              <bdi class="break-all font-medium">{content().name}</bdi>
              <Button size="small" variant="ghost" onClick={() => setState("content", undefined)}>
                {language.t("common.close")}
              </Button>
            </div>
            <bdi class="break-all text-v2-text-text-muted">{content().relativePath}</bdi>
            <code class="break-all text-[12px] text-v2-text-text-muted">{content().revision}</code>
            <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[4px] border border-v2-border-border-base p-2">
              {content().config}
            </pre>
            <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[4px] border border-v2-border-border-base p-2">
              {content().source}
            </pre>
          </section>
        )}
      </Show>
    </section>
  )
}
