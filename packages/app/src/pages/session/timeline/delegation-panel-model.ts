export type DelegationPanelItem = {
  readonly delegation: {
    readonly id: string
    readonly parentSessionID: string
    readonly title: string
    readonly status: string
    readonly lastActivityAt: number
  }
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

export function delegationListInput(directory: string, parentSessionID: string, includeHistory: boolean) {
  return {
    location: { directory },
    parentSessionID,
    ...(includeHistory ? { includeArchived: "true" as const } : {}),
  }
}

export function delegationPanelModel(items: readonly DelegationPanelItem[], parentSessionID: string) {
  return items
    .filter((item) => item.delegation.parentSessionID === parentSessionID)
    .map((item) => ({
      id: item.delegation.id,
      title: item.delegation.title,
      status: item.softExpired ? "expired" : item.delegation.status,
      participants: item.participants.map((participant) => ({ ...participant, href: participant.childSessionID })),
      turns: [...item.turns].sort((left, right) => left.seq - right.seq),
    }))
}
