#!/usr/bin/env bun

import { Release } from "@aigcfroge/script/release"
import { ReleaseMetadata } from "@aigcfroge/script/release-metadata"
import { $ } from "bun"
import { Schema } from "effect"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")

async function main() {
  const command = Bun.argv[2]
  const repo = process.env.GH_REPO ?? "keerzzz/AigcForge"
  const github = new Release.GitHub(repo, process.env.GH_TOKEN ?? "")
  if (command === "plan") {
    const event = Release.json(Release.Event, await Bun.file(required("GITHUB_EVENT_PATH")).text(), "GitHub event")
    const plan = await Release.automatic(
      root,
      github,
      Release.route(
        required("GITHUB_EVENT_NAME"),
        event,
        process.env.AIGCFROGE_DESKTOP_AUTOMATION ?? "off",
        repo,
        required("GITHUB_REF"),
        (await $`git rev-parse HEAD`.quiet().text()).trim(),
      ),
      process.env.AIGCFROGE_DESKTOP_AUTOMATION ?? "off",
      process.env.AIGCFROGE_RELEASE_BOT ?? "",
    )
    console.log(JSON.stringify(plan))
    if (process.env.GITHUB_OUTPUT)
      await Bun.write(process.env.GITHUB_OUTPUT, `mode=${plan.mode}\nsha=${plan.sha}\nversion=${plan.version}\n`)
    return
  }
  const source = Release.sha(required("AIGCFROGE_RELEASE_SHA"))
  const version = Release.version(required("AIGCFROGE_VERSION"))
  if ((await $`git rev-parse HEAD`.quiet().text()).trim() !== source)
    throw new Release.Failure({ reason: "Release checkout does not match its pinned source SHA" })
  if (command === "prepare") {
    await prepare(github, source, version, required("AIGCFROGE_RELEASE_BOT"))
    return
  }
  if (command !== "verify" && command !== "publish")
    throw new Release.Failure({ reason: "Expected plan, prepare, verify, or publish" })
  const release = await github.draft(version, source)
  if (!release) throw new Release.Failure({ reason: "Expected an existing desktop draft" })
  if (!release.draft) {
    console.log(`v${version} is already published from the same source; no changes`)
    return
  }
  const result = await ReleaseMetadata.verify(
    required("DESKTOP_METADATA_DIR"),
    required("DESKTOP_ARTIFACT_DIR"),
    version,
    release.assets,
  )
  console.log(`Verified ${result.platforms} targets and ${result.assets} release assets`)
  if (command === "publish") {
    if (process.env.AIGCFROGE_DESKTOP_AUTOMATION !== "publish")
      throw new Release.Failure({ reason: "Automatic public releases are not enabled" })
    await github.publish(version, source)
    console.log(`Published v${version} from ${source}`)
  }
}

