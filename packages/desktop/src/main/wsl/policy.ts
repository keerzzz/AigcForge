import type { WslDistroProbe, WslAigcfrogeCheck, WslServerItem } from "../../preload/types"

export function wslServerIdToRestart(servers: WslServerItem[], distro: string) {
  return servers.find((item) => item.config.distro === distro)?.config.id
}

export function clearWslDistroState(
  distroProbes: Record<string, WslDistroProbe>,
  aigcfrogeChecks: Record<string, WslAigcfrogeCheck>,
  distro: string,
) {
  const nextDistroProbes = { ...distroProbes }
  const nextAigcfrogeChecks = { ...aigcfrogeChecks }
  delete nextDistroProbes[distro]
  delete nextAigcfrogeChecks[distro]
  return { distroProbes: nextDistroProbes, aigcfrogeChecks: nextAigcfrogeChecks }
}

export function wslTerminalArgs(distro?: string | null) {
  return ["/c", "start", "", "wsl", ...(distro ? ["-d", distro] : [])]
}

export function requireWslIpcString(name: string, value: unknown) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error(`Invalid ${name}`)
}
