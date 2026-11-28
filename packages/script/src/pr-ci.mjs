import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

// This selector is run from the base revision, before installing project dependencies.
function lane() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") return "full"
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
  const pr = event.pull_request
  if (!pr?.head?.ref || pr.head.ref === "release-candidate") return "full"

  if (event.action === "edited") {
    const fields = Object.keys(event.changes ?? {})
    return fields.length && fields.every((field) => field === "title" || field === "body") ? "metadata" : "full"
  }
  if (!["opened", "synchronize", "reopened", "ready_for_review"].includes(event.action)) return "full"

  const parents = spawnSync("git", ["show", "-s", "--format=%P", "HEAD"], { encoding: "utf8" })
  if (parents.status !== 0 || parents.stdout.trim() !== `${pr.base?.sha} ${pr.head.sha}`) return "full"

  // No rename folding: moving a product file to a README still changes its original path.
  const diff = spawnSync("git", ["diff", "--no-renames", "--name-only", "-z", "HEAD^1", "HEAD", "--"], {
    encoding: "utf8",
  })
  if (diff.status !== 0) return "full"
  const files = diff.stdout.split("\0").filter(Boolean)
  return files.length && files.every((file) => file === "README.md" || file === "README.zh.md") ? "readme" : "full"
}

console.log(`lane=${lane()}`)
