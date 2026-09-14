import { createEffect, createMemo, onCleanup, onMount, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate, useSearchParams } from "@solidjs/router"
import { useChatWorkspace } from "@/context/chat-workspace"
import { NewSessionDesignView } from "@/components/session"
import { useComments } from "@/context/comments"
import { usePrompt } from "@/context/prompt"
import { runInternalNavigation } from "@/context/chat-workspace"
import { UrlParams } from "@/utils/url-params"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { createSessionComposerState, SessionComposerRegion } from "@/pages/session/composer"

/**
 * The `/new-session` draft page. Unlike `session.tsx`, this only renders the prompt
 * composer for a brand-new session — no terminal, review pane, file tree, or message
 * timeline. Submitting promotes the draft into a real session (see prompt-input/submit).
 */
export default function NewSessionPage() {
  const prompt = usePrompt()
  const sdk = useSDK()
  const sync = useSync()
  const comments = useComments()
  const workspace = useChatWorkspace()
  const [searchParams] = useSearchParams<{ draftId?: string; prompt?: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  let inputRef: HTMLDivElement | undefined

  const composer = createSessionComposerState()
  // Identity and dirty are both registered from the route alone: identity so a close during
  // prompt hydration still resolves this draft as the routed tab, dirty as a live source that
  // the close/leave decision evaluates later. Owner tokens keep a previous page instance's
  // cleanup from clearing a newer registration of the same key.
  const routeIdentityToken = Symbol("draft-route-identity")
  const dirtyToken = Symbol("draft-dirty")
  const dirtyKey = createMemo(() => (searchParams.draftId ? `draft:${searchParams.draftId}` : undefined))

  createEffect(() => {
    const key = dirtyKey()
    if (!key) return
    workspace?.route.setActiveTabKey(key, routeIdentityToken)
    // Registered as a live source: `prompt.dirty()` is evaluated when the close or the
    // route leave is decided, so a click can never race a pending effect flush.
    workspace?.dirty.register(key, () => prompt.dirty(), dirtyToken)
  })
  onCleanup(() => {
    const key = dirtyKey()
    if (!key) return
    workspace?.dirty.clear(key, dirtyToken)
    workspace?.route.clearActiveTabKey(key, routeIdentityToken)
  })

  const [store, setStore] = createStore({
    worktree: "main",
  })

  const newSessionWorktree = createMemo(() => {
    if (store.worktree === "create") return "create"
    const project = sync().project
    if (project && sdk().directory !== project.worktree) return sdk().directory
    return "main"
  })

  createEffect(() => {
    if (!prompt.ready()) return
    untrack(() => {
      const text = searchParams.prompt
      if (!text) return
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
      // One-shot cleanup: replace (no history entry) and flagged as internal so
      // the dirty guard does not treat it as the user leaving (plan §7.1).
      runInternalNavigation(() =>
        navigate(UrlParams.withoutParams(location, ["prompt"]), { replace: true, scroll: false, resolve: false }),
      )
    })
  })

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus())
  })

  return (
    <div class="relative size-full overflow-hidden flex flex-col">
      <div class="flex-1 min-h-0 flex flex-col gap-2 p-2">
        <div class="@container relative flex flex-col min-h-0 h-full bg-background-stronger flex-1">
          <div class="flex-1 min-h-0 overflow-hidden rounded-[10px]">
            <NewSessionDesignView>
              <SessionComposerRegion
                state={composer}
                centered={false}
                placement="inline"
                inputRef={(el) => {
                  inputRef = el
                }}
                newSessionWorktree={newSessionWorktree()}
                onNewSessionWorktreeReset={() => setStore("worktree", "main")}
                onSubmit={() => comments.clear()}
                onResponseSubmit={() => {}}
                setPromptDockRef={() => {}}
              />
            </NewSessionDesignView>
          </div>
        </div>
      </div>
    </div>
  )
}
