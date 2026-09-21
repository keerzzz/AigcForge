// Aliases resolve the namespace method name collision between Hash and Noble.
import { sha1 as nobleSha1 } from "@noble/hashes/legacy.js"
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js"

type HashInput = string | Uint8Array

const bytes = (input: HashInput) => (typeof input === "string" ? utf8ToBytes(input) : input)

export namespace Hash {
  export function fast(input: HashInput): string {
    return bytesToHex(nobleSha1(bytes(input)))
  }

  export function sha256(input: HashInput): string {
    return bytesToHex(nobleSha256(bytes(input)))
  }
}
