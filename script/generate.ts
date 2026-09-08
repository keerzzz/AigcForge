#!/usr/bin/env bun

import { $ } from "bun"
import { generateOpenApiSpec } from "@aigcfroge/script/openapi"
import { mkdir } from "fs/promises"
import path from "path"

await $`bun ./packages/sdk/js/script/build.ts`

// Refresh the committed snapshot through the shared generation boundary.
await mkdir(path.resolve("packages/sdk"), { recursive: true })
await Bun.write(path.resolve("packages/sdk/openapi.json"), await generateOpenApiSpec())

await $`./script/format.ts`
