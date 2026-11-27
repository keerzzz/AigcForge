import { resolveChannel } from "./utils"

const arg = process.argv[2]

const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "ai.omnixa.desktop" : `ai.omnixa.desktop.${channel}`

const productName = channel === "prod" ? "Omnixa" : `Omnixa ${channel.charAt(0).toUpperCase() + channel.slice(1)}`

const summary = `Open source AI coding agent${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="ai.omnixa">
    <name>Omnixa</name>
  </developer>

  <description>
    <p>
      Omnixa is an open source agent workbench that helps you build and orchestrate with any AI model.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/keerzzz/Omnixa/issues</url>
  <url type="homepage">https://github.com/keerzzz/Omnixa</url>
  <url type="vcs-browser">https://github.com/keerzzz/Omnixa</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)

console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
