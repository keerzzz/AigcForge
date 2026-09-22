/** Preserve a mutation's actionable message without leaking non-Error objects as UI copy. */
export const mutationErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
