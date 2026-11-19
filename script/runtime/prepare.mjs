import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const version = /^bun@(\d+\.\d+\.\d+)$/.exec(
  JSON.parse(await readFile(join(root, "package.json"), "utf8")).packageManager,
)?.[1]
if (!version) throw new Error("Root packageManager must declare an exact bun@x.y.z version")
if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("This project runtime launcher supports Linux x64; use the existing setup-bun action in CI")
}

const cache = join(root, ".cache", "bun", version, "linux-x64-baseline")
const bin = join(cache, "bin")
if (existsSync(bin)) {
  requireRuntime(bin)
  console.log(bin)
  process.exit(0)
}

await mkdir(dirname(cache), { recursive: true })
const temporary = await mkdtemp(join(dirname(cache), ".prepare-"))
try {
  const name = "@oven/bun-linux-x64-baseline"
  const metadataResponse = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, {
    signal: AbortSignal.timeout(15000),
  })
  if (!metadataResponse.ok) throw new Error(`Bun metadata download failed: HTTP ${metadataResponse.status}`)
  const metadata = await metadataResponse.json()
  if (
    metadata.name !== name ||
    metadata.version !== version ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.dist?.integrity)
  ) {
    throw new Error("Official Bun package metadata does not match the requested version or SHA512 integrity")
  }
  const url = new URL(metadata.dist.tarball)
  if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") {
    throw new Error("Bun archive URL must use the official HTTPS npm registry")
  }

  console.error(`Preparing project Bun ${version} (${name})`)
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Bun archive download failed: HTTP ${response.status}`)
  const archive = Buffer.from(await response.arrayBuffer())
  const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`
  if (integrity !== metadata.dist.integrity) throw new Error("Bun archive SHA512 integrity verification failed")
  await writeFile(join(temporary, "bun.tgz"), archive)
  await mkdir(join(temporary, "bin"))
  const extracted = spawnSync(
    "tar",
    ["-xzf", join(temporary, "bun.tgz"), "--strip-components=2", "-C", join(temporary, "bin"), "package/bin/bun"],
    {
      stdio: "inherit",
      timeout: 30000,
    },
  )
  if (extracted.error) throw extracted.error
  if (extracted.status !== 0) throw new Error(`Bun archive extraction failed: exit ${extracted.status}`)
  await chmod(join(temporary, "bin", "bun"), 0o755)
  // Bun selects bunx behavior from argv[0], as in its official npm installer.
  await symlink("bun", join(temporary, "bin", "bunx"))
  requireRuntime(join(temporary, "bin"))
  await writeFile(
    join(temporary, "integrity.json"),
    `${JSON.stringify({ name, version, integrity, tarball: url.href }, null, 2)}\n`,
  )
  await rm(join(temporary, "bun.tgz"))
  await rename(temporary, cache)
  console.error(`Verified and installed project Bun ${version}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
console.log(bin)

function requireRuntime(directory) {
  const result = spawnSync(join(directory, "bun"), ["--version"], { encoding: "utf8", timeout: 10000 })
  if (result.error) throw result.error
  if (result.status !== 0 || result.stdout.trim() !== version || !existsSync(join(directory, "bunx"))) {
    throw new Error(`Invalid project Bun cache at ${directory}; remove that cache directory and retry`)
  }
}
