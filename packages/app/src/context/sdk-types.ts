import type { AigcfrogeClient } from "@aigcfroge/sdk/v2/client"

/** Client type subset used by ChatImportDialog for ImportParser API calls. */
export type ImportParserClient = Pick<AigcfrogeClient, "importParser">
