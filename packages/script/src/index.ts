import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  OMNIXA_CHANNEL: process.env["OMNIXA_CHANNEL"],
  OMNIXA_BUMP: process.env["OMNIXA_BUMP"],
  OMNIXA_VERSION: process.env["OMNIXA_VERSION"],
  OMNIXA_RELEASE: process.env["OMNIXA_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.OMNIXA_CHANNEL) return env.OMNIXA_CHANNEL
  if (env.OMNIXA_BUMP) return "latest"
  if (env.OMNIXA_VERSION && !env.OMNIXA_VERSION.startsWith("0.0.0-")) return "latest"
  const branch = await $`git branch --show-current`.text().then((x) => x.trim())
  if (!branch) return "detached"
  const channel = branch.replace(/[^a-zA-Z0-9._-]/g, "-")
  if (/^[a-zA-Z0-9]/.test(channel)) return channel
  return `branch-${channel}`
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.OMNIXA_VERSION) return env.OMNIXA_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${previewBuildNumber()}`
  const repo = process.env.GH_REPO || "keerzzz/Omnixa"
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  const version = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "omnixa",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { tag_name?: string } | null) => (data?.tag_name ? data.tag_name.replace(/^v/, "") : rootPkg.version))
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.OMNIXA_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

function previewBuildNumber() {
  const runNumber = process.env["GITHUB_RUN_NUMBER"]
  if (!runNumber) return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
  const runAttempt = process.env["GITHUB_RUN_ATTEMPT"]
  if (runAttempt && runAttempt !== "1") return `${runNumber}.${runAttempt}`
  return runNumber
}

const bot = ["actions-user", "omnixa", "omnixa-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.OMNIXA_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`omnixa script`, JSON.stringify(Script, null, 2))
