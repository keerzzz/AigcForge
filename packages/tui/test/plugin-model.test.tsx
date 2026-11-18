import { expect, test } from "bun:test"
import { createPluginContext, type Registry, type usePluginHost } from "../src/plugin/api"
import { model, renderLocal } from "./fixture/local"

// Eagerly read host services need a shape; model access goes through the real LocalProvider.
function pluginModel(local: ReturnType<typeof usePluginHost>["local"]) {
  const host = {
    app: {},
    client: {},
    keymap: {},
    shortcuts: {},
    keymapState: {},
    sessionTabs: {},
    local,
  } as unknown as ReturnType<typeof usePluginHost>
  const registry: Registry = { has: () => false, set() {}, remove() {}, active: () => true }
  return createPluginContext({ host, id: "test", options: undefined, owned: [], registry }).ui.model
}

test("plugins read and select variants of the selected model", async () => {
  await using setup = await renderLocal({ models: [model("first", ["low", "high"])] })
  const selected = pluginModel(setup.local)

  expect(selected.current()).toEqual({ providerID: "provider", modelID: "first", variant: undefined })
  expect(selected.variant.list()).toEqual(["low", "high"])

  expect(selected.variant.set("high")).toBe(true)
  expect(selected.current()?.variant).toBe("high")
  expect(setup.local.model.variant.current()).toBe("high")

  expect(selected.variant.set(undefined)).toBe(true)
  expect(selected.current()?.variant).toBeUndefined()
})

test("plugins cannot select unavailable variants or variants without a model", async () => {
  await using setup = await renderLocal({ models: [model("first", ["low", "high"])] })
  const selected = pluginModel(setup.local)
  expect(selected.variant.set("max")).toBe(false)
  expect(selected.current()?.variant).toBeUndefined()

  await using empty = await renderLocal({ models: [] })
  const none = pluginModel(empty.local)
  expect(none.current()).toBeUndefined()
  expect(none.variant.list()).toEqual([])
  expect(none.variant.set(undefined)).toBe(false)
})

test("TUI selects and remembers Groups while legacy plugin model access keeps its physical contract", async () => {
  const group = { type: "group" as const, groupID: "fallback" }
  await using setup = await renderLocal({
    groups: {
      targets: [],
      definitions: [],
      defaultSelection: group,
      effective: [
        {
          groupID: group.groupID,
          definition: {
            name: "Fast fallback",
            enabled: true,
            members: [{ providerID: "provider", id: "first" }],
            strategy: "order",
            affinity: "turn",
          },
        },
      ],
    },
  })
  setup.local.model.set(group, { recent: true })
  expect(setup.local.model.current()).toEqual(group)
  expect(setup.local.model.selection()).toEqual(group)
  expect(setup.local.model.parsed()).toEqual({ provider: "Model group", model: "Fast fallback", reasoning: false })
  expect(setup.local.model.variant.list()).toEqual([])
  setup.local.model.variant.set("high")
  expect(setup.local.model.selection()).toEqual(group)
  expect(pluginModel(setup.local).current()).toBeUndefined()
  expect(pluginModel(setup.local).variant.set(undefined)).toBe(false)
  setup.local.model.toggleFavorite(group)
  expect(setup.local.model.favorite()).toEqual([group])
  expect(setup.local.model.recent()).toEqual([group])
})