async function prepare(github: Release.GitHub, source: string, target: string, bot: string) {
  await github.policy()
  if (!/^[A-Za-z0-9-]+\[bot\]$/.test(bot) || bot === "github-actions[bot]")
    throw new Release.Failure({ reason: "A configured release App is required" })
  const tip = Release.decode(
    Schema.Struct({ object: Schema.Struct({ sha: Schema.String }) }),
    await github.request(`/repos/${github.repo}/git/ref/heads/main`),
    "main ref",
  ).object.sha
  if (tip !== source) {
    console.log("Main advanced before preparation; wait for the newer CI event")
    return
  }
  const latest = await github.latest()
  if (!latest) throw new Release.Failure({ reason: "An initial release is required" })
  const previous = latest.tag_name.slice(1)
  const base = await github.tagCommit(previous)
  if (!base) throw new Release.Failure({ reason: "Latest release tag is missing" })
  const changes = await Release.changesSince(root, github, base, source)
  if (changes.kind === "none" || Release.next(previous, changes.kind) !== target)
    throw new Release.Failure({ reason: "Release plan changed before candidate preparation" })
  const pulls = await github.list(
    `/repos/${github.repo}/pulls?state=open&base=main&head=${encodeURIComponent(`${github.repo.split("/")[0]}:${Release.branch}`)}`,
    Release.Pull,
  )
  if (pulls.length > 1) throw new Release.Failure({ reason: "Multiple managed release PRs are open" })
  const existing = pulls[0]
  if (existing) {
    if (existing.user.login !== bot || existing.head.repo?.full_name !== github.repo)
      throw new Release.Failure({ reason: "Refusing to update another actor's release branch" })
    const metadata = Release.candidate(existing.body)
    await Release.verifyVersionCommit(root, metadata.base, existing.head.sha, metadata.version)
    if (metadata.previous !== previous)
      throw new Release.Failure({ reason: "Open release candidate is based on a different published version" })
    if (metadata.base === source && metadata.version === target) {
      await enableMerge(github.repo, existing.number, existing.head.sha)
      console.log(`Version PR #${existing.number} already matches this source`)
      return
    }
  }
  const oldRef = await github.request(`/repos/${github.repo}/git/ref/heads/${Release.branch}`)
  const oldHead = oldRef
    ? Release.decode(Schema.Struct({ object: Schema.Struct({ sha: Schema.String }) }), oldRef, "candidate ref").object
        .sha
    : undefined
  if (oldHead) {
    Release.sha(oldHead)
    await $`git fetch origin ${`refs/heads/${Release.branch}`}`.quiet()
    if (existing && existing.head.sha !== oldHead)
      throw new Release.Failure({ reason: "Release PR head changed during preparation" })
    if (!existing && (await $`git merge-base --is-ancestor ${oldHead} ${source}`.quiet().nothrow()).exitCode !== 0) {
      throw new Release.Failure({ reason: "An unmerged orphan release branch exists; reconcile it before retrying" })
    }
  }
  const tracking = existing
    ? await github.request(`/repos/${github.repo}/issues/${Release.candidate(existing.body).issue}`)
    : undefined
  const matches = tracking
    ? [Release.decode(Release.Issue, tracking, "release issue")]
    : (await github.list(`/repos/${github.repo}/issues?state=all`, Release.Issue)).filter(
        (issue) =>
          issue.title === `Prepare desktop release v${target}` &&
          issue.body?.includes("<!-- aigcforge-release-tracking -->"),
      )
  if (matches.length > 1 || matches.some((issue) => issue.user.login !== bot))
    throw new Release.Failure({ reason: "Release tracking issue ownership is ambiguous" })
  const issue =
    matches[0] ??
    Release.decode(
      Release.Issue,
      await github.request(`/repos/${github.repo}/issues`, "POST", {
        title: `Prepare desktop release v${target}`,
        body: "<!-- aigcforge-release-tracking -->\nPrepare a version-only desktop release PR. Closing this issue means version preparation, not public release or installation verification, is complete.",
      }),
      "created release issue",
    )
  const metadata = new Release.Candidate({ version: target, base: source, previous, issue: issue.number })
  const commit = await Release.commitCandidate(root, source, target, existing?.head.sha)
  const body = [
    "### Issue for this PR",
    `Closes #${issue.number}`,
    "",
    "### Type of change",
    "- [ ] Bug fix",
    "- [ ] New feature",
    "- [x] Refactor / code improvement",
    "- [ ] Documentation",
    "",
    "### What does this PR do?",
    `Prepare desktop version ${target} from ${source}. Only declared workspace version fields change.`,
    ...changes.pulls.map((pull) => `- Includes #${pull.number}`),
    "",
    "### How did you verify your code works?",
    "The release controller checked every declared manifest and rejected non-version changes. Required CI must pass before automatic merge; it has not been reported as passed here.",
    "",
    "### Screenshots / recordings",
    "Not a UI change.",
    "",
    "### Checklist",
    "- [x] I have tested my changes locally",
    "- [x] I have not included unrelated changes in this PR",
    "",
    Release.marker(metadata),
    "",
  ].join("\n")
  const currentMain = Release.decode(
    Schema.Struct({ object: Schema.Struct({ sha: Schema.String }) }),
    await github.request(`/repos/${github.repo}/git/ref/heads/main`),
    "main ref",
  ).object.sha
  if (currentMain !== source)
    throw new Release.Failure({
      reason: "Main advanced while preparing the version commit; retry from the next successful CI",
    })
  await $`git push origin ${`${commit}:refs/heads/${Release.branch}`}`.quiet()
  const pull = Release.decode(
    Release.Pull,
    await github.request(
      `/repos/${github.repo}/pulls${existing ? `/${existing.number}` : ""}`,
      existing ? "PATCH" : "POST",
      {
        title: `chore(release): prepare v${target}`,
        body,
        ...(existing ? {} : { head: Release.branch, base: "main", draft: false }),
      },
    ),
    "managed release PR",
  )
  await enableMerge(github.repo, pull.number, commit)
  console.log(`Prepared version PR #${pull.number} at ${commit}; required checks control automatic merge`)
}

async function enableMerge(repo: string, number: number, head: string) {
  const result = await $`gh pr merge ${number} --repo ${repo} --auto --merge --match-head-commit ${Release.sha(head)}`
    .quiet()
    .nothrow()
  if (result.exitCode !== 0)
    throw new Release.Failure({ reason: "Could not enable PR auto-merge; check App permissions and branch rules" })
}

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Release.Failure({ reason: `${name} is required` })
  return value
}

await main().catch((error: unknown) => {
  console.error(
    error instanceof Release.Failure
      ? error.message
      : "Desktop release command failed; inspect the failed command or validation",
  )
  process.exitCode = 1
})
