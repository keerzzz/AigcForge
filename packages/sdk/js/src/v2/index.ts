export * from "./client.js"
export * from "./server.js"

import { createAigcfrogeClient } from "./client.js"
import { createAigcfrogeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createAigcfroge(options?: ServerOptions) {
  const server = await createAigcfrogeServer({
    ...options,
  })

  const client = createAigcfrogeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
