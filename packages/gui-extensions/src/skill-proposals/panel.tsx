import type { AgentAsset } from "@omnixa/schema/agent-asset"
import type { AssetPlacement } from "@omnixa/schema/asset-placement"
import type { MCPAsset } from "@omnixa/schema/mcp-asset"
import type { WorkflowAsset } from "@omnixa/schema/workflow-asset"
import { ToolDisplay } from "@omnixa/session-ui/message-part"
import { Button } from "@omnixa/ui/button"
import { showToast } from "@omnixa/ui/toast"
import { errorMessage } from "@omnixa/util/error"
// Effect's value matcher collides with Solid's JSX Match.
import { Match as EffectMatch } from "effect"
import { createMemo, For, Match, onCleanup, Show, Switch } from "solid-js"
import {
  createLatest,
  createVisitState,
  useExtension,
  type MountedSession,
  type PanelProps,
  type SessionTargetRef,
} from "../sdk"
import type definition from "./index"
import type en from "./i18n/en"
import { SkillProposal } from "./proposal"

type Props = PanelProps & {
  kind?: SkillProposal.Ready["assetKind"]
  target?: SessionTargetRef
  candidateKey?: string
}

type Entry = ReturnType<typeof SkillProposal.list>[number]

type Scope = ReturnType<typeof ownerScope>

type Ready = SkillProposal.Ready

type Asset = NonNullable<ReturnType<typeof SkillProposal.applied>>

type CurrentAsset = Extract<ReturnType<typeof SkillProposal.current>, { kind: "ready" }>["current"]

type Failure =
  | "error.save"
  | "error.placement"
  | "error.current"
  | "error.changed"
  | "error.nameConflict"
  | "error.readback"
  | "error.target"
  | "error.delete"

type State =
  | { type: "idle" }
  | { type: "confirm" }
  | { type: "saving" }
  | { type: "loading-conflict" }
  | { type: "overwrite"; current: CurrentAsset }
  | { type: "failed"; issue: Failure }
  | { type: "saved"; info: Asset; refreshing: boolean; refreshError: boolean }
  | { type: "delete-confirm"; info: Extract<Asset, { kind: "command" }> }
  | { type: "deleting" }
  | { type: "deleted" }

export default function SkillProposalsPanel(props: Props) {
  const scope = createMemo(() => ownerScope(props.session, contentTarget(props)), undefined, { equals: sameScope })

  return (
    <Show when={scope()} keyed>
      {(scope) => <ProposalList {...props} owner={scope} />}
    </Show>
  )
}

function ProposalList(props: Props & { owner: Scope }) {
  const ctx = useExtension<typeof definition>()
  const text = useCopy(() => props.kind)

  const entries = createMemo(() =>
    SkillProposal.list(contentTarget(props).server.data.session.message.list(contentTarget(props).id), props.kind),
  )

  const [selectedKey, setSelectedKey] = createVisitState<string | undefined>(undefined)

  const selected = createMemo(
    () => {
      const key = props.candidateKey ?? selectedKey()

      return key ? entries().find((entry) => entry.key === key) : entries().at(-1)
    },
    undefined,
    { equals: (previous, next) => previous?.key === next?.key && previous?.stamp === next?.stamp },
  )

  const select = async (key: string) => {
    setSelectedKey(key)
    const candidate = props.candidateKey

    if (!candidate) return
    const target = contentTarget(props)
    const kind = props.kind ?? "skill"
    const stored = ctx.stores.responses(props.session)

    try {
      await stored.update((draft) => {
        const binding = draft.targets[kind]

        if (
          binding?.candidateKey !== candidate ||
          binding.serverID !== target.server.id ||
          binding.sessionID !== target.id
        )
          return
        binding.candidateKey = key
      })
    } catch (error) {
      if (ctx.signal.aborted || !sameScope(props.owner, ownerScope(props.session, contentTarget(props)))) return
      showToast({
        variant: "error",
        title: ctx.t("response.openError"),
        description: errorMessage(error, ctx.t("common.requestFailed")),
      })
    }
  }

  return (
    <section data-component={`${props.kind ?? "skill"}-proposals-panel`}>
      <h2>{text("panel.title")}</h2>
      <p>{text("panel.description")}</p>
      <Show
        when={entries().length > 0}
        fallback={<p role="status">{props.candidateKey ? ctx.t("response.candidateMissing") : text("panel.empty")}</p>}
      >
        <nav aria-label={text("panel.candidates")}>
          <For each={entries()}>
            {(entry) => (
              <Button
                size="small"
                variant="outline"
                aria-pressed={selected()?.key === entry.key}
                onClick={() => void select(entry.key)}
              >
                {entry.name}
              </Button>
            )}
          </For>
        </nav>
        <Show when={selected()} keyed fallback={<p role="status">{ctx.t("response.candidateMissing")}</p>}>
          {(entry) => <ProposalDetail {...props} entry={entry} />}
        </Show>
      </Show>
    </section>
  )
}

