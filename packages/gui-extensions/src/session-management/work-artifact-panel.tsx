import { isConflictError, isFileNotFoundError, type WorkArtifactApplyOutput } from "@omnixa/client/promise"
import { Button } from "@omnixa/ui/button"
import { TextField } from "@omnixa/ui/text-field"
import { errorMessage } from "@omnixa/util/error"
import { createMemo, onCleanup, Show } from "solid-js"
import { createKeyed, useExtension, type MountedSession, type SessionScreen } from "../sdk"
import type SessionManagement from "./index"

type ArtifactState = {
  owner: string | undefined
  operation: symbol | undefined
  title: string
  relativePath: string
  pending: "apply" | "read" | undefined
  outcome: "candidate" | "written" | "applied" | "different" | "missing" | "readFailed" | "failed"
  receipt: WorkArtifactApplyOutput | undefined
  error: string | undefined
  confirm: boolean
}

type ArtifactProps = { session: MountedSession; active: boolean; screen: SessionScreen }

type ReadLifecycle = { active: boolean; read: number; controller: AbortController | undefined }

export function WorkArtifactPanel(props: ArtifactProps) {
  return (
    <Show when={props.session.key} keyed>
      {(_key) => <WorkArtifactContent session={props.session} active={props.active} screen={props.screen} />}
    </Show>
  )
}

