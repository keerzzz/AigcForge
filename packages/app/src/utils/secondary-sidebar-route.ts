export function secondarySidebarAvailable(pathname: string) {
  if (pathname === "/") return false
  if (pathname === "/new-session") return false
  return true
}
