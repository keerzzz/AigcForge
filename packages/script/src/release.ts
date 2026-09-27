import { $ } from "bun"
import { Option, Schema } from "effect"
import { realpath } from "node:fs/promises"
import path from "node:path"
import semver from "semver"

export const branch = "release-candidate"
export const requiredChecks = [
  "Lint, Test, and Typecheck",
  "unit (linux)",
  "unit (windows)",
  "e2e (linux)",
  "e2e (windows)",
  "check-standards",
  "check-compliance",
] as const

export class Failure extends Schema.TaggedErrorClass<Failure>()("DesktopReleaseError", {
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

export class Candidate extends Schema.Class<Candidate>("Release.Candidate")({
  version: Schema.String,
  base: Schema.String,
  previous: Schema.String,
  issue: Schema.Number,
}) {}

export class Asset extends Schema.Class<Asset>("Release.Asset")({
  id: Schema.Number,
  name: Schema.String,
  size: Schema.Number,
  state: Schema.String,
  digest: Schema.optional(Schema.NullOr(Schema.String)),
}) {}

export class Published extends Schema.Class<Published>("Release.Published")({
  id: Schema.Number,
  tag_name: Schema.String,
  target_commitish: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  body: Schema.NullOr(Schema.String),
  assets: Schema.Array(Asset),
}) {}

export class Pull extends Schema.Class<Pull>("Release.Pull")({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  state: Schema.String,
  draft: Schema.Boolean,
  merged_at: Schema.NullOr(Schema.String),
  merge_commit_sha: Schema.NullOr(Schema.String),
  user: Schema.Struct({ login: Schema.String }),
  head: Schema.Struct({
    ref: Schema.String,
    sha: Schema.String,
    repo: Schema.NullOr(Schema.Struct({ full_name: Schema.String })),
  }),
  base: Schema.Struct({ ref: Schema.String }),
  labels: Schema.Array(Schema.Struct({ name: Schema.String })),
}) {}

export class Issue extends Schema.Class<Issue>("Release.Issue")({
  number: Schema.Number,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  user: Schema.Struct({ login: Schema.String }),
}) {}

export class Event extends Schema.Class<Event>("Release.Event")({
  workflow_run: Schema.optional(
    Schema.Struct({
      event: Schema.String,
      conclusion: Schema.NullOr(Schema.String),
      head_branch: Schema.String,
      head_sha: Schema.String,
      head_repository: Schema.Struct({ full_name: Schema.String }),
    }),
  ),
  inputs: Schema.optional(
    Schema.Struct({
      release_mode: Schema.optional(Schema.String),
      version: Schema.optional(Schema.String),
      bump: Schema.optional(Schema.String),
    }),
  ),
}) {}

export class Plan extends Schema.Class<Plan>("Release.Plan")({
  mode: Schema.Literals(["skip", "prepare", "desktop-draft", "desktop-release", "full"]),
  sha: Schema.String,
  version: Schema.String,
  reason: Schema.String,
}) {}

const Root = Schema.Struct({
  version: Schema.String,
  workspaces: Schema.Struct({ packages: Schema.Array(Schema.String) }),
})
const ObjectRecord = Schema.Record(Schema.String, Schema.Unknown)
const Ref = Schema.Struct({ object: Schema.Struct({ type: Schema.String, sha: Schema.String }) })

export function decode<T>(schema: Schema.Decoder<T>, value: unknown, context: string): T {
  const result = Schema.decodeUnknownOption(schema)(value)
  if (Option.isNone(result)) throw new Failure({ reason: `Invalid ${context}` })
  return result.value
}

export function json<T>(schema: Schema.Decoder<T>, text: string, context: string): T {
  return decode(schema, decode(Schema.UnknownFromJsonString, text, `${context} JSON`), context)
}

export function version(value: string) {
  if (semver.valid(value) !== value || semver.prerelease(value)) {
    throw new Failure({ reason: "A desktop release requires an exact stable semver" })
  }
  return value
}

export function sha(value: string) {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Failure({ reason: "A release requires a full commit SHA" })
  return value
}

export function bump(labels: readonly string[]) {
  const selected = labels.filter((label) => label.startsWith("release:"))
  if (selected.some((label) => !["release:none", "release:patch", "release:minor", "release:major"].includes(label))) {
    throw new Failure({ reason: "Unknown release label" })
  }
  if (selected.includes("release:none") && selected.length > 1) {
    throw new Failure({ reason: "release:none conflicts with a version bump label" })
  }
  if (selected.includes("release:none")) return "none"
  if (selected.includes("release:major")) return "major"
  if (selected.includes("release:minor")) return "minor"
  return "patch"
}

export function next(current: string, kind: "patch" | "minor" | "major") {
  return version(semver.inc(version(current), kind) ?? "")
}

export function affectsDesktop(file: string) {
  const name = file.replaceAll("\\", "/")
  if (/(^|\/)(?:test|tests|e2e|__tests__|__fixtures__)(?:\/|$)/.test(name)) return false
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name) || /\.(?:md|mdx)$/.test(name)) return false
  if (/(^|\/)(?:AGENTS|CLAUDE|DESIGN)\.md$/.test(name)) return false
  if (["package.json", "bun.lock", "bunfig.toml", "turbo.json"].includes(name)) return true
  if (name.startsWith("packages/storybook/")) return false
  if (name.startsWith("packages/")) return true
  return (
    /^script\/(?:version|publish|desktop-release|sign-windows)\./.test(name) || name === ".github/workflows/publish.yml"
  )
}