function WorkArtifactContent(props: ArtifactProps) {
  const ctx = useExtension<typeof SessionManagement>()
  const data = () => props.session.server.data
  const stored = ctx.stores.artifact(props.session)

  const lifecycle: ReadLifecycle = {
    active: true,
    read: 0,
    controller: undefined,
  }

  const [state, write] = ctx.storage.memory<ArtifactState>(`artifact.${props.session.key}`, {
    initial: {
      owner: undefined,
      operation: undefined,
      title: "",
      relativePath: "",
      pending: undefined,
      outcome: "candidate",
      receipt: undefined,
      error: undefined,
      confirm: false,
    },
  })

  const setState = (change: Partial<ArtifactState>) =>
    write((draft) => {
      Object.assign(draft, change)
    })

  const candidate = createMemo(
    () => {
      props.session.server.connected
      props.session.server.attempt

      if (!stored.value) return
      const session = data().session.get(props.session.id)

      if (!session || (session.mode !== "work" && !session.workContract?.output?.artifact && !stored.value.messageID))
        return

      const message = data()
        .session.message.list(props.session.id)
        .findLast(
          (item) =>
            item.type === "assistant" && item.content.some((part) => part.type === "text" && part.text.length > 0),
        )

      if (message?.type !== "assistant") return
      const artifact = session.workContract?.output?.artifact

      return {
        api: props.session.server.client,
        serverID: props.session.server.id,
        attempt: props.session.server.attempt,
        key: JSON.stringify([
          props.session.key,
          props.session.server.attempt,
          session.location.directory,
          message.id,
          message.content,
          message.time.completed,
          message.error,
          session.workContract,
        ]),
        sessionID: session.id,
        directory: session.location.directory,
        messageID: message.id,
        content: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        complete: message.time.completed !== undefined && message.error === undefined,
        contract: session.workContract,
        title: artifact?.title ?? "",
        relativePath: artifact ? [artifact.relativeDir, artifact.filename].filter(Boolean).join("/") : "",
      }
    },
    undefined,
    {
      equals: (prior, next) => {
        if (prior === next) return true

        if (!prior || !next) return false

        return (
          prior.api === next.api &&
          prior.attempt === next.attempt &&
          prior.sessionID === next.sessionID &&
          prior.directory === next.directory &&
          prior.messageID === next.messageID &&
          prior.content === next.content &&
          prior.complete === next.complete &&
          prior.contract === next.contract &&
          prior.title === next.title &&
          prior.relativePath === next.relativePath
        )
      },
    },
  )

  const owner = () => candidate()?.key

  const draft = (): ArtifactState => {
    if (state.owner === owner()) return state
    const saved = stored.value?.messageID === candidate()?.messageID ? stored.value : undefined

    return {
      owner: owner(),
      operation: state.operation,
      title: saved?.title ?? candidate()?.title ?? "",
      relativePath: saved?.relativePath ?? candidate()?.relativePath ?? "",
      pending: state.pending,
      outcome: "candidate",
      receipt: undefined,
      error: undefined,
      confirm: false,
    }
  }

  const connected = () => props.session.server.connected

  const current = (value: NonNullable<ReturnType<typeof candidate>>, token: string) => {
    const server = ctx.servers.get(value.serverID)

    return (
      state.owner === token &&
      server?.client === value.api &&
      server.attempt === value.attempt &&
      server.data.session.get(value.sessionID)?.location.directory === value.directory
    )
  }

  function edit(field: "title" | "relativePath", value: string) {
    lifecycle.read++
    lifecycle.controller?.abort()
    const input = draft()
    void stored.update((saved) => {
      saved.messageID = candidate()?.messageID
      saved.title = field === "title" ? value : input.title
      saved.relativePath = field === "relativePath" ? value : input.relativePath
    })
    setState({
      ...input,
      [field]: value,
      receipt: field === "relativePath" ? undefined : draft().receipt,
      outcome: "candidate",
      pending: undefined,
      error: undefined,
      confirm: false,
    })
  }

  async function verify() {
    const value = candidate()
    const input = draft()

    if (
      ctx.signal.aborted ||
      !value ||
      !value.complete ||
      !props.active ||
      !connected() ||
      !input.relativePath.trim() ||
      input.pending === "apply"
    )
      return
    const token = value.key
    const path = input.receipt?.relativePath ?? input.relativePath
    const title = input.title
    const relativePath = input.relativePath
    const read = ++lifecycle.read
    lifecycle.controller?.abort()
    const controller = new AbortController()
    lifecycle.controller = controller
    setState({ ...input, pending: "read", error: undefined, confirm: false })

    const stillCurrent = () =>
      !ctx.signal.aborted &&
      lifecycle.active &&
      current(value, token) &&
      props.active &&
      read === lifecycle.read &&
      !controller.signal.aborted &&
      draft().title === title &&
      draft().relativePath === relativePath

    try {
      const bytes = await value.api.file.read(
        { location: { directory: value.directory }, path },
        { signal: controller.signal, headers: { "cache-control": "no-cache" } },
      )

      if (!stillCurrent()) return
      const content = new TextEncoder().encode(value.content)
      const applied = bytes.length === content.length && bytes.every((byte, index) => byte === content[index])
      setState({ pending: undefined, outcome: applied ? "applied" : "different", confirm: !applied })
    } catch (error) {
      if (!stillCurrent()) return

      if (isFileNotFoundError(error)) {
        setState({ pending: undefined, outcome: input.receipt ? "missing" : "candidate" })

        return
      }

      setState({
        pending: undefined,
        outcome: "readFailed",
        error: errorMessage(error, ctx.t("session.artifact.error.unknown")),
      })
    }
  }

  async function apply(overwrite: boolean) {
    const value = candidate()
    const input = draft()

    if (
      ctx.signal.aborted ||
      !value ||
      !value.complete ||
      !props.active ||
      !connected() ||
      input.pending ||
      (overwrite && !input.confirm)
    )
      return

    if (!overwrite && ((input.receipt && input.outcome !== "missing") || input.outcome === "applied")) return

    if (!input.title.trim() || !input.relativePath.trim()) {
      setState({ ...input, outcome: "failed", error: ctx.t("session.artifact.error.required") })

      return
    }

    const token = value.key
    const operation = Symbol()
    setState({ ...input, operation, pending: "apply", error: undefined, confirm: false })

    try {
      const receipt = await data().session.artifact.apply({
        sessionID: value.sessionID,
        directory: value.directory,
        title: input.title,
        relativePath: input.relativePath,
        content: value.content,
        overwrite,
      })

      if (!current(value, token) || state.operation !== operation) return
      // The ACK records a completed write. Only a matching file read grants the applied display state.
      setState({ pending: undefined, operation: undefined, receipt, outcome: "written" })
    } catch (error) {
      if (!current(value, token) || state.operation !== operation) return

      if (isConflictError(error)) {
        setState({ pending: undefined, operation: undefined, outcome: "different", confirm: true })

        return
      }

      setState({
        pending: undefined,
        operation: undefined,
        outcome: "failed",
        error: errorMessage(error, ctx.t("session.artifact.error.unknown")),
      })
    } finally {
      if (state.operation === operation) setState({ pending: undefined, operation: undefined })
    }
  }

  // File reads follow visibility. A write settles into session memory even after this render goes away.
  createKeyed(
    () =>
      props.active &&
      connected() &&
      state.pending !== "apply" &&
      !(state.owner === owner() && state.outcome === "failed") &&
      candidate(),
    (value) => {
      void verify()
      onCleanup(() => {
        lifecycle.controller?.abort()

        if (state.pending === "read") setState({ pending: undefined })
      })
      onCleanup(
        props.session.server.data.on("filesystem.changed", (event) => {
          if (event.location?.directory !== value.directory) return

          if (
            props.screen.file.resolve(event.data.file) !==
            props.screen.file.resolve(draft().receipt?.relativePath ?? draft().relativePath)
          )
            return
          void verify()
        }),
      )
    },
  )
  onCleanup(() => {
    lifecycle.active = false
    lifecycle.controller?.abort()

    if (state.pending === "read") setState({ pending: undefined })
  })

  return (
    <Show when={props.active}>
      <section data-component="work-artifact-panel" aria-label={ctx.t("session.artifact.title")}>
        <h3>{ctx.t("session.artifact.title")}</h3>
        <Show when={candidate()} fallback={<p data-slot="artifact-status">{ctx.t("session.artifact.empty")}</p>}>
          {(value) => (
            <>
              <pre data-slot="artifact-preview" tabIndex={0} aria-label={ctx.t("session.artifact.preview")}>
                {value().content}
              </pre>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void apply(false)
                }}
              >
                <TextField
                  label={ctx.t("session.artifact.documentTitle")}
                  value={draft().title}
                  onChange={(text) => edit("title", text)}
                  disabled={draft().pending === "apply"}
                  required
                />
                <TextField
                  label={ctx.t("session.artifact.path")}
                  description={ctx.t("session.artifact.pathHint")}
                  value={draft().relativePath}
                  onChange={(path) => edit("relativePath", path)}
                  disabled={draft().pending === "apply"}
                  required
                />
                <p data-slot="artifact-status" role="status" aria-live="polite">
                  {ctx.t(
                    !connected()
                      ? "session.artifact.offline"
                      : !value().complete
                        ? "session.artifact.incomplete"
                        : draft().pending === "apply"
                          ? "session.artifact.applying"
                          : draft().pending === "read"
                            ? "session.artifact.checking"
                            : draft().outcome === "readFailed" && draft().receipt
                              ? "session.artifact.status.writtenUnverified"
                              : `session.artifact.status.${draft().outcome}`,
                  )}
                </p>
                <Show when={draft().error}>
                  {(error) => (
                    <p data-slot="artifact-error" role="alert">
                      {error()}
                    </p>
                  )}
                </Show>
                <Show when={draft().confirm}>
                  <div
                    data-slot="artifact-confirm"
                    role="group"
                    aria-label={ctx.t("session.artifact.overwriteConfirm")}
                  >
                    <p>{ctx.t("session.artifact.overwriteConfirm")}</p>
                    <div data-slot="artifact-actions">
                      <Button
                        type="button"
                        size="small"
                        variant="contrast"
                        onClick={() => void apply(true)}
                        disabled={!connected() || !value().complete || !!draft().pending}
                      >
                        {ctx.t("session.artifact.overwrite")}
                      </Button>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        onClick={() => setState({ ...draft(), confirm: false })}
                        disabled={!!draft().pending}
                      >
                        {ctx.t("session.artifact.cancel")}
                      </Button>
                    </div>
                  </div>
                </Show>
                <div data-slot="artifact-actions">
                  <Button
                    type="submit"
                    size="small"
                    variant="contrast"
                    disabled={
                      !connected() ||
                      !value().complete ||
                      !!draft().pending ||
                      (!!draft().receipt && draft().outcome !== "missing") ||
                      draft().outcome === "applied" ||
                      draft().confirm
                    }
                  >
                    {ctx.t("session.artifact.apply")}
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    onClick={() => void verify()}
                    disabled={!connected() || !value().complete || !!draft().pending || !draft().relativePath.trim()}
                  >
                    {ctx.t("session.artifact.check")}
                  </Button>
                  <Show when={draft().outcome === "applied"}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      onClick={() =>
                        ctx.links.open({
                          href: draft().receipt?.relativePath ?? draft().relativePath,
                          session: props.session,
                          exact: true,
                        })
                      }
                    >
                      {ctx.t("session.artifact.open")}
                    </Button>
                  </Show>
                </div>
              </form>
            </>
          )}
        </Show>
      </section>
    </Show>
  )
}

export default WorkArtifactPanel
