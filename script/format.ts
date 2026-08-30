#!/usr/bin/env bun

import { $ } from "bun"

// Default: format in place. `--check` runs the read-only gate used by `bun run lint`.
const mode = process.argv.includes("--check") ? "--check" : "--write"
await $`bun run prettier --ignore-unknown ${mode} .`
