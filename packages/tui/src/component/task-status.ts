export type TaskStatusColor = "accent" | "error" | "success" | "textMuted" | "warning"

export type TaskStatusStyle = {
  marker: string
  color: TaskStatusColor
}

// Explicit six-state mapping for task rendering. Unknown statuses return
// undefined so the renderer falls back to a neutral style rather than
// pretending to support them.
export function taskStatusStyle(status: string): TaskStatusStyle | undefined {
  switch (status) {
    case "pending":
      return { marker: " ", color: "textMuted" }
    case "in_progress":
      return { marker: "•", color: "warning" }
    case "completed":
      return { marker: "✓", color: "success" }
    case "cancelled":
      return { marker: "✕", color: "textMuted" }
    case "failed":
      return { marker: "✕", color: "error" }
    case "scheduled":
      return { marker: "⚡", color: "accent" }
    default:
      return undefined
  }
}

export function formatNextRun(nextRun: number): string {
  return new Date(nextRun).toLocaleString()
}
