import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
       testMatch: module.default.testMatch,
       testIgnore: module.default.testIgnore,
     };
   }
   process.env.E4_DUAL_BACKEND = "1";
   process.env.E4_PEER_BACKEND_PORT = "41004";
   const dual = (await import("./e2e/real/playwright.config.ts?dual")).default;
   configs.dual = { webServer: dual.webServer, testMatch: dual.testMatch, testIgnore: dual.testIgnore };
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

test("development config resolves its module-relative warmup", () => {
  const config = loadConfig("./playwright.config.ts")
  const setup = path.resolve(import.meta.dir, "../global-setup.ts")
  expect(config.globalSetup).toBe(setup)
  expect(existsSync(setup)).toBe(true)
})

for (const file of ["./e2e/performance/playwright.config.ts", "./e2e/performance/playwright.uncapped.config.ts"]) {
  test(`${file} benchmarks compiled assets without dev-network warmup`, () => {
    const config = loadConfig(file)
    expect(config.globalSetup).toBeUndefined()
    if (!isRecord(config.webServer)) throw new Error("missing production benchmark server")
    expect(config.webServer.command).toContain("bun run build")
    expect(config.webServer.reuseExistingServer).toBe(false)
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

test("dual-backend E4 is opt-in, allocates a peer and only discovers the scope matrix", () => {
  const single = loadConfig("./e2e/real/playwright.config.ts")
  expect(single.testIgnore).toContain("**/session-decision-scope.spec.ts")
  const dual = loadConfig("dual")
  expect(dual.testMatch).toEqual([
    "**/session-decision-scope.spec.ts",
    "**/work-review-lifeline.spec.ts",
    "**/session-identity-consumers.spec.ts",
    "**/assistant-provider-isolation.spec.ts",
    "**/manifest.spec.ts",
  ])
  if (!isRecord(dual.webServer) || !isRecord(dual.webServer.env)) throw new Error("missing dual E4 launcher")
  expect(dual.webServer.env.E4_DUAL_BACKEND).toBe("1")
  expect(dual.webServer.env.E4_PEER_BACKEND_PORT).toBe("41004")
  expect(dual.webServer.env.OPENAI_API_KEY).toBe("")
})

test("E4 discovery never imports test sources retained in generated evidence", () => {
  const directories = ["run-evidence", "test-results", "playwright-report"].map((folder) => {
    const parent = path.resolve(import.meta.dir, "../real", folder)
    mkdirSync(parent, { recursive: true })
    return mkdtempSync(path.join(parent, "discovery-"))
  })
  try {
    const runDir = directories[0]
    if (!runDir) throw new Error("Missing E4 discovery fixture")
    Environment.prepare(runDir)
    directories.forEach((directory) =>
      writeFileSync(path.join(directory, "foreign.spec.ts"), 'throw new Error("E4 evidence was imported as a test")\n'),
    )
    for (const dual of ["", "1"]) {
      const listed = Bun.spawnSync(
        ["bunx", "--no-install", "playwright", "test", "--config=e2e/real/playwright.config.ts", "--list"],
        {
          cwd: path.resolve(import.meta.dir, "../.."),
          env: {
            ...Environment.create(runDir, { PATH: process.env.PATH }),
            E4_RUN_DIR: runDir,
            E4_PROVIDER_PORT: "41001",
            E4_BACKEND_PORT: "41002",
            E4_PREVIEW_PORT: "41003",
            E4_PEER_BACKEND_PORT: "41004",
            E4_DUAL_BACKEND: dual,
          },
          timeout: 15_000,
        },
      )
      expect(listed.exitCode, listed.stderr.toString() + listed.stdout.toString()).toBe(0)
      expect(listed.stdout.toString()).toContain("manifest.spec.ts")
      expect(listed.stdout.toString()).not.toContain("foreign.spec.ts")
    }
  } finally {
    directories.forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  }
}, 45_000)
