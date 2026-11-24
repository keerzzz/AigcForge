import type { CompositionHealth, CompositionSnapshotV1, CompositionSnapshotV2 } from "@omnixa/client/promise"
import { Composition } from "@omnixa/schema/composition"
import { Badge } from "@omnixa/ui/badge"
import { Button } from "@omnixa/ui/button"
import { errorMessage } from "@omnixa/util/error"
import { createMemo, For, onCleanup, Show } from "solid-js"
import { createKeyed, useExtension, type MountedSession, type SessionTargetRef } from "../sdk"
import type SessionManagement from "./index"
import { executionStatus } from "./execution-status"

type PanelState = {
  owner: string | undefined
  loading: boolean
  error: string | undefined
  snapshot: CompositionSnapshotV1 | CompositionSnapshotV2 | undefined
  healthLoading: boolean
  healthError: string | undefined
  health: CompositionHealth | undefined
}

type ActualParticipant = {
  key: string
  sourceKind: "task" | "delegation" | "workflow" | "subagent"
  label: string
  detail: string
  status: string
  attempts?: number
  sessionID?: string
  taskID?: string
  operationID?: string
}

type Props = {
  session: MountedSession
  active: boolean
  openSession: (input: {
    source: MountedSession
    target: SessionTargetRef
    interaction: "interactive" | "readonly"
  }) => void
  openPanel: (panelID: "collaborations" | "subagents" | "workflow") => void
}

export function CompositionPanel(props: Props) {
  return (
    <Show when={props.session.key} keyed>
      {(_key) => (
        <CompositionPanelContent
          session={props.session}
          active={props.active}
          openSession={props.openSession}
          openPanel={props.openPanel}
        />
      )}
    </Show>
  )
}

