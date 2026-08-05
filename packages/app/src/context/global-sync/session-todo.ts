import type { Todo } from "@aigcfroge/sdk/v2/client"
import { reconcile } from "solid-js/store"

/**
 * V1 todo projection items lack stable `id` fields. `reconcile({ key: "id" })`
 * matches every item to `key: undefined`, merges in place, and preserves the
 * array reference — downstream memos short-circuit on `===` and the UI never
 * sees the update (M7 Bug 1-B). Only id-bearing lists may take the reconcile
 * path; id-less lists must be written by direct replacement so subscribers
 * receive a fresh reference on every `todo.updated`.
 */
export const hasStableTodoIds = (todos: readonly Todo[]): boolean =>
  todos.length > 0 && todos.every((item) => "id" in item && item.id !== undefined)

/** Store write value for `session_todo`: reconciler for id-bearing lists, fresh array otherwise. */
export const sessionTodoStoreValue = (todos: Todo[]) =>
  hasStableTodoIds(todos) ? reconcile(todos, { key: "id" }) : todos
