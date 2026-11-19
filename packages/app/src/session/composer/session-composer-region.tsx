import { Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { SessionPermissionDock } from "@/session/requests/session-permission-dock"
import { SessionQuestionDock } from "@/session/requests/session-question-dock"
import { SessionWebSearchDock } from "@/session/requests/session-websearch-dock"
import type { SessionComposerRegionController } from "./session-composer-region-controller"

type SessionComposerRegionState = Pick<
  SessionComposerRegionController["state"],
  "questionRequest" | "websearch" | "permissionRequest" | "permissionResponding" | "decide" | "blocked"
> &
  Partial<Pick<SessionComposerRegionController["state"], "ownsResponse" | "openResponseOwner">>

export type SessionComposerRegionViewController = Pick<
  SessionComposerRegionController,
  "centered" | "onResponseSubmit" | "openParent" | "setPromptRef" | "setDockRef" | "parentID" | "child" | "showComposer"
> & { state: SessionComposerRegionState; readonly?: () => boolean }

export function SessionComposerRegion(props: {
  controller: SessionComposerRegionViewController
  composer: JSX.Element
  tasks?: JSX.Element
  goal?: JSX.Element
}) {
  const language = useLanguage()
  const controller = props.controller
  const ownsResponse = (sessionID?: string) => controller.state.ownsResponse?.(sessionID) ?? true

  const waitingSession = () => {
    const permission = controller.state.permissionRequest()

    if (permission && !ownsResponse(permission.sessionID)) return permission.sessionID
    const question = controller.state.questionRequest()

    if (question && !ownsResponse(question.sessionID)) return question.sessionID
    const search = controller.state.websearch.request()

    if (search && !ownsResponse(search.sessionID)) return search.sessionID
  }

  return (
    <div
      ref={controller.setDockRef}
      data-component="session-composer-dock"
      class="w-full shrink-0 flex flex-col justify-center items-center pb-3 pointer-events-none bg-v2-background-bg-base"
    >
      <div
        classList={{
          "w-full px-3 pointer-events-auto": true,
          "md:max-w-session md:mx-auto": controller.centered(),
        }}
      >
        {props.tasks}
        <Show when={waitingSession()}>
          <div class="mb-2 rounded-[12px] border border-border-weak-base bg-background-base p-3 text-13-regular text-text-weak">
            <span>{language.t("session.target.requestElsewhere")}</span>
            <button
              type="button"
              class="ms-2 text-text-base hover:text-text-strong"
              onClick={() => controller.state.openResponseOwner?.(waitingSession())}
            >
              {language.t("session.target.openMain")}
            </button>
          </div>
        </Show>
        <Show
          when={ownsResponse(controller.state.websearch.request()?.sessionID) && controller.state.websearch.request()}
        >
          <SessionWebSearchDock model={controller.state.websearch} onSubmit={controller.onResponseSubmit} />
        </Show>
        <Show
          when={
            ownsResponse(controller.state.questionRequest()?.sessionID) ? controller.state.questionRequest() : undefined
          }
          keyed
        >
          {(request) => (
            <div>
              <SessionQuestionDock request={request} onSubmit={controller.onResponseSubmit} />
            </div>
          )}
        </Show>

        <Show
          when={
            ownsResponse(controller.state.permissionRequest()?.sessionID)
              ? controller.state.permissionRequest()
              : undefined
          }
          keyed
        >
          {(request) => (
            <div>
              <SessionPermissionDock
                request={request}
                responding={controller.state.permissionResponding()}
                onDecide={(response) => {
                  controller.onResponseSubmit()
                  controller.state.decide(response)
                }}
              />
            </div>
          )}
        </Show>

        {props.goal}
        <Show when={controller.showComposer() && !(controller.child() && controller.readonly?.())}>
          <div
            classList={{
              "relative z-[70]": true,
            }}
          >
            <Show
              when={controller.child() || controller.readonly?.()}
              fallback={<Show when={!controller.state.blocked()}>{props.composer}</Show>}
            >
              <div
                ref={controller.setPromptRef}
                class="w-full rounded-[12px] border border-border-weak-base bg-background-base p-3 text-16-regular text-text-weak"
              >
                <span>
                  {language.t(controller.child() ? "session.child.promptDisabled" : "session.target.readonly")}
                </span>
                <Show when={controller.parentID()}>
                  <button
                    type="button"
                    class="text-text-base transition-colors hover:text-text-strong"
                    onClick={controller.openParent}
                  >
                    {language.t("session.child.backToParent")}
                  </button>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
