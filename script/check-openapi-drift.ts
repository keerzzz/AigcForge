#!/usr/bin/env bun

import { mkdtemp, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { OpenApi } from "@aigcfroge/script/openapi"

const snapshotPath = path.resolve("packages/sdk/openapi.json")

async function renderDiff(tempPath: string): Promise<string> {
  try {
    const diff = Bun.spawn(["diff", "-u", snapshotPath, tempPath], { stdout: "pipe", stderr: "pipe" })
    const [out, errOut] = await Promise.all([
      new Response(diff.stdout).text(),
      new Response(diff.stderr).text(),
      diff.exited,
    ])
    return out || errOut || "(`diff` produced no output; snapshot differs byte-for-byte)"
  } catch {
    return "(`diff` unavailable; snapshot differs byte-for-byte)"
  }
}

async function main(): Promise<number> {
  const generated = await OpenApi.generateOpenApiSpec()
  const snapshot = Bun.file(snapshotPath)
  if (!(await snapshot.exists())) {
    console.error(`OpenAPI snapshot missing: ${snapshotPath}`)
    return 1
  }

  if ((await snapshot.text()) === generated) {
    console.log("OpenAPI snapshot is up to date.")
    return 0
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), "aigcfroge-openapi-"))
  try {
    const tempPath = path.join(tmp, "openapi.json")
    await writeFile(tempPath, generated)
    console.error("OpenAPI snapshot drift detected. Regenerate with:\n  bun run script/generate.ts\n")
    console.error(await renderDiff(tempPath))
    return 1
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(`OpenAPI drift check failed: ${error instanceof Error ? error.message : String(error)}`)
  return 1
})
