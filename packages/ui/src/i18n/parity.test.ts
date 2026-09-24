import { describe, expect, test } from "bun:test"

// en + zh are the only supported locales (language policy, 2026-09-23).
// The other locale files are frozen snapshots; they are no longer registered by
// the language provider, so they are not enforced here.
const locales = [["zh", () => import("./zh")]] as const

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
