import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { Markdown } from "@aigcfroge/session-ui/markdown"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { decorateWikilinks } from "@/components/assistant-wikilink-decorate"
import { assistantQueryKey } from "@/utils/assistant-query"
import {
  danglingWikilinks,
  findWikilinkBeforeCaret,
  insertCompletion,
  wikilinkCandidates,
} from "@/components/assistant-note-editor-model"
import type { KbNoteNote } from "@aigcfroge/sdk/v2/client"

/** Markdown note editor with wikilink completion, preview, and dangling-link feedback. */
export function AssistantNoteEditor(props: {
  noteId?: string
  onSaved: () => void
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()

  const [title, setTitle] = createSignal("")
  const [tags, setTags] = createSignal("")
  const [content, setContent] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [completion, setCompletion] = createSignal<string[] | undefined>()
  const [completionIndex, setCompletionIndex] = createSignal(0)

  const notesQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "kb"),
    queryFn: async () => {
      const res = await serverSDK().client.kb.list({})
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const notes = createMemo(() => notesQuery.data ?? [])
  const titleIndex = createMemo(() => new Set(notes().map((note) => note.title)))

  createEffect(() => {
    const id = props.noteId
    if (!id) return
    let cancelled = false
    setLoading(true)
    void serverSDK()
      .client.kb.get({ id })
      .then((res) => {
        if (cancelled) return
        const note = res.data as KbNoteNote | undefined
        if (!note) return
        setTitle(note.title ?? "")
        setTags((note.tags ?? []).join(", "))
        setContent(note.content ?? "")
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    onCleanup(() => {
      cancelled = true
    })
  })

  createEffect(() => {
    if (props.noteId) return
    setTitle("")
    setTags("")
    setContent("")
  })

  let editorRef: HTMLTextAreaElement | undefined
  const completionMatch = createMemo(() => {
    const text = content()
    const caret = editorRef?.selectionStart ?? text.length
    return findWikilinkBeforeCaret(text, caret)
  })

  const updateCompletion = () => {
    const match = completionMatch()
    if (!match) {
      setCompletion(undefined)
      return
    }
    const candidates = wikilinkCandidates(
      notes().map((note) => note.title),
      match.query,
    )
    const current = completion()
    if (current && current.length === candidates.length && current.every((candidate, index) => candidate === candidates[index])) {
      return
    }
    setCompletionIndex(0)
    setCompletion(candidates)
  }

  const acceptCompletion = (index: number) => {
    const candidates = completion()
    const match = completionMatch()
    const title = candidates?.[index]
    if (!match || !title) return
    const next = insertCompletion(content(), match, title)
    setContent(next)
    setCompletion(undefined)
    requestAnimationFrame(() => {
      if (!editorRef) return
      editorRef.focus()
      const caret = next.indexOf("]]", match.start) + 2
      editorRef.setSelectionRange(caret, caret)
    })
  }

  const handleEditorKeyDown = (event: KeyboardEvent) => {
    const candidates = completion()
    if (!candidates || candidates.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setCompletionIndex((index) => (index + 1) % candidates.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setCompletionIndex((index) => (index - 1 + candidates.length) % candidates.length)
      return
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      acceptCompletion(completionIndex())
    }
    if (event.key === "Escape") setCompletion(undefined)
  }

  const dangling = createMemo(() => danglingWikilinks(content(), titleIndex()))

  let previewRef: HTMLDivElement | undefined
  createEffect(() => {
    const root = previewRef
    if (!root) return
    const apply = () => decorateWikilinks(root, (title) => notes().find((note) => note.title === title)?.id)
    const observer = new MutationObserver(() => requestAnimationFrame(apply))
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    apply()
    onCleanup(() => observer.disconnect())
  })

  const save = () => {
    const sdk = serverSDK()
    const id = props.noteId
    const currentTitle = title().trim()
    const tagList = tags()
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
    if (!currentTitle) return
    setSaving(true)
    const request = id
      ? sdk.client.kb.update({
          id,
          title: currentTitle,
          content: content(),
          tags: tagList,
        })
      : sdk.client.kb.create({
          title: currentTitle,
          content: content(),
          scope: "global",
          tags: tagList,
        })
    void request
      .then(() => {
        void notesQuery.refetch()
        props.onSaved()
      })
      .catch(console.error)
      .finally(() => setSaving(false))
  }

  const remove = () => {
    const id = props.noteId
    if (!id) return
    setDeleting(true)
    void serverSDK()
      .client.kb.remove({ id })
      .then(() => {
        void notesQuery.refetch()
        props.onSaved()
      })
      .catch(console.error)
      .finally(() => setDeleting(false))
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3" data-component="assistant-note-editor">
      <div class="flex min-w-0 items-center gap-2">
        <input
          class="min-w-0 flex-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 text-v2-text-text-base text-13-regular focus:outline-none focus:ring-2 focus:ring-v2-border-border-focus"
          aria-label={language.t("assistant.kb.titlePlaceholder")}
          placeholder={language.t("assistant.kb.titlePlaceholder")}
          value={title()}
          onInput={(event) => setTitle(event.currentTarget.value)}
        />
        <input
          class="w-40 shrink-0 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 text-v2-text-text-muted text-12-regular focus:outline-none focus:ring-2 focus:ring-v2-border-border-focus"
          aria-label={language.t("assistant.editor.tagsPlaceholder")}
          placeholder={language.t("assistant.editor.tagsPlaceholder")}
          value={tags()}
          onInput={(event) => setTags(event.currentTarget.value)}
        />
        <IconButtonV2
          variant="neutral"
          size="small"
          icon={<Icon name="status-active" />}
          aria-label={language.t("assistant.kb.save")}
          disabled={saving() || !title().trim()}
          onClick={save}
        />
        <Show when={props.noteId}>
          <IconButtonV2
            variant="ghost-muted"
            size="small"
            icon={<Icon name="xmark-small" />}
            aria-label={language.t("assistant.kb.delete")}
            disabled={deleting()}
            onClick={remove}
          />
        </Show>
      </div>

      <Show when={completion()?.length}>
        <div role="listbox" class="flex max-h-40 flex-col gap-px overflow-y-auto rounded-md border border-v2-border-border-base bg-v2-background-bg-layer-02 p-1">
          <For each={completion()}>
            {(candidate, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index() === completionIndex()}
                data-selected={index() === completionIndex() ? "" : undefined}
                class="flex h-7 items-center gap-2 rounded-[4px] px-2 text-left text-v2-text-text-base text-13-regular data-[selected]:bg-v2-background-bg-layer-03 focus-visible:outline-none"
                onMouseDown={(event) => {
                  event.preventDefault()
                  acceptCompletion(index())
                }}
              >
                <Icon name="edit" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                <span class="min-w-0 truncate">[[{candidate}]]</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <div class="flex min-h-0 flex-col gap-1">
          <p class="text-v2-text-text-muted text-12-regular">{language.t("assistant.editor.edit")}</p>
          <textarea
            ref={(el) => {
              editorRef = el
            }}
            class="min-h-0 flex-1 resize-none rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 font-mono text-v2-text-text-base text-13-regular focus:outline-none focus:ring-2 focus:ring-v2-border-border-focus"
            aria-label={language.t("assistant.kb.contentPlaceholder")}
            placeholder={language.t("assistant.kb.contentPlaceholder")}
            value={content()}
            disabled={loading()}
            onInput={(event) => {
              setContent(event.currentTarget.value)
              updateCompletion()
            }}
            onKeyUp={(event) => {
              if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return
              updateCompletion()
            }}
            onKeyDown={handleEditorKeyDown}
            onClick={updateCompletion}
          />
        </div>
        <div class="flex min-h-0 flex-col gap-1">
          <p class="text-v2-text-text-muted text-12-regular">{language.t("assistant.editor.preview")}</p>
          <ScrollView class="min-h-0 flex-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-base p-2">
            <div ref={(el) => { previewRef = el }} class="min-w-0 text-v2-text-text-base text-13-regular">
              <Markdown text={content() || "*…*"} />
            </div>
          </ScrollView>
          <Show when={dangling().length > 0}>
            <p class="text-v2-state-fg-warning text-12-regular">
              {language.t("assistant.editor.dangling", { count: String(dangling().length) })}{" "}
              {dangling().map((title) => `[[${title}]]`).join(" · ")}
            </p>
          </Show>
        </div>
      </div>
    </div>
  )
}
