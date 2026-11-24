import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http"
import { binaryPath, bootstrap, parseRegistration } from "./bootstrap"
import { parseTarget } from "./command"

test("ignores stopped services and registrations that do not match the healthy endpoint", () => {
  const registration = { url: "http://127.0.0.1:1234", password: "secret", version: "2.0.0", pid: 42 }
  const frame = `OMNIXA_SSH_REGISTRATION_BEGIN\n${JSON.stringify(registration)}\nOMNIXA_SSH_REGISTRATION_END\n`
  expect(parseRegistration(`OMNIXA_SSH_STATUS=stopped\n${frame}`)).toBeUndefined()
  expect(parseRegistration(`OMNIXA_SSH_STATUS=http://127.0.0.1:9999\n${frame}`)).toBeUndefined()
  expect(
    parseRegistration(
      `OMNIXA_SSH_STATUS=${registration.url}\nOMNIXA_SSH_REGISTRATION_BEGIN\ninvalid\nOMNIXA_SSH_REGISTRATION_END\n`,
    ),
  ).toBeUndefined()
})

test("rejects unsafe versions in staged CLI paths", () => {
  expect(() => binaryPath('2.0.0"; whoami')).toThrow()
})

const cases = [
  {
    name: "rejects an unstaged release before probing or downloading",
    version: "2.3.4",
    development: false,
    registered: false,
    staged: false,
    replace: false,
    requests: 2,
  },
  {
    name: "rejects an unstaged development build before beta metadata or downloading",
    version: "local",
    development: true,
    registered: false,
    staged: false,
    replace: false,
    requests: 2,
  },
  {
    name: "reuses a healthy matching service",
    version: "2.3.4",
    development: false,
    registered: true,
    staged: false,
    replace: false,
    requests: 1,
  },
  {
    name: "reuses a healthy service for a development build",
    version: "local",
    development: true,
    registered: true,
    staged: false,
    replace: false,
    requests: 1,
  },
  {
    name: "starts an already staged matching CLI",
    version: "2.3.4",
    development: false,
    registered: false,
    staged: true,
    replace: false,
    requests: 3,
  },
  {
    name: "restarts an already staged matching development CLI",
    version: "local",
    development: true,
    registered: false,
    staged: true,
    replace: true,
    requests: 3,
  },
]

cases.map((input) =>
  test.skipIf(process.platform === "win32")(`SSH bootstrap ${input.name}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "omnixa-ssh bootstrap-"))
    try {
      const commands = path.join(directory, "commands")
      const scripts = path.join(directory, "scripts")
      const registration = {
        url: "http://127.0.0.1:1234",
        password: "fixture-secret",
        version: input.registered ? "2.3.4" : input.version,
        pid: 42,
      }
      await mkdir(commands)
      await Bun.write(scripts, "")
      await Bun.write(
        path.join(directory, "registration"),
        `OMNIXA_SSH_STATUS=${registration.url}\nOMNIXA_SSH_REGISTRATION_BEGIN\n${JSON.stringify(registration)}\nOMNIXA_SSH_REGISTRATION_END\n`,
      )
      // This executable records the real process input and returns observations.
      // It never executes the received remote scripts or opens a connection.
      await Bun.write(
        path.join(commands, "ssh"),
        `#!/bin/sh
script=$(cat)
printf '%s\\nOMNIXA_SSH_KEEPER_END\\n' "$script" >> "$SSH_KEEPER_SCRIPTS"
case "$script" in
  *'curl '*|*'wget '*) exit 97 ;;
  *'service start'*|*'service restart'*) cat "$SSH_KEEPER_REGISTRATION" ;;
  *'service status'*)
    if [ "$SSH_KEEPER_REGISTERED" = 1 ]; then cat "$SSH_KEEPER_REGISTRATION"; fi
    ;;
  *'OMNIXA_REMOTE_TARGET='*) printf 'OMNIXA_REMOTE_TARGET=linux-x64-baseline\\n' ;;
  *'--version'*)
    if [ "$SSH_KEEPER_STAGED" = 1 ]; then printf '%s\\n' "$SSH_KEEPER_VERSION"; fi
    ;;
  *) exit 98 ;;
esac
`,
      )
      await chmod(path.join(commands, "ssh"), 0o755)
      const http: string[] = []
      const stages: string[] = []
      const result = await Effect.runPromise(
        bootstrap({
          target: parseTarget("fixture"),
          version: input.version,
          development: input.development,
          replace: input.replace,
          env: {
            PATH: `${commands}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
            SSH_KEEPER_SCRIPTS: scripts,
            SSH_KEEPER_REGISTRATION: path.join(directory, "registration"),
            SSH_KEEPER_REGISTERED: input.registered ? "1" : "0",
            SSH_KEEPER_STAGED: input.staged ? "1" : "0",
            SSH_KEEPER_VERSION: input.version,
          },
          stage: (stage) =>
            Effect.sync(() => {
              stages.push(stage)
            }),
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ error: error.code }),
            onSuccess: (address) => ({ address }),
          }),
          Effect.provideService(
            HttpClient.HttpClient,
            // The package preloads a DOM. Observe typed HTTP requests directly,
            // before the low-level transport consults that DOM's base URL.
            HttpClient.makeWith<HttpClientError.HttpClientError, never, HttpClientError.HttpClientError, never>(
              (effect) =>
                effect.pipe(
                  Effect.map((request) => {
                    http.push(request.url)
                    return HttpClientResponse.fromWeb(
                      request,
                      request.url.endsWith("/beta")
                        ? new Response(JSON.stringify({ version: "0.0.0-beta-123.1" }), {
                            headers: { "content-type": "application/json" },
                          })
                        : new Response(null, { status: 404 }),
                    )
                  }),
                ),
              Effect.succeed,
            ),
          ),
          Effect.provide(NodeServices.layer),
        ),
      )
      const received = (await Bun.file(scripts).text()).split("\nOMNIXA_SSH_KEEPER_END\n").filter(Boolean)
      expect({
        result,
        stages,
        requests: received.length,
        ssh: received.map((script) =>
          [
            "service status",
            "--version",
            "OMNIXA_REMOTE_TARGET=",
            "curl ",
            "wget ",
            "service start",
            "service restart",
          ].filter((command) => script.includes(command)),
        ),
        http,
      }).toEqual({
        result:
          input.registered || input.staged
            ? { address: { host: "127.0.0.1", port: 1234, password: "fixture-secret" } }
            : { error: "unpublished" },
        stages: input.registered || input.staged ? ["checking", "starting"] : ["checking"],
        requests: input.requests,
        ssh: input.registered
          ? [["service status"]]
          : [
              ["service status"],
              ["--version"],
              ...(input.staged ? [["service status", `service ${input.replace ? "restart" : "start"}`]] : []),
            ],
        http: [],
      })
      expect(received[0]).toContain("service status")
      if (input.registered) return
      expect(received[1]).toContain(`/${input.version}/omnixa`)
      expect(received[1]).toContain("--version")
      if (!input.staged) return
      expect(received[2]).toContain(`/${input.version}/omnixa`)
      expect(received[2]).toContain(`service ${input.replace ? "restart" : "start"}`)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }),
)