function CompositionPanelContent(props: Props) {
  const ctx = useExtension<typeof SessionManagement>()
  const lifecycle = { active: true, read: 0, healthRead: 0 }

  const memory = createMemo(() =>
    ctx.storage.memory<PanelState>(`composition.${props.session.key}`, {
      initial: {
        owner: undefined,
        loading: false,
        error: undefined,
        snapshot: undefined,
        healthLoading: false,
        healthError: undefined,
        health: undefined,
      },
    }),
  )

  const state = () => memory()[0]
  const update = (fn: (draft: PanelState) => void) => memory()[1](fn)

  const scope = createMemo(() => {
    const info = props.session.server.data.session.get(props.session.id)

    if (!info) return undefined

    return {
      key: JSON.stringify([props.session.key, props.session.server.attempt, info.location.directory]),
      sessionID: props.session.id,
      directory: info.location.directory,
      client: props.session.server.client,
      connected: props.session.server.connected,
      attempt: props.session.server.attempt,
    }
  })

  onCleanup(() => {
    lifecycle.active = false
  })

  const isCurrent = (captured: NonNullable<ReturnType<typeof scope>>) =>
    lifecycle.active &&
    props.active &&
    props.session.server.client === captured.client &&
    props.session.server.attempt === captured.attempt &&
    scope()?.key === captured.key

  async function syncExecutionParticipants(captured: NonNullable<ReturnType<typeof scope>>, read: number) {
    const sessionData = props.session.server.data.session
    const id = captured.sessionID
    await Promise.allSettled([
      sessionData.readback(id, { children: true }),
      sessionData.workflow.sync(id),
      sessionData.delegation.sync(id),
      sessionData.task.sync(id),
      sessionData.task.operation.sync(id),
    ])

    if (!isCurrent(captured) || read !== lifecycle.read) return
    const childIDs = new Set<string>()

    for (const childID of sessionData.family(id)) {
      if (childID !== id && sessionData.get(childID)?.parentID === id) childIDs.add(childID)
    }

    for (const step of sessionData.workflow.get(id)?.steps ?? []) {
      if (step.childSessionId) childIDs.add(step.childSessionId)
    }

    for (const entry of sessionData.delegation.list(id) ?? []) {
      for (const participant of entry.participants) {
        if (participant.childSessionID) childIDs.add(participant.childSessionID)
      }
    }

    for (const op of sessionData.task.operation.list(id) ?? []) {
      if (op.targetSessionID) childIDs.add(op.targetSessionID)
    }

    if (childIDs.size === 0) return
    await Promise.allSettled(
      [...childIDs].flatMap((childID) => [sessionData.permission.sync(childID), sessionData.form.sync(childID)]),
    )
  }

  async function loadSnapshot() {
    const captured = scope()

    if (!props.active || !captured || !captured.connected) return
    const read = ++lifecycle.read
    update((draft) => {
      draft.owner = captured.key
      draft.loading = true
      draft.error = undefined
    })

    const participantsTask = syncExecutionParticipants(captured, read)

    try {
      const snapshot = await captured.client["session-instance"].session.instance.session.composition({
        sessionID: captured.sessionID,
        directory: captured.directory,
      })

      await participantsTask

      if (!isCurrent(captured) || read !== lifecycle.read) return
      update((draft) => {
        draft.loading = false
        draft.snapshot = snapshot
      })
    } catch (error) {
      await participantsTask

      if (!isCurrent(captured) || read !== lifecycle.read) return
      update((draft) => {
        draft.loading = false
        draft.error = errorMessage(error, ctx.t("session.composition.panel.loadError"))
      })
    }
  }

  async function checkLatestHealth(profilePath: string) {
    const captured = scope()

    if (!props.active || !captured || !captured.connected || state().healthLoading) return
    const read = ++lifecycle.healthRead
    update((draft) => {
      draft.healthLoading = true
      draft.healthError = undefined
      draft.health = undefined
    })

    try {
      const health = await captured.client["custom-composition"].health({
        directory: captured.directory,
        path: profilePath,
      })

      if (!isCurrent(captured) || read !== lifecycle.healthRead) return
      update((draft) => {
        draft.healthLoading = false
        draft.health = health
      })
    } catch (error) {
      if (!isCurrent(captured) || read !== lifecycle.healthRead) return
      update((draft) => {
        draft.healthLoading = false
        draft.healthError = errorMessage(error, ctx.t("session.composition.panel.healthError"))
      })
    }
  }

  // Trigger read ONLY when panel is visible and connected; hidden panel runs zero network work.
  createKeyed(
    () => {
      const current = scope()

      return props.active && current?.connected ? current.key : undefined
    },
    () => {
      void loadSnapshot()
    },
  )

  const snapshotV2 = createMemo<CompositionSnapshotV2 | undefined>(() => {
    const value = state().snapshot

    return value?.version === 2 ? value : undefined
  })

  const configuredRoles = createMemo(() => {
    const v2 = snapshotV2()

    if (!v2) return []
    const bindings = v2.data.bindings ?? {}

    const roles: {
      key: string
      role: "root" | "executor"
      name: string
      path?: string
      revision?: string
      prompts: number
      skills: number
      commands: number
    }[] = []

    if (v2.data.root) {
      const orchBindings = bindings.orchestrator
      roles.push({
        key: "orchestrator",
        role: "root",
        name: v2.data.orchestrator?.name ?? v2.data.root.id,
        path: v2.data.root.source === "asset" ? v2.data.root.relativePath : undefined,
        revision: v2.data.root.revision,
        prompts: orchBindings?.prompts.length ?? 0,
        skills: orchBindings?.skills.length ?? 0,
        commands: orchBindings?.commands.length ?? 0,
      })
    }

    for (const executor of v2.data.executors ?? []) {
      const matchingKey =
        v2.data.agents.find((agent) => agent.relativePath === executor.relativePath)?.consumerKey ??
        Composition.consumerKeyForAgent(executor.info.name, executor.relativePath)

      const bundle = bindings[matchingKey]
      roles.push({
        key: matchingKey,
        role: "executor",
        name: executor.info.name,
        path: executor.relativePath,
        revision: executor.revision,
        prompts: bundle?.prompts.length ?? 0,
        skills: bundle?.skills.length ?? 0,
        commands: bundle?.commands.length ?? 0,
      })
    }

    return roles
  })

  // Strictly separated from SnapshotV2 config: reads real execution records from live Session owners.
  const actualParticipants = createMemo<ActualParticipant[]>(() => {
    if (!props.active) return []
    const server = props.session.server
    const data = server.data.session
    const sessionID = props.session.id
    const rows: ActualParticipant[] = []

    const tasks = data.task.list(sessionID) ?? []
    const operations = data.task.operation.list(sessionID) ?? []

    for (const op of operations) {
      const task = tasks.find((item) => item.id === op.taskID)
      const runtime = executionStatus(server, op.targetSessionID) ?? op.phase
      rows.push({
        key: `op:${op.operationID}`,
        sourceKind: "task",
        label: task?.content || op.selection.agent,
        detail: op.targetSessionID ? `${op.operationID} → ${op.targetSessionID}` : op.operationID,
        status: runtime,
        sessionID: op.targetSessionID,
        taskID: op.taskID,
        operationID: op.operationID,
      })
    }

    const delegations = data.delegation.list(sessionID) ?? []

    for (const entry of delegations) {
      for (const participant of entry.participants) {
        const runtime =
          executionStatus(server, participant.childSessionID) ?? participant.runtimeStatus ?? participant.phase

        const turns = entry.turns.filter((turn) => turn.participantIDs.includes(participant.id)).length
        rows.push({
          key: `del:${entry.delegation.id}:${participant.id}`,
          sourceKind: "delegation",
          label: `${participant.role} · ${participant.target}`,
          detail: `${entry.delegation.id} · ${participant.childSessionID ?? participant.id}`,
          status: runtime,
          attempts: turns,
          sessionID: participant.childSessionID,
        })
      }
    }

    const workflow = data.workflow.get(sessionID)

    if (workflow?.steps.length) {
      for (const step of workflow.steps) {
        const runtime = executionStatus(server, step.childSessionId) ?? step.status
        rows.push({
          key: `wf:${step.id}`,
          sourceKind: "workflow",
          label: `${step.stepId} (${step.agentId})`,
          detail: step.childSessionId ? `${step.stepId} → ${step.childSessionId}` : step.stepId,
          status: runtime,
          attempts: step.attempt,
          sessionID: step.childSessionId,
        })
      }
    }

    const children = data.family(sessionID).filter((id) => data.get(id)?.parentID === sessionID)

    for (const childID of children) {
      const child = data.get(childID)
      const runtime = executionStatus(server, childID) ?? "idle"
      rows.push({
        key: `child:${childID}`,
        sourceKind: "subagent",
        label: child?.title || childID,
        detail: child?.agent ? `${child.agent} · ${childID}` : childID,
        status: runtime,
        sessionID: childID,
      })
    }

    return rows
  })

  return (
    <div data-component="session-composition-panel" role="region" aria-label={ctx.t("tab.composition")}>
      <div data-slot="composition-header">
        <strong>{ctx.t("tab.composition")}</strong>
        <Button
          type="button"
          size="small"
          variant="ghost"
          disabled={!props.session.server.connected || state().loading}
          onClick={() => void loadSnapshot()}
        >
          {ctx.t("session.composition.panel.refresh")}
        </Button>
      </div>

      <Show when={!props.session.server.connected}>
        <p role="status" data-slot="composition-muted">
          {ctx.t("session.composition.panel.offline")}
        </p>
      </Show>

      <Show when={state().loading}>
        <p role="status" data-slot="composition-muted">
          {ctx.t("session.composition.panel.loading")}
        </p>
      </Show>

      <Show when={state().error}>{(error) => <p role="alert">{error()}</p>}</Show>

      {/* Section A: Adopted Snapshot Configuration (immutable, read-only) */}
      <section data-slot="composition-card" aria-label={ctx.t("session.composition.panel.adoptedTitle")}>
        <div data-slot="composition-header">
          <strong>{ctx.t("session.composition.panel.adoptedTitle")}</strong>
          <Badge>{ctx.t("session.composition.panel.configuredCount", { count: configuredRoles().length })}</Badge>
        </div>

        <Show
          when={snapshotV2()}
          fallback={
            <p data-slot="composition-muted">
              {state().snapshot ? ctx.t("session.composition.panel.legacy") : ctx.t("session.composition.panel.empty")}
            </p>
          }
        >
          {(v2) => (
            <>
              <dl data-slot="composition-dl">
                <dt>{ctx.t("session.composition.panel.digest")}</dt>
                <dd data-slot="composition-mono">{v2().digest}</dd>
                <Show when={v2().profilePath}>
                  {(path) => (
                    <>
                      <dt>{ctx.t("session.composition.panel.profile")}</dt>
                      <dd>{path()}</dd>
                    </>
                  )}
                </Show>
                <Show when={v2().profileRevision}>
                  {(rev) => (
                    <>
                      <dt>{ctx.t("session.composition.panel.profileRevision")}</dt>
                      <dd data-slot="composition-mono">{rev()}</dd>
                    </>
                  )}
                </Show>
              </dl>

              <p data-slot="composition-muted">{ctx.t("session.composition.panel.livePermissionsNote")}</p>

              {/* Configured roles & frozen per-role equipment */}
              <ul data-slot="composition-list">
                <For each={configuredRoles()}>
                  {(role) => (
                    <li data-slot="composition-row">
                      <div data-slot="composition-header">
                        <strong>{role.name}</strong>
                        <Badge>
                          {ctx.t(
                            role.role === "root"
                              ? "session.composition.panel.roleRoot"
                              : "session.composition.panel.roleExecutor",
                          )}
                        </Badge>
                      </div>
                      <Show when={role.path}>{(path) => <span data-slot="composition-muted">{path()}</span>}</Show>
                      <Show when={role.revision}>{(rev) => <code data-slot="composition-mono">{rev()}</code>}</Show>
                      <span data-slot="composition-muted">
                        {ctx.t("session.composition.panel.roleEquipment", {
                          prompts: role.prompts,
                          skills: role.skills,
                          commands: role.commands,
                        })}
                      </span>
                    </li>
                  )}
                </For>
              </ul>

              {/* Frozen Workflow */}
              <Show when={v2().data.workflow}>
                {(wf) => (
                  <div data-slot="composition-row">
                    <div data-slot="composition-header">
                      <strong>{wf().name}</strong>
                      <Button type="button" size="small" variant="ghost" onClick={() => props.openPanel("workflow")}>
                        {ctx.t("tab.workflow")}
                      </Button>
                    </div>
                    <span data-slot="composition-muted">
                      {wf().relativePath} ·{" "}
                      {ctx.t("session.composition.panel.workflowSteps", { count: wf().steps.length })}
                    </span>
                  </div>
                )}
              </Show>

              {/* Frozen MCP Bindings */}
              <Show when={(v2().data.mcp?.bindings.length ?? 0) > 0}>
                <div data-slot="composition-row">
                  <strong>
                    {ctx.t("session.composition.panel.mcpBindings", { count: v2().data.mcp?.bindings.length ?? 0 })}
                  </strong>
                  <ul data-slot="composition-list">
                    <For each={v2().data.mcp?.bindings}>
                      {(binding) => (
                        <li>
                          <span>{binding.serverName}</span> ·{" "}
                          <span data-slot="composition-muted">{binding.ref.relativePath}</span>
                          <Show when={binding.credentialRef}>
                            {(cred) => (
                              <>
                                {" "}
                                · <Badge>{cred()}</Badge>
                              </>
                            )}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>

              {/* On-demand freshness / drift check (never mutates current Session) */}
              <Show when={v2().profilePath}>
                {(path) => (
                  <div data-slot="composition-header">
                    <Button
                      type="button"
                      size="small"
                      variant="outline"
                      disabled={!props.session.server.connected || state().healthLoading}
                      onClick={() => void checkLatestHealth(path())}
                    >
                      {ctx.t(
                        state().healthLoading
                          ? "session.composition.panel.checkingHealth"
                          : "session.composition.panel.checkHealth",
                      )}
                    </Button>
                  </div>
                )}
              </Show>
              <Show when={state().healthError}>{(error) => <p role="alert">{error()}</p>}</Show>
              <Show when={state().health}>
                {(health) => (
                  <div role="status" data-slot="composition-row">
                    <strong>{ctx.t(`session.composition.panel.health.${health().status}`)}</strong>
                    <p data-slot="composition-muted">{ctx.t("session.composition.panel.upgradeHint")}</p>
                    <For each={health().diagnostics}>
                      {(diag) => <p data-slot="composition-muted">{diag.message}</p>}
                    </For>
                  </div>
                )}
              </Show>
            </>
          )}
        </Show>
      </section>

      {/* Section B: Actual Execution Participants (live from Task, Delegation, WorkflowRun, Child Sessions) */}
      <section data-slot="composition-card" aria-label={ctx.t("session.composition.panel.actualTitle")}>
        <div data-slot="composition-header">
          <strong>{ctx.t("session.composition.panel.actualTitle")}</strong>
          <Badge>{ctx.t("session.composition.panel.actualCount", { count: actualParticipants().length })}</Badge>
        </div>
        <p data-slot="composition-muted">{ctx.t("session.composition.panel.actualHint")}</p>

        <Show
          when={actualParticipants().length > 0}
          fallback={<p data-slot="composition-muted">{ctx.t("session.composition.panel.actualEmpty")}</p>}
        >
          <ul data-slot="composition-list">
            <For each={actualParticipants()}>
              {(participant) => (
                <li data-slot="composition-row">
                  <div data-slot="composition-header">
                    <strong>{participant.label}</strong>
                    <div class="flex items-center gap-1">
                      <Badge>{ctx.t(`session.composition.panel.source.${participant.sourceKind}`)}</Badge>
                      <Badge>{participant.status}</Badge>
                    </div>
                  </div>
                  <span data-slot="composition-mono">{participant.detail}</span>
                  <Show when={participant.attempts !== undefined && participant.attempts > 0}>
                    <span data-slot="composition-muted">
                      {ctx.t("session.composition.panel.attempts", { count: participant.attempts! })}
                    </span>
                  </Show>
                  <Show when={participant.status === "waiting"}>
                    <p role="status" data-slot="composition-muted">
                      {ctx.t("session.composition.panel.waitingOwner")}
                    </p>
                  </Show>
                  <div class="flex flex-wrap gap-1">
                    <Show when={participant.sourceKind === "task" && (participant.taskID || participant.operationID)}>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        onClick={() => {
                          const target = participant.taskID
                            ? {
                                server: props.session.server,
                                sourceSessionID: props.session.id,
                                taskID: participant.taskID,
                                operationID: participant.operationID,
                              }
                            : {
                                server: props.session.server,
                                sourceSessionID: props.session.id,
                                operationID: participant.operationID!,
                              }

                          ctx.sessions.openTask({ source: props.session, target })
                        }}
                      >
                        {ctx.t("session.composition.panel.inspectTask")}
                      </Button>
                    </Show>
                    <Show when={participant.sourceKind === "delegation"}>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        onClick={() => props.openPanel("collaborations")}
                      >
                        {ctx.t("tab.collaborations")}
                      </Button>
                    </Show>
                    <Show when={participant.sourceKind === "workflow"}>
                      <Button type="button" size="small" variant="ghost" onClick={() => props.openPanel("workflow")}>
                        {ctx.t("tab.workflow")}
                      </Button>
                    </Show>
                    <Show when={participant.sessionID}>
                      {(childID) => (
                        <>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            onClick={() =>
                              props.openSession({
                                source: props.session,
                                target: ctx.sessions.target({ server: props.session.server, sessionID: childID() }),
                                interaction: "readonly",
                              })
                            }
                          >
                            {ctx.t("session.composition.panel.viewReadonly")}
                          </Button>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            onClick={() =>
                              ctx.sessions.open({
                                source: props.session,
                                server: props.session.server,
                                sessionID: childID(),
                              })
                            }
                          >
                            {ctx.t("session.composition.panel.openSession")}
                          </Button>
                        </>
                      )}
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  )
}

export default CompositionPanel
