import { describe, expect, test } from "bun:test"
import { blockedBy, findCycle, type DagTask } from "@aigcfroge/core/session/dag"

const task = (id: string, over: Partial<DagTask> = {}): DagTask => ({ id, status: "pending", ...over })

describe("blockedBy", () => {
  test("no deps means ready", () => {
    expect(blockedBy([task("a")], "a")).toEqual([])
  })

  test("all predecessors terminal means ready", () => {
    const tasks = [
      task("a", { status: "completed" }),
      task("b", { status: "cancelled" }),
      task("c", { dependsOn: ["a", "b"] }),
    ]
    expect(blockedBy(tasks, "c")).toEqual([])
  })

  test("a non-terminal predecessor blocks", () => {
    const tasks = [task("a", { status: "pending" }), task("b", { dependsOn: ["a"] })]
    expect(blockedBy(tasks, "b")).toEqual(["a"])
  })

  test("a missing predecessor blocks (stale reference)", () => {
    expect(blockedBy([task("b", { dependsOn: ["ghost"] })], "b")).toEqual(["ghost"])
  })

  test("unknown task is never blocked", () => {
    expect(blockedBy([task("a")], "nope")).toEqual([])
  })
})

describe("findCycle", () => {
  test("a self-loop is a cycle", () => {
    expect(findCycle([task("a", { dependsOn: ["a"] })])).toEqual(["a", "a"])
  })

  test("a two-node cycle is detected", () => {
    expect(findCycle([task("a", { dependsOn: ["b"] }), task("b", { dependsOn: ["a"] })])).toEqual(["a", "b", "a"])
  })

  test("an acyclic graph has no cycle", () => {
    const tasks = [task("a"), task("b", { dependsOn: ["a"] }), task("c", { dependsOn: ["b"] })]
    expect(findCycle(tasks)).toBeUndefined()
  })

  test("a disconnected cycle is still detected", () => {
    const tasks = [task("x"), task("p", { dependsOn: ["q"] }), task("q", { dependsOn: ["p"] })]
    expect(findCycle(tasks)).toEqual(["p", "q", "p"])
  })
})
