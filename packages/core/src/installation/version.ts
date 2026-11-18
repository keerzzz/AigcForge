declare global {
  const AIGCFROGE_VERSION: string
  const AIGCFROGE_CHANNEL: string
}

export const InstallationVersion = typeof AIGCFROGE_VERSION === "string" ? AIGCFROGE_VERSION : "local"
export const InstallationChannel = typeof AIGCFROGE_CHANNEL === "string" ? AIGCFROGE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
