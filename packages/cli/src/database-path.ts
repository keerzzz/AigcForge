import path from "node:path"
import { AIGCFROGE_CHANNEL } from "./version"

export function databasePath(data: string) {
  const filename =
    process.env.AIGCFROGE_DB ??
    (["latest", "dev", "beta", "next", "prod"].includes(AIGCFROGE_CHANNEL) ||
    process.env.AIGCFROGE_DISABLE_CHANNEL_DB === "1" ||
    process.env.AIGCFROGE_DISABLE_CHANNEL_DB === "true"
      ? "aigcfroge.db"
      : `aigcfroge-${AIGCFROGE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}
