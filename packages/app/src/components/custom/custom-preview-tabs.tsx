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
