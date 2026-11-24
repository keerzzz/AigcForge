import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"

const module = pathToFileURL(path.join(import.meta.dir, "../src/global-roots.ts")).href

describe("global roots", () => {
  test("uses XDG overrides", () => {
    const root = path.join(os.tmpdir(), "omnixa-xdg-overrides")
    const env = {
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_STATE_HOME: path.join(root, "state"),
    }

    expect(run(env)).toEqual({
      data: path.join(env.XDG_DATA_HOME, "omnixa"),
      cache: path.join(env.XDG_CACHE_HOME, "omnixa"),
      config: path.join(env.XDG_CONFIG_HOME, "omnixa"),
      state: path.join(env.XDG_STATE_HOME, "omnixa"),
      tmp: path.join(os.tmpdir(), "omnixa"),
    })
  })

  test("empty XDG overrides use home directory defaults", () => {
    const home = path.join(os.tmpdir(), "omnixa-xdg-home")

    expect(
      run({
        XDG_DATA_HOME: "",
        XDG_CACHE_HOME: "",
        XDG_CONFIG_HOME: "",
        XDG_STATE_HOME: "",
        ...(process.platform === "win32" ? { USERPROFILE: home } : { HOME: home }),
      }),
    ).toEqual({
      data: path.join(home, ".local", "share", "omnixa"),
      cache: path.join(home, ".cache", "omnixa"),
      config: path.join(home, ".config", "omnixa"),
      state: path.join(home, ".local", "state", "omnixa"),
      tmp: path.join(os.tmpdir(), "omnixa"),
    })
  })
})

function run(env: Record<string, string>) {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      `const { roots } = await import(${JSON.stringify(module)}); console.log(JSON.stringify(roots("omnixa")))`,
    ],
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })

  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return JSON.parse(result.stdout.toString())
}
