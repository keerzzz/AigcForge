import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useModeDirectory } from "@/pages/mode-workspace-context"
import { useGlobal } from "@/context/global"
import { getFilename } from "@aigcfroge/core/util/path"
import { useCustomDraft } from "@/context/custom-draft"
import type { DirectorySDK } from "@/context/sdk"
import { catalogStatus, foldAssetCatalog, listOutcome, showsEmptyState } from "./custom-asset-catalog"
import { useModeSlotActive, whenActive } from "@/pages/mode-slot-active"

type AssetCategory = "all" | "agents" | "workflows" | "prompts" | "skills" | "commands"

export interface CustomSidebarProps {
  dirSdk: () => DirectorySDK | undefined
  refetchAssets?: () => void
}

export function CustomProjectColumnSidebar(props: CustomSidebarProps) {
  const language = useLanguage()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const { conn, ctx, directory } = useModeDirectory()
  const draft = useCustomDraft()
  const [search, setSearch] = createSignal("")
  const [activeCategory, setActiveCategory] = createSignal<AssetCategory>("all")
  const [commandConsumer, setCommandConsumer] = createSignal("orchestrator")

  // P2-14: hidden mode slots must not issue asset requests.
  const slotActive = useModeSlotActive()
  const [discovered, { refetch }] = createResource(
    () => whenActive(slotActive(), props.dirSdk),
    async (sdk) => {
      if (!sdk) return undefined
      // `allSettled`, not `all` with per-call catches: a failing kind has to be
      // reported as a failure instead of arriving as an empty list. See
      // custom-asset-catalog.ts (P2-10 / P2-13).
      const [agents, workflows, prompts, skills, commands] = await Promise.allSettled([
        sdk.client.agentAsset.list(),
        sdk.client.workflowAsset.list(),
        sdk.client.promptAsset.list(),
        sdk.client.skillAsset.list(),
        sdk.client.commandAsset.list(),
      ])
      return foldAssetCatalog({
        agents: listOutcome(agents),
        workflows: listOutcome(workflows),
        prompts: listOutcome(prompts),
        skills: listOutcome(skills),
        commands: listOutcome(commands),
      })
    },
  )

  const status = createMemo(() => catalogStatus({ loading: discovered.loading, failed: discovered.latest?.failed }))
  const failedKinds = createMemo(() => discovered.latest?.failed ?? [])
  const catalog = createMemo(() => discovered.latest)

  const query = createMemo(() => search().toLowerCase().trim())

  const filteredAgents = createMemo(() => {
    const list = catalog()?.agents ?? []
    const q = query()
    if (!q) return list
    return list.filter((a) => a.name.toLowerCase().includes(q) || (a.description ?? "").toLowerCase().includes(q))
  })

  const filteredPrompts = createMemo(() => {
    const list = catalog()?.prompts ?? []
    const q = query()
    if (!q) return list
    return list.filter((p) => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q))
  })

  const filteredWorkflows = createMemo(() => {
    const list = catalog()?.workflows ?? []
    const q = query()
    if (!q) return list
    return list.filter(
      (workflow) => workflow.name.toLowerCase().includes(q) || (workflow.description ?? "").toLowerCase().includes(q),
    )
  })

  const filteredSkills = createMemo(() => {
    const list = catalog()?.skills ?? []
    const q = query()
    if (!q) return list
    return list.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q))
  })

  const filteredCommands = createMemo(() => {
    const list = catalog()?.commands ?? []
    const q = query()
    if (!q) return list
    return list.filter(
      (command) => command.name.toLowerCase().includes(q) || (command.description ?? "").toLowerCase().includes(q),
    )
  })

  function addProject() {
    const current = conn()
    const currentCtx = ctx()
    if (!current || !currentCtx) return
    pickDirectory({
      server: current,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const dirs = (Array.isArray(result) ? result : [result]).filter((d): d is string => Boolean(d))
        if (!dirs[0]) return
        dirs.forEach((d) => currentCtx.projects.open(d))
        currentCtx.projects.touch(dirs[0])
        global.lastSession.set(currentCtx.sdk.scope, dirs[0])
      },
    })
  }

  function handleCreateStarterAgent() {
    draft.addAgent({
      kind: "agent",
      relativePath: "custom-assistant.md",
      revision: "",
      name: "custom-assistant",
      description: "Custom assistant agent",
    })
  }

  return (
    <div class="flex min-h-0 shrink-0 flex-col gap-3">
      {/* Project selector */}
      <div class="flex items-center gap-1.5 border-b border-v2-border-border-base px-3 pb-3 pt-3">
        <Icon name="folder" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="shrink-0 text-v2-text-text-muted text-11-regular">{language.t("chat.feature.project")}</span>
        <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-11-regular">
          {directory() ? getFilename(directory()) || directory() : language.t("chat.feature.noLocation")}
        </span>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="folder-add-left" />}
          aria-label={language.t("sidebar.secondary.addProject")}
          onClick={addProject}
        />
      </div>

      {/* Header & refresh */}
      <div class="flex items-center justify-between px-3">
        <span class="text-v2-text-text-muted text-11-regular [font-weight:440]">
          {language.t("custom.sidebar.assetsTitle")}
        </span>
        <IconButtonV2
          variant="ghost-muted"
          size="small"
          icon={<Icon name="plus-small" />}
          aria-label={language.t("common.refresh")}
          onClick={() => refetch()}
        />
      </div>

      {/* Search filter */}
      <div class="px-3">
        <div class="flex items-center gap-1.5 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 px-2 py-1">
          <Icon name="magnifying-glass" size="small" class="text-v2-text-text-muted shrink-0" />
          <input
            type="text"
            class="min-w-0 flex-1 bg-transparent text-12-regular text-v2-text-text-base placeholder:text-v2-text-text-muted focus:outline-none"
            placeholder={language.t("custom.sidebar.searchPlaceholder")}
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
      </div>

      {/* A failed read is reported instead of being rendered as an empty project */}
      <Show when={status() === "error" || status() === "partial"}>
        <div class="mx-3 flex items-center gap-2 rounded-md border border-v2-state-border-danger bg-v2-state-bg-danger px-2 py-1.5">
          <Icon name="warning" size="small" class="shrink-0 text-v2-state-fg-danger" />
          <span class="min-w-0 flex-1 text-11-regular text-v2-state-fg-danger">
            {status() === "error"
              ? language.t("custom.sidebar.loadFailed")
              : language.t("custom.sidebar.loadPartial", { kinds: failedKinds().join(", ") })}
          </span>
          <ButtonV2 variant="neutral" size="small" onClick={() => refetch()}>
            {language.t("custom.sidebar.loadRetry")}
          </ButtonV2>
        </div>
      </Show>

      {/* Category switcher */}
      <div class="flex items-center gap-1 px-3 overflow-x-auto pb-1">
        <button
          type="button"
          class={`rounded px-2 py-0.5 text-11-medium transition-colors ${activeCategory() === "all" ? "bg-v2-background-bg-layer-03 text-v2-text-text-base" : "text-v2-text-text-muted hover:text-v2-text-text-base"}`}
          onClick={() => setActiveCategory("all")}
        >
          {language.t("common.all")}
        </button>
        <button
          type="button"
          class={`rounded px-2 py-0.5 text-11-medium transition-colors ${activeCategory() === "agents" ? "bg-v2-background-bg-layer-03 text-v2-text-text-base" : "text-v2-text-text-muted hover:text-v2-text-text-base"}`}
          onClick={() => setActiveCategory("agents")}
        >
          {language.t("custom.sidebar.agents")} ({catalog()?.agents.length ?? 0})
        </button>
        <button
          type="button"
          class={`rounded px-2 py-0.5 text-11-medium transition-colors ${activeCategory() === "workflows" ? "bg-v2-background-bg-layer-03 text-v2-text-text-base" : "text-v2-text-text-muted hover:text-v2-text-text-base"}`}
          onClick={() => setActiveCategory("workflows")}
        >
          {language.t("custom.sidebar.workflows")} ({catalog()?.workflows.length ?? 0})
        </button>
        <button
          type="button"
          class={`rounded px-2 py-0.5 text-11-medium transition-colors ${activeCategory() === "prompts" ? "bg-v2-background-bg-layer-03 text-v2-text-text-base" : "text-v2-text-text-muted hover:text-v2-text-text-base"}`}
          onClick={() => setActiveCategory("prompts")}
        >
          {language.t("custom.sidebar.prompts")} ({catalog()?.prompts.length ?? 0})
        </button>
        <button
          type="button"
          class={`rounded px-2 py-0.5 text-11-medium transition-colors ${activeCategory() === "skills" ? "bg-v2-background-bg-layer-03 text-v2-text-text-base" : "text-v2-text-text-muted hover:text-v2-text-text-base"}`}
          onClick={() => setActiveCategory("skills")}
        >
          {language.t("custom.sidebar.skills")} ({catalog()?.skills.length ?? 0})
        </button>
        <button
          type="button"
          class={`rounded px-2 py-0.5 text-11-medium transition-colors ${activeCategory() === "commands" ? "bg-v2-background-bg-layer-03 text-v2-text-text-base" : "text-v2-text-text-muted hover:text-v2-text-text-base"}`}
          onClick={() => setActiveCategory("commands")}
        >
          {language.t("custom.sidebar.commands")} ({catalog()?.commands.length ?? 0})
        </button>
      </div>

      {/* Assets list */}
      <div class="flex flex-col gap-3 px-2 overflow-y-auto max-h-[calc(100vh-280px)]">
        {/* Agents */}
        <Show when={activeCategory() === "all" || activeCategory() === "agents"}>
          <div class="flex flex-col gap-1">
            <span class="px-2 text-10-medium uppercase tracking-wider text-v2-text-text-faint">
              {language.t("custom.sidebar.agents")}
            </span>
            <Show
              when={filteredAgents().length > 0}
              fallback={
                <div class="px-2 py-1 text-v2-text-text-faint text-11-regular">
                  {language.t("custom.sidebar.noAgents")}
                </div>
              }
            >
              <For each={filteredAgents()}>
                {(agent) => {
                  const isIncluded = () => draft.state.agents.some((a) => a.relativePath === agent.relativePath)

                  return (
                    <button
                      type="button"
                      class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                      onClick={() => {
                        if (isIncluded()) {
                          draft.removeAgent(agent.relativePath)
                          return
                        }
                        draft.addAgent({
                          kind: "agent",
                          relativePath: agent.relativePath,
                          revision: agent.revision,
                          name: agent.name,
                          description: agent.description,
                        })
                      }}
                    >
                      <div class="flex items-center gap-1.5 min-w-0">
                        <Icon name="mode-assistant" size="small" class="text-blue-400 shrink-0" />
                        <span class="text-12-regular text-v2-text-text-base truncate">{agent.name}</span>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <Show when={isIncluded()}>
                          <Icon name="check" size="small" class="text-emerald-400" />
                        </Show>
                      </div>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>

        <Show when={activeCategory() === "all" || activeCategory() === "workflows"}>
          <div class="flex flex-col gap-1">
            <span class="px-2 text-10-medium uppercase tracking-wider text-v2-text-text-faint">
              {language.t("custom.sidebar.workflows")}
            </span>
            <Show
              when={filteredWorkflows().length > 0}
              fallback={
                <div class="px-2 py-1 text-v2-text-text-faint text-11-regular">
                  {language.t("custom.sidebar.noWorkflows")}
                </div>
              }
            >
              <For each={filteredWorkflows()}>
                {(workflow) => {
                  const isSelected = () => draft.state.workflow?.relativePath === workflow.relativePath
                  return (
                    <button
                      type="button"
                      aria-pressed={isSelected()}
                      class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-v2-border-border-active"
                      onClick={() =>
                        draft.toggleWorkflow({
                          kind: "workflow",
                          relativePath: workflow.relativePath,
                          revision: workflow.revision,
                          name: workflow.name,
                          description: workflow.description,
                        })
                      }
                    >
                      <div class="flex min-w-0 items-center gap-1.5">
                        <Icon name="mode-custom" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                        <span class="truncate text-v2-text-text-base text-12-regular">{workflow.name}</span>
                      </div>
                      <Show when={isSelected()}>
                        <Icon name="check" size="small" class="shrink-0 text-v2-state-fg-success" />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>

        {/* Prompts */}
        <Show when={activeCategory() === "all" || activeCategory() === "prompts"}>
          <div class="flex flex-col gap-1">
            <span class="px-2 text-10-medium uppercase tracking-wider text-v2-text-text-faint">
              {language.t("custom.sidebar.prompts")}
            </span>
            <Show
              when={filteredPrompts().length > 0}
              fallback={
                <div class="px-2 py-1 text-v2-text-text-faint text-11-regular">
                  {language.t("custom.sidebar.noPrompts")}
                </div>
              }
            >
              <For each={filteredPrompts()}>
                {(prompt) => {
                  const isBound = () =>
                    (draft.state.bindings["orchestrator"]?.prompts ?? []).some(
                      (p) => p.relativePath === prompt.relativePath,
                    )

                  return (
                    <button
                      type="button"
                      class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                      onClick={() =>
                        draft.togglePrompt("orchestrator", {
                          kind: "prompt",
                          relativePath: prompt.relativePath,
                          revision: prompt.revision,
                          name: prompt.name,
                        })
                      }
                    >
                      <div class="flex items-center gap-1.5 min-w-0">
                        <Icon name="mode-chat" size="small" class="text-purple-400 shrink-0" />
                        <span class="text-12-regular text-v2-text-text-base truncate">{prompt.name}</span>
                      </div>
                      <Show when={isBound()}>
                        <Icon name="check" size="small" class="text-emerald-400 shrink-0" />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>

        <Show when={activeCategory() === "all" || activeCategory() === "commands"}>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2 px-2">
              <span class="text-10-medium uppercase tracking-wider text-v2-text-text-faint">
                {language.t("custom.sidebar.commands")}
              </span>
              <label class="flex min-w-0 items-center gap-1.5 text-v2-text-text-muted text-10-regular">
                <span class="shrink-0">{language.t("custom.sidebar.consumer")}</span>
                <select
                  aria-label={language.t("custom.sidebar.consumer")}
                  class="min-w-0 max-w-32 rounded border border-v2-border-border-base bg-v2-background-bg-layer-02 px-1.5 py-0.5 text-v2-text-text-base text-10-regular focus:border-v2-border-border-focus focus:outline-none"
                  value={commandConsumer()}
                  onChange={(event) => setCommandConsumer(event.currentTarget.value)}
                >
                  <option value="orchestrator">{language.t("custom.sidebar.consumerOrchestrator")}</option>
                  <For each={draft.state.agents}>
                    {(agent) => {
                      const name = agent.name ?? agent.relativePath.replace(/\.md$/, "")
                      return <option value={`agents/${name}`}>{name}</option>
                    }}
                  </For>
                </select>
              </label>
            </div>
            <Show
              when={filteredCommands().length > 0}
              fallback={
                <div class="px-2 py-1 text-v2-text-text-faint text-11-regular">
                  {language.t("custom.sidebar.noCommands")}
                </div>
              }
            >
              <For each={filteredCommands()}>
                {(command) => {
                  const isBound = () =>
                    (draft.state.bindings[commandConsumer()]?.commands ?? []).some(
                      (item) => item.relativePath === command.relativePath,
                    )
                  return (
                    <button
                      type="button"
                      aria-pressed={isBound()}
                      class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-v2-border-border-active"
                      onClick={() =>
                        draft.toggleCommand(commandConsumer(), {
                          kind: "command",
                          relativePath: command.relativePath,
                          revision: command.revision,
                          name: command.name,
                          description: command.description,
                        })
                      }
                    >
                      <div class="flex min-w-0 items-center gap-1.5">
                        <Icon name="settings-gear" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                        <span class="truncate text-v2-text-text-base text-12-regular">{command.name}</span>
                      </div>
                      <Show when={isBound()}>
                        <Icon name="check" size="small" class="shrink-0 text-v2-state-fg-success" />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>

        {/* Skills */}
        <Show when={activeCategory() === "all" || activeCategory() === "skills"}>
          <div class="flex flex-col gap-1">
            <span class="px-2 text-10-medium uppercase tracking-wider text-v2-text-text-faint">
              {language.t("custom.sidebar.skills")}
            </span>
            <Show
              when={filteredSkills().length > 0}
              fallback={
                <div class="px-2 py-1 text-v2-text-text-faint text-11-regular">
                  {language.t("custom.sidebar.noSkills")}
                </div>
              }
            >
              <For each={filteredSkills()}>
                {(skill) => {
                  const isBound = () =>
                    (draft.state.bindings["orchestrator"]?.skills ?? []).some(
                      (s) => s.relativePath === skill.relativePath,
                    )

                  return (
                    <button
                      type="button"
                      class="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-v2-overlay-simple-overlay-hover"
                      onClick={() =>
                        draft.toggleSkill("orchestrator", {
                          kind: "skill",
                          relativePath: skill.relativePath,
                          revision: skill.revision,
                          name: skill.name,
                        })
                      }
                    >
                      <div class="flex items-center gap-1.5 min-w-0">
                        <Icon name="mode-work" size="small" class="text-emerald-400 shrink-0" />
                        <span class="text-12-regular text-v2-text-text-base truncate">{skill.name}</span>
                      </div>
                      <Show when={isBound()}>
                        <Icon name="check" size="small" class="text-emerald-400 shrink-0" />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>

        {/* Zero state: a clean read that found no agents (never a failed one) */}
        <Show when={showsEmptyState({ status: status(), agentCount: catalog()?.agents.length ?? 0 })}>
          <div class="flex flex-col gap-2 rounded-md border border-dashed border-v2-border-border-base p-3 text-center mt-2">
            <span class="text-v2-text-text-muted text-12-regular">{language.t("custom.sidebar.emptyStarter")}</span>
            <ButtonV2 variant="neutral" size="small" icon="plus" onClick={handleCreateStarterAgent}>
              {language.t("custom.sidebar.createStarterAgent")}
            </ButtonV2>
          </div>
        </Show>
      </div>
    </div>
  )
}
