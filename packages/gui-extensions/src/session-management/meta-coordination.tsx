import type { CompositionPlan, SessionTaskOperationRequest } from "@omnixa/client/promise"
import { ProductMode } from "@omnixa/schema/product-mode"
import { SessionMessage } from "@omnixa/schema/session-message"
import { SessionInbox } from "@omnixa/schema/session-inbox"
import { SessionTask } from "@omnixa/schema/session-task"
import { Model } from "@omnixa/schema/model"
import { Button } from "@omnixa/ui/button"
import { Collapsible } from "@omnixa/ui/collapsible"
import { Checkbox } from "@omnixa/ui/checkbox"
import { Select } from "@omnixa/ui/select"
import { TextField } from "@omnixa/ui/text-field"
import { errorMessage } from "@omnixa/util/error"
import { Record, Schema } from "effect"
import { For, Show, createMemo, onCleanup } from "solid-js"
import { unwrap } from "solid-js/store"
import { createLatest, useExtension, type MountedSession, type SessionScreen, type SessionTargetRef } from "../sdk"
import type definition from "./index"

class CoordinationDraft extends Schema.Class<CoordinationDraft>("SessionManagement.CoordinationDraft")({
  targetKind: Schema.Literals(["new_root", "existing_root"]),
  mode: ProductMode.ID,
  workerSessionID: Schema.String,
  directory: Schema.String,
  agent: Schema.String,
  model: Schema.optional(Schema.toEncoded(Model.Ref)),
  title: Schema.String,
  profilePath: Schema.String,
  prompt: Schema.String,
  delivery: SessionInbox.Delivery,
  resume: Schema.Boolean,
  request: Schema.optional(Schema.toEncoded(SessionTask.OperationRequest)),
  acknowledged: Schema.optional(Schema.toEncoded(SessionTask.OperationID)),
}) {}

type State = {
  token: symbol | undefined
  pendingOwner: (() => boolean) | undefined
  pending: boolean
  previewing: boolean
  error: string
  plan: CompositionPlan | undefined
  planOwner: (() => boolean) | undefined
}

