import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useModeDirectory } from "@/pages/mode-workspace-context"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import { getFilename } from "@aigcfroge/core/util/path"
import { useCustomDraft } from "@/context/custom-draft"
import type { DirectorySDK } from "@/context/sdk"

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
  const [activeCategory, setActiveCategory] = createSignal<"all" | "agents" | "prompts" | "skills">("all")

  const [discovered, { refetch }] = createResource(props.dirSdk, async (sdk) => {
    if (!sdk) return { agents: [], prompts: [], skills: [] }
    try {
      const [agentsRes, promptsRes, skillsRes] = await Promise.all([
        sdk.client.agentAsset.list().catch(() => ({ data: { assets: [] } })),
        sdk.client.promptAsset.list().catch(() => ({ data: { assets: [] } })),
        sdk.client.skillAsset.list().catch(() => ({ data: { assets: [] } })),
      ])

      return {
        agents: agentsRes.data?.assets ?? [],
        prompts: promptsRes.data?.assets ?? [],
        skills: skillsRes.data?.assets ?? [],
      }
    } catch {
      return { agents: [], prompts: [], skills: [] }
    }
  })

  const query = createMemo(() => search().toLowerCase().trim())

  const filteredAgents = createMemo(() => {
    const list = discovered()?.agents ?? []
    const q = query()
    if (!q) return list
    return list.filter((a) => a.name.toLowerCase().includes(q) || (a.description ?? "").toLowerCase().includes(q))
  })

  const filteredPrompts = createMemo(() => {
    const list = discovered()?.prompts ?? []
    const q = query()
    if (!q) return list
    return list.filter((p) => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q))
  })

  const filteredSkills = createMemo(() => {
    const list = discovered()?.skills ?? []
    const q = query()
    if (!q) return list
    return list.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q))
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
          {language.t("custom.sidebar.agents")} ({discovered()?.agents.length ?? 0})
        </button>
        <button
          type="button"
          class={`rounded px-2 py-0.5 text-11-medium transition-colors ${activeCategory() === "prompts" ? "bg-v2-background-bg-layer-03 text-v2-text-text-base" : "text-v2-text-text-muted hover:text-v2-text-text-base"}`}
          onClick={() => setActiveCategory("prompts")}
        >
          {language.t("custom.sidebar.prompts")} ({discovered()?.prompts.length ?? 0})
        </button>
        <button
          type="button"
          class={`rounded px-2 py-0.5 text-11-medium transition-colors ${activeCategory() === "skills" ? "bg-v2-background-bg-layer-03 text-v2-text-text-base" : "text-v2-text-text-muted hover:text-v2-text-text-base"}`}
          onClick={() => setActiveCategory("skills")}
        >
          {language.t("custom.sidebar.skills")} ({discovered()?.skills.length ?? 0})
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
                  const isPrimary = () => (agent.name ?? agent.relativePath.replace(/\.md$/, "")) === draft.state.primaryAgent

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
                        <Show when={isPrimary()}>
                          <span class="rounded bg-blue-500/15 px-1 py-0.2 text-9-bold text-blue-400 uppercase">
                            {language.t("custom.builder.primaryBadge")}
                          </span>
                        </Show>
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
                    (draft.state.bindings["orchestrator"]?.prompts ?? []).some((p) => p.relativePath === prompt.relativePath)

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
                    (draft.state.bindings["orchestrator"]?.skills ?? []).some((s) => s.relativePath === skill.relativePath)

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

        {/* Zero state: No agents in project */}
        <Show when={(discovered()?.agents ?? []).length === 0}>
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
