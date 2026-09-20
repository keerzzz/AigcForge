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
import { expect } from "@playwright/test"
import { isRecord, stringField } from "./manifest"

const here = path.dirname(fileURLToPath(import.meta.url))
const e2eRoot = path.resolve(here, "..")
// The same slice grammar owns open, verified and deferred records.
const owner = /^S\d+[A-Z]?(\/S\d+[A-Z]?)?$/

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

export function readCoverageManifest() {
  const source = "e2e/coverage-manifest.json"
  const raw: unknown = JSON.parse(readFileSync(path.join(e2eRoot, "coverage-manifest.json"), "utf8"))
  if (!isRecord(raw)) throw new Error(`${source} is not an object`)
  if (!Array.isArray(raw.entries)) throw new Error(`${source} has no entries array`)
  if (!Array.isArray(raw.verified)) throw new Error(`${source} has no verified array`)
  if (!isRecord(raw.modes)) throw new Error(`${source} has no modes object`)
  if (!isRecord(raw.deferred)) throw new Error(`${source} has no deferred object`)
  const entries = raw.entries.map((entry, index) => entryOf(entry, `${source} entry ${index}`))
  const verified = raw.verified.map((entry, index) => entryOf(entry, `${source} verified ${index}`))
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
  return { entries, verified, modes, deferred }
}

export function entries(manifest = readCoverageManifest()) {
  const all = [...manifest.entries, ...manifest.verified]
  expect(all.length).toBeGreaterThan(0)
  expect(new Set(all.map((entry) => entry.id)).size, "ledger IDs are unique across open and verified").toBe(all.length)
  for (const entry of all) {
    for (const field of [
      "id",
      "spec",
      "test",
      "route",
      "mode",
      "layer",
      "failure",
      "platform",
      "owner",
      "unlock",
    ] as const) {
      expect(entry[field].trim().length, `${entry.id}.${field} is non-blank`).toBeGreaterThan(0)
    }
    expect(entry.owner, `${entry.id} owner is a slice`).toMatch(owner)
  }
  for (const entry of manifest.entries) {
    expect(entry.status, `${entry.id} open status`).toMatch(/^(red-fixme|flake-observed-once|red-stable)$/)
  }
  for (const entry of manifest.verified) {
    // Unit evidence may not be promoted to browser/backend coverage by changing one label.
    expect(entry.status, `${entry.id} verified status`).toBe("verified-unit")
    expect(entry.layer, `${entry.id} verified layer`).toBe("unit")
    expect(entry.platform, `${entry.id} verified platform`).toBe("bun")
    expect(entry.spec, `${entry.id} unit source`).toMatch(/^src\/.+\.test\.tsx?$/)
  }
}

export function quarantinedCases() {
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
  return fixmeCases
}

export function quarantine(manifest = readCoverageManifest(), fixmeCases = quarantinedCases()) {
  // The ledger may go empty — S7 un-quarantined the last three cases and they pass
  // (`composer-submit` two, `global-shell-presentation` one). What must never
  // happen is a fixme the manifest does not account for, so the loop below is the
  // assertion and the count is only reported for the reader.
  const manifestTitles = new Set(
    manifest.entries.filter((entry) => entry.status === "red-fixme").map((entry) => `${entry.spec}:${entry.test}`),
  )
  for (const fixme of fixmeCases) {
    expect(
      manifestTitles.has(`e2e/regression/${fixme.file}:${fixme.title}`),
      `fixme "${fixme.title}" in ${fixme.file} has a manifest entry`,
    ).toBe(true)
  }
  expect(fixmeCases.length, "quarantined cases currently open").toBe(
    manifest.entries.filter((entry) => entry.status === "red-fixme").length,
  )
}

export function modes(manifest = readCoverageManifest()) {
  const required = ["chat", "coding", "work", "assistant", "custom"]
  for (const mode of required) {
    const target = manifest.modes[mode]
    expect(target, `mode ${mode} has a coverage target`).toBeTruthy()
    expect(target.route.length, `mode ${mode} route`).toBeGreaterThan(0)
    expect(target.e3.length, `mode ${mode} E3 coverage`).toBeGreaterThan(0)
    expect(target.e4.length, `mode ${mode} E4 coverage`).toBeGreaterThan(0)
    expect(target.status, `mode ${mode} E4 status`).toMatch(/^(planned|negative-only|landed)$/)
  }
}

export function deferred(manifest = readCoverageManifest()) {
  const deferredKeys = Object.keys(manifest.deferred)
  expect(deferredKeys.length, "deferred scope is registered").toBeGreaterThan(0)
  for (const key of deferredKeys) {
    const entry = manifest.deferred[key]
    // Slices are labelled S9A/S9B/S9C in the plan, so the gate accepts the
    // optional suffix rather than forcing owners to drop it.
    expect(entry.owner, `deferred ${key} owner is a slice`).toMatch(owner)
    expect(entry.scope.trim().length, `deferred ${key} scope`).toBeGreaterThan(0)
    expect(entry.unlock.trim().length, `deferred ${key} unlock`).toBeGreaterThan(0)
  }
}

export * as Coverage from "./coverage"
