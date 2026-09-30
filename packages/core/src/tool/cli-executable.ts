import { existsSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { which } from "../util/which"

/** Resolve a user-installed CLI at the native SDK boundary, never our dependencies. */
export function resolve(command: "codex" | "claude", executable = which(command)) {
  if (!executable) throw new Error(`CLI "${command}" is not installed or could not be found on PATH`)
  const entry = realpathSync(executable)
  // SDKs spawn directly: a Windows npm .cmd/.bat shim is not an executable.
  if (!/\.(cmd|bat)$/i.test(entry)) return entry

  const local = createRequire(entry)
  const packageJson = local.resolve(
    command === "codex" ? "@openai/codex/package.json" : "@anthropic-ai/claude-code/package.json",
  )
  if (command === "claude") return requireFile(path.join(path.dirname(packageJson), "cli.js"))

  const platformPackage = createRequire(packageJson).resolve(`@openai/codex-win32-${process.arch}/package.json`)
  const triple = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  const vendor = path.join(path.dirname(platformPackage), "vendor", triple)
  const binary = path.join(vendor, "bin", "codex.exe")
  if (existsSync(binary)) return binary
  return requireFile(path.join(vendor, "codex", "codex.exe"))
}

function requireFile(file: string) {
  if (!existsSync(file)) throw new Error(`The local CLI installation is incomplete: ${file}`)
  return file
}

export * as CliExecutable from "./cli-executable"
