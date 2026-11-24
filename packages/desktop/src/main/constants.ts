import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OMNIXA_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OMNIXA_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "Omnixa Dev",
  beta: "Omnixa Beta",
  prod: "Omnixa",
}

const appIDs: Record<string, string> = {
  dev: "ai.omnixa.desktop.dev",
  beta: "ai.omnixa.desktop.beta",
  prod: "ai.omnixa.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "Omnixa Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "ai.omnixa.desktop.dev"
