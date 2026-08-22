// The real Language context persists a locale and lazy-loads per-locale dictionaries,
// which Storybook has no storage or provider for. The dictionary itself is plain data,
// so stories read the shipped English copy instead of a hand-maintained stand-in that
// drifts from production. Mirrors the app merge order in `@/context/language`.
import { dict as app } from "@/i18n/en"
import { dict as ui } from "@aigcfroge/ui/i18n/en"

const dict: Record<string, string> = { ...app, ...ui }

function render(template: string, params?: Record<string, unknown>) {
  if (!params) return template
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    const value = params[key.trim()]
    if (value === undefined || value === null) return ""
    // oxlint-disable-next-line no-base-to-string -- value is Record<string, unknown>, always coerced intentionally
    return String(value)
  })
}

export function useLanguage() {
  return {
    locale: () => "en" as const,
    t(key: string, params?: Record<string, unknown>) {
      return render(dict[key] ?? key, params)
    },
  }
}
