import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { useCustomDraft } from "@/context/custom-draft"

export function CustomCompositionConfig() {
  const language = useLanguage()
  const draft = useCustomDraft()

  const boundPrompts = createMemo(() => draft.state.bindings["orchestrator"]?.prompts ?? [])
  const boundSkills = createMemo(() => draft.state.bindings["orchestrator"]?.skills ?? [])

  return (
    <div class="flex flex-col gap-6">
      {/* Mode / Source Switcher */}
      <div class="flex flex-col gap-2">
        <label class="text-v2-text-text-muted text-12-medium uppercase tracking-wider">
          {language.t("custom.builder.sourceMode")}
        </label>
        <div class="inline-flex rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-1 max-w-sm">
          <button
            type="button"
            class={`flex-1 rounded-md px-3 py-1.5 text-12-medium transition-colors ${draft.state.source === "temporary" ? "bg-v2-background-bg-layer-03 text-v2-text-text-base shadow-sm" : "text-v2-text-text-muted hover:text-v2-text-text-base"}`}
            onClick={() => draft.setSource("temporary")}
          >
            {language.t("custom.builder.sourceTemporary")}
          </button>
          <button
            type="button"
            class={`flex-1 rounded-md px-3 py-1.5 text-12-medium transition-colors ${draft.state.source === "profile" ? "bg-v2-background-bg-layer-03 text-v2-text-text-base shadow-sm" : "text-v2-text-text-muted hover:text-v2-text-text-base"}`}
            onClick={() => draft.setSource("profile")}
          >
            {language.t("custom.builder.sourceProfile")}
          </button>
        </div>
      </div>

      <Show
        when={draft.state.source === "temporary"}
        fallback={
          <div class="flex flex-col gap-2">
            <label class="text-v2-text-text-muted text-12-medium">
              {language.t("custom.builder.profilePathLabel")}
            </label>
            <input
              type="text"
              class="w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 px-3 py-2 text-13-regular text-v2-text-text-base placeholder:text-v2-text-text-muted focus:border-v2-border-border-focus focus:outline-none"
              placeholder=".aigcfroge/profiles/default.yaml"
              value={draft.state.profilePath ?? ""}
              onInput={(e) => draft.setProfilePath(e.currentTarget.value)}
            />
            <span class="text-v2-text-text-faint text-11-regular">
              {language.t("custom.builder.profilePathHelp")}
            </span>
          </div>
        }
      >
        {/* Primary Agent Section */}
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <label class="text-v2-text-text-muted text-12-medium uppercase tracking-wider">
              {language.t("custom.builder.primaryAgent")}
            </label>
          </div>
          <div class="rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-4 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="h-8 w-8 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-400">
                  <Icon name="mode-assistant" size="small" />
                </div>
                <div class="flex flex-col">
                  <span class="text-v2-text-text-base text-14-medium font-mono">
                    {draft.state.primaryAgent || language.t("custom.builder.noPrimaryAgent")}
                  </span>
                  <span class="text-v2-text-text-muted text-11-regular">
                    {language.t("custom.builder.primaryAgentDescription")}
                  </span>
                </div>
              </div>
            </div>

            <Show when={draft.state.agents.length > 1}>
              <div class="flex items-center gap-2 pt-2 border-t border-v2-border-border-base">
                <span class="text-v2-text-text-faint text-11-regular">{language.t("custom.builder.selectPrimary")}:</span>
                <select
                  class="rounded bg-v2-background-bg-layer-03 border border-v2-border-border-base px-2 py-1 text-12-regular text-v2-text-text-base focus:outline-none"
                  value={draft.state.primaryAgent}
                  onChange={(e) => draft.setPrimaryAgent(e.currentTarget.value)}
                >
                  <For each={draft.state.agents}>
                    {(agent) => {
                      const name = agent.name ?? agent.relativePath.replace(/\.md$/, "")
                      return <option value={name}>{name}</option>
                    }}
                  </For>
                </select>
              </div>
            </Show>
          </div>
        </div>

        {/* Included Agents */}
        <div class="flex flex-col gap-2">
          <label class="text-v2-text-text-muted text-12-medium uppercase tracking-wider">
            {language.t("custom.builder.includedAgents")} ({draft.state.agents.length})
          </label>
          <Show
            when={draft.state.agents.length > 0}
            fallback={
              <div class="rounded-lg border border-dashed border-v2-border-border-base p-4 text-center text-v2-text-text-muted text-12-regular">
                {language.t("custom.builder.noAgentsSelected")}
              </div>
            }
          >
            <div class="flex flex-wrap gap-2">
              <For each={draft.state.agents}>
                {(agent) => {
                  const name = agent.name ?? agent.relativePath.replace(/\.md$/, "")
                  const isPrimary = () => name === draft.state.primaryAgent

                  return (
                    <div class="inline-flex items-center gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 px-2.5 py-1.5 text-12-regular">
                      <Icon name="mode-assistant" size="small" class="text-blue-400 shrink-0" />
                      <span class="text-v2-text-text-base font-mono">{name}</span>
                      <Show when={isPrimary()}>
                        <span class="rounded bg-blue-500/15 px-1 py-0.2 text-9-bold text-blue-400 uppercase">
                          {language.t("custom.builder.primaryBadge")}
                        </span>
                      </Show>
                      <IconButtonV2
                        variant="ghost-muted"
                        size="small"
                        icon={<Icon name="close" />}
                        aria-label={language.t("common.remove")}
                        onClick={() => draft.removeAgent(agent.relativePath)}
                      />
                    </div>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>

        {/* Bound Prompts & Skills */}
        <div class="flex flex-col gap-2">
          <label class="text-v2-text-text-muted text-12-medium uppercase tracking-wider">
            {language.t("custom.builder.boundAssets")}
          </label>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Prompts */}
            <div class="flex flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
              <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
                {language.t("custom.sidebar.prompts")} ({boundPrompts().length})
              </span>
              <Show
                when={boundPrompts().length > 0}
                fallback={
                  <span class="text-v2-text-text-faint text-11-regular">
                    {language.t("custom.builder.noBoundPrompts")}
                  </span>
                }
              >
                <div class="flex flex-wrap gap-1.5">
                  <For each={boundPrompts()}>
                    {(prompt) => (
                      <div class="inline-flex items-center gap-1 rounded bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 text-11-regular text-purple-300">
                        <span>{prompt.name ?? prompt.relativePath}</span>
                        <button
                          type="button"
                          class="hover:text-purple-100"
                          onClick={() => draft.togglePrompt("orchestrator", prompt)}
                        >
                          <Icon name="close" size="small" />
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* Skills */}
            <div class="flex flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
              <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
                {language.t("custom.sidebar.skills")} ({boundSkills().length})
              </span>
              <Show
                when={boundSkills().length > 0}
                fallback={
                  <span class="text-v2-text-text-faint text-11-regular">
                    {language.t("custom.builder.noBoundSkills")}
                  </span>
                }
              >
                <div class="flex flex-wrap gap-1.5">
                  <For each={boundSkills()}>
                    {(skill) => (
                      <div class="inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-11-regular text-emerald-300">
                        <span>{skill.name ?? skill.relativePath}</span>
                        <button
                          type="button"
                          class="hover:text-emerald-100"
                          onClick={() => draft.toggleSkill("orchestrator", skill)}
                        >
                          <Icon name="close" size="small" />
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
