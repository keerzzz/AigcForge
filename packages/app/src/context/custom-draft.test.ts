import { afterEach, describe, expect, test } from "bun:test"
import { createComponent, createEffect, createRoot, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { PlatformProvider } from "./platform"
import {
  CustomDraftProvider,
  DEFAULT_DRAFT,
  useCustomDraft,
  type CustomDraftLocation,
  type CustomDraftStore,
} from "./custom-draft"
import { DRAFT_PERSIST_KEY } from "./custom-draft-location"
import { Persist } from "@/utils/persist"
import { ServerScope } from "@/utils/server-scope"

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()))

const a = { scope: ServerScope.local, directory: "/custom-provider/a" }
const b = { scope: ServerScope.local, directory: "/custom-provider/b" }

function mountDraft(
  input: {
    location?: CustomDraftLocation
    pending?: Map<string, Promise<string | null>>
    seed?: boolean
  } = {},
) {
  const [state, setState] = createStore<{ location: CustomDraftLocation | undefined }>({
    location: input.location ? { ...input.location } : undefined,
  })
  const storage = new Map<string | undefined, Map<string, string>>()
  ;(input.seed === false ? [] : [a, b]).forEach((location) => {
    const target = Persist.serverWorkspace(location.scope, location.directory, DRAFT_PERSIST_KEY)
    storage.set(
      target.storage,
      new Map([[target.key, JSON.stringify({ ...DEFAULT_DRAFT, title: location.directory })]]),
    )
  })
  const owners: Array<{ name: string; disposed: boolean }> = []
  const probe: { draft?: ReturnType<typeof useCustomDraft>; mounts: number; cleanups: number } = {
    mounts: 0,
    cleanups: 0,
  }
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(
    () =>
      createComponent(PlatformProvider, {
        value: {
          platform: "desktop",
          openLink() {},
          restart: async () => {},
          back() {},
          forward() {},
          notify: async () => {},
          openDirectoryPickerDialog: async () => null,
          storage(name) {
            if (name?.startsWith("aigcfroge.workspace.")) {
              // Register at the actual persisted-store boundary, so a leaked
              // store owner fails without replacing the production factory.
              const owner = { name, disposed: false }
              owners.push(owner)
              onCleanup(() => {
                owner.disposed = true
              })
            }
            return {
              async getItem(key: string) {
                return (name && input.pending?.get(name)) || storage.get(name)?.get(key) || null
              },
              async setItem(key: string, value: string) {
                const values = storage.get(name) ?? new Map<string, string>()
                values.set(key, value)
                storage.set(name, values)
              },
              async removeItem(key: string) {
                storage.get(name)?.delete(key)
              },
            }
          },
        },
        get children() {
          return createComponent(CustomDraftProvider, {
            location: () => state.location,
            get children() {
              return createComponent(() => {
                const draft = useCustomDraft()
                probe.draft = draft
                probe.mounts += 1
                onCleanup(() => {
                  probe.cleanups += 1
                })
                const node = document.createElement("output")
                createEffect(() => {
                  node.textContent = draft().state.title
                })
                return node
              }, {})
            },
          })
        },
      }),
    container,
  )
  cleanups.push(() => {
    dispose()
    container.remove()
  })
  return {
    container,
    owners,
    probe,
    dispose,
    current() {
      if (!probe.draft) throw new Error("Custom draft consumer did not mount")
      return probe.draft()
    },
    location(location: CustomDraftLocation | undefined) {
      setState("location", location ? { ...location } : undefined)
    },
  }
}

function titleReady(store: CustomDraftStore, title: string) {
  return new Promise<void>((resolve) => {
    createRoot((dispose) => {
      cleanups.push(dispose)
      createEffect(() => {
        if (store.state.title !== title) return
        dispose()
        resolve()
      })
    })
  })
}

