import type { CompositionPlan, ScheduleOccurrence, ScheduleRule } from "@aigcfroge/client/promise"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Schedule } from "@aigcfroge/schema/schedule"
import { Model } from "@aigcfroge/schema/model"
import { Button } from "@aigcfroge/ui/button"
import { Checkbox } from "@aigcfroge/ui/checkbox"
import { Select } from "@aigcfroge/ui/select"
import { TextField } from "@aigcfroge/ui/text-field"
import { errorMessage } from "@aigcfroge/util/error"
import { DateTime, Option, Schema } from "effect"
import { For, Show, createMemo, onCleanup } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { createKeyed, createLatest, useExtension, type MountedSession, type SessionTargetRef } from "../sdk"
import type definition from "./index"

class ScheduleDraft extends Schema.Class<ScheduleDraft>("SessionManagement.ScheduleDraft")({
  open: Schema.Boolean,
  selected: Schema.optional(Schema.String),
  editing: Schema.optional(Schema.Struct({ id: Schema.String, revision: Schema.Number, kind: Schedule.Kind })),
  kind: Schema.Literals(["reminder", "prompt", "goal"]),
  content: Schema.String,
  trigger: Schema.Literals(["once", "recurring"]),
  date: Schema.String,
  cron: Schema.String,
  timezone: Schema.String,
  targetChange: Schema.Boolean,
  targetPolicy: Schema.Literals(["existing", "new_once", "new", "goal"]),
  sessionID: Schema.String,
  goalID: Schema.String,
  authorizeResume: Schema.Boolean,
  mode: ProductMode.ID,
  directory: Schema.String,
  agent: Schema.String,
  model: Schema.optional(Schema.toEncoded(Model.Selection)),
  title: Schema.String,
  profilePath: Schema.String,
  delivery: Schema.Literals(["queue", "steer"]),
  missed: Schema.Literals(["catch_up", "skip"]),
}) {}

const decodeCreate = Schema.decodeUnknownOption(Schema.toCodecJson(Schedule.Create))

const decodeEdit = Schema.decodeUnknownOption(Schema.toCodecJson(Schedule.Edit))

