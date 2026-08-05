import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { Todo } from "@aigcfroge/sdk/v2/client"
import { hasStableTodoIds, sessionTodoStoreValue } from "./session-todo"

const todo = (content: string, status: string): Todo => ({ content, status, priority: "medium" })
const withId = (content: string, status: string, id: string): Todo => ({ ...todo(content, status), id }) as Todo

describe("hasStableTodoIds", () => {
  test("false for empty, id-less, and mixed lists; true only when every item has an id", () => {
    expect(hasStableTodoIds([])).toBe(false)
    expect(hasStableTodoIds([todo("a", "pending")])).toBe(false)
    expect(hasStableTodoIds([withId("a", "pending", "t1"), todo("b", "pending")])).toBe(false)
    expect(hasStableTodoIds([withId("a", "pending", "t1"), withId("b", "pending", "t2")])).toBe(true)
  })
})

describe("sessionTodoStoreValue (M7 Bug 1-B)", () => {
  test("id-less V1 projections write by replacement: every write yields a fresh reference with updated content", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{ todos: Todo[] }>({
        todos: [todo("a", "pending"), todo("b", "pending")],
      })
      const first = store.todos
      setStore("todos", sessionTodoStoreValue([todo("a", "completed"), todo("b", "pending")]))
      const second = store.todos
      // A fresh array reference per write is the contract that lets downstream
      // memos (tasks() in session-todo-progress) observe every todo.updated.
      expect(second).not.toBe(first)
      expect(second[0]?.status).toBe("completed")
      setStore("todos", sessionTodoStoreValue([todo("a", "completed"), todo("b", "in_progress")]))
      expect(store.todos).not.toBe(second)
      expect(store.todos[1]?.status).toBe("in_progress")
      dispose()
    })
  })

  test("id-bearing lists keep the reconcile path: reference preserved, values merged in place", () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore<{ todos: Todo[] }>({
        todos: [withId("a", "pending", "t1")],
      })
      const before = store.todos
      setStore("todos", sessionTodoStoreValue([withId("a", "completed", "t1")]))
      expect(store.todos).toBe(before)
      expect(store.todos[0]?.status).toBe("completed")
      dispose()
    })
  })
})
