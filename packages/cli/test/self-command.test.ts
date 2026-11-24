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
      `OMNIXA_VERSION:${JSON.stringify(identity.version)}`,
      "--define",
      `OMNIXA_CHANNEL:${JSON.stringify(identity.channel)}`,
      "--define",
      `OMNIXA_ARTIFACT:${JSON.stringify(identity.artifact)}`,
    ],
    env: { OMNIXA_VERSION: undefined, OMNIXA_CHANNEL: undefined, OMNIXA_ARTIFACT: undefined },
  },
  {
    name: "Desktop compact environment defines",
    args: [
      "run",
      "--define=OMNIXA_VERSION=process.env.OMNIXA_VERSION",
      "--define=OMNIXA_CHANNEL=process.env.OMNIXA_CHANNEL",
      "--define=OMNIXA_ARTIFACT=process.env.OMNIXA_ARTIFACT",
    ],
    env: {
      OMNIXA_VERSION: identity.version,
      OMNIXA_CHANNEL: identity.channel,
      OMNIXA_ARTIFACT: identity.artifact,
    },
  },
])("Bun selfCommand preserves compile-time CLI identity in child processes: $name", async (scenario) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omnixa-self-command-"))

  try {
    const entry = path.join(root, "self-command.ts")
    await Bun.write(
      entry,
      `import { selfCommand } from ${JSON.stringify(path.join(import.meta.dir, "../src/util/process.ts"))}
const version = await import(${JSON.stringify(path.join(import.meta.dir, "../src/version.ts"))})
const identity = {
  version: version.OMNIXA_VERSION,
  channel: version.OMNIXA_CHANNEL,
  artifact: version.OMNIXA_ARTIFACT,
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