describe("CustomDraftProvider lifecycle", () => {
  test("unseeded projects keep nested selections isolated across A-B-A", async () => {
    const fixture = mountDraft({ location: a, seed: false })
    const first = fixture.current()
    first.setTitle("selected A")
    first.addAgent({ kind: "agent", relativePath: "agent-a.md", revision: "a" })
    first.togglePrompt("orchestrator", { kind: "prompt", relativePath: "prompt-a.md", revision: "a" })
    first.toggleSkill("orchestrator", { kind: "skill", relativePath: "skill-a", revision: "a" })
    first.toggleCommand("orchestrator", { kind: "command", relativePath: "command-a.md", revision: "a" })
    first.toggleCapability("capability-a")

    fixture.location(b)
    expect(a.directory).toBe("/custom-provider/a")
    expect(b.directory).toBe("/custom-provider/b")
    expect(fixture.current().state.agents).toEqual([])
    expect(fixture.current().state.bindings).toEqual({})
    expect(fixture.current().state.requestedCapabilities).toEqual([])
    fixture.current().setTitle("selected B")
    fixture.current().addAgent({ kind: "agent", relativePath: "agent-b.md", revision: "b" })
    fixture.current().toggleCapability("capability-b")

    fixture.location(a)
    await titleReady(fixture.current(), "selected A")
    expect(fixture.current().state.agents.map((agent) => agent.relativePath)).toEqual(["agent-a.md"])
    expect(fixture.current().state.bindings.orchestrator).toEqual({
      prompts: [{ kind: "prompt", relativePath: "prompt-a.md", revision: "a" }],
      skills: [{ kind: "skill", relativePath: "skill-a", revision: "a" }],
      commands: [{ kind: "command", relativePath: "command-a.md", revision: "a" }],
    })
    expect(fixture.current().state.requestedCapabilities).toEqual(["capability-a"])
    fixture.location(b)
    await titleReady(fixture.current(), "selected B")
    expect(fixture.current().state.agents.map((agent) => agent.relativePath)).toEqual(["agent-b.md"])
    expect(fixture.current().state.bindings).toEqual({})
    expect(fixture.current().state.requestedCapabilities).toEqual(["capability-b"])
    expect(fixture.probe.mounts).toBe(1)
  })

  test("keeps its child mounted through unresolved, equivalent and A-B-A Locations", async () => {
    const fixture = mountDraft()
    const node = fixture.container.firstChild
    const unresolved = fixture.current()
    unresolved.setTitle("unscoped draft")
    fixture.location({ scope: a.scope, directory: "" })
    expect(fixture.current()).toBe(unresolved)

    fixture.location(a)
    const first = fixture.current()
    await titleReady(first, a.directory)
    first.setTitle("edited A")
    fixture.location({ ...a, directory: `${a.directory}/` })
    expect(fixture.current()).toBe(first)
    expect(fixture.owners).toHaveLength(1)
    expect(fixture.owners[0]?.disposed).toBe(false)

    fixture.location(b)
    await titleReady(fixture.current(), b.directory)
    expect(fixture.current()).not.toBe(first)
    fixture.current().setTitle("edited B")
    fixture.location(a)
    await titleReady(fixture.current(), "edited A")
    expect(fixture.current()).not.toBe(first)
    fixture.location(b)
    await titleReady(fixture.current(), "edited B")

    expect(fixture.container.firstChild).toBe(node)
    expect(fixture.container.textContent).toBe("edited B")
    expect(fixture.probe.mounts).toBe(1)
    expect(fixture.probe.cleanups).toBe(0)
    expect(fixture.owners.map((owner) => owner.disposed)).toEqual([true, true, true, false])
    fixture.dispose()
    expect(fixture.probe.cleanups).toBe(1)
    expect(fixture.owners.every((owner) => owner.disposed)).toBe(true)
    fixture.location(a)
    expect(fixture.owners).toHaveLength(4)
  })

  test("a departed store's late hydration cannot replace the current draft", async () => {
    const hydration = Promise.withResolvers<string | null>()
    const target = Persist.serverWorkspace(a.scope, a.directory, DRAFT_PERSIST_KEY)
    if (!target.storage) throw new Error("Expected workspace persistence")
    const fixture = mountDraft({ location: a, pending: new Map([[target.storage, hydration.promise]]) })
    const departed = fixture.current()
    fixture.location(b)
    const current = fixture.current()
    await titleReady(current, b.directory)
    current.setTitle("current B")
    hydration.resolve(JSON.stringify({ ...DEFAULT_DRAFT, title: "late A" }))
    await titleReady(departed, "late A")

    expect(fixture.current()).toBe(current)
    expect(current.state.title).toBe("current B")
    expect(fixture.container.textContent).toBe("current B")
    expect(fixture.probe.mounts).toBe(1)
    expect(fixture.owners.map((owner) => owner.disposed)).toEqual([true, false])
  })
})
