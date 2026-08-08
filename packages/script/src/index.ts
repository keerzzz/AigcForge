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
  AIGCFROGE_CHANNEL: process.env["AIGCFROGE_CHANNEL"],
  AIGCFROGE_BUMP: process.env["AIGCFROGE_BUMP"],
  AIGCFROGE_VERSION: process.env["AIGCFROGE_VERSION"],
  AIGCFROGE_RELEASE: process.env["AIGCFROGE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.AIGCFROGE_CHANNEL) return env.AIGCFROGE_CHANNEL
  if (env.AIGCFROGE_BUMP) return "latest"
  if (env.AIGCFROGE_VERSION && !env.AIGCFROGE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.AIGCFROGE_VERSION) return env.AIGCFROGE_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  // Version base comes from the latest GitHub release tag: this fork publishes
  // @aigcfroge/* packages, and the upstream `aigcfroge` npm lookup 404s (that
  // package was never published). Fall back to the root package.json version
  // when no release exists yet.
  const repo = process.env.GH_REPO || "keerzzz/AigcForge"
  const version = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "User-Agent": "aigcfroge", "X-GitHub-Api-Version": "2022-11-28" },
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { tag_name?: string } | null) => (data?.tag_name ? data.tag_name.replace(/^v/, "") : rootPkg.version))
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.AIGCFROGE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "aigcfroge", "aigcfroge-agent[bot]"]
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
    return !!env.AIGCFROGE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`aigcfroge script`, JSON.stringify(Script, null, 2))
