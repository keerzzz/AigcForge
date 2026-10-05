#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"
import { OpenApi } from "@aigcfroge/script/openapi"

// Code generation and the committed reference consume the same canonical spec.
const spec = await OpenApi.generateOpenApiSpec()
await Bun.write(path.join(dir, "openapi.json"), spec)
await Bun.write(path.resolve(dir, "../openapi.json"), spec)

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "AigcfrogeClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

// Patch a @hey-api/openapi-ts codegen bug: SseFn incorrectly passes the
// endpoint's TError into the second generic of ServerSentEventsResult, which
// is the AsyncGenerator's TReturn slot. Iterator return values have nothing
// to do with HTTP errors, and any consumer that calls `.return()` or returns
// from a mock generator gets type-checked against the wrong shape. Drop the
// arg so TReturn defaults to void.
await patchGeneratedType(
  "./src/v2/gen/client/types.gen.ts",
  "=> Promise<ServerSentEventsResult<TData, TError>>",
  "=> Promise<ServerSentEventsResult<TData>>",
)

// Both transports call fetch with one Request and await its result. Do not make
// local HTTP handlers implement runtime-specific helpers such as fetch.preconnect.
await patchGeneratedType(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  "fetch?: typeof fetch",
  "fetch?: (request: Request) => Response | Promise<Response>",
)
await patchGeneratedType(
  "./src/v2/gen/client/types.gen.ts",
  "fetch?: typeof fetch",
  'fetch?: ServerSentEventsOptions["fetch"]',
)

await $`bun prettier --write src/v2/gen`
await $`rm -rf dist`
// Clearing dist invalidates the outputs even when incremental metadata is unchanged.
await $`bun tsgo -b --force`
await $`rm openapi.json`

async function patchGeneratedType(file: string, before: string, after: string) {
  const source = await Bun.file(file).text()
  if (source.split(before).length !== 2) {
    throw new Error(`Expected one generated type patch target in ${file}: ${before}`)
  }
  await Bun.write(file, source.replace(before, after))
}