export function marker(input: Candidate) {
  version(input.version)
  sha(input.base)
  version(input.previous)
  if (!Number.isSafeInteger(input.issue) || input.issue < 1)
    throw new Failure({ reason: "Invalid release tracking issue" })
  return `<!-- aigcforge-desktop-release ${JSON.stringify(input)} -->`
}

export function candidate(body: string | null) {
  const matches = [...(body ?? "").matchAll(/<!-- aigcforge-desktop-release (\{[^\n]*\}) -->/g)]
  if (matches.length !== 1) throw new Failure({ reason: "Expected one managed release candidate marker" })
  const result = json(Candidate, matches[0][1], "release candidate")
  marker(result)
  return result
}

export function route(eventName: string, event: Event, automation: string, repo: string, ref: string, source: string) {
  sha(source)
  if (eventName === "workflow_dispatch") {
    if (ref !== "refs/heads/main") throw new Failure({ reason: "Manual releases must run from main" })
    const mode = event.inputs?.release_mode ?? "desktop-draft"
    if (mode !== "desktop-draft" && mode !== "full") throw new Failure({ reason: "Invalid manual release mode" })
    if (event.inputs?.version) version(event.inputs.version)
    if (event.inputs?.bump && !["major", "minor", "patch"].includes(event.inputs.bump))
      throw new Failure({ reason: "Invalid version bump" })
    return new Plan({ mode, sha: source, version: event.inputs?.version ?? "", reason: "manual" })
  }
  if (eventName === "push") {
    const legacy =
      ["refs/heads/ci", "refs/heads/dev", "refs/heads/beta", "refs/heads/fix/npm-native-binary-install"].includes(
        ref,
      ) || ref.startsWith("refs/heads/snapshot-")
    return new Plan({
      mode: legacy ? "full" : "skip",
      sha: source,
      version: "",
      reason: legacy ? "legacy push" : "push outside legacy release branches",
    })
  }
  if (eventName !== "workflow_run") throw new Failure({ reason: "Unsupported release event" })
  if (automation === "off" || !automation)
    return new Plan({ mode: "skip", sha: source, version: "", reason: "automation disabled" })
  if (automation !== "draft" && automation !== "publish")
    throw new Failure({ reason: "Automation must be off, draft, or publish" })
  const run = event.workflow_run
  if (
    !run ||
    run.event !== "push" ||
    run.head_branch !== "main" ||
    run.head_repository.full_name !== repo ||
    run.conclusion !== "success"
  ) {
    return new Plan({ mode: "skip", sha: source, version: "", reason: "not a successful trusted main push" })
  }
  return new Plan({ mode: "prepare", sha: sha(run.head_sha), version: "", reason: "trusted main CI" })
}

export async function manifests(root: string) {
  const directory = await realpath(root)
  const pkg = json(Root, await Bun.file(path.join(directory, "package.json")).text(), "root manifest")
  const patterns = pkg.workspaces.packages
  if (
    patterns.some(
      (pattern) => path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..") || pattern.startsWith("!"),
    )
  ) {
    throw new Failure({ reason: "Workspace patterns must stay inside the repository" })
  }
  const files = [
    ...new Set([
      "package.json",
      ...patterns.flatMap((pattern) => [...new Bun.Glob(`${pattern}/package.json`).scanSync(directory)]),
    ]),
  ].sort()
  for (const file of files) {
    const resolved = await realpath(path.join(directory, file))
    if (!resolved.startsWith(`${directory}${path.sep}`))
      throw new Failure({ reason: "Workspace manifest escapes the repository" })
  }
  return files
}

