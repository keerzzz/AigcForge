#!/usr/bin/env bun

import { rm } from "fs/promises"
import path from "path"
import { parseArgs } from "util"

const root = path.resolve(import.meta.dir, "..")
const file = path.join(root, "UPCOMING_CHANGELOG.md")
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    from: { type: "string", short: "f" },
    to: { type: "string", short: "t" },
    model: { type: "string" },
    variant: { type: "string", default: "low" },
    quiet: { type: "boolean", default: false },
    print: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
})
const args = [...positionals]

if (values.from) args.push("--from", values.from)
if (values.to) args.push("--to", values.to)

if (values.help) {
  console.log(`
Usage: bun script/changelog.ts [options]

Generates UPCOMING_CHANGELOG.md through the V2 CLI and the release-notes template.

Options:
  -f, --from <version>   Starting version (default: latest non-draft GitHub release)
  -t, --to <ref>         Ending ref (default: HEAD)
      --model <name>     Model in provider/model or provider/model#variant form
      --variant <name>   Variant for a model without #variant (default: low)
      --quiet            Suppress aigcfroge command output unless it fails
      --print            Print the generated UPCOMING_CHANGELOG.md after success
  -h, --help             Show this help message

Examples:
  bun script/changelog.ts
  bun script/changelog.ts --from 1.0.200
  bun script/changelog.ts -f 1.0.200 -t 1.0.205
`)
  process.exit(0)
}

const quiet = values.quiet
const bunBin = process.argv[0] || "bun"
const raw = Bun.spawn([bunBin, path.join(root, "script/raw-changelog.ts"), ...args], {
  cwd: root,
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
})
const [input, diagnostics, inputExit] = await Promise.all([
  new Response(raw.stdout).text(),
  new Response(raw.stderr).text(),
  raw.exited,
])
if (inputExit !== 0) {
  if (diagnostics) process.stderr.write(diagnostics)
  process.exit(inputExit)
}

const template = await Bun.file(path.join(root, ".aigcfroge/command/changelog.md")).text()
const marker = "!`bun script/raw-changelog.ts $ARGUMENTS`"
if (!template.includes(marker)) throw new Error("Changelog template is missing its structured input marker")
const prompt = template.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").replace(marker, () => input)
const cmd = [bunBin, path.join(root, "packages/cli/src/index.ts"), "run", "--standalone", "--agent", "build"]
if (values.model) cmd.push("--model", values.model.includes("#") ? values.model : `${values.model}#${values.variant}`)
cmd.push(prompt)

await rm(file, { force: true })

const proc = Bun.spawn(cmd, {
  cwd: root,
  stdin: "ignore",
  stdout: quiet ? "pipe" : "inherit",
  stderr: quiet ? "pipe" : "inherit",
})

const [out, err] = quiet
  ? await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  : ["", ""]
const code = await proc.exited
if (code === 0) {
  if (values.print) process.stdout.write(await Bun.file(file).text())
  process.exit(0)
}

if (quiet) {
  if (out) process.stdout.write(out)
  if (err) process.stderr.write(err)
}

process.exit(code)
