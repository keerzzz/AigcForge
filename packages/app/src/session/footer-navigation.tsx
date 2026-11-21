import { createMemo, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { Button } from "@aigcfroge/ui/button"
import { Icon } from "@aigcfroge/ui/icon"
import { Popover } from "@aigcfroge/ui/popover"
import { Tooltip } from "@aigcfroge/ui/tooltip"
import type { SessionMessageUser } from "@aigcfroge/client/promise"
import { SessionControlsProvider } from "@aigcfroge/session-ui/context/controls"
import type { MountedSession, SessionScreen } from "@aigcfroge/gui-extensions/sdk"
import { ExtensionSlot } from "@/runtime/extension/render"
import type { Accessor } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useShellFooter } from "@/shell/footer"
import type { SessionModel } from "./model"
import type { SessionTimelineInteraction } from "./timeline/interaction"
import { parseCommentNote, readPromptPresentation } from "@/composer/comment-note"
import "./footer-navigation.css"

export function SessionFooterNavigation(props: {
  session: SessionModel
  timeline: SessionTimelineInteraction
  view?: Accessor<MountedSession>
  screen?: SessionScreen
}) {
  const footer = useShellFooter()
  const language = useLanguage()
  const [state, setState] = createStore({ open: false, loading: false, failed: false })
  const lifetime = new AbortController()
  onCleanup(() => lifetime.abort())
  const data = props.session.shared.data
  const messages = props.session.history.visibleUserMessages
  const more = () => data.session.message.more(props.session.identity.sessionID())
  const current = createMemo(
    () => props.timeline.activeMessage() ?? (props.timeline.view.pinned() ? messages().at(-1)?.id : undefined),
  )
  const index = () => messages().findIndex((message) => message.id === current())
  const summary = (message: SessionMessageUser) => {
    const presentation = readPromptPresentation(message.metadata)
    const text =
      presentation?.displayText ||
      presentation?.comments.map((item) => item.comment).join(" · ") ||
      parseCommentNote(message.text)?.comment ||
      message.text

    return text.trim().replace(/\s+/g, " ") || language.t("shell.footer.attachmentInput")
  }
  const time = createMemo(
    () =>
      new Intl.DateTimeFormat(language.locale(), {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
  )
  const choose = (message: SessionMessageUser) => {
    props.timeline.actions.selectMessage(message)
    setState("open", false)
  }

  async function loadOlder(previous?: { id?: string }) {
    if (state.loading) return
    const owner = props.session.ownership.capture()
    const id = props.session.identity.sessionID()

    if (!id) return
    const first = messages()[0]?.id
    const choice = props.timeline.navigationVersion()
    setState({ loading: true, failed: false })

    try {
      // A page is model history, not a page of user inputs. Continue through assistant-only pages.
      do {
        await data.session.message.loadMore(id, { signal: lifetime.signal })

        if (lifetime.signal.aborted || !owner.current()) return
        // A newer picker, latest, or keyboard selection owns navigation; the page still hydrates history.
        if (previous && choice !== props.timeline.navigationVersion()) return
        if (previous) {
          const position = previous.id
            ? messages().findIndex((message) => message.id === previous.id)
            : messages().length

          if (position > 0) {
            choose(messages()[position - 1])
            break
          }
        }
        if (!previous && messages()[0]?.id !== first) break
      } while (data.session.message.more(id))
    } catch {
      if (!lifetime.signal.aborted && owner.current()) setState("failed", true)
    } finally {
      if (!lifetime.signal.aborted && owner.current()) setState("loading", false)
    }
  }

  return (
    <>
      <Show when={footer?.navigation()} keyed>
        {(mount) => (
          <Portal mount={mount}>
            <nav class="session-input-navigation" aria-label={language.t("shell.footer.inputs")}>
              <Tooltip value={language.t("shell.footer.previousInput")}>
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  class="session-input-arrow"
                  aria-label={language.t("shell.footer.previousInput")}
                  disabled={state.loading || (!messages().length && !more()) || (index() === 0 && !more())}
                  onClick={() => {
                    const position = index() < 0 ? messages().length : index()

                    if (position > 0) return choose(messages()[position - 1])
                    void loadOlder({ id: current() })
                  }}
                >
                  <Icon name="chevron-left" size="small" />
                </Button>
              </Tooltip>
              <Popover
                placement="top"
                class="session-input-popover"
                title={language.t("shell.footer.inputs")}
                open={state.open}
                onOpenChange={(open) => setState("open", open)}
                triggerAs={Button}
                triggerProps={{
                  variant: "ghost-muted",
                  size: "small",
                  class: "session-input-selector",
                  "aria-label": language.t("shell.footer.inputs"),
                }}
                trigger={
                  <>
                    <span>{language.t("shell.footer.inputs")}</span>
                    <Show when={!more() && index() >= 0}>
                      <span>
                        {index() + 1}/{messages().length}
                      </span>
                    </Show>
                    <Show when={more()}>
                      <Icon name="outline-dots" size="small" />
                    </Show>
                    <Icon name="chevron-down" size="small" />
                  </>
                }
              >
                <div class="session-input-picker">
                  <Show when={more()}>
                    <p>{language.t("shell.footer.partialHistory")}</p>
                  </Show>
                  <Show when={state.failed}>
                    <p role="alert">{language.t("shell.footer.historyFailed")}</p>
                  </Show>
                  <Show when={messages().length} fallback={<p>{language.t("shell.footer.noInputs")}</p>}>
                    <ol>
                      <For each={messages()}>
                        {(message, position) => (
                          <li>
                            <Button
                              type="button"
                              variant="ghost-muted"
                              class="session-input-option"
                              aria-current={current() === message.id ? "true" : undefined}
                              title={summary(message)}
                              onClick={() => choose(message)}
                            >
                              <Show when={!more()}>
                                <span class="session-input-number">{position() + 1}</span>
                              </Show>
                              <span class="session-input-summary">{summary(message)}</span>
                              <time dateTime={new Date(message.time.created).toISOString()}>
                                {time().format(message.time.created)}
                              </time>
                            </Button>
                          </li>
                        )}
                      </For>
                    </ol>
                  </Show>
                  <Show when={more()}>
                    <Button
                      type="button"
                      variant="outline"
                      size="small"
                      disabled={state.loading}
                      onClick={() => void loadOlder()}
                    >
                      {language.t(
                        state.loading ? "common.loading" : state.failed ? "common.retry" : "shell.footer.loadEarlier",
                      )}
                    </Button>
                  </Show>
                </div>
              </Popover>
              <Tooltip value={language.t("shell.footer.nextInput")}>
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  class="session-input-arrow"
                  aria-label={language.t("shell.footer.nextInput")}
                  disabled={index() < 0 || index() >= messages().length - 1}
                  onClick={() => choose(messages()[index() + 1])}
                >
                  <Icon name="chevron-right" size="small" />
                </Button>
              </Tooltip>
              <Tooltip value={language.t("session.messages.jumpToLatest")}>
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  class="session-input-latest"
                  aria-label={language.t("session.messages.jumpToLatest")}
                  disabled={props.timeline.view.pinned()}
                  onClick={props.timeline.actions.resume}
                >
                  <Icon name="arrow-down-to-line" size="small" />
                </Button>
              </Tooltip>
            </nav>
          </Portal>
        )}
      </Show>
      <Show when={footer?.actions()} keyed>
        {(mount) => (
          <Show when={props.view && props.screen ? { view: props.view, screen: props.screen } : undefined}>
            {(mounted) => (
              <Portal mount={mount}>
                <div class="flex items-center gap-1">
                  <SessionControlsProvider expanded>
                    <ExtensionSlot
                      at="session.header"
                      input={{
                        get session() {
                          return mounted().view()
                        },
                        get screen() {
                          return mounted().screen
                        },
                        active: true,
                      }}
                    />
                  </SessionControlsProvider>
                </div>
              </Portal>
            )}
          </Show>
        )}
      </Show>
    </>
  )
}
