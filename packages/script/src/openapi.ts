import { $ } from "bun"
import path from "path"

// Resolve `packages/aigcfroge` relative to this file (`packages/script/src`).
// The aigcfroge CLI's `dev generate` is the single owner of the OpenAPI spec
// serialization; every consumer (SDK build, committed snapshot refresh, drift
// gate) goes through this boundary instead of re-invoking the command.
const aigcfroge = path.resolve(import.meta.dir, "../../aigcfroge")

/**
 * Generate the canonical OpenAPI spec as JSON text by running the aigcfroge
 * `dev generate` command. Side-effect free: returns the spec text and writes
 * nothing. `bun`'s shell throws on a non-zero exit with stderr included, so a
 * silent empty/partial spec can never masquerade as a real one.
 */
export async function generateOpenApiSpec(): Promise<string> {
  return await $`bun dev generate`.cwd(aigcfroge).text()
}
