import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { readWindowSnapshot } from "./window-snapshot"
import { migrateDatabase } from "./migration"

const roots: string[] = []

// Bun's node:sqlite shim can retain file handles on Windows after close; only these owned test directories are removed.
afterEach(() =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }).catch(() => undefined))),
)

test.each(["missing", "unreadable"])("a $s database distinguishes default enable state from unknown", async (input) => {
  const root = await mkdtemp(path.join(tmpdir(), "omnixa-window-snapshot-"))
  roots.push(root)

  if (input === "unreadable") await Bun.write(path.join(root, "drafts.sqlite"), "not a SQLite database")

  expect(readWindowSnapshot(root, ["shell"])).toEqual(
    input === "missing" ? { storage: {}, extensions: [] } : { storage: {} },
  )
})

test.each([{ invalidID: false }, { invalidID: true }])(
  "the early snapshot keeps valid rows with invalid id $invalidID",
  async (input) => {
    const root = await mkdtemp(path.join(tmpdir(), "omnixa-window-snapshot-"))
    roots.push(root)
    const db = new DatabaseSync(path.join(root, "drafts.sqlite"))
    migrateDatabase(db)
    db.prepare("INSERT INTO state (name, key, value, updated_at) VALUES (?, ?, ?, 0)").run("shell", "theme", "dark")
    db.prepare("INSERT INTO extension (id, enabled) VALUES (?, ?)").run("previous", 0)
    db.prepare("INSERT INTO extension (id, enabled) VALUES (?, ?)").run("current", 1)
    if (input.invalidID) db.prepare("INSERT INTO extension (id, enabled) VALUES (?, ?)").run(new Uint8Array([1]), 0)
    db.close()

    expect(readWindowSnapshot(root, ["shell"])).toEqual({
      storage: { shell: { items: { theme: "dark" }, revision: 0 } },
      extensions: [
        { id: "previous", enabled: false },
        { id: "current", enabled: true },
      ],
    })
  },
)

test.each([
  { field: "key", key: new Uint8Array([1]), value: "dark" },
  { field: "value", key: "theme", value: new Uint8Array([2]) },
])("a non-text state $field returns the failed-read snapshot", async (input) => {
  const root = await mkdtemp(path.join(tmpdir(), "omnixa-window-snapshot-"))
  roots.push(root)
  const db = new DatabaseSync(path.join(root, "drafts.sqlite"))
  migrateDatabase(db)
  const rows = db.prepare("INSERT INTO state (name, key, value, updated_at) VALUES (?, ?, ?, 0)")
  rows.run("shell", "valid", "retained")
  rows.run("shell", input.key, input.value)
  db.close()

  expect(readWindowSnapshot(root, ["shell"])).toEqual({ storage: {} })
})
