interface ImportMetaEnv {
  readonly OMNIXA_CHANNEL: string
  readonly OMNIXA_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
