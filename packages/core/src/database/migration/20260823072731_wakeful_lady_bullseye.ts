import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260823072731_wakeful_lady_bullseye",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`scoped_grant\` (
          \`id\` text PRIMARY KEY,
          \`level\` text NOT NULL,
          \`session_id\` text,
          \`action\` text NOT NULL,
          \`resources\` text NOT NULL,
          \`agent\` text,
          \`asset_revision\` text,
          \`issued_at\` integer NOT NULL,
          \`expires_at\` integer,
          \`revoked_at\` integer,
          \`consumed_at\` integer,
          \`grant_revision\` integer DEFAULT 1 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
