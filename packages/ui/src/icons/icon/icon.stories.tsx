import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon, type IconProps } from "./icon"
import { iconNames } from "../catalog"
import { Button } from "@aigcfroge/ui/button"

const names = iconNames() satisfies IconProps["name"][]

export default {
  title: "UI/Icon",
  id: "ui-icon",
  component: Icon,
  tags: ["autodocs"],
  args: {
    name: "check",
    size: "normal",
  },
  argTypes: {
    name: { control: "select", options: names },
    size: { control: "select", options: ["small", "normal", "large"] },
  },
}

export const Playground = {}

export const Sizes = {
  render: () => (
    <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
      <Icon name="check" size="small" />
      <Icon name="check" size="normal" />
      <Icon name="check" size="large" />
    </div>
  ),
}

export const Directional = {
  render: () => (
    <div style={{ display: "grid", gap: "12px" }}>
      <div dir="ltr" style={{ display: "flex", gap: "8px" }}>
        <Icon name="arrow-left" />
        <Icon name="arrow-right" />
      </div>
      <div dir="rtl" style={{ display: "flex", gap: "8px" }}>
        <Icon name="arrow-left" />
        <Icon name="arrow-right" />
      </div>
    </div>
  ),
}

export const Gallery = {
  render: () => {
    const [state, setState] = createStore({ query: "" })
    const matches = () => names.filter((name) => name.includes(state.query.toLowerCase()))
    return (
      <div style={{ display: "grid", gap: "16px", "min-width": "0" }}>
        <input
          aria-label="Search icons"
          placeholder="Search icons"
          value={state.query}
          onInput={(event) => setState("query", event.currentTarget.value)}
          style={{
            width: "100%",
            padding: "8px",
            color: "var(--v2-text-text-base)",
            background: "var(--v2-background-bg-layer-02)",
            border: "1px solid var(--v2-border-border-base)",
            "border-radius": "4px",
          }}
        />
        <div
          style={{
            display: "grid",
            gap: "12px",
            "grid-template-columns": "repeat(auto-fill, minmax(min(120px, 100%), 1fr))",
          }}
        >
          <For each={matches()}>
            {(name) => (
              <div style={{ display: "grid", gap: "8px", "justify-items": "center", "min-width": "0" }}>
                <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
                  <Icon name={name} size="small" />
                  <Icon name={name} />
                  <Icon name={name} size="large" />
                </div>
                <span
                  style={{
                    "font-size": "12px",
                    color: "var(--v2-text-text-base)",
                    "text-align": "center",
                    "overflow-wrap": "anywhere",
                  }}
                >
                  {name}
                </span>
              </div>
            )}
          </For>
        </div>
        <Show when={matches().length === 0}>
          <p role="status">No matching icons.</p>
          <Button onClick={() => setState("query", "")}>Clear search</Button>
        </Show>
      </div>
    )
  },
}
