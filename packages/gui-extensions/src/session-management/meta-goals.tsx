import type { SessionGoalInfo } from "@omnixa/client/promise"
import { SessionGoal } from "@omnixa/schema/session-goal"
import { Button } from "@omnixa/ui/button"
import { Collapsible } from "@omnixa/ui/collapsible"
import { Select } from "@omnixa/ui/select"
import { TextField } from "@omnixa/ui/text-field"
import { errorMessage } from "@omnixa/util/error"
import { Array, Match, Result, Schema } from "effect"
import { For, Show, createMemo, onCleanup } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { createLatest, useExtension, type MountedSession, type SessionTargetRef } from "../sdk"
import type definition from "./index"

class ConditionDraft extends Schema.Class<ConditionDraft>("SessionManagement.GoalConditionDraft")({
  id: Schema.String,
  kind: Schema.Literals(["human_acceptance", "command_result", "artifact"]),
  description: Schema.String,
  command: Schema.String,
  cwd: Schema.String,
  exit: Schema.String,
  output: Schema.String,
  sessionID: Schema.String,
  artifactID: Schema.String,
  revision: Schema.String,
  relativePath: Schema.String,
  original: Schema.optional(Schema.toEncoded(SessionGoal.Condition)),
}) {}

class GoalDraft extends Schema.Class<GoalDraft>("SessionManagement.GoalDraft")({
  selected: Schema.optional(Schema.String),
  open: Schema.Boolean,
  objective: Schema.String,
  conditions: Schema.Array(Schema.Struct(ConditionDraft.fields)),
  budget: Schema.Struct({
    rounds: Schema.String,
    steps: Schema.String,
    attempts: Schema.String,
    tokens: Schema.String,
    minutes: Schema.String,
  }),
  editing: Schema.optional(Schema.Struct({ id: Schema.String, revision: Schema.Number })),
  request: Schema.optional(Schema.toEncoded(SessionGoal.CreateInput)),
}) {}

const decodeGoalInput = Schema.decodeUnknownResult(Schema.toCodecJson(SessionGoal.CreateInput))

