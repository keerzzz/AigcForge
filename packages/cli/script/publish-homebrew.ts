#!/usr/bin/env bun
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

if (!process.argv.includes("--dry-run")) {
  throw new Error(
    "Omnixa Homebrew publication is disabled: no project-owned tap is configured. Use --dry-run to prepare a formula.",
  )
}

const { Script } = await import("@omnixa/script")

if (Script.channel !== "beta" && Script.channel !== "latest") {
  throw new Error("Homebrew publishing requires the beta or latest channel")
}
const valid =
  Script.channel === "beta"
    ? /^\d+\.\d+\.\d+-beta[.-]\d+(?:\.\d+)?$/.test(Script.version)
    : /^\d+\.\d+\.\d+$/.test(Script.version)
if (!valid) throw new Error(`Expected a ${Script.channel} release version`)

const dir = fileURLToPath(new URL("..", import.meta.url))
const root = path.resolve(process.env.OMNIXA_CLI_DIST ?? path.join(dir, "dist"))
const outdir = path.join(root, "homebrew-tap")
const name = Script.channel === "beta" ? "omnixa-beta" : "omnixa-v2"
const formulaClass = Script.channel === "beta" ? "OmnixaBeta" : "OmnixaV2"

const targets = await Promise.all(
  [
    { name: "darwin-arm64", archive: "zip" },
    { name: "darwin-x64-baseline", archive: "zip" },
    { name: "linux-arm64", archive: "tar.gz" },
    { name: "linux-x64-baseline", archive: "tar.gz" },
  ].map(async (target) => {
    const filename = `omnixa-${target.name}.${target.archive}`
    const file = Bun.file(path.join(root, filename))
    if (!(await file.exists()) || !file.size) throw new Error(`Missing Homebrew archive: ${filename}`)
    const sha256 = new Bun.CryptoHasher("sha256")
    for await (const chunk of file.stream()) sha256.update(chunk)
    return {
      ...target,
      url: `https://github.com/keerzzz/AigcForge/releases/download/v${encodeURIComponent(Script.version)}/${filename}`,
      sha256: sha256.digest("hex"),
    }
  }),
)

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const target = (name: string) => {
  const result = targets.find((item) => item.name === name)
  if (!result) throw new Error(`Missing Homebrew target: ${name}`)
  return result
}
const macArm = target("darwin-arm64")
const macIntel = target("darwin-x64-baseline")
const linuxArm = target("linux-arm64")
const linuxIntel = target("linux-x64-baseline")

await Bun.write(
  path.join(outdir, `${name}.rb`),
  [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    `class ${formulaClass} < Formula`,
    `  desc "Omnixa V2${Script.channel === "beta" ? " beta" : ""} - the AI coding agent for the terminal"`,
    '  homepage "https://github.com/keerzzz/AigcForge"',
    `  version "${Script.version}"`,
    '  license "MIT"',
    "",
    '  depends_on "ripgrep"',
    '  conflicts_with "omnixa", because: "both install an omnixa binary"',
    "",
    "  on_macos do",
    "    if Hardware::CPU.arm?",
    `      url "${macArm.url}"`,
    `      sha256 "${macArm.sha256}"`,
    "    else",
    `      url "${macIntel.url}"`,
    `      sha256 "${macIntel.sha256}"`,
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.arm?",
    `      url "${linuxArm.url}"`,
    `      sha256 "${linuxArm.sha256}"`,
    "    else",
    `      url "${linuxIntel.url}"`,
    `      sha256 "${linuxIntel.sha256}"`,
    "    end",
    "  end",
    "",
    "  def install",
    '    bin.install "omnixa"',
    "  end",
    "end",
    "",
  ].join("\n"),
)
console.log(`Prepared ${name} ${Script.version} in ${outdir}`)
