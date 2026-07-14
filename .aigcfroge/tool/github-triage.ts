/// <reference path="../env.d.ts" />
import { tool } from "@aigcfroge/plugin"

const TEAM = {
  tui: ["kommander", "simonklee"],
  desktop_web: ["Hona", "Brendonovich"],
  core: ["jlongster", "rekram1-node", "nexxeln", "kitlangton", "starptech"],
  inference: ["fwang", "MrMushrooooom", "starptech"],
  windows: ["Hona"],
} as const

function pick<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function getIssueNumber(): number {
  const issue = parseInt(process.env.ISSUE_NUMBER ?? "", 10)
  if (!issue) throw new Error("ISSUE_NUMBER env var not set")
  return issue
}

async function githubFetch(endpoint: string, options: RequestInit = {}) {
  const headers = new Headers({
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  })
  new Headers(options.headers).forEach((value, name) => headers.set(name, value))
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers,
  })
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

export default tool({
  description: `Use this tool to assign a GitHub issue.

Provide the team that should own the issue. This tool picks a random assignee from that team and does not apply labels.`,
  args: {
    team: tool.schema
      .enum(Object.keys(TEAM) as [keyof typeof TEAM, ...(keyof typeof TEAM)[]])
      .describe("The owning team"),
  },
  async execute(args) {
    const issue = getIssueNumber()
    const owner = "keerzzz"
    const repo = "aigcfroge"
    const assignee = pick(TEAM[args.team])

    await githubFetch(`/repos/${owner}/${repo}/issues/${issue}/assignees`, {
      method: "POST",
      body: JSON.stringify({ assignees: [assignee] }),
    })

    return `Assigned @${assignee} from ${args.team} to issue #${issue}`
  },
})
