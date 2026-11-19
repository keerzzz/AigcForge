import { SessionProgressIndicatorV2 } from "./session-progress-indicator-v2"
import { createSignal, onCleanup, onMount } from "solid-js"
import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@aigcfroge/ui/icon"
import { Button } from "@aigcfroge/ui/button"
import { IconButton } from "@aigcfroge/ui/icon-button"
import { useTheme, oc2Theme } from "@aigcfroge/ui/theme"
import { BasicTool } from "../../components/basic-tool"

const docs = `### Overview
Single-arc vector indicator for actual in-progress session state.

### API
- Accepts standard SVG props.

### Behavior
- One arc rotates in a fixed viewport (1.2s loop); the action icon remains separate.
- Consumers mount it only during real execution. Reduced motion retains a static ring and arc.

### Accessibility
- Sets \`aria-hidden="true"\` by default.

### Theming
- Uses \`currentColor\` via \`--v2-icon-icon-base\`; standard light, dark and custom themes use their existing tokens.
`

export default {
  title: "AigcForge/Status/Session progress",
  id: "components-session-progress-indicator-v2",
  component: SessionProgressIndicatorV2,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => <SessionProgressIndicatorV2 />,
}

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
      <SessionProgressIndicatorV2 width={12} height={12} />
      <SessionProgressIndicatorV2 />
      <SessionProgressIndicatorV2 width={24} height={24} />
    </div>
  ),
}

export const Lifecycle = {
  render: () => {
    const theme = useTheme()
    theme.registerTheme({
      ...oc2Theme,
      id: "icon-fallback",
      name: "Custom fallback",
      light: { ...oc2Theme.light, v2Overrides: undefined },
      dark: { ...oc2Theme.dark, v2Overrides: undefined },
    })
    const [state, setState] = createStore({ status: "running", hidden: false })
    return (
      <div
        style={{
          display: "grid",
          gap: "16px",
          "max-width": "640px",
          "min-width": "0",
          color: "var(--v2-text-text-base)",
        }}
      >
        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <select
            aria-label="Theme"
            value={theme.themeId()}
            onChange={(event) => theme.setTheme(event.currentTarget.value)}
          >
            <For each={theme.ids()}>{(id) => <option value={id}>{theme.name(id)}</option>}</For>
          </select>
          <Button onClick={() => theme.setColorScheme("light")}>Light</Button>
          <Button onClick={() => theme.setColorScheme("dark")}>Dark</Button>
        </div>
        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <For each={["running", "waiting", "completed", "failed", "cancelled"]}>
            {(status) => (
              <Button aria-pressed={state.status === status} onClick={() => setState("status", status)}>
                {status}
              </Button>
            )}
          </For>
          <Button aria-pressed={state.hidden} onClick={() => setState("hidden", !state.hidden)}>
            Hide indicator
          </Button>
        </div>
        <div hidden={state.hidden} style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <Show
            when={state.status === "running"}
            fallback={
              <Icon
                name={
                  state.status === "completed"
                    ? "circle-check"
                    : state.status === "failed"
                      ? "circle-x"
                      : "circle-exclamation"
                }
              />
            }
          >
            <SessionProgressIndicatorV2 />
          </Show>
          <span role="status">Session {state.status}</span>
        </div>
        <BasicTool
          icon="task"
          status={state.status}
          allowOpenWhilePending
          animated
          trigger={{
            title: state.status === "running" ? "Running task" : "Task " + state.status,
            subtitle: "src/index.ts",
          }}
        >
          <p>Task details: inspect the actual result before accepting completion.</p>
        </BasicTool>
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <IconButton variant="ghost-muted" icon={<Icon name="subagent" />} aria-label="Inspect subagent" />
          <Button variant="ghost-muted" icon="task">
            Inspect task
          </Button>
          <Button disabled>Unavailable</Button>
        </div>
      </div>
    )
  },
}

export const StressTest = {
  parameters: {
    layout: "fullscreen",
  },
  render: () => <StressGrid />,
}

function StressGrid() {
  const measure = () => ({
    columns: Math.max(1, Math.floor((window.innerWidth + 4) / 20)),
    rows: Math.max(1, Math.floor((window.innerHeight + 4) / 20)),
  })

  const [grid, setGrid] = createSignal(measure())
  const resize = () => setGrid(measure())
  onMount(() => window.addEventListener("resize", resize))
  onCleanup(() => window.removeEventListener("resize", resize))

  return (
    <div
      style={{
        display: "grid",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        gap: "4px",
        "grid-template-columns": `repeat(${grid().columns}, 16px)`,
        "grid-template-rows": `repeat(${grid().rows}, 16px)`,
        "place-content": "center",
      }}
    >
      {Array.from({ length: grid().columns * grid().rows }, () => (
        <SessionProgressIndicatorV2 />
      ))}
    </div>
  )
}

export const OnDark = {
  globals: { theme: "dark" },
  render: () => <SessionProgressIndicatorV2 />,
}
