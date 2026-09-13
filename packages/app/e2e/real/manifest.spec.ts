/**
 * Coverage manifest validator (plan §5.2). The manifest is machine-checked, not
 * prose: every entry carries route × mode × layer × failure × platform × owner
 * × unlock, every quarantined `test.fixme` case in the regression suite has an
 * entry (no silent quarantine), and all five modes declare their current
 * coverage so the E4 expansion in S5+ cannot silently skip a mode.
 *
 * This is a node-side structural check; no browser is needed, but running it in
 * the real project keeps the manifest gate on every E4 invocation.
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { isRecord, stringField } from "./manifest"

const here = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(here, "..")

interface ManifestEntry {
  id: string
  spec: string
  test: string
  layer: string
  route: string
  mode: string
  platform: string
  failure: string
  status: string
  owner: string
  unlock: string
}

interface ModeCoverage {
  route: string
  e3: string
  e4: string
  status: string
}

const entryOf = (value: unknown, source: string): ManifestEntry => {
  if (!isRecord(value)) throw new Error(`${source} is not an object`)
  return {
    id: stringField(value, "id", source),
    spec: stringField(value, "spec", source),
    test: stringField(value, "test", source),
    layer: stringField(value, "layer", source),
    route: stringField(value, "route", source),
    mode: stringField(value, "mode", source),
    platform: stringField(value, "platform", source),
    failure: stringField(value, "failure", source),
    status: stringField(value, "status", source),
    owner: stringField(value, "owner", source),
    unlock: stringField(value, "unlock", source),
  }
}

interface DeferredScope {
  owner: string
  scope: string
  unlock: string
}

function readCoverageManifest() {
  const source = "e2e/coverage-manifest.json"
  const raw: unknown = JSON.parse(readFileSync(path.join(e2eRoot, "coverage-manifest.json"), "utf8"))
  if (!isRecord(raw)) throw new Error(`${source} is not an object`)
  if (!Array.isArray(raw.entries)) throw new Error(`${source} has no entries array`)
  if (!isRecord(raw.modes)) throw new Error(`${source} has no modes object`)
  if (!isRecord(raw.deferred)) throw new Error(`${source} has no deferred object`)
  const entries = raw.entries.map((entry, index) => entryOf(entry, `${source} entry ${index}`))
  const modes: Record<string, ModeCoverage> = {}
  for (const [mode, value] of Object.entries(raw.modes)) {
    if (!isRecord(value)) throw new Error(`${source} modes.${mode} is not an object`)
    modes[mode] = {
      route: stringField(value, "route", `${source} modes.${mode}`),
      e3: stringField(value, "e3", `${source} modes.${mode}`),
      e4: stringField(value, "e4", `${source} modes.${mode}`),
      status: stringField(value, "status", `${source} modes.${mode}`),
    }
  }
  const deferred: Record<string, DeferredScope> = {}
  for (const [key, value] of Object.entries(raw.deferred)) {
    if (!isRecord(value)) throw new Error(`${source} deferred.${key} is not an object`)
    deferred[key] = {
      owner: stringField(value, "owner", `${source} deferred.${key}`),
      scope: stringField(value, "scope", `${source} deferred.${key}`),
      unlock: stringField(value, "unlock", `${source} deferred.${key}`),
    }
  }
  return { entries, modes, deferred }
}

const manifest = readCoverageManifest()

test("every manifest entry carries the full route × mode × layer × failure × platform contract", () => {
  expect(manifest.entries.length).toBeGreaterThan(0)
  for (const entry of manifest.entries) {
    for (const field of ["route", "mode", "layer", "failure", "platform", "owner", "unlock"] as const) {
      const value = entry[field]
      expect(typeof value, `${entry.id}.${field} is a string`).toBe("string")
      expect(value.length, `${entry.id}.${field} is non-empty`).toBeGreaterThan(0)
    }
    expect(entry.status, `${entry.id} status`).toMatch(/^(red-fixme|flake-observed-once|red-stable)$/)
    expect(entry.owner, `${entry.id} owner is a slice`).toMatch(/^S\d+(\/S\d+)?$/)
  }
})

test("every quarantined test.fixme case has a manifest entry — no silent quarantine", () => {
  const regressionDir = path.join(e2eRoot, "regression")
  // Matches double quotes, single quotes, and template literals; a title in an
  // unrecognised quote style must not silently escape the quarantine ledger.
  const fixmePattern = /test\.fixme\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g
  const fixmeCases: Array<{ file: string; title: string }> = []
  for (const file of readdirSync(regressionDir).filter((name) => name.endsWith(".spec.ts"))) {
    const source = readFileSync(path.join(regressionDir, file), "utf8")
    for (const match of source.matchAll(fixmePattern)) {
      fixmeCases.push({ file, title: match[2] })
    }
  }
  expect(fixmeCases.length, "there are quarantined cases to account for").toBeGreaterThan(0)
  const manifestTitles = new Set(manifest.entries.map((entry) => entry.test))
  for (const fixme of fixmeCases) {
    expect(manifestTitles.has(fixme.title), `fixme "${fixme.title}" in ${fixme.file} has a manifest entry`).toBe(true)
  }
})

test("all five modes declare their current coverage layer", () => {
  const required = ["chat", "coding", "work", "assistant", "custom"]
  for (const mode of required) {
    const target = manifest.modes[mode]
    expect(target, `mode ${mode} has a coverage target`).toBeTruthy()
    expect(target.route.length, `mode ${mode} route`).toBeGreaterThan(0)
    expect(target.e3.length, `mode ${mode} E3 coverage`).toBeGreaterThan(0)
    expect(target.e4.length, `mode ${mode} E4 coverage`).toBeGreaterThan(0)
    expect(target.status, `mode ${mode} E4 status`).toMatch(/^(planned|negative-only|landed)$/)
  }
})

test("no deferred scope may float without an owner and an unlock condition", () => {
  const deferredKeys = Object.keys(manifest.deferred)
  expect(deferredKeys.length, "deferred scope is registered").toBeGreaterThan(0)
  for (const key of deferredKeys) {
    const entry = manifest.deferred[key]
    expect(entry.owner, `deferred ${key} owner is a slice`).toMatch(/^S\d+(\/S\d+)?$/)
    expect(entry.scope.length, `deferred ${key} scope`).toBeGreaterThan(0)
    expect(entry.unlock.length, `deferred ${key} unlock`).toBeGreaterThan(0)
  }
})
