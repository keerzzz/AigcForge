import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const packageDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(packageDir, "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")
// The Electron 42 packaging update briefly installed Linux launchers/icons under
// "aigcfroge-desktop". Keep that hidden desktop entry around so existing GNOME/KDE
// pins still resolve after the canonical app id changes back to ai.aigcfroge.desktop.
const legacyDesktopEntry = path.join(packageDir, "resources", "linux", "aigcfroge-desktop.desktop")
const legacyDesktopEntryFpm = `${legacyDesktopEntry}=/usr/share/applications/aigcfroge-desktop.desktop`

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.AIGCFROGE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const APP_IDS = {
  dev: "ai.aigcfroge.desktop.dev",
  beta: "ai.aigcfroge.desktop.beta",
  prod: "ai.aigcfroge.desktop",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "aigcfroge-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.aigcfroge.desktop" becomes
  // "ai.aigcfroge.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: existsSync(path.join(packageDir, "native"))
    ? [
        {
          from: "native/",
          to: "native/",
          filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
        },
      ]
    : [],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: Boolean(process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER),
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: Boolean(process.env.APPLE_CERTIFICATE),
  },
  protocols: {
    name: "Aigcfroge",
    schemes: ["aigcfroge"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "Aigcfroge Dev",
        rpm: { packageName: "aigcfroge-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "Aigcfroge Beta",
        protocols: { name: "Aigcfroge Beta", schemes: ["aigcfroge"] },
        publish: { provider: "github", owner: "keerzzz", repo: "AigcForge-beta", channel: "latest" },
        rpm: { packageName: "aigcfroge-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "Aigcfroge",
        protocols: { name: "Aigcfroge", schemes: ["aigcfroge"] },
        publish: { provider: "github", owner: "keerzzz", repo: "AigcForge", channel: "latest" },
        deb: { fpm: [legacyDesktopEntryFpm] },
        rpm: { packageName: "aigcfroge", fpm: [legacyDesktopEntryFpm] },
      }
    }
  }
}

export default getConfig()
