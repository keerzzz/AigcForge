import { Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"

/**
 * Decodes a composition snapshot out of an HTTP response body.
 *
 * A snapshot with no profile serialises `profilePath: null` / `profileRevision: null`,
 * but those fields are declared `optionalOmitUndefined` (present-or-absent, never null),
 * so neither the class schema nor its JSON codec accepts the null form — they mean
 * "absent", not "null". Normalise null-valued keys to absent before decoding so every
 * real profile-less snapshot decodes instead of showing
 * "服务端返回的组合本客户端无法解析" / falling the slash-command catalog back to empty.
 * Found by the 2026-09-03 dogfood run (BUG-CUSTOM-SNAPSHOT); the saved response is in
 * `docs/review/five-mode-dogfood-2026-09-03/custom-snapshot-response.json`.
 *
 * Accepts either the bare snapshot or `{ snapshot }`, since the composition read and the
 * custom-start response wrap it differently.
 */
const decodeSnapshot = Schema.decodeUnknownOption(Schema.toCodecJson(Composition.Snapshot))

/** Drop null-valued own keys: the server emits null for absent optional fields. */
function nullsAsAbsent(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null))
}

export function decodeSnapshotResponse(data: unknown): Composition.Snapshot | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const direct = decodeSnapshot(nullsAsAbsent(data))
  if (direct._tag === "Some") return direct.value
  if ("snapshot" in data) {
    const nested = decodeSnapshot(nullsAsAbsent((data as { snapshot: unknown }).snapshot))
    if (nested._tag === "Some") return nested.value
  }
  return undefined
}
