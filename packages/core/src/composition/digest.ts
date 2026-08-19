export * as CompositionDigest from "./digest"

import { Schema } from "effect"
import { Composition } from "@aigcfroge/schema/composition"
import { Hash } from "../util/hash"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function canonicalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj
  if (Array.isArray(obj)) return obj.map(canonicalize)
  if (isRecord(obj)) {
    const sortedKeys = Object.keys(obj).sort()
    const result: Record<string, unknown> = {}
    for (const key of sortedKeys) {
      result[key] = canonicalize(obj[key])
    }
    return result
  }
  return obj
}

export function computeDigest(value: unknown): Composition.Digest {
  return Schema.decodeUnknownSync(Composition.Digest)(Hash.sha256(JSON.stringify(canonicalize(value))))
}

export function computeCompositionDigest(input: Composition.CompositionInput): Composition.Digest {
  return computeDigest(input)
}
