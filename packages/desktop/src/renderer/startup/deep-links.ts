import type { ElectronAPI } from "../api-types"

const deepLinkEvent = "omnixa:deep-link"

export function startDeepLinks(api: ElectronAPI) {
  void api.consumeInitialDeepLinks().then(emitDeepLinks)
  api.onDeepLink(emitDeepLinks)
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  window.__OMNIXA__ ??= {}
  window.__OMNIXA__.deepLinks = [...(window.__OMNIXA__.deepLinks ?? []), ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}
