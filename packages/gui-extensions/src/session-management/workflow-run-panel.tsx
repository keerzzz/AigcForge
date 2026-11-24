import {
  isConflictError,
  isInvalidRequestError,
  type AgentAssetSummary,
  type CompositionTemporaryInput,
  type WorkflowAssetInfo,
  type WorkflowAssetSummary,
  type WorkflowAssetStepRunInfo,
  type WorkflowAssetWorkflowStatusResponse,
} from "@omnixa/client/promise"
import { Button } from "@omnixa/ui/button"
import { Badge } from "@omnixa/ui/badge"
import { Collapsible } from "@omnixa/ui/collapsible"
import { Select } from "@omnixa/ui/select"
import { SessionMessage } from "@omnixa/schema/session-message"
import { Match } from "effect"
import { For, Show, createMemo, onCleanup } from "solid-js"
import { unwrap } from "solid-js/store"
import { errorMessage } from "@omnixa/util/error"
import { createKeyed, useExtension, type MountedSession, type SessionTargetRef } from "../sdk"
import type SessionManagement from "./index"

type Action =
  | { kind: "run"; digest: string }
  | { kind: "requestRun"; text: string }
  | { kind: "requestRetry"; text: string }
  | { kind: "cancelRun"; runID: string; runRevision: number }
  | {
      kind: "cancelStep" | "retryStep"
      runID: string
      runRevision: number
      stepID: string
      stepRevision: number
    }

type State = {
  owner: string | undefined
  ownerClient: MountedSession["server"]["client"] | undefined
  operation: symbol | undefined
  mutation: number
  loading: boolean
  definitionLoading: boolean
  readError: string | undefined
  definitionError: string | undefined
  failure: { conflict: boolean; message: string } | undefined
  stale: boolean
  pending: Action["kind"] | undefined
  ack: Action["kind"] | undefined
  acknowledged: WorkflowAssetWorkflowStatusResponse | undefined
  historical: WorkflowAssetWorkflowStatusResponse | undefined
  sourceInput: { sessionID: string; id: string; text: string } | undefined
  snapshot:
    | {
        digest: string
        workflow:
          | {
              name: string
              relativePath: string
              revision: string
              steps: { id: string; name: string; agent: string }[]
            }
          | undefined
      }
    | undefined
  assets: { workflows: WorkflowAssetSummary[]; agents: AgentAssetSummary[] } | undefined
  workDefinition: WorkflowAssetInfo | undefined
  request: { key: string; id: string } | undefined
}

type Props = {
  session: MountedSession
  active: boolean
  openSession: (input: {
    source: MountedSession
    target: SessionTargetRef
    interaction: "interactive" | "readonly"
  }) => void
}

export function WorkflowRunPanel(props: Props) {
  return (
    <Show when={props.session.key} keyed>
      {(_key) => <WorkflowRunContent session={props.session} active={props.active} openSession={props.openSession} />}
    </Show>
  )
}

