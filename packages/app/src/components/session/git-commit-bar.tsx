import { For, Show, createMemo } from "solid-js"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { TextInputV2 } from "@aigcfroge/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"

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
        >
          {props.isCommitting ? language.t("git.commitBar.committing") : language.t("git.commitBar.commit")}
        </ButtonV2>
      </div>

      <details class="group px-3 pb-2">
        <summary class="text-11-regular text-text-weaker cursor-pointer select-none hover:text-text-weak transition-colors">
          {language.t("git.commitBar.recent")}
        </summary>
        <Show when={recentLog().length > 0}>
          <div class="mt-1 flex flex-col gap-0.5 max-h-32 overflow-y-auto">
            <For each={recentLog()}>
              {(entry) => (
                <div class="flex items-center gap-2 text-11-regular">
                  <span class="font-mono text-text-weaker shrink-0">{entry.hash.slice(0, 7)}</span>
                  <span class="flex-1 min-w-0 truncate text-text-strong">{entry.message}</span>
                  <span class="text-text-weaker shrink-0">{formatDate(entry.date)}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </details>
    </div>
  )
}
