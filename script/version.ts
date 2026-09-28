#!/usr/bin/env bun

import { Script } from "@aigcfroge/script"
import { Release } from "@aigcfroge/script/release"
import { $ } from "bun"

const output = [`version=${Script.version}`]
const sha = (await $`git rev-parse HEAD`.quiet().text()).trim()
const strict = process.env.AIGCFROGE_RELEASE_NOTES_STRICT === "true"

if (!Script.preview) {
  const github = new Release.GitHub(process.env.GH_REPO ?? "keerzzz/AigcForge", process.env.GH_TOKEN ?? "")
  const existing = await github.draft(Script.version, sha)
  const release = existing ?? (await github.draft(Script.version, sha, await releaseNotes(sha, strict)))
  if (!release) throw new Release.Failure({ reason: "Draft release was not created" })
  output.push(`release=${release.id}`, `tag=${release.tag_name}`, `published=${!release.draft}`)
} else if (Script.channel === "beta") {
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --repo ${process.env.GH_REPO}`
  const release =
    await $`gh release view v${Script.version} --json tagName,databaseId --repo ${process.env.GH_REPO}`.json()
  output.push(`release=${release.databaseId}`, `tag=${release.tagName}`, "published=false")
}

output.push(`repo=${process.env.GH_REPO}`)
if (process.env.GITHUB_OUTPUT) await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))

async function releaseNotes(source: string, strict: boolean) {
  const preparedFile = process.env.AIGCFROGE_RELEASE_NOTES_FILE
  const prepared = preparedFile
    ? await Bun.file(preparedFile)
        .text()
        .catch(() => "")
    : ""
  if (prepared.trim()) return prepared.trim()

  // Unattended releases do not send commit text to an agent with release credentials.
  const generated =
    process.env.AIGCFROGE_DETERMINISTIC_RELEASE_NOTES === "true"
      ? undefined
      : await $`bun script/changelog.ts --to ${source}`.quiet().nothrow()
  const body =
    generated?.exitCode === 0
      ? (
          await Bun.file(`${process.cwd()}/UPCOMING_CHANGELOG.md`)
            .text()
            .catch(() => "")
        ).trim()
      : ""
  if (body) return body
  const fallback = await $`bun script/raw-changelog.ts --to ${source}`.quiet().nothrow()
  const text =
    fallback.exitCode === 0
      ? fallback
          .text()
          .split("\n")
          .filter((line) => !line.startsWith("Last release:") && !line.startsWith("Target ref:"))
          .join("\n")
          .trim()
      : ""
  if (text) {
    const demoted = text
      .split("\n")
      .map((line) => (line.startsWith("## ") || line.startsWith("### ") ? `#${line}` : line))
      .join("\n")
    return `## English\n\n${demoted}\n\n## 中文\n\n> AI 双语说明不可用，以下为自动生成的提交清单，保留英文提交标题。\n\n${demoted}`
  }
  if (strict)
    throw new Release.Failure({ reason: `Release notes generation failed (fallback exit ${fallback.exitCode})` })
  return "## English\n\nNo notable changes.\n\n## 中文\n\n无重要变更。"
}
