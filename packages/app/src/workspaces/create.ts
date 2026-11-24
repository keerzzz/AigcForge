import type { LocationGetOutput, OmnixaClient } from "@omnixa/client/promise"
import type { Data } from "@omnixa/client/solid"

export async function createWorktree(input: {
  api: Pick<OmnixaClient, "location" | "worktree">
  data: Pick<Data, "location">
  directory: string
  project?: LocationGetOutput["project"]
  branch?: string
}) {
  const project = input.project ?? (await input.api.location.get({ location: { directory: input.directory } })).project

  const created = await input.api.worktree.create({
    projectID: project.id,
    from: project.canonical,
    branch: input.branch,
  })

  // Populate the client cache before the destination session mounts.
  await input.data.location.syncInfo({ directory: created.directory })

  return created.directory
}
