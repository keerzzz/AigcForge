import { describe, expect, test } from "bun:test"
import { createRoot, onCleanup } from "solid-js"
import { createRefCountMap } from "./refcount"
import { pathKey } from "./path-key"

describe("createRefCountMap", () => {
  test("failed initialization releases its scope without owning a later replacement", () => {
    const disposed: number[] = []
    let attempts = 0
    const map = createRefCountMap(() => {
      const attempt = ++attempts
      onCleanup(() => disposed.push(attempt))
      if (attempt === 1) throw new Error("initialization failed")
      return attempt
    })
    const failed = createRoot((dispose) => {
      expect(() => map("/project")).toThrow("initialization failed")
      return dispose
    })
    expect(disposed).toEqual([1])
    const next = createRoot((dispose) => {
      expect(map("/project")).toBe(2)
      return dispose
    })
    failed()
    expect(disposed).toEqual([1])
    next()
    expect(disposed).toEqual([1, 2])
  })

  test("keeps shared subscriptions alive when the first consumer leaves", () => {
    const disposed: string[] = []
    const map = createRefCountMap((key) => {
      onCleanup(() => disposed.push(key))
      return { key }
    })
    const first = createRoot((dispose) => ({ value: map("/project"), dispose }))
    const second = createRoot((dispose) => ({ value: map("/project"), dispose }))

    expect(second.value).toBe(first.value)
    first.dispose()
    expect(disposed).toEqual([])
    second.dispose()
    expect(disposed).toEqual(["/project"])

    const next = createRoot((dispose) => ({ value: map("/project"), dispose }))
    expect(next.value).not.toBe(first.value)
    next.dispose()
    expect(disposed).toEqual(["/project", "/project"])
  })

  test("disposes retained entries when the map owner closes", () => {
    const disposed: string[] = []
    const removed: string[] = []
    const owner = createRoot((dispose) => ({
      dispose,
      map: createRefCountMap(
        (key) => {
          onCleanup(() => disposed.push(key))
          return key
        },
        (key) => removed.push(key),
      ),
    }))
    const consumer = createRoot((dispose) => {
      owner.map("/project")
      return dispose
    })
    owner.dispose()
    expect(disposed).toEqual(["/project"])
    expect(removed).toEqual(["/project"])
    consumer()
    expect(disposed).toEqual(["/project"])
    expect(removed).toEqual(["/project"])
  })

  test("removes an item after its last owner is disposed", () => {
    const removed: string[] = []
    const map = createRefCountMap(
      (key) => key,
      (key) => removed.push(key),
    )
    const first = createRoot((dispose) => {
      map("/project")
      return dispose
    })
    const second = createRoot((dispose) => {
      map("/project")
      return dispose
    })

    first()
    expect(removed).toEqual([])
    second()
    expect(removed).toEqual(["/project"])
  })

  test("keeps equivalent path consumers until the last owner is disposed", () => {
    const removed: string[] = []
    const map = createRefCountMap(
      (key) => key,
      (key) => removed.push(key),
      pathKey,
    )
    const first = createRoot((dispose) => {
      map("C:\\repo")
      return dispose
    })
    const second = createRoot((dispose) => {
      map("C:/repo/")
      return dispose
    })

    first()
    expect(removed).toEqual([])
    second()
    expect(removed).toEqual(["C:/repo"])
  })
})