export function MetaSchedule(props: {
  session: MountedSession
  target: SessionTargetRef
  active: boolean
  capable?: boolean
}) {
  const ctx = useExtension<typeof definition>()

  const stored = ctx.storage.store(`schedule.${props.target.key}`, {
    schema: Schema.Struct(ScheduleDraft.fields),
    initial: {
      open: false,
      kind: "prompt",
      content: "",
      trigger: "once",
      date: "",
      cron: "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      targetChange: true,
      targetPolicy: "existing",
      sessionID: props.target.id,
      goalID: "",
      authorizeResume: false,
      mode: "coding",
      directory: "",
      agent: "",
      title: "",
      profilePath: "",
      delivery: "queue",
      missed: "catch_up",
    },
  })

  const [state, setState] = createStore<{
    read: number
    runRead: number
    runsOpen: boolean
    pending: boolean
    previewing: boolean
    error: string
    plan?: CompositionPlan
    planOwner?: () => boolean
  }>({ read: 0, runRead: 0, runsOpen: false, pending: false, previewing: false, error: "" })

  let live = true
  onCleanup(() => {
    live = false
  })
  const data = () => props.target.server.data
  const draft = () => stored.value

  const capable = () =>
    props.capable !== false && data().session.identity.get(props.target.id)?.coordination?.available === true

  const owner = createMemo(
    () =>
      props.active && props.target.server.connected && stored.value
        ? {
            key: props.target.key,
            sessionID: props.target.id,
            client: props.target.server.client,
            data: props.target.server.data,
            attempt: props.target.server.attempt,
            location: JSON.stringify(props.target.location),
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
        previous?.read === next?.read,
    },
  )

  const read = createLatest(owner, async (value, signal) => {
    await value.data.session.schedule.sync(value.sessionID)

    if (signal.aborted || ctx.signal.aborted) return
  })

  const rules = () => data().session.schedule.list(props.target.id)

  const selected = () => {
    const id = draft()?.selected

    return id ? data().session.schedule.get(props.target.id, id) : rules()?.[0]
  }

  const targetIdentity = () => {
    const target = selected()?.target

    if (target?.policy === "existing") return target.sessionID

    if (target?.policy === "goal") return target.goalID
  }

  const goals = () => data().session.goal.list(props.target.id) ?? []
  const goal = () => goals().find((goal) => goal.id === draft()?.goalID)

  const roots = () =>
    data()
      .session.list()
      .filter((session) => !session.parentID)

  const busy = () => state.pending || state.previewing

  const current = (value: NonNullable<ReturnType<typeof owner>>) =>
    !ctx.signal.aborted &&
    live &&
    props.target.key === value.key &&
    props.target.server.client === value.client &&
    props.target.server.attempt === value.attempt &&
    JSON.stringify(props.target.location) === value.location

  const goalRead = createLatest(
    () => (draft()?.open && draft()?.kind === "goal" ? owner() : undefined),
    async (value, signal) => {
      await value.data.session.goal.sync(value.sessionID)

      if (signal.aborted || ctx.signal.aborted) return
    },
  )

  const targetOwner = createMemo(
    () => {
      const value = owner()
      const input = draft()

      if (
        !value ||
        !capable() ||
        !input?.open ||
        input.kind !== "prompt" ||
        !input.targetChange ||
        (input.targetPolicy !== "new" && input.targetPolicy !== "new_once")
      )
        return

      return {
        owner: value,
        mode: input.mode,
        directory: input.directory.trim() || props.target.location?.directory || "",
        workspace: props.target.location?.workspaceID,
      }
    },
    undefined,
    {
      equals: (previous, next) =>
        previous?.owner === next?.owner &&
        previous?.mode === next?.mode &&
        previous?.directory === next?.directory &&
        previous?.workspace === next?.workspace,
    },
  )

  const choices = createLatest(targetOwner, async (value, signal) => {
    const [agents, models, profiles] = await Promise.all([
      value.owner.client.agent.list({ location: { directory: value.directory } }, { signal }),
      value.owner.client.model.list({ location: { directory: value.directory } }, { signal }),
      value.mode === "custom"
        ? value.owner.client["custom-profile"].list(
            { directory: value.directory, workspace: value.workspace },
            { signal },
          )
        : undefined,
      value.owner.data.location.model.group.definition.sync({ directory: value.directory }),
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
      models: models.data.filter((model) => model.enabled),
      profiles: profiles?.assets ?? [],
    }
  })

  const agents = () => {
    const value = choices.latest

    return value && unwrap(value.owner) === targetOwner() ? value.agents : []
  }

  const profiles = () => {
    const value = choices.latest

    return value && unwrap(value.owner) === targetOwner() ? value.profiles : []
  }

  const modelOptions = createMemo(() => {
    const value = choices.latest
    const owner = targetOwner()
    const read = owner?.owner.data.location.model.group.definition.list({ directory: owner.directory })
    const selected = draft()?.model

    return [
      { id: "", providerID: "", name: ctx.t("common.default"), variants: [] },
      ...(read?.effective ?? []).map((group) => ({
        type: "group" as const,
        groupID: group.groupID,
        name: group.unavailable
          ? ctx.t("session.meta.modelGroupUnavailable", {
              name: group.definition?.name || group.groupID,
              reason: ctx.t(`session.meta.modelGroup.${group.unavailable}`),
            })
          : ctx.t("session.meta.modelGroup", { name: group.definition?.name || group.groupID }),
        unavailable: group.unavailable,
      })),
      ...(selected && "type" in selected && !read?.effective.some((group) => group.groupID === selected.groupID)
        ? [
            {
              type: "group" as const,
              groupID: selected.groupID,
              name: read
                ? ctx.t("session.meta.modelGroupUnavailable", {
                    name: selected.groupID,
                    reason: ctx.t("session.meta.modelGroup.missing"),
                  })
                : ctx.t("session.meta.modelGroup", { name: selected.groupID }),
              unavailable: read ? ("missing" as const) : undefined,
            },
          ]
        : []),
      ...(value && unwrap(value.owner) === owner ? value.models : []),
    ]
  })

  const selectedModel = () => {
    const selected = draft()?.model

    return modelOptions().find((model) => {
      if ("type" in model) return selected && "type" in selected && model.groupID === selected.groupID

      if (selected && "type" in selected) return false

      return model.id === (selected?.id ?? "") && model.providerID === (selected?.providerID ?? "")
    })
  }

  const variants = createMemo(() => {
    const selected = selectedModel()

    if (selected && "type" in selected) return []

    return [
      { id: "", name: ctx.t("common.default") },
      ...(selected?.variants.map((variant) => ({ id: variant.id, name: variant.id })) ?? []),
    ]
  })

  const selectedVariant = () => {
    const selected = draft()?.model

    return selected && !("type" in selected) ? selected.variant : undefined
  }

  const profile = () => profiles().find((profile) => profile.relativePath === draft()?.profilePath)
  const plan = () => (state.planOwner?.() && !state.previewing ? state.plan : undefined)

  const runsOwner = createMemo(() => {
    const value = owner()
    const rule = selected()

    return state.runsOpen && value && rule ? { owner: value, id: rule.id, read: state.runRead } : undefined
  })

  const runRead = createLatest(runsOwner, async (value, signal) => {
    await value.owner.data.session.schedule.syncRuns(value.owner.sessionID, value.id)

    if (signal.aborted || ctx.signal.aborted) return
  })

  const runs = () => {
    const rule = selected()

    return rule ? data().session.schedule.runs(props.target.id, rule.id) : undefined
  }

  // Partial durable changes need one visible read; full updated events already fold in the Data owner.
  createKeyed(owner, (value) => {
    onCleanup(
      value.data.listen(({ details }) => {
        if (details.type !== "schedule.rule.changed" && details.type !== "schedule.occurrence.changed") return

        if (details.data.sessionID !== value.sessionID) return
        setState("read", (read) => read + 1)

        if (state.runsOpen) setState("runRead", (read) => read + 1)
      }),
    )
  })

  function refresh() {
    data().session.schedule.invalidate(props.target.id)
    setState("read", (read) => read + 1)
    setState("runRead", (read) => read + 1)
  }

  async function edit(rule?: ScheduleRule) {
    if (busy() || !capable()) return
    await stored.update((draft) => {
      draft.open = true
      draft.editing = rule ? { id: rule.id, revision: rule.revision, kind: rule.kind } : undefined
      draft.content = rule?.content ?? ""
      draft.kind = rule?.kind === "task" ? "prompt" : (rule?.kind ?? "prompt")
      draft.trigger = rule?.recurrence?.enabled ? "recurring" : "once"
      draft.timezone = rule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
      draft.date =
        rule && Number.isFinite(Number(rule.dueAt))
          ? DateTime.toDate(DateTime.makeZonedUnsafe(Number(rule.dueAt), { timeZone: rule.timezone }))
              .toISOString()
              .slice(0, 16)
          : ""
      draft.cron = rule?.recurrence?.cron ?? ""
      draft.delivery = rule?.executionPolicy.delivery ?? "queue"
      draft.missed = rule?.executionPolicy.missed ?? "catch_up"
      draft.targetChange = !rule
      draft.targetPolicy = rule?.target?.policy === "legacy_child" ? "existing" : (rule?.target?.policy ?? "existing")
      draft.sessionID = rule?.target?.policy === "existing" ? rule.target.sessionID : props.target.id
      draft.goalID = rule?.target?.policy === "goal" ? rule.target.goalID : ""
      draft.authorizeResume = false
      draft.mode =
        rule?.target?.policy === "new" || rule?.target?.policy === "new_once" ? rule.target.template.mode : "coding"
      draft.directory =
        rule?.target?.policy === "new" || rule?.target?.policy === "new_once"
          ? (rule.target.template.location?.directory ?? "")
          : ""
      draft.agent =
        rule?.target?.policy === "new" || rule?.target?.policy === "new_once" ? (rule.target.template.agent ?? "") : ""
      draft.model =
        rule?.target?.policy === "new" || rule?.target?.policy === "new_once" ? rule.target.template.model : undefined
      draft.title =
        rule?.target?.policy === "new" || rule?.target?.policy === "new_once" ? (rule.target.template.title ?? "") : ""
      draft.profilePath = ""
    })

    if (ctx.signal.aborted || !live) return
    setState({ error: "", plan: undefined, planOwner: undefined })
  }

  async function preview() {
    const value = targetOwner()
    const selected = profile()

    if (!value || !selected || busy()) return
    const path = selected.relativePath
    const revision = selected.revision

    const valid = () =>
      current(value.owner) &&
      targetOwner() === value &&
      draft()?.profilePath === path &&
      profile()?.revision === revision

    setState({ previewing: true, planOwner: valid, error: "" })

    try {
      const result = await value.owner.client["custom-composition"].plan(
        {
          directory: value.directory,
          workspace: value.workspace,
          payload: { source: "profile", profilePath: path, profileRevision: revision },
        },
        { signal: ctx.signal },
      )

      if (valid()) setState("plan", result)
    } catch (error) {
      if (valid()) setState("error", errorMessage(error, ctx.t("session.tasks.error.unknown")))
    } finally {
      if (live && !ctx.signal.aborted) setState("previewing", false)
    }
  }

  async function save() {
    const value = owner()
    const input = draft()

    if (!value || !input || busy() || !capable()) return
    const captured = structuredClone(unwrap(input))
    const currentGoal = goal()
    const currentPlan = plan()
    const selectedGoal = currentGoal ? structuredClone(unwrap(currentGoal)) : undefined
    const selectedPlan = currentPlan ? structuredClone(unwrap(currentPlan)) : undefined
    setState({ pending: true, error: "" })

    try {
      const dueAt =
        captured.trigger === "once"
          ? DateTime.toEpochMillis(
              DateTime.makeZonedUnsafe(new Date(`${captured.date}Z`), {
                timeZone: captured.timezone,
                adjustForTimeZone: true,
              }),
            )
          : undefined

      const recurrence =
        captured.trigger === "recurring"
          ? { cron: captured.cron.trim(), timezone: captured.timezone, enabled: true }
          : undefined

      // SAFETY: optional goal authorization and template fields are omitted before the Schedule JSON codec; explicit undefined is not equivalent.
      /* oxlint-disable anti-slop/no-conditional-empty-object-spread */
      const target =
        !captured.targetChange || captured.kind === "reminder"
          ? undefined
          : captured.kind === "goal"
            ? {
                policy: "goal",
                goalID: captured.goalID,
                ...(captured.authorizeResume && selectedGoal
                  ? {
                      resumeAuthorization: {
                        goalRevision: selectedGoal.revision,
                        pauseVersion: selectedGoal.pauseVersion,
                      },
                    }
                  : {}),
              }
            : captured.targetPolicy === "existing"
              ? { policy: "existing", sessionID: captured.sessionID.trim() }
              : {
                  policy: captured.targetPolicy,
                  template: {
                    type: "new_root",
                    mode: captured.mode,
                    location: {
                      directory: captured.directory.trim() || props.target.location?.directory,
                      ...(props.target.location?.workspaceID === undefined
                        ? {}
                        : { workspaceID: props.target.location.workspaceID }),
                    },
                    ...(captured.mode !== "custom" && captured.agent ? { agent: captured.agent } : {}),
                    ...(captured.title.trim() ? { title: captured.title.trim() } : {}),
                    ...(captured.model ? { model: captured.model } : {}),
                    ...(captured.mode === "custom" && selectedPlan
                      ? { composition: selectedPlan.input, expectedPlanDigest: selectedPlan.digest }
                      : {}),
                  },
                }

      const fields = {
        content: captured.content.trim(),
        timezone: captured.timezone.trim(),
        ...(dueAt === undefined ? {} : { dueAt }),
        ...(recurrence ? { recurrence } : {}),
        ...(target ? { target } : {}),
        executionPolicy: { delivery: captured.delivery, missed: captured.missed },
      }

      /* oxlint-enable anti-slop/no-conditional-empty-object-spread */

      const editing = captured.editing

      const request = editing
        ? {
            type: "edit" as const,
            id: editing.id,
            payload: Option.getOrUndefined(
              decodeEdit({ ...fields, recurrence: recurrence ?? null, expectedRevision: editing.revision }),
            ),
          }
        : {
            type: "create" as const,
            payload: Option.getOrUndefined(
              decodeCreate({ ...fields, sessionID: value.sessionID, kind: captured.kind }),
            ),
          }

      if (!request.payload) {
        setState("error", ctx.t("session.schedule.invalid"))

        return
      }

      const result =
        request.type === "edit"
          ? await value.data.session.schedule.edit({
              sessionID: value.sessionID,
              id: request.id,
              payload: request.payload,
            })
          : await value.data.session.schedule.create({ payload: request.payload })

      if (!current(value)) return
      await stored.update((draft) => {
        draft.selected = result.id
        draft.editing = undefined
        draft.open = false
      })

      if (current(value)) refresh()
    } catch (error) {
      if (current(value)) setState("error", errorMessage(error, ctx.t("session.schedule.invalid")))
    } finally {
      if (live && !ctx.signal.aborted) setState("pending", false)
    }
  }

  async function act(action: "pause" | "resume" | "cancel" | "run", rule: ScheduleRule) {
    const value = owner()

    if (!value || busy() || ((action === "resume" || action === "run") && !capable())) return
    const input = { sessionID: value.sessionID, id: rule.id, payload: { expectedRevision: rule.revision } }
    setState({ pending: true, error: "" })

    try {
      if (action === "pause") await value.data.session.schedule.pause(input)

      if (action === "resume") await value.data.session.schedule.resume(input)

      if (action === "cancel") await value.data.session.schedule.cancel(input)

      if (action === "run") await value.data.session.schedule.run(input)

      if (current(value)) refresh()
    } catch (error) {
      if (current(value)) setState("error", errorMessage(error, ctx.t("session.tasks.error.unknown")))
    } finally {
      if (live && !ctx.signal.aborted) setState("pending", false)
    }
  }

  async function cancelRun(run: ScheduleOccurrence) {
    const value = owner()

    if (!value || busy()) return
    setState({ pending: true, error: "" })

    try {
      await value.data.session.schedule.cancelRun({ sessionID: value.sessionID, occurrenceID: run.id })

      if (current(value)) refresh()
    } catch (error) {
      if (current(value)) setState("error", errorMessage(error, ctx.t("session.tasks.error.unknown")))
    } finally {
      if (live && !ctx.signal.aborted) setState("pending", false)
    }
  }

  const time = (value: ScheduleRule["dueAt"]) => {
    const date = new Date(Number(value))

    return Number.isFinite(date.getTime()) ? date.toISOString() : ctx.t("session.meta.unknown")
  }

  return (
    <section data-slot="meta-schedule" aria-label={ctx.t("session.schedule.title")}>
      <div data-slot="task-toolbar">
        <h4>{ctx.t("session.schedule.title")}</h4>
        <div data-slot="task-form-actions">
          <Button
            type="button"
            size="small"
            variant="ghost"
            disabled={!owner() || busy() || read.loading}
            onClick={refresh}
          >
            {ctx.t("session.meta.refresh")}
          </Button>
          <Show when={capable()}>
            <Button
              type="button"
              size="small"
              variant="ghost"
              disabled={!owner() || busy()}
              onClick={() => void edit()}
            >
              {ctx.t("session.schedule.new")}
            </Button>
          </Show>
        </div>
      </div>
      <Show when={read.loading}>
        <p data-slot="task-progress" role="status">
          {ctx.t("session.schedule.loading")}
        </p>
      </Show>
      <Show when={state.error || read.error || runRead.error || choices.error || goalRead.error}>
        <p data-slot="task-error" role="alert">
          {state.error ||
            errorMessage(
              read.error ?? runRead.error ?? choices.error ?? goalRead.error,
              ctx.t("session.tasks.error.unknown"),
            )}
        </p>
      </Show>
      <Show when={!capable() || !draft()?.open}>
        <Show when={rules()}>
          <ul data-slot="task-list">
            <For each={rules()} fallback={<p data-slot="task-empty">{ctx.t("session.schedule.empty")}</p>}>
              {(rule) => (
                <li data-slot="task-row">
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    aria-pressed={selected()?.id === rule.id}
                    onClick={() => {
                      void stored.update((draft) => {
                        draft.selected = rule.id
                      })
                      setState("runsOpen", false)
                    }}
                  >
                    {rule.content}
                  </Button>
                  <span>{ctx.t(`session.schedule.status.${rule.status}`)}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={selected()}>
          {(rule) => (
            <article data-slot="schedule-detail">
              <p>{rule().content}</p>
              <div data-slot="task-metadata">
                <code>{rule().id}</code>
                <span>{ctx.t("session.goal.revision", { revision: rule().revision })}</span>
                <span>{ctx.t(`session.schedule.kind.${rule().kind}`)}</span>
                <span>{ctx.t(`session.schedule.status.${rule().status}`)}</span>
              </div>
              <dl data-slot="meta-statistics">
                <dt>{ctx.t("session.schedule.nextDue")}</dt>
                <dd>
                  {rule().nextDueAt === undefined ? ctx.t("session.schedule.noNextDue") : time(rule().nextDueAt!)}
                </dd>
                <dt>{ctx.t("session.schedule.timezone")}</dt>
                <dd>{rule().timezone}</dd>
                <Show when={rule().recurrence?.enabled}>
                  <dt>{ctx.t("session.schedule.cron")}</dt>
                  <dd>
                    <code>{rule().recurrence?.cron}</code>
                  </dd>
                </Show>
                <dt>{ctx.t("session.schedule.delivery")}</dt>
                <dd>{ctx.t(`session.operation.delivery.${rule().executionPolicy.delivery}`)}</dd>
                <dt>{ctx.t("session.schedule.missed")}</dt>
                <dd>{ctx.t(`session.schedule.missed.${rule().executionPolicy.missed}`)}</dd>
              </dl>
              <Show when={rule().target}>
                {(target) => (
                  <div data-slot="task-metadata">
                    <span>{ctx.t(`session.schedule.target.${target().policy}`)}</span>
                    <Show when={targetIdentity()}>{(id) => <code>{id()}</code>}</Show>
                  </div>
                )}
              </Show>
              <Show when={rule().boundTargetSessionID}>
                {(id) => (
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    onClick={() =>
                      ctx.sessions.open({ source: props.session, server: props.target.server, sessionID: id() })
                    }
                  >
                    {ctx.t("session.schedule.openBound")}
                  </Button>
                )}
              </Show>
              <Show when={rule().error}>
                {(error) => (
                  <p role="status">
                    <code>{error().code}</code> {error().message}
                  </p>
                )}
              </Show>
              <Show
                when={rule().status !== "cancelled" && (rule().status !== "completed" || rule().recurrence?.enabled)}
              >
                <div data-slot="task-form-actions">
                  <Show when={capable()}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!owner() || busy()}
                      onClick={() => void edit(rule())}
                    >
                      {ctx.t("session.schedule.edit")}
                    </Button>
                  </Show>
                  <Show when={rule().status === "pending"}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!owner() || busy()}
                      onClick={() => void act("pause", rule())}
                    >
                      {ctx.t("session.schedule.pause")}
                    </Button>
                  </Show>
                  <Show when={capable() && rule().status === "paused"}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!owner() || busy()}
                      onClick={() => void act("resume", rule())}
                    >
                      {ctx.t("session.schedule.resume")}
                    </Button>
                  </Show>
                  <Show when={capable()}>
                    <Button
                      type="button"
                      size="small"
                      variant="ghost"
                      disabled={!owner() || busy() || !!rule().activeOccurrenceID}
                      onClick={() => void act("run", rule())}
                    >
                      {ctx.t("session.schedule.run")}
                    </Button>
                  </Show>
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={!owner() || busy()}
                    onClick={() => void act("cancel", rule())}
                  >
                    {ctx.t("session.schedule.cancel")}
                  </Button>
                </div>
              </Show>
              <Button
                type="button"
                size="small"
                variant="ghost"
                aria-expanded={state.runsOpen}
                onClick={() => setState("runsOpen", (open) => !open)}
              >
                {ctx.t("session.schedule.runs")}
              </Button>
              <Show when={state.runsOpen}>
                <Show when={runRead.loading}>
                  <p data-slot="task-progress">{ctx.t("session.schedule.runsLoading")}</p>
                </Show>
                <ul data-slot="task-list">
                  <For each={runs()} fallback={<p data-slot="task-empty">{ctx.t("session.schedule.noRuns")}</p>}>
                    {(run) => (
                      <li data-slot="schedule-run">
                        <div data-slot="task-metadata">
                          <code>{run.id}</code>
                          <span>{ctx.t(`session.schedule.runStatus.${run.status}`)}</span>
                          <span>{ctx.t("session.goal.revision", { revision: run.ruleRevision })}</span>
                          <time>{time(run.scheduledAt)}</time>
                          <Show when={run.cancelRequested}>
                            <span>{ctx.t("session.operation.cancelRequested")}</span>
                          </Show>
                        </div>
                        <Show when={run.caughtUp}>
                          <p>{ctx.t("session.schedule.caughtUp")}</p>
                        </Show>
                        <Show when={run.missedUntil}>
                          {(until) => <p>{ctx.t("session.schedule.missedUntil", { time: time(until()) })}</p>}
                        </Show>
                        <Show when={run.sourceSettlement}>
                          {(settlement) => <p>{ctx.t(`session.schedule.taskUpdate.${settlement()}`)}</p>}
                        </Show>
                        <Show when={run.error}>
                          {(error) => (
                            <p role="status">
                              <code>{error().code}</code> {error().message}
                            </p>
                          )}
                        </Show>
                        <Show when={run.result?.text ?? run.output}>{(text) => <pre>{text()}</pre>}</Show>
                        <div data-slot="task-form-actions">
                          <Show when={run.targetSessionID}>
                            {(id) => (
                              <Button
                                type="button"
                                size="small"
                                variant="ghost"
                                onClick={() =>
                                  ctx.sessions.open({
                                    source: props.session,
                                    server: props.target.server,
                                    sessionID: id(),
                                  })
                                }
                              >
                                {ctx.t("session.collaboration.openSession")}
                              </Button>
                            )}
                          </Show>
                          <Show when={run.admission}>
                            <Button
                              type="button"
                              size="small"
                              variant="ghost"
                              onClick={() =>
                                ctx.sessions.openTask({
                                  source: props.session,
                                  target: {
                                    server: props.target.server,
                                    sourceSessionID: run.sessionID,
                                    operationID: run.operationID,
                                  },
                                })
                              }
                            >
                              {ctx.t("session.coordination.inspect")}
                            </Button>
                          </Show>
                          <Show
                            when={
                              !run.cancelRequested &&
                              ["claimed", "admitted", "running", "blocked", "recovery_required"].includes(run.status)
                            }
                          >
                            <Button
                              type="button"
                              size="small"
                              variant="ghost"
                              disabled={!owner() || busy()}
                              onClick={() => void cancelRun(run)}
                            >
                              {ctx.t("session.schedule.cancelRun")}
                            </Button>
                          </Show>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </article>
          )}
        </Show>
      </Show>
      <Show when={capable() && draft()?.open && draft()}>
        {(draft) => (
          <form
            data-slot="meta-coordination-form"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <Show
              when={!draft().editing}
              fallback={<p>{ctx.t(`session.schedule.kind.${draft().editing?.kind ?? "prompt"}`)}</p>}
            >
              <Select
                aria-label={ctx.t("session.schedule.kind")}
                options={[...ScheduleDraft.fields.kind.literals]}
                current={draft().kind}
                value={(kind) => kind}
                label={(kind) => ctx.t(`session.schedule.kind.${kind}`)}
                disabled={busy()}
                onSelect={(kind) => {
                  if (kind)
                    void stored.update((draft) => {
                      draft.kind = kind
                    })
                }}
              />
            </Show>
            <TextField
              label={ctx.t("session.schedule.content")}
              multiline
              required
              value={draft().content}
              disabled={busy()}
              onChange={(content) =>
                void stored.update((draft) => {
                  draft.content = content
                })
              }
            />
            <Select
              aria-label={ctx.t("session.schedule.trigger")}
              options={[...ScheduleDraft.fields.trigger.literals]}
              current={draft().trigger}
              value={(trigger) => trigger}
              label={(trigger) => ctx.t(`session.schedule.trigger.${trigger}`)}
              disabled={busy()}
              onSelect={(trigger) => {
                if (trigger)
                  void stored.update((draft) => {
                    draft.trigger = trigger
                  })
              }}
            />
            <Show when={draft().trigger === "once"}>
              <TextField
                label={ctx.t("session.schedule.date")}
                type="datetime-local"
                required
                value={draft().date}
                disabled={busy()}
                onChange={(date) =>
                  void stored.update((draft) => {
                    draft.date = date
                  })
                }
              />
            </Show>
            <Show when={draft().trigger === "recurring"}>
              <TextField
                label={ctx.t("session.schedule.cron")}
                required
                value={draft().cron}
                disabled={busy()}
                onChange={(cron) =>
                  void stored.update((draft) => {
                    draft.cron = cron
                  })
                }
              />
            </Show>
            <TextField
              label={ctx.t("session.schedule.timezone")}
              required
              value={draft().timezone}
              disabled={busy()}
              onChange={(timezone) =>
                void stored.update((draft) => {
                  draft.timezone = timezone
                })
              }
            />
            <Show when={draft().editing && draft().editing?.kind !== "task" && draft().kind !== "reminder"}>
              <Checkbox
                checked={draft().targetChange}
                disabled={busy()}
                onChange={(targetChange) =>
                  void stored.update((draft) => {
                    draft.targetChange = targetChange
                  })
                }
              >
                {ctx.t("session.schedule.changeTarget")}
              </Checkbox>
            </Show>
            <Show when={draft().targetChange && draft().kind === "goal"}>
              <Select
                aria-label={ctx.t("session.schedule.goal")}
                options={goals().filter((goal) => goal.status !== "completed" && goal.status !== "cancelled")}
                current={goal()}
                value={(goal) => goal.id}
                label={(goal) => goal.objective}
                disabled={busy() || goalRead.loading}
                onSelect={(goal) => {
                  if (goal)
                    void stored.update((draft) => {
                      draft.goalID = goal.id
                    })
                }}
              />
              <Checkbox
                checked={draft().authorizeResume}
                disabled={busy() || !goal()}
                onChange={(authorizeResume) =>
                  void stored.update((draft) => {
                    draft.authorizeResume = authorizeResume
                  })
                }
              >
                {ctx.t("session.schedule.authorizeGoal", { revision: goal()?.revision ?? "" })}
              </Checkbox>
            </Show>
            <Show when={draft().targetChange && draft().kind === "prompt"}>
              <Select
                aria-label={ctx.t("session.schedule.target")}
                options={["existing", "new_once", "new"] as const}
                current={draft().targetPolicy === "goal" ? undefined : draft().targetPolicy}
                value={(policy) => policy}
                label={(policy) => ctx.t(`session.schedule.target.${policy}`)}
                disabled={busy()}
                onSelect={(policy) => {
                  if (policy)
                    void stored.update((draft) => {
                      draft.targetPolicy = policy
                    })
                }}
              />
              <Show when={draft().targetPolicy === "existing"}>
                <Select
                  aria-label={ctx.t("session.coordination.existing")}
                  options={roots()}
                  current={roots().find((session) => session.id === draft().sessionID)}
                  value={(session) => session.id}
                  label={(session) => session.title ?? session.id}
                  disabled={busy()}
                  onSelect={(session) => {
                    if (session)
                      void stored.update((draft) => {
                        draft.sessionID = session.id
                      })
                  }}
                />
                <TextField
                  label={ctx.t("session.coordination.sessionID")}
                  required
                  value={draft().sessionID}
                  disabled={busy()}
                  onChange={(sessionID) =>
                    void stored.update((draft) => {
                      draft.sessionID = sessionID
                    })
                  }
                />
              </Show>
              <Show when={draft().targetPolicy === "new" || draft().targetPolicy === "new_once"}>
                <Select
                  aria-label={ctx.t("session.coordination.mode")}
                  options={[...ProductMode.ID.literals]}
                  current={draft().mode}
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
                  value={draft().directory}
                  placeholder={props.target.location?.directory}
                  disabled={busy()}
                  onChange={(directory) =>
                    void stored.update((draft) => {
                      draft.directory = directory
                    })
                  }
                />
                <TextField
                  label={ctx.t("session.schedule.targetTitle")}
                  value={draft().title}
                  disabled={busy()}
                  onChange={(title) =>
                    void stored.update((draft) => {
                      draft.title = title
                    })
                  }
                />
                <Show when={draft().mode !== "custom"}>
                  <Select
                    aria-label={ctx.t("session.coordination.agent")}
                    options={[{ id: "", name: ctx.t("common.default") }, ...agents()]}
                    current={[{ id: "", name: ctx.t("common.default") }, ...agents()].find(
                      (agent) => agent.id === draft().agent,
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
                <Show when={draft().mode === "custom"}>
                  <Select
                    aria-label={ctx.t("session.coordination.profile")}
                    options={profiles()}
                    current={profile()}
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
                    disabled={busy() || !profile()}
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
              <Show when={draft().targetPolicy === "new" || draft().targetPolicy === "new_once"}>
                <Select
                  aria-label={ctx.t("session.coordination.model")}
                  options={modelOptions()}
                  current={selectedModel()}
                  value={(model) =>
                    "type" in model
                      ? JSON.stringify(["group", model.groupID])
                      : JSON.stringify(["model", model.providerID, model.id])
                  }
                  label={(model) => model.name}
                  optionDisabled={(model) => "type" in model && !!model.unavailable}
                  disabled={busy() || choices.loading}
                  onSelect={(model) => {
                    if (model)
                      void stored.update((draft) => {
                        draft.model =
                          "type" in model
                            ? { type: "group", groupID: model.groupID }
                            : model.id
                              ? { id: model.id, providerID: model.providerID }
                              : undefined
                      })
                  }}
                />
                <Show when={variants().length > 1}>
                  <Select
                    aria-label={ctx.t("session.coordination.variant")}
                    options={variants()}
                    current={variants().find((variant) => variant.id === (selectedVariant() ?? ""))}
                    value={(variant) => variant.id}
                    label={(variant) => variant.name}
                    disabled={busy()}
                    onSelect={(variant) => {
                      if (variant)
                        void stored.update((draft) => {
                          if (draft.model && !("type" in draft.model)) draft.model.variant = variant.id || undefined
                        })
                    }}
                  />
                </Show>
              </Show>
            </Show>
            <Select
              aria-label={ctx.t("session.schedule.delivery")}
              options={[...ScheduleDraft.fields.delivery.literals]}
              current={draft().delivery}
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
            <Select
              aria-label={ctx.t("session.schedule.missed")}
              options={[...ScheduleDraft.fields.missed.literals]}
              current={draft().missed}
              value={(missed) => missed}
              label={(missed) => ctx.t(`session.schedule.missed.${missed}`)}
              disabled={busy()}
              onSelect={(missed) => {
                if (missed)
                  void stored.update((draft) => {
                    draft.missed = missed
                  })
              }}
            />
            <Show when={draft().editing}>
              {(editing) => <p>{ctx.t("session.goal.revision", { revision: editing().revision })}</p>}
            </Show>
            <div data-slot="task-form-actions">
              <Button
                type="submit"
                size="small"
                variant="neutral"
                aria-busy={state.pending}
                disabled={
                  !owner() ||
                  busy() ||
                  (draft().targetChange &&
                    draft().kind === "prompt" &&
                    (draft().targetPolicy === "new" || draft().targetPolicy === "new_once") &&
                    draft().mode === "custom" &&
                    !plan()?.valid)
                }
              >
                {ctx.t(
                  state.pending
                    ? "session.schedule.saving"
                    : draft().editing
                      ? "session.goal.save"
                      : "session.schedule.save",
                )}
              </Button>
              <Button
                type="button"
                size="small"
                variant="ghost"
                disabled={busy()}
                onClick={() =>
                  void stored.update((draft) => {
                    draft.open = false
                    draft.editing = undefined
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
