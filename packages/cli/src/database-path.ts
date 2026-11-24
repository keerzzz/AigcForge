import path from "node:path"
import { OMNIXA_CHANNEL } from "./version"

export function databasePath(data: string) {
  const filename =
    process.env.OMNIXA_DB ??
    (["latest", "dev", "beta", "next", "prod"].includes(OMNIXA_CHANNEL) ||
    process.env.OMNIXA_DISABLE_CHANNEL_DB === "1" ||
    process.env.OMNIXA_DISABLE_CHANNEL_DB === "true"
      ? "omnixa.db"
      : `omnixa-${OMNIXA_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}
