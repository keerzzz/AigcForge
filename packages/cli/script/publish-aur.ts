#!/usr/bin/env bun
import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

if (!process.argv.includes("--dry-run")) {
  throw new Error(
    "Omnixa AUR publication is disabled: no project-owned AUR package is configured. Use --dry-run to prepare package metadata.",
  )
}

const { Script } = await import("@omnixa/script")

if (Script.channel !== "beta" && Script.channel !== "latest") {
  throw new Error("AUR publishing requires the beta or latest channel")
}
const name = "omnixa-beta"
const command = "omnixa"
const valid =
  Script.channel === "beta"
    ? /^\d+\.\d+\.\d+-beta[.-]\d+(?:\.\d+)?$/.test(Script.version)
    : /^\d+\.\d+\.\d+$/.test(Script.version)
if (!valid) throw new Error(`Expected a ${Script.channel} release version`)

const dir = fileURLToPath(new URL("..", import.meta.url))
const root = path.resolve(process.env.OMNIXA_CLI_DIST ?? path.join(dir, "dist"))
const outdir = path.join(root, `aur-${name}`)
const pkgver = Script.version.replaceAll("-", ".")
const license = Bun.file(path.join(dir, "..", "..", "LICENSE"))
const shim = `#!/bin/sh
exec "$(dirname "$0")/omnixa" "$@"
`

await rm(outdir, { recursive: true, force: true })
await mkdir(path.dirname(outdir), { recursive: true })
await mkdir(outdir)

const sources = await Promise.all(
  [
    { arch: "x86_64", target: "linux-x64-baseline" },
    { arch: "aarch64", target: "linux-arm64" },
  ].map(async (item) => {
    const directory = path.join(root, `cli-${item.target}`)
    const pkg: { name: string; version: string } = await Bun.file(path.join(directory, "package.json")).json()
    if (pkg.version !== Script.version) throw new Error(`Unexpected version for ${pkg.name}: ${pkg.version}`)
    const archive = Bun.file(path.join(directory, `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`))
    const filename = `${name}-${pkgver}-${item.arch}.tgz`
    const url = `https://registry.npmjs.org/${pkg.name}/-/${pkg.name.split("/").at(-1)}-${pkg.version}.tgz`
    const sha256 = new Bun.CryptoHasher("sha256").update(await archive.arrayBuffer()).digest("hex")
    return [`source_${item.arch}=('${filename}::${url}')`, `sha256sums_${item.arch}=('${sha256}')`].join("\n")
  }),
)

await Bun.write(path.join(outdir, "LICENSE"), license)
await Bun.write(path.join(outdir, "omnixa2"), shim)
await Bun.write(
  path.join(outdir, "PKGBUILD"),
  [
    "# Maintainer: Dax <mail@thdxr.com>",
    `pkgname=${name}`,
    `pkgver=${pkgver}`,
    "pkgrel=1",
    "pkgdesc='Omnixa beta - the AI coding agent for the terminal'",
    "url='https://github.com/keerzzz/AigcForge'",
    "arch=('x86_64' 'aarch64')",
    "license=('MIT')",
    "depends=('glibc' 'gcc-libs' 'ripgrep')",
    `provides=('${command}' 'omnixa2')`,
    `conflicts=('${command}' 'omnixa2')`,
    // Stripping a compiled Bun executable can damage its embedded application.
    "options=('!strip' '!debug')",
    "source=('LICENSE' 'omnixa2')",
    `sha256sums=('${new Bun.CryptoHasher("sha256").update(await license.arrayBuffer()).digest("hex")}' '${new Bun.CryptoHasher("sha256").update(shim).digest("hex")}')`,
    ...sources,
    "",
    "package() {",
    `  install -Dm755 "$srcdir/package/bin/omnixa" "$pkgdir/usr/bin/${command}"`,
    '  install -Dm755 "$srcdir/omnixa2" "$pkgdir/usr/bin/omnixa2"',
    '  install -Dm644 "$srcdir/LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"',
    "}",
    "",
  ].join("\n"),
)
await Bun.write(path.join(outdir, ".SRCINFO"), await $`makepkg --printsrcinfo`.cwd(outdir).text())
console.log(`Prepared ${name} ${pkgver} in ${outdir}`)
