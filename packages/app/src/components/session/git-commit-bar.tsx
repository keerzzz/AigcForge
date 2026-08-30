import { For, Show, createMemo, createSignal } from "solid-js"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { TextInputV2 } from "@aigcfroge/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { Icon } from "@aigcfroge/ui/icon"

type CommitEntry = {
  hash: string
  message: string
  author: string
  date: string
}

export function GitCommitBar(props: {
  message: string
  onMessageChange: (value: string) => void
  hasStaged: boolean
  onCommit: () => void
  isCommitting: boolean
  log: readonly CommitEntry[] | undefined
}) {
  const language = useLanguage()
  const [expanded, setExpanded] = createSignal(false)

  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      props.onCommit()
    }
  }

  const canCommit = () => props.hasStaged && props.message.trim().length > 0 && !props.isCommitting

  const recentLog = createMemo(() => props.log?.slice(0, 15) ?? [])

  const formatDate = (date: string) => {
    const d = new Date(date)
    const now = Date.now()
    const diffMs = now - d.getTime()
    const diffH = Math.floor(diffMs / 3600000)
    if (diffH < 1) return `${Math.floor(diffMs / 60000)}m`
    if (diffH < 24) return `${diffH}h`
    return `${Math.floor(diffH / 24)}d`
  }

  const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0
  const shortcutHint = isMac ? "⌘↵" : "Ctrl+Enter"

  return (
    <div class="border-t border-border-base bg-surface-base">
      <div class="flex items-center gap-2 px-3 py-2">
        <TextInputV2
          value={props.message}
          onInput={(e) => props.onMessageChange(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={language.t("git.commitBar.placeholder")}
          disabled={props.isCommitting}
          class="flex-1 min-w-0"
        />
        <ButtonV2
          onClick={props.onCommit}
          disabled={!canCommit()}
          variant="contrast"
          class="flex items-center gap-1.5 shrink-0"
        >
          <span>
            {props.isCommitting ? language.t("git.commitBar.committing") : language.t("git.commitBar.commit")}
          </span>
          <span class="text-[9px] opacity-65 font-mono select-none px-1 py-0.5 rounded bg-white/10">
            {shortcutHint}
          </span>
        </ButtonV2>
      </div>

      <div class="px-3 pb-2 flex flex-col">
        <button
          onClick={() => setExpanded(!expanded())}
          class="flex items-center gap-1.5 text-11-medium text-text-weaker hover:text-text-weak transition-colors select-none w-fit"
        >
          <div
            class="transition-transform duration-200"
            style={{ transform: expanded() ? "rotate(0deg)" : "rotate(-90deg)" }}
          >
            <Icon name="chevron-down" size="small" />
          </div>
          <span>{language.t("git.commitBar.recent")}</span>
          <Show when={recentLog().length > 0}>
            <span class="px-1.5 py-0.2 text-[9px] rounded-full bg-surface-raised-base border border-border-weaker-base font-semibold">
              {recentLog().length}
            </span>
          </Show>
        </button>

        <Show when={expanded() && recentLog().length > 0}>
          <div class="mt-2 flex flex-col gap-1.5 max-h-32 overflow-y-auto pr-1">
            <For each={recentLog()}>
              {(entry) => (
                <div class="flex items-center gap-2 text-11-regular">
                  <span class="font-mono text-text-weak shrink-0 px-1 py-0.5 rounded bg-surface-raised-base border border-border-weaker-base text-[10px]">
                    {entry.hash.slice(0, 7)}
                  </span>
                  <span class="flex-1 min-w-0 truncate text-text-strong">{entry.message}</span>
                  <span class="text-text-weaker shrink-0">{formatDate(entry.date)}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
