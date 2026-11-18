#!/usr/bin/env bun
// 改名桥 (Rename Bridge): normalize upstream `opencode` branding to `aigcfroge`.
// Spec: docs/research/upstream-v2-sync/2026-10-16-upstream-v2-desktop-alignment-plan.md §7
// Re-run this script after every upstream sync, BEFORE porting fork assets back.
//
// Core mappings (case-sensitive; every casing variant of the brand, confirmed against
// the fork's own rename commit 83e3651f6: AigcfrogePlugin, CustomizeAigcfrogeContent, ...):
//   OpenCode   -> AigcForge
//   Opencode   -> Aigcfroge
//   openCode   -> aigcfroge
//   OPENCODE_  -> AIGCFROGE_
//   OPENCODE   -> AIGCFROGE
//   opencode   -> aigcfroge
//
// Exemptions (third-party truth that must never be rewritten):
//   - external npm names containing "opencode": @opencode-ai/*, @opencode/sdk,
//     opencode-gitlab-auth (covers @gitlab/opencode-gitlab-auth), vite-plugin-opencode
//   - models-dev ecosystem data (snapshot + fixtures) keeps OPENCODE_API_KEY / provider id "opencode"
//   - lockfile (regenerated after trim), research evidence, this script
//
// Path renames: .opencode/ -> .aigcfroge/ plus any file/dir name containing
// opencode/OpenCode/OPENCODE, consistently with the content mapping (imports follow).
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")

const SKIP_FILES = new Set(["bun.lock", "script/rename-bridge.ts", "packages/core/src/models-dev/snapshot.txt"])
// Trees pruned by directory name during the walk.
const PRUNE_NAMES = new Set(["node_modules", ".git", ".turbo", ".codegraph"])
// Path-level exemptions (checked against repo-relative paths).
const SKIP_DIRS = [
  "docs/research/upstream-v2-sync",
  "packages/core/src/models-dev",
]

// Tokens protected from the three-segment mapping via sentinel substitution.
const SENTINELS = ["@opencode-ai/", "@opencode/sdk", "opencode-gitlab-auth", "vite-plugin-opencode", "OPENCODE_API_KEY"]

function transform(text: string) {
  for (let i = 0; i < SENTINELS.length; i++) text = text.replaceAll(SENTINELS[i]!, `\u0000${i}\u0000`)
  text = text.replaceAll("OpenCode", "AigcForge")
  text = text.replaceAll("Opencode", "Aigcfroge")
  text = text.replaceAll("openCode", "aigcfroge")
  text = text.replaceAll("OPENCODE_", "AIGCFROGE_")
  text = text.replaceAll("OPENCODE", "AIGCFROGE")
  text = text.replaceAll("opencode", "aigcfroge")
  for (let i = 0; i < SENTINELS.length; i++) text = text.replaceAll(`\u0000${i}\u0000`, SENTINELS[i]!)
  return text
}

// models-dev ecosystem fixtures keep provider id "opencode" / OPENCODE_API_KEY as-is;
// sibling fixtures (e.g. greeting.ts) are normal source and MUST be rewritten.
const isSkipped = (rel: string) =>
  SKIP_FILES.has(rel) ||
  SKIP_DIRS.some((dir) => rel === dir || rel.startsWith(dir + "/")) ||
  /^packages\/core\/test\/plugin\/fixtures\/models-dev.*\.json$/.test(rel)

// Walk the repo collecting files and directories, pruning excluded trees entirely.
function walk(dir: string, rel: string, files: string[], dirs: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (PRUNE_NAMES.has(entry.name)) continue
      dirs.push(childRel)
      walk(path.join(dir, entry.name), childRel, files, dirs)
    } else if (entry.isFile()) {
      files.push(childRel)
    }
  }
}

const files: string[] = []
const dirs: string[] = []
walk(root, "", files, dirs)

let filesChanged = 0
for (const rel of files) {
  if (isSkipped(rel)) continue
  const abs = path.join(root, rel)
  const bytes = fs.readFileSync(abs)
  if (bytes.subarray(0, 8000).includes(0)) continue // binary
  const source = bytes.toString("utf8")
  const result = transform(source)
  if (result !== source) {
    fs.writeFileSync(abs, result)
    filesChanged++
  }
}

// Path rename pass, shallowest first: a renamed directory carries its descendants,
// so any entry under a moved ancestor is skipped. Parent dirs of renamed files are
// guaranteed to exist (either untouched or already renamed by a shallower step).
const renameTargets = [...dirs, ...files]
  .filter((rel) => rel.split("/").some((s) => s.includes("opencode") || s.includes("OpenCode") || s.includes("OPENCODE")))
  .sort((a, b) => a.split("/").length - b.split("/").length)

let pathsRenamed = 0
const moved: string[] = []
for (const rel of renameTargets) {
  if (moved.some((m) => rel.startsWith(m + "/"))) continue
  const target = rel.split("/").map(transform).join("/")
  if (target === rel) continue
  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true })
  fs.renameSync(path.join(root, rel), path.join(root, target))
  moved.push(rel)
  pathsRenamed++
  console.log(`rename ${rel} -> ${target}`)
}

console.log(`\nrename-bridge: ${filesChanged} files rewritten, ${pathsRenamed} paths renamed`)
