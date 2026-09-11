import { describe, expect, test } from "bun:test"
import { planTabClose } from "./tab-close"

/**
 * Close-transaction decisions for `TabsProvider.removeTab`.
 *
 * These are the rules the transaction reads after the dirty confirmation resolves:
 * right neighbour first, left neighbour after that, nothing left → Home; the `recent`
 * pointer moves only when it pointed at the closing tab; and every lookup is by key, so
 * a close that stayed pending while other tabs changed cannot remove the wrong tab.
 */

type Tab = { id: string }
const keyOf = (tab: Tab) => `tab:${tab.id}`
const ids = (tabs: readonly Tab[]) => tabs.map((tab) => tab.id)

describe("planTabClose", () => {
  test("hands off to the right neighbour first", () => {
    const tabs: Tab[] = [{ id: "a" }, { id: "b" }, { id: "c" }]
    const plan = planTabClose({ tabs, keyOf, closingKey: "tab:b" })

    expect(plan && ids(plan.remaining)).toEqual(["a", "c"])
    expect(plan?.successor?.id).toBe("c")
  })

  test("falls back to the left neighbour when there is no tab to the right", () => {
    const tabs: Tab[] = [{ id: "a" }, { id: "b" }]
    const plan = planTabClose({ tabs, keyOf, closingKey: "tab:b" })

    expect(plan && ids(plan.remaining)).toEqual(["a"])
    expect(plan?.successor?.id).toBe("a")
  })

  test("closing the only tab leaves no successor for the Home fallback", () => {
    const plan = planTabClose({ tabs: [{ id: "a" }], keyOf, closingKey: "tab:a" })

    expect(plan && ids(plan.remaining)).toEqual([])
    expect(plan?.successor).toBeUndefined()
  })

  test("matches the closing tab by key, not by the index it had when the close started", () => {
    // The confirmation stayed open while another tab was closed first, shifting indexes.
    const tabs: Tab[] = [{ id: "b" }, { id: "c" }]
    const plan = planTabClose({ tabs, keyOf, closingKey: "tab:c" })

    expect(plan && ids(plan.remaining)).toEqual(["b"])
    expect(plan?.successor?.id).toBe("b")
  })

  test("moves the recent pointer to the successor only when it pointed at the closing tab", () => {
    const tabs: Tab[] = [{ id: "a" }, { id: "b" }, { id: "c" }]

    expect(planTabClose({ tabs, keyOf, closingKey: "tab:a", recentKey: "tab:a" })?.recent).toBe("tab:b")
    expect(planTabClose({ tabs, keyOf, closingKey: "tab:a", recentKey: "tab:c" })?.recent).toBe("tab:c")
    expect(planTabClose({ tabs, keyOf, closingKey: "tab:a", recentKey: undefined })?.recent).toBeUndefined()
  })

  test("clears the recent pointer when the closing tab was the last one", () => {
    const plan = planTabClose({ tabs: [{ id: "a" }], keyOf, closingKey: "tab:a", recentKey: "tab:a" })

    expect(plan?.successor).toBeUndefined()
    expect(plan?.recent).toBeUndefined()
  })

  test("a key that is no longer present plans nothing", () => {
    expect(planTabClose({ tabs: [{ id: "a" }], keyOf, closingKey: "tab:gone" })).toBeUndefined()
    expect(planTabClose({ tabs: [], keyOf, closingKey: "tab:a" })).toBeUndefined()
  })

  test("leaves the input order untouched", () => {
    const tabs: Tab[] = [{ id: "a" }, { id: "b" }, { id: "c" }]
    planTabClose({ tabs, keyOf, closingKey: "tab:b" })

    expect(ids(tabs)).toEqual(["a", "b", "c"])
  })
})