export function MetaCoordination(props: {
  session: MountedSession
  target: SessionTargetRef
  screen: SessionScreen
  active: boolean
  capable?: boolean
  openSession: (input: {
    source: MountedSession
    target: SessionTargetRef
    interaction: "interactive" | "readonly"
  }) => void
}) {
  const ctx = useExtension<typeof definition>()
  const panel = () => ctx.stores.meta(props.session).value

  const stored = ctx.storage.store(`coordination.${props.target.key}`, {
    schema: Schema.Struct(CoordinationDraft.fields),
    initial: {
      targetKind: "new_root",
      mode: "coding",
      workerSessionID: "",
      directory: "",
      agent: "",
      title: "",
      profilePath: "",
      prompt: "",
      delivery: "queue",
      resume: true,
    },
  })

  const [state, write] = ctx.storage.memory<State>(`coordination.${props.target.key}`, {
    initial: {
      token: undefined,
      pendingOwner: undefined,
      pending: false,
      previewing: false,
      error: "",
      plan: undefined,
      planOwner: undefined,
    },
  })

  let live = true
  onCleanup(() => {
    live = false
  })

  const draft = () => stored.value
  const identity = () => props.target.server.data.session.identity.get(props.target.id)
  const available = () => props.active && props.capable !== false && identity()?.coordination?.available === true
  const pending = () => state.pendingOwner?.() === true && state.pending
  const previewing = () => state.planOwner?.() === true && state.previewing
  const busy = () => pending() || previewing()
  const workerSessionID = () => draft()?.workerSessionID || panel()?.workerSessionID || ""
  const targetKind = () => (panel()?.taskID && panel()?.workerSessionID ? "existing_root" : draft()?.targetKind)

  const owner = createMemo(
    () =>
      available() && props.target.server.connected && draft() && props.target.location
        ? {
            target: props.target,
            client: props.target.server.client,
            data: props.target.server.data,
            attempt: props.target.server.attempt,
            directory: draft()?.directory.trim() || props.target.location.directory,
            workspaceID: props.target.location.workspaceID,
            sourceLocation: JSON.stringify(props.target.location),
            mode: draft()?.mode ?? "coding",
            kind: targetKind(),
          }
        : undefined,
    undefined,
    {
      equals: (previous, next) =>
        previous?.target.key === next?.target.key &&
        previous?.client === next?.client &&
        previous?.attempt === next?.attempt &&
        previous?.directory === next?.directory &&
        previous?.workspaceID === next?.workspaceID &&
        previous?.sourceLocation === next?.sourceLocation &&
        previous?.mode === next?.mode &&
        previous?.kind === next?.kind,
    },
  )

  const choices = createLatest(owner, async (value, signal) => {
    const [agents, models, profiles] = await Promise.all([
      value.client.agent.list({ location: { directory: value.directory } }, { signal }),
      value.kind === "new_root"
        ? value.client.model.list({ location: { directory: value.directory } }, { signal })
        : undefined,
      value.kind === "new_root" && value.mode === "custom"
        ? value.client["custom-profile"].list({ directory: value.directory, workspace: value.workspaceID }, { signal })
        : undefined,
    ])

    if (signal.aborted || ctx.signal.aborted) return

    return {
      owner: value,
      agents: agents.data.filter(
        (agent) =>
          !agent.hidden &&
          agent.mode !== "subagent" &&
          (!agent.ordinaryModes || agent.ordinaryModes.includes(value.mode)),
      ),
      profiles: profiles?.assets ?? [],
      models: models?.data.filter((model) => model.enabled) ?? [],
    }
  })

  const agents = () => {
    const value = choices.latest

    return value && unwrap(value.owner) === owner() ? value.agents : []
  }

  const profiles = () => {
    const value = choices.latest

    return value && unwrap(value.owner) === owner() ? value.profiles : []
  }

  const modelOptions = createMemo(() => {
    const value = choices.latest

    return [
      { id: "", providerID: "", name: ctx.t("common.default"), variants: [] },
      ...(value && unwrap(value.owner) === owner() ? value.models : []),
    ]
  })

  const selectedModel = () =>
    modelOptions().find(
      (model) => model.id === (draft()?.model?.id ?? "") && model.providerID === (draft()?.model?.providerID ?? ""),
    )

  const variants = createMemo(() => [
    { id: "", name: ctx.t("common.default") },
    ...(selectedModel()?.variants.map((variant) => ({ id: variant.id, name: variant.id })) ?? []),
  ])

  const selectedProfile = () => profiles().find((profile) => profile.relativePath === draft()?.profilePath)

  const plan = () => (state.planOwner?.() === true && !state.previewing ? state.plan : undefined)

  const roots = () =>
    props.target.server.data.session.list().filter((session) => !session.parentID && session.id !== props.target.id)

  const operations = () => props.target.server.data.session.task.operation.list(props.target.id) ?? []
  const request = () => draft()?.request

  const acknowledgement = () => {
    const saved = request()

    return saved ? props.target.server.data.session.task.operation.get(props.target.id, saved.operationID) : undefined
  }

  async function preview() {
    const value = owner()
    const profile = selectedProfile()

    if (!value || !profile || busy() || request()) return

    const path = profile.relativePath
    const revision = profile.revision

    const current = () =>
      !ctx.signal.aborted &&
      live &&
      owner() === value &&
      draft()?.profilePath === path &&
      selectedProfile()?.revision === revision

    write((draft) => {
      draft.previewing = true
      draft.planOwner = current
      draft.error = ""
    })

    try {
      const plan = await value.client["custom-composition"].plan(
        {
          directory: value.directory,
          workspace: value.workspaceID,
          payload: { source: "profile", profilePath: path, profileRevision: revision },
        },
        { signal: ctx.signal },
      )

      if (!current()) return

      write((draft) => {
        draft.plan = plan
      })
    } catch (error) {
      if (!current()) return

      write((draft) => {
        draft.error = errorMessage(error, ctx.t("session.tasks.error.unknown"))
      })
    } finally {
      if (state.planOwner === current)
        write((draft) => {
          draft.previewing = false
        })
    }
  }

  async function dispatch() {
    const value = owner()
    const input = draft()
    const source = props.session
    const selectedPlan = plan() ? structuredClone(unwrap(plan())) : undefined
    const kind = targetKind()
    const workerID = workerSessionID()
    const taskID = panel()?.taskID

    if (!value || !input || busy() || !available()) return

    const edited = structuredClone(unwrap(input))

    const token = Symbol()

    const current = () =>
      !ctx.signal.aborted &&
      ctx.servers.get(value.target.server.id)?.client === value.client &&
      ctx.servers.get(value.target.server.id)?.attempt === value.attempt &&
      props.target.key === value.target.key &&
      JSON.stringify(props.target.location) === value.sourceLocation

    write((draft) => {
      draft.token = token
      draft.pendingOwner = current
      draft.pending = true
      draft.error = ""
    })

    try {
      if (taskID && !edited.request) {
        value.data.session.task.invalidate(value.target.id)
        await value.data.session.task.sync(value.target.id)

        if (!current()) return
      }

      const task = taskID
        ? value.data.session.task.list(value.target.id)?.find((task) => task.id === taskID)
        : undefined

      const request =
        edited.request ??
        Schema.encodeSync(SessionTask.OperationRequest)(
          Schema.decodeUnknownSync(Schema.toCodecJson(SessionTask.OperationRequest))({
            operationID: SessionTask.OperationID.create(),
            inputID: SessionMessage.ID.create(),
            taskID,
            expectedRevision: task?.revision,
            target:
              kind === "existing_root"
                ? { type: "existing_root", sessionID: workerID }
                : {
                    type: "new_root",
                    mode: edited.mode,
                    agent: edited.mode === "custom" ? undefined : edited.agent || undefined,
                    model: edited.model,
                    title: edited.title.trim() || undefined,
                    location: { directory: value.directory, workspaceID: value.workspaceID },
                    composition: edited.mode === "custom" ? selectedPlan?.input : undefined,
                    expectedPlanDigest: edited.mode === "custom" ? selectedPlan?.digest : undefined,
                  },
            description: edited.title.trim() || undefined,
            prompt: edited.prompt,
            delivery: edited.delivery,
            resume: edited.resume,
          }),
        )

      const composition = request.target.type === "new_root" ? request.target.composition : undefined

      const payload = {
        ...request,
        files: request.files ? [...request.files] : undefined,
        target:
          request.target.type === "new_root"
            ? {
                ...request.target,
                composition:
                  composition?.source === "temporary"
                    ? {
                        ...composition,
                        agents: [...composition.agents],
                        requestedCapabilities: [...composition.requestedCapabilities],
                        bindings: Record.map(composition.bindings, (binding) => ({
                          ...binding,
                          prompts: [...binding.prompts],
                          skills: [...binding.skills],
                          commands: binding.commands ? [...binding.commands] : undefined,
                        })),
                      }
                    : composition,
              }
            : request.target,
      } satisfies SessionTaskOperationRequest

      if (!edited.request) {
        await stored.update((draft) => {
          draft.request = payload
          draft.acknowledged = undefined
        })

        if (!current()) return
      }

      const operation = await value.data.session.task.operation.dispatch({
        sessionID: value.target.id,
        request: payload,
      })

      if (!current() || state.token !== token) return

      await stored.update((draft) => {
        draft.acknowledged = operation.operationID
      })

      if (!current() || !live || !props.active || state.token !== token) return

      ctx.sessions.openTask({
        source,
        target: {
          server: value.target.server,
          sourceSessionID: value.target.id,
          operationID: operation.operationID,
        },
      })
    } catch (error) {
      if (!current() || state.token !== token) return

      write((draft) => {
        draft.error = errorMessage(error, ctx.t("session.tasks.error.unknown"))
      })
    } finally {
      if (state.token === token)
        write((draft) => {
          draft.pending = false
          draft.token = undefined
        })
    }
  }

  function inspect(operationID: string) {
    ctx.sessions.openTask({
      source: props.session,
      target: { server: props.target.server, sourceSessionID: props.target.id, operationID },
    })
  }

  return (
    <section aria-label={ctx.t("session.coordination.title")}>
      <h4>{ctx.t("session.coordination.title")}</h4>
      <div data-slot="task-metadata">
        <span>{props.target.server.data.session.get(props.target.id)?.title ?? props.target.id}</span>
        <code>{props.target.id}</code>
        <span>{props.target.server.name}</span>
      </div>
      <Show when={available() && draft()}>
        <form
          data-slot="meta-coordination-form"
          onSubmit={(event) => {
            event.preventDefault()
            void dispatch()
          }}
        >
          <Show when={!request()}>
            <Select
              aria-label={ctx.t("session.coordination.targetKind")}
              options={["new_root", "existing_root"] as const}
              current={targetKind()}
              value={(value) => value}
              label={(value) => ctx.t(`session.coordination.target.${value}`)}
              disabled={busy() || !!panel()?.taskID}
              onSelect={(value) => {
                if (value)
                  void stored.update((draft) => {
                    draft.targetKind = value
                  })
              }}
            />
            <Show when={targetKind() === "existing_root"}>
              <Select
                aria-label={ctx.t("session.coordination.existing")}
                options={roots()}
                current={roots().find((session) => session.id === workerSessionID())}
                value={(session) => session.id}
                label={(session) => `${session.title ?? session.id} · ${session.id}`}
                disabled={busy()}
                onSelect={(session) => {
                  if (session)
                    void stored.update((draft) => {
                      draft.workerSessionID = session.id
                    })
                }}
              />
              <TextField
                label={ctx.t("session.coordination.sessionID")}
                value={workerSessionID()}
                disabled={busy()}
                required
                onChange={(id) =>
                  void stored.update((draft) => {
                    draft.workerSessionID = id.trim()
                  })
                }
              />
            </Show>
            <Show when={targetKind() === "new_root"}>
              <Select
                aria-label={ctx.t("session.coordination.mode")}
                options={[...ProductMode.ID.literals]}
                current={draft()?.mode}
                value={(mode) => mode}
                label={(mode) => ctx.t(`session.coordination.mode.${mode}`)}
                disabled={busy()}
                onSelect={(mode) => {
                  if (mode)
                    void stored.update((draft) => {
                      draft.mode = mode
                    })
                }}
              />
              <TextField
                label={ctx.t("session.coordination.directory")}
                value={draft()?.directory ?? ""}
                placeholder={props.target.location?.directory}
                disabled={busy()}
                onChange={(directory) =>
                  void stored.update((draft) => {
                    draft.directory = directory
                  })
                }
              />
              <Select
                aria-label={ctx.t("session.coordination.model")}
                options={modelOptions()}
                current={selectedModel()}
                value={(model) => JSON.stringify([model.providerID, model.id])}
                label={(model) => model.name}
                disabled={busy() || choices.loading}
                onSelect={(model) => {
                  if (model)
                    void stored.update((draft) => {
                      draft.model = model.id ? { id: model.id, providerID: model.providerID } : undefined
                    })
                }}
              />
              <Show when={selectedModel()?.variants.length}>
                <Select
                  aria-label={ctx.t("session.coordination.variant")}
                  options={variants()}
                  current={variants().find((variant) => variant.id === (draft()?.model?.variant ?? ""))}
                  value={(variant) => variant.id}
                  label={(variant) => variant.name}
                  disabled={busy()}
                  onSelect={(variant) => {
                    if (variant)
                      void stored.update((draft) => {
                        if (draft.model) draft.model.variant = variant.id || undefined
                      })
                  }}
                />
              </Show>
              <Show when={draft()?.mode !== "custom"}>
                <Select
                  aria-label={ctx.t("session.coordination.agent")}
                  options={[{ id: "", name: ctx.t("common.default") }, ...agents()]}
                  current={[{ id: "", name: ctx.t("common.default") }, ...agents()].find(
                    (agent) => agent.id === draft()?.agent,
                  )}
                  value={(agent) => agent.id}
                  label={(agent) => agent.name}
                  disabled={busy() || choices.loading}
                  onSelect={(agent) => {
                    if (agent)
                      void stored.update((draft) => {
                        draft.agent = agent.id
                      })
                  }}
                />
              </Show>
              <Show when={draft()?.mode === "custom"}>
                <Select
                  aria-label={ctx.t("session.coordination.profile")}
                  options={profiles()}
                  current={selectedProfile()}
                  value={(profile) => profile.relativePath}
                  label={(profile) => profile.name}
                  disabled={busy() || choices.loading}
                  onSelect={(profile) => {
                    if (profile)
                      void stored.update((draft) => {
                        draft.profilePath = profile.relativePath
                      })
                  }}
                />
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  disabled={busy() || !selectedProfile()}
                  onClick={() => void preview()}
                >
                  {ctx.t("session.coordination.previewProfile")}
                </Button>
                <Show when={plan()}>
                  {(plan) => (
                    <>
                      <p role="status">
                        {ctx.t(
                          plan().valid ? "session.coordination.profileReady" : "session.coordination.profileInvalid",
                        )}
                      </p>
                      <For each={plan().diagnostics}>{(diagnostic) => <p role="status">{diagnostic.message}</p>}</For>
                    </>
                  )}
                </Show>
              </Show>
            </Show>
            <TextField
              label={ctx.t("session.coordination.description")}
              value={draft()?.title ?? ""}
              disabled={busy()}
              onChange={(title) =>
                void stored.update((draft) => {
                  draft.title = title
                })
              }
            />
            <TextField
              label={ctx.t("session.coordination.prompt")}
              value={draft()?.prompt ?? ""}
              multiline
              required
              disabled={busy()}
              onChange={(prompt) =>
                void stored.update((draft) => {
                  draft.prompt = prompt
                })
              }
            />
            <Select
              aria-label={ctx.t("session.coordination.delivery")}
              options={["queue", "steer"] as const}
              current={draft()?.delivery}
              value={(delivery) => delivery}
              label={(delivery) => ctx.t(`session.operation.delivery.${delivery}`)}
              disabled={busy()}
              onSelect={(delivery) => {
                if (delivery)
                  void stored.update((draft) => {
                    draft.delivery = delivery
                  })
              }}
            />
            <Checkbox
              checked={draft()?.resume}
              disabled={busy()}
              onChange={(resume) =>
                void stored.update((draft) => {
                  draft.resume = resume
                })
              }
            >
              {ctx.t("session.coordination.resume")}
            </Checkbox>
          </Show>
          <Show when={request()}>
            {(saved) => (
              <Collapsible variant="ghost" data-slot="meta-request" defaultOpen>
                <Collapsible.Trigger type="button">
                  <Collapsible.Arrow />
                  <span>{ctx.t("session.coordination.savedRequest")}</span>
                </Collapsible.Trigger>
                <Collapsible.Content class="min-w-0 pb-2">
                  <div data-slot="task-metadata">
                    <code>{saved().operationID}</code>
                    <code>{saved().taskID}</code>
                    <span>{ctx.t(`session.operation.delivery.${saved().delivery}`)}</span>
                  </div>
                  <pre>{saved().prompt}</pre>
                </Collapsible.Content>
              </Collapsible>
            )}
          </Show>
          <Show when={!draft()?.acknowledged}>
            <Button
              type="submit"
              size="small"
              variant="neutral"
              aria-busy={pending()}
              disabled={
                busy() ||
                !owner() ||
                (!request() &&
                  (!draft()?.prompt.trim() ||
                    (targetKind() === "existing_root" && !workerSessionID()) ||
                    (targetKind() === "new_root" && draft()?.mode === "custom" && !plan()?.valid)))
              }
            >
              {ctx.t(
                pending()
                  ? "session.coordination.dispatching"
                  : request()
                    ? "session.coordination.retry"
                    : "session.coordination.send",
              )}
            </Button>
          </Show>
          <Show when={request()}>
            {(saved) => (
              <div data-slot="task-form-actions">
                <Button type="button" size="small" variant="ghost" onClick={() => inspect(saved().operationID)}>
                  {ctx.t("session.coordination.inspect")}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  disabled={busy()}
                  onClick={() =>
                    void stored.update((draft) => {
                      draft.request = undefined
                      draft.acknowledged = undefined
                      draft.prompt = ""
                    })
                  }
                >
                  {ctx.t("session.coordination.newRequest")}
                </Button>
              </div>
            )}
          </Show>
          <Show when={acknowledgement()}>
            {(operation) => <p role="status">{ctx.t(`session.operation.phase.${operation().phase}`)}</p>}
          </Show>
          <Show when={state.error || choices.error}>
            <p role="alert">{state.error || errorMessage(choices.error, ctx.t("session.tasks.error.unknown"))}</p>
          </Show>
        </form>
      </Show>
      <Show when={!available()}>
        <p data-slot="task-progress" role="status">
          {ctx.t("session.coordination.historyOnly")}
        </p>
      </Show>
      <h4>{ctx.t("session.taskDetails.operations")}</h4>
      <ul data-slot="task-list">
        <For each={operations()} fallback={<p data-slot="task-empty">{ctx.t("session.taskDetails.noOperations")}</p>}>
          {(operation) => (
            <li data-slot="task-row">
              <div data-slot="task-row-content">
                <p>{operation.request.description ?? operation.request.prompt}</p>
                <div data-slot="task-metadata">
                  <span>{ctx.t(`session.operation.phase.${operation.phase}`)}</span>
                  <span>
                    {operation.source.type === "user_coordination" ? operation.selection.agent : operation.source.agent}
                  </span>
                  <code>{operation.operationID}</code>
                </div>
              </div>
              <Button type="button" size="small" variant="ghost" onClick={() => inspect(operation.operationID)}>
                {ctx.t("session.coordination.inspect")}
              </Button>
            </li>
          )}
        </For>
      </ul>
    </section>
  )
}
