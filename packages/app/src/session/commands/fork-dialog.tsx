import { type Component, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useSessionParams } from "../content-context"
import type { SessionForkInput, SessionInfo } from "@aigcfroge/client/promise"
import { useData } from "@/runtime/server/current"
import { useComposerState } from "@/composer/persistence"
import { useDialog } from "@aigcfroge/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@aigcfroge/ui/dialog"
import { Button } from "@aigcfroge/ui/button"
import { List } from "@aigcfroge/ui/list"
import { showToast } from "@/shell/notifications/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { base64Encode } from "@aigcfroge/util/encode"
import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServer } from "@/runtime/server/current"
import { sessionHref } from "@/shell/routes/session"

type ForkableMessage = { id: string; text: string; time: string }

export const DialogFork: Component = () => {
  const params = useSessionParams()
  const navigate = useNavigate()
  const data = useData()
  const serverSDK = useServerSDK()
  const location = useWorkspaceLocation()
  const prompt = useComposerState()
  const dialog = useDialog()
  const language = useLanguage()
  const server = useServer()

  const [state, setState] = createStore<{
    preview?: {
      info: SessionInfo & { mode: NonNullable<SessionInfo["mode"]> }
      expectedSource: NonNullable<SessionForkInput["expectedSource"]>
      messageID: string
    }
    managed: boolean
    pending: boolean
  }>({ managed: false, pending: false })

  let generation = 0
  let disposed = false
  onCleanup(() => {
    disposed = true
    generation++
  })

  const messages = createMemo((): ForkableMessage[] => {
    if (!params.id) return []

    return data.session.message
      .list(params.id)
      .flatMap((message) =>
        message.type === "user" && message.text
          ? [
              {
                id: message.id,
                text: message.text.replace(/\n/g, " ").slice(0, 200),
                time: new Date(message.time.created).toLocaleTimeString(undefined, { timeStyle: "short" }),
              },
            ]
          : [],
      )
      .reverse()
  })

  const handleSelect = async (item: ForkableMessage | undefined) => {
    if (!item || state.pending || !params.id) return
    const sessionID = params.id
    const owner = serverSDK.api
    const directory = location().directory
    const attempt = ++generation

    const current = () =>
      !disposed &&
      attempt === generation &&
      owner === serverSDK.api &&
      params.id === sessionID &&
      location().directory === directory

    setState("pending", true)

    try {
      const info = await owner.session.get({ sessionID })

      if (!current()) return

      if (!info.mode) throw new Error(language.t("newSession.mode.unsupported"))

      const composition =
        info.mode === "custom"
          ? await owner["session-instance"].session.instance.session.composition({ sessionID, directory })
          : undefined

      if (!current()) return
      setState({
        preview: {
          info: { ...info, mode: info.mode },
          messageID: item.id,
          expectedSource: {
            sourceSessionID: info.id,
            mode: info.mode,
            agent: info.agent,
            controller: info.controller,
            model: info.model,
            compositionDigest: composition?.digest,
          },
        },
        managed: info.controller?.kind === "root" && info.agent === "meta",
        pending: false,
      })
    } catch (cause) {
      if (!current()) return
      setState("pending", false)
      showToast({
        title: language.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  const preference = () => {
    const info = state.preview?.info

    if (info?.controller?.kind === "child") return info.controller.executor

    return state.managed ? info?.executorPreference : undefined
  }

  const modelText = (model: SessionInfo["model"]) => {
    if (!model) return language.t("dialog.fork.modelInherited")

    if ("type" in model) {
      const read = data.location.model.group.definition.list(location())
      const group = read?.effective.find((group) => group.groupID === model.groupID)
      const label = language.t("model.group.selection", { name: group?.definition?.name || model.groupID })
      const unavailable = group ? group.unavailable : read ? "missing" : undefined

      return unavailable
        ? language.t("home.custom.model.groupUnavailable", {
            model: label,
            reason: language.t(`model.group.unavailable.${unavailable}`),
          })
        : label
    }

    return language.t("dialog.fork.modelRef", {
      provider: model.providerID,
      model: model.id,
      variant: model.variant ?? language.t("dialog.fork.variantImplicit"),
    })
  }

  const confirm = async () => {
    const preview = state.preview

    if (!preview || state.pending || preview.info.controller?.kind === "child") return
    const sessionID = params.id

    if (sessionID !== preview.info.id) return
    const message = data.session.message.get(sessionID, preview.messageID)

    if (message?.type !== "user") return
    const owner = serverSDK.api
    const directory = location().directory
    const key = server.key
    const attempt = ++generation

    const current = () =>
      !disposed &&
      attempt === generation &&
      owner === serverSDK.api &&
      params.id === sessionID &&
      location().directory === directory &&
      state.preview === preview

    const restored = extractPromptFromMessage(message, { directory, attachmentName: language.t("common.attachment") })
    const context = extractPromptContext(message, { directory })

    const request: SessionForkInput = {
      sessionID,
      before: preview.messageID,
      expectedSource: preview.expectedSource,
      ...(state.managed && { control: "meta", model: preview.info.model, executorPreference: preference() }),
    }

    setState("pending", true)

    try {
      const forked = await owner.session.fork(request)

      if (!current()) return
      data.session.remember(forked)
      const target = prompt.capture({ dir: base64Encode(directory), id: forked.id })
      target.set(restored)
      target.context.replace([...context.comments, ...context.files])
      dialog.close()
      navigate(sessionHref(key, forked.id))
    } catch (cause) {
      if (!current()) return
      setState({ preview: undefined, managed: false, pending: false })
      showToast({
        title: language.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle>{language.t("command.session.fork")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Show
          when={state.preview}
          fallback={
            <List
              class="flex-1 px-3 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
              search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
              emptyMessage={language.t("dialog.fork.empty")}
              key={(x) => x.id}
              items={messages}
              filterKeys={["text"]}
              onSelect={handleSelect}
            >
              {(item) => (
                <div class="w-full flex items-center gap-2">
                  <span class="truncate flex-1 min-w-0 text-left font-normal">{item.text}</span>
                  <span class="text-text-weak shrink-0 font-normal">{item.time}</span>
                </div>
              )}
            </List>
          }
        >
          {(preview) => (
            <div class="flex flex-col gap-4 px-4 pb-4">
              <p>{language.t("dialog.fork.preview")}</p>
              <div class="text-text-strong">{preview().info.title}</div>
              <div class="text-text-weak">
                {language.t("dialog.fork.sourceIdentity", {
                  id: preview().info.id,
                  mode: preview().info.mode,
                  agent: preview().info.agent ?? language.t("dialog.fork.agentInherited"),
                })}
              </div>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={state.managed}
                  disabled={
                    state.pending ||
                    preview().info.controller?.kind === "child" ||
                    (preview().info.controller?.kind === "root" && preview().info.agent === "meta")
                  }
                  onChange={(event) => setState("managed", event.currentTarget.checked)}
                />
                {language.t("dialog.fork.managed")}
              </label>
              <div class="flex flex-col gap-1">
                <span class="text-text-weak">{language.t("dialog.fork.sessionModel")}</span>
                <span>{modelText(preview().info.model)}</span>
                <Show when={state.managed}>
                  <span class="text-text-weak">{language.t("dialog.fork.delegatedAgent")}</span>
                  <span>{preference()?.agent ?? language.t("dialog.fork.delegatedAgentInherited")}</span>
                  <span class="text-text-weak">{language.t("dialog.fork.delegatedModel")}</span>
                  <span>{modelText(preference()?.model)}</span>
                </Show>
              </div>
              <Show when={preview().expectedSource.compositionDigest}>
                {(digest) => (
                  <div class="text-text-weak">{language.t("dialog.fork.composition", { digest: digest() })}</div>
                )}
              </Show>
              <Show when={preview().info.controller?.kind === "child"}>
                <p role="alert">{language.t("dialog.fork.childUnsupported")}</p>
              </Show>
              <div class="flex gap-2">
                <Button
                  variant="outline"
                  disabled={state.pending}
                  onClick={() => {
                    generation++
                    setState({ preview: undefined, managed: false })
                  }}
                >
                  {language.t("dialog.fork.back")}
                </Button>
                <Button disabled={state.pending || preview().info.controller?.kind === "child"} onClick={confirm}>
                  {language.t("dialog.fork.confirm")}
                </Button>
              </div>
            </div>
          )}
        </Show>
      </DialogBody>
    </Dialog>
  )
}
