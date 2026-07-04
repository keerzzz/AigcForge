// @ts-nocheck

import { Aigcfroge } from "@aigcfroge/core"
import { ReadTool } from "@aigcfroge/core/tools"

const aigcfroge = Aigcfroge.make({})

aigcfroge.tool.add(ReadTool)

aigcfroge.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(_input, _ctx) {},
})

aigcfroge.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

aigcfroge.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await aigcfroge.session.create({
  agent: "build",
})

aigcfroge.subscribe((event) => {
  console.log(event)
})

await aigcfroge.session.prompt({
  sessionID,
  text: "hey what is up",
})

await aigcfroge.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await aigcfroge.session.wait()

console.log(await aigcfroge.session.messages(sessionID))