// bun.lock embeds every workspace manifest version. Leaving it stale makes the next
// `bun install` rewrite the file, which dirties the release checkout and fails the
// version-candidate preparation. Rewriting only those version lines keeps the
// lockfile byte-identical to bun's own output without re-resolving dependencies.
export function lockfileVersions(content: string, folders: readonly string[], target: string) {
  version(target)
  return folders.reduce((text, folder) => {
    const marker = `${JSON.stringify(folder)}: {`
    const start = text.indexOf(marker)
    if (start === -1) throw new Failure({ reason: `bun.lock is missing the ${folder} workspace entry` })
    const entry = text.slice(start + marker.length)
    const match = /^\s*"version"\s*:\s*"[^"\r\n]*"/m.exec(entry)
    if (!match) throw new Failure({ reason: `bun.lock is missing the ${folder} workspace version` })
    const at = start + marker.length + match.index
    const replaced = match[0].replace(/"version"\s*:\s*"[^"\r\n]*"/, `"version": "${target}"`)
    return `${text.slice(0, at)}${replaced}${text.slice(at + match[0].length)}`
  }, content)
}

function manifestFolders(files: readonly string[]) {
  return files.map((file) => path.dirname(file).replaceAll("\\", "/")).filter((folder) => folder !== ".")
}

export async function updateVersions(root: string, target: string) {
  version(target)
  const files = await manifests(root)
  await Promise.all(
    files.map(async (file) => {
      const original = await Bun.file(path.join(root, file)).text()
      const record = json(ObjectRecord, original, "workspace manifest")
      if (typeof record.version !== "string") throw new Failure({ reason: `Missing version in ${file}` })
      const updated = original.replace(/^(\s*"version"\s*:\s*)"[^"\r\n]*"/m, `$1"${target}"`)
      const decoded = json(ObjectRecord, updated, "updated workspace manifest")
      if (decoded.version !== target || JSON.stringify({ ...record, version: target }) !== JSON.stringify(decoded)) {
        throw new Failure({ reason: `Version-only update failed for ${file}` })
      }
      await Bun.write(path.join(root, file), updated)
    }),
  )
  const lockfile = path.join(root, "bun.lock")
  if (await Bun.file(lockfile).exists()) {
    const original = await Bun.file(lockfile).text()
    const updated = lockfileVersions(original, manifestFolders(files), target)
    if (updated !== original) await Bun.write(lockfile, updated)
    files.push("bun.lock")
  }
  return files
}

export async function verifyVersionCommit(root: string, base: string, head: string, target: string) {
  sha(base)
  sha(head)
  version(target)
  const names = (await $`git -C ${root} diff --name-only -z ${base} ${head}`.quiet().text()).split("\0").filter(Boolean)
  const rootBefore = json(
    Root,
    await $`git -C ${root} show ${`${base}:package.json`}`.quiet().text(),
    "base root manifest",
  )
  const all = (await $`git -C ${root} ls-tree -r --name-only -z ${base}`.quiet().text()).split("\0").filter(Boolean)
  const allowed = all.filter(
    (file) =>
      file === "package.json" ||
      rootBefore.workspaces.packages.some((pattern) => new Bun.Glob(`${pattern}/package.json`).match(file)),
  )
  if (!names.length || names.some((file) => !allowed.includes(file) && file !== "bun.lock"))
    throw new Failure({ reason: "Candidate includes changes outside declared version manifests" })
  for (const file of allowed) {
    const before = json(ObjectRecord, await $`git -C ${root} show ${`${base}:${file}`}`.quiet().text(), "base manifest")
    const after = json(
      ObjectRecord,
      await $`git -C ${root} show ${`${head}:${file}`}`.quiet().text(),
      "candidate manifest",
    )
    if (after.version !== target || JSON.stringify({ ...before, version: target }) !== JSON.stringify(after)) {
      throw new Failure({ reason: `Candidate is not a complete version-only change: ${file}` })
    }
  }
  if (all.includes("bun.lock")) {
    const before = await $`git -C ${root} show ${`${base}:bun.lock`}`.quiet().text()
    const after = await $`git -C ${root} show ${`${head}:bun.lock`}`.quiet().text()
    if (after !== lockfileVersions(before, manifestFolders(allowed), target))
      throw new Failure({ reason: "Candidate lockfile is not an exact workspace version sync" })
  }
  return allowed
}

