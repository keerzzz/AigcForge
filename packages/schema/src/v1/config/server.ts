export * as ConfigServerV1 from "./server.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "../../schema.js"

export const Server = Schema.Struct({
  port: optional(PositiveInt).annotate({
    description: "Port to listen on",
  }),
  hostname: optional(Schema.String).annotate({ description: "Hostname to listen on" }),
  mdns: optional(Schema.Boolean).annotate({ description: "Enable mDNS service discovery" }),
  mdnsDomain: optional(Schema.String).annotate({
    description: "Custom domain name for mDNS service (default: aigcfroge.local)",
  }),
  cors: optional(Schema.Array(Schema.String)).annotate({
    description: "Additional domains to allow for CORS",
  }),
}).annotate({ identifier: "ServerConfig" })
export type Server = Schema.Schema.Type<typeof Server>