function WorkflowRunContent(props: Props) {
  const ctx = useExtension<typeof SessionManagement>()
  const data = () => props.session.server.data
  const stored = ctx.stores.workflow(props.session)
  const lifecycle = { active: true, read: 0, definitionRead: 0 }

  const scope = createMemo(
    () => {
      // Reconnection can replace the live API without replacing its SDK object.
      const session = data().session.get(props.session.id)

      if (!session) return undefined
      const source = stored.value?.source
      const sourceDirectory = source ? data().session.get(source.sessionID)?.location.directory : undefined

      return {
        key: JSON.stringify([
          props.session.key,
          props.session.server.attempt,
          session.location.directory,
          session.mode,
          session.parentID,
          session.agent,
          session.controller?.kind,
          source?.sessionID,
          source?.runID,
          source?.stepRunID,
          source?.inputID,
          sourceDirectory,
        ]),
        serverID: props.session.server.id,
        sessionID: props.session.id,
        directory: session.location.directory,
        client: props.session.server.client,
        connection: props.session.server.connected,
        attempt: props.session.server.attempt,
        source: source
          ? {
              sessionID: source.sessionID,
              runID: source.runID,
              stepRunID: source.stepRunID,
              inputID: source.inputID,
            }
          : undefined,
        sourceDirectory,
        customRoot: session.mode === "custom" && session.parentID === undefined,
        workRoot:
          session.mode === "work" &&
          session.parentID === undefined &&
          session.agent === "meta" &&
          session.controller?.kind === "root",
      }
    },
    undefined,
    {
      equals: (previous, next) =>
        previous === next ||
        (!!previous &&
          !!next &&
          previous.key === next.key &&
          previous.client === next.client &&
          previous.connection === next.connection),
    },
  )

  type Scope = NonNullable<ReturnType<typeof scope>>

  const [state, write] = ctx.storage.memory<State>(`workflow.${props.session.key}`, {
    initial: {
      owner: undefined,
      ownerClient: undefined,
      operation: undefined,
      mutation: 0,
      loading: false,
      definitionLoading: false,
      readError: undefined,
      definitionError: undefined,
      failure: undefined,
      stale: false,
      pending: undefined,
      ack: undefined,
      acknowledged: undefined,
      historical: undefined,
      sourceInput: undefined,
      snapshot: undefined,
      assets: undefined,
      workDefinition: undefined,
      request: undefined,
    },
  })

  const setState = (change: Partial<State>) =>
    write((draft) => {
      Object.assign(draft, change)
    })

  const ownsState = () => !!scope() && state.owner === scope()?.key && unwrap(state).ownerClient === scope()?.client
  const connected = () => props.session.server.connected
  const pending = () => state.pending
  const loading = () => ownsState() && state.loading
  const snapshot = () => (ownsState() ? state.snapshot : undefined)

  const workSelection = createMemo(() => {
    if (!scope()?.workRoot || !ownsState() || !state.workDefinition || !state.assets) return undefined
    const workflow = state.workDefinition
    const names = [...new Set(workflow.steps.map((step) => step.agent))]
    const missing = names.filter((name) => state.assets?.agents.filter((agent) => agent.name === name).length !== 1)
    const agents = state.assets.agents.filter((agent) => names.includes(agent.name))

    const input =
      missing.length === 0 && agents.length > 0
        ? ({
            source: "temporary",
            agents: agents.map((agent) => ({
              kind: "agent",
              relativePath: agent.relativePath,
              revision: agent.revision,
            })),
            workflow: { kind: "workflow", relativePath: workflow.relativePath, revision: workflow.revision },
            bindings: {},
            presentation: "native",
            requestedCapabilities: [],
          } satisfies CompositionTemporaryInput)
        : undefined

    return { workflow, missing, input }
  })

  const definition = () => (scope()?.workRoot ? workSelection()?.workflow : snapshot()?.workflow)

  const view = () => {
    const owner = scope()

    if (!owner) return undefined

    if (owner.source) return ownsState() ? state.historical : undefined

    return ownsState() && state.acknowledged ? state.acknowledged : data().session.workflow.get(owner.sessionID)
  }

  const runActive = () => view()?.run?.status === "pending" || view()?.run?.status === "running"

  const current = (owner: Scope) => {
    const server = ctx.servers.get(owner.serverID)

    return (
      state.owner === owner.key &&
      unwrap(state).ownerClient === owner.client &&
      server?.client === owner.client &&
      server.attempt === owner.attempt &&
      server.data.session.get(owner.sessionID)?.location.directory === owner.directory
    )
  }

  const readCurrent = (owner: Scope) => !ctx.signal.aborted && lifecycle.active && props.active && current(owner)

  async function load() {
    const owner = scope()

    if (ctx.signal.aborted || !lifecycle.active || !props.active || !owner || !connected() || !stored.value) return
    const read = ++lifecycle.read
    const mutation = state.mutation
    setState({ loading: true, readError: undefined })

    try {
      if (owner.source) {
        if (!data().session.get(owner.source.sessionID)) {
          await data().session.readback(owner.source.sessionID)

          if (!readCurrent(owner) || read !== lifecycle.read) return
        }

        const session = data().session.get(owner.source.sessionID)

        if (!session) {
          setState({ loading: false, readError: ctx.t("session.workflow.sourceUnavailable") })

          return
        }

        const historical = await owner.client["session-instance"].session.instance.session.workflow.get(
          { sessionID: session.id, directory: session.location.directory, runID: owner.source.runID },
          { signal: ctx.signal },
        )

        if (!readCurrent(owner) || read !== lifecycle.read) return

        if (historical.run?.id !== owner.source.runID || historical.run.sessionID !== owner.source.sessionID) {
          setState({
            loading: false,
            historical: undefined,
            sourceInput: undefined,
            readError: ctx.t("session.workflow.sourceUnavailable"),
          })

          return
        }

        setState({ historical, sourceInput: undefined, stale: false })

        const step = historical.steps.find(
          (step) => step.id === owner.source?.stepRunID && step.runId === historical.run?.id,
        )

        if (owner.source.stepRunID && !step) {
          setState({ loading: false, readError: ctx.t("session.workflow.sourceStepUnavailable") })

          return
        }

        if (owner.source.inputID) {
          if (!step?.childSessionId) {
            setState({ loading: false, readError: ctx.t("session.workflow.sourceInputUnavailable") })

            return
          }
          // A Workflow admits its first child input before the runner promotes it into visible history.

          data().session.pending.invalidate(step.childSessionId)
          await data().session.pending.sync(step.childSessionId)

          if (!readCurrent(owner) || read !== lifecycle.read) return

          const admitted = data()
            .session.pending.list(step.childSessionId)
            .find((item) => item.type === "user" && item.id === owner.source?.inputID)

          if (admitted?.type === "user") {
            setState({
              loading: false,
              sourceInput: { sessionID: step.childSessionId, id: admitted.id, text: admitted.payload.text },
            })

            return
          }

          const input = await owner.client.session.message.get(
            { sessionID: step.childSessionId, messageID: owner.source.inputID },
            { signal: ctx.signal },
          )

          if (!readCurrent(owner) || read !== lifecycle.read) return

          if (input.id !== owner.source.inputID || input.type !== "user") {
            setState({ loading: false, readError: ctx.t("session.workflow.sourceInputUnavailable") })

            return
          }

          setState({ sourceInput: { sessionID: step.childSessionId, id: input.id, text: input.text } })
        }

        setState({ loading: false })

        return
      }

      data().session.workflow.invalidate(owner.sessionID)
      await data().session.workflow.sync(owner.sessionID)

      if (!readCurrent(owner) || read !== lifecycle.read) return
      setState({ loading: false, stale: false })

      // A read started before an action ACK cannot replace that action's returned snapshot.
      if (mutation === state.mutation) setState({ acknowledged: undefined })
    } catch (error) {
      if (!readCurrent(owner) || read !== lifecycle.read) return
      setState({ loading: false, readError: errorMessage(error, ctx.t("session.workflow.error.unknown")) })
    }
  }

  async function loadDefinition(refresh = false) {
    const owner = scope()

    if (
      ctx.signal.aborted ||
      !lifecycle.active ||
      !props.active ||
      !stored.value ||
      !owner ||
      owner.source ||
      (!owner.customRoot && !owner.workRoot) ||
      !connected() ||
      (!refresh &&
        (owner.workRoot
          ? state.assets &&
            (!stored.value.definitionPath || state.workDefinition?.relativePath === stored.value.definitionPath)
          : snapshot()))
    )
      return
    const read = ++lifecycle.definitionRead
    setState({ definitionLoading: true, definitionError: undefined })

    try {
      if (owner.workRoot) {
        const [workflows, agents] = await Promise.all([
          owner.client["workflow-asset"].list({ directory: owner.directory }),
          owner.client["agent-asset"].list({ directory: owner.directory }),
        ])

        if (!readCurrent(owner) || read !== lifecycle.definitionRead) return
        const path = state.workDefinition?.relativePath ?? stored.value?.definitionPath
        setState({ assets: { workflows: workflows.assets, agents: agents.assets }, definitionLoading: false })

        if (path && workflows.assets.some((asset) => asset.relativePath === path)) {
          await selectDefinition(path)

          return
        }

        setState({ workDefinition: undefined })

        return
      }

      const selected = await owner.client["session-instance"].session.instance.session.composition({
        sessionID: owner.sessionID,
        directory: owner.directory,
      })

      if (!readCurrent(owner) || read !== lifecycle.definitionRead) return
      const workflow = selected.version === 2 ? selected.data.workflow : undefined
      setState({
        snapshot: {
          digest: selected.digest,
          workflow: workflow
            ? {
                name: workflow.name,
                relativePath: workflow.relativePath,
                revision: workflow.revision,
                steps: workflow.steps.map((step) => ({ id: step.id, name: step.name, agent: step.agent })),
              }
            : undefined,
        },
        definitionLoading: false,
      })
    } catch (error) {
      if (!readCurrent(owner) || read !== lifecycle.definitionRead) return
      setState({
        definitionLoading: false,
        definitionError: errorMessage(error, ctx.t("session.workflow.error.unknown")),
      })
    }
  }

  async function selectDefinition(path: string) {
    const owner = scope()

    if (ctx.signal.aborted || !lifecycle.active || !props.active || !owner?.workRoot || !connected()) return
    void stored.update((draft) => {
      draft.definitionPath = path
    })
    const read = ++lifecycle.definitionRead
    setState({ workDefinition: undefined, definitionLoading: true, definitionError: undefined })

    try {
      const workflow = await owner.client["workflow-asset"].content({ directory: owner.directory, path })

      if (!readCurrent(owner) || read !== lifecycle.definitionRead) return
      setState({ workDefinition: workflow, definitionLoading: false })
    } catch (error) {
      if (!readCurrent(owner) || read !== lifecycle.definitionRead) return
      setState({
        definitionLoading: false,
        definitionError: errorMessage(error, ctx.t("session.workflow.error.unknown")),
      })
    }
  }

  function refresh() {
    void load()
    void loadDefinition(true)
  }

  async function act(action: Action) {
    const owner = scope()

    if (ctx.signal.aborted || !props.active || !owner || owner.source || !connected() || pending() || state.stale)
      return
    const requestKey = JSON.stringify(action)
    const admission = action.kind === "requestRun" || action.kind === "requestRetry"

    if (admission && !owner.workRoot) return

    const requestID =
      state.request?.key === requestKey
        ? state.request.id
        : admission
          ? SessionMessage.ID.create()
          : crypto.randomUUID()

    const input = { sessionID: owner.sessionID, directory: owner.directory }
    const api = owner.client["session-instance"].session.instance.session.workflow
    const operation = Symbol()
    setState({
      operation,
      pending: action.kind,
      ack: undefined,
      failure: undefined,
      request: { key: requestKey, id: requestID },
    })

    try {
      if (action.kind === "requestRun" || action.kind === "requestRetry") {
        await data().session.prompt({ sessionID: owner.sessionID, id: requestID, text: action.text })

        if (!current(owner) || state.operation !== operation) return
        write((draft) => {
          draft.mutation++
        })
        setState({ pending: undefined, operation: undefined, ack: action.kind, request: undefined })
        void load()

        return
      }

      const updated = await Match.value(action).pipe(
        Match.when({ kind: "run" }, (action) =>
          api.run({ ...input, requestID, expectedSnapshotDigest: action.digest }),
        ),
        Match.when({ kind: "cancelRun" }, (action) =>
          api.cancelRun({ ...input, runID: action.runID, expectedRunRevision: action.runRevision }),
        ),
        Match.when({ kind: "cancelStep" }, (action) =>
          api.cancelStep({
            ...input,
            runID: action.runID,
            stepRunID: action.stepID,
            expectedRunRevision: action.runRevision,
            expectedStepRevision: action.stepRevision,
          }),
        ),
        Match.when({ kind: "retryStep" }, (action) =>
          api.retryStep({
            ...input,
            runID: action.runID,
            stepRunID: action.stepID,
            requestID,
            expectedRunRevision: action.runRevision,
            expectedStepRevision: action.stepRevision,
          }),
        ),
        Match.exhaustive,
      )

      if (!current(owner) || state.operation !== operation) return
      write((draft) => {
        draft.mutation++
      })
      setState({
        pending: undefined,
        operation: undefined,
        ack: action.kind,
        acknowledged: updated,
        request: undefined,
      })
      void load()
    } catch (error) {
      if (!current(owner) || state.operation !== operation) return
      const conflict = isConflictError(error)
      setState({
        pending: undefined,
        operation: undefined,
        stale: conflict,
        failure: {
          conflict,
          message:
            isInvalidRequestError(error) && error.kind === "workflow_requires_retained_events"
              ? ctx.t("session.workflow.unavailable.events")
              : errorMessage(error, ctx.t("session.workflow.error.unknown")),
        },
      })
      // Read the owner after rejection; keep the rejected action separate from any refresh failure.
      void load()

      if (conflict) void loadDefinition(true)
    } finally {
      if (state.operation === operation) setState({ pending: undefined, operation: undefined })
    }
  }

  function stepAction(kind: "cancelStep" | "retryStep", step: WorkflowAssetStepRunInfo) {
    const run = view()?.run

    if (!run) return

    if (kind === "retryStep" && scope()?.workRoot && run.source) {
      void act({
        kind: "requestRetry",
        text: ctx.t("session.workflow.request.retry", {
          input: JSON.stringify(
            {
              description: ctx.t("session.workflow.request.retryDescription", { step: step.stepId }),
              prompt: ctx.t("session.workflow.request.retryPrompt", { step: step.stepId, name: run.workflowName }),
              workflow_retry: {
                runID: run.id,
                stepRunID: step.id,
                expectedRunRevision: run.revision,
                expectedStepRevision: step.revision,
              },
            },
            null,
            2,
          ),
        }),
      })

      return
    }

    void act({ kind, runID: run.id, runRevision: run.revision, stepID: step.id, stepRevision: step.revision })
  }

  function openSource() {
    const run = view()?.run

    if (!run?.source) return

    if (run.source.type === "operation") {
      ctx.sessions.openTask({
        source: props.session,
        target: {
          server: props.session.server,
          sourceSessionID: run.source.sessionID,
          operationID: run.source.operationID,
        },
      })

      return
    }

    ctx.sessions.open({ source: props.session, sessionID: run.sessionID, reveal: run.source.id })
  }

  function selectRun(runID: string, stepRunID?: string) {
    const run = view()?.run

    if (!run) return
    void stored.update((draft) => {
      draft.source = { sessionID: run.sessionID, runID, stepRunID }
    })
  }

  function elapsed(start: number | undefined, end: number | undefined) {
    if (start === undefined || end === undefined || end < start) return ctx.t("session.workflow.unknown")

    return ctx.t("session.workflow.duration", {
      seconds: ((end - start) / 1000).toLocaleString(ctx.locale.locale(), { maximumFractionDigits: 1 }),
    })
  }

  // Only the visible panel refreshes; the session memory keeps its in-flight action and ACK across renders.
  createKeyed(
    () => props.active && stored.value && scope(),
    (owner) => {
      if (state.owner !== owner.key || unwrap(state).ownerClient !== owner.client)
        setState({
          owner: owner.key,
          ownerClient: owner.client,
          loading: false,
          definitionLoading: false,
          readError: undefined,
          definitionError: undefined,
          failure: undefined,
          stale: false,
          ack: undefined,
          acknowledged: undefined,
          historical: undefined,
          sourceInput: undefined,
          snapshot: undefined,
          request: state.pending ? state.request : undefined,
          assets: undefined,
          workDefinition: undefined,
        })

      if (!owner.connection) return
      void load()
      void loadDefinition()
      onCleanup(
        props.session.server.data.on("workflow.run.updated", (event) => {
          if (event.data.sessionID === (owner.source?.sessionID ?? owner.sessionID) && connected()) void load()
        }),
      )
    },
  )
  onCleanup(() => {
    lifecycle.active = false
    setState({ loading: false, definitionLoading: false })
  })

  return (
    <Show when={props.active}>
      <section class="workflow-run-panel" aria-label={ctx.t("session.workflow.title")} aria-busy={loading()}>
        <div class="workflow-toolbar">
          <h3>{ctx.t("session.workflow.title")}</h3>
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={!scope() || !connected() || loading()}
            onClick={refresh}
          >
            {ctx.t("session.workflow.reload")}
          </Button>
        </div>
        <Show when={!scope()}>
          <p class="workflow-notice">{ctx.t("session.location.unavailable")}</p>
        </Show>
        <Show when={!connected()}>
          <p class="workflow-notice" role="status">
            {ctx.t("session.workflow.offline")}
          </p>
        </Show>
        <Show when={loading() && !view()}>
          <p class="workflow-notice" role="status">
            {ctx.t("session.workflow.loading")}
          </p>
        </Show>
        <Show when={ownsState() ? state.readError : undefined}>
          {(message) => (
            <p class="workflow-notice" role="alert">
              {ctx.t("session.workflow.error.load", { message: message() })}
            </p>
          )}
        </Show>
        <Show when={ownsState() ? state.failure : undefined}>
          {(failure) => (
            <p class="workflow-notice" role="alert">
              {ctx.t(failure().conflict ? "session.workflow.error.conflict" : "session.workflow.error.action", {
                message: failure().message,
              })}
            </p>
          )}
        </Show>
        <Show when={pending() || (ownsState() ? state.ack : undefined)}>
          {(action) => (
            <p class="workflow-notice" role="status">
              {ctx.t(
                pending()
                  ? action() === "requestRun" || action() === "requestRetry"
                    ? "session.workflow.request.pending"
                    : "session.workflow.pending"
                  : `session.workflow.ack.${action()}`,
              )}
            </p>
          )}
        </Show>

        <Show when={scope()?.source}>
          {(source) => (
            <section class="workflow-selection" aria-label={ctx.t("session.workflow.selectedSource")}>
              <dl class="workflow-facts">
                <dt>{ctx.t("session.workflow.sourceSession")}</dt>
                <dd>
                  <code>{source().sessionID}</code>
                </dd>
                <dt>{ctx.t("session.workflow.runID")}</dt>
                <dd>
                  <code>{source().runID}</code>
                </dd>
                <Show when={source().stepRunID}>
                  {(id) => (
                    <>
                      <dt>{ctx.t("session.workflow.stepRunID")}</dt>
                      <dd>
                        <code>{id()}</code>
                      </dd>
                    </>
                  )}
                </Show>
                <Show when={source().inputID}>
                  {(id) => (
                    <>
                      <dt>{ctx.t("session.workflow.sourceInputID")}</dt>
                      <dd>
                        <code>{id()}</code>
                      </dd>
                    </>
                  )}
                </Show>
              </dl>
              <Button
                type="button"
                size="small"
                variant="ghost"
                onClick={() =>
                  void stored.update((draft) => {
                    delete draft.source
                  })
                }
              >
                {ctx.t("session.workflow.showCurrent")}
              </Button>
            </section>
          )}
        </Show>

        <Show when={ownsState() ? state.sourceInput : undefined}>
          {(input) => {
            const pending = () => data().session.input.has(input().sessionID, input().id)

            return (
              <section class="workflow-output" aria-label={ctx.t("session.workflow.sourceInput")}>
                <h4>{ctx.t("session.workflow.sourceInput")}</h4>
                <Show when={pending()}>
                  <p class="workflow-notice" role="status">
                    {ctx.t("session.workflow.sourceInputPending")}
                  </p>
                </Show>
                <pre>{input().text}</pre>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  onClick={() =>
                    ctx.sessions.open({
                      source: props.session,
                      sessionID: input().sessionID,
                      reveal: pending() ? undefined : input().id,
                    })
                  }
                >
                  {ctx.t(pending() ? "session.workflow.openPendingInput" : "session.workflow.openInput")}
                </Button>
              </section>
            )
          }}
        </Show>

        <Show when={!scope()?.source && (scope()?.customRoot || scope()?.workRoot)}>
          <Show when={ownsState() && state.definitionLoading}>
            <p class="workflow-notice" role="status">
              {ctx.t("session.workflow.definition.loading")}
            </p>
          </Show>
          <Show when={ownsState() ? state.definitionError : undefined}>
            {(message) => (
              <p class="workflow-notice" role="alert">
                {ctx.t("session.workflow.error.definition", { message: message() })}
              </p>
            )}
          </Show>
          <Show when={scope()?.workRoot && ownsState() && state.assets}>
            {(assets) => (
              <div class="workflow-selection">
                <Select
                  aria-label={ctx.t("session.workflow.definition.choose")}
                  placeholder={ctx.t("session.workflow.definition.placeholder")}
                  options={assets().workflows}
                  current={assets().workflows.find(
                    (asset) => asset.relativePath === state.workDefinition?.relativePath,
                  )}
                  value={(asset) => asset.relativePath}
                  label={(asset) => asset.name}
                  disabled={!connected() || !!pending() || state.definitionLoading}
                  onSelect={(asset) => {
                    if (asset) void selectDefinition(asset.relativePath)
                  }}
                />
                <Show when={assets().workflows.length === 0}>
                  <p class="workflow-notice">{ctx.t("session.workflow.definition.noAssets")}</p>
                </Show>
                <Show when={workSelection()?.missing.length}>
                  <p class="workflow-notice" role="alert">
                    {ctx.t("session.workflow.definition.agentsMissing", {
                      names: workSelection()?.missing.join(", ") ?? "",
                    })}
                  </p>
                </Show>
              </div>
            )}
          </Show>
          <Show when={scope()?.workRoot || snapshot()}>
            <Show
              when={definition()}
              fallback={
                <p class="workflow-notice">
                  {ctx.t(
                    scope()?.workRoot ? "session.workflow.definition.select" : "session.workflow.definition.empty",
                  )}
                </p>
              }
            >
              {(selected) => (
                <div class="workflow-definition">
                  <Collapsible variant="ghost" class="w-full min-w-0">
                    <Collapsible.Trigger type="button">
                      <Collapsible.Arrow />
                      <span>{ctx.t("session.workflow.definition.title", { name: selected().name })}</span>
                    </Collapsible.Trigger>
                    <Collapsible.Content class="min-w-0 pb-2">
                      <dl class="workflow-facts">
                        <dt>{ctx.t("session.workflow.definition.path")}</dt>
                        <dd>
                          <code>{selected().relativePath}</code>
                        </dd>
                        <dt>{ctx.t("session.workflow.definition.revision")}</dt>
                        <dd>
                          <code>{selected().revision}</code>
                        </dd>
                      </dl>
                      <ol class="workflow-definition-steps">
                        <For each={selected().steps}>
                          {(step) => (
                            <li>
                              <span>{step.name}</span>
                              <code>{step.id}</code>
                              <span>{step.agent}</span>
                            </li>
                          )}
                        </For>
                      </ol>
                    </Collapsible.Content>
                  </Collapsible>
                  <Button
                    type="button"
                    size="small"
                    disabled={
                      !connected() ||
                      !!pending() ||
                      state.stale ||
                      loading() ||
                      runActive() ||
                      view()?.run?.status === "cancelling" ||
                      state.definitionLoading ||
                      (scope()?.workRoot && !workSelection()?.input)
                    }
                    onClick={() => {
                      if (scope()?.workRoot) {
                        const selected = workSelection()

                        if (!selected?.input) return
                        void act({
                          kind: "requestRun",
                          text: ctx.t("session.workflow.request.run", {
                            input: JSON.stringify(
                              {
                                description: ctx.t("session.workflow.request.runDescription", {
                                  name: selected.workflow.name,
                                }),
                                prompt: ctx.t("session.workflow.request.runPrompt", {
                                  name: selected.workflow.name,
                                }),
                                workflow: selected.input,
                              },
                              null,
                              2,
                            ),
                          }),
                        })

                        return
                      }

                      const selected = snapshot()

                      if (selected) void act({ kind: "run", digest: selected.digest })
                    }}
                  >
                    {ctx.t(view()?.run ? "session.workflow.runAgain" : "session.workflow.run")}
                  </Button>
                </div>
              )}
            </Show>
          </Show>
        </Show>

        <Show when={view()}>
          <Show when={view()?.run} fallback={<p class="workflow-notice">{ctx.t("session.workflow.empty")}</p>}>
            {(run) => (
              <article class="workflow-run">
                <div class="workflow-toolbar">
                  <h4>{run().workflowName}</h4>
                  <Badge>{ctx.t(`session.workflow.status.${run().status}`)}</Badge>
                </div>
                <dl class="workflow-facts">
                  <dt>{ctx.t("session.workflow.runID")}</dt>
                  <dd>
                    <code>{run().id}</code>
                  </dd>
                  <dt>{ctx.t("session.workflow.revision")}</dt>
                  <dd>{run().revision}</dd>
                  <dt>{ctx.t("session.workflow.definition.revision")}</dt>
                  <dd>
                    <code>{run().workflowRevision}</code>
                  </dd>
                  <dt>{ctx.t("session.workflow.snapshot")}</dt>
                  <dd>
                    <code>{run().snapshotDigest}</code>
                  </dd>
                  <dt>{ctx.t("session.workflow.elapsed")}</dt>
                  <dd>{elapsed(run().timeCreated, run().timeCompleted)}</dd>
                  <dt>{ctx.t("session.workflow.updated")}</dt>
                  <dd>{new Date(run().timeUpdated).toLocaleString(ctx.locale.locale())}</dd>
                  <Show when={run().currentStepId}>
                    {(id) => (
                      <>
                        <dt>{ctx.t("session.workflow.currentStep")}</dt>
                        <dd>
                          <code>{id()}</code>
                        </dd>
                      </>
                    )}
                  </Show>
                  <Show when={run().parentTaskID}>
                    {(id) => (
                      <>
                        <dt>{ctx.t("session.workflow.task")}</dt>
                        <dd>
                          <Show when={run().source} fallback={<code>{id()}</code>}>
                            <Button
                              type="button"
                              size="small"
                              variant="ghost"
                              aria-label={ctx.t("session.workflow.openTaskSource")}
                              onClick={openSource}
                            >
                              <code>{id()}</code>
                            </Button>
                          </Show>
                        </dd>
                      </>
                    )}
                  </Show>
                  <Show when={run().source} keyed>
                    {(source) => {
                      if (source.type === "tool")
                        return (
                          <>
                            <dt>{ctx.t("session.workflow.sourceMessage")}</dt>
                            <dd>
                              <code>{source.messageID}</code>
                            </dd>
                            <dt>{ctx.t("session.workflow.sourceTool")}</dt>
                            <dd>
                              <code>{source.id}</code>
                            </dd>
                          </>
                        )

                      return (
                        <>
                          <dt>{ctx.t("session.workflow.sourceSession")}</dt>
                          <dd>
                            <code>{source.sessionID}</code>
                          </dd>
                          <dt>{ctx.t("session.operation.title")}</dt>
                          <dd>
                            <Button
                              type="button"
                              size="small"
                              variant="ghost"
                              aria-label={ctx.t("session.operation.item", { id: source.operationID })}
                              onClick={openSource}
                            >
                              <code>{source.operationID}</code>
                            </Button>
                          </dd>
                        </>
                      )
                    }}
                  </Show>
                  <Show when={run().parentRunID}>
                    {(id) => (
                      <>
                        <dt>{ctx.t("session.workflow.parentRun")}</dt>
                        <dd>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            aria-label={ctx.t("session.workflow.openParentRun")}
                            onClick={() => selectRun(id())}
                          >
                            <code>{id()}</code>
                          </Button>
                        </dd>
                      </>
                    )}
                  </Show>
                  <Show when={run().rootRunID}>
                    {(id) => (
                      <>
                        <dt>{ctx.t("session.workflow.rootRun")}</dt>
                        <dd>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            aria-label={ctx.t("session.workflow.openRootRun")}
                            onClick={() => selectRun(id())}
                          >
                            <code>{id()}</code>
                          </Button>
                        </dd>
                      </>
                    )}
                  </Show>
                  <Show when={run().retryOfStepRunID}>
                    {(id) => (
                      <>
                        <dt>{ctx.t("session.workflow.retryOf")}</dt>
                        <dd>
                          <Show when={run().parentRunID} fallback={<code>{id()}</code>}>
                            {(parentRunID) => (
                              <Button
                                type="button"
                                size="small"
                                variant="ghost"
                                aria-label={ctx.t("session.workflow.openRetrySource")}
                                onClick={() => selectRun(parentRunID(), id())}
                              >
                                <code>{id()}</code>
                              </Button>
                            )}
                          </Show>
                        </dd>
                      </>
                    )}
                  </Show>
                  <Show when={run().errorCategory}>
                    {(category) => (
                      <>
                        <dt>{ctx.t("session.workflow.errorCategory")}</dt>
                        <dd>{ctx.t(`session.workflow.errorCategory.${category()}`)}</dd>
                      </>
                    )}
                  </Show>
                </dl>
                <div class="workflow-actions">
                  <Show when={run().source}>
                    <Button type="button" size="small" variant="ghost" onClick={openSource}>
                      {ctx.t("session.workflow.openTool")}
                    </Button>
                  </Show>
                  <Show when={!scope()?.source && runActive()}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!connected() || !!pending() || state.stale || loading()}
                      onClick={() => void act({ kind: "cancelRun", runID: run().id, runRevision: run().revision })}
                    >
                      {ctx.t("session.workflow.cancelRun")}
                    </Button>
                  </Show>
                </div>
                <ol class="workflow-steps" aria-label={ctx.t("session.workflow.steps")}>
                  <For
                    each={view()?.steps}
                    fallback={<li class="workflow-notice">{ctx.t("session.workflow.steps.empty")}</li>}
                  >
                    {(step) => (
                      <li
                        class="workflow-step"
                        aria-label={ctx.t("session.workflow.step", { id: step.stepId, attempt: step.attempt })}
                        aria-current={scope()?.source?.stepRunID === step.id ? "step" : undefined}
                      >
                        <div class="workflow-step-heading">
                          <h5>{step.stepId}</h5>
                          <Badge>{ctx.t(`session.workflow.status.${step.status}`)}</Badge>
                        </div>
                        <div class="workflow-step-meta">
                          <span>{step.agentId}</span>
                          <span>{ctx.t("session.workflow.attempt", { attempt: step.attempt })}</span>
                          <span>{ctx.t("session.workflow.stepRevision", { revision: step.revision })}</span>
                          <span>{elapsed(step.timeStarted, step.timeCompleted)}</span>
                        </div>
                        <Show when={step.branchTarget}>
                          {(target) => (
                            <p class="workflow-branch">{ctx.t("session.workflow.branch", { target: target() })}</p>
                          )}
                        </Show>
                        <Show when={step.errorCategory}>
                          {(category) => (
                            <p class="workflow-notice">{ctx.t(`session.workflow.errorCategory.${category()}`)}</p>
                          )}
                        </Show>
                        <div class="workflow-actions">
                          <Show when={step.childSessionId}>
                            {(id) => (
                              <>
                                <Button
                                  type="button"
                                  size="small"
                                  variant="ghost"
                                  onClick={() =>
                                    props.openSession({
                                      source: props.session,
                                      target: ctx.sessions.target({ server: props.session.server, sessionID: id() }),
                                      interaction: "readonly",
                                    })
                                  }
                                >
                                  {ctx.t("session.collaboration.viewSession")}
                                </Button>
                                <Button
                                  type="button"
                                  size="small"
                                  variant="ghost"
                                  onClick={() => ctx.sessions.open({ source: props.session, sessionID: id() })}
                                >
                                  {ctx.t("session.workflow.openSession")}
                                </Button>
                              </>
                            )}
                          </Show>
                          <Show
                            when={
                              !scope()?.source &&
                              runActive() &&
                              ["pending", "ready", "dispatching", "running"].includes(step.status)
                            }
                          >
                            <Button
                              type="button"
                              size="small"
                              variant="ghost"
                              disabled={!connected() || !!pending() || state.stale || loading()}
                              onClick={() => stepAction("cancelStep", step)}
                            >
                              {ctx.t("session.workflow.cancelStep")}
                            </Button>
                          </Show>
                          <Show
                            when={
                              !scope()?.source &&
                              ((scope()?.customRoot && !run().source) || (scope()?.workRoot && run().source)) &&
                              !runActive() &&
                              run().status !== "cancelling" &&
                              ["failed", "cancelled", "execution_unknown"].includes(step.status)
                            }
                          >
                            <Button
                              type="button"
                              size="small"
                              variant="ghost"
                              disabled={!connected() || !!pending() || state.stale || loading()}
                              onClick={() => stepAction("retryStep", step)}
                            >
                              {ctx.t("session.workflow.retryStep")}
                            </Button>
                          </Show>
                        </div>
                        <Collapsible
                          variant="ghost"
                          class="workflow-step-details"
                          defaultOpen={scope()?.source?.stepRunID === step.id}
                        >
                          <Collapsible.Trigger type="button">
                            <Collapsible.Arrow />
                            <span>{ctx.t("session.workflow.stepDetails")}</span>
                          </Collapsible.Trigger>
                          <Collapsible.Content class="min-w-0 pb-2">
                            <dl class="workflow-facts">
                              <dt>{ctx.t("session.workflow.stepRunID")}</dt>
                              <dd>
                                <code>{step.id}</code>
                              </dd>
                              <Show when={step.taskId}>
                                {(id) => (
                                  <>
                                    <dt>{ctx.t("session.workflow.task")}</dt>
                                    <dd>
                                      <code>{id()}</code>
                                    </dd>
                                  </>
                                )}
                              </Show>
                              <Show when={step.inputDigest}>
                                {(digest) => (
                                  <>
                                    <dt>{ctx.t("session.workflow.inputDigest")}</dt>
                                    <dd>
                                      <code>{digest()}</code>
                                    </dd>
                                  </>
                                )}
                              </Show>
                            </dl>
                            <Show when={step.outputDigest !== undefined}>
                              <div
                                class="workflow-output"
                                role="region"
                                aria-label={ctx.t("session.workflow.outputDigest")}
                              >
                                <span>{ctx.t("session.workflow.outputDigest")}</span>
                                <pre>{step.outputDigest}</pre>
                              </div>
                            </Show>
                          </Collapsible.Content>
                        </Collapsible>
                      </li>
                    )}
                  </For>
                </ol>
              </article>
            )}
          </Show>
        </Show>
      </section>
    </Show>
  )
}

export default WorkflowRunPanel
