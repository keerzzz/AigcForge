import { createRoot, type Owner } from "solid-js"

type Entry<Value> = {
  value: Value
  dispose: VoidFunction
}

export function createTabMemory<Value>(owner: Owner | null) {
  const entries = new Map<string, Map<string, Entry<Value>>>()
  const references = new Map<string, Set<symbol>>()

  const remove = (key: string) => {
    const state = entries.get(key)
    references.delete(key)

    if (!state) return
    entries.delete(key)

    for (const entry of state.values()) entry.dispose()
  }

  return {
    retain(key: string): VoidFunction {
      const held = references.get(key) ?? new Set<symbol>()
      const reference = Symbol()
      references.set(key, held)
      held.add(reference)

      return () => {
        // A release from an old generation cannot remove replacement state.
        if (references.get(key) !== held || !held.delete(reference)) return

        if (held.size) return
        remove(key)
      }
    },
    get(key: string, name: string) {
      return entries.get(key)?.get(name)?.value
    },
    ensure(key: string, name: string, init: () => Value) {
      const state = entries.get(key) ?? new Map<string, Entry<Value>>()

      if (!entries.has(key)) entries.set(key, state)
      const existing = state.get(name)

      if (existing) return existing.value
      const entry = createRoot((dispose) => ({ value: init(), dispose }), owner)
      state.set(name, entry)

      return entry.value
    },
    remove,
    dispose() {
      for (const key of entries.keys()) remove(key)
      references.clear()
    },
  }
}
