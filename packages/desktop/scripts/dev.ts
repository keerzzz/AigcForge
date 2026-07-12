const electronVite = Bun.which("electron-vite")
if (!electronVite) throw new Error("electron-vite executable not found")

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = Bun.spawn([electronVite, "dev"], {
  cwd: import.meta.dir + "/..",
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})

process.exit(await child.exited)
