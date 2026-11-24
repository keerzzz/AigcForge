declare global {
  const OMNIXA_VERSION: string
  const OMNIXA_CHANNEL: string
}

export const InstallationVersion = typeof OMNIXA_VERSION === "string" ? OMNIXA_VERSION : "local"
export const InstallationChannel = typeof OMNIXA_CHANNEL === "string" ? OMNIXA_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
