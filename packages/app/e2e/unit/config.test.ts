import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { Environment } from "../real/environment"
import { isRecord } from "../real/manifest"

// Import the actual configs once in a disposable process. Cold module loading belongs to
// collection, not four independent per-test subprocesses. No runner, setup, port probe,
// browser, Vite build or server is invoked; explicit ports bypass E4 allocation.
const files = [
  "./playwright.config.ts",
  "./e2e/performance/playwright.config.ts",
  "./e2e/performance/playwright.uncapped.config.ts",
  "./e2e/real/playwright.config.ts",
  "./e2e/real/vite.config.ts",
]
const result = Bun.spawnSync(
  [
    process.execPath,
    "--no-env-file",
    "--eval",
    `const configs = {};
   for (const file of ${JSON.stringify(files)}) {
     const module = await import(file);
     configs[file] = {
       globalSetup: module.default.globalSetup,
       retries: module.default.retries,
       webServer: module.default.webServer,
       envDir: module.default.envDir,
     };
   }
   console.log(JSON.stringify(configs));`,
  ],
  {
    cwd: path.resolve(import.meta.dir, "../.."),
    env: {
      ...Environment.create(path.resolve("/synthetic-e4-config"), { PATH: process.env.PATH }),
      E4_RUN_DIR: path.resolve("/synthetic-e4-config"),
      E4_PROVIDER_PORT: "41001",
      E4_BACKEND_PORT: "41002",
      E4_PREVIEW_PORT: "41003",
      OPENAI_API_KEY: "synthetic-private-value",
      AIGCFROGE_V2_RUNTIME: "true",
    },
  },
)
if (result.exitCode !== 0) throw new Error(`config import failed: ${result.stderr.toString()}`)
const configs: unknown = JSON.parse(result.stdout.toString())
function loadConfig(file: string) {
  if (!isRecord(configs) || !isRecord(configs[file])) throw new Error(`missing config ${file}`)
  return configs[file]
}

for (const file of [
  "./playwright.config.ts",
  "./e2e/performance/playwright.config.ts",
  "./e2e/performance/playwright.uncapped.config.ts",
]) {
  test(`${file} resolves the same module-relative globalSetup`, () => {
    const config = loadConfig(file)
    const setup = path.resolve(import.meta.dir, "../global-setup.ts")
    expect(config.globalSetup).toBe(setup)
    expect(existsSync(setup)).toBe(true)
  })
}

test("actual E4 config isolates the launcher without inheriting root setup/retry/reuse", () => {
  const config = loadConfig("./e2e/real/playwright.config.ts")
  expect(config.globalSetup).toBeUndefined()
  expect(config.retries).toBe(0)
  if (!isRecord(config.webServer) || !isRecord(config.webServer.env)) throw new Error("missing E4 launcher")
  expect(config.webServer.reuseExistingServer).toBe(false)
  expect(config.webServer.command).toContain("--no-env-file")
  expect(config.webServer.env.OPENAI_API_KEY).toBe("")
  expect(config.webServer.env.AIGCFROGE_V2_RUNTIME).toBe("")
  expect(config.webServer.env.E4_V2_RUNTIME).toBe("")
  expect(config.webServer.env.E4_RUN_DIR).toBe(path.resolve("/synthetic-e4-config"))
  expect(config.webServer.env.HOME).toBe(path.resolve("/synthetic-e4-config/home"))
  expect(config.webServer.env.XDG_DATA_HOME).toBe(path.resolve("/synthetic-e4-config/xdg/data"))
})

test("E4 extends the production Vite config with dotenv disabled", () => {
  expect(loadConfig("./e2e/real/vite.config.ts").envDir).toBe(false)
})
