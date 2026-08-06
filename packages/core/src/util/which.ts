import whichPkg from "which"
import path from "path"
import { Global } from "../global"

// Common user-bin directories to fall back on when a GUI-launched process has no
// PATH (e.g. Electron on macOS). ~/.local/bin is relative to $HOME.
const COMMON_BIN_DIRS = [".local/bin", "/usr/local/bin", "/opt/homebrew/bin"]

export function which(cmd: string, env?: NodeJS.ProcessEnv, loginEnv?: NodeJS.ProcessEnv) {
  // An explicitly-empty PATH in `env` is authoritative (GUI launch), so it is not
  // silently replaced by the process PATH; when no PATH is resolvable at all we
  // fall back to the login-shell PATH and common user-bin directories.
  const explicit = env ? (env.PATH ?? env.Path ?? "") : undefined
  const processPath = process.env.PATH ?? process.env.Path ?? ""
  const base = explicit !== undefined ? explicit : processPath
  const home = process.env.HOME ?? ""
  const common = COMMON_BIN_DIRS.map((dir) => (path.isAbsolute(dir) ? dir : path.join(home, dir)))
  const loginPath = base ? "" : (loginEnv?.PATH ?? "")
  const full = [base, loginPath, ...common].filter(Boolean).join(path.delimiter) || Global.Path.bin
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: full,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? loginEnv?.PATHEXT ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  return typeof result === "string" ? result : null
}
