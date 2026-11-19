import { Plugin } from "@aigcfroge/plugin/tui"
import { SessionGoal } from "@aigcfroge/schema/session-goal"
import { SessionID } from "@aigcfroge/schema/session-id"
import { Schedule } from "@aigcfroge/schema/schedule"
import { Schema } from "effect"
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { useData } from "../../context/data"
import { useLocal } from "../../context/local"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"
import { DialogSelect } from "../../ui/dialog-select"

type Data = ReturnType<typeof useData>
type Goal = NonNullable<ReturnType<Data["session"]["goal"]["list"]>>[number]
type Rule = NonNullable<ReturnType<Data["session"]["schedule"]["list"]>>[number]

export default Plugin.define({
  id: "aigcfroge.meta-management",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        const data = useData()
        const local = useLocal()
        const toast = useToast()
        const sessionID = () => {
          const route = context.ui.router.current()
          return route.type === "session" ? route.sessionID : undefined
        }
        const selectedMeta = () => {
          const id = sessionID()
          return id !== undefined && data.session.get(id)?.agent === "meta" && local.agent.current()?.id === "meta"
        }
        createEffect(() => {
          const id = sessionID()
          if (id && selectedMeta()) void data.session.identity.sync(id).catch(toast.error)
        })
        const available = () => {
          const id = sessionID()
          return id !== undefined && selectedMeta() && data.session.identity.get(id)?.coordination?.available === true
        }
        const open = async (kind: "goal" | "schedule", input?: string) => {
          const id = sessionID()
          if (!id) return
          if (input?.trim()) {
            if (!available()) {
              toast.show({ message: "Select Meta to manage Goals and scheduled work", variant: "warning" })
              return
            }
            await context.client.session.command({ sessionID: id, name: kind, text: input, delivery: "steer" })
            return
          }
          context.ui.dialog.show(() =>
            kind === "goal" ? (
              <Goals context={context} data={data} sessionID={id} available={() => sessionID() === id && available()} />
            ) : (
              <Schedules
                context={context}
                data={data}
                sessionID={id}
                available={() => sessionID() === id && available()}
              />
            ),
          )
          context.ui.dialog.set({ size: "large" })
        }
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "session.goal.manage",
              title: "Manage Goals",
              group: "Session",
              palette: true,
              enabled: sessionID() !== undefined,
              slash: { name: "goal", arguments: true },
              run: (input) => open("goal", input).catch(toast.error),
            },
            {
              id: "session.schedule.manage",
              title: "Manage scheduled work",
              group: "Session",
              palette: true,
              enabled: sessionID() !== undefined,
              slash: { name: "schedule", arguments: true },
              run: (input) => open("schedule", input).catch(toast.error),
            },
          ],
        }))
        return null
      },
    })
  },
})