export async function commitCandidate(root: string, base: string, target: string, previousHead?: string) {
  sha(base)
  if (previousHead) sha(previousHead)
  const current = (await $`git -C ${root} rev-parse HEAD`.quiet().text()).trim()
  if (current !== base) throw new Failure({ reason: "Candidate workspace must be checked out at its base SHA" })
  const dirty = (await $`git -C ${root} status --porcelain`.quiet().text()).trim()
  if (dirty) throw new Failure({ reason: `Candidate workspace must be clean: ${dirty.replaceAll("\n", " | ")}` })
  const files = await updateVersions(root, target)
  await $`git -C ${root} add -- ${files}`.quiet()
  const tree = (await $`git -C ${root} write-tree`.quiet().text()).trim()
  // Keep the previous candidate as a parent so updates never require force-push.
  const parents = previousHead ? ["-p", previousHead, "-p", base] : ["-p", base]
  const commit = (
    await $`git -C ${root} commit-tree ${tree} ${parents} -m ${`chore(release): prepare v${target}`}`.quiet().text()
  ).trim()
  await verifyVersionCommit(root, base, commit, target)
  return sha(commit)
}

export class GitHub {
  constructor(
    readonly repo: string,
    private readonly token: string,
    private readonly baseURL = "https://api.github.com",
  ) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Failure({ reason: "Invalid GitHub repository" })
    if (!token) throw new Failure({ reason: "GH_TOKEN is required" })
  }

  async request(endpoint: string, method = "GET", body?: unknown) {
    if (!endpoint.startsWith("/") || endpoint.startsWith("//"))
      throw new Failure({ reason: "Invalid GitHub API endpoint" })
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    }).catch(() => {
      throw new Failure({ reason: `GitHub ${method} request failed (network or timeout)` })
    })
    if (response.status === 404 && method === "GET") return undefined
    if (!response.ok)
      throw new Failure({ reason: `GitHub ${method} ${endpoint.split("?")[0]} failed: HTTP ${response.status}` })
    if (response.status === 204) return undefined
    return json(Schema.Unknown, await response.text(), "GitHub response")
  }

  async list<T>(endpoint: string, schema: Schema.Decoder<T>) {
    const result: T[] = []
    for (let page = 1; ; page++) {
      const items = decode(
        Schema.Array(schema),
        await this.request(`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`),
        "GitHub list",
      )
      result.push(...items)
      if (items.length < 100) return result
    }
  }

  async policy() {
    const settings = decode(
      Schema.Struct({ allow_auto_merge: Schema.Boolean }),
      await this.request(`/repos/${this.repo}`),
      "repository settings",
    )
    const checks = await this.request(`/repos/${this.repo}/branches/main/protection/required_status_checks`)
    if (!settings.allow_auto_merge || !checks)
      throw new Failure({
        reason: "Enable repository auto-merge and strict main branch protection before desktop automation",
      })
    const policy = decode(
      Schema.Struct({
        strict: Schema.Boolean,
        contexts: Schema.Array(Schema.String),
        checks: Schema.optional(Schema.Array(Schema.Struct({ context: Schema.String }))),
      }),
      checks,
      "required checks",
    )
    const names = new Set([...policy.contexts, ...(policy.checks ?? []).map((check) => check.context)])
    if (!policy.strict || requiredChecks.some((name) => !names.has(name)))
      throw new Failure({ reason: "main must require up-to-date branches and every desktop release PR check" })
  }

  async pullsFor(commit: string) {
    return (await this.list(`/repos/${this.repo}/commits/${sha(commit)}/pulls`, Pull)).filter(
      (pull) => pull.base.ref === "main" && pull.merge_commit_sha === commit && pull.merged_at,
    )
  }

  async checkPull(pull: Pull) {
    const data = decode(
      Schema.Struct({
        check_runs: Schema.Array(
          Schema.Struct({
            id: Schema.Number,
            name: Schema.String,
            status: Schema.String,
            conclusion: Schema.NullOr(Schema.String),
            head_sha: Schema.String,
            app: Schema.Struct({ slug: Schema.String }),
          }),
        ),
      }),
      await this.request(`/repos/${this.repo}/commits/${sha(pull.head.sha)}/check-runs?per_page=100&filter=latest`),
      "candidate checks",
    )
    for (const name of requiredChecks) {
      const check = data.check_runs
        .filter((item) => item.name === name && item.app.slug === "github-actions")
        .sort((left, right) => right.id - left.id)[0]
      if (
        !check ||
        check.head_sha !== pull.head.sha ||
        check.status !== "completed" ||
        check.conclusion !== "success"
      ) {
        throw new Failure({ reason: `Candidate required check is not successful: ${name}` })
      }
    }
  }

  async latest() {
    const value = await this.request(`/repos/${this.repo}/releases/latest`)
    if (!value) return undefined
    const release = decode(Published, value, "latest release")
    if (release.draft || release.prerelease || !release.tag_name.startsWith("v"))
      throw new Failure({ reason: "Latest release must be a stable version tag" })
    version(release.tag_name.slice(1))
    return release
  }

  async tagged(target: string) {
    version(target)
    const matches = (await this.list(`/repos/${this.repo}/releases`, Published)).filter(
      (release) => release.tag_name === `v${target}`,
    )
    if (matches.length > 1)
      throw new Failure({ reason: "Multiple releases use the same version; reconcile their IDs before retrying" })
    return matches[0]
  }

  async tagCommit(target: string) {
    const value = await this.request(`/repos/${this.repo}/git/ref/tags/v${version(target)}`)
    if (!value) return undefined
    let object = decode(Ref, value, "release tag").object
    for (let depth = 0; depth < 5; depth++) {
      if (object.type === "commit") return sha(object.sha)
      if (object.type !== "tag") break
      object = decode(
        Ref,
        await this.request(`/repos/${this.repo}/git/tags/${sha(object.sha)}`),
        "annotated release tag",
      ).object
    }
    throw new Failure({ reason: "Release tag does not resolve to a commit" })
  }

  async draft(target: string, source: string, notes?: string) {
    version(target)
    sha(source)
    const tagged = await this.tagCommit(target)
    if (tagged && tagged !== source)
      throw new Failure({ reason: "Existing tag points at another commit; tags are never moved" })
    const existing = await this.tagged(target)
    if (existing) {
      if (existing.target_commitish !== source || existing.prerelease)
        throw new Failure({ reason: "Existing release does not match the requested source" })
      if (!existing.draft && tagged !== source)
        throw new Failure({ reason: "Published release tag is missing or inconsistent" })
      return existing
    }
    if (!notes?.trim()) return undefined
    const release = decode(
      Published,
      await this.request(`/repos/${this.repo}/releases`, "POST", {
        tag_name: `v${target}`,
        target_commitish: source,
        name: `v${target}`,
        body: notes,
        draft: true,
        prerelease: false,
      }),
      "created draft",
    )
    if (!release.draft || release.target_commitish !== source)
      throw new Failure({ reason: "Draft creation returned inconsistent metadata" })
    return release
  }

  async publish(target: string, source: string) {
    const release = await this.draft(target, source)
    if (!release) throw new Failure({ reason: "Desktop draft is missing" })
    if (!release.draft) return release
    const latest = await this.latest()
    if (latest && semver.gte(latest.tag_name.slice(1), target))
      throw new Failure({ reason: "Refusing to replace latest with an older or conflicting release" })
    const result = decode(
      Published,
      await this.request(`/repos/${this.repo}/releases/${release.id}`, "PATCH", { draft: false, make_latest: "true" }),
      "published release",
    )
    if (result.draft || result.target_commitish !== source || (await this.tagCommit(target)) !== source)
      throw new Failure({ reason: "Published release source verification failed" })
    return result
  }
}