export function MetaGoals(props: {
  session: MountedSession
  target: SessionTargetRef
  active: boolean
  capable?: boolean
}) {
  const ctx = useExtension<typeof definition>()

  const stored = ctx.storage.store(`goals.${props.target.key}`, {
    schema: Schema.Struct(GoalDraft.fields),
    initial: {
      objective: "",
      open: false,
      conditions: [],
      budget: { rounds: "", steps: "", attempts: "", tokens: "", minutes: "" },
    },
  })

  const [state, setState] = createStore({ read: 0, pending: false, error: "" })
  let live = true
  onCleanup(() => {
    live = false
  })
  const data = () => props.target.server.data

  const capable = () =>
    props.capable !== false && data().session.identity.get(props.target.id)?.coordination?.available === true

  const owner = createMemo(
    () =>
      props.active && props.target.server.connected && stored.value
        ? {
            key: props.target.key,
            client: props.target.server.client,
            data: props.target.server.data,
            attempt: props.target.server.attempt,
            location: JSON.stringify(props.target.location),
            directory: props.target.location?.directory,
            workspaceID: props.target.location?.workspaceID,
            sessionID: props.target.id,
            agent: props.target.server.data.session.get(props.target.id)?.agent,
            read: state.read,
          }
        : undefined,
    undefined,
    {
      equals: (previous, next) =>
        previous?.key === next?.key &&
        previous?.client === next?.client &&
        previous?.attempt === next?.attempt &&
        previous?.location === next?.location &&
        previous?.agent === next?.agent &&
        previous?.read === next?.read,
    },
  )

  const read = createLatest(owner, async (value, signal) => {
    if (!value.data.session.get(value.sessionID)) {
      await value.data.session.readback(value.sessionID)

      if (signal.aborted || ctx.signal.aborted) return
    }

    await Promise.all([
      value.data.session.goal.sync(value.sessionID),
      value.data.session.identity.sync(value.sessionID),
    ])

    if (signal.aborted || ctx.signal.aborted) return
  })

  const goals = () => data().session.goal.list(props.target.id)

  const selected = () => {
    const id = stored.value?.selected

    return id
      ? data().session.goal.get(props.target.id, id)
      : (goals()?.find((goal) => goal.status === "active") ?? goals()?.[0])
  }

  const current = (value: NonNullable<ReturnType<typeof owner>>) =>
    !ctx.signal.aborted &&
    live &&
    props.target.key === value.key &&
    props.target.server.client === value.client &&
    props.target.server.attempt === value.attempt &&
    JSON.stringify(props.target.location) === value.location &&
    props.target.server.data.session.get(props.target.id)?.agent === value.agent

  function refresh() {
    data().session.goal.invalidate(props.target.id)
    setState("read", (read) => read + 1)
  }

  async function edit(goal?: SessionGoalInfo) {
    if (state.pending || !capable()) return
    await stored.update((draft) => {
      draft.objective = goal?.objective ?? ""
      draft.open = true
      draft.editing = goal ? { id: goal.id, revision: goal.revision } : undefined
      draft.request = undefined
      draft.conditions = goal?.conditions.map((condition) => ({
        id: condition.id,
        kind: condition.kind,
        description: condition.kind === "human_acceptance" ? condition.description : "",
        command: condition.kind === "command_result" ? condition.command : "",
        cwd: condition.kind === "command_result" ? condition.cwd : "",
        exit: condition.kind === "command_result" ? String(condition.exit) : "0",
        output: condition.kind === "command_result" ? condition.outputIncludes.join("\n") : "",
        sessionID: condition.kind === "artifact" ? condition.sessionID : props.target.id,
        artifactID: condition.kind === "artifact" ? condition.artifactID : "",
        revision: condition.kind === "artifact" ? String(condition.revision) : "",
        relativePath: condition.kind === "artifact" ? condition.relativePath : "",
        original: structuredClone(unwrap(condition)),
      })) ?? [
        {
          id: crypto.randomUUID(),
          kind: "human_acceptance",
          description: "",
          command: "",
          cwd: props.target.location?.directory ?? "",
          exit: "0",
          output: "",
          sessionID: props.target.id,
          artifactID: "",
          revision: "",
          relativePath: "",
        },
      ]
      draft.budget = {
        rounds: goal?.budget.rounds === undefined ? "" : String(goal.budget.rounds),
        steps: goal?.budget.steps === undefined ? "" : String(goal.budget.steps),
        attempts: goal?.budget.attempts === undefined ? "" : String(goal.budget.attempts),
        tokens: goal?.budget.tokens === undefined ? "" : String(goal.budget.tokens),
        minutes: goal?.budget.activeMilliseconds === undefined ? "" : String(goal.budget.activeMilliseconds / 60_000),
      }
    })

    if (!live || ctx.signal.aborted) return
    setState("error", "")
  }

  async function save() {
    const value = owner()
    const storedDraft = stored.value

    if (!value || !storedDraft || state.pending || !capable()) return
    const draft = structuredClone(unwrap(storedDraft))

    // SAFETY: the CreateInput JSON codec distinguishes omitted optional fields from explicit undefined; see docs/technical-debt.md.
    /* oxlint-disable anti-slop/no-conditional-empty-object-spread */
    const input = decodeGoalInput(
      draft.request ?? {
        ...(draft.editing ? {} : { goalID: SessionGoal.ID.create() }),
        objective: draft.objective.trim(),
        conditions: draft.conditions.map((condition) => {
          if (condition.kind === "command_result")
            return {
              ...(condition.original?.kind === condition.kind ? condition.original : {}),
              id: condition.id,
              kind: condition.kind,
              command: condition.command.trim(),
              cwd: condition.cwd.trim(),
              exit: Number(condition.exit),
              outputIncludes: condition.output
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
            }

          if (condition.kind === "artifact")
            return {
              ...(condition.original?.kind === condition.kind ? condition.original : {}),
              id: condition.id,
              kind: condition.kind,
              sessionID: condition.sessionID.trim(),
              artifactID: condition.artifactID.trim(),
              revision: condition.revision.trim(),
              relativePath: condition.relativePath.trim(),
            }

          return {
            ...(condition.original?.kind === condition.kind ? condition.original : {}),
            id: condition.id,
            kind: condition.kind,
            description: condition.description.trim(),
          }
        }),
        budget: {
          ...(draft.budget.rounds.trim() ? { rounds: Number(draft.budget.rounds) } : {}),
          ...(draft.budget.steps.trim() ? { steps: Number(draft.budget.steps) } : {}),
          ...(draft.budget.attempts.trim() ? { attempts: Number(draft.budget.attempts) } : {}),
          ...(draft.budget.tokens.trim() ? { tokens: Number(draft.budget.tokens) } : {}),
          ...(draft.budget.minutes.trim() ? { activeMilliseconds: Number(draft.budget.minutes) * 60_000 } : {}),
        },
      },
    )

    /* oxlint-enable anti-slop/no-conditional-empty-object-spread */

    if (Result.isFailure(input)) {
      setState("error", errorMessage(input.failure, ctx.t("session.goal.invalid")))

      return
    }

    const request = Schema.encodeSync(SessionGoal.CreateInput)(input.success)

    const payload = {
      ...request,
      conditions: Array.map(request.conditions, (condition) =>
        condition.kind === "command_result"
          ? { ...condition, outputIncludes: [...condition.outputIncludes] }
          : condition,
      ),
    }

    setState({ pending: true, error: "" })

    try {
      if (!draft.editing && !draft.request) {
        await stored.update((draft) => {
          draft.request = payload
        })

        if (!current(value)) return
      }

      const goal = draft.editing
        ? await value.data.session.goal.edit({
            sessionID: value.sessionID,
            directory: value.directory,
            workspace: value.workspaceID,
            goalID: draft.editing.id,
            expectedRevision: draft.editing.revision,
            objective: payload.objective,
            conditions: payload.conditions,
            budget: payload.budget,
          })
        : await value.data.session.goal.set({
            ...payload,
            sessionID: value.sessionID,
            directory: value.directory,
            workspace: value.workspaceID,
          })

      if (!current(value)) return
      await stored.update((draft) => {
        draft.selected = goal.id
        draft.request = undefined
        draft.editing = undefined
        draft.open = false
      })

      if (!current(value)) return
      refresh()
    } catch (error) {
      if (current(value)) setState("error", errorMessage(error, ctx.t("session.tasks.error.unknown")))
    } finally {
      if (live && !ctx.signal.aborted) setState("pending", false)
    }
  }

  async function act(action: "pause" | "resume" | "cancel" | "confirm", goal: SessionGoalInfo) {
    const value = owner()

    if (!value || state.pending || (action === "resume" && !capable())) return
    const captured = structuredClone(unwrap(goal))
    setState({ pending: true, error: "" })

    try {
      const input = {
        sessionID: value.sessionID,
        goalID: captured.id,
        directory: value.directory,
        workspace: value.workspaceID,
        expectedRevision: captured.revision,
      }

      if (action === "confirm")
        await value.data.session.goal.confirm({
          ...input,
          evidenceIDs: captured.currentEvidenceIDs ?? [],
          evidenceSetDigest: captured.evidenceSetDigest,
        })

      if (action === "pause") await value.data.session.goal.pause(input)

      if (action === "resume") await value.data.session.goal.resume(input)

      if (action === "cancel") await value.data.session.goal.cancel(input)

      if (!current(value)) return
      refresh()
    } catch (error) {
      if (current(value)) setState("error", errorMessage(error, ctx.t("session.tasks.error.unknown")))
    } finally {
      if (live && !ctx.signal.aborted) setState("pending", false)
    }
  }

  return (
    <section data-slot="meta-goals" aria-label={ctx.t("session.goal.title")}>
      <div data-slot="task-toolbar">
        <h4>{ctx.t("session.goal.title")}</h4>
        <div data-slot="task-form-actions">
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={!owner() || state.pending || read.loading}
            onClick={refresh}
          >
            {ctx.t("session.meta.refresh")}
          </Button>
          <Show when={capable()}>
            <Button
              type="button"
              size="small"
              variant="ghost"
              disabled={!owner() || state.pending}
              onClick={() => void edit()}
            >
              {ctx.t("session.goal.new")}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={read.loading}>
        <p data-slot="task-progress" role="status">
          {ctx.t("session.goal.loading")}
        </p>
      </Show>
      <Show when={state.error || read.error}>
        <p data-slot="task-error" role="alert">
          {state.error || errorMessage(read.error, ctx.t("session.tasks.error.unknown"))}
        </p>
      </Show>
      <Show when={!capable() || (!stored.value?.open && !stored.value?.request && !stored.value?.editing)}>
        <Show when={goals()}>
          <ul data-slot="task-list">
            <For each={goals()} fallback={<p data-slot="task-empty">{ctx.t("session.goal.empty")}</p>}>
              {(goal) => (
                <li data-slot="task-row">
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    aria-pressed={selected()?.id === goal.id}
                    onClick={() =>
                      void stored.update((draft) => {
                        draft.selected = goal.id
                      })
                    }
                  >
                    {goal.objective}
                  </Button>
                  <span>{ctx.t(`session.goal.status.${goal.status}`)}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={selected()}>
          {(goal) => (
            <article data-slot="goal-detail">
              <p>{goal().objective}</p>
              <div data-slot="task-metadata">
                <code>{goal().id}</code>
                <span>{ctx.t("session.goal.revision", { revision: goal().revision })}</span>
                <span>{ctx.t(`session.goal.status.${goal().status}`)}</span>
                <Show when={goal().pauseReason}>
                  {(reason) => <span>{ctx.t(`session.goal.pauseReason.${reason()}`)}</span>}
                </Show>
                <Show when={goal().pauseCode}>{(code) => <code>{code()}</code>}</Show>
              </div>
              <ul data-slot="task-list">
                <For each={goal().conditions}>
                  {(condition) => (
                    <li data-slot="goal-condition">
                      <span>{ctx.t(`session.goal.condition.${condition.kind}`)}</span>
                      <p>
                        {Match.value(condition).pipe(
                          Match.when({ kind: "human_acceptance" }, (value) => value.description),
                          Match.when({ kind: "command_result" }, (value) => value.command),
                          Match.when({ kind: "artifact" }, (value) => value.relativePath),
                          Match.exhaustive,
                        )}
                      </p>
                      <span>
                        {ctx.t(
                          goal().satisfiedConditionIDs.includes(condition.id)
                            ? "session.goal.satisfied"
                            : "session.goal.pendingCondition",
                        )}
                      </span>
                      <Show when={condition.kind === "command_result" ? condition : undefined}>
                        {(command) => (
                          <div data-slot="task-metadata">
                            <span>{command().cwd}</span>
                            <span>{ctx.t("session.goal.expectedExit", { exit: command().exit })}</span>
                            <For each={command().outputIncludes}>{(text) => <code>{text}</code>}</For>
                          </div>
                        )}
                      </Show>
                      <Show when={condition.kind === "artifact" ? condition : undefined}>
                        {(artifact) => (
                          <div data-slot="task-metadata">
                            <code>{artifact().sessionID}</code>
                            <code>{artifact().artifactID}</code>
                            <span>{ctx.t("session.goal.artifactRevision")}</span>
                            <code>{artifact().revision}</code>
                          </div>
                        )}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
              <dl data-slot="meta-statistics">
                <dt>{ctx.t("session.goal.rounds")}</dt>
                <dd>{goal().accounting.rounds}</dd>
                <dt>{ctx.t("session.goal.activeMinutes")}</dt>
                <dd>{Math.floor(goal().accounting.activeMilliseconds / 60_000)}</dd>
              </dl>
              <Collapsible variant="ghost" data-slot="meta-request">
                <Collapsible.Trigger type="button">
                  <Collapsible.Arrow />
                  <span>{ctx.t("session.goal.budget")}</span>
                </Collapsible.Trigger>
                <Collapsible.Content class="min-w-0 pb-2">
                  <dl data-slot="meta-statistics">
                    <For each={["rounds", "steps", "attempts", "tokens", "activeMilliseconds"] as const}>
                      {(key) => (
                        <>
                          <dt>{ctx.t(`session.goal.limit.${key}`)}</dt>
                          <dd>{goal().budget[key] ?? ctx.t("session.goal.unset")}</dd>
                        </>
                      )}
                    </For>
                  </dl>
                </Collapsible.Content>
              </Collapsible>
              <For each={["coordinator", "worker", "compaction", "auxiliary"] as const}>
                {(kind) => (
                  <Collapsible variant="ghost" data-slot="meta-request">
                    <Collapsible.Trigger type="button">
                      <Collapsible.Arrow />
                      <span>{ctx.t(`session.goal.accounting.${kind}`)}</span>
                    </Collapsible.Trigger>
                    <Collapsible.Content class="min-w-0 pb-2">
                      <dl data-slot="meta-statistics">
                        <dt>{ctx.t("session.goal.steps")}</dt>
                        <dd>{goal().accounting[kind].steps}</dd>
                        <dt>{ctx.t("session.goal.attempts")}</dt>
                        <dd>{goal().accounting[kind].attempts}</dd>
                        <dt>{ctx.t("session.goal.recordedTokens")}</dt>
                        <dd>{goal().accounting[kind].recordedTokens}</dd>
                        <dt>{ctx.t("session.goal.sharedTokens")}</dt>
                        <dd>{goal().accounting[kind].sharedTokens}</dd>
                        <dt>{ctx.t("session.goal.unknownUsage")}</dt>
                        <dd>{goal().accounting[kind].unknownAttempts}</dd>
                        <dt>{ctx.t("session.goal.pendingAttempts")}</dt>
                        <dd>{goal().accounting[kind].pendingAttempts}</dd>
                      </dl>
                    </Collapsible.Content>
                  </Collapsible>
                )}
              </For>
              <Show when={goal().taskRefs.length}>
                <h4>{ctx.t("session.goal.tasks")}</h4>
                <ul data-slot="task-list">
                  <For each={goal().taskRefs}>
                    {(ref) => (
                      <li data-slot="task-row">
                        <Button
                          type="button"
                          size="small"
                          variant="ghost"
                          onClick={() =>
                            ctx.sessions.openTask({
                              source: props.session,
                              target: {
                                server: props.target.server,
                                sourceSessionID: ref.sourceSessionID,
                                operationID: ref.operationID,
                              },
                            })
                          }
                        >
                          <code>{ref.operationID}</code>
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Collapsible variant="ghost" data-slot="meta-request">
                <Collapsible.Trigger type="button">
                  <Collapsible.Arrow />
                  <span>{ctx.t("session.goal.evidence")}</span>
                </Collapsible.Trigger>
                <Collapsible.Content class="min-w-0 pb-2">
                  <code>{goal().evidenceSetDigest}</code>
                  <For each={goal().evidence}>
                    {(evidence) => (
                      <div data-slot="goal-evidence">
                        <div data-slot="task-metadata">
                          <code>{evidence.id}</code>
                          <span>{ctx.t(`session.goal.condition.${evidence.kind}`)}</span>
                          <span>{ctx.t("session.goal.revision", { revision: evidence.revision })}</span>
                          <span>
                            {ctx.t(
                              goal().currentEvidenceIDs?.includes(evidence.id)
                                ? "session.goal.currentEvidence"
                                : "session.goal.historicalEvidence",
                            )}
                          </span>
                        </div>
                        <Show when={evidence.kind === "command_result" ? evidence : undefined}>
                          {(item) => (
                            <>
                              <p>
                                <code>{item().result.command}</code>
                              </p>
                              <dl data-slot="meta-statistics">
                                <dt>{ctx.t("session.goal.cwd")}</dt>
                                <dd>{item().result.cwd}</dd>
                                <dt>{ctx.t("session.goal.recordedExit")}</dt>
                                <dd>{item().result.exit ?? ctx.t("session.meta.unknown")}</dd>
                                <Show when={item().result.signal}>
                                  {(signal) => (
                                    <>
                                      <dt>{ctx.t("session.goal.signal")}</dt>
                                      <dd>{signal()}</dd>
                                    </>
                                  )}
                                </Show>
                                <dt>{ctx.t("session.goal.outputDigest")}</dt>
                                <dd>
                                  <code>{item().result.outputDigest}</code>
                                </dd>
                              </dl>
                              <Show when={item().result.timeout}>
                                <p>{ctx.t("session.goal.timedOut")}</p>
                              </Show>
                              <Show when={item().result.truncated}>
                                <p>{ctx.t("session.goal.truncated")}</p>
                              </Show>
                              <Show when={item().outputIncludes.length}>
                                <p>{ctx.t("session.goal.matchedOutput")}</p>
                                <ul data-slot="task-list">
                                  <For each={item().outputIncludes}>
                                    {(text) => (
                                      <li>
                                        <code>{text}</code>
                                      </li>
                                    )}
                                  </For>
                                </ul>
                              </Show>
                            </>
                          )}
                        </Show>
                        <Show when={evidence.kind === "artifact" ? evidence : undefined}>
                          {(item) => (
                            <>
                              <p>{item().producer.relativePath}</p>
                              <div data-slot="task-metadata">
                                <code>{item().producer.sessionID}</code>
                                <code>{item().producer.artifactID}</code>
                                <span>{ctx.t("session.goal.artifactRevision")}</span>
                                <code>{item().producer.revision}</code>
                              </div>
                            </>
                          )}
                        </Show>
                        <Show when={evidence.kind === "human_acceptance" ? evidence : undefined}>
                          {(item) => <code>{item().evidenceSetDigest}</code>}
                        </Show>
                      </div>
                    )}
                  </For>
                </Collapsible.Content>
              </Collapsible>
              <Show when={goal().status !== "completed" && goal().status !== "cancelled"}>
                <div data-slot="task-form-actions">
                  <Show when={capable()}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!owner() || state.pending}
                      onClick={() => void edit(goal())}
                    >
                      {ctx.t("session.goal.edit")}
                    </Button>
                  </Show>
                  <Show when={goal().status === "active"}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!owner() || state.pending}
                      onClick={() => void act("pause", goal())}
                    >
                      {ctx.t("session.goal.pause")}
                    </Button>
                  </Show>
                  <Show when={goal().status === "paused" && capable()}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!owner() || state.pending}
                      onClick={() => void act("resume", goal())}
                    >
                      {ctx.t("session.goal.resume")}
                    </Button>
                  </Show>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={!owner() || state.pending}
                    onClick={() => void act("cancel", goal())}
                  >
                    {ctx.t("session.goal.cancel")}
                  </Button>
                  <Show when={goal().conditions.some((condition) => condition.kind === "human_acceptance")}>
                    <Button
                      type="button"
                      size="small"
                      variant="neutral"
                      disabled={!owner() || state.pending}
                      onClick={() => void act("confirm", goal())}
                    >
                      {ctx.t("session.goal.confirm", { revision: goal().revision })}
                    </Button>
                  </Show>
                </div>
              </Show>
            </article>
          )}
        </Show>
      </Show>
      <Show when={capable() && (stored.value?.open || stored.value?.request || stored.value?.editing) && stored.value}>
        {(draft) => (
          <form
            data-slot="meta-coordination-form"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <Show when={!draft().request}>
              <TextField
                label={ctx.t("session.goal.objective")}
                multiline
                required
                value={draft().objective}
                disabled={state.pending}
                onChange={(objective) =>
                  void stored.update((draft) => {
                    draft.objective = objective
                  })
                }
              />
              <For each={draft().conditions}>
                {(condition, index) => (
                  <fieldset data-slot="goal-condition-form">
                    <legend>{ctx.t("session.goal.conditionLabel")}</legend>
                    <Select
                      aria-label={ctx.t("session.goal.conditionKind")}
                      options={[...ConditionDraft.fields.kind.literals]}
                      current={condition.kind}
                      value={(kind) => kind}
                      label={(kind) => ctx.t(`session.goal.condition.${kind}`)}
                      disabled={state.pending}
                      onSelect={(kind) => {
                        if (kind)
                          void stored.update((draft) => {
                            draft.conditions[index()].kind = kind
                          })
                      }}
                    />
                    <Show when={condition.kind === "human_acceptance"}>
                      <TextField
                        label={ctx.t("session.goal.acceptance")}
                        required
                        value={condition.description}
                        disabled={state.pending}
                        onChange={(value) =>
                          void stored.update((draft) => {
                            draft.conditions[index()].description = value
                          })
                        }
                      />
                    </Show>
                    <Show when={condition.kind === "command_result"}>
                      <TextField
                        label={ctx.t("session.goal.command")}
                        required
                        value={condition.command}
                        disabled={state.pending}
                        onChange={(value) =>
                          void stored.update((draft) => {
                            draft.conditions[index()].command = value
                          })
                        }
                      />
                      <TextField
                        label={ctx.t("session.goal.cwd")}
                        required
                        value={condition.cwd}
                        disabled={state.pending}
                        onChange={(value) =>
                          void stored.update((draft) => {
                            draft.conditions[index()].cwd = value
                          })
                        }
                      />
                      <TextField
                        label={ctx.t("session.goal.exit")}
                        type="number"
                        required
                        value={condition.exit}
                        disabled={state.pending}
                        onChange={(value) =>
                          void stored.update((draft) => {
                            draft.conditions[index()].exit = value
                          })
                        }
                      />
                      <TextField
                        label={ctx.t("session.goal.outputIncludes")}
                        multiline
                        value={condition.output}
                        disabled={state.pending}
                        onChange={(value) =>
                          void stored.update((draft) => {
                            draft.conditions[index()].output = value
                          })
                        }
                      />
                    </Show>
                    <Show when={condition.kind === "artifact"}>
                      <TextField
                        label={ctx.t("session.goal.artifactSession")}
                        required
                        value={condition.sessionID}
                        disabled={state.pending}
                        onChange={(value) =>
                          void stored.update((draft) => {
                            draft.conditions[index()].sessionID = value
                          })
                        }
                      />
                      <TextField
                        label={ctx.t("session.goal.artifact")}
                        required
                        value={condition.artifactID}
                        disabled={state.pending}
                        onChange={(value) =>
                          void stored.update((draft) => {
                            draft.conditions[index()].artifactID = value
                          })
                        }
                      />
                      <TextField
                        label={ctx.t("session.goal.artifactRevision")}
                        required
                        value={condition.revision}
                        disabled={state.pending}
                        onChange={(value) =>
                          void stored.update((draft) => {
                            draft.conditions[index()].revision = value
                          })
                        }
                      />
                      <TextField
                        label={ctx.t("session.goal.artifactPath")}
                        required
                        value={condition.relativePath}
                        disabled={state.pending}
                        onChange={(value) =>
                          void stored.update((draft) => {
                            draft.conditions[index()].relativePath = value
                          })
                        }
                      />
                    </Show>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={state.pending || draft().conditions.length < 2}
                      onClick={() =>
                        void stored.update((draft) => {
                          draft.conditions.splice(index(), 1)
                        })
                      }
                    >
                      {ctx.t("session.goal.removeCondition")}
                    </Button>
                  </fieldset>
                )}
              </For>
              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={state.pending}
                onClick={() =>
                  void stored.update((draft) => {
                    draft.conditions.push({
                      id: crypto.randomUUID(),
                      kind: "human_acceptance",
                      description: "",
                      command: "",
                      cwd: props.target.location?.directory ?? "",
                      exit: "0",
                      output: "",
                      sessionID: props.target.id,
                      artifactID: "",
                      revision: "",
                      relativePath: "",
                    })
                  })
                }
              >
                {ctx.t("session.goal.addCondition")}
              </Button>
              <fieldset data-slot="goal-budget">
                <legend>{ctx.t("session.goal.budget")}</legend>
                <For each={["rounds", "steps", "attempts", "tokens", "minutes"] as const}>
                  {(key) => (
                    <TextField
                      label={ctx.t(`session.goal.budget.${key}`)}
                      type="number"
                      min="1"
                      step="1"
                      value={draft().budget[key]}
                      disabled={state.pending}
                      onChange={(value) =>
                        void stored.update((draft) => {
                          draft.budget[key] = value
                        })
                      }
                    />
                  )}
                </For>
              </fieldset>
            </Show>
            <Show when={draft().request}>
              {(request) => (
                <Collapsible variant="ghost" data-slot="meta-request" defaultOpen>
                  <Collapsible.Trigger type="button">
                    <Collapsible.Arrow />
                    <span>{ctx.t("session.goal.savedRequest")}</span>
                  </Collapsible.Trigger>
                  <Collapsible.Content class="min-w-0 pb-2">
                    <p>{request().objective}</p>
                    <code>{request().goalID}</code>
                  </Collapsible.Content>
                </Collapsible>
              )}
            </Show>
            <Show when={draft().editing}>
              {(editing) => (
                <p data-slot="task-metadata">{ctx.t("session.goal.revision", { revision: editing().revision })}</p>
              )}
            </Show>
            <div data-slot="task-form-actions">
              <Button
                type="submit"
                size="small"
                variant="neutral"
                aria-busy={state.pending}
                disabled={!owner() || state.pending}
              >
                {ctx.t(
                  state.pending
                    ? "session.goal.saving"
                    : draft().editing
                      ? "session.goal.save"
                      : draft().request
                        ? "session.coordination.retry"
                        : "session.goal.start",
                )}
              </Button>
              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={state.pending}
                onClick={() =>
                  void stored.update((draft) => {
                    draft.request = undefined
                    draft.editing = undefined
                    draft.open = false
                  })
                }
              >
                {ctx.t("session.tasks.cancel")}
              </Button>
            </div>
          </form>
        )}
      </Show>
    </section>
  )
}
