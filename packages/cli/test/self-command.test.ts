import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const identity = { version: "2.0.0-self-command", channel: "dev", artifact: "cli-self-command" }

test.each([
  {
    name: "paired literal defines",
    args: [
      "--define",
      `AIGCFROGE_VERSION:${JSON.stringify(identity.version)}`,
      "--define",
      `AIGCFROGE_CHANNEL:${JSON.stringify(identity.channel)}`,
      "--define",
      `AIGCFROGE_ARTIFACT:${JSON.stringify(identity.artifact)}`,
    ],
    env: { AIGCFROGE_VERSION: undefined, AIGCFROGE_CHANNEL: undefined, AIGCFROGE_ARTIFACT: undefined },
  },
  {
    name: "Desktop compact environment defines",
    args: [
      "run",
      "--define=AIGCFROGE_VERSION=process.env.AIGCFROGE_VERSION",
      "--define=AIGCFROGE_CHANNEL=process.env.AIGCFROGE_CHANNEL",
      "--define=AIGCFROGE_ARTIFACT=process.env.AIGCFROGE_ARTIFACT",
    ],
    env: {
      AIGCFROGE_VERSION: identity.version,
      AIGCFROGE_CHANNEL: identity.channel,
      AIGCFROGE_ARTIFACT: identity.artifact,
    },
  },
])("Bun selfCommand preserves compile-time CLI identity in child processes: $name", async (scenario) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aigcfroge-self-command-"))

  try {
    const entry = path.join(root, "self-command.ts")
    await Bun.write(
      entry,
      `import { selfCommand } from ${JSON.stringify(path.join(import.meta.dir, "../src/util/process.ts"))}
const version = await import(${JSON.stringify(path.join(import.meta.dir, "../src/version.ts"))})
const identity = {
  version: version.AIGCFROGE_VERSION,
  channel: version.AIGCFROGE_CHANNEL,
  artifact: version.AIGCFROGE_ARTIFACT,
}

if (process.argv.includes("--child")) {
  console.log(JSON.stringify(identity))
  process.exit(0)
}

console.log(JSON.stringify(identity))
const child = Bun.spawn([...selfCommand(), "--child"], { stdout: "inherit", stderr: "inherit" })
process.exit(await child.exited)
`,
    )

    await using parent = Bun.spawn([process.execPath, ...scenario.args, entry], {
      stdout: "pipe",
      stderr: "pipe",
      // Cached modules compiled with other --define values can conceal identity loss.
      env: { ...process.env, ...scenario.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    })
    const [code, stdout, stderr] = await Promise.all([
      parent.exited,
      new Response(parent.stdout).text(),
      new Response(parent.stderr).text(),
    ])
    expect(code, stderr).toBe(0)
    const identities = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(identities).toHaveLength(2)
    expect(identities[0]).toEqual(identity)
    expect(identities[1]).toEqual(identity)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
