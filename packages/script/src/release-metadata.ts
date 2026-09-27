import { Schema } from "effect"
import path from "node:path"
import semver from "semver"
import { Release } from "./release"

export class File extends Schema.Class<File>("ReleaseMetadata.File")({
  url: Schema.String,
  sha512: Schema.String,
  size: Schema.Number,
  blockMapSize: Schema.optional(Schema.Number),
}) {}

export class Metadata extends Schema.Class<Metadata>("ReleaseMetadata.Metadata")({
  version: Schema.String,
  files: Schema.Array(File),
  releaseDate: Schema.String,
}) {}

export const names = ["latest.yml", "latest-linux.yml", "latest-linux-arm64.yml", "latest-mac.yml"] as const
const expected = [
  "aigcfroge-desktop-win-x64.exe",
  "aigcfroge-desktop-win-arm64.exe",
  "aigcfroge-desktop-linux-x86_64.AppImage",
  "aigcfroge-desktop-linux-arm64.AppImage",
  "aigcfroge-desktop-mac-arm64.zip",
]

export function parse(content: string) {
  let version = ""
  let releaseDate = ""
  const files: File[] = []
  let current: Record<string, unknown> | undefined
  const flush = () => {
    if (!current) return
    files.push(Release.decode(File, current, "update metadata file entry"))
    current = undefined
  }
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("version:")) {
      version = scalar(line.slice("version:".length).trim())
      continue
    }
    if (line.startsWith("releaseDate:")) {
      releaseDate = scalar(line.slice("releaseDate:".length).trim())
      continue
    }
    if (line.trim().startsWith("- url:")) {
      flush()
      current = { url: scalar(line.trim().slice("- url:".length).trim()) }
      continue
    }
    if (line.startsWith("    ") && current) {
      const field = line.trim().match(/^(sha512|size|blockMapSize):\s*(.*)$/)
      if (!field) throw new Release.Failure({ reason: "Unknown update metadata file field" })
      current[field[1]] = field[1] === "sha512" ? scalar(field[2]) : Number(field[2])
      continue
    }
    flush()
  }
  flush()
  return validate({ version, releaseDate, files })
}

function scalar(value: string) {
  if (value.startsWith('"')) return Release.json(Schema.String, value, "quoted metadata scalar")
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  return value
}

function validate(value: unknown) {
  const metadata = Release.decode(Metadata, value, "update metadata")
  if (semver.valid(metadata.version) !== metadata.version)
    throw new Release.Failure({ reason: "Invalid update metadata version" })
  if (!metadata.files.length || !Number.isFinite(Date.parse(metadata.releaseDate)))
    throw new Release.Failure({ reason: "Update metadata must contain files and a release date" })
  const urls = new Set<string>()
  for (const file of metadata.files) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file.url) || urls.has(file.url))
      throw new Release.Failure({ reason: "Invalid or duplicate update asset name" })
    urls.add(file.url)
    if (!Number.isSafeInteger(file.size) || file.size < 1 || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) {
      throw new Release.Failure({ reason: "Invalid update asset size or SHA-512" })
    }
    if (file.blockMapSize !== undefined && (!Number.isSafeInteger(file.blockMapSize) || file.blockMapSize < 1))
      throw new Release.Failure({ reason: "Invalid block map size" })
  }
  return metadata
}

export function serialize(value: unknown) {
  const data = validate(value)
  return [
    `version: ${data.version}`,
    "files:",
    ...data.files.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`,
      ...(file.blockMapSize ? [`    blockMapSize: ${file.blockMapSize}`] : []),
    ]),
    `releaseDate: '${data.releaseDate}'`,
    "",
  ].join("\n")
}

export async function hashes(file: string) {
  const sha256 = new Bun.CryptoHasher("sha256")
  const sha512 = new Bun.CryptoHasher("sha512")
  for await (const chunk of Bun.file(file).stream()) {
    sha256.update(chunk)
    sha512.update(chunk)
  }
  return { sha256: `sha256:${sha256.digest("hex")}`, sha512: sha512.digest("base64") }
}

export async function verify(
  metadataDir: string,
  artifactDir: string,
  target: string,
  assets: readonly Release.Asset[],
) {
  Release.version(target)
  const remote = new Map(assets.map((asset) => [asset.name, asset]))
  if (remote.size !== assets.length) throw new Release.Failure({ reason: "Duplicate release asset names" })
  const referenced = new Set<string>()
  for (const name of names) {
    const metadata = parse(await Bun.file(path.join(metadataDir, name)).text())
    if (metadata.version !== target) throw new Release.Failure({ reason: "Mixed versions in update metadata" })
    for (const entry of metadata.files) {
      referenced.add(entry.url)
      const file = Bun.file(path.join(artifactDir, entry.url))
      if (!(await file.exists()) || file.size !== entry.size)
        throw new Release.Failure({ reason: `Update asset missing or wrong size: ${entry.url}` })
      if ((await hashes(path.join(artifactDir, entry.url))).sha512 !== entry.sha512)
        throw new Release.Failure({ reason: `Update SHA-512 mismatch: ${entry.url}` })
    }
  }
  if (expected.some((name) => !referenced.has(name)))
    throw new Release.Failure({ reason: "Update metadata does not cover all five desktop targets" })
  const artifacts = [...new Bun.Glob("*").scanSync({ cwd: artifactDir, onlyFiles: true })].filter((name) =>
    /\.(?:exe|blockmap|dmg|zip|AppImage|deb|rpm|app\.tar\.gz)$/.test(name),
  )
  if (remote.size !== artifacts.length + names.length)
    throw new Release.Failure({ reason: "Release contains missing or stale assets from another run" })
  for (const name of [...artifacts, ...names]) {
    const file = path.join(names.some((item) => item === name) ? metadataDir : artifactDir, name)
    const asset = remote.get(name)
    if (
      !asset ||
      asset.state !== "uploaded" ||
      asset.size !== Bun.file(file).size ||
      asset.digest !== (await hashes(file)).sha256
    ) {
      throw new Release.Failure({ reason: `Remote release asset does not match this run: ${name}` })
    }
  }
  return { platforms: expected.length, assets: artifacts.length + names.length }
}

export * as ReleaseMetadata from "./release-metadata"
