import { expect, test } from "bun:test"
import { Coverage } from "../real/coverage"

// One real disk snapshot per collection, shared by all pure ledger assertions.
const manifest = Coverage.readCoverageManifest()
const quarantined = Coverage.quarantinedCases()

test("coverage ledger entries", () => Coverage.entries(manifest))
test("coverage ledger quarantine", () => Coverage.quarantine(manifest, quarantined))
test("coverage ledger modes", () => Coverage.modes(manifest))
test("coverage ledger deferred owners and unlocks", () => Coverage.deferred(manifest))

test("verified unit evidence is retained, never relabelled as an open defect", () => {
  expect(manifest.verified.map((entry) => entry.id)).toContain("picker-funnel-validation-unit-only")
  expect(() =>
    Coverage.entries({ ...manifest, entries: [...manifest.entries, ...manifest.verified], verified: [] }),
  ).toThrow()
})

test("verified records require a unit status, layer, platform and source", () => {
  for (const change of [
    { status: "green" },
    { status: "red-stable" },
    { layer: "E4" },
    { layer: "E3" },
    { platform: "chromium" },
    { spec: "e2e/real/session-turn.spec.ts" },
  ]) {
    expect(() =>
      Coverage.entries({ ...manifest, verified: manifest.verified.map((entry) => ({ ...entry, ...change })) }),
    ).toThrow()
  }
})

test("one owner rule and non-blank unlock apply to all ledger sections", () => {
  for (const change of [{ owner: "" }, { owner: "unassigned" }, { unlock: "  " }]) {
    expect(() =>
      Coverage.entries({ ...manifest, entries: manifest.entries.map((entry) => ({ ...entry, ...change })) }),
    ).toThrow()
    expect(() =>
      Coverage.entries({ ...manifest, verified: manifest.verified.map((entry) => ({ ...entry, ...change })) }),
    ).toThrow()
    expect(() =>
      Coverage.deferred({
        ...manifest,
        deferred: { probe: { scope: "runtime not run", owner: "S10", unlock: "approved isolated host", ...change } },
      }),
    ).toThrow()
  }
})

test("unknown open states, duplicate IDs and silent quarantine fail closed", () => {
  expect(() =>
    Coverage.entries({ ...manifest, entries: manifest.entries.map((entry) => ({ ...entry, status: "green" })) }),
  ).toThrow()
  expect(() => Coverage.entries({ ...manifest, verified: [...manifest.verified, ...manifest.verified] })).toThrow()
  expect(() =>
    Coverage.quarantine(
      { ...manifest, entries: manifest.entries.map((entry) => ({ ...entry, status: "red-fixme" })) },
      quarantined,
    ),
  ).toThrow()
})
