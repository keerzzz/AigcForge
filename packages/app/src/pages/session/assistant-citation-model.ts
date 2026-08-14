/** Parses a non-empty opaque ID from a kb:// citation URI. */
export function parseKbUri(href: string): string | undefined {
  const value = href.trim()
  if (!value.startsWith("kb://")) return undefined
  const id = value.slice("kb://".length)
  if (!id || /\s/.test(id)) return undefined
  return id
}

/** Resolves a sanitized kb:// link through timeline click delegation. */
export function kbCitationHref(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined
  const link = target.closest<HTMLAnchorElement>('a[href^="kb://"]')
  if (!link) return undefined
  return parseKbUri(link.getAttribute("href") ?? "")
}

/** Truncates citation text at a nearby word boundary. */
export function citationSummary(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content
  const slice = content.slice(0, maxLength)
  const boundary = slice.lastIndexOf(" ")
  const cut = boundary > maxLength * 0.6 ? boundary : maxLength
  return `${slice.slice(0, cut).trimEnd()}…`
}
