import { createAigcfrogeClient, createAigcfrogeServer } from "@aigcfroge/sdk"
import { pathToFileURL } from "bun"

const server = await createAigcfrogeServer()
const client = createAigcfrogeClient({ baseUrl: server.url })

const input = await Array.fromAsync(new Bun.Glob("packages/core/*.ts").scan())

await Promise.all(
  input.map(async (file) => {
    const session = await client.session.create({}, { throwOnError: true })
    console.log("processing", file)
    await client.session.prompt(
      {
        sessionID: session.data.id,
        parts: [
          {
            type: "file",
            mime: "text/plain",
            url: pathToFileURL(file).href,
          },
          {
            type: "text",
            text: `Write tests for every public function in this file.`,
          },
        ],
      },
      { throwOnError: true },
    )
    console.log("done", file)
  }),
)
