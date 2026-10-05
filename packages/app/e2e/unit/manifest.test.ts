import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { readManifest } from "../real/manifest"

const runDir = mkdtempSync(path.join(tmpdir(), "e4-manifest-"))
afterAll(() => rmSync(runDir, { recursive: true, force: true }))
const primary = {
  runDir,
  backendVersion: "fixture",
  providerBaseURL: "http://127.0.0.1:41001/v1",
  providerPort: 41001,
  backendPort: 41002,
  previewPort: 41003,
  backendUrl: "http://127.0.0.1:41002",
  previewUrl: "http://127.0.0.1:41003",
  configDir: path.join(runDir, "config"),
  dbPath: path.join(runDir, "e4.sqlite"),
  workspaceDir: path.join(runDir, "workspace"),
  v2Runtime: false,
  pid: 12345,
}
const peer = {
  backendVersion: "fixture",
  backendPort: 41004,
  backendUrl: "http://127.0.0.1:41004",
  configDir: path.join(runDir, "peer/config"),
  dbPath: path.join(runDir, "peer/e4.sqlite"),
  workspaceDir: path.join(runDir, "peer/workspace"),
}

test("single-backend manifest preserves the existing runtime contract", async () => {
  await Bun.write(path.join(runDir, "manifest.json"), JSON.stringify(primary))
  expect(readManifest(runDir)).toEqual({ ...primary, pgid: undefined })
})

test("dual-backend manifest retains both isolated backends for scopes and teardown", async () => {
  await Bun.write(path.join(runDir, "manifest.json"), JSON.stringify({ ...primary, peer }))
  expect(readManifest(runDir)).toEqual({ ...primary, peer, pgid: undefined })
})

test("malformed peer metadata fails instead of silently falling back to a single backend", async () => {
  for (const invalid of [null, {}, { ...peer, backendPort: "41004" }, { ...peer, dbPath: "" }]) {
    await Bun.write(path.join(runDir, "manifest.json"), JSON.stringify({ ...primary, peer: invalid }))
    expect(() => readManifest(runDir)).toThrow()
  }
})
