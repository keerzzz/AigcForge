import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.AIGCFROGE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.AIGCFROGE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "AigcForge Dev",
  beta: "AigcForge Beta",
  prod: "AigcForge",
}

const appIDs: Record<string, string> = {
  dev: "ai.aigcfroge.desktop.dev",
  beta: "ai.aigcfroge.desktop.beta",
  prod: "ai.aigcfroge.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "AigcForge Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "ai.aigcfroge.desktop.dev"
