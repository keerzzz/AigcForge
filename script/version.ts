#!/usr/bin/env bun

import { Script } from "@aigcfroge/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]
const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()
const strictReleaseNotes = process.env.AIGCFROGE_RELEASE_NOTES_STRICT === "true"

if (!Script.preview) {
  const changelog = await $`bun script/changelog.ts --to ${sha}`.cwd(process.cwd()).nothrow()
  if (strictReleaseNotes && changelog.exitCode !== 0) {
    throw new Error(`changelog generation failed with exit code ${changelog.exitCode}`)
  }
  const file = `${process.cwd()}/UPCOMING_CHANGELOG.md`
  const body = (await Bun.file(file)
    .text()
    .catch(() => "")).trim()
  if (strictReleaseNotes && !body) {
    throw new Error(`changelog generation produced no release notes: ${file}`)
  }
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const notesFile = `${dir}/aigcfroge-release-notes.txt`
  await Bun.write(notesFile, body || "No notable changes")
  await $`gh release create v${Script.version} -d --target ${sha} --title "v${Script.version}" --notes-file ${notesFile}`
  const release = await $`gh release view v${Script.version} --json tagName,databaseId`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
} else if (Script.channel === "beta") {
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --repo ${process.env.GH_REPO}`
  const release =
    await $`gh release view v${Script.version} --json tagName,databaseId --repo ${process.env.GH_REPO}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
