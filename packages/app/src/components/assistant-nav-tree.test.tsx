import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

// Batch 2 G3: shared entity navigation for the home and session sidebars,
// including session-list linkage. Pure functions are covered by the model tests.

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), "utf-8")
const tree = read("assistant-nav-tree.tsx")
const model = read("assistant-nav-model.ts")
const dashboard = read("../pages/assistant-dashboard.tsx")
const sidebar = read("assistant-session-sidebar.tsx")
const secondary = read("secondary-sidebar.tsx")
const context = read("../pages/mode-workspace-context.ts")
const workspace = read("../pages/mode-workspace.tsx")
const home = read("../pages/home.tsx")
const featureSidebar = read("assistant-feature-sidebar.tsx")

describe("AssistantNavTree (entity nav tree, batch 2 G3)", () => {
  test("exports the AssistantNavTree component", () => {
    expect(tree).toContain("export function AssistantNavTree")
  })

  test("renders the four entity categories behind i18n keys", () => {
    for (const key of [
      "assistant.nav.reminders",
      "assistant.nav.memory",
      "assistant.nav.kb",
      "assistant.nav.dangling",
    ]) {
      expect(tree).toContain(`language.t("${key}")`)
    }
  })

  test("shows counts for all four categories (dangling = array length)", () => {
    expect(tree).toContain("pending().length")
    expect(tree).toContain("memories().length")
    expect(tree).toContain("notes().length")
    expect(tree).toContain("dangling().length")
  })

  test("collapses all entity groups by default (home rail = counts, avoids duplicated content)", () => {
    expect(tree).toContain("{ reminders: true, memory: true, kb: true }")
  })

  test("aggregates the knowledge base by tag hierarchy via buildKbTagTree", () => {
    expect(tree).toContain("buildKbTagTree(notes())")
    expect(tree).toContain("<KbTagNodeRow")
    expect(tree).toContain("parentPath={path()}")
  })

  test("uses the shared server-scoped query key helper", () => {
    expect(tree).toContain('from "@/utils/assistant-query"')
    expect(tree).toContain("assistantQueryKey(serverSDK().scope")
  })

  test("emits selections with the item id (onSelect)", () => {
    expect(tree).toContain('props.onSelect({ kind: "reminders", itemId: reminder.id })')
    expect(tree).toContain('props.onSelect({ kind: "memory", itemId: memory.id })')
    expect(tree).toContain('props.onSelect({ kind: "kb", itemId: note.id })')
  })
})

describe("assistant-nav-model (D5 linkage)", () => {
  test("exports sessionHighlightIDs and buildKbTagTree", () => {
    expect(model).toContain("export function sessionHighlightIDs")
    expect(model).toContain("export function buildKbTagTree")
  })

  test("knowledge base items have no session backlink (degrade to full list)", () => {
    expect(model).toContain('if (selection.kind === "reminders")')
    expect(model).toContain('if (selection.kind === "memory")')
    expect(model).toContain("return new Set<string>()")
  })
})

describe("home page linkage (batch 2 G3)", () => {
  test("AssistantSidebar renders the nav tree and writes the selection context", () => {
    expect(featureSidebar).toContain("<AssistantNavTree")
    expect(featureSidebar).toContain("useAssistantSelection()")
    expect(featureSidebar).toContain("select(next)")
  })

  test("ModeWorkspace provides AssistantSelectionCtx (align CodingSelectionCtx)", () => {
    expect(context).toContain("export const AssistantSelectionCtx = createContext")
    expect(context).toContain("export function useAssistantSelection()")
    expect(workspace).toContain("<AssistantSelectionCtx.Provider")
  })

  test("dashboard highlights the source sessions of the selected entity", () => {
    expect(dashboard).toContain("useAssistantSelection()")
    expect(dashboard).toContain("sessionHighlightIDs")
    expect(dashboard).toContain("highlighted={highlightedSessions().has(record.session.id)}")
  })

  test("HomeSessionRow gains an opt-in highlighted state without changing its default row", () => {
    expect(home).toContain("highlighted?: boolean")
    expect(home).toContain('data-highlighted={props.highlighted ? "" : undefined}')
  })
})

describe("AssistantSessionSidebar (detail secondary sidebar, batch 2 G3)", () => {
  test("exports the component with Location + sessions + nav tree", () => {
    expect(sidebar).toContain("export function AssistantSessionSidebar")
    expect(sidebar).toContain("<ModeLocationNewSession")
    expect(sidebar).toContain("<AssistantNavTree")
    expect(sidebar).toContain("<SessionItem")
  })

  test("filters the session list to assistant mode", () => {
    expect(sidebar).toContain('(session.mode ?? "coding") === "assistant"')
    expect(sidebar).toContain("sortedRootSessions")
  })

  test("maps the right-panel state to the tree selection (active tab → kind, target → itemId)", () => {
    expect(sidebar).toContain("tabs().active()")
    expect(sidebar).toContain("assistant().target()")
    expect(sidebar).toContain("openEntityPanel({ view: view(), tabs: tabs(), assistant: assistant()")
  })

  test("secondary-sidebar assistant slot is no longer a placeholder", () => {
    expect(secondary).toContain("<AssistantSessionSidebar")
    expect(secondary).not.toContain('<PlaceholderSidebar mode="assistant" />')
  })

  test("detail sidebar keeps the nav tree scrollable with a height cap (MEDIUM-1)", () => {
    expect(sidebar).toContain('"max-height": "45%"')
    expect(sidebar).toContain("overflow-y-auto")
    expect(sidebar).toContain("shrink-0")
  })
})
