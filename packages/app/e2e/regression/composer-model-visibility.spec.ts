import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"

test.beforeEach(({ page }) => pinEnglishUI(page))

const directory = "C:/Aigcfroge/ModelVisibility"
const projectID = "proj_model_visibility"

// A connected non-aigcfroge provider makes `paid` true, so the full model
// selector renders; both branches expose data-action="prompt-model".
const provider = {
  all: [
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-x": { id: "claude-x", name: "Claude X", cost: { input: 1, output: 1 }, limit: { context: 200_000 } },
      },
    },
  ],
  connected: ["anthropic"],
  default: { providerID: "anthropic", modelID: "claude-x" },
}

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "model-visibility",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
  sandboxes: [],
}

const session = {
  id: "ses_model_visibility",
  slug: "model-visibility",
  projectID,
  directory,
  title: "Model visibility",
  mode: "coding",
  agent: "build",
  version: "dev",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}

async function open(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [] }),
  })
  await page.goto(`/${base64Encode(directory)}/session/${session.id}`)
  await expectAppVisible(page.locator('[data-component="session-composer"] [data-component="prompt-input"]'))
}

// Regression (composer-model-visibility): the model control must not be held
// hostage by the directory-scoped agent/provider queries. Previously
// `model.loading` OR-ed `agentsQuery.isLoading || providersQuery.isLoading`, so a
// slow directory-scoped `/agent` or `/provider` (routine on a cold desktop
// backend) hid the whole model control in every mode, while the agent control
// stayed visible because it reads the bootstrap store, not those queries. The
// gate now depends only on the app-wide provider catalog query.
test("model control stays visible while directory-scoped agent/provider queries are pending", async ({ page }) => {
  await open(page)

  // Hold the directory-scoped fetches open (never settle) AFTER the initial
  // store load, then reload so the composer's own queries hit the stall.
  // Directory-scoped requests are intentionally left pending; everything else falls through.
  const stallDirectoryScoped = (route: Route) => {
    if (!new URL(route.request().url()).searchParams.has("directory")) void route.fallback()
  }
  await page.route("**/agent?*", stallDirectoryScoped)
  await page.route("**/provider?*", stallDirectoryScoped)
  await page.reload()

  await expectAppVisible(page.locator('[data-component="session-composer"] [data-component="prompt-input"]'))
  // The gate depends only on the directoryless catalog query, which still resolves.
  await expect(page.locator('[data-action="prompt-model"]')).toBeVisible({ timeout: 15_000 })
})
