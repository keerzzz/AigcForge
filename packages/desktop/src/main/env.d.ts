interface ImportMetaEnv {
  readonly AIGCFROGE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:aigcfroge-server" {
  export namespace Server {
    export const listen: typeof import("../../../aigcfroge/dist/types/src/node").Server.listen
    export type Listener = import("../../../aigcfroge/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../aigcfroge/dist/types/src/node").Config.get
    export type Info = import("../../../aigcfroge/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../aigcfroge/dist/types/src/node").bootstrap
}
