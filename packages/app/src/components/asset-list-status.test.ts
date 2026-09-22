import { describe, expect, test } from "bun:test"
import { createRoot, createResource, createSignal } from "solid-js"
import { assetListIsEmpty, assetListStatus } from "./asset-list-status"

describe("assetListStatus", () => {
  test("reports idle when there is no source", () => {
    expect(
      assetListStatus({
        source: undefined,
        settledSource: undefined,
        state: "unresolved",
        failed: undefined,
        total: 7,
      }),
    ).toBe("idle")
  })

  test("keeps an unresolved source in loading", () => {
    const source = {}
    expect(assetListStatus({ source, settledSource: undefined, state: "pending", failed: undefined, total: 7 })).toBe(
      "loading",
    )
  })

  test("keeps existing rows visible during a same-source refetch", () => {
    const source = {}
    expect(assetListStatus({ source, settledSource: source, state: "refreshing", failed: [], total: 7 })).toBe("ready")
  })

  test("hides settled rows while a different source is loading", () => {
    const previous = {}
    const current = {}
    expect(
      assetListStatus({ source: current, settledSource: previous, state: "refreshing", failed: [], total: 7 }),
    ).toBe("loading")
  })

  test("distinguishes partial and complete failure", () => {
    const source = {}
    expect(assetListStatus({ source, settledSource: source, state: "ready", failed: ["prompt"], total: 7 })).toBe(
      "partial",
    )
    expect(
      assetListStatus({
        source,
        settledSource: source,
        state: "ready",
        failed: ["a", "b", "c", "d", "e", "f", "g"],
        total: 7,
      }),
    ).toBe("error")
  })

  test("does not reuse previous data after a real Solid source change", async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const [previous, current] = [{}, {}]
    await new Promise<void>((done) =>
      createRoot((dispose) => {
        const [source, setSource] = createSignal(previous)
        const [data] = createResource(source, async (value) => {
          if (value === previous) return { source: previous, failed: [] as readonly string[] }
          await sleep(20)
          return { source: current, failed: [] as readonly string[] }
        })

        queueMicrotask(() => {
          setSource(current)
          expect(data()).toEqual({ source: previous, failed: [] })
          expect(
            assetListStatus({
              source: source(),
              settledSource: data()?.source,
              state: data.state,
              failed: data()?.failed,
              total: 7,
            }),
          ).toBe("loading")
          dispose()
          done()
        })
      }),
    )
  })
})

describe("assetListIsEmpty", () => {
  test("shows empty only after a clean read", () => {
    expect(assetListIsEmpty({ status: "ready", count: 0 })).toBe(true)
    expect(assetListIsEmpty({ status: "idle", count: 0 })).toBe(false)
    expect(assetListIsEmpty({ status: "loading", count: 0 })).toBe(false)
    expect(assetListIsEmpty({ status: "partial", count: 0 })).toBe(false)
  })
})
