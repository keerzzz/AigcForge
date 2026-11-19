declare const AIGCFROGE_VERSION: string
declare const AIGCFROGE_CHANNEL: string
declare const AIGCFROGE_ARTIFACT: string

const version = typeof AIGCFROGE_VERSION === "string" ? AIGCFROGE_VERSION : "local"
const channel = typeof AIGCFROGE_CHANNEL === "string" ? AIGCFROGE_CHANNEL : "local"
const artifact = typeof AIGCFROGE_ARTIFACT === "string" ? AIGCFROGE_ARTIFACT : "cli"

export { version as AIGCFROGE_VERSION, channel as AIGCFROGE_CHANNEL, artifact as AIGCFROGE_ARTIFACT }
export const AIGCFROGE_LOCAL = channel === "local"
