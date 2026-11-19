import type { ElectronAPI } from "../api-types"

const deepLinkEvent = "aigcfroge:deep-link"

export function startDeepLinks(api: ElectronAPI) {
  void api.consumeInitialDeepLinks().then(emitDeepLinks)
  api.onDeepLink(emitDeepLinks)
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  window.__AIGCFROGE__ ??= {}
  window.__AIGCFROGE__.deepLinks = [...(window.__AIGCFROGE__.deepLinks ?? []), ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}
