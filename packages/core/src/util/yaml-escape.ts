/**
 * Safe YAML double-quoted string escaping.
 * Escapes backslashes, double quotes, newline/tabs, and all C0 control characters (\x00-\x1F, \x7F).
 */
export function yamlEscape(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (ch) => {
      const code = ch.charCodeAt(0)
      return `\\u${code.toString(16).padStart(4, "0")}`
    })
  return `"${escaped}"`
}