function Goals(props: { context: Plugin.Context; data: Data; sessionID: string; available: () => boolean }) {
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const rows = () => props.data.session.goal.list(props.sessionID)
  const action = async (run: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(true)
    setError(undefined)
    await run()
      .then(() => props.data.session.goal.sync(props.sessionID))
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause))
        toast.error(cause)
      })
      .finally(() => setBusy(false))
  }
  onMount(() => void action(() => props.data.session.goal.sync(props.sessionID)))
  const create = () =>
    void action(async () => {
      const text = await props.context.ui.dialog.prompt({
        title: "New Goal",
        description: "Describe the objective. Completion will require your acceptance.",
        placeholder: "Objective",
      })
      if (!text?.trim()) return
      if (!props.available()) return
      await props.data.session.goal.set({
        sessionID: props.sessionID,
        objective: text.trim(),
        conditions: [{ id: "acceptance", kind: "human_acceptance", description: text.trim() }],
        budget: {},
      })
      props.context.ui.dialog.show(() => <Goals {...props} />)
    })
  const select = async (goal: Goal) => {
    const choice = await props.context.ui.dialog.select({
      title: goal.objective,
      options: [
        { title: "Read conditions, evidence and accounting", value: "read" },
        {
          title: "Edit objective, conditions or budget",
          value: "edit",
          disabled: !props.available() || goal.status === "completed" || goal.status === "cancelled",
        },
        { title: "Pause Goal continuation", value: "pause", disabled: !props.available() || goal.status !== "active" },
        {
          title: "Resume Goal continuation",
          value: "resume",
          disabled: !props.available() || goal.status !== "paused",
        },
        {
          title: "Cancel Goal continuation",
          value: "cancel",
          disabled: !props.available() || goal.status === "completed" || goal.status === "cancelled",
        },
        {
          title: "Accept this revision and producer evidence",
          value: "confirm",
          disabled: !props.available() || goal.status === "completed" || goal.status === "cancelled",
        },
        { title: "Read linked Task results and consumers", value: "tasks" },
      ],
    })
    if (choice === "read")
      await props.context.ui.dialog.alert({ title: goal.objective, message: JSON.stringify(goal, null, 2) })
    if (choice === "tasks") {
      const location = props.data.session.get(props.sessionID)?.location
      const operations = await Promise.all(
        goal.taskRefs.map((ref) =>
          props.context.client["session-instance"].session.instance.session.task.operation({
            sessionID: ref.sourceSessionID,
            operationID: ref.operationID,
            directory: location?.directory,
          }),
        ),
      )
      await props.context.ui.dialog.alert({
        title: "Goal Task results and consumers",
        message: JSON.stringify(operations, null, 2),
      })
    }
    if (choice && choice !== "read" && choice !== "tasks" && !props.available()) return
    if (choice === "edit") {
      const text = await props.context.ui.dialog.prompt({
        title: "Edit Goal",
        description: "Keep the saved expectedRevision and provide exact conditions/budget.",
        value: JSON.stringify(
          {
            expectedRevision: goal.revision,
            objective: goal.objective,
            conditions: goal.conditions,
            budget: goal.budget,
          },
          null,
          2,
        ),
      })
      if (text) {
        if (!props.available()) return
        const payload = Schema.decodeUnknownSync(Schema.fromJsonString(SessionGoal.EditInput))(text)
        await props.data.session.goal.edit({
          sessionID: props.sessionID,
          goalID: goal.id,
          ...Schema.encodeSync(SessionGoal.EditInput)(payload),
        })
      }
    }
    const ref = { sessionID: props.sessionID, goalID: goal.id, expectedRevision: goal.revision }
    if (choice === "pause") await props.data.session.goal.pause(ref)
    if (choice === "resume") await props.data.session.goal.resume(ref)
    if (choice === "cancel") await props.data.session.goal.cancel(ref)
    if (
      choice === "confirm" &&
      (await props.context.ui.dialog.confirm({
        title: "Accept Goal revision",
        message: `${goal.objective}\nRevision ${goal.revision}\nEvidence: ${(goal.currentEvidenceIDs ?? []).join(", ") || "No command/artifact evidence"}\nDigest: ${goal.evidenceSetDigest}`,
        label: { confirm: "Accept", cancel: "Back" },
      })) &&
      props.available()
    )
      await props.data.session.goal.confirm({
        sessionID: props.sessionID,
        goalID: goal.id,
        expectedRevision: goal.revision,
        evidenceIDs: goal.currentEvidenceIDs ?? [],
        evidenceSetDigest: goal.evidenceSetDigest,
      })
    props.context.ui.dialog.show(() => <Goals {...props} />)
  }
  return (
    <DialogSelect
      title="Session Goals"
      locked={busy()}
      preserveSelection
      options={(rows() ?? []).map((goal) => ({
        title: goal.objective,
        value: goal.id,
        description: `${goal.status}${goal.pauseCode ? ` · ${goal.pauseCode}` : ""} · revision ${goal.revision}`,
        onSelect: () => void action(() => select(goal)),
      }))}
      emptyView={
        <text fg={theme.text.muted}>
          {busy() ? "Loading Goals…" : "No Goals saved. Press n to create a persistent objective."}
        </text>
      }
      footer={
        <Show when={error()}>
          <text fg={theme.text.feedback.error.base}>{error()}</text>
        </Show>
      }
      actions={
        props.available()
          ? [
              {
                command: "goal.create",
                title: "New Goal",
                bind: "n",
                selection: "none",
                disabled: busy(),
                onTrigger: create,
              },
            ]
          : []
      }
    />
  )
}

