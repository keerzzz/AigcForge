import { createRoot, getOwner, onCleanup } from "solid-js"

export function createRefCountMap<T>(
  create: (key: string) => T,
  remove?: (key: string) => void,
  identity: (key: string) => string = (key) => key,
) {
  const owner = getOwner()
  const items = new Map<string, { value: T; dispose: () => void; refs: number }>()
  const dispose = (id: string) => {
    const item = items.get(id)
    if (!item) return
    items.delete(id)
    item.dispose()
    remove?.(id)
  }
  if (owner) onCleanup(() => items.forEach((_, id) => dispose(id)))

  return (key: string) => {
    const id = identity(key)
    // Shared subscriptions belong to the entry, never to its first consumer.
    const item =
      items.get(id) ??
      createRoot((dispose) => {
        // The factory allocates subscriptions; failed initialization must release them.
        try {
          return { value: create(key), dispose, refs: 0 }
        } catch (error) {
          dispose()
          throw error
        }
      }, owner)
    item.refs++
    items.set(id, item)
    onCleanup(() => {
      if (items.get(id) !== item) return
      item.refs--
      if (item.refs === 0) dispose(id)
    })
    return item.value
  }
}
