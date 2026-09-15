/**
 * Maps the identity projection's permission contract onto what the bottom bar
 * shows. Pure on purpose: the rules are the interesting part and they are worth
 * testing without a DOM.
 *
 * Rules (plan §9.2): the default `propose` tier stays silent — a permanent chip
 * would be noise; `full` warns; a blocked or degraded capability outranks the
 * tier, because that is the state the user has to act on, and it carries the
 * projection's reason code for the tooltip.
 */
export function permissionDisplay(input: {
  declaredTier: "propose" | "full"
  effect?: "allow" | "ask" | "deny"
  health?: "ready" | "degraded" | "blocked"
  reason?: string
}): { kind: "full" | "degraded" | "blocked"; reason?: string; effect?: "allow" | "ask" | "deny" } | undefined {
  const shown = {
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.effect === undefined ? {} : { effect: input.effect }),
  }
  if (input.health === "blocked") return { kind: "blocked", ...shown }
  if (input.health === "degraded") return { kind: "degraded", ...shown }
  if (input.declaredTier === "full") return { kind: "full", ...shown }
  return undefined
}
