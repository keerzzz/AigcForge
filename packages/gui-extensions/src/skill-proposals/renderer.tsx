import { Switch } from "@aigcfroge/ui/switch"
import { Icon } from "@aigcfroge/ui/icon"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { showToast } from "@aigcfroge/ui/toast"
import { Tooltip } from "@aigcfroge/ui/tooltip"
import { errorMessage } from "@aigcfroge/util/error"
import { createMemo, createSignal, For, Show, lazy, onCleanup, Suspense } from "solid-js"
import {
  Command,
  createKeyed,
  createLatest,
  MenuItem,
  onIdle,
  Panel,
  SettingsPage,
  Slot,
  Style,
  type PanelProps,
  type PanelTab,
  type Setup,
} from "../sdk"
import { candidateKey } from "./index"
import type definition from "./index"
import css from "./panel.css?inline"

const setup: Setup<typeof definition> = (ctx) => {
  const display = ctx.stores.display
  const modules = ["main", "commands", "prompts", "agents", "mcps", "plugins", "workflows"] as const

  const kinds = {
    main: "skill",
    commands: "command",
    prompts: "prompt",
    agents: "agent",
    mcps: "mcp",
    plugins: "plugin",
    workflows: "workflow",
  } as const

  const icons = {
    main: "post-skill",
    commands: "console",
    prompts: "prompt",
    agents: "brain",
    mcps: "mcp",
    plugins: "cube",
    workflows: "branch",
  } as const

  ctx.add(Slot, {
    at: "session.response.actions",
    order: 10,
    render(input) {
      const [pending, setPending] = createSignal(false)
      let disposed = false
      onCleanup(() => {
        disposed = true
      })

      const capturable = () => {
        const target = input.session
        const info = target.server.data.session.get(target.id)

        return (
          input.active &&
          input.completed &&
          input.latest &&
          !!info &&
          info.mode !== "chat" &&
          target.server.data.session.status(target.id) === "idle"
        )
      }

      const proposals = createMemo(() => {
        if (!input.active || !input.completed) return []
        const messages = input.session.server.data.session.message.list(input.session.id)
        // This cached ordinary-user partition follows the supplied userMessageID. Completion and fork boundaries stay host facts.
        const start = messages.findIndex((message) => message.type === "user" && message.id === input.userMessageID)

        if (start === -1) return []
        const end = messages.findIndex((message, index) => index > start && message.type === "user")

        return messages.slice(start + 1, end === -1 ? undefined : end).flatMap((message) =>
          message.type === "assistant"
            ? message.content.flatMap((tool) => {
                if (tool.type !== "tool" || tool.state.status !== "completed") return []
                const module = modules.find((id) => tool.name === `propose_${kinds[id]}_asset`)

                if (!module || !display.value[module]) return []

                return [
                  { module, key: candidateKey(message.id, tool.id), assistantMessageID: message.id, toolID: tool.id },
                ]
              })
            : [],
        )
      })

      const capture = async () => {
        const target = input.session
        const source = input.source
        const server = target.server
        const client = server.client
        const attempt = server.attempt
        const sessionID = target.id
        const assistantMessageID = input.assistantMessageID
        const contentID = input.contentID
        const location = target.location
        const assistant = server.data.session.message.get(sessionID, assistantMessageID)

        if (disposed || ctx.signal.aborted || pending() || !capturable()) return

        if (!server.connected || !server.compatible || !location || assistant?.type !== "assistant") {
          showToast({ variant: "error", title: ctx.t("response.unavailable") })

          return
        }

        const capturedLocation = { ...location }

        const text = assistant.content
          .flatMap((part) =>
            part.type === "text" &&
            !("synthetic" in part && part.synthetic === true) &&
            !("ignored" in part && part.ignored === true)
              ? [part.text]
              : [],
          )
          .join("\n\n")

        if (!text.trim()) {
          showToast({ variant: "error", title: ctx.t("response.unavailable") })

          return
        }

        const prompt = ctx.t("response.draft", {
          server: server.id,
          session: sessionID,
          assistant: assistantMessageID,
          content: contentID,
          location: JSON.stringify(capturedLocation),
          text,
        })

        setPending(true)

        try {
          await ctx.sessions.draft({ source: target, location: capturedLocation, text: prompt })
        } catch (error) {
          if (
            disposed ||
            ctx.signal.aborted ||
            server.attempt !== attempt ||
            server.client !== client ||
            input.source.key !== source.key
          )
            return
          showToast({
            variant: "error",
            title: ctx.t("response.error"),
            description: errorMessage(error, ctx.t("common.requestFailed")),
          })
        } finally {
          if (!disposed && !ctx.signal.aborted) setPending(false)
        }
      }

      const openProposal = async (proposal: ReturnType<typeof proposals>[number]) => {
        const source = input.source
        const target = input.session
        const server = target.server
        const client = server.client
        const attempt = server.attempt
        const sessionID = target.id
        const key = proposal.key
        const module = proposal.module
        const stored = ctx.stores.responses(source)

        if (disposed || ctx.signal.aborted || pending()) return

        setPending(true)

        try {
          await stored.update((draft) => {
            draft.targets[kinds[module]] = { serverID: server.id, sessionID, candidateKey: key }
          })

          if (disposed || ctx.signal.aborted) return
          ctx.layout.open(`${ctx.id}:${module}`, source, { tab: "select" })
        } catch (error) {
          if (disposed || ctx.signal.aborted || server.attempt !== attempt || server.client !== client) return
          showToast({
            variant: "error",
            title: ctx.t("response.openError"),
            description: errorMessage(error, ctx.t("common.requestFailed")),
          })
        } finally {
          if (!disposed && !ctx.signal.aborted) setPending(false)
        }
      }

      return (
        <>
          <Show when={capturable()}>
            <Tooltip value={ctx.t(pending() ? "response.preparing" : "response.saveAsset")}>
              <IconButton
                icon={<Icon name="folder-add-left" size="small" />}
                variant="ghost-muted"
                size="small"
                aria-label={ctx.t("response.saveAsset")}
                aria-busy={pending()}
                disabled={
                  pending() ||
                  !input.session.server.connected ||
                  !input.session.server.compatible ||
                  !input.session.location
                }
                onClick={() => void capture()}
              />
            </Tooltip>
          </Show>
          <For each={proposals().map((proposal) => proposal.key)}>
            {(key) => (
              <Show when={proposals().find((proposal) => proposal.key === key)}>
                {(proposal) => (
                  <Tooltip
                    value={ctx.t(proposal().module === "main" ? "panel.title" : `${proposal().module}.panel.title`)}
                  >
                    <IconButton
                      icon={<Icon name={icons[proposal().module]} size="small" />}
                      variant="ghost-muted"
                      size="small"
                      aria-label={ctx.t(
                        proposal().module === "main" ? "panel.title" : `${proposal().module}.panel.title`,
                      )}
                      disabled={pending()}
                      onClick={() => void openProposal(proposal())}
                    />
                  </Tooltip>
                )}
              </Show>
            )}
          </For>
        </>
      )
    },
  })

  async function openSourcePanel(id: (typeof modules)[number]) {
    const source = ctx.sessions.current()

    if (!source || !ctx.screen.current()) return

    try {
      await ctx.stores.responses(source).update((draft) => {
        delete draft.targets[kinds[id]]
      })

      if (ctx.signal.aborted) return
      ctx.layout.open(`${ctx.id}:${id}`, source)
    } catch (error) {
      if (ctx.signal.aborted) return
      showToast({
        variant: "error",
        title: ctx.t("response.openError"),
        description: errorMessage(error, ctx.t("common.requestFailed")),
      })
    }
  }

  // Other modes offer only proposal kinds already produced in this session. Read tool names once
  // without loading the proposal parser or UI chunk on the startup path.
  const proposed = createMemo(() => {
    const session = ctx.sessions.current()

    if (!session || session.server.data.session.get(session.id)?.mode === "chat") return new Set<string>()

    return new Set(
      session.server.data.session.message
        .list(session.id)
        .flatMap((message) =>
          message.type === "assistant"
            ? message.content.flatMap((part) =>
                part.type === "tool" && part.state.status === "completed" ? [part.name] : [],
              )
            : [],
        ),
    )
  })

  const available = (id: (typeof modules)[number]) => {
    const session = ctx.sessions.current()

    if (!display.value[id] || !session || !ctx.screen.current()) return false

    return session.server.data.session.get(session.id)?.mode === "chat" || proposed().has(`propose_${kinds[id]}_asset`)
  }

  ctx.add(SettingsPage, {
    id: "display",
    page: "general",
    section: "general",
    get title() {
      return ctx.t("settings.title")
    },
    get entries() {
      return modules.map((id) => ({ id: `show-${id}`, title: ctx.t(`show.${id}`) }))
    },
    render: () => (
      <For each={modules}>
        {(id) => (
          <div data-component="settings-row">
            <div data-slot="settings-row-copy">
              <div data-slot="settings-row-title">{ctx.t(`show.${id}`)}</div>
            </div>
            <div data-slot="settings-row-control">
              <Switch
                aria-label={ctx.t(`show.${id}`)}
                checked={display.value[id]}
                hideLabel
                onChange={(checked) =>
                  display.update((draft) => {
                    draft[id] = checked
                  })
                }
              >
                {ctx.t(`show.${id}`)}
              </Switch>
            </div>
          </div>
        )}
      </For>
    ),
  })
  const SkillProposalsPanel = lazy(() => import("./panel"))

  const renderPanel = (props: PanelProps, id: (typeof modules)[number]) => {
    const stored = () => ctx.stores.responses(props.session)
    const binding = () => stored().value?.targets[kinds[id]]

    const target = createMemo(() => {
      if (!stored().ready() || !stored().value) return undefined
      const selected = binding()

      if (!selected) return props.session
      const server = ctx.servers.get(selected.serverID)

      return server ? ctx.sessions.target({ server, sessionID: selected.sessionID }) : undefined
    })

    const owner = createMemo(
      () => {
        const selected = target()

        if (!selected || !selected.server.connected || !selected.server.compatible) return undefined

        return {
          key: selected.key,
          id: selected.id,
          data: selected.server.data,
          client: selected.server.client,
          attempt: selected.server.attempt,
          token: Symbol(),
        }
      },
      undefined,
      {
        equals: (previous, next) =>
          previous?.key === next?.key &&
          previous?.id === next?.id &&
          previous?.data === next?.data &&
          previous?.client === next?.client &&
          previous?.attempt === next?.attempt,
      },
    )

    const loaded = createLatest(owner, async (selected, signal) => {
      // The shared Data reads join existing loads and reuse settled caches, even without another target view.
      await Promise.all([selected.data.session.readback(selected.id), selected.data.session.message.sync(selected.id)])

      if (signal.aborted || ctx.signal.aborted) return undefined

      return selected.token
    })

    // createLatest retains its old result; only this target/client/attempt may settle the candidate list.
    const ready = createMemo(() =>
      owner() && !loaded.loading && loaded.error === undefined && loaded.latest === owner()?.token
        ? target()
        : undefined,
    )

    return (
      <Suspense>
        <Show
          when={ready()}
          fallback={
            <p role="status">
              {ctx.t(
                !stored().ready() || (owner() && loaded.error === undefined)
                  ? "response.loading"
                  : "response.unavailable",
              )}
            </p>
          }
        >
          {(target) => (
            <SkillProposalsPanel {...props} kind={kinds[id]} target={target()} candidateKey={binding()?.candidateKey} />
          )}
        </Show>
      </Suspense>
    )
  }

  onCleanup(onIdle(() => void SkillProposalsPanel.preload()))
  // Restored side tabs need the chunk as soon as their Location-backed layout becomes available.
  createKeyed(
    () =>
      ctx.sessions
        .list()
        .some((session) =>
          ctx.layout
            .stored(session)
            .some(
              (id) =>
                id === "main" ||
                id === "commands" ||
                id === "prompts" ||
                id === "agents" ||
                id === "mcps" ||
                id === "plugins" ||
                id === "workflows",
            ),
        ),
    () => void SkillProposalsPanel.preload(),
  )

  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("panel.title")
    },
    draggable: false,
    closable: "compact",
    dom: { tab: "session-side-panel-skill-proposals-tab", panel: "skill-proposals-panel" },
  }

  const commands: PanelTab = {
    id: "commands",
    get title() {
      return ctx.t("commands.panel.title")
    },
    draggable: false,
    closable: "compact",
    dom: { tab: "session-side-panel-command-proposals-tab", panel: "command-proposals-panel" },
  }

  const prompts: PanelTab = {
    id: "prompts",
    get title() {
      return ctx.t("prompts.panel.title")
    },
    draggable: false,
    closable: "compact",
    dom: { tab: "session-side-panel-prompt-proposals-tab", panel: "prompt-proposals-panel" },
  }

  const agents: PanelTab = {
    id: "agents",
    get title() {
      return ctx.t("agents.panel.title")
    },
    draggable: false,
    closable: "compact",
    dom: { tab: "session-side-panel-agent-proposals-tab", panel: "agent-proposals-panel" },
  }

  const mcps: PanelTab = {
    id: "mcps",
    get title() {
      return ctx.t("mcps.panel.title")
    },
    draggable: false,
    closable: "compact",
    dom: { tab: "session-side-panel-mcp-proposals-tab", panel: "mcp-proposals-panel" },
  }

  const plugins: PanelTab = {
    id: "plugins",
    get title() {
      return ctx.t("plugins.panel.title")
    },
    draggable: false,
    closable: "compact",
    dom: { tab: "session-side-panel-plugin-proposals-tab", panel: "plugin-proposals-panel" },
  }

  const workflows: PanelTab = {
    id: "workflows",
    get title() {
      return ctx.t("workflows.panel.title")
    },
    draggable: false,
    closable: "compact",
    dom: { tab: "session-side-panel-workflow-proposals-tab", panel: "workflow-proposals-panel" },
  }

  ctx.add(Style, css)
  ;(
    [
      { id: "main", command: "open", title: "command.title", order: 45 },
      { id: "commands", command: "open-command", title: "commands.command.title", order: 46 },
      { id: "prompts", command: "open-prompt", title: "prompts.command.title", order: 47 },
      { id: "agents", command: "open-agent", title: "agents.command.title", order: 48 },
      { id: "mcps", command: "open-mcp", title: "mcps.command.title", order: 49 },
      { id: "plugins", command: "open-plugin", title: "plugins.command.title", order: 50 },
      { id: "workflows", command: "open-workflow", title: "workflows.command.title", order: 51 },
    ] as const
  ).forEach((item) => {
    const menu: MenuItem = {
      menu: "session.panel",
      id: item.id,
      get title() {
        return ctx.t(item.title)
      },
      order: item.order,
      icon: icons[item.id],
      keybind: ctx.id + "." + item.command,
      run() {
        void openSourcePanel(item.id)
      },
    }

    ctx.add(MenuItem, () => {
      return available(item.id) ? menu : undefined
    })
  })
  ctx.add(
    Command,
    (): Command => ({
      id: "open",
      title: ctx.t("command.title"),
      description: ctx.t("command.description"),
      group: ctx.t("command.group"),
      section: "session",
      bind: "mod+alt+shift+s",
      enabled: available("main"),
      run: () => void openSourcePanel("main"),
    }),
  )
  ctx.add(
    Command,
    (): Command => ({
      id: "open-command",
      title: ctx.t("commands.command.title"),
      description: ctx.t("commands.command.description"),
      group: ctx.t("command.group"),
      section: "session",
      bind: "mod+alt+shift+c",
      enabled: available("commands"),
      run: () => void openSourcePanel("commands"),
    }),
  )
  ctx.add(Panel, (): Panel | undefined =>
    display.value.main
      ? {
          id: "main",
          region: "side",
          mobile: { title: ctx.t("panel.title"), order: 45, kind: "menu", icon: icons.main },
          list: (input) => (input.open.includes("main") ? [tab] : []),
          render: (props) => renderPanel(props, "main"),
        }
      : undefined,
  )
  ctx.add(Panel, (): Panel | undefined =>
    display.value.commands
      ? {
          id: "commands",
          region: "side",
          mobile: { title: ctx.t("commands.panel.title"), order: 46, kind: "menu", icon: icons.commands },
          list: (input) => (input.open.includes("commands") ? [commands] : []),
          render: (props) => renderPanel(props, "commands"),
        }
      : undefined,
  )
  ctx.add(
    Command,
    (): Command => ({
      id: "open-prompt",
      title: ctx.t("prompts.command.title"),
      description: ctx.t("prompts.command.description"),
      group: ctx.t("command.group"),
      section: "session",
      bind: "mod+alt+shift+p",
      enabled: available("prompts"),
      run: () => void openSourcePanel("prompts"),
    }),
  )
  ctx.add(Panel, (): Panel | undefined =>
    display.value.prompts
      ? {
          id: "prompts",
          region: "side",
          mobile: { title: ctx.t("prompts.panel.title"), order: 47, kind: "menu", icon: icons.prompts },
          list: (input) => (input.open.includes("prompts") ? [prompts] : []),
          render: (props) => renderPanel(props, "prompts"),
        }
      : undefined,
  )
  ctx.add(
    Command,
    (): Command => ({
      id: "open-agent",
      title: ctx.t("agents.command.title"),
      description: ctx.t("agents.command.description"),
      group: ctx.t("command.group"),
      section: "session",
      bind: "mod+alt+shift+a",
      enabled: available("agents"),
      run: () => void openSourcePanel("agents"),
    }),
  )
  ctx.add(Panel, (): Panel | undefined =>
    display.value.agents
      ? {
          id: "agents",
          region: "side",
          mobile: { title: ctx.t("agents.panel.title"), order: 48, kind: "menu", icon: icons.agents },
          list: (input) => (input.open.includes("agents") ? [agents] : []),
          render: (props) => renderPanel(props, "agents"),
        }
      : undefined,
  )
  ctx.add(
    Command,
    (): Command => ({
      id: "open-mcp",
      title: ctx.t("mcps.command.title"),
      description: ctx.t("mcps.command.description"),
      group: ctx.t("command.group"),
      section: "session",
      bind: "mod+alt+shift+m",
      enabled: available("mcps"),
      run: () => void openSourcePanel("mcps"),
    }),
  )
  ctx.add(Panel, (): Panel | undefined =>
    display.value.mcps
      ? {
          id: "mcps",
          region: "side",
          mobile: { title: ctx.t("mcps.panel.title"), order: 49, kind: "menu", icon: icons.mcps },
          list: (input) => (input.open.includes("mcps") ? [mcps] : []),
          render: (props) => renderPanel(props, "mcps"),
        }
      : undefined,
  )
  ctx.add(
    Command,
    (): Command => ({
      id: "open-plugin",
      title: ctx.t("plugins.command.title"),
      description: ctx.t("plugins.command.description"),
      group: ctx.t("command.group"),
      section: "session",
      bind: "mod+alt+shift+e",
      enabled: available("plugins"),
      run: () => void openSourcePanel("plugins"),
    }),
  )
  ctx.add(Panel, (): Panel | undefined =>
    display.value.plugins
      ? {
          id: "plugins",
          region: "side",
          mobile: { title: ctx.t("plugins.panel.title"), order: 50, kind: "menu", icon: icons.plugins },
          list: (input) => (input.open.includes("plugins") ? [plugins] : []),
          render: (props) => renderPanel(props, "plugins"),
        }
      : undefined,
  )
  ctx.add(
    Command,
    (): Command => ({
      id: "open-workflow",
      title: ctx.t("workflows.command.title"),
      description: ctx.t("workflows.command.description"),
      group: ctx.t("command.group"),
      section: "session",
      bind: "mod+alt+shift+w",
      enabled: available("workflows"),
      run: () => void openSourcePanel("workflows"),
    }),
  )
  ctx.add(Panel, (): Panel | undefined =>
    display.value.workflows
      ? {
          id: "workflows",
          region: "side",
          mobile: { title: ctx.t("workflows.panel.title"), order: 51, kind: "menu", icon: icons.workflows },
          list: (input) => (input.open.includes("workflows") ? [workflows] : []),
          render: (props) => renderPanel(props, "workflows"),
        }
      : undefined,
  )
}

export default setup
