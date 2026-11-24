#!/usr/bin/env bun
import { $ } from "bun"

import { copyBuiltCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()

if (!Bun.env.OMNIXA_CLI_DIST) {
  throw new Error("OMNIXA_CLI_DIST is required for desktop builds; remote CLI downloads are disabled")
}

await $`bun ./scripts/copy-icons.ts ${channel}`

await $`bun ./scripts/copy-metainfo.ts ${channel}`

await copyBuiltCliToResources(Bun.env.OMNIXA_CLI_DIST)
