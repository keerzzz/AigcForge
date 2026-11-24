import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createWslRuntime, wslArgs, wslCliInstallCommand } from "./runtime"

test("wslArgs bypasses the distro default shell", () => {
  expect(wslArgs(["sh", "-lc", 'printf "%s\\n" "$HOME"'], "Debian")).toEqual([
    "-d",
    "Debian",
    "--exec",
    "sh",
    "-lc",
    'printf "%s\\n" "$HOME"',
  ])
  expect(wslArgs(["bash", "-se"], "Debian", "root")).toEqual([
    "-d",
    "Debian",
    "--user",
    "root",
    "--exec",
    "bash",
    "-se",
  ])
})

test("WSL CLI installation requires a local binary before starting a download", () => {
  expect(() => wslCliInstallCommand({ version: "2.3.4" })).toThrow()
})

const installs = [
  { name: "installs a matching local Linux binary at the new path", version: "2.3.4", install: true },
  { name: "rejects a wrong version without replacing the installed CLI", version: "2.3.5", install: false },
]

installs.map((input) =>
  test.skipIf(process.platform !== "linux")(`WSL CLI ${input.name}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "omnixa-wsl-install-"))
    try {
      const home = path.join(directory, "home")
      const commands = path.join(directory, "commands")
      const binary = path.join(directory, "source with spaces", "omnixa")
      const destination = path.join(home, ".omnixa", "bin", "omnixa")
      const downloads = path.join(directory, "downloads")
      const source = `#!/bin/sh\nprintf '%s\\n' '${input.version}'\n`
      const previous = `#!/bin/sh\nprintf '%s\\n' '${input.install ? "1.0.0" : "2.3.4"}'\n`
      await mkdir(path.dirname(binary), { recursive: true })
      await mkdir(path.dirname(destination), { recursive: true })
      await mkdir(commands)
      await Bun.write(binary, source)
      await chmod(binary, 0o755)
      await Bun.write(destination, previous)
      await chmod(destination, 0o755)
      // Map the Windows-path expression to this Linux fixture. The curl boundary records
      // an accidental download without making a network request.
      await Bun.write(path.join(commands, "wslpath"), '#!/bin/sh\ntest "$1" = -a\nprintf "%s\\n" "$2"\n')
      await chmod(path.join(commands, "wslpath"), 0o755)
      await Bun.write(
        path.join(commands, "curl"),
        '#!/bin/sh\nprintf "attempted\\n" > "$WSL_KEEPER_DOWNLOAD_LOG"\nexit 97\n',
      )
      await chmod(path.join(commands, "curl"), 0o755)
      const child = Bun.spawn(["bash", "-c", wslCliInstallCommand({ version: "2.3.4", binary })], {
        env: {
          HOME: home,
          PATH: `${commands}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
          WSL_KEEPER_DOWNLOAD_LOG: downloads,
        },
        stdout: "ignore",
        stderr: "pipe",
      })
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      expect(await Bun.file(downloads).exists()).toBe(false)
      expect(await Bun.file(destination).text()).toBe(input.install ? source : previous)
      expect((await stat(destination)).mode & 0o777).toBe(0o755)
      expect((await readdir(path.dirname(destination))).filter((name) => name.startsWith(".install-"))).toEqual([])
      if (input.install) {
        expect(code, stderr).toBe(0)
        return
      }
      expect(code, stderr).not.toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }),
)

// Exercise the real wsl.exe argv path: with `--`, WSL routes the command line through the distro's
// default shell, which expands `$cli` to "" before `sh` runs the script (#48640).
const runtime = createWslRuntime((key) => key)

const distro =
  process.platform === "win32" && (await runtime.probeRuntime()).available
    ? (await runtime.listInstalled().catch(() => [])).find((item) => item.isDefault)?.name
    : undefined

// A cold WSL VM takes several seconds to answer.
test.skipIf(!distro)(
  "inline scripts keep their own variable expansion inside WSL",
  async () => {
    const result = await runtime.runWslSh(['cli="from-script"', 'printf "%s\\n" "$cli"'].join("\n"), distro)
    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe("from-script")
  },
  30_000,
)
