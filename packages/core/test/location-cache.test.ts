import { describe, expect } from "bun:test"
import { Context, Effect, Layer, LayerMap, Ref, Schema } from "effect"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { WorkspaceV2 } from "@aigcfroge/core/workspace"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

describe("Location cache keys", () => {
  it.effect("shares a real LayerMap owner across implicit-local construction and transport round-trips", () =>
    Effect.gen(function* () {
      const builds = yield* Ref.make(0)
      const directory = AbsolutePath.make("/tmp/location-cache")
      const canonical = Location.Ref.make({ directory, workspaceID: undefined })
      const locations = yield* LayerMap.make((ref: Location.Ref) =>
        Location.layer(ref).pipe(
          Layer.provide(
            Layer.mock(Project.Service, {
              resolve: () =>
                Ref.updateAndGet(builds, (count) => count + 1).pipe(
                  Effect.as({ id: Project.ID.make("project"), directory }),
                ),
            }),
          ),
        ),
      )
      // Hold each lookup in the test scope so key identity, not idle eviction, is under test.
      const owner = Context.get(yield* locations.contextEffect(canonical), Location.Service)
      expect(Context.get(yield* locations.contextEffect(canonical), Location.Service)).toBe(owner)
      expect(yield* Ref.get(builds)).toBe(1)
      yield* Effect.forEach(
        [
          Location.Ref.make({ directory }),
          Schema.decodeUnknownSync(Location.Ref)({ directory }),
          Schema.decodeUnknownSync(Location.Ref)(Schema.encodeSync(Location.Ref)(canonical)),
        ],
        (ref) =>
          locations
            .contextEffect(ref)
            .pipe(
              Effect.tap((context) => Effect.sync(() => expect(Context.get(context, Location.Service)).toBe(owner))),
            ),
      )
      expect(yield* Ref.get(builds)).toBe(1)

      yield* Effect.forEach(
        [
          Location.Ref.make({ directory, workspaceID: WorkspaceV2.ID.make("wrk_one") }),
          Location.Ref.make({ directory, workspaceID: WorkspaceV2.ID.make("wrk_two") }),
          Location.Ref.make({ directory: AbsolutePath.make("/tmp/location-other") }),
        ],
        (ref) =>
          locations
            .contextEffect(ref)
            .pipe(
              Effect.tap((context) =>
                Effect.sync(() => expect(Context.get(context, Location.Service)).not.toBe(owner)),
              ),
            ),
      )
      expect(yield* Ref.get(builds)).toBe(4)
    }),
  )
})
