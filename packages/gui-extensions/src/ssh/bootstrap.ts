import { Effect, Option, Schema } from "effect"
import { parseTarget, runSsh, sshArgs, SshFailure } from "./command"
import { RemoteCli } from "./remote-cli"

// Use commands supported by released V2 CLIs. The registration is the service's
// complete private discovery contract; no remote Python/Node runtime is needed.
const registrationScript = `status=$("$cli" service status) || exit 0
if [ "$status" = stopped ]; then exit 0; fi
printf 'OMNIXA_SSH_STATUS=%s\\n' "$status"
for file in "\${XDG_STATE_HOME:-$HOME/.local/state}"/omnixa/service*.json; do
  if [ ! -f "$file" ]; then continue; fi
  printf 'OMNIXA_SSH_REGISTRATION_BEGIN\\n'
  cat "$file"
  printf '\\nOMNIXA_SSH_REGISTRATION_END\\n'
done
`

export const discoverScript = `set -eu
${RemoteCli.discoverScript({ fromPath: true, cache: { directory: ".omnixa/desktop-ssh", prefix: "0.0.0-beta-" } })}
if [ -z "$cli" ]; then exit 0; fi
${registrationScript}`

export function startScript(version: string, replace = false) {
  return `set -eu
cli="${binaryPath(version)}"
"$cli" service ${replace ? "restart" : "start"}
${registrationScript}`
}

const Registration = Schema.fromJsonString(
  Schema.Struct({
    url: Schema.String,
    password: Schema.String,
    version: Schema.String,
    pid: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
)

export function parseRegistration(output: string) {
  const status = output
    .split(/\r?\n/)
    .findLast((line) => line.startsWith("OMNIXA_SSH_STATUS="))
    ?.slice("OMNIXA_SSH_STATUS=".length)

  if (!status) return undefined

  for (const match of output.matchAll(
    /OMNIXA_SSH_REGISTRATION_BEGIN\r?\n([\s\S]*?)\r?\nOMNIXA_SSH_REGISTRATION_END/g,
  )) {
    const result = Schema.decodeUnknownOption(Registration)(match[1])

    if (Option.isSome(result) && result.value.url === status) return result.value
  }

  return undefined
}

export function binaryPath(version: string) {
  return `$HOME/.omnixa/desktop-ssh/${RemoteCli.requireVersion(version)}/omnixa`
}

function connectionAddress(address: string, password: string) {
  const url = new URL(address)

  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "0.0.0.0", "[::]", "[::1]"].includes(url.hostname))
    throw new SshFailure("service")

  return {
    host: url.hostname === "[::1]" ? "[::1]" : "127.0.0.1",
    port: Number(url.port || 80),
    password,
  }
}

export const bootstrap = Effect.fn("Ssh.bootstrap")(function* (input: {
  target: ReturnType<typeof parseTarget>
  version: string
  development?: boolean
  env: NodeJS.ProcessEnv
  replace?: boolean
  stage: (stage: "checking" | "starting") => Effect.Effect<void>
}) {
  const run = (script: string) =>
    runSsh({
      args: [...sshArgs(input.target), input.target.host, "sh -l -s"],
      env: input.env,
      stdin: script,
    })

  yield* input.stage("checking")
  const registered = parseRegistration(yield* run(discoverScript))

  if (registered && (input.development || registered.version === input.version)) {
    yield* input.stage("starting")

    return yield* Effect.try({
      try: () => connectionAddress(registered.url, registered.password),
      catch: SshFailure.from,
    })
  }

  if (registered && !input.replace) return yield* Effect.fail(new SshFailure("version", registered.version))
  const destination = yield* Effect.try({ try: () => binaryPath(input.version), catch: SshFailure.from })
  const existing = yield* run(RemoteCli.versionScript(`"${destination}"`))

  if (RemoteCli.parseVersion(existing) !== input.version) return yield* Effect.fail(new SshFailure("unpublished"))

  yield* input.stage("starting")
  const registration = parseRegistration(yield* run(startScript(input.version, input.replace)))

  if (!registration) return yield* Effect.fail(new SshFailure("service"))

  if (!input.development && registration.version !== input.version)
    return yield* Effect.fail(new SshFailure("version", registration.version))

  return yield* Effect.try({
    try: () => connectionAddress(registration.url, registration.password),
    catch: SshFailure.from,
  })
})
