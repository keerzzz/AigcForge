import type { SessionInfo } from "@aigcfroge/client/promise"
import type { LocalProject } from "@/shell/state/layout"
import { displayName } from "@aigcfroge/ui/project-avatar"
import { compareSessionTime } from "@/shell/layout/helpers"
import { pathKey } from "@/workspaces/path-key"
import { getFilename } from "@aigcfroge/util/path"

export type HomeSessionRecord = {
  session: SessionInfo
  project: LocalProject
  projectName: string
}

export function homeSessionLocation(directory: string, branch?: string) {
  return { worktree: getFilename(directory) || directory, branch }
}

export function buildHomeSessionRecords(input: {
  sessions: () => SessionInfo[]
  projectDirectories: () => string[] | undefined
  projects: () => LocalProject[]
  resolveProject?: (session: SessionInfo) => LocalProject | undefined
  order?: "updated" | "message"
}) {
  const selected = input.projectDirectories()
  const directories = selected ? new Set(selected.map(pathKey)) : undefined

  const sessions = directories
    ? input.sessions().filter((session) => directories.has(pathKey(session.location.directory)))
    : input.sessions()

  return [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
    .sort(input.order === "message" ? compareSessionMessageTime : compareSessionTime)
    .map((session) => {
      const project = input.resolveProject?.(session) ??
        homeProjectForSession(session, input.projects()) ?? {
          id: session.projectID,
          worktree: session.location.directory,
          expanded: false,
        }

      return { session, project, projectName: displayName(project) }
    })
}

export function compareSessionMessageTime(a: SessionInfo, b: SessionInfo) {
  const latest = (b.time.message ?? b.time.created) - (a.time.message ?? a.time.created)

  if (latest !== 0) return latest

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Worktree inventories load on demand, so a worktree session may not match any directory yet;
// the session's project ID still identifies its added project.
export function homeProjectForSession<T extends { id?: string; worktree: string; sandboxes?: readonly string[] }>(
  session: SessionInfo,
  projects: readonly T[],
) {
  const directory = pathKey(session.location.directory)

  return (
    projects.find(
      (item) =>
        pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
    ) ?? projects.find((item) => item.id === session.projectID)
  )
}
