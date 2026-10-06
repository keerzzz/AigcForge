/**
 * Pure shaping of a canonical task-write invocation (`taskwrite`, `task_create`,
 * `task_update`, `task_delete`, `task_reorder`).
 *
 * The snapshot is read ONLY from the call's own ToolPart input/metadata. History must never
 * be re-read from the live task store, otherwise a later authoritative edit would rewrite
 * what an older invocation displayed.
 */

export type TaskWriteSnapshotItem = {
  id?: string
  content: string
  status?: string
}

export function taskWriteSnapshot(
  input: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
): TaskWriteSnapshotItem[] {
  const source: unknown[] = Array.isArray(metadata?.tasks)
    ? metadata.tasks
    : metadata?.task
      ? [metadata.task]
      : Array.isArray(input?.tasks)
        ? input.tasks
        : []

  return source.flatMap((value): TaskWriteSnapshotItem[] => {
    if (typeof value !== "object" || value === null || !("content" in value)) return []
    if (typeof value.content !== "string" || value.content.length === 0) return []
    return [
      {
        ...("id" in value && typeof value.id === "string" ? { id: value.id } : {}),
        content: value.content,
        ...("status" in value && typeof value.status === "string" ? { status: value.status } : {}),
      },
    ]
  })
}

export * as TaskWriteToolModel from "./task-write-tool-model"
