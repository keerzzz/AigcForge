import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260812035356_bouncy_jane_foster",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`kb_link\` (
          \`id\` integer PRIMARY KEY AUTOINCREMENT,
          \`source_note_id\` text NOT NULL,
          \`target_note_id\` text,
          \`target_title\` text NOT NULL,
          \`link_type\` text DEFAULT 'reference' NOT NULL,
          \`dangling\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_kb_link_source_note_id_kb_note_id_fk\` FOREIGN KEY (\`source_note_id\`) REFERENCES \`kb_note\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`kb_note\` (
          \`id\` text PRIMARY KEY,
          \`title\` text NOT NULL,
          \`content\` text NOT NULL,
          \`scope\` text NOT NULL,
          \`tags\` text NOT NULL,
          \`aliases\` text,
          \`format\` text DEFAULT 'note' NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`kb_link_source_idx\` ON \`kb_link\` (\`source_note_id\`);`)
      yield* tx.run(`CREATE INDEX \`kb_link_target_idx\` ON \`kb_link\` (\`target_note_id\`);`)
      yield* tx.run(`CREATE INDEX \`kb_link_dangling_idx\` ON \`kb_link\` (\`dangling\`);`)
      yield* tx.run(`CREATE UNIQUE INDEX \`kb_note_scope_title_unique\` ON \`kb_note\` (\`scope\`,\`title\`);`)
      yield* tx.run(`CREATE INDEX \`kb_note_scope_idx\` ON \`kb_note\` (\`scope\`);`)
      yield* tx.run(`CREATE INDEX \`kb_note_updated_idx\` ON \`kb_note\` (\`time_updated\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
