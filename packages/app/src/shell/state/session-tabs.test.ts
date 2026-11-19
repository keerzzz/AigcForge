import { expect, test } from "bun:test"
import { closeSessionTab, openSessionTab, previewSessionTab, type SessionTabState } from "./session-tabs"

const OPEN = "file:open"

const launchers = new Set([OPEN])

const state = (all: string[], active?: string, preview?: string): SessionTabState => ({
  tabs: { all, active },
  preview,
})

test.each([
  {
    name: "preview appends the Open File placeholder",
    run: () => previewSessionTab(state(["file://a.ts"], "file://a.ts"), OPEN),
    expected: state(["file://a.ts", OPEN], OPEN, OPEN),
  },
  {
    name: "preview replaces the current preview in place",
    run: () => previewSessionTab(state(["context", OPEN, "file://b.ts"], OPEN, OPEN), "file://a.ts"),
    expected: state(["context", "file://a.ts", "file://b.ts"], "file://a.ts", "file://a.ts"),
  },
  {
    name: "preview activates a durable tab without duplicating it",
    run: () => previewSessionTab(state(["file://a.ts", OPEN, "file://b.ts"], OPEN, OPEN), "file://b.ts"),
    expected: state(["file://a.ts", "file://b.ts"], "file://b.ts"),
  },
  {
    name: "preview replaces a restored Open File placeholder",
    run: () => previewSessionTab(state(["file://a.ts", OPEN], OPEN), "file://b.ts", launchers),
    expected: state(["file://a.ts", "file://b.ts"], "file://b.ts", "file://b.ts"),
  },
  {
    name: "open pins the current preview",
    run: () => openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "file://a.ts"),
    expected: state(["file://a.ts"], "file://a.ts"),
  },
  {
    name: "open replaces a preview with a directly opened file",
    run: () => openSessionTab(state(["file://a.ts"], "file://a.ts", "file://a.ts"), "file://b.ts"),
    expected: state(["file://b.ts"], "file://b.ts"),
  },
  {
    name: "open replaces a restored Open File placeholder",
    run: () => openSessionTab(state(["file://a.ts", OPEN], OPEN), "file://b.ts", launchers),
    expected: state(["file://a.ts", "file://b.ts"], "file://b.ts"),
  },
  {
    name: "open replaces the selected launcher and retains a different file preview",
    run: () =>
      openSessionTab(
        state(["file://a.ts", OPEN, "launcher:new"], "launcher:new", "file://a.ts"),
        "management:main",
        new Set([OPEN, "launcher:new"]),
      ),
    expected: state(["file://a.ts", OPEN, "management:main"], "management:main", "file://a.ts"),
  },
  {
    name: "reusing a module removes the selected launcher and keeps the unrelated preview",
    run: () =>
      openSessionTab(
        state(["management:main", "file://a.ts", "launcher:new"], "launcher:new", "file://a.ts"),
        "management:main",
        new Set(["launcher:new"]),
      ),
    expected: state(["management:main", "file://a.ts"], "management:main", "file://a.ts"),
  },
  {
    name: "close clears preview metadata and selects the left neighbor",
    run: () =>
      closeSessionTab(
        state(["file://a.ts", "file://b.ts", "file://c.ts"], "file://b.ts", "file://b.ts"),
        "file://b.ts",
      ),
    expected: state(["file://a.ts", "file://c.ts"], "file://a.ts"),
  },
  {
    name: "opening a first tab consumes the selected launcher and preserves the original preview",
    run: () =>
      openSessionTab(
        state(["file://a.ts", "launcher:new"], "launcher:new", "file://a.ts"),
        "context:main",
        new Set(["launcher:new"]),
        true,
      ),
    expected: state(["context:main", "file://a.ts"], "context:main", "file://a.ts"),
  },
  {
    name: "reusing a first tab clears the selected launcher preview",
    run: () =>
      openSessionTab(state(["context:main", "file://a.ts", OPEN], OPEN, OPEN), "context:main", launchers, true),
    expected: state(["context:main", "file://a.ts"], "context:main"),
  },
  {
    name: "opening a first tab keeps an unselected launcher and ordinary preview",
    run: () =>
      openSessionTab(state(["file://a.ts", OPEN], "file://a.ts", "file://a.ts"), "context:main", launchers, true),
    expected: state(["context:main", "file://a.ts", OPEN], "context:main", "file://a.ts"),
  },
])("$name", ({ run, expected }) => {
  expect(run()).toEqual(expected)
})
