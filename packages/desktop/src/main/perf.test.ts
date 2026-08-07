import { describe, expect, test } from "bun:test"

import { getStartupMarks, perf, resetStartupMarks, setPerfSink } from "./perf"

describe("perf startup marks", () => {
  test("records { label, ms } entries in insertion order", () => {
    resetStartupMarks()
    perf("first")
    perf("second")

    const marks = getStartupMarks()
    expect(marks.map((mark) => mark.label)).toEqual(["first", "second"])
    for (const mark of marks) {
      expect(typeof mark.label).toBe("string")
      expect(typeof mark.ms).toBe("number")
      expect(Number.isFinite(mark.ms)).toBe(true)
    }
    expect(marks[1].ms).toBeGreaterThanOrEqual(marks[0].ms)
  })

  test("getStartupMarks returns a copy", () => {
    resetStartupMarks()
    perf("mark")

    const copy = getStartupMarks()
    copy.push({ label: "mutated", ms: 0 })

    expect(getStartupMarks().length).toBe(1)
  })

  test("sink receives each mark with its label and ms", () => {
    resetStartupMarks()
    const received: { label: string; ms: number }[] = []
    setPerfSink((label, ms) => received.push({ label, ms }))
    perf("sinked")
    setPerfSink(() => {})

    expect(received).toHaveLength(1)
    expect(received[0].label).toBe("sinked")
    expect(typeof received[0].ms).toBe("number")
  })

  test("resetStartupMarks clears recorded marks", () => {
    resetStartupMarks()
    perf("mark")
    resetStartupMarks()
    expect(getStartupMarks()).toEqual([])
  })

  test("setPerfSink replays marks recorded before the sink was wired", () => {
    resetStartupMarks()
    perf("early")
    const received: { label: string; ms: number }[] = []
    setPerfSink((label, ms) => received.push({ label, ms }))
    perf("late")
    setPerfSink(() => {})

    expect(received.map((entry) => entry.label)).toEqual(["early", "late"])
    expect(typeof received[0].ms).toBe("number")
  })

  test("setPerfSink does not replay marks twice on repeated calls", () => {
    resetStartupMarks()
    perf("mark")
    const first: string[] = []
    const second: string[] = []
    setPerfSink((label) => first.push(label))
    setPerfSink((label) => second.push(label))
    setPerfSink(() => {})

    expect(first).toEqual(["mark"])
    expect(second).toEqual([])
  })
})
