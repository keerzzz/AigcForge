export * as PathIdentity from "./path-identity"

import {
  CompareInput,
  DeviceInodeEvidence,
  RealPathEvidence,
  Same,
  type Result,
  Unknown,
} from "@aigcfroge/schema/path-identity"
import { Context, Effect, Layer, Option } from "effect"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"

export {
  CompareInput,
  DeviceInodeEvidence,
  Evidence,
  RealPathEvidence,
  Ref,
  Result,
  Same,
  Unknown,
  UnknownReason,
} from "@aigcfroge/schema/path-identity"

export interface Interface {
  readonly compare: (input: CompareInput) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/PathIdentity") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const compare = Effect.fn("PathIdentity.compare")(function* (input: CompareInput) {
      const [leftRealPath, rightRealPath] = yield* Effect.all([
        fs.realPath(input.left.path).pipe(Effect.option),
        fs.realPath(input.right.path).pipe(Effect.option),
      ])

      if (Option.isSome(leftRealPath) && Option.isSome(rightRealPath) && leftRealPath.value === rightRealPath.value) {
        return new Same({
          status: "same",
          refs: input,
          evidence: new RealPathEvidence({
            method: "realpath",
            path: AbsolutePath.make(leftRealPath.value),
          }),
        })
      }

      const [leftStat, rightStat] = yield* Effect.all([
        fs.stat(input.left.path).pipe(Effect.option),
        fs.stat(input.right.path).pipe(Effect.option),
      ])
      if (Option.isNone(leftStat) || Option.isNone(rightStat)) {
        return new Unknown({ status: "unknown", reason: "stat-unavailable" })
      }
      if (Option.isNone(leftStat.value.ino) || Option.isNone(rightStat.value.ino)) {
        return new Unknown({ status: "unknown", reason: "inode-unavailable" })
      }
      if (leftStat.value.dev !== rightStat.value.dev || leftStat.value.ino.value !== rightStat.value.ino.value) {
        return new Unknown({ status: "unknown", reason: "no-local-proof" })
      }

      return new Same({
        status: "same",
        refs: input,
        evidence: new DeviceInodeEvidence({
          method: "device-inode",
          device: leftStat.value.dev,
          inode: leftStat.value.ino.value,
        }),
      })
    })

    return Service.of({ compare })
  }),
)

export const locationLayer = layer
