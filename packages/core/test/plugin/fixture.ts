import { Credential } from "@aigcfroge/core/credential"
import { EventV2 } from "@aigcfroge/core/event"
import { FileSystem } from "@aigcfroge/core/filesystem"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Global } from "@aigcfroge/core/global"
import { Npm } from "@aigcfroge/core/npm"
import { PluginV2 } from "@aigcfroge/core/plugin"
import { RepositoryCache } from "@aigcfroge/core/repository-cache"
import { Ripgrep } from "@aigcfroge/core/ripgrep"
import { SkillDiscovery } from "@aigcfroge/core/skill/discovery"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { tempLocationLayer } from "../fixture/location"

export const PluginTestLayer = Layer.mergeAll(FileSystem.locationLayer, PluginV2.locationLayer).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Credential.defaultLayer,
      EventV2.defaultLayer,
      FetchHttpClient.layer,
      FSUtil.defaultLayer,
      Global.defaultLayer,
      Layer.succeed(
        Npm.Service,
        Npm.Service.of({
          add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
          install: () => Effect.void,
          which: () => Effect.succeed(undefined),
        }),
      ),
      RepositoryCache.defaultLayer,
      SkillDiscovery.defaultLayer,
      Ripgrep.defaultLayer,
      tempLocationLayer,
    ),
  ),
)