function Schedules(props: { context: Plugin.Context; data: Data; sessionID: string; available: () => boolean }) {
  const theme = useTheme().surface("dialog")
  const toast = useToast()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const rows = () => props.data.session.schedule.list(props.sessionID)
  const action = async (run: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(true)
    setError(undefined)
    await run()
      .then(() => props.data.session.schedule.sync(props.sessionID))
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : String(cause))
        toast.error(cause)
      })
      .finally(() => setBusy(false))
  }
  onMount(() => void action(() => props.data.session.schedule.sync(props.sessionID)))
  const create = () =>
    void action(async () => {
      const text = await props.context.ui.dialog.prompt({
        title: "Schedule timed work",
        description: "Specify reminder or prompt, content, timezone, dueAt/recurrence, and a target for work.",
        value: JSON.stringify(
          {
            sessionID: props.sessionID,
            kind: "reminder",
            content: "",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            dueAt: Date.now() + 60_000,
          },
          null,
          2,
        ),
      })
      if (!text) return
      if (!props.available()) return
      const payload = Schema.decodeUnknownSync(Schema.fromJsonString(Schedule.Create))(text)
      await props.data.session.schedule.create({
        payload: Schema.encodeSync(Schedule.Create)(
          new Schedule.Create({ ...payload, sessionID: SessionID.make(props.sessionID) }),
        ),
      })
      props.context.ui.dialog.show(() => <Schedules {...props} />)
    })
  const select = async (rule: Rule) => {
    const choice = await props.context.ui.dialog.select({
      title: rule.content,
      options: [
        { title: "Read rule and target", value: "read" },
        { title: "Read occurrence history", value: "history" },
        { title: "Edit next runs", value: "edit", disabled: !props.available() || rule.status === "cancelled" },
        { title: "Pause next runs", value: "pause", disabled: !props.available() || rule.status !== "pending" },
        { title: "Resume next runs", value: "resume", disabled: !props.available() || rule.status !== "paused" },
        { title: "Cancel future runs", value: "cancel", disabled: !props.available() || rule.status === "cancelled" },
        { title: "Trigger one occurrence", value: "run", disabled: !props.available() || rule.status !== "pending" },
      ],
    })
    if (choice === "read")
      await props.context.ui.dialog.alert({
        title: `Schedule ${rule.id} · revision ${rule.revision}`,
        message: JSON.stringify(rule, null, 2),
      })
    if (choice === "history") {
      await props.data.session.schedule.syncRuns(props.sessionID, rule.id)
      const runs = props.data.session.schedule.runs(props.sessionID, rule.id) ?? []
      const selected = await props.context.ui.dialog.select({
        title: "Occurrence history",
        options: runs.map((run) => ({
          title: `${run.status} · ${new Date(run.scheduledAt).toLocaleString(undefined, { timeZone: rule.timezone })}`,
          value: run.id,
          description: run.targetSessionID ?? "Reminder",
          footer: run.id,
        })),
      })
      const run = runs.find((item) => item.id === selected)
      if (run) {
        await props.context.ui.dialog.alert({ title: `Occurrence ${run.id}`, message: JSON.stringify(run, null, 2) })
        if (
          props.available() &&
          ["claimed", "admitted", "running", "recovery_required"].includes(run.status) &&
          (await props.context.ui.dialog.confirm({
            title: "Cancel this occurrence",
            message: `Cancel ${run.id}? Future runs follow the saved rule.`,
            label: { confirm: "Cancel occurrence", cancel: "Back" },
          })) &&
          props.available()
        )
          await props.data.session.schedule.cancelRun({ sessionID: props.sessionID, occurrenceID: run.id })
      }
    }
    if (choice && choice !== "read" && choice !== "history" && !props.available()) return
    if (choice === "edit") {
      const text = await props.context.ui.dialog.prompt({
        title: "Edit Schedule",
        description: "Changes apply to future occurrences; keep expectedRevision.",
        value: JSON.stringify(
          {
            expectedRevision: rule.revision,
            content: rule.content,
            dueAt: rule.dueAt,
            timezone: rule.timezone,
            recurrence: rule.recurrence,
            target: rule.target,
            executionPolicy: rule.executionPolicy,
          },
          null,
          2,
        ),
      })
      if (text) {
        if (!props.available()) return
        const payload = Schema.decodeUnknownSync(Schema.fromJsonString(Schedule.Edit))(text)
        await props.data.session.schedule.edit({
          sessionID: props.sessionID,
          id: rule.id,
          payload: Schema.encodeSync(Schedule.Edit)(payload),
        })
      }
    }
    const ref = { sessionID: props.sessionID, id: rule.id, payload: { expectedRevision: rule.revision } }
    if (choice === "pause") await props.data.session.schedule.pause(ref)
    if (choice === "resume") await props.data.session.schedule.resume(ref)
    if (choice === "cancel") await props.data.session.schedule.cancel(ref)
    if (choice === "run") await props.data.session.schedule.run(ref)
    props.context.ui.dialog.show(() => <Schedules {...props} />)
  }
  const options = createMemo(() =>
    (rows() ?? []).map((rule) => ({
      title: rule.content,
      value: rule.id,
      description: `${rule.kind} · ${rule.status} · ${rule.timezone}`,
      onSelect: () => void action(() => select(rule)),
    })),
  )
  return (
    <DialogSelect
      title="Scheduled work"
      options={options()}
      locked={busy()}
      preserveSelection
      emptyView={
        <text fg={theme.text.muted}>
          {busy() ? "Loading schedules…" : "No scheduled work. Press n to set a reminder or timed task."}
        </text>
      }
      footer={
        <Show when={error()}>
          <text fg={theme.text.feedback.error.base}>{error()}</text>
        </Show>
      }
      actions={
        props.available()
          ? [
              {
                command: "schedule.create",
                title: "New Schedule",
                bind: "n",
                selection: "none",
                disabled: busy(),
                onTrigger: create,
              },
            ]
          : []
      }
    />
  )
}
