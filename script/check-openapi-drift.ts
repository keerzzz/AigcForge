#!/usr/bin/env bun

import { mkdtemp, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { generateOpenApiSpec } from "@aigcfroge/script/openapi"

const snapshotPath = path.resolve("packages/sdk/openapi.json")
const tmp = await mkdtemp(path.join(os.tmpdir(), "aigcfroge-openapi-"))

try {
  const tempPath = path.join(tmp, "openapi.json")
  await writeFile(tempPath, await generateOpenApiSpec())

  const snapshot = Bun.file(snapshotPath)
  if (!(await snapshot.exists())) {
    console.error(`OpenAPI snapshot missing: ${snapshotPath}`)
    process.exit(1)
  }

  const [snapshotText, tempText] = await Promise.all([snapshot.text(), Bun.file(tempPath).text()])
  if (snapshotText === tempText) {
    console.log("OpenAPI snapshot is up to date.")
    process.exit(0)
  }

  // `diff -u` is the standard Linux/CI tool; absence degrades to a readable
  // marker rather than a false green.
  const diff = Bun.spawn(["diff", "-u", snapshotPath, tempPath], { stdout: "pipe", stderr: "pipe" })
  const [out, errOut] = await Promise.all([new Response(diff.stdout).text(), new Response(diff.stderr).text()])
  await diff.exited
  console.error(`OpenAPI snapshot drift detected. Regenerate with:\n  bun run script/generate.ts\n`)
  console.error(out || errOut || "(`diff` unavailable; snapshot differs byte-for-byte)")
  process.exit(1)
} finally {
  await rm(tmp, { recursive: true, force: true })
}
