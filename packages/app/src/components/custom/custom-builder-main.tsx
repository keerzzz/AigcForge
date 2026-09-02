import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { useCustomDraft, type CustomDraftBinding } from "@/context/custom-draft"

export function CustomCompositionConfig() {
  const language = useLanguage()
  const draft = useCustomDraft()

  const boundPrompts = createMemo(() => draft.state.bindings["orchestrator"]?.prompts ?? [])
  const boundSkills = createMemo(() => draft.state.bindings["orchestrator"]?.skills ?? [])
  const boundCommands = createMemo(() => draft.state.bindings["orchestrator"]?.commands ?? [])
  const bindingConsumers = createMemo<Array<[string, CustomDraftBinding]>>(() => {
    const entries = Object.entries(draft.state.bindings).map(
      ([consumer, binding]) =>
        [consumer, { ...binding, commands: binding.commands ?? [] }] as [string, CustomDraftBinding],
    )
    if (entries.length > 0) return entries
    return [["orchestrator", { prompts: boundPrompts(), skills: boundSkills(), commands: boundCommands() }]]
  })

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
            <span class="text-v2-text-text-faint text-11-regular">{language.t("custom.builder.profilePathHelp")}</span>
          </div>
        }
      >
        {/* Workflow selection */}
        <div class="flex flex-col gap-2">
          <label class="text-v2-text-text-muted text-12-medium uppercase tracking-wider">
            {language.t("custom.builder.workflow")}
          </label>
          <div class="flex items-center justify-between gap-3 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
            <div class="flex min-w-0 items-center gap-2">
              <Icon name="mode-custom" size="small" class="shrink-0 text-v2-icon-icon-muted" />
              <div class="min-w-0">
                <Show
                  when={draft.state.workflow}
                  fallback={
                    <span class="text-v2-text-text-muted text-12-regular">
                      {language.t("custom.builder.noWorkflow")}
                    </span>
                  }
                >
                  {(workflow) => (
                    <>
                      <span class="block truncate font-mono text-v2-text-text-base text-13-medium">
                        {workflow().name ?? workflow().relativePath}
                      </span>
                      <span class="block truncate text-v2-text-text-faint text-11-regular">
                        {workflow().relativePath}
                      </span>
                    </>
                  )}
                </Show>
              </div>
            </div>
            <Show when={draft.state.workflow}>
              <IconButtonV2
                variant="ghost-muted"
                size="small"
                icon={<Icon name="close" />}
                aria-label={language.t("common.remove")}
                onClick={() => draft.setWorkflow(undefined)}
              />
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

                  return (
                    <div class="inline-flex items-center gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 px-2.5 py-1.5 text-12-regular">
                      <Icon name="mode-assistant" size="small" class="text-blue-400 shrink-0" />
                      <span class="text-v2-text-text-base font-mono">{name}</span>
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
          <div class="flex flex-col gap-3">
            <For each={bindingConsumers()}>
              {([consumer, binding]) => (
                <div class="rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <span class="font-mono text-v2-text-text-base text-12-medium">{consumer}</span>
                    <span class="text-v2-text-text-faint text-10-regular">
                      {language.t("custom.builder.consumerBinding")}
                    </span>
                  </div>
                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {/* Prompts */}
                    <div class="flex flex-col gap-2">
                      <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
                        {language.t("custom.sidebar.prompts")} ({binding.prompts.length})
                      </span>
                      <Show
                        when={binding.prompts.length > 0}
                        fallback={
                          <span class="text-v2-text-text-faint text-11-regular">
                            {language.t("custom.builder.noBoundPrompts")}
                          </span>
                        }
                      >
                        <div class="flex flex-wrap gap-1.5">
                          <For each={binding.prompts}>
                            {(prompt) => (
                              <div class="inline-flex items-center gap-1 rounded bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 text-11-regular text-purple-300">
                                <span>{prompt.name ?? prompt.relativePath}</span>
                                <button
                                  type="button"
                                  class="hover:text-purple-100"
                                  onClick={() => draft.togglePrompt(consumer, prompt)}
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
                    <div class="flex flex-col gap-2">
                      <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
                        {language.t("custom.sidebar.skills")} ({binding.skills.length})
                      </span>
                      <Show
                        when={binding.skills.length > 0}
                        fallback={
                          <span class="text-v2-text-text-faint text-11-regular">
                            {language.t("custom.builder.noBoundSkills")}
                          </span>
                        }
                      >
                        <div class="flex flex-wrap gap-1.5">
                          <For each={binding.skills}>
                            {(skill) => (
                              <div class="inline-flex items-center gap-1 rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-11-regular text-emerald-300">
                                <span>{skill.name ?? skill.relativePath}</span>
                                <button
                                  type="button"
                                  class="hover:text-emerald-100"
                                  onClick={() => draft.toggleSkill(consumer, skill)}
                                >
                                  <Icon name="close" size="small" />
                                </button>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                    {/* Commands */}
                    <div class="flex flex-col gap-2">
                      <span class="text-v2-text-text-muted text-11-medium uppercase tracking-wider">
                        {language.t("custom.builder.commandBindings")} ({binding.commands.length})
                      </span>
                      <Show
                        when={binding.commands.length > 0}
                        fallback={
                          <span class="text-v2-text-text-faint text-11-regular">
                            {language.t("custom.builder.noBoundCommands")}
                          </span>
                        }
                      >
                        <div class="flex flex-wrap gap-1.5">
                          <For each={binding.commands}>
                            {(command) => (
                              <div class="inline-flex max-w-full items-center gap-1 rounded border border-v2-border-border-base bg-v2-background-bg-layer-03 px-2 py-0.5 text-v2-text-text-base text-11-regular">
                                <span class="truncate">{command.name ?? command.relativePath}</span>
                                <button
                                  type="button"
                                  class="shrink-0 text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:outline focus-visible:outline-1 focus-visible:outline-v2-border-border-active"
                                  aria-label={language.t("common.remove")}
                                  onClick={() => draft.toggleCommand(consumer, command)}
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
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}
