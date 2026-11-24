declare const OMNIXA_VERSION: string
declare const OMNIXA_CHANNEL: string
declare const OMNIXA_ARTIFACT: string

const version = typeof OMNIXA_VERSION === "string" ? OMNIXA_VERSION : "local"
const channel = typeof OMNIXA_CHANNEL === "string" ? OMNIXA_CHANNEL : "local"
const artifact = typeof OMNIXA_ARTIFACT === "string" ? OMNIXA_ARTIFACT : "cli"

export { version as OMNIXA_VERSION, channel as OMNIXA_CHANNEL, artifact as OMNIXA_ARTIFACT }
export const OMNIXA_LOCAL = channel === "local"
