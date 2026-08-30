export * as PromptAssetPath from "./path"

import { Effect, Schema } from "effect"
import path from "path"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { PROMPTS_DIR } from "../constants"

export { PROMPTS_DIR }

export const DISALLOWED_CHARS = /[<>:"/\\|?*]/
export const CONTROL_CHARS = /[\x00-\x1F\x7F]/
export const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i

export const SEGMENT_MIN_BYTES = 1
export const SEGMENT_MAX_BYTES = 240
export const PATH_MAX_BYTES = 500

export class PathValidationError extends Schema.TaggedErrorClass<PathValidationError>()("PromptAsset.PathValidation", {
  reason: Schema.String,
  path: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

export function isValidSegment(segment: string): boolean {
  if (segment === "" || segment === "." || segment === "..") return false
  if (CONTROL_CHARS.test(segment)) return false
  if (DISALLOWED_CHARS.test(segment)) return false
  if (WINDOWS_RESERVED.test(segment)) return false
  if (segment.startsWith(" ") || segment.endsWith(" ")) return false
  if (segment.endsWith(".")) return false
  const bytes = utf8Bytes(segment)
  if (bytes < SEGMENT_MIN_BYTES || bytes > SEGMENT_MAX_BYTES) return false
  return true
}

export function validateRelativePath(relativePath: string): string {
  const trimmed = relativePath.trim()
  if (trimmed === "") throw new PathValidationError({ reason: "Path must not be empty", path: relativePath })
  if (path.isAbsolute(trimmed))
    throw new PathValidationError({ reason: "Path must not be absolute", path: relativePath })

  const normalized = trimmed.replace(/\\/g, "/")
  const segments = normalized.split("/")
  for (const segment of segments) {
    if (!isValidSegment(segment)) {
      throw new PathValidationError({ reason: `Invalid path segment: ${segment}`, path: relativePath })
    }
  }
  if (!normalized.endsWith(".md")) {
    throw new PathValidationError({ reason: "Path must end with .md", path: relativePath })
  }
  const bytes = utf8Bytes(normalized)
  if (bytes > PATH_MAX_BYTES) {
    throw new PathValidationError({ reason: `Path exceeds ${PATH_MAX_BYTES} UTF-8 bytes`, path: relativePath })
  }
  return normalized
}

export function nameToRelativePath(name: string): string {
  const normalized = name.normalize("NFKC").trim()
  if (normalized === "")
    throw new PathValidationError({ reason: "Name must not be empty after normalization", path: name })
  if (!isValidSegment(normalized)) {
    throw new PathValidationError({ reason: `Name is not a valid file segment: ${normalized}`, path: name })
  }
  return path.posix.join(PROMPTS_DIR, `${normalized}.md`)
}

export function resolveOwnerRoot(locationDirectory: string): string {
  return path.resolve(locationDirectory, PROMPTS_DIR)
}

export function resolveSafeTarget(
  relativePath: string,
  mutation: LocationMutation.Interface,
): Effect.Effect<LocationMutation.Target, PathValidationError | LocationMutation.PathError | FSUtil.Error> {
  return Effect.gen(function* () {
    const validated = yield* Effect.try({
      try: () => validateRelativePath(relativePath),
      catch: (error) =>
        error instanceof PathValidationError
          ? error
          : new PathValidationError({ reason: String(error), path: relativePath }),
    })
    const resource = path.posix.join(PROMPTS_DIR, validated)
    const target = yield* mutation.resolve({ path: resource })
    const canonicalResource = target.resource.replaceAll("\\", "/")
    if (target.externalDirectory || canonicalResource !== resource) {
      return yield* new PathValidationError({ reason: "Canonical path escapes prompt asset root", path: relativePath })
    }
    return target
  })
}
