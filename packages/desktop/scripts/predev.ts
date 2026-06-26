import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.AIGCFROGE_CHANNEL ?? "dev"}`

await $`cd ../aigcfroge && bun script/build-node.ts`
