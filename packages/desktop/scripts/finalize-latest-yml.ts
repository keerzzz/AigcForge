#!/usr/bin/env bun

import { $ } from "bun"
import { ReleaseMetadata } from "@aigcfroge/script/release-metadata"
import path from "path"

const dir = process.env.LATEST_YML_DIR!
if (!dir) throw new Error("LATEST_YML_DIR is required")

const repo = process.env.GH_REPO
if (!repo) throw new Error("GH_REPO is required")

const version = process.env.AIGCFROGE_VERSION
if (!version) throw new Error("AIGCFROGE_VERSION is required")

async function read(subdir: string, filename: string): Promise<ReleaseMetadata.Metadata | undefined> {
  const file = Bun.file(path.join(dir, subdir, filename))
  if (!(await file.exists())) return undefined
  return ReleaseMetadata.parse(await file.text())
}

const output: Record<string, string> = {}

// Windows: merge arm64 + x64 into single file
const winX64 = await read("latest-yml-x86_64-pc-windows-msvc", "latest.yml")
const winArm64 = await read("latest-yml-aarch64-pc-windows-msvc", "latest.yml")
if (winX64 || winArm64) {
  const base = winArm64 ?? winX64!
  output["latest.yml"] = ReleaseMetadata.serialize({
    version: base.version,
    files: [...(winArm64?.files ?? []), ...(winX64?.files ?? [])],
    releaseDate: base.releaseDate,
  })
}

// Linux x64: pass through
const linuxX64 = await read("latest-yml-x86_64-unknown-linux-gnu", "latest-linux.yml")
if (linuxX64) output["latest-linux.yml"] = ReleaseMetadata.serialize(linuxX64)

// Linux arm64: pass through
const linuxArm64 = await read("latest-yml-aarch64-unknown-linux-gnu", "latest-linux-arm64.yml")
if (linuxArm64) output["latest-linux-arm64.yml"] = ReleaseMetadata.serialize(linuxArm64)

// macOS: merge arm64 + x64 into single file
const macX64 = await read("latest-yml-x86_64-apple-darwin", "latest-mac.yml")
const macArm64 = await read("latest-yml-aarch64-apple-darwin", "latest-mac.yml")
if (macX64 || macArm64) {
  const base = macArm64 ?? macX64!
  output["latest-mac.yml"] = ReleaseMetadata.serialize({
    version: base.version,
    files: [...(macArm64?.files ?? []), ...(macX64?.files ?? [])],
    releaseDate: base.releaseDate,
  })
}

// Upload to release
const tag = `v${version}`
const tmp = process.env.RUNNER_TEMP ?? "/tmp"

for (const [filename, content] of Object.entries(output)) {
  const filepath = path.join(tmp, filename)
  await Bun.write(filepath, content)
  await $`gh release upload ${tag} ${filepath} --clobber --repo ${repo}`
  console.log(`uploaded ${filename}`)
}

console.log("finalized latest yml files")