export async function changesSince(root: string, github: GitHub, base: string, head: string) {
  sha(base)
  sha(head)
  await $`git -C ${root} merge-base --is-ancestor ${base} ${head}`.quiet()
  const commits = (await $`git -C ${root} rev-list --first-parent --reverse ${`${base}..${head}`}`.quiet().text())
    .trim()
    .split("\n")
    .filter(Boolean)
  const changes: Array<{ kind: "patch" | "minor" | "major"; pull?: Pull }> = []
  for (const commit of commits) {
    const pulls = await github.pullsFor(commit)
    if (pulls.length > 1) throw new Failure({ reason: "Ambiguous merged pull requests for a release commit" })
    // The managed version PR is bookkeeping: release it through its own path,
    // never by treating its manifest-only merge as fresh desktop work.
    if (pulls[0]?.head.ref === branch) continue
    const kind = bump(pulls[0]?.labels.map((label) => label.name) ?? [])
    if (kind === "none") continue
    const files = (await $`git -C ${root} diff --name-only -z ${`${commit}^1`} ${commit}`.quiet().text())
      .split("\0")
      .filter(Boolean)
    if (files.some(affectsDesktop)) changes.push({ kind, pull: pulls[0] })
  }
  const kind: "major" | "minor" | "patch" | "none" = changes.some((change) => change.kind === "major")
    ? "major"
    : changes.some((change) => change.kind === "minor")
      ? "minor"
      : changes.length
        ? "patch"
        : "none"
  return { kind, pulls: changes.flatMap((change) => (change.pull ? [change.pull] : [])) }
}

