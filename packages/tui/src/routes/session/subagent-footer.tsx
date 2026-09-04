import { createMemo, createSignal, For, Show } from "solid-js"
import { useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { useRoute } from "../../context/route"
import { SplitBorder } from "../../ui/border"
import type { AssistantMessage } from "@aigcfroge/sdk/v2"
import { Locale } from "../../util/locale"
import { useTerminalDimensions } from "@opentui/solid"
import { useCommandShortcut, useAigcfrogeKeymap } from "../../keymap"
import { executeHandoff, handoffAuthorizationKey, planHandoff } from "@aigcfroge/schema/handoff"
import { useToast } from "../../ui/toast"
import { useDialog } from "../../ui/dialog"
import { useKV } from "../../context/kv"
import { DialogConfirm } from "../../ui/dialog-confirm"

export function SubagentFooter() {
  const route = useRouteData("session")
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()
  const kv = useKV()
  const { navigate } = useRoute()
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const session = createMemo(() => sync.session.get(route.sessionID))

  const subagentInfo = createMemo(() => {
    const s = session()
    if (!s) return { label: "Subagent", index: 0, total: 0 }
    const agentMatch = s.title.match(/@(\w+) subagent/)
    const label = agentMatch ? Locale.titlecase(agentMatch[1]) : "Subagent"

    if (!s.parentID) return { label, index: 0, total: 0 }

    const siblings = sync.data.session
      .filter((x) => x.parentID === s.parentID)
      .toSorted((a, b) => a.time.created - b.time.created)
    const index = siblings.findIndex((x) => x.id === s.id)

    return { label, index: index + 1, total: siblings.length }
  })

  const usage = createMemo(() => {
    const msg = messages()
    const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return

    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const pct = model?.limit.context ? `${Math.round((tokens / model.limit.context) * 100)}%` : undefined
    const cost = session()?.cost ?? 0

    const money = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    })

    return {
      context: pct ? `${Locale.number(tokens)} (${pct})` : Locale.number(tokens),
      cost: cost > 0 ? money.format(cost) : undefined,
    }
  })

  const currentAgentName = createMemo(() => {
    const msgs = messages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.role === "user" && msg.agent) return msg.agent
    }
    return undefined
  })

  const handoffActions = createMemo<{ label: string; agent: string; prompt: string; send?: boolean }[]>(() => {
    const name = currentAgentName()
    if (!name) return []
    const agent = sync.data.agent.find((a) => a.name === name)
    return (agent?.handoffs ?? []).filter((h) => h.label && h.agent && h.prompt)
  })

  // Remembered handoff grants (S6 "always"). One flat list is enough because the
  // grant key already carries the Location, so a grant made in one project cannot
  // match a handoff in another — the mistake `custom-draft`'s single global key
  // made was storing project-scoped data under one key, not storing keys that
  // name their own scope.
  const GRANTS_KEY = "handoff.grants.v1"
  const grants = () => {
    // `kv.get` is `any`-typed by design (it fronts a JSON file), so narrow here
    // rather than assert: a hand-edited kv.json must not crash the footer.
    const stored: unknown = kv.get(GRANTS_KEY, [])
    return new Set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [])
  }
  const remember = (key: string) => {
    const next = grants()
    next.add(key)
    kv.set(GRANTS_KEY, [...next])
  }

  const handleHandoff = async (label: string, agent: string, prompt: string, send?: boolean) => {
    const sessionID = route.sessionID
    if (!sessionID) return

    // D13 (S3): handoff = switchAgent + prompt on the SAME session (no fork, no
    // navigation). The plan is computed from the PRE-switch state and decides
    // whether the switch may happen at all — see @aigcfroge/schema/handoff.
    const current = session()
    const agents = sync.data.agent ?? []
    const location = current?.directory ?? ""
    const context = { mode: current?.mode, tier: current?.permissionTier, attended: current?.attended } as const
    const currentRules = agents.find((a) => a.name === current?.agent)?.permission ?? []
    const targetRules = agents.find((a) => a.name === agent)?.permission ?? []
    const plan = planHandoff({
      session: context,
      currentAgent: current?.agent,
      targetAgent: agent,
      currentRules,
      targetRules,
      send,
      location,
      label,
      prompt,
      authorized: grants(),
    })

    try {
      await executeHandoff(plan, {
        // One request carries the switch and the message (S2): two calls would
        // leave the session switched with nothing sent when the second fails.
        submit: async () => {
          await sdk.client.v2.session.prompt({
            sessionID,
            agent,
            prompt: { text: prompt },
            delivery: "steer",
            resume: true,
          })
        },
        switchAgent: async () => {
          await sdk.client.v2.session.switchAgent({ sessionID, agent })
        },
        prefill: () =>
          navigate({ type: "session", sessionID, prompt: { input: prompt, parts: [{ type: "text", text: prompt }] } }),
        confirm: async () => {
          const answer = await DialogConfirm.showWithRemember(
            dialog,
            "This handoff widens permissions",
            `${agent} is allowed to do things this session currently is not. Switch to it for this handoff?`,
            "Remember for this handoff",
            "switch",
          )
          if (answer?.confirmed !== true) return false
          // Recorded only after an affirmative answer, so a dismissal never
          // leaves a grant behind.
          if (answer.remember)
            remember(
              handoffAuthorizationKey({
                location,
                session: context,
                sourceAgent: current?.agent,
                label,
                targetAgent: agent,
                prompt,
                currentRules,
                targetRules,
              }),
            )
          return true
        },
        reject: () => toast.show({ message: "Handoff cancelled — agent unchanged", variant: "info" }),
      })
    } catch {
      toast.show({ message: `Handoff to ${agent} failed`, variant: "error" })
    }
  }

  const { theme } = useTheme()
  const keymap = useAigcfrogeKeymap()
  const parentShortcut = useCommandShortcut("session.parent")
  const previousShortcut = useCommandShortcut("session.child.previous")
  const nextShortcut = useCommandShortcut("session.child.next")
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)
  const [handoffHover, setHandoffHover] = createSignal<number | null>(null)
  useTerminalDimensions()

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <box flexDirection="column" gap={0}>
          <box flexDirection="row" justifyContent="space-between" gap={1}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.text}>
                <b>{subagentInfo().label}</b>
              </text>
              <Show when={subagentInfo().total > 0}>
                <text style={{ fg: theme.textMuted }}>
                  ({subagentInfo().index} of {subagentInfo().total})
                </text>
              </Show>
              <Show when={usage()}>
                {(item) => (
                  <text fg={theme.textMuted} wrapMode="none">
                    {[item().context, item().cost].filter(Boolean).join(" · ")}
                  </text>
                )}
              </Show>
            </box>
            <box flexDirection="row" gap={2}>
              <box
                onMouseOver={() => setHover("parent")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => keymap.dispatchCommand("session.parent")}
                backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={theme.text}>
                  Parent <span style={{ fg: theme.textMuted }}>{parentShortcut()}</span>
                </text>
              </box>
              <box
                onMouseOver={() => setHover("prev")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => keymap.dispatchCommand("session.child.previous")}
                backgroundColor={hover() === "prev" ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={theme.text}>
                  Prev <span style={{ fg: theme.textMuted }}>{previousShortcut()}</span>
                </text>
              </box>
              <box
                onMouseOver={() => setHover("next")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => keymap.dispatchCommand("session.child.next")}
                backgroundColor={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={theme.text}>
                  Next <span style={{ fg: theme.textMuted }}>{nextShortcut()}</span>
                </text>
              </box>
            </box>
          </box>
          <Show when={handoffActions().length > 0}>
            <box flexDirection="row" gap={1} paddingTop={1}>
              <text fg={theme.textMuted}>&#8594;</text>
              <For each={handoffActions()}>
                {(action, index) => (
                  <box
                    onMouseOver={() => setHandoffHover(index())}
                    onMouseOut={() => setHandoffHover(null)}
                    onMouseUp={() => handleHandoff(action.label, action.agent, action.prompt, action.send)}
                    backgroundColor={handoffHover() === index() ? theme.backgroundElement : theme.backgroundPanel}
                  >
                    <text fg={theme.text}>{action.label}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>
      </box>
    </box>
  )
}
