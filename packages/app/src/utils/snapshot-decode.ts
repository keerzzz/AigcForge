import { Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"

/**
 * Decodes a composition snapshot out of an HTTP response body.
 *
 * Uses `Schema.toCodecJson`, not the class schema directly, because the server produced
 * this payload through the HttpApi's JSON codec. The two are not interchangeable: a
 * snapshot with no profile serialises `profilePath: null` / `profileRevision: null`, and
 * `Schema.decodeUnknownOption(Snapshot)` rejects those (the fields are declared
 * `Schema.optional`, i.e. `string | undefined`) while the JSON codec accepts them. Both
 * call sites used the class schema, so every real snapshot without a profile decoded as
 * "undecodable" — the panel showed "服务端返回的组合本客户端无法解析" and the slash-command
 * catalog silently fell back to empty. Found by the 2026-09-03 dogfood run
 * (BUG-CUSTOM-SNAPSHOT); the saved response is in
 * `docs/review/five-mode-dogfood-2026-09-03/custom-snapshot-response.json`.
 *
 * Accepts either the bare snapshot or `{ snapshot }`, since the composition read and the
 * custom-start response wrap it differently.
 */
const decodeSnapshot = Schema.decodeUnknownOption(Schema.toCodecJson(Composition.Snapshot))

export function decodeSnapshotResponse(data: unknown): Composition.Snapshot | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const direct = decodeSnapshot(data)
  if (direct._tag === "Some") return direct.value
  if ("snapshot" in data) {
    const nested = decodeSnapshot((data as { snapshot: unknown }).snapshot)
    if (nested._tag === "Some") return nested.value
  }
  return undefined
}
