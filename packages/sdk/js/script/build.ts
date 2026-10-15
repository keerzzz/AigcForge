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
await patchGeneratedSource(
  "./src/v2/gen/client/types.gen.ts",
  "=> Promise<ServerSentEventsResult<TData, TError>>",
  "=> Promise<ServerSentEventsResult<TData>>",
)

// Both transports call fetch with one Request and await its result. Do not make
// local HTTP handlers implement runtime-specific helpers such as fetch.preconnect.
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  "fetch?: typeof fetch",
  "fetch?: (request: Request) => Response | Promise<Response>",
)
await patchGeneratedSource(
  "./src/v2/gen/client/types.gen.ts",
  "fetch?: typeof fetch",
  'fetch?: ServerSentEventsOptions["fetch"]',
)

// Each SSE request owns cancellation; keep stream cleanup and retry on separate signals.
// Exact targets deliberately fail when the pinned upstream template changes.
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `  const sleep =
    sseSleepFn ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));`,
  `  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return resolve();
      const finish = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        signal.removeEventListener('abort', finish);
        if (timer !== undefined) clearTimeout(timer);
      };
      const fail = (error: unknown) => {
        cleanup();
        reject(error);
      };
      const timer = sseSleepFn ? undefined : setTimeout(finish, ms);
      signal.addEventListener('abort', finish, { once: true });
      if (!sseSleepFn) return;
      try {
        void sseSleepFn(ms).then(finish, fail);
      } catch (error) {
        fail(error);
      }
    });`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `        // fetch must be assigned here, otherwise it would throw the error:`,
  `        if (signal.aborted) break;
        // fetch must be assigned here, otherwise it would throw the error:`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `        const response = await _fetch(request);`,
  `        const response = await _fetch(request);
        if (signal.aborted) {
          abortRequest();
          await response.body?.cancel().catch(() => {});
          break;
        }`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `            if (done) break;`,
  `            if (done || signal.aborted) break;`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `            for (const chunk of chunks) {`,
  `            for (const chunk of chunks) {
              if (signal.aborted) break;`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `              onSseEvent?.({`,
  `              if (signal.aborted) break;
              onSseEvent?.({`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `              if (dataLines.length) {
                yield data as any;`,
  `              if (dataLines.length && !signal.aborted) {
                yield data as any;`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `        // connection failed or aborted; retry after delay`,
  `        abortRequest();
        if (signal.aborted) break;
        // connection failed; retry after delay`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `        await sleep(backoff);
      }
    }
  };`,
  `        await sleep(backoff, signal);
      } finally {
        signal.removeEventListener('abort', abortRequest);
        abortRequest();
      }
    }
  };`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `                if (responseTransformer) {`,
  `                if (signal.aborted) break;

                if (responseTransformer) {`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `        const abortHandler = () => {
          try {
            reader.cancel();
          } catch {
            // noop
          }
        };`,
  `        let cancellation: Promise<void> | undefined;
        const cancel = () => {
          abortRequest();
          return (cancellation ??= reader.cancel().catch(() => {}));
        };
        const abortHandler = () => {
          void cancel();
        };`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `          signal.removeEventListener('abort', abortHandler);
          reader.releaseLock();`,
  `          signal.removeEventListener('abort', abortHandler);
          await cancel();
          reader.releaseLock();`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `        if (!response.ok)
          throw new Error(
            \`SSE failed: \${response.status} \${response.statusText}\`,
          );`,
  `        if (!response.ok) {
          abortRequest();
          await response.body?.cancel().catch(() => {});
          throw new Error(
            \`SSE failed: \${response.status} \${response.statusText}\`,
          );
        }`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `      try {
        const requestInit: RequestInit = {`,
  `      const requestController = new AbortController();
      const abortRequest = () => requestController.abort(signal.reason);

      try {
        signal.addEventListener('abort', abortRequest, { once: true });
        if (signal.aborted) {
          abortRequest();
          break;
        }
        const requestInit: RequestInit = {`,
)
await patchGeneratedSource(
  "./src/v2/gen/core/serverSentEvents.gen.ts",
  `          headers,
          signal,`,
  `          headers,
          signal: requestController.signal,`,
)

await $`bun prettier --write src/v2/gen`
await $`rm -rf dist`
// Clearing dist invalidates the outputs even when incremental metadata is unchanged.
await $`bun tsgo -b --force`
await $`rm openapi.json`

async function patchGeneratedSource(file: string, before: string, after: string) {
  const source = await Bun.file(file).text()
  if (source.split(before).length !== 2) {
    throw new Error(`Expected one generated source patch target in ${file}: ${before}`)
  }
  await Bun.write(file, source.replace(before, after))
}
