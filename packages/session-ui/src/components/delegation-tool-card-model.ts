export type DelegationCardStatus =
  | "running"
  | "waiting_review"
  | "changes_requested"
  | "recovery_required"
  | "failed"
  | "completed"
  | "archived"
  | "expired"

export type DelegationCardInput = {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly lastActivityAt: number
  readonly participants: ReadonlyArray<{
    readonly id: string
    readonly role: string
    readonly target: string
    readonly childSessionID?: string
    readonly externalThreadID?: string
  }>
  readonly turns: ReadonlyArray<{ readonly id: string; readonly seq: number; readonly status: string }>
  readonly softExpired: boolean
}

export function delegationToolCardModel(input: DelegationCardInput) {
  const domainStatus = (value: string): DelegationCardStatus => {
    if (value === "waiting_review") return value
    if (value === "changes_requested") return value
    if (value === "recovery_required") return value
    if (value === "failed") return value
    if (value === "completed") return value
    if (value === "archived") return value
    return "running"
  }
  const status: DelegationCardStatus = input.softExpired
    ? "expired"
    : input.status === "approved" || input.status === "closing"
      ? "completed"
      : input.status === "cancelled"
        ? "failed"
        : domainStatus(input.status)
  return {
    id: input.id,
    title: input.title,
    status,
    participants: input.participants.map((participant) => ({
      ...participant,
      href: participant.childSessionID,
      external: participant.externalThreadID !== undefined,
    })),
    turns: [...input.turns].sort((left, right) => left.seq - right.seq),
  }
}