export async function automatic(root: string, github: GitHub, input: Plan, automation: string, bot: string) {
  if (input.mode !== "prepare") return input
  if (!/^[A-Za-z0-9-]+\[bot\]$/.test(bot) || bot === "github-actions[bot]") {
    throw new Failure({ reason: "Desktop automation requires a configured GitHub App, not the fallback token" })
  }
  await $`git -C ${root} merge-base --is-ancestor ${input.sha} origin/main`.quiet()
  const pulls = await github.pullsFor(input.sha)
  if (pulls.length !== 1) return new Plan({ ...input, mode: "skip", reason: "not one merged main PR" })
  const pull = pulls[0]
  const pkg = json(Root, await $`git -C ${root} show ${`${input.sha}:package.json`}`.quiet().text(), "source manifest")
  const latest = await github.latest()
  if (!latest) throw new Failure({ reason: "Seed and verify an initial desktop release before enabling automation" })
  if (pull.head.ref === branch) {
    if (pull.user.login !== bot || pull.head.repo?.full_name !== github.repo)
      throw new Failure({ reason: "Release branch is not owned by the configured App" })
    const metadata = candidate(pull.body)
    if (pkg.version !== metadata.version)
      throw new Failure({ reason: "Candidate metadata and source version disagree" })
    const parent = (await $`git -C ${root} rev-parse ${`${input.sha}^1`}`.quiet().text()).trim()
    if (parent !== metadata.base)
      throw new Failure({
        reason: "Candidate merged against a different main SHA; do not publish a stale version plan",
      })
    await verifyVersionCommit(root, metadata.base, input.sha, metadata.version)
    await github.checkPull(pull)
    if (latest.tag_name === `v${metadata.version}`) {
      const done = await github.draft(metadata.version, input.sha)
      if (!done || done.draft) throw new Failure({ reason: "Latest release state is inconsistent" })
      return new Plan({ ...input, mode: "skip", version: metadata.version, reason: "already published" })
    }
    if (latest.tag_name !== `v${metadata.previous}` || semver.lte(metadata.version, metadata.previous)) {
      throw new Failure({ reason: "Candidate publication order conflicts with latest" })
    }
    return new Plan({
      ...input,
      mode: automation === "publish" ? "desktop-release" : "desktop-draft",
      version: metadata.version,
      reason: "verified version PR",
    })
  }
  const tip = (await $`git -C ${root} rev-parse origin/main`.quiet().text()).trim()
  if (tip !== input.sha)
    return new Plan({ ...input, mode: "skip", reason: "superseded main CI; wait for the current tip" })
  version(pkg.version)
  if (semver.gt(pkg.version, latest.tag_name.slice(1)))
    return new Plan({ ...input, mode: "skip", reason: "an earlier version candidate is not published yet" })
  if (pkg.version !== latest.tag_name.slice(1))
    throw new Failure({ reason: "Root version is behind the latest release" })
  const base = await github.tagCommit(pkg.version)
  if (!base) throw new Failure({ reason: "Latest release tag is missing" })
  const changes = await changesSince(root, github, base, input.sha)
  if (changes.kind === "none") return new Plan({ ...input, mode: "skip", reason: "no desktop-affecting changes" })
  return new Plan({
    ...input,
    version: next(pkg.version, changes.kind),
    reason: "desktop changes require a version PR",
  })
}

export * as Release from "./release"
