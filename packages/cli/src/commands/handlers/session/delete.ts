import { AigcForge } from "@aigcfroge/client"
import { Service } from "@aigcfroge/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"

const handler = Effect.fn("cli.session.delete")(function* (
  input: Runtime.Input<typeof Commands.commands.session.commands.delete>,
) {
  const server = yield* ServerConnection.resolve({
    server: Option.getOrUndefined(input.server),
    standalone: input.standalone,
  })
  const client = AigcForge.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  yield* Effect.tryPromise({
    try: (signal) => client.session.remove({ sessionID: input.sessionID }, { signal }),
    catch: (cause) => cause,
  })
  process.stdout.write(`Session ${input.sessionID} deleted${EOL}`)
})

export default Runtime.handler(Commands.commands.session.commands.delete, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
