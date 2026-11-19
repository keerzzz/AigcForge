import type { ElectronNative } from "../preload/types"

declare global {
  interface ImportMetaEnv {
    readonly AIGCFROGE_TEST_ONBOARDING: boolean
  }

  interface Window {
    electron: ElectronNative
    __AIGCFROGE__?: {
      deepLinks?: string[]
    }
  }
}
