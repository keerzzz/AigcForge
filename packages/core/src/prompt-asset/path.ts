import { Effect, Schema } from "effect"
import path from "path"
import { FSUtil } from "../fs-util"

export const PROMPTS_DIR = ".aigcfroge/prompts"

export const DISALLOWED_CHARS = /[<>:"/\\|?*]/
export const CONTROL_CHARS = /[\x00-\x1F\x7F]/

export const SEGMENT_MIN_BYTES = 1
export const SEGMENT_MAX_BYTES = 100
export const PATH_MAX_BYTES = 240

export class PathValidationError extends Schema.TaggedErrorClass<PathValidationError>()(
  "PromptAsset.PathValidation",
  { reason: Schema.String, path: Schema.String },
) {}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

export function isValidSegment(segment: string): boolean {
  if (segment === "" || segment === "." || segment === "..") return false
  if (CONTROL_CHARS.test(segment)) return false
  if (DISALLOWED_CHARS.test(segment)) return false
  if (segment.startsWith(" ") || segment.endsWith(" ")) return false
  if (segment.endsWith(".")) return false
  const bytes = utf8Bytes(segment)
  if (bytes < SEGMENT_MIN_BYTES || bytes > SEGMENT_MAX_BYTES) return false
  return true
}

export function validateRelativePath(relativePath: string): string {
  const trimmed = relativePath.trim()
  if (trimmed === "") throw new PathValidationError({ reason: "Path must not be empty", path: relativePath })
  if (path.isAbsolute(trimmed)) throw new PathValidationError({ reason: "Path must not be absolute", path: relativePath })

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
  if (normalized === "") throw new PathValidationError({ reason: "Name must not be empty after normalization", path: name })
  if (!isValidSegment(normalized)) {
    throw new PathValidationError({ reason: `Name is not a valid file segment: ${normalized}`, path: name })
  }
  return path.posix.join(PROMPTS_DIR, `${normalized}.md`)
}

export function resolveOwnerRoot(locationDirectory: string): string {
  return path.resolve(locationDirectory, PROMPTS_DIR)
}

export function resolveSafeTarget(
  directory: string,
  relativePath: string,
  fs: FSUtil.Interface,
): Effect.Effect<{ canonical: string; lexical: string }, PathValidationError | FSUtil.Error> {
  return Effect.gen(function* () {
    const validated = yield* Effect.try({
      try: () => validateRelativePath(relativePath),
      catch: (err) => err instanceof PathValidationError ? err : new PathValidationError({ reason: String(err), path: relativePath }),
    })
    const ownerRoot = resolveOwnerRoot(directory)
    const lexical = path.resolve(ownerRoot, validated)
    if (!FSUtil.contains(ownerRoot, lexical)) {
      return yield* new PathValidationError({ reason: "Lexical path escapes owner root", path: relativePath })
    }
    const canonical = yield* fs.realPath(lexical).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(lexical)),
    )
    if (!FSUtil.contains(ownerRoot, canonical)) {
      return yield* new PathValidationError({ reason: "Canonical path escapes owner root (symlink)", path: relativePath })
    }
    return { canonical, lexical }
  })
}
