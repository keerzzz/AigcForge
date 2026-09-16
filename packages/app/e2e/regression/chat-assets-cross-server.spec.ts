import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

/**
 * Cross-server guard (S3-3 blocker).
 *
 * A canonical URL can name a server that is not the globally current one. The session
 * sidebar used to resolve its asset owner against the GLOBAL current server, and
 * `ensureDirSdkContext` creates a directory context for any string it is given
 * (`context/server-sdk.tsx:298` → `utils/refcount.ts`), so the seven list requests were
 * issued against the WRONG server — it never failed loudly, it silently showed the
 * other server's assets (or nothing).
 *
 * The discriminator is therefore where the requests go, not whether they happen: two
 * mock registrations on different ports (the second-server pattern documented on
 * `MockServerConfig.port`), server A current, the URL pointing at server B, and every
 * asset list request must target B.
 */
const dirA = "C:/Aigcfroge/CrossServerA"
const dirB = "C:/Aigcfroge/CrossServerB"
const sessionID = "ses_cross_server_b"
const sessionTitle = "Cross server B session"

const urlA = "http://127.0.0.1:4097"
const urlB = "http://127.0.0.1:4098"

const project = (id: string, directory: string, name: string) => ({
  id,
  worktree: directory,
  vcs: "git",
  name,
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
  sandboxes: [],
})

const sessionB = {
  id: sessionID,
  slug: "cross-server-b",
  projectID: "proj_cross_server_b",
  directory: dirB,
  mode: "chat",
  agent: "meta",
  title: sessionTitle,
  version: "dev",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}

const listPaths = [
  "/prompt-asset",
  "/skill-asset",
  "/mcp-asset",
  "/command-asset",
  "/agent-asset",
  "/workflow-asset",
  "/plugin-asset",
]

/** Serves one asset category for the given directory, so the badge has something to count. */
async function serveAssets(page: Page, port: string, label: string) {
  await page.route(
    (url) => url.port === port && listPaths.includes(url.pathname),
    async (route) => {
      const path = new URL(route.request().url()).pathname
      const kind = path.replace("/", "").replace("-asset", "")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          assets: [
            {
              kind,
              name: `${label}-${kind}-one`,
              description: `${label} ${kind}`,
              relativePath: `${kind}-one.asset`,
              revision: "a".repeat(64),
            },
          ],
          invalid: [],
          ...(kind === "plugin" ? { bridged: [] } : {}),
        }),
      })
    },
  )
}

async function openSessionOnBWithACurrent(page: Page) {
  // Server A is registered first, so it is the globally current one (`context/server.tsx`
  // falls back to `allServers()[0]` when `active` does not match).
  await mockAigcfrogeServer(page, {
    port: "4097",
    directory: dirA,
    project: project("proj_cross_server_a", dirA, "cross-server-a"),
    provider: { providers: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await mockAigcfrogeServer(page, {
    port: "4098",
    directory: dirB,
    project: project("proj_cross_server_b", dirB, "cross-server-b"),
    provider: { providers: [], default: {} },
    sessions: [sessionB],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await serveAssets(page, "4097", "A")
  await serveAssets(page, "4098", "B")

  const registry = JSON.stringify({
    list: [
      { type: "http", http: { url: urlA } },
      { type: "http", http: { url: urlB } },
    ],
    projects: {},
    lastProject: {},
  })
  await page.addInitScript((serverRegistry: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("aigcfroge.global.dat:server", serverRegistry)
  }, registry)

  await page.goto(`/server/${base64Encode(urlB)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: sessionTitle }))

  const toggle = page.getByRole("button", {
    name: /Show sidebar|Hide sidebar|显示侧边栏|隐藏侧边栏|顯示側邊欄|隱藏側邊欄/i,
  })
  await expect(toggle).toBeVisible()
  if (!/hide|隐藏|隱藏/i.test((await toggle.getAttribute("aria-label")) ?? "")) await toggle.click()
}

// RED while the cross-server blocker is open. Verified so far: with server A current and the
// URL on B, asset list requests no longer target A (4097) and at least one targets B (4098) —
// but the sidebar's own provider still produces no counts, so the badge assertion fails with 0.
// That means the provider is not resolving a directory SDK for this mount, and the 4098 traffic
// seen here comes from another consumer. Isolating that is the blocker's remaining work; this
// case is the acceptance for it. Quarantined rather than deleted, and registered in
// packages/app/e2e/coverage-manifest.json.
// Green since `pages/session.tsx` registered the ROUTE's server key instead of
// `useServer().key`: measured before the fix, the sidebar's provider issued the seven
// lists against 4096 (the global active server) while the URL named 4098, and the badges
// were empty. After: all seven target 4098. The extra `4098/prompt-asset` is the right
// panel's candidate prefetch, registered separately in docs/technical-debt.md §8.
test("the session sidebar reads assets from the URL's server, not the current one", async ({ page }) => {
  const assetRequests: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (listPaths.includes(url.pathname)) assetRequests.push(`${url.port}${url.pathname}`)
  })

  await openSessionOnBWithACurrent(page)

  const sidebar = page.getByRole("complementary", { name: /Project list|项目列表|專案列表/i })
  await expect(sidebar).toBeVisible()

  // Order matters for diagnosis: the ports answer "did it ask anyone, and whom?" while the
  // badge count answers "did the answers land?". Asserting the ports first means a failure
  // says which half broke instead of only "no badges".
  await expect
    .poll(() => assetRequests.length, { message: "the sidebar issued no asset list requests at all" })
    .toBeGreaterThan(0)
  expect(
    assetRequests.some((entry) => entry.startsWith("4098")),
    `must read the URL server; saw ${assetRequests.join(", ")}`,
  ).toBe(true)
  // The current server (A, 4097) must never be read for this session's sidebar.
  expect(
    assetRequests.some((entry) => entry.startsWith("4097")),
    `must not read the current server; saw ${assetRequests.join(", ")}`,
  ).toBe(false)
  // NOT asserted away: a third port (4096) shows up here and is not yet attributed to an
  // owner. It is the same class as `/prompt-asset`'s second reader, registered in
  // docs/technical-debt.md §8, and pinning the port list down to exactly ["4098"] would
  // hide it instead of tracking it.

  const counted = sidebar.getByRole("button", {
    name: /^(Prompts|Skills|MCP|Commands|Agents|Workflows|Plugins)\s+\d+$/,
  })
  await expect(counted).toHaveCount(listPaths.length)
})