function ProposalDetail(props: Props & { owner: Scope; entry: Entry }) {
  const text = useCopy(() => props.kind)

  return (
    <div data-component="skill-proposal">
      <ToolDisplay
        id={props.entry.tool.id}
        tool={props.entry.tool.name}
        sessionID={contentTarget(props).id}
        status={props.entry.tool.state.status}
        input={props.entry.tool.state.input}
        metadata={props.entry.tool.state.metadata ?? {}}
        output={props.entry.tool.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")}
        hideDetails
      />
      <Show
        when={props.entry.proposal.kind === "ready" ? props.entry.proposal : undefined}
        keyed
        fallback={
          <p role="status">{props.entry.proposal.kind === "invalid" ? text(props.entry.proposal.issue) : ""}</p>
        }
      >
        {(proposal) => (
          <Show
            when={
              proposal.assetKind === "skill" || proposal.assetKind === "command" || proposal.assetKind === "prompt"
                ? proposal
                : undefined
            }
            keyed
            fallback={<SkillReview {...props} proposal={proposal} />}
          >
            {(selected) => <TargetReview {...props} proposal={selected} />}
          </Show>
        )}
      </Show>
    </div>
  )
}

function TargetReview(
  props: Props & { owner: Scope; proposal: Extract<Ready, { assetKind: "skill" | "command" | "prompt" }> },
) {
  const ctx = useExtension<typeof definition>()
  const text = useCopy(() => props.kind)

  const [request, setRequest] = createVisitState<{ scope: AssetPlacement.Scope; token: symbol; confirm: boolean }>({
    scope: props.proposal.target?.scope ?? "location",
    token: Symbol(),
    confirm: false,
  })

  const enabled = () =>
    !ctx.signal.aborted &&
    sameScope(props.owner, ownerScope(props.session, contentTarget(props))) &&
    !contentTarget(props).server.data.session.creating(contentTarget(props).id) &&
    contentTarget(props).server.connected &&
    contentTarget(props).server.compatible &&
    !!contentTarget(props).location

  const inspection = createLatest(
    () => (enabled() ? request() : undefined),
    async (selected, signal) => {
      const location = contentTarget(props).location

      if (!location) return undefined

      const input = {
        sessionID: contentTarget(props).id,
        directory: location.directory,
        workspace: location.workspaceID,
        scope: selected.scope,
      }

      const response = await EffectMatch.value(props.proposal).pipe(
        EffectMatch.when({ assetKind: "prompt" }, (proposal) =>
          contentTarget(props).server.client["prompt-asset"].inspect(
            { ...input, candidate: proposal.candidate },
            { signal },
          ),
        ),
        EffectMatch.when({ assetKind: "command" }, (proposal) =>
          contentTarget(props).server.client["command-asset"].inspect(
            { ...input, candidate: proposal.candidate },
            { signal },
          ),
        ),
        EffectMatch.when({ assetKind: "skill" }, (proposal) =>
          contentTarget(props).server.client["skill-asset"].inspect(
            { ...input, candidate: proposal.candidate },
            { signal },
          ),
        ),
        EffectMatch.exhaustive,
      )

      if (signal.aborted || ctx.signal.aborted) return undefined

      const proposal = SkillProposal.inspected(props.proposal, response, selected.scope)

      if (!proposal) throw new Error("Invalid target inspection")

      return { token: selected.token, proposal, confirm: selected.confirm }
    },
  )

  // createLatest retains old results. Only this request's result may own confirmation and save observation.
  const reviewed = createMemo(() =>
    enabled() && !inspection.loading && !inspection.error && inspection.latest?.token === request().token
      ? inspection.latest
      : undefined,
  )

  return (
    <div data-component="skill-target-review">
      <div role="group" aria-label={ctx.t("target.title")} data-slot="skill-actions">
        <For each={["project", "global"] as const}>
          {(scope) => (
            <Button
              size="small"
              variant="outline"
              aria-pressed={request().scope === scope}
              disabled={!enabled()}
              onClick={() => setRequest({ scope, token: Symbol(), confirm: false })}
            >
              {ctx.t(scope === "project" ? "target.project" : "target.global")}
            </Button>
          )}
        </For>
        <Show when={!props.proposal.target || props.proposal.target.scope === "location"}>
          <Button
            size="small"
            variant="outline"
            aria-pressed={request().scope === "location"}
            disabled={!enabled()}
            onClick={() => setRequest({ scope: "location", token: Symbol(), confirm: false })}
          >
            {ctx.t("target.location")}
          </Button>
        </Show>
        <Button
          size="small"
          variant="outline"
          disabled={!enabled()}
          onClick={() => setRequest({ scope: request().scope, token: Symbol(), confirm: false })}
        >
          {ctx.t("target.recheck")}
        </Button>
      </div>
      <p>
        {EffectMatch.value(request().scope).pipe(
          EffectMatch.when("global", () => text("target.globalNotice")),
          EffectMatch.when("location", () => ctx.t("target.legacyNotice")),
          EffectMatch.orElse(() => ctx.t("target.projectNotice")),
        )}
      </p>
      <Show
        when={reviewed()}
        keyed
        fallback={
          <p role="status">
            {!enabled() ? text("panel.unavailable") : ctx.t(inspection.error ? "target.failed" : "target.checking")}
          </p>
        }
      >
        {(review) => (
          <SkillReview
            {...props}
            proposal={review.proposal}
            confirm={review.confirm}
            review={() => setRequest({ scope: request().scope, token: Symbol(), confirm: true })}
          />
        )}
      </Show>
    </div>
  )
}

function SkillReview(props: Props & { owner: Scope; proposal: Ready; confirm?: boolean; review?: () => void }) {
  const ctx = useExtension<typeof definition>()
  const text = useCopy(() => props.kind)

  const [state, setState] = createVisitState<State>({
    type: props.confirm && !props.proposal.facts.nameConflict ? "confirm" : "idle",
  })

  const controller = new AbortController()
  // Keyed UI owners end on route/Location/controller or persisted proposal changes. Aborting observation does not undo a write.
  onCleanup(() => controller.abort())

  const live = () =>
    !controller.signal.aborted &&
    !ctx.signal.aborted &&
    sameScope(props.owner, ownerScope(props.session, contentTarget(props)))

  const enabled = () =>
    live() &&
    !contentTarget(props).server.data.session.creating(contentTarget(props).id) &&
    contentTarget(props).server.connected &&
    contentTarget(props).server.compatible &&
    !!contentTarget(props).location

  const target = () =>
    props.proposal.assetKind === "skill" ||
    props.proposal.assetKind === "command" ||
    props.proposal.assetKind === "prompt"
      ? props.proposal.target
      : undefined

  const overwrite = () => {
    const value = state()

    return value.type === "overwrite" ? value.current : undefined
  }

  const currentAgent = () => {
    const current = overwrite()

    return current?.kind === "agent" ? current : undefined
  }

  const currentMcp = () => {
    const current = overwrite()

    return current?.kind === "mcp" ? current : undefined
  }

  const currentWorkflow = () => {
    const current = overwrite()

    return current?.kind === "workflow" ? current : undefined
  }

  const saved = () => {
    const value = state()

    return value.type === "saved" ? value : undefined
  }

  const savedAgent = () => {
    const current = saved()

    return current?.info.kind === "agent" ? current.info : undefined
  }

  const savedWorkflow = () => {
    const current = saved()

    return current?.info.kind === "workflow" ? current.info : undefined
  }

  const failure = () => {
    const value = state()

    return value.type === "failed" ? value : undefined
  }

  const native = createMemo(() => {
    const value = saved()
    const location = contentTarget(props).location

    if (!value || !location) return undefined

    if (value.info.kind === "agent") return ctx.t("agents.save.ready")

    if (value.info.kind === "mcp") return ctx.t("mcps.save.ready")

    if (value.info.kind === "plugin") return ctx.t("plugins.save.ready")

    if (value.info.kind === "workflow") return ctx.t("workflows.save.ready")

    if (value.info.kind === "prompt") return ctx.t("prompts.save.ready")

    if (value.info.kind === "command") {
      const command = SkillProposal.nativeCommand(
        value.info,
        contentTarget(props).server.data.location.command.list({ directory: location.directory }) ?? [],
      )

      // The public command list proves its name is listed, not which file or body registered it.
      return command ? ctx.t("commands.save.nativeReady", { name: command.name }) : undefined
    }

    const skill = SkillProposal.native(
      value.info,
      location,
      contentTarget(props).server.data.location.skill.list({ directory: location.directory }) ?? [],
    )

    return skill ? ctx.t("save.nativeReady", { id: skill.id }) : undefined
  })

  async function apply() {
    const before = state()
    const location = contentTarget(props).location

    if (
      !enabled() ||
      !location ||
      props.proposal.facts.nameConflict ||
      (before.type === "overwrite" && before.current.kind === "agent" && before.current.handoffs.length > 0) ||
      (before.type !== "confirm" && before.type !== "overwrite")
    )
      return

    const proposal = props.proposal
    const placement = { directory: location.directory, workspace: location.workspaceID }
    const revision = before.type === "overwrite" ? before.current.revision : proposal.facts.revision
    setState({ type: "saving" })

    try {
      const input = {
        sessionID: contentTarget(props).id,
        ...placement,
        overwrite: before.type === "overwrite",
      }

      // The HTTP contract accepts an optional String; null is the owner's new-target fact, not an HTTP value.
      if (revision !== null) Object.assign(input, { baseRevision: revision })

      const answer = await EffectMatch.value(proposal).pipe(
        EffectMatch.when({ assetKind: "workflow" }, (selected) =>
          contentTarget(props).server.client["workflow-asset"].apply(
            { ...input, candidate: selected.candidate },
            { signal: controller.signal },
          ),
        ),
        EffectMatch.when({ assetKind: "plugin" }, (selected) =>
          contentTarget(props).server.client["plugin-asset"].apply(
            { ...input, candidate: selected.candidate },
            { signal: controller.signal },
          ),
        ),
        EffectMatch.when({ assetKind: "mcp" }, (selected) =>
          contentTarget(props).server.client["mcp-asset"].apply(
            { ...input, candidate: selected.candidate },
            { signal: controller.signal },
          ),
        ),
        EffectMatch.when({ assetKind: "agent" }, (selected) =>
          contentTarget(props).server.client["agent-asset"].apply(
            { ...input, candidate: selected.candidate },
            { signal: controller.signal },
          ),
        ),
        EffectMatch.when({ assetKind: "prompt" }, (selected) =>
          contentTarget(props).server.client["prompt-asset"].apply(
            { ...input, candidate: selected.candidate, target: selected.target },
            { signal: controller.signal },
          ),
        ),
        EffectMatch.when({ assetKind: "command" }, (selected) =>
          contentTarget(props).server.client["command-asset"].apply(
            { ...input, candidate: selected.candidate, target: selected.target },
            { signal: controller.signal },
          ),
        ),
        EffectMatch.when({ assetKind: "skill" }, (selected) =>
          contentTarget(props).server.client["skill-asset"].apply(
            { ...input, candidate: selected.candidate, target: selected.target },
            { signal: controller.signal },
          ),
        ),
        EffectMatch.exhaustive,
      )

      if (!live()) return

      const info = SkillProposal.applied(proposal, answer)

      if (!info) {
        setState({ type: "failed", issue: "error.readback" })

        return
      }

      setState({ type: "saved", info, refreshing: false, refreshError: false })
    } catch (cause) {
      if (!live()) return

      if (
        (proposal.assetKind === "skill" || proposal.assetKind === "command" || proposal.assetKind === "prompt") &&
        cause instanceof Error &&
        cause.name === "InvalidRequestError" &&
        "kind" in cause &&
        cause.kind === "target_mismatch"
      ) {
        setState({ type: "failed", issue: "error.target" })

        return
      }

      if (
        cause instanceof Error &&
        cause.name === "ConflictError" &&
        "resource" in cause &&
        cause.resource === contentTarget(props).id
      ) {
        // Session IDs and flat asset paths may coincide; ambiguous conflicts cannot authorize replacement.
        setState({
          type: "failed",
          issue: cause.resource === proposal.candidate.relativePath ? "error.save" : "error.placement",
        })

        return
      }

      if (
        cause instanceof Error &&
        cause.name === "ConflictError" &&
        "resource" in cause &&
        cause.resource === proposal.candidate.relativePath
      ) {
        setState({ type: "loading-conflict" })

        const assets = EffectMatch.value(proposal.assetKind).pipe(
          EffectMatch.when("workflow", () => contentTarget(props).server.client["workflow-asset"]),
          EffectMatch.when("plugin", () => contentTarget(props).server.client["plugin-asset"]),
          EffectMatch.when("mcp", () => contentTarget(props).server.client["mcp-asset"]),
          EffectMatch.when("agent", () => contentTarget(props).server.client["agent-asset"]),
          EffectMatch.when("prompt", () => contentTarget(props).server.client["prompt-asset"]),
          EffectMatch.when("command", () => contentTarget(props).server.client["command-asset"]),
          EffectMatch.when("skill", () => contentTarget(props).server.client["skill-asset"]),
          EffectMatch.exhaustive,
        )

        const selected =
          proposal.assetKind === "skill" || proposal.assetKind === "command" || proposal.assetKind === "prompt"
            ? { ...placement, scope: proposal.target?.scope }
            : placement

        const [catalog, content] = await Promise.allSettled([
          assets.list(selected, { signal: controller.signal }),
          assets.content({ ...selected, path: proposal.candidate.relativePath }, { signal: controller.signal }),
        ])

        if (!live()) return

        if (catalog.status !== "fulfilled" || content.status !== "fulfilled") {
          setState({ type: "failed", issue: "error.current" })

          return
        }

        const next = SkillProposal.current(proposal, content.value, catalog.value)

        if (next.kind === "blocked") {
          setState({ type: "failed", issue: next.issue })

          return
        }

        setState({ type: "overwrite", current: next.current })

        return
      }

      setState({ type: "failed", issue: "error.save" })
    }
  }

  async function refresh() {
    const before = saved()
    const location = contentTarget(props).location

    if (
      !enabled() ||
      !before ||
      before.info.kind === "prompt" ||
      before.info.kind === "agent" ||
      before.info.kind === "mcp" ||
      before.info.kind === "plugin" ||
      before.info.kind === "workflow" ||
      before.refreshing ||
      !location
    )
      return

    setState({ ...before, refreshing: true, refreshError: false })

    try {
      const consumer = { directory: location.directory }

      const resource =
        before.info.kind === "command"
          ? contentTarget(props).server.data.location.command
          : contentTarget(props).server.data.location.skill

      resource.invalidate(consumer)
      await resource.sync(consumer)

      if (!live()) return

      setState({ ...before, refreshing: false })
    } catch {
      if (!live()) return

      setState({ ...before, refreshing: false, refreshError: true })
    }
  }

  async function insert() {
    const before = saved()
    const location = contentTarget(props).location

    if (
      !enabled() ||
      contentTarget(props).key !== props.session.key ||
      !before ||
      before.info.kind !== "prompt" ||
      before.refreshing ||
      !location
    )
      return

    setState({ ...before, refreshing: true, refreshError: false })

    try {
      const content = await contentTarget(props).server.client["prompt-asset"].content(
        {
          directory: location.directory,
          workspace: location.workspaceID,
          path: before.info.relativePath,
          scope: before.info.target?.scope,
        },
        { signal: controller.signal },
      )

      if (!live()) return

      const current = SkillProposal.applied(props.proposal, content)

      if (!current || current.kind !== "prompt" || current.revision !== before.info.revision) {
        setState({ type: "failed", issue: "error.changed" })

        return
      }

      props.screen.composer.addText(current.template)
      setState({ ...before, refreshing: false })
    } catch {
      if (!live()) return

      setState({ ...before, refreshing: false, refreshError: true })
    }
  }

  async function remove() {
    const before = state()
    const location = contentTarget(props).location

    if (!enabled() || !location || before.type !== "delete-confirm") return

    setState({ type: "deleting" })

    try {
      await contentTarget(props).server.client["command-asset"].delete(
        {
          sessionID: contentTarget(props).id,
          directory: location.directory,
          workspace: location.workspaceID,
          relativePath: before.info.relativePath,
          baseRevision: before.info.revision,
          target: before.info.target,
        },
        { signal: controller.signal },
      )

      if (!live()) return

      setState({ type: "deleted" })
    } catch {
      if (!live()) return

      // The response cannot prove a failed deletion left the file untouched.
      setState({ type: "failed", issue: "error.delete" })
    }
  }

  const deletion = () => {
    const value = state()

    return value.type === "delete-confirm" ? value.info : undefined
  }

  return (
    <div data-component="skill-candidate">
      <dl>
        <dt>{text("candidate.name")}</dt>
        <dd>{props.proposal.candidate.name}</dd>
        <dt>{text("candidate.description")}</dt>
        <dd>{props.proposal.candidate.description}</dd>
        <Show when={"invocation" in props.proposal.candidate ? props.proposal.candidate : undefined}>
          {(candidate) => (
            <>
              <dt>{ctx.t("commands.candidate.invocation")}</dt>
              <dd>{candidate().invocation}</dd>
              <Show when={candidate().args !== undefined}>
                <dt>{ctx.t("commands.candidate.args")}</dt>
                <dd>{candidate().args}</dd>
              </Show>
            </>
          )}
        </Show>
        <dt>{text("candidate.target")}</dt>
        <dd>
          <code>{props.proposal.candidate.relativePath}</code>
        </dd>
        <dt>{target() ? ctx.t("target.root") : text("candidate.location")}</dt>
        <dd>
          <code>{target()?.root ?? contentTarget(props).location?.directory}</code>
        </dd>
        <dt>{text("candidate.targetState")}</dt>
        <dd>
          {target()
            ? ctx.t(props.proposal.facts.exists ? "target.existing" : "target.new")
            : text(props.proposal.facts.exists ? "candidate.existing" : "candidate.new")}
        </dd>
      </dl>
      <Show when={props.proposal.facts.nameConflict}>
        <p role="status">{text("error.nameConflict")}</p>
      </Show>
      <Show when={props.proposal.facts.pathConflict}>
        <p>{text("candidate.pathConflict")}</p>
      </Show>
      <Show when={"config" in props.proposal.candidate ? props.proposal.candidate : undefined}>
        {(candidate) => (
          <>
            <h3>{ctx.t("agents.candidate.config")}</h3>
            <pre>{candidate().config}</pre>
          </>
        )}
      </Show>
      <Show when={"warnings" in props.proposal.facts ? props.proposal.facts.warnings : undefined}>
        {(warnings) => <AgentWarnings warnings={warnings()} />}
      </Show>
      <Show when={"configJson" in props.proposal.candidate ? props.proposal.candidate : undefined}>
        {(candidate) => (
          <>
            <McpConfiguration value={candidate()} />
            <p>{ctx.t("mcps.candidate.environmentNotice")}</p>
          </>
        )}
      </Show>
      <h3>{text("candidate.content")}</h3>
      <pre>{bodyOf(props.proposal.candidate)}</pre>
      <Show when={!enabled()}>
        <p role="status">{text("panel.unavailable")}</p>
      </Show>
      <Switch>
        <Match when={state().type === "idle"}>
          <Button
            size="small"
            disabled={!enabled() || props.proposal.facts.nameConflict}
            onClick={() => (props.review ? props.review() : setState({ type: "confirm" }))}
          >
            {text("confirm.review")}
          </Button>
        </Match>
        <Match when={state().type === "confirm"}>
          <div role="group" aria-label={text("confirm.title")} data-component="skill-save-confirm">
            <p>{text("confirm.message")}</p>
            <Show when={target()?.scope === "global"}>
              <p>{text("target.globalConfirm")}</p>
            </Show>
            <div data-slot="skill-actions">
              <Button size="small" disabled={!enabled()} onClick={() => void apply()}>
                {text("confirm.save")}
              </Button>
              <Button size="small" variant="outline" onClick={() => setState({ type: "idle" })}>
                {text("confirm.cancel")}
              </Button>
            </div>
          </div>
        </Match>
        <Match when={state().type === "saving" || state().type === "loading-conflict"}>
          <p role="status">{text(state().type === "saving" ? "save.saving" : "save.loadingConflict")}</p>
        </Match>
        <Match when={overwrite()}>
          {(current) => (
            <div role="group" aria-label={text("overwrite.title")} data-component="skill-overwrite-confirm">
              <p>{text("overwrite.message")}</p>
              <h3>{text("overwrite.current")}</h3>
              <p>{current().name}</p>
              <p>{current().description}</p>
              <Show when={currentAgent()}>
                {(agent) => (
                  <>
                    <h3>{ctx.t("agents.overwrite.config")}</h3>
                    <pre>{agent().config}</pre>
                    <Show when={agent().handoffs.length > 0}>
                      <h3>{ctx.t("agents.overwrite.handoffs")}</h3>
                      <pre>{JSON.stringify(agent().handoffs, null, 2)}</pre>
                      <p>{ctx.t("agents.overwrite.keepHandoffs")}</p>
                    </Show>
                  </>
                )}
              </Show>
              <Show when={currentMcp()}>{(mcp) => <McpConfiguration value={mcp()} />}</Show>
              <Show when={currentWorkflow()}>{(workflow) => <WorkflowDeclaration value={workflow()} />}</Show>
              <pre>{bodyOf(current())}</pre>
              <div data-slot="skill-actions">
                <Button
                  size="small"
                  disabled={!enabled() || (currentAgent()?.handoffs.length ?? 0) > 0}
                  onClick={() => void apply()}
                >
                  {text("overwrite.replace")}
                </Button>
                <Button size="small" variant="outline" onClick={() => setState({ type: "idle" })}>
                  {text("confirm.cancel")}
                </Button>
              </div>
            </div>
          )}
        </Match>
        <Match when={failure()}>
          {(failure) => (
            <div role="status">
              <p>{text(failure().issue)}</p>
              <Show when={failure().issue !== "error.delete" && failure().issue !== "error.target"}>
                <Button size="small" variant="outline" onClick={() => setState({ type: "idle" })}>
                  {text("confirm.again")}
                </Button>
              </Show>
            </div>
          )}
        </Match>
        <Match when={saved()}>
          {(saved) => (
            <div role="status" data-component="skill-save-result">
              <Show when={native()} fallback={<p>{text("save.waiting")}</p>}>
                {(message) => <p>{message()}</p>}
              </Show>
              <Show when={savedAgent()}>{(agent) => <AgentWarnings warnings={agent().warnings} />}</Show>
              <Show when={savedWorkflow()}>
                {(workflow) => (
                  <>
                    <WorkflowDeclaration value={workflow()} />
                    <h3>{ctx.t("workflows.declaration.content")}</h3>
                    <pre>{workflow().content}</pre>
                  </>
                )}
              </Show>
              <Show when={!native()}>
                <Button
                  size="small"
                  variant="outline"
                  disabled={!enabled() || saved().refreshing}
                  onClick={() => void refresh()}
                >
                  {text(saved().refreshing ? "save.refreshing" : "save.refresh")}
                </Button>
              </Show>
              <Show when={saved().refreshError}>
                <p>{text("save.refreshError")}</p>
              </Show>
              <Show when={saved().info.kind === "prompt"}>
                <Show when={contentTarget(props).key !== props.session.key}>
                  <Button
                    size="small"
                    disabled={!enabled()}
                    onClick={() => {
                      const target = contentTarget(props)

                      ctx.sessions.open({ source: props.session, server: target.server, sessionID: target.id })
                    }}
                  >
                    {ctx.t("response.openTarget")}
                  </Button>
                </Show>
                <Button
                  size="small"
                  disabled={!enabled() || saved().refreshing || contentTarget(props).key !== props.session.key}
                  onClick={() => void insert()}
                >
                  {ctx.t(saved().refreshing ? "prompts.insert.pending" : "prompts.insert.action")}
                </Button>
              </Show>
              <Show when={saved().info.kind === "command"}>
                <Button
                  size="small"
                  variant="outline"
                  disabled={!enabled() || saved().refreshing}
                  onClick={() => {
                    const info = saved()?.info

                    if (info?.kind === "command") setState({ type: "delete-confirm", info })
                  }}
                >
                  {ctx.t("commands.delete.review")}
                </Button>
              </Show>
            </div>
          )}
        </Match>
        <Match when={deletion()}>
          {(info) => (
            <div role="group" aria-label={ctx.t("commands.delete.title")}>
              <p>{ctx.t("commands.delete.message")}</p>
              <code>{info().relativePath}</code>
              <pre>{info().source}</pre>
              <div data-slot="skill-actions">
                <Button size="small" disabled={!enabled()} onClick={() => void remove()}>
                  {ctx.t("commands.delete.confirm")}
                </Button>
                <Button
                  size="small"
                  variant="outline"
                  onClick={() => setState({ type: "saved", info: info(), refreshing: false, refreshError: false })}
                >
                  {text("confirm.cancel")}
                </Button>
              </div>
            </div>
          )}
        </Match>
        <Match when={state().type === "deleting"}>
          <p role="status">{ctx.t("commands.delete.pending")}</p>
        </Match>
        <Match when={state().type === "deleted"}>
          <p role="status">{ctx.t("commands.delete.done")}</p>
        </Match>
      </Switch>
    </div>
  )
}

function AgentWarnings(props: { warnings: readonly AgentAsset.Warning[] }) {
  const ctx = useExtension<typeof definition>()

  return (
    <Show when={props.warnings.length > 0}>
      <section aria-label={ctx.t("agents.warnings.title")}>
        <h3>{ctx.t("agents.warnings.title")}</h3>
        <ul>
          <For each={props.warnings}>
            {(warning) => (
              <li>{ctx.t(`agents.warning.${warning.code}`, { action: warning.action, resource: warning.resource })}</li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  )
}

function McpConfiguration(props: { value: Pick<MCPAsset.Info, "command" | "args" | "env"> }) {
  const ctx = useExtension<typeof definition>()

  return (
    <dl>
      <dt>{ctx.t("mcps.candidate.command")}</dt>
      <dd>
        <pre>{props.value.command}</pre>
      </dd>
      <dt>{ctx.t("mcps.candidate.args")}</dt>
      <dd>
        <pre>{JSON.stringify(props.value.args, null, 2)}</pre>
      </dd>
      <dt>{ctx.t("mcps.candidate.env")}</dt>
      <dd>
        <pre>{JSON.stringify(props.value.env, null, 2)}</pre>
      </dd>
    </dl>
  )
}

function WorkflowDeclaration(props: { value: WorkflowAsset.Info }) {
  const ctx = useExtension<typeof definition>()

  return (
    <dl>
      <dt>{ctx.t("workflows.declaration.version")}</dt>
      <dd>{props.value.version}</dd>
      <dt>{ctx.t("workflows.declaration.triggers")}</dt>
      <dd>
        <pre>{JSON.stringify(props.value.triggers, null, 2)}</pre>
      </dd>
      <dt>{ctx.t("workflows.declaration.steps")}</dt>
      <dd>
        <pre>{JSON.stringify(props.value.steps, null, 2)}</pre>
      </dd>
    </dl>
  )
}

function useCopy(kind: () => Props["kind"]) {
  const ctx = useExtension<typeof definition>()

  return (key: keyof typeof en) => {
    const family = kind()

    return ctx.t(family && family !== "skill" ? `${family}s.${key}` : key)
  }
}

function bodyOf(value: Asset | CurrentAsset | Ready["candidate"]) {
  if ("kind" in value && (value.kind === "plugin" || value.kind === "workflow")) return value.content

  return "configJson" in value
    ? value.configJson
    : "template" in value
      ? value.template
      : "source" in value
        ? value.source
        : value.content
}

function contentTarget(props: Props) {
  return props.target ?? props.session
}

function ownerScope(source: MountedSession, target: SessionTargetRef) {
  return {
    key: target.key,
    id: target.id,
    sourceKey: source.key,
    visit: source.visit,
    routeDirectory: source.directory,
    sourceWorkspace: source.location?.workspaceID,
    sourceAttempt: source.server.attempt,
    directory: target.location?.directory,
    workspace: target.location?.workspaceID,
    client: target.server.client,
    data: target.server.data,
    connected: target.server.connected,
    compatible: target.server.compatible,
    pending: target.server.data.session.creating(target.id),
    attempt: target.server.attempt,
  }
}

function sameScope(previous: Scope | undefined, next: Scope | undefined) {
  if (!previous || !next) return previous === next

  return (
    previous.key === next.key &&
    previous.id === next.id &&
    previous.sourceKey === next.sourceKey &&
    previous.visit === next.visit &&
    previous.routeDirectory === next.routeDirectory &&
    previous.sourceWorkspace === next.sourceWorkspace &&
    previous.sourceAttempt === next.sourceAttempt &&
    previous.directory === next.directory &&
    previous.workspace === next.workspace &&
    previous.client === next.client &&
    previous.data === next.data &&
    previous.connected === next.connected &&
    previous.compatible === next.compatible &&
    previous.pending === next.pending &&
    previous.attempt === next.attempt
  )
}
