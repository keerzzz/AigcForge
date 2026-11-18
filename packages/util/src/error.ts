/** Displays an API error's message, an Error message, or the caller's localized fallback. */
export function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data

    if (data && typeof data === "object" && "message" in data && typeof data.message === "string" && data.message)
      return data.message
  }

  if (error instanceof Error) return error.message

  return fallback
}
