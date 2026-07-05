import type { WslAigcfrogeCheck, WslServerRuntime } from "./types"

export const wslRuntimeRetryable = (runtime: WslServerRuntime) =>
  runtime.kind === "failed" || runtime.kind === "stopped"

export async function enterWslAigcfrogeStep(
  distro: string,
  probe: (distro: string) => Promise<unknown>,
  select: (step: "aigcfroge") => void,
) {
  await probe(distro)
  select("aigcfroge")
}

export function wslAigcfrogeAction(check?: WslAigcfrogeCheck) {
  if (!check) return
  if (!check.resolvedPath) return "Install Aigcfroge"
  if (check.matchesDesktop === false) return "Update Aigcfroge"
}
