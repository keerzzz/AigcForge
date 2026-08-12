export * as KBLink from "./link"

/**
 * Mechanical wikilink machinery (PRD §7.4): zero-dependency extraction and
 * dangling detection. No LLM, no MCP, no index — pure string mechanics.
 * Obsidian syntax subset: [[title]], [[title|display]], [[title#heading]].
 */

const WIKILINK = /\[\[([^\[\]]+?)\]\]/g

/**
 * Extract unique target titles from Markdown content, preserving first
 * occurrence order. Display aliases (`[[title|display]]`) and heading
 * fragments (`[[title#section]]`) are stripped — both link to the same note.
 */
export function extractWikilinks(content: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const match of content.matchAll(WIKILINK)) {
    const raw = match[1]?.trim()
    if (!raw) continue
    const title = raw.split("|")[0]?.split("#")[0]?.trim()
    if (!title) continue
    if (seen.has(title)) continue
    seen.add(title)
    result.push(title)
  }
  return result
}

/**
 * Mechanical dangling check: which extracted titles have no matching note
 * (by exact title or any alias). Zero dependencies — a plain Set lookup.
 */
export function detectDangling(links: readonly string[], knownTitles: ReadonlySet<string>): string[] {
  return links.filter((title) => !knownTitles.has(title))
}

/**
 * Resolve a [[title]] to a note id: exact title match first, then aliases.
 * Returns undefined when the title is dangling. Ambiguity (same title in
 * multiple scopes) is out of scope for M2 — resolution is by exact title
 * across the current scope's index.
 */
export function resolveTitle<Id extends string>(
  title: string,
  notesByTitle: ReadonlyMap<string, Id>,
  aliasesByNote: ReadonlyMap<Id, readonly string[]> = new Map(),
): Id | undefined {
  const direct = notesByTitle.get(title)
  if (direct !== undefined) return direct
  for (const [noteID, aliases] of aliasesByNote) {
    if (aliases.includes(title)) return noteID
  }
  return undefined
}
