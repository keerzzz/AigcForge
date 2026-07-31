import { describe, expect, test } from "bun:test"

// en + zh + zht are the only maintained locales (language policy, 2026-07-31).
// The other locales are frozen snapshots; missing keys fall back to English via
// the base-spread in packages/app/src/context/language.tsx, so they are not enforced.
const locales = [
  ["zh", () => import("./zh")],
  ["zht", () => import("./zht")],
] as const

const placeholders = (value: string) => Array.from(value.matchAll(/{{\s*([^}]+?)\s*}}/g), (match) => match[1]).sort()

describe("i18n parity", () => {
  for (const [locale, load] of locales) {
    test(`${locale} matches the English keys and placeholders`, async () => {
      const english: Readonly<Record<string, string>> = (await import("./en")).dict
      const dictionary: Readonly<Record<string, string>> = (await load()).dict

      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(english).sort())

      for (const key of Object.keys(english)) {
        expect(placeholders(dictionary[key])).toEqual(placeholders(english[key]))
      }
    })
  }
})
