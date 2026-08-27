import { createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/v2/icon"
import type {
  CompositionPlan,
  CompositionDiagnostic,
  CompositionInstruction,
  CompositionCapabilityInfo,
} from "@aigcfroge/sdk/v2/client"

export interface CustomPreviewTabsProps {
  plan: CompositionPlan | undefined
  loading?: boolean
}

export function mcpPreviewSummary(plan: Partial<CompositionPlan> | undefined) {
  const mcp = plan?.mcp
  const diagnostics = plan?.diagnostics ?? []
  return {
    requested: mcp?.requested ?? [],
    effective: mcp?.effective ?? [],
    denied: mcp?.denied ?? [],
    diagnostics: diagnostics.filter((diagnostic) => diagnostic.asset?.kind === "mcp" || diagnostic.code.startsWith("mcp_")),
    hasMcpPlan: mcp !== undefined,
  }
}

export function mcpPreviewState(input: {
  plan: Partial<CompositionPlan> | undefined
  loading?: boolean
  error?: string
}) {
  if (input.loading) return "loading" as const
  if (input.error !== undefined) return "error" as const
  const summary = mcpPreviewSummary(input.plan)
  if (!summary.hasMcpPlan) return "unavailable" as const
  if (summary.requested.length === 0 && summary.effective.length === 0 && summary.denied.length === 0 && summary.diagnostics.length === 0) return "empty" as const
  return "content" as const
}

export function planPreviewSummary(plan: Partial<CompositionPlan> | undefined) {
  const steps = plan?.workflow?.steps ?? []
  return {
    workflowName: plan?.workflow?.name,
    stepCount: steps.length,
    agentCount: plan?.agents?.length ?? plan?.costPreview?.agentCount ?? 0,
    maxConcurrency: plan?.costPreview?.maxConcurrency,
    estimatedTokens: plan?.costPreview?.estimatedTokens,
    effectiveToolCount: plan?.costPreview?.effectiveToolCount,
    edgeCount: steps.reduce(
      (count, step) => count + (step.next ? 1 : 0) + (step.parallel?.length ?? 0) + Object.keys(step.branches ?? {}).length,
      0,
    ),
  }
}

export function WorkflowTab(props: { plan: CompositionPlan | undefined }) {
  const language = useLanguage()
  const summary = createMemo(() => planPreviewSummary(props.plan))
  const agents = createMemo(() => props.plan?.agents ?? [])
  const workflow = createMemo(() => props.plan?.workflow)

  return (
    <div class="flex flex-col gap-5">
      <div class="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-v2-border-border-base bg-v2-border-border-base sm:grid-cols-4">
        <For each={[
          { label: language.t("custom.builder.plan.agentPool"), value: summary().agentCount },
          { label: language.t("custom.builder.plan.steps"), value: summary().stepCount },
          { label: language.t("custom.builder.plan.maxConcurrency"), value: summary().maxConcurrency ?? "-" },
          { label: language.t("custom.builder.plan.estimatedTokens"), value: summary().estimatedTokens?.toLocaleString() ?? "-" },
        ]}>
          {(metric) => (
            <div class="flex min-w-0 flex-col gap-1 bg-v2-background-bg-layer-02 px-3 py-2.5">
              <span class="truncate text-v2-text-text-faint text-10-medium uppercase tracking-wider">{metric.label}</span>
              <span class="font-mono text-v2-text-text-base text-14-medium">{metric.value}</span>
            </div>
          )}
        </For>
      </div>

      <div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <section class="flex min-w-0 flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-v2-text-text-base text-12-medium">{language.t("custom.builder.plan.agentPool")}</h3>
            <span class="text-v2-text-text-faint text-10-regular">{agents().length}</span>
          </div>
          <Show
            when={agents().length > 0}
            fallback={<div class="rounded-md border border-dashed border-v2-border-border-base p-4 text-center text-v2-text-text-muted text-11-regular">{language.t("custom.builder.plan.noAgents")}</div>}
          >
            <div class="flex flex-col gap-1">
              <For each={agents()}>
                {(agent) => (
                  <div class="flex min-w-0 items-center gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 px-2.5 py-2">
                    <Icon name="mode-assistant" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                    <div class="min-w-0">
                      <span class="block truncate font-mono text-v2-text-text-base text-11-medium">{agent.name}</span>
                      <Show when={agent.description}>
                        <span class="block truncate text-v2-text-text-faint text-10-regular">{agent.description}</span>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="flex min-w-0 flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <h3 class="truncate text-v2-text-text-base text-12-medium">{workflow()?.name ?? language.t("custom.builder.plan.dag")}</h3>
              <Show when={workflow()?.description}>
                <p class="truncate text-v2-text-text-faint text-10-regular">{workflow()?.description}</p>
              </Show>
            </div>
            <span class="shrink-0 text-v2-text-text-faint text-10-regular">
              {language.t("custom.builder.plan.edges", { count: summary().edgeCount })}
            </span>
          </div>
          <Show
            when={(workflow()?.steps.length ?? 0) > 0}
            fallback={<div class="rounded-md border border-dashed border-v2-border-border-base p-4 text-center text-v2-text-text-muted text-11-regular">{language.t("custom.builder.plan.noWorkflow")}</div>}
          >
            <ol class="flex flex-col gap-1.5">
              <For each={workflow()?.steps ?? []}>
                {(step, index) => {
                  const targets = () => [
                    ...(step.next ? [step.next] : []),
                    ...(step.parallel ?? []),
                    ...Object.values(step.branches ?? {}),
                  ]
                  return (
                    <li class="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-2.5">
                      <span class="flex h-7 w-7 items-center justify-center rounded border border-v2-border-border-base bg-v2-background-bg-layer-03 font-mono text-v2-text-text-muted text-10-medium">
                        {index() + 1}
                      </span>
                      <div class="min-w-0">
                        <div class="flex min-w-0 items-center justify-between gap-2">
                          <span class="truncate text-v2-text-text-base text-11-medium">{step.name}</span>
                          <span class="shrink-0 font-mono text-v2-text-text-faint text-10-regular">{step.agent}</span>
                        </div>
                        <Show when={targets().length > 0}>
                          <p class="mt-1 truncate font-mono text-v2-text-text-muted text-10-regular">
                            {step.id} -&gt; {targets().join(", ")}
                          </p>
                        </Show>
                      </div>
                    </li>
                  )
                }}
              </For>
            </ol>
          </Show>
        </section>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-v2-border-border-base pt-3 text-v2-text-text-muted text-10-regular">
        <span>{language.t("custom.builder.plan.effectiveTools", { count: summary().effectiveToolCount ?? 0 })}</span>
        <span>{language.t("custom.builder.plan.serverCalculated")}</span>
      </div>
    </div>
  )
}

export function InstructionsTab(props: { plan: CompositionPlan | undefined }) {
  const language = useLanguage()
  const instructions = createMemo<readonly CompositionInstruction[]>(() => props.plan?.instructions ?? [])

  const totalChars = createMemo(() =>
    instructions().reduce((acc: number, inst: CompositionInstruction) => acc + (inst.content?.length ?? 0), 0),
  )
  const tokenEstimate = createMemo(() => Math.ceil(totalChars() / 4))

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between border-b border-v2-border-border-base pb-2">
        <span class="text-v2-text-text-muted text-12-regular">
          {language.t("custom.builder.instructions.count", { count: instructions().length })}
        </span>
        <div class="flex items-center gap-2 text-v2-text-text-faint text-11-regular">
          <span>{totalChars()} {language.t("custom.builder.instructions.chars")}</span>
          <span>~{tokenEstimate()} {language.t("custom.builder.instructions.tokens")}</span>
        </div>
      </div>

      <Show
        when={instructions().length > 0}
        fallback={
          <div class="p-6 text-center text-v2-text-text-muted text-13-regular">
            {language.t("custom.builder.instructions.empty")}
          </div>
        }
      >
        <div class="flex flex-col gap-3">
          <For each={instructions()}>
            {(inst) => {
              const sourceColor = () => {
                if (inst.source.includes("agent")) return "bg-blue-500/10 text-blue-400 border-blue-500/20"
                if (inst.source.includes("composition") || inst.source.includes("prompt")) return "bg-purple-500/10 text-purple-400 border-purple-500/20"
                if (inst.source.includes("ambient")) return "bg-amber-500/10 text-amber-400 border-amber-500/20"
                if (inst.source.includes("rule")) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
              }

              return (
                <div class="flex flex-col gap-1.5 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
                  <div class="flex items-center justify-between">
                    <span class={`inline-flex items-center rounded px-1.5 py-0.5 text-10-medium uppercase tracking-wider border ${sourceColor()}`}>
                      {inst.source}
                    </span>
                  </div>
                  <pre class="whitespace-pre-wrap font-mono text-12-regular text-v2-text-text-base max-h-48 overflow-y-auto leading-relaxed">
                    {inst.content}
                  </pre>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}

export function CapabilitiesTab(props: { plan: CompositionPlan | undefined }) {
  const language = useLanguage()
  const capabilities = createMemo<readonly CompositionCapabilityInfo[]>(() => props.plan?.capabilities ?? [])
  const effective = createMemo(() => capabilities().filter((c) => c.status === "effective"))
  const denied = createMemo(() => capabilities().filter((c) => c.status === "denied" || c.status === "unsupported"))

  return (
    <div class="flex flex-col gap-4">
      <Show when={denied().length > 0}>
        <div class="flex flex-col gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3">
          <div class="flex items-center gap-1.5 text-red-400 text-12-medium">
            <Icon name="warning" size="small" />
            <span>{language.t("custom.builder.capabilities.missingTitle")}</span>
          </div>
          <ul class="list-disc list-inside text-12-regular text-red-300">
            <For each={denied()}>
              {(cap) => <li>{cap.id} ({cap.status}{cap.reason ? `: ${cap.reason}` : ""})</li>}
            </For>
          </ul>
        </div>
      </Show>

      <div class="flex flex-col gap-2">
        <span class="text-v2-text-text-muted text-12-regular">
          {language.t("custom.builder.capabilities.effectiveCount", { count: effective().length })}
        </span>
        <Show
          when={effective().length > 0}
          fallback={
            <div class="p-6 text-center text-v2-text-text-muted text-13-regular">
              {language.t("custom.builder.capabilities.empty")}
            </div>
          }
        >
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <For each={effective()}>
              {(cap) => (
                <div class="flex items-center gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-2.5">
                  <div class="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <span class="text-v2-text-text-base text-12-medium font-mono truncate">{cap.id}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}

export function PermissionsTab(props: { plan: CompositionPlan | undefined }) {
  const language = useLanguage()
  const [query, setQuery] = createSignal("")
  const skills = createMemo(() => props.plan?.skills ?? [])

  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim()
    if (!q) return skills()
    return skills().filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
  })

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <input
          type="text"
          class="flex-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 px-2.5 py-1 text-12-regular text-v2-text-text-base placeholder:text-v2-text-text-muted focus:border-v2-border-border-focus focus:outline-none"
          placeholder={language.t("custom.builder.permissions.search")}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>

      <Show
        when={filtered().length > 0}
        fallback={
          <div class="p-6 text-center text-v2-text-text-muted text-13-regular">
            {language.t("custom.builder.permissions.empty")}
          </div>
        }
      >
        <div class="flex flex-col gap-1.5">
          <For each={filtered()}>
            {(skill) => (
              <div class="flex items-center justify-between rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 px-3 py-2">
                <span class="font-mono text-12-medium text-v2-text-text-base">{skill.name}</span>
                <span class="rounded px-2 py-0.5 text-10-medium uppercase border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                  allow
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

export function McpTab(props: { plan: CompositionPlan | undefined; loading?: boolean; error?: string }) {
  const language = useLanguage()
  const summary = createMemo(() => mcpPreviewSummary(props.plan))
  const state = createMemo(() => mcpPreviewState({ plan: props.plan, loading: props.loading, error: props.error }))

  return (
    <Show
      when={state() !== "loading"}
      fallback={<div class="p-8 text-center text-v2-text-text-muted text-13-regular">{language.t("custom.builder.mcp.loading")}</div>}
    >
      <Show
        when={state() !== "error"}
        fallback={
          <div class="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <Icon name="warning" size="normal" class="text-rose-300" />
            <span class="text-v2-text-text-base text-13-medium">{language.t("custom.builder.mcp.error")}</span>
            <span class="max-w-xl break-words text-v2-text-text-muted text-12-regular">{props.error}</span>
          </div>
        }
      >
        <Show
          when={state() !== "unavailable"}
          fallback={<div class="p-8 text-center text-v2-text-text-muted text-13-regular">{language.t("custom.builder.mcp.noData")}</div>}
        >
          <Show
            when={state() !== "empty"}
            fallback={<div class="p-8 text-center text-v2-text-text-muted text-13-regular">{language.t("custom.builder.mcp.empty")}</div>}
          >
            <div class="flex flex-col gap-5">
              <div class="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-v2-border-border-base bg-v2-border-border-base">
                <For each={[
                  { label: language.t("custom.builder.mcp.requested"), value: summary().requested.length },
                  { label: language.t("custom.builder.mcp.effective"), value: summary().effective.length },
                  { label: language.t("custom.builder.mcp.denied"), value: summary().denied.length },
                ]}>
                  {(metric) => (
                    <div class="flex min-w-0 flex-col gap-1 bg-v2-background-bg-layer-02 px-3 py-2.5">
                      <span class="truncate text-v2-text-text-faint text-10-medium uppercase tracking-wider">{metric.label}</span>
                      <span class="font-mono text-v2-text-text-base text-14-medium">{metric.value}</span>
                    </div>
                  )}
                </For>
              </div>

              <Show when={summary().effective.length > 0}>
                <section class="flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-2">
                    <h3 class="text-v2-text-text-base text-12-medium">{language.t("custom.builder.mcp.effective")}</h3>
                    <span class="text-v2-text-text-faint text-10-regular">{summary().effective.length}</span>
                  </div>
                  <div class="flex flex-col gap-2">
                    <For each={summary().effective}>
                      {(server) => (
                        <div data-slot="mcp-effective-server" class="flex min-w-0 flex-col gap-2 rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
                          <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <span data-slot="mcp-server-name" class="min-w-0 break-all font-mono text-v2-text-text-base text-12-medium">{server.serverName}</span>
                            <span data-slot="mcp-health" class="rounded border border-v2-border-border-base bg-v2-background-bg-layer-03 px-2 py-0.5 font-mono text-10-medium text-v2-text-text-base">{server.health}</span>
                          </div>
                          <div class="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-v2-text-text-muted text-11-regular">
                            <span>{language.t("custom.builder.mcp.credentialStatus")}: <code data-slot="mcp-credential-status" class="font-mono text-v2-text-text-base">{server.credentialStatus}</code></span>
                            <span>{language.t("custom.builder.mcp.tools")}: {server.tools.length}</span>
                          </div>
                          <Show when={server.tools.length > 0}>
                            <div class="flex flex-wrap gap-1.5">
                              <For each={server.tools}>
                                {(tool) => <code class="max-w-full break-all rounded bg-v2-background-bg-layer-03 px-1.5 py-0.5 font-mono text-10-regular text-v2-text-text-muted">{tool}</code>}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={summary().denied.length > 0}>
                <section class="flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-2">
                    <h3 class="text-v2-text-text-base text-12-medium">{language.t("custom.builder.mcp.denied")}</h3>
                    <span class="text-v2-text-text-faint text-10-regular">{summary().denied.length}</span>
                  </div>
                  <div class="flex flex-col gap-2">
                    <For each={summary().denied}>
                      {(server) => (
                        <div data-slot="mcp-denied-server" class="flex min-w-0 flex-col gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-3">
                          <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <span data-slot="mcp-server-name" class="min-w-0 break-all font-mono text-v2-text-text-base text-12-medium">{server.serverName}</span>
                            <Show when={server.health}>
                              {(health) => <span data-slot="mcp-health" class="rounded border border-v2-border-border-base bg-v2-background-bg-layer-03 px-2 py-0.5 font-mono text-10-medium text-v2-text-text-base">{health()}</span>}
                            </Show>
                          </div>
                          <div class="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-v2-text-text-muted text-11-regular">
                            <span>{language.t("custom.builder.mcp.reason")}: <code data-slot="mcp-reason" class="break-all font-mono text-rose-300">{server.reason}</code></span>
                            <Show when={server.credentialStatus}>
                              {(status) => <span>{language.t("custom.builder.mcp.credentialStatus")}: <code class="font-mono text-v2-text-text-base">{status()}</code></span>}
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={summary().diagnostics.length > 0}>
                <section class="flex flex-col gap-2">
                  <h3 class="text-v2-text-text-base text-12-medium">{language.t("custom.builder.mcp.diagnostics")}</h3>
                  <div class="flex flex-col gap-2">
                    <For each={summary().diagnostics}>
                      {(diagnostic) => (
                        <div data-slot="mcp-diagnostic" class="rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
                          <div class="flex min-w-0 flex-wrap items-center gap-2">
                            <span data-slot="mcp-diagnostic-code" class="font-mono text-11-medium text-v2-text-text-base">[{diagnostic.code}]</span>
                            <span class="text-10-medium uppercase text-v2-text-text-muted">{diagnostic.severity}</span>
                          </div>
                          <p class="mt-1 break-words text-12-regular leading-relaxed text-v2-text-text-muted">{diagnostic.message}</p>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </Show>
  )
}

export function DiagnosticsTab(props: { plan: CompositionPlan | undefined }) {
  const language = useLanguage()
  const diagnostics = createMemo<readonly CompositionDiagnostic[]>(() => props.plan?.diagnostics ?? [])

  return (
    <div class="flex flex-col gap-4">
      <Show
        when={diagnostics().length > 0}
        fallback={
          <div class="flex flex-col items-center justify-center p-8 text-center gap-2">
            <div class="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <Icon name="check" size="normal" />
            </div>
            <span class="text-v2-text-text-base text-13-medium">
              {language.t("custom.builder.diagnostics.cleanTitle")}
            </span>
            <span class="text-v2-text-text-muted text-12-regular">
              {language.t("custom.builder.diagnostics.cleanSubtitle")}
            </span>
          </div>
        }
      >
        <div class="flex flex-col gap-3">
          <For each={diagnostics()}>
            {(diag) => {
              const color = () => {
                switch (diag.severity) {
                  case "blocking": return "border-rose-500/40 bg-rose-500/10 text-rose-300"
                  case "error": return "border-orange-500/40 bg-orange-500/10 text-orange-300"
                  case "warning": return "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  case "info": return "border-blue-500/40 bg-blue-500/10 text-blue-300"
                  default: return "border-zinc-500/40 bg-zinc-500/10 text-zinc-300"
                }
              }

              return (
                <div class={`flex flex-col gap-1 rounded-md border p-3 ${color()}`}>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5">
                      <span class="text-11-bold uppercase tracking-wider">{diag.severity}</span>
                      <span class="font-mono text-11-medium opacity-75">[{diag.code}]</span>
                    </div>
                    <Show when={diag.path}>
                      <span class="text-11-regular opacity-75 truncate max-w-[180px]">{diag.path}</span>
                    </Show>
                  </div>
                  <p class="text-12-regular leading-relaxed mt-1">{diag.message}</p>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
