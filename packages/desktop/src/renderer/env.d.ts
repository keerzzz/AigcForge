import type { ElectronNative } from "../preload/types"

declare global {
  interface ImportMetaEnv {
    readonly OMNIXA_TEST_ONBOARDING: boolean
  }

  interface Window {
    electron: ElectronNative
    __OMNIXA__?: {
      deepLinks?: string[]
    }
  }
}
