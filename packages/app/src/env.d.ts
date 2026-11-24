interface ImportMetaEnv {
  readonly VITE_OMNIXA_SERVER_MODE?: "none" | "origin"
  readonly VITE_OMNIXA_SERVER_HOST: string
  readonly VITE_OMNIXA_SERVER_PORT: string
  readonly VITE_OMNIXA_CHANNEL?: "local" | "dev" | "beta" | "prod"

  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  readonly VITE_SENTRY_RELEASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "*.png" {
  const src: string
  export default src
}

declare module "*.mp4" {
  const src: string
  export default src
}

export declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }

    // The Element Timing attribute, which Solid's DOM types do not list.
    interface ImgHTMLAttributes<T> {
      elementtiming?: string
    }
  }
}
