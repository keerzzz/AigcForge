import type { SessionTaskInfo, Todo } from "@aigcfroge/sdk/v2"

// Legacy state.session.todo() bridge: projects the task store onto the old
// Todo shape. scheduled is not representable in the legacy status set
// (pending/in_progress/completed/cancelled), so it degrades to pending. All
// other statuses pass through unchanged. This projection exists only to keep
// third-party TUI plugins working until Phase 5 removes the deprecated bridge.
export function projectTodoFromTask(task: SessionTaskInfo): Pick<Todo, "content" | "status"> {
  return {
    content: task.content,
    status: task.status === "scheduled" ? "pending" : task.status,
  }
}
