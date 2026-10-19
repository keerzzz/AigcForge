import fs from "node:fs"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { CliExecutable } from "@aigcfroge/core/tool/cli-executable"
import { tmpdir } from "./fixture/tmpdir"

async function withTmp<T>(use: (directory: string) => T): Promise<T> {
  await using tmp = await tmpdir()
  return use(tmp.path)
}

function writeFile(file: string, content = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function writeJson(file: string, value: unknown) {
  writeFile(file, JSON.stringify(value))
}

function writeShim(directory: string, name: "claude" | "codex", extension: "cmd" | "bat") {
  const shim = path.join(directory, "node_modules", ".bin", `${name}.${extension}`)
  writeFile(shim, "@echo off\r\n")
  return shim
}

function writeClaudePackage(directory: string) {
  const packageDirectory = path.join(directory, "node_modules", "@anthropic-ai", "claude-code")
  writeJson(path.join(packageDirectory, "package.json"), { name: "@anthropic-ai/claude-code" })
  const cli = path.join(packageDirectory, "cli.js")
  writeFile(cli, "console.log('claude')\n")
  return cli
}

function writeCodexPackage(directory: string, layout: "bin" | "legacy") {
  const packageDirectory = path.join(directory, "node_modules", "@openai", "codex")
  writeJson(path.join(packageDirectory, "package.json"), { name: "@openai/codex" })

  const platformName = `codex-win32-${process.arch}`
  const platformDirectory = path.join(directory, "node_modules", "@openai", platformName)
  writeJson(path.join(platformDirectory, "package.json"), { name: `@openai/${platformName}` })

  const triple = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  const binary =
    layout === "bin"
      ? path.join(platformDirectory, "vendor", triple, "bin", "codex.exe")
      : path.join(platformDirectory, "vendor", triple, "codex", "codex.exe")
  writeFile(binary)
  return binary
}

describe("CliExecutable", () => {
  test("throws when no executable is found", () => {
    expect(() => CliExecutable.resolve("codex", null)).toThrow(
      'CLI "codex" is not installed or could not be found on PATH',
    )
  })

  test.skipIf(process.platform === "win32")("resolves native symlinks to their real path", () =>
    withTmp((directory) => {
      const target = path.join(directory, "codex-native")
      const link = path.join(directory, "codex")
      writeFile(target)
      fs.symlinkSync(target, link)
      expect(CliExecutable.resolve("codex", link)).toBe(fs.realpathSync(target))
    }),
  )

  for (const extension of ["cmd", "bat"] as const) {
    test(`resolves a Claude npm .${extension} shim from the user package tree`, () =>
      withTmp((directory) => {
        const shim = writeShim(directory, "claude", extension)
        const cli = writeClaudePackage(directory)
        expect(CliExecutable.resolve("claude", shim)).toBe(cli)
      }))
  }

  test("resolves the new Codex platform binary layout", () =>
    withTmp((directory) => {
      const shim = writeShim(directory, "codex", "cmd")
      const binary = writeCodexPackage(directory, "bin")
      expect(CliExecutable.resolve("codex", shim)).toBe(binary)
    }))

  test("resolves the legacy Codex platform binary layout", () =>
    withTmp((directory) => {
      const shim = writeShim(directory, "codex", "bat")
      const binary = writeCodexPackage(directory, "legacy")
      expect(CliExecutable.resolve("codex", shim)).toBe(binary)
    }))

  test("does not fall back to the application's installed package for an unrelated shim", () =>
    withTmp((directory) => {
      const shim = path.join(directory, "unrelated.cmd")
      writeFile(shim, "@echo off\r\n")
      expect(() => CliExecutable.resolve("codex", shim)).toThrow()
    }))
})
