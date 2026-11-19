#!/usr/bin/env bun
import { $ } from "bun"

import { copyBuiltCliToResources, downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()

if (channel === "prod" && !Bun.env.AIGCFROGE_CLI_DIST) {
  throw new Error("AIGCFROGE_CLI_DIST is required for production desktop builds")
}

await $`bun ./scripts/copy-icons.ts ${channel}`

await $`bun ./scripts/copy-metainfo.ts ${channel}`

if (Bun.env.AIGCFROGE_CLI_DIST) await copyBuiltCliToResources(Bun.env.AIGCFROGE_CLI_DIST)

if (!Bun.env.AIGCFROGE_CLI_DIST && channel !== "prod")
  await downloadCliToResources(channel === "beta" ? "beta" : undefined)
