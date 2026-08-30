import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { IconButtonV2 } from "@aigcfroge/ui/v2/icon-button-v2"
import { ScrollView } from "@aigcfroge/ui/scroll-view"
import { Markdown } from "@aigcfroge/session-ui/markdown"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { decorateWikilinks } from "@/components/assistant-wikilink-decorate"
import type { KbNoteNote } from "@aigcfroge/sdk/v2/client"
import { assistantQueryKey } from "@/utils/assistant-query"

/** Knowledge-base search, filtering, backlinks, and dangling-link inspection. */
export function AssistantKbTab(props: { target?: string; onEditNote: (note: KbNoteNote) => void }) {
  const language = useLanguage()
  const serverSDK = useServerSDK()

  const [search, setSearch] = createSignal("")
  const [tagFilter, setTagFilter] = createSignal<string | undefined>()
  const [selectedID, setSelectedID] = createSignal<string | undefined>(props.target)

  const notesQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "kb"),
    queryFn: async () => {
      const res = await serverSDK().client.kb.list({})
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const notes = createMemo(() => notesQuery.data ?? [])

  const searchQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "kb-search", search()),
    queryFn: async () => {
      const value = search()
      if (!value) return notes()
      const res = await serverSDK().client.kb.search({ query: value })
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const visible = createMemo(() => searchQuery.data ?? [])

  const tags = createMemo(() => {
    const set = new Set<string>()
    for (const note of notes()) for (const tag of note.tags ?? []) set.add(tag)
    return [...set].sort()
  })

  const filtered = createMemo(() => {
    const tag = tagFilter()
    if (!tag) return visible()
    return visible().filter((note) => (note.tags ?? []).includes(tag))
  })

  const selected = createMemo<KbNoteNote | undefined>(() => {
    const id = selectedID()
    if (!id) return undefined
    return notes().find((note) => note.id === id) ?? filtered().find((note) => note.id === id)
  })

  // A panel target must stay visible even when a previous search hid it.
  createEffect(() => {
    const id = props.target
    if (!id) return
    if (selectedID() === id) return
    setSelectedID(id)
    setSearch("")
    setTagFilter(undefined)
  })

  const backlinksQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "kb-backlinks", selectedID() ?? ""),
    queryFn: async () => {
      const id = selectedID()
      if (!id) return []
      const res = await serverSDK().client.kb.backlinks({ id })
      return Array.isArray(res.data) ? res.data : []
    },
    enabled: !!selectedID(),
  }))
  const backlinks = createMemo(() => backlinksQuery.data ?? [])

  const danglingQuery = useQuery(() => ({
    queryKey: assistantQueryKey(serverSDK().scope, "dangling"),
    queryFn: async () => {
      const res = await serverSDK().client.kb.dangling()
      return Array.isArray(res.data) ? res.data : []
    },
  }))
  const dangling = createMemo(() => danglingQuery.data ?? [])

  const titleIndex = createMemo(() => new Set(notes().map((note) => note.title)))

  // Decorate rendered wikilinks after Markdown updates the DOM.
  let bodyRef: HTMLDivElement | undefined
  createEffect(() => {
    const root = bodyRef
    const current = selected()
    if (!root || !current) return
    const apply = () => decorateWikilinks(root, (title) => notes().find((note) => note.title === title)?.id)
    const observer = new MutationObserver(() => requestAnimationFrame(apply))
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    apply()
    onCleanup(() => observer.disconnect())
  })

  const openWikilink = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const span = target.closest<HTMLSpanElement>("[data-wikilink]")
    if (!span) return
    const title = span.getAttribute("data-title")
    if (!title || span.getAttribute("data-dangling") === "true") return
    const note = notes().find((item) => item.title === title)
    if (!note) return
    setSelectedID(note.id)
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3" data-component="assistant-kb-tab">
      <div class="flex min-w-0 items-center gap-2">
        <input
          class="min-w-0 flex-1 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 text-v2-text-text-base text-13-regular focus:outline-none focus:ring-2 focus:ring-v2-border-border-focus"
          aria-label={language.t("assistant.kb.search")}
          placeholder={language.t("assistant.kb.search")}
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
        <select
          class="shrink-0 rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 text-v2-text-text-base text-13-regular focus:outline-none"
          aria-label={language.t("assistant.kb.tagFilter")}
          value={tagFilter() ?? ""}
          onChange={(event) => setTagFilter(event.currentTarget.value || undefined)}
        >
          <option value="">{language.t("assistant.kb.allTags")}</option>
          <For each={tags()}>{(tag) => <option value={tag}>{tag}</option>}</For>
        </select>
      </div>

      <ScrollView class="min-h-0 flex-1">
        <div class="flex min-w-0 flex-col gap-4">
          <Show
            when={!searchQuery.isLoading && !notesQuery.isLoading}
            fallback={<p class="text-v2-text-text-muted text-13-regular">{language.t("common.loading")}</p>}
          >
            <Show
              when={filtered().length > 0}
              fallback={<p class="text-v2-text-text-muted text-13-regular">{language.t("assistant.kb.empty")}</p>}
            >
              <div class="flex min-w-0 flex-col gap-px">
                <For each={filtered()}>
                  {(note) => (
                    <button
                      type="button"
                      data-selected={note.id === selectedID() ? "" : undefined}
                      aria-current={note.id === selectedID() ? "page" : undefined}
                      class="flex min-w-0 items-center gap-2 rounded-[6px] px-2 py-1 text-left hover:bg-v2-overlay-simple-overlay-hover data-[selected]:bg-v2-background-bg-layer-03 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                      onClick={() => setSelectedID(note.id)}
                    >
                      <Icon name="edit" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                      <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-13-regular">
                        {note.title ?? ""}
                      </span>
                      <span class="shrink-0 text-v2-text-text-faint text-11-regular">
                        {(note.tags ?? []).join(" · ")}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          <Show when={selected()} keyed>
            {(note) => (
              <section class="flex min-w-0 flex-col gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 p-3">
                <div class="flex min-w-0 items-center gap-2">
                  <h3 class="min-w-0 flex-1 truncate text-v2-text-text-base text-13-medium">{note.title}</h3>
                  <IconButtonV2
                    variant="ghost-muted"
                    size="small"
                    icon={<Icon name="edit" />}
                    aria-label={language.t("assistant.kb.edit")}
                    onClick={() => props.onEditNote(note)}
                  />
                </div>
                <div
                  ref={(el) => {
                    bodyRef = el
                  }}
                  onClick={openWikilink}
                  class="min-w-0 text-v2-text-text-base text-13-regular"
                >
                  <Markdown text={note.content ?? ""} />
                </div>
                <div class="flex min-w-0 flex-col gap-1">
                  <p class="text-v2-text-text-muted text-12-regular">{language.t("assistant.kb.backlinks")}</p>
                  <Show
                    when={backlinks().length > 0}
                    fallback={
                      <p class="text-v2-text-text-faint text-12-regular">{language.t("assistant.kb.backlinksEmpty")}</p>
                    }
                  >
                    <For each={backlinks()}>
                      {(note) => (
                        <button
                          type="button"
                          class="flex min-w-0 items-center gap-2 rounded-[4px] px-1 py-0.5 text-left hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
                          onClick={() => setSelectedID(note.id)}
                        >
                          <Icon name="status-active" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                          <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-13-regular">
                            {note.title ?? ""}
                          </span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </section>
            )}
          </Show>

          <section class="flex min-w-0 flex-col gap-2">
            <p class="text-v2-text-text-base text-13-medium">{language.t("assistant.kb.danglingTitle")}</p>
            <Show
              when={dangling().length > 0}
              fallback={
                <p class="text-v2-text-text-faint text-12-regular">{language.t("assistant.kb.danglingEmpty")}</p>
              }
            >
              <div class="flex min-w-0 flex-col gap-px">
                <For each={dangling()}>
                  {(edge) => (
                    <div class="flex min-w-0 items-center gap-2 py-0.5">
                      <Icon name="outline-dots" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                      <span class="min-w-0 flex-1 truncate text-v2-text-text-base text-13-regular">
                        [[{edge.targetTitle}]]
                      </span>
                      <span class="shrink-0 text-v2-text-text-faint text-11-regular">{edge.sourceTitle}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>
      </ScrollView>
    </div>
  )
}
