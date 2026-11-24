import { $ } from "bun"
import { chmod, copyFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = Bun.env.OMNIXA_CHANNEL

  if (raw === "dev" || raw === "beta" || raw === "prod") return raw

  if (raw === "latest") return "prod"

  return "dev"
}

export const CLI_BINARIES: Array<{ target: string; package: string; os: string; cpu: string }> = [
  {
    target: "aarch64-apple-darwin",
    package: "@omnixa/cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
  },
  {
    target: "x86_64-apple-darwin",
    package: "@omnixa/cli-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64",
  },
  {
    target: "aarch64-pc-windows-msvc",
    package: "@omnixa/cli-windows-arm64",
    os: "win32",
    cpu: "arm64",
  },
  {
    target: "x86_64-pc-windows-msvc",
    package: "@omnixa/cli-windows-x64-baseline",
    os: "win32",
    cpu: "x64",
  },
  {
    target: "x86_64-unknown-linux-gnu",
    package: "@omnixa/cli-linux-x64-baseline",
    os: "linux",
    cpu: "x64",
  },
  {
    target: "aarch64-unknown-linux-gnu",
    package: "@omnixa/cli-linux-arm64",
    os: "linux",
    cpu: "arm64",
  },
]

export const CLI_TARGET = Bun.env.OMNIXA_CLI_TARGET

function nativeTarget() {
  const { platform, arch } = process

  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"

  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"

  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export function getCurrentCli(target = CLI_TARGET ?? nativeTarget()) {
  const binaryConfig = CLI_BINARIES.find((item) => item.target === target)

  if (!binaryConfig) throw new Error(`CLI configuration not available for target '${target}'`)

  return binaryConfig
}

export function downloadCliToResources(version = "dev", dest = windowsify("resources/omnixa-cli")) {
  throw new Error(
    `Bundled CLI download ${version} to ${dest} is disabled: no supported project-owned download source is configured. Set OMNIXA_CLI_DIST to a locally built distribution for packaging, or use the CLI source in desktop development.`,
  )
}

export async function copyBuiltCliToResources(root: string, dest = windowsify("resources/omnixa-cli")) {
  const cli = getCurrentCli()
  const directory = cli.package.replace("@omnixa/", "")
  await copyCliToResources(join(root, directory), dest)
}

// The package directory is an npm package: its package.json version is the string the executable
// prints for --version. Writing it next to the executable spares the desktop a ~400 ms spawn of the
// 200 MB binary on first launch.
async function copyCliToResources(pkg: string, dest: string) {
  const cli = getCurrentCli()
  await copyFile(join(pkg, "bin", cli.os === "win32" ? "omnixa.exe" : "omnixa"), dest)
  await prepareCli(dest)
  const manifest = (await Bun.file(join(pkg, "package.json")).json()) as { version?: string }

  if (!manifest.version) throw new Error(`Bundled CLI package has no version: ${pkg}`)
  await Bun.write(versionFile(dest), manifest.version)
}

export function versionFile(cli: string) {
  return join(dirname(cli), "omnixa-cli.version")
}

async function prepareCli(dest: string) {
  if (process.platform !== "win32") await chmod(dest, 0o755)

  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }

  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path

  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
