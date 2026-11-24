// The part of the SSH extension's remote CLI scripts that WSL uses. Extensions share only contracts, so
// keep the two copies in step.

export function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function requireVersion(version: string) {
  if (version !== "local" && !/^[0-9][a-zA-Z0-9.+-]*$/.test(version)) throw new Error(version)

  return version
}

export function discoverScript() {
  return `cli=""
if [ -z "$cli" ] && [ -x "$HOME/.omnixa/bin/omnixa" ]; then cli="$HOME/.omnixa/bin/omnixa"; fi
if [ -n "$cli" ]; then printf '%s\\n' "$cli"; fi
`
}

// Adapters supply a quoted shell expression, including remote HOME or wslpath expansion.
export function versionScript(command: string) {
  return `if [ -x ${command} ]; then ${command} --version 2>/dev/null || true; fi\n`
}

export function parseVersion(output: string) {
  const line = output
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()

  if (!line) return null
  const marker = line.lastIndexOf(" v")
  const version = marker === -1 ? line : line.slice(marker + 2)

  if (!version) throw new Error("V2 CLI did not provide a version")

  return version
}

/** Stages a local Linux CLI before replacing the managed executable. */
export function installScript(input: { version: string; binary: string }) {
  const version = requireVersion(input.version)

  return `set -eu
umask 077
destination="$HOME/.omnixa/bin/omnixa"
mkdir -p "$(dirname "$destination")"
stage=$(mktemp -d "$(dirname "$destination")/.install-XXXXXX")
trap 'rm -rf "$stage"' EXIT
cp ${input.binary} "$stage/omnixa"
chmod 755 "$stage/omnixa"
test "$("$stage/omnixa" --version | awk '{print $NF}' | sed 's/^v//')" = ${quote(version)}
mv "$stage/omnixa" "$destination"
`
}
