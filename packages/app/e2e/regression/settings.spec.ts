import { expect, test, type Page } from "@playwright/test"
import type {
  ConfigEntry,
  OmnixaEvent,
  WorktreeDirectory,
  ModelGroupRead,
  ModelGroupDefinition,
} from "@omnixa/client/promise"
import type { ProviderDefinition } from "@omnixa/schema/provider-definition"
import type { ProviderDiscovery } from "@omnixa/schema/provider-discovery"
import { Schema } from "effect"
import { ModelGroup } from "@omnixa/schema/model-group"
import { ModelSource } from "@omnixa/schema/model-source"
import { NO_PROVIDER, REMOTE_SERVER, SERVER, holdRoute, project, seed, session, sessionHref } from "../utils/app"
import { mockOmnixaServer } from "../utils/mock-server"
import { mockRemoteServer, mockWorkspace, openSettings, type WorkspaceInput } from "../utils/workspace"

function mutableGroupDefinition(value: typeof ModelGroup.Definition.Encoded): ModelGroupDefinition {
  return {
    ...value,
    members: value.members.map((member) => ({
      ...member,
      connections: member.connections?.map((connection) => ({ ...connection })),
    })),
  }
}

const directory = "C:/Projects/settings-demo"

const projectID = "proj_settings_demo"

const sandboxes = Array.from({ length: 12 }, (_, index) => `${directory}/workspace-${index + 1}`)

const override =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='red'/%3E%3C/svg%3E"

test.use({ serviceWorkers: "block" })

// One project with 12 worktrees, each with one session, and a configured zsh shell.
function open(page: Page, input: Partial<WorkspaceInput> = {}) {
  return openSettings(page, {
    name: "Settings demo",
    directory,
    project: { icon: { color: "orange", override }, commands: { start: "echo setup" }, sandboxes },
    provider: NO_PROVIDER,
    configEntries: [
      { type: "document", path: "/home/test/.config/omnixa/omnixa.jsonc", info: { shell: "/bin/zsh" } },
      { type: "directory", path: "/home/test/.config/omnixa" },
    ],
    shells: [
      { path: "/bin/zsh", name: "zsh", acceptable: true },
      { path: "/bin/bash", name: "bash", acceptable: true },
    ],
    sessions: sandboxes.map((item, index) => ({
      id: `ses_settings_${index + 1}`,
      title: `Workspace ${index + 1} session`,
      directory: item,
    })),
    ...input,
    seed: { tabs: [], ...input.seed },
  })
}

async function openProject(page: Page, name = "Settings demo") {
  const settings = page.getByTestId("settings-screen")
  await settings.getByRole("tab", { name: "Projects", exact: true }).click()
  await settings.getByRole("button", { name, exact: true }).click()
  await expect(settings.getByRole("button", { name: "Back to projects", exact: true })).toBeVisible()
}

test("sidebar preferences hide and restore global navigation through reload", async ({ page }) => {
  const { settings } = await open(page)
  const sidebars = settings.getByRole("region", { name: "Sidebars", exact: true })
  const visible = sidebars.getByRole("switch", { name: "Show global navigation", exact: true })
  await expect(visible).toBeChecked()
  await visible.focus()
  await page.keyboard.press("Space")
  await expect(page.getByRole("navigation", { name: "Modes", exact: true })).toHaveCount(0)
  await page.reload()
  await expect(visible).not.toBeChecked()
  await page.getByRole("button", { name: "Expand navigation", exact: true }).click()
  await expect(visible).toBeChecked()
  await expect(page.getByRole("navigation", { name: "Modes", exact: true })).toBeVisible()
})

const patched = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === "PATCH" && new URL(request.url()).pathname === `/api/project/${projectID}`,
  )

test("model groups preserve member order, variants, target conflicts and selection through reload", async ({
  page,
}) => {
  const globalTarget = {
    scope: "global" as const,
    path: "/home/test/.config/omnixa/omnixa.jsonc",
    digest: "global-0",
    preferred: true,
    writable: true,
  }

  const projectTarget = {
    scope: "project" as const,
    path: `${directory}/omnixa.jsonc`,
    digest: "project-0",
    preferred: false,
    writable: true,
  }

  const connections = [
    { type: "credential" as const, id: "account-active", label: "Primary account", method: "key" as const },
    {
      type: "credential" as const,
      id: "account-backup",
      label: "Backup account",
      method: "oauth" as const,
      status: { status: "needs_auth" as const, message: "Sign in to the backup account again." },
    },
    { type: "env" as const, name: "PROVIDER_TOKEN" },
  ]

  const activations: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && /^\/api\/credential\/[^/]+\/activate$/.test(new URL(request.url()).pathname))
      activations.push(request.url())
  })

  type ModelGroupState = {
    global?: ModelGroupDefinition
    project?: ModelGroupDefinition
    saves: Array<typeof ModelGroup.SaveInput.Type>
    removes: Array<typeof ModelGroup.RemoveInput.Type>
  }

  const state: ModelGroupState = { saves: [], removes: [] }

  const read = (): ModelGroupRead => {
    const definitions = [
      ...(state.global
        ? [
            {
              groupID: "fast",
              definition: state.global,
              source: { scope: "global" as const, path: globalTarget.path },
              target: globalTarget,
              inherited: [],
            },
          ]
        : []),
      ...(state.project
        ? [
            {
              groupID: "fast",
              definition: state.project,
              source: { scope: "project" as const, path: projectTarget.path },
              target: projectTarget,
              inherited: [{ scope: "global" as const, path: globalTarget.path }],
            },
          ]
        : []),
    ]

    const current = definitions.at(-1)

    return {
      targets: [globalTarget, projectTarget],
      definitions,
      effective: current ? [{ groupID: current.groupID, definition: current.definition, source: current.source }] : [],
    }
  }

  const { settings, push } = await open(page, {
    sessions: [{ id: "ses_model_groups", title: "Model group selection", directory }],
    provider: {
      all: [
        {
          id: "provider",
          name: "Provider",
          integrationID: "shared-provider",
          models: {
            alpha: { id: "alpha", name: "Alpha", variants: { high: {} } },
            beta: { id: "beta", name: "Beta" },
          },
        },
      ],
      connected: ["provider"],
      default: { providerID: "provider", modelID: "alpha" },
    },
    integrations: [
      { id: "shared-provider", name: "Shared provider", methods: [], connections },
      {
        id: "unrelated-provider",
        name: "Unrelated provider",
        methods: [],
        connections: [{ type: "credential", id: "unrelated-account", label: "Unrelated account", method: "key" }],
      },
    ],
    modelGroups: read,
    onModelGroupSave: (input) => {
      state.saves.push(input)

      if (state.saves.length === 2) {
        projectTarget.digest = "project-external"

        return {
          groupID: input.groupID,
          definition: { status: "conflict", target: projectTarget, message: "The project definition changed." },
        }
      }

      const target = input.target.scope === "project" ? projectTarget : globalTarget
      const authored = Schema.decodeUnknownSync(ModelGroup.Definition)(input.patch.set)
      const definition = mutableGroupDefinition(Schema.encodeSync(ModelGroup.Definition)(authored))

      if (input.target.scope === "project") state.project = definition
      else state.global = definition
      target.digest = `${input.target.scope}-${state.saves.length}`

      return { groupID: input.groupID, definition: { status: "saved", target }, readback: read() }
    },
    onModelGroupRemove: (input) => {
      state.removes.push(input)
      state.project = undefined
      projectTarget.digest = "project-removed"

      return {
        groupID: input.groupID,
        definition: { status: "saved", target: projectTarget },
        inherited: [{ scope: "global", path: globalTarget.path }],
        readback: read(),
      }
    },
  })

  await settings.getByRole("tab", { name: "Models", exact: true }).click()
  const groups = settings.getByRole("region", { name: "Model groups", exact: true })
  await groups.getByRole("button", { name: "Add model group", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Add model group", exact: true })
  await editor.getByLabel("Group ID", { exact: true }).fill("fast")
  await editor.getByLabel("Name", { exact: true }).fill("Fast route")
  await editor.getByRole("group", { name: "Add member", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "Alpha (Provider)", exact: true }).click()
  await editor.getByRole("group", { name: "Add member", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "Beta (Provider)", exact: true }).click()
  await editor.getByRole("button", { name: "Move Beta up", exact: true }).click()
  await expect(editor.getByRole("listitem").nth(0)).toContainText("Beta")
  await editor.getByRole("group", { name: "Variant for Alpha", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "high", exact: true }).click()
  await editor.getByRole("group", { name: "Selection strategy", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "Weighted", exact: true }).click()
  await editor.getByRole("group", { name: "Connection affinity", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "Current session", exact: true }).click()
  await editor.getByLabel("Weight for Beta", { exact: true }).fill("1.25")
  await editor.getByLabel("Weight for Alpha", { exact: true }).fill("2.5")
  const alphaConnections = editor.getByRole("group", { name: "Connections for Alpha", exact: true })
  await expect(
    alphaConnections.getByRole("checkbox", { name: "Use current active connection", exact: true }),
  ).toBeChecked()
  await expect(
    editor
      .getByRole("group", { name: "Connections for Beta", exact: true })
      .getByRole("checkbox", { name: "Use current active connection", exact: true }),
  ).toBeChecked()
  await alphaConnections.getByText("Use current active connection", { exact: true }).click()
  await expect(
    alphaConnections.getByRole("checkbox", { name: "Use current active connection", exact: true }),
  ).not.toBeChecked()
  await alphaConnections.getByText("Primary account", { exact: true }).click()
  await expect(alphaConnections.getByRole("checkbox", { name: "Primary account", exact: true })).toBeChecked()
  await alphaConnections.getByText("Backup account", { exact: true }).click()
  await expect(alphaConnections.getByRole("checkbox", { name: "Backup account", exact: true })).toBeChecked()
  await alphaConnections.getByText("PROVIDER_TOKEN", { exact: true }).click()
  await expect(alphaConnections.getByRole("checkbox", { name: "PROVIDER_TOKEN", exact: true })).toBeChecked()
  await expect(alphaConnections.getByText("Sign-in required", { exact: true })).toBeVisible()
  await expect(alphaConnections.getByText("Sign in to the backup account again.", { exact: true })).toBeVisible()
  await expect(alphaConnections.getByRole("checkbox", { name: "Unrelated account", exact: true })).toHaveCount(0)
  await alphaConnections.getByLabel("Connection weight for Primary account in Alpha", { exact: true }).fill("2")
  await alphaConnections.getByLabel("Connection weight for Backup account in Alpha", { exact: true }).fill("0.5")
  await editor.getByRole("button", { name: "Save", exact: true }).click()
  await expect(editor.getByRole("status")).toHaveText("Model group saved.")

  const alphaMember = {
    id: "alpha",
    providerID: "provider",
    variant: "high",
    weight: 2.5,
    connections: [
      { ref: { type: "credential", id: "account-active" }, weight: 2 },
      { ref: { type: "credential", id: "account-backup" }, weight: 0.5 },
      { ref: { type: "env", name: "PROVIDER_TOKEN" } },
    ],
  }

  expect(state.saves[0]).toMatchObject({
    groupID: "fast",
    expectedDigest: "global-0",
    target: { scope: "global", path: globalTarget.path },
  })
  expect(state.saves[0].patch.set).toEqual({
    name: "Fast route",
    enabled: true,
    members: [{ id: "beta", providerID: "provider", weight: 1.25 }, alphaMember],
    strategy: "weight",
    affinity: "session",
  })
  expect(activations).toEqual([])
  await editor.locator("form").getByRole("button", { name: "Close", exact: true }).click()
  connections.splice(1, 1)
  await push([
    { id: "evt_group_connection_removed", type: "credential.updated", created: 2, location: { directory }, data: {} },
  ])
  await groups.getByRole("button", { name: "Edit Fast route", exact: true }).click()
  const override = page.getByRole("dialog", { name: "Edit Fast route", exact: true })
  const overrideConnections = override.getByRole("group", { name: "Connections for Alpha", exact: true })
  await expect(overrideConnections.getByRole("checkbox", { name: "account-backup", exact: true })).toBeChecked()
  await expect(overrideConnections.getByText("Missing connection", { exact: true })).toBeVisible()
  await expect(
    overrideConnections.getByLabel("Connection weight for account-backup in Alpha", { exact: true }),
  ).toHaveValue("0.5")
  await expect(
    override.getByRole("group", { name: "Selection strategy", exact: true }).getByRole("button"),
  ).toContainText("Weighted")
  await expect(
    override.getByRole("group", { name: "Connection affinity", exact: true }).getByRole("button"),
  ).toContainText("Current session")
  await override.getByRole("group", { name: "Save to", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: `Project configuration · ${projectTarget.path}`, exact: true }).click()
  await expect(override.getByLabel("Weight for Alpha", { exact: true })).toHaveValue("2.5")
  await override.getByRole("group", { name: "Selection strategy", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "Round robin", exact: true }).click()
  await override.getByRole("group", { name: "Connection affinity", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "No affinity", exact: true }).click()
  await override.getByLabel("Name", { exact: true }).fill("Project route")
  await override.getByRole("button", { name: "Remove Beta", exact: true }).click()
  await override.getByRole("button", { name: "Save", exact: true }).click()
  await expect(override.getByRole("status")).toHaveText("The project definition changed.")
  await expect(override.getByLabel("Name", { exact: true })).toHaveValue("Project route")
  await expect(overrideConnections.getByRole("checkbox", { name: "account-backup", exact: true })).toBeChecked()
  await override.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(override.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
  await override.getByRole("button", { name: "Save", exact: true }).click()
  await expect(override.getByRole("status")).toHaveText("Model group saved.")
  expect(state.saves[2]).toMatchObject({
    expectedDigest: "project-external",
    target: { scope: "project", path: projectTarget.path },
    patch: { set: { members: [alphaMember], strategy: "rotate", affinity: "off" } },
  })
  await override.locator("form").getByRole("button", { name: "Close", exact: true }).click()
  await page.goto(sessionHref("ses_model_groups"))
  const model = page.locator('[data-action="composer-model"]')
  await expect(model).toBeEnabled()
  await model.click()
  await page.getByRole("menuitemradio", { name: "Project route", exact: true }).click()
  await expect(model).toContainText("Group · Project route")
  await page.reload()
  await expect(model).toContainText("Group · Project route")
  await page.goto("/settings")
  await page.getByTestId("settings-screen").getByRole("tab", { name: "Models", exact: true }).click()
  await page
    .getByRole("region", { name: "Model groups", exact: true })
    .getByRole("button", { name: "Edit Project route", exact: true })
    .click()
  const removal = page.getByRole("dialog", { name: "Edit Project route", exact: true })
  const removalConnections = removal.getByRole("group", { name: "Connections for Alpha", exact: true })
  await expect(
    removal.getByRole("group", { name: "Selection strategy", exact: true }).getByRole("button"),
  ).toContainText("Round robin")
  await expect(
    removal.getByRole("group", { name: "Connection affinity", exact: true }).getByRole("button"),
  ).toContainText("No affinity")
  await expect(removalConnections.getByRole("checkbox", { name: "account-backup", exact: true })).toBeChecked()
  await removalConnections.getByText("Primary account", { exact: true }).click()
  await expect(removalConnections.getByRole("checkbox", { name: "Primary account", exact: true })).not.toBeChecked()
  await removalConnections.getByText("account-backup", { exact: true }).click()
  await expect(removalConnections.getByRole("checkbox", { name: "account-backup", exact: true })).toHaveCount(0)
  await removalConnections.getByText("PROVIDER_TOKEN", { exact: true }).click()
  await expect(removalConnections.getByRole("checkbox", { name: "PROVIDER_TOKEN", exact: true })).not.toBeChecked()
  await expect(
    removalConnections.getByText("No connections selected. This member has no candidates.", { exact: true }),
  ).toBeVisible()
  await removal.getByRole("group", { name: "Selection strategy", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "In order", exact: true }).click()
  await removal.getByRole("group", { name: "Connection affinity", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "Current turn", exact: true }).click()
  await removal.getByRole("button", { name: "Save", exact: true }).click()
  await expect(removal.getByRole("status")).toHaveText("Model group saved.")
  expect(state.saves[3].patch.set?.members).toEqual([
    { id: "alpha", providerID: "provider", variant: "high", weight: 2.5, connections: [] },
  ])
  await removal.locator("form").getByRole("button", { name: "Close", exact: true }).click()
  await page
    .getByRole("region", { name: "Model groups", exact: true })
    .getByRole("button", { name: "Edit Project route", exact: true })
    .click()
  await expect(
    removalConnections.getByRole("checkbox", { name: "Use current active connection", exact: true }),
  ).not.toBeChecked()
  await expect(
    removalConnections.getByText("No connections selected. This member has no candidates.", { exact: true }),
  ).toBeVisible()
  await removalConnections.getByText("Use current active connection", { exact: true }).click()
  await expect(
    removalConnections.getByRole("checkbox", { name: "Use current active connection", exact: true }),
  ).toBeChecked()
  await removal.getByRole("button", { name: "Save", exact: true }).click()
  await expect(removal.getByRole("status")).toHaveText("Model group saved.")
  expect(state.saves[4].patch.set?.members).toEqual([
    { id: "alpha", providerID: "provider", variant: "high", weight: 2.5 },
  ])
  await removal.getByRole("button", { name: "Remove definition", exact: true }).click()
  await expect(removal.getByRole("status")).toHaveText("Model group definition removed.")
  expect(state.removes).toHaveLength(1)
  expect(state.removes[0]).toMatchObject({
    groupID: "fast",
    expectedDigest: "project-5",
    target: { scope: "project", path: projectTarget.path },
  })
  await removal.locator("form").getByRole("button", { name: "Close", exact: true }).click()
  await page.goto(sessionHref("ses_model_groups"))
  await expect(model).toContainText("Group · Fast route")
  expect(activations).toEqual([])
})

test("model groups and direct models keep distinct picker identities", async ({ page }) => {
  await open(page, {
    seed: {
      storage: {
        "omnixa.global.dat:model": {
          user: [
            { providerID: "group", modelID: "base", visibility: "show" },
            { providerID: "group", modelID: '"route"', visibility: "show" },
          ],
          recent: [],
          variant: {},
        },
      },
    },
    sessions: [
      {
        id: "ses_model_picker_identity",
        title: "Model picker identity",
        directory,
        model: { id: "base", providerID: "group" },
      },
    ],
    provider: {
      all: [
        {
          id: "group",
          name: "Group provider",
          models: {
            base: { id: "base", name: "Base model" },
            '"route"': { id: '"route"', name: "Quoted model" },
          },
        },
      ],
      connected: ["group"],
      default: { providerID: "group", modelID: "base" },
    },
    modelGroups: {
      targets: [],
      definitions: [],
      effective: [
        {
          groupID: "route",
          definition: {
            name: "Quoted route",
            enabled: true,
            members: [{ id: '"route"', providerID: "group" }],
            strategy: "order",
            affinity: "off",
          },
        },
      ],
    },
  })

  await page.goto(sessionHref("ses_model_picker_identity"))
  const model = page.locator('[data-action="composer-model"]')
  await expect(model).toHaveText("Base model")
  await model.click()
  const menu = page.getByRole("menu")
  const direct = menu.getByRole("menuitemradio", { name: "Quoted model", exact: true })
  const group = menu.getByRole("menuitemradio", { name: "Quoted route", exact: true })
  const search = menu.getByPlaceholder("Search models")
  await expect(group).toBeVisible()
  await direct.hover()
  await expect(search).toBeFocused()
  await search.press("Enter")
  await expect(model).toHaveText("Quoted model")

  await model.click()
  await expect(direct).toHaveAttribute("aria-checked", "true")
  await expect(group).toHaveAttribute("aria-checked", "false")
  await group.click()
  await expect(model).toHaveText("Group · Quoted route")
  await model.click()
  await expect(group).toHaveAttribute("aria-checked", "true")
  await expect(direct).toHaveAttribute("aria-checked", "false")
})

test("model groups preserve dynamic strategies, connection facts and draft weights through refresh and reload", async ({
  page,
}) => {
  const observedAt = Date.now()

  const target = {
    scope: "global" as const,
    path: "/home/test/.config/omnixa/omnixa.jsonc",
    digest: "dynamic-0",
    preferred: true,
    writable: true,
  }

  const metadata: Record<"alpha" | "beta" | "gamma" | "delta", Schema.Codec.Encoded<typeof ModelSource.Metadata>> = {
    alpha: {
      quote: {
        status: "known",
        source: "provider-price-sheet",
        observedAt,
        validFrom: observedAt - 60_000,
        validUntil: observedAt + 3_600_000,
        prices: [{ input: 2, output: 8, cache: { read: 0.5, write: 3 } }],
      },
      quota: {
        status: "known",
        source: "account-usage",
        connection: { type: "credential", id: "account-active" },
        observedAt,
        freshUntil: observedAt + 3_600_000,
        plan: "Plus",
        allowed: true,
        freeModel: false,
        freePlan: false,
        credits: { balance: 12.5, expiresAt: observedAt + 7_200_000 },
        windows: [
          {
            id: "requests",
            scope: "account",
            unit: "requests",
            usedRatio: 0.25,
            remaining: 75,
            total: 100,
            resetAt: observedAt + 3_600_000,
            spanMs: 3_600_000,
          },
          {
            id: "model-tokens",
            scope: "model",
            modelIDs: ["alpha"],
            unit: "model-tokens",
            usedRatio: 0.5,
            remaining: 500,
            total: 1_000,
            resetAt: observedAt + 7_200_000,
            spanMs: 7_200_000,
          },
        ],
      },
    },
    beta: { quote: { status: "unknown" } },
    gamma: {
      quote: {
        status: "known",
        source: "expired-price-sheet",
        observedAt: observedAt - 120_000,
        validUntil: observedAt - 60_000,
        prices: [{ input: 4, output: 12, cache: { read: 1, write: 6 } }],
      },
      quota: {
        status: "known",
        source: "older-account-usage",
        observedAt: observedAt - 120_000,
        freshUntil: observedAt - 60_000,
        windows: [{ id: "requests", scope: "account", unit: "requests", usedRatio: 0.8, remaining: 20, total: 100 }],
      },
    },
    delta: {
      quote: {
        status: "free",
        source: "explicit-free-price",
        prices: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
      },
      quota: {
        status: "unsupported",
        source: "chatgpt-shared-token",
        connection: { type: "credential", id: "account-active" },
        observedAt,
        reason: "unsupported",
        windows: [],
      },
    },
  }

  type DynamicModelGroupState = {
    definition: ModelGroupDefinition
    saves: Array<typeof ModelGroup.SaveInput.Type>
  }

  const state: DynamicModelGroupState = {
    definition: {
      name: "Dynamic route",
      enabled: true,
      strategy: "weight",
      affinity: "session",
      members: [
        {
          id: "alpha",
          providerID: "provider",
          variant: "high",
          weight: 2.5,
          connections: [
            { ref: { type: "credential", id: "account-active" }, weight: 2 },
            { ref: { type: "credential", id: "account-backup" }, weight: 0.5 },
            { ref: { type: "env", name: "PROVIDER_TOKEN" } },
          ],
        },
        { id: "beta", providerID: "provider", weight: 1.25 },
        { id: "gamma", providerID: "provider" },
        { id: "delta", providerID: "provider" },
      ],
    },
    saves: [],
  }

  const members = structuredClone(state.definition.members)
  const activations: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST" && /^\/api\/credential\/[^/]+\/activate$/.test(new URL(request.url()).pathname))
      activations.push(request.url())
  })

  const read = (): ModelGroupRead => ({
    targets: [target],
    definitions: [
      {
        groupID: "dynamic",
        definition: state.definition,
        source: { scope: "global", path: target.path },
        target,
        inherited: [],
      },
    ],
    effective: [{ groupID: "dynamic", definition: state.definition, source: { scope: "global", path: target.path } }],
  })

  const { settings, push } = await open(page, {
    provider: () => ({
      all: [
        {
          id: "provider",
          name: "Provider",
          integrationID: "shared-provider",
          models: {
            alpha: { id: "alpha", name: "Alpha", metadata: metadata.alpha, variants: { high: {} } },
            beta: { id: "beta", name: "Beta", metadata: metadata.beta },
            gamma: { id: "gamma", name: "Gamma", metadata: metadata.gamma },
            delta: { id: "delta", name: "Delta", metadata: metadata.delta },
          },
        },
      ],
      connected: ["provider"],
      default: { providerID: "provider", modelID: "alpha" },
    }),
    integrations: [
      {
        id: "shared-provider",
        name: "Shared provider",
        methods: [],
        connections: [
          { type: "credential", id: "account-active", label: "Primary account", method: "key" },
          { type: "credential", id: "account-backup", label: "Backup account", method: "oauth" },
          { type: "env", name: "PROVIDER_TOKEN" },
        ],
      },
    ],
    modelGroups: read,
    onModelGroupSave: (input) => {
      state.saves.push(input)
      state.definition = mutableGroupDefinition(
        Schema.encodeSync(ModelGroup.Definition)(Schema.decodeUnknownSync(ModelGroup.Definition)(input.patch.set)),
      )
      target.digest = `dynamic-${state.saves.length}`

      return { groupID: input.groupID, definition: { status: "saved", target }, readback: read() }
    },
  })

  await settings.getByRole("tab", { name: "Models", exact: true }).click()
  await settings
    .getByRole("region", { name: "Model groups", exact: true })
    .getByRole("button", { name: "Edit Dynamic route", exact: true })
    .click()
  const editor = page.getByRole("dialog", { name: "Edit Dynamic route", exact: true })
  const strategy = editor.getByRole("group", { name: "Selection strategy", exact: true }).getByRole("button")
  await strategy.click()
  await Promise.all(
    [
      "In order",
      "Round robin",
      "Weighted",
      "Fastest",
      "Lowest cost",
      "Smart",
      "Usage balance",
      "Quota pace",
      "Free",
      "Expiring first",
      "Drain quota",
    ].map((name) => expect(page.getByRole("option", { name, exact: true })).toBeVisible()),
  )
  await page.getByRole("option", { name: "Lowest cost", exact: true }).click()
  await expect(
    editor.getByText("Requires known input, output and cache token prices within the quote's validity period.", {
      exact: true,
    }),
  ).toBeVisible()
  const alphaQuote = editor.getByLabel("Quote for Alpha", { exact: true })
  await expect(alphaQuote.getByText("Price known", { exact: true })).toBeVisible()
  await expect(alphaQuote.getByText("provider-price-sheet", { exact: true })).toBeVisible()
  await expect(alphaQuote.getByText("Input: $2.00 / 1M tokens", { exact: true })).toBeVisible()
  await expect(alphaQuote.getByText("Output: $8.00 / 1M tokens", { exact: true })).toBeVisible()
  await expect(alphaQuote.getByText("Cache read: $0.50 / 1M tokens", { exact: true })).toBeVisible()
  await expect(alphaQuote.getByText("Cache write: $3.00 / 1M tokens", { exact: true })).toBeVisible()
  await expect(alphaQuote.getByText("Valid from", { exact: true })).toBeVisible()
  await expect(alphaQuote.getByText("Valid until", { exact: true })).toBeVisible()
  const betaQuote = editor.getByLabel("Quote for Beta", { exact: true })
  await expect(betaQuote.getByText("Price unknown", { exact: true })).toBeVisible()
  await expect(betaQuote.getByText("Free", { exact: true })).toHaveCount(0)
  await expect(
    editor.getByLabel("Quote for Gamma", { exact: true }).getByText("Quote expired", { exact: true }),
  ).toBeVisible()
  await expect(editor.getByLabel("Quote for Delta", { exact: true }).getByText("Free", { exact: true })).toBeVisible()
  await strategy.click()
  await page.getByRole("option", { name: "Fastest", exact: true }).click()
  await expect(
    editor.getByText("Requires recent time to first token and output token rate measurements for each connection.", {
      exact: true,
    }),
  ).toBeVisible()
  await strategy.click()
  await page.getByRole("option", { name: "Free", exact: true }).click()
  const primaryQuota = editor.getByLabel("Quota for Alpha · Primary account", { exact: true })
  await expect(primaryQuota.getByText("Quota known", { exact: true })).toBeVisible()
  await expect(primaryQuota.getByText("account-usage", { exact: true })).toBeVisible()
  await expect(primaryQuota.getByText("requests · Account window · requests", { exact: true })).toBeVisible()
  await expect(primaryQuota.getByText("model-tokens · Model window · model-tokens", { exact: true })).toBeVisible()
  await expect(primaryQuota.getByText("Remaining: 75 requests", { exact: true })).toBeVisible()
  await expect(primaryQuota.getByText("Remaining: 500 model-tokens", { exact: true })).toBeVisible()
  await expect(primaryQuota.getByText("Used: 25%", { exact: true })).toBeVisible()
  await expect(primaryQuota.getByText("Used: 50%", { exact: true })).toBeVisible()
  await expect(primaryQuota.getByText("Window duration: 1 h", { exact: true })).toBeVisible()
  await expect(primaryQuota.getByText("Window duration: 2 h", { exact: true })).toBeVisible()
  await expect(primaryQuota.getByText("12.5", { exact: true })).toBeVisible()
  const backupQuota = editor.getByLabel("Quota for Alpha · Backup account", { exact: true })
  await expect(backupQuota.getByText("Quota unknown", { exact: true })).toBeVisible()
  await expect(backupQuota.getByText("No quota observations for this connection.", { exact: true })).toBeVisible()
  await expect(backupQuota.getByText("account-usage", { exact: true })).toHaveCount(0)
  await expect(
    editor.getByLabel("Quota for Alpha · PROVIDER_TOKEN", { exact: true }).getByText("Quota unknown", { exact: true }),
  ).toBeVisible()
  await expect(
    editor
      .getByLabel("Quota for Beta · Current active connection", { exact: true })
      .getByText("Quota unknown", { exact: true }),
  ).toBeVisible()
  await expect(
    editor
      .getByLabel("Quota for Gamma · Current active connection", { exact: true })
      .getByText("Quota data expired", { exact: true }),
  ).toBeVisible()
  await expect(
    editor
      .getByLabel("Quota for Delta · Current active connection", { exact: true })
      .getByText("Quota lookup unsupported", { exact: true }),
  ).toBeVisible()
  await editor.getByRole("button", { name: "Save", exact: true }).click()
  await expect(editor.getByRole("status")).toHaveText("Model group saved.")
  expect(state.saves[0].patch.set).toEqual({
    name: "Dynamic route",
    enabled: true,
    members,
    strategy: "free",
    affinity: "session",
  })
  await editor.locator("form").getByRole("button", { name: "Close", exact: true }).click()
  await settings
    .getByRole("region", { name: "Model groups", exact: true })
    .getByRole("button", { name: "Edit Dynamic route", exact: true })
    .click()
  await expect(strategy).toContainText("Free")
  await strategy.click()
  await page.getByRole("option", { name: "Usage balance", exact: true }).click()
  metadata.alpha = { ...metadata.alpha, quota: { ...metadata.alpha.quota!, freshUntil: observedAt - 1 } }
  await push([
    { id: "evt_dynamic_quota_expired", type: "model.updated", created: observedAt, location: { directory }, data: {} },
  ])
  await expect(primaryQuota.getByText("Quota data expired", { exact: true })).toBeVisible()
  await expect(editor.getByLabel("Weight for Alpha", { exact: true })).toHaveValue("2.5")
  await expect(editor.getByLabel("Weight for Beta", { exact: true })).toHaveValue("1.25")
  await expect(editor.getByLabel("Connection weight for Primary account in Alpha", { exact: true })).toHaveValue("2")
  await expect(editor.getByLabel("Connection weight for Backup account in Alpha", { exact: true })).toHaveValue("0.5")
  await editor.getByRole("button", { name: "Refresh", exact: true }).click()
  await expect(strategy).toContainText("Usage balance")
  await strategy.click()
  await page.getByRole("option", { name: "Expiring first", exact: true }).click()
  await editor.getByRole("button", { name: "Save", exact: true }).click()
  await expect(editor.getByRole("status")).toHaveText("Model group saved.")
  expect(state.saves[1].patch.set).toEqual({
    name: "Dynamic route",
    enabled: true,
    members,
    strategy: "expiring",
    affinity: "session",
  })
  await editor.locator("form").getByRole("button", { name: "Close", exact: true }).click()
  await page.reload()
  await page.getByTestId("settings-screen").getByRole("tab", { name: "Models", exact: true }).click()
  await page
    .getByRole("region", { name: "Model groups", exact: true })
    .getByRole("button", { name: "Edit Dynamic route", exact: true })
    .click()
  await expect(strategy).toContainText("Expiring first")
  await expect(primaryQuota.getByText("Quota data expired", { exact: true })).toBeVisible()
  await expect(editor.getByRole("group", { name: "Variant for Alpha", exact: true }).getByRole("button")).toContainText(
    "high",
  )
  await expect(
    editor.getByRole("group", { name: "Connection affinity", exact: true }).getByRole("button"),
  ).toContainText("Current session")
  await expect(editor.getByLabel("Weight for Alpha", { exact: true })).toHaveValue("2.5")
  expect(activations).toEqual([])
})

test("provider definitions discover and import models, resume saves, and preserve overrides and picker preferences", async ({
  page,
}, testInfo) => {
  type DefinitionInfo = Schema.Codec.Encoded<typeof ProviderDefinition.Info>

  type SaveInput = typeof ProviderDefinition.SaveInput.Type

  type DiscoveryRead = Schema.Codec.Encoded<typeof ProviderDiscovery.Read>

  type PreviewInput = typeof ProviderDiscovery.PreviewInput.Type

  type RefreshInput = typeof ProviderDiscovery.RefreshInput.Type

  type DefinitionState = {
    info?: DefinitionInfo
    saves: SaveInput[]
    removed: boolean
    previews: PreviewInput[]
    refreshes: RefreshInput[]
    discovery?: DiscoveryRead
  }

  const target = {
    scope: "global" as const,
    path: "/home/test/.config/omnixa/omnixa.jsonc",
    digest: "initial",
    preferred: true,
    writable: true,
  }

  const state: DefinitionState = { saves: [], removed: false, previews: [], refreshes: [] }

  const metadata: DiscoveryRead["candidates"][number]["metadata"] = {
    name: "Listed Model B",
    capabilities: { tools: false, input: ["text"], output: ["text"] },
    limit: { context: 64_000, output: 4096 },
    quote: { status: "unknown" },
  }

  const identity: NonNullable<DiscoveryRead["inventory"]>["identity"] = {
    providerID: "custom-provider",
    listURL: "https://api.example.com/v1/models",
    protocol: "openai",
    auth: "bearer",
    configurationDigest: "listed-definition",
  }

  const listing: DiscoveryRead = {
    status: {
      providerID: "custom-provider",
      identity,
      phase: "ready",
      cachePersisted: false,
      generation: 1,
      lastAttemptAt: 1_794_701_000_000,
      lastSuccessAt: 1_794_701_000_000,
    },
    inventory: {
      identity,
      complete: true,
      digest: "complete-list",
      observedAt: 1_794_701_000_000,
      models: [
        { id: "model-b", metadata },
        { id: "candidate-c", metadata: { name: "Candidate C", quote: { status: "unknown" } } },
      ],
    },
    candidates: [
      { id: "model-b", metadata, managedRefs: [], membership: "present" },
      {
        id: "candidate-c",
        metadata: { name: "Candidate C", quote: { status: "unknown" } },
        managedRefs: [],
        membership: "present",
      },
    ],
    managed: [],
  }

  const stale: DiscoveryRead = {
    ...listing,
    candidates: [{ id: "stale-model", metadata: { name: "Stale Model" }, managedRefs: [], membership: "present" }],
  }

  const changed = Promise.withResolvers<DiscoveryRead>()
  const canceled = Promise.withResolvers<DiscoveryRead>()

  const { settings } = await open(page, {
    providerDefinitions: () => ({ targets: [target], definitions: state.info ? [state.info] : [] }),
    provider: () =>
      state.info?.definition.adoption?.phase === "ready" && !state.info.definition.disabled
        ? {
            all: [
              {
                id: "custom-provider",
                name: "Custom Provider",
                models: {
                  "model-a": { id: "model-a", name: "Model A", release_date: "2020-01-01" },
                  "model-b": {
                    id: "model-b",
                    name: state.info.definition.models?.["model-b"]?.name ?? "Listed Model B",
                    api: { id: "model-b" },
                    release_date: "2020-01-01",
                    metadata: {
                      ...metadata,
                      name: state.info.definition.models?.["model-b"]?.name ?? "Listed Model B",
                    },
                    origins: {
                      name: state.info.definition.models?.["model-b"]?.name
                        ? "user"
                        : state.discovery
                          ? "live"
                          : "seed",
                      capabilities: {
                        tools: state.discovery ? "live" : "seed",
                        input: state.discovery ? "live" : "seed",
                        output: state.discovery ? "live" : "seed",
                      },
                      limit: { context: state.discovery ? "live" : "seed", output: state.discovery ? "live" : "seed" },
                      quote: "unknown",
                    },
                  },
                },
              },
            ],
            connected: ["custom-provider"],
            default: { providerID: "custom-provider", modelID: "model-a" },
          }
        : NO_PROVIDER,
    providerDiscovery: () =>
      state.info?.definition.discovery?.enabled === false
        ? { ...(state.discovery ?? listing), status: { ...(state.discovery ?? listing).status, phase: "disabled" } }
        : (state.discovery ?? {
            status: { providerID: "custom-provider", phase: "idle", cachePersisted: false, generation: 0 },
            candidates: [],
            managed: [],
          }),
    onProviderDiscoveryPreview: (input) => {
      state.previews.push(input)

      if (state.previews.length === 1) return changed.promise

      if (state.previews.length === 2) return canceled.promise

      if (state.previews.length === 3)
        return {
          ...listing,
          status: { ...listing.status, phase: "partial", lastSuccessAt: undefined },
          inventory: { ...listing.inventory!, complete: false, digest: "partial-list" },
        }

      return listing
    },
    onProviderDiscoveryRefresh: (input) => {
      state.refreshes.push(input)
      const failed = state.refreshes.length === 2
      state.discovery = {
        ...listing,
        status: {
          ...listing.status,
          phase: failed ? "failed" : "ready",
          cachePersisted: true,
          error: failed ? { kind: "auth", message: "The directory rejected this credential" } : undefined,
        },
        candidates: listing.candidates.map((candidate) => ({
          ...candidate,
          managedRefs: candidate.id === "model-b" ? [{ providerID: "custom-provider", id: "model-b" }] : [],
        })),
        managed: [
          {
            ref: { providerID: "custom-provider", id: "model-b" },
            modelID: "model-b",
            metadata,
            origins: {
              name: "live",
              capabilities: { tools: "live", input: "live", output: "live" },
              limit: { context: "live", output: "live" },
              quote: "unknown",
            },
            membership: "present",
            seed: state.info?.definition.models?.["model-b"]?.seed,
          },
        ],
      }

      return state.discovery
    },
    onProviderDefinitionSave: (input) => {
      state.saves.push(input)
      const partial = state.saves.length === 1
      const definition = { ...(state.info?.definition ?? input.patch.set ?? {}) }

      if (state.saves.length === 3 && state.info)
        return {
          providerID: input.providerID,
          submissionID: input.submissionID,
          definition: { status: "conflict", target, message: "The configuration changed since it was read" },
          credential: { status: "skipped" },
          catalog: { status: "pending" },
          info: state.info,
          addedModelIDs: [],
        }

      if (input.patch.set?.name !== undefined) definition.name = input.patch.set.name

      if (input.patch.set?.disabled !== undefined) definition.disabled = input.patch.set.disabled

      if (input.patch.set?.discovery) definition.discovery = { ...definition.discovery, ...input.patch.set.discovery }

      if (input.patch.set?.models) definition.models = { ...definition.models, ...input.patch.set.models }

      if (partial && definition.models?.["model-b"]?.seed)
        definition.models = {
          ...definition.models,
          "model-b": {
            ...definition.models["model-b"],
            seed: {
              ...definition.models["model-b"].seed,
              identity: {
                ...definition.models["model-b"].seed.identity,
                connection: { type: "credential", id: "credential-provider-test" },
              },
            },
          },
        }

      if (input.patch.unset?.some((path) => path[0] === "models" && path[1] === "model-b" && path[2] === "name"))
        definition.models = {
          ...definition.models,
          "model-b": { modelID: "model-b", seed: definition.models?.["model-b"]?.seed },
        }

      state.info = {
        providerID: input.providerID,
        source: { scope: "global", path: target.path },
        target,
        definition: {
          ...definition,
          adoption: {
            phase: partial ? "applying" : "ready",
            submissionID: input.submissionID,
            targetDefinitionDigest: "submitted",
            stage: partial ? "credential" : "complete",
            credentialAction: input.credential.type,
            credentialID: "credential-provider-test",
            activate: true,
            addedModelIDs: ["model-a", "model-b"],
          },
        },
        redactedPaths: [],
        inherited: [],
        connections: partial
          ? []
          : [{ type: "credential", id: "credential-provider-test", label: "Saved account", method: "key" }],
      }

      return {
        providerID: input.providerID,
        submissionID: input.submissionID,
        definition: { status: "saved" as const, target },
        credential: {
          status: partial ? ("pending" as const) : ("created" as const),
          message: partial ? "Credential write failed" : undefined,
        },
        catalog: { status: partial ? ("pending" as const) : ("ready" as const) },
        info: state.info,
        addedModelIDs: ["model-a", "model-b"],
      }
    },
    onProviderDefinitionRemove: (input) => {
      state.removed = true
      state.info = undefined

      return { providerID: input.providerID, definition: { status: "saved", target }, inherited: [] }
    },
  })

  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  await settings.getByRole("button", { name: "Add provider", exact: true }).click()
  const form = page.getByRole("dialog", { name: "Custom provider", exact: true })
  await expect(form.getByRole("group", { name: "Save to", exact: true }).getByRole("button")).toBeEnabled()

  await form.getByRole("textbox", { name: "Provider ID", exact: true }).fill("custom-provider")
  await form.getByRole("textbox", { name: "Base URL", exact: true }).fill("https://api.example.com/v1")
  const authentication = form.getByRole("group", { name: "Authentication", exact: true }).getByRole("button")
  const account = form.getByRole("group", { name: "Choose an account", exact: true }).getByRole("button")
  await authentication.click()
  await page.getByRole("listbox").getByRole("option", { name: "Use an existing account", exact: true }).click()
  await expect(authentication).toHaveText("Use an existing account")
  await expect(account).toBeEnabled()
  await form.getByRole("button", { name: "Fetch models", exact: true }).click()
  await expect(form.getByText("Choose an existing account", { exact: true })).toBeVisible()
  await authentication.click()
  await page.getByRole("listbox").getByRole("option", { name: "Keep current authentication", exact: true }).click()
  await expect(authentication).toHaveText("Keep current authentication")
  await expect(account).toHaveCount(0)
  await expect(form.getByText("Choose an existing account", { exact: true })).toHaveCount(0)
  await authentication.click()
  await page.getByRole("listbox").getByRole("option", { name: "Use an existing account", exact: true }).click()
  await expect(authentication).toHaveText("Use an existing account")
  await expect(account).toBeEnabled()
  await authentication.click()
  await page.getByRole("listbox").getByRole("option", { name: "Add an API key", exact: true }).click()
  await expect(authentication).toHaveText("Add an API key")
  await expect(account).toHaveCount(0)
  await form.getByLabel("API key", { exact: true }).fill("test-only-key")
  await form.getByRole("button", { name: "Fetch models", exact: true }).click()
  await expect(form.getByRole("button", { name: "Cancel fetch", exact: true })).toBeVisible()
  await expect.poll(() => state.previews.length).toBe(1)
  expect(state.previews[0]?.credential).toEqual({ type: "key", key: "test-only-key" })
  expect(state.previews[0]?.definition.type).toBe("new")
  await form.getByRole("textbox", { name: "Base URL", exact: true }).fill("https://api.example.com/v2")
  await expect(form.getByRole("button", { name: "Cancel fetch", exact: true })).toBeHidden()
  changed.resolve(stale)
  await form.getByRole("textbox", { name: "Base URL", exact: true }).fill("https://api.example.com/v1")
  await form.getByRole("button", { name: "Fetch models", exact: true }).click()
  await expect.poll(() => state.previews.length).toBe(2)
  await form.getByRole("button", { name: "Cancel fetch", exact: true }).click()
  canceled.resolve(stale)
  await expect(form.getByText("Stale Model", { exact: true })).toBeHidden()
  await form.getByRole("button", { name: "Fetch models", exact: true }).click()
  await expect(form.getByText("The model list was not fetched completely", { exact: true })).toBeVisible()
  await expect(form.getByText(/Showing the last successful model list from/)).toHaveCount(0)
  await form.getByRole("searchbox", { name: "Search discovered models", exact: true }).fill("model-b")
  const candidate = form.getByRole("checkbox", { name: /Listed Model B/ })
  await candidate.focus()
  await candidate.press("Space")
  await expect(candidate).toBeChecked()
  await expect(form.getByText("Listed Model B", { exact: true })).toBeInViewport({ ratio: 1 })
  await form.getByRole("button", { name: "Add selected models", exact: true }).click()
  await expect(form.getByRole("textbox", { name: "ID", exact: true }).first()).toHaveValue("model-b")
  await expect(form.getByRole("textbox", { name: "Name", exact: true }).first()).toHaveValue("")
  expect(state.saves).toHaveLength(0)
  await form.getByRole("textbox", { name: "Name", exact: true }).first().fill("Draft override")
  await form.getByText("Model overrides", { exact: true }).click()
  await form.getByRole("textbox", { name: "Context window override", exact: true }).fill("12345")
  await form.getByLabel("API key", { exact: true }).fill("fresh-draft-key")
  await expect(form.getByRole("textbox", { name: "ID", exact: true }).first()).toHaveValue("model-b")
  await expect(form.getByRole("textbox", { name: "Name", exact: true }).first()).toHaveValue("Draft override")
  await expect(form.getByRole("textbox", { name: "Context window override", exact: true })).toHaveValue("12345")
  await form.getByRole("textbox", { name: "Name", exact: true }).first().fill("")
  await form.getByRole("textbox", { name: "Context window override", exact: true }).fill("")
  await form.getByRole("button", { name: "Fetch models", exact: true }).click()
  await expect(form.getByText("Model list ready", { exact: true })).toBeVisible()
  expect(state.previews.at(-1)?.credential).toEqual({ type: "key", key: "fresh-draft-key" })
  await candidate.focus()
  await candidate.press("Space")
  await form.getByRole("button", { name: "Add selected models", exact: true }).click()
  await expect(form.getByRole("textbox", { name: "ID", exact: true })).toHaveCount(1)
  await form.getByRole("textbox", { name: "Display name", exact: true }).fill("Custom Provider")
  await form.getByRole("button", { name: "Add model", exact: true }).click()
  await form.getByRole("textbox", { name: "ID", exact: true }).nth(1).fill("model-a")
  await form.getByRole("textbox", { name: "Name", exact: true }).nth(1).fill("Model A")

  await form.getByRole("button", { name: "Save", exact: true }).click()
  await expect(form.getByText("Authentication: Pending", { exact: true })).toBeVisible()
  await expect(form.getByText("Credential write failed", { exact: true })).toBeVisible()
  await expect(form.getByRole("textbox", { name: "Provider ID", exact: true })).toBeDisabled()
  await expect(authentication).toBeDisabled()
  expect(state.saves).toHaveLength(1)
  expect(state.saves[0]?.patch.set?.package).toBe("@omnixa/ai/providers/openai-compatible")
  expect(state.saves[0]?.target).toEqual({ scope: "global", path: target.path })
  expect(state.saves[0]?.patch.set?.models?.["model-b"]).toEqual({
    modelID: "model-b",
    seed: { identity, inventoryDigest: "complete-list", observedAt: listing.inventory!.observedAt, metadata },
  })
  expect(state.saves[0]?.patch.set?.models).not.toHaveProperty("candidate-c")
  const submissionID = state.saves[0]?.submissionID
  await form.getByRole("button", { name: "Done", exact: true }).click()
  await settings.getByRole("button", { name: "Edit Custom Provider", exact: true }).click()
  await expect(form.getByRole("textbox", { name: "Provider ID", exact: true })).toHaveValue("custom-provider")
  await expect(form.getByRole("button", { name: "Continue save", exact: true })).toBeEnabled()
  await form.getByLabel("API key", { exact: true }).fill("fresh-draft-key")
  await form.getByRole("button", { name: "Continue save", exact: true }).click()
  await expect(form).toBeHidden()
  expect(state.saves).toHaveLength(2)
  expect(state.saves[1]?.submissionID).toBe(submissionID)
  expect(state.saves[1]?.patch).toEqual({})
  const savedSeed = state.info?.definition.models?.["model-b"]?.seed
  expect(savedSeed?.identity.connection).toEqual({ type: "credential", id: "credential-provider-test" })
  await settings.getByRole("tab", { name: "Models", exact: true }).click()
  const visibility = settings.getByRole("switch", { name: "Model A", exact: true })
  await expect(visibility).toBeChecked()
  await expect(settings.getByRole("switch", { name: "Listed Model B", exact: true })).toBeChecked()
  await expect(settings.getByRole("switch", { name: "Candidate C", exact: true })).toHaveCount(0)

  await visibility.focus()
  await visibility.press("Space")
  await expect(visibility).toBeChecked({ checked: false })
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  await settings.getByRole("button", { name: "Edit Custom Provider", exact: true }).click()
  await expect(form.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Custom Provider")
  await form.getByRole("textbox", { name: "Display name", exact: true }).fill("Edited Provider")
  await form.getByRole("button", { name: "Save", exact: true }).click()
  await expect(form.getByText("Configuration: Changed by another writer", { exact: true })).toBeVisible()
  await expect(form.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
  await expect(form.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Edited Provider")
  await form.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(form.getByRole("button", { name: "Save", exact: true })).toBeEnabled()
  await form.getByRole("button", { name: "Save", exact: true }).click()
  await expect(form).toBeHidden()
  await settings.getByRole("tab", { name: "Models", exact: true }).click()
  await expect(visibility).toBeChecked({ checked: false })
  await settings.getByText("Listed Model B", { exact: true }).first().hover()
  const tooltip = page.getByRole("tooltip")
  await expect(tooltip.getByText("Price unknown", { exact: true })).toBeVisible()
  await expect(tooltip.getByText("Not supported", { exact: true })).toBeVisible()
  await page.mouse.move(1, 1)
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  await settings.getByRole("button", { name: "Model list", exact: true }).click()
  const storedList = settings.getByRole("region", { name: "Model list", exact: true })
  await storedList.getByRole("button", { name: "Refresh model list", exact: true }).click()
  await expect(storedList.getByText("Model list ready", { exact: true })).toBeVisible()
  await storedList.getByRole("button", { name: "Refresh model list", exact: true }).click()
  await expect(storedList.getByText("The directory rejected this credential", { exact: true })).toBeVisible()
  await expect(storedList.getByText(/Showing the last successful model list from/)).toBeVisible()
  await expect(storedList.getByText("Listed Model B", { exact: true })).toBeVisible()
  await expect(settings.getByText("custom-provider · " + target.path, { exact: true })).toBeInViewport({ ratio: 1 })
  expect(state.refreshes).toHaveLength(2)
  const autoSync = storedList.getByRole("switch", { name: "Automatic sync", exact: true })
  await autoSync.focus()
  await autoSync.press("Space")
  await expect(autoSync).toBeChecked()
  expect(state.saves.at(-1)?.patch.set).toEqual({ discovery: { autoSync: true } })
  expect(state.saves.at(-1)?.credential).toEqual({ type: "keep" })
  await autoSync.focus()
  await autoSync.press("Space")
  await expect(autoSync).toBeChecked({ checked: false })
  const source = storedList.getByRole("switch", { name: "Model list source", exact: true })
  await source.focus()
  await source.press("Space")
  await expect(source).toBeChecked({ checked: false })
  await expect(storedList.getByText("Model list source is off", { exact: true })).toBeVisible()
  await source.focus()
  await source.press("Space")
  await expect(source).toBeChecked()
  await settings.getByRole("tab", { name: "Models", exact: true }).click()
  await expect(visibility).toBeChecked({ checked: false })
  await expect(settings.getByRole("switch", { name: "Listed Model B", exact: true })).toBeChecked()
  await expect(settings.getByRole("switch", { name: "Candidate C", exact: true })).toHaveCount(0)
  await settings.getByRole("button", { name: "Edit Listed Model B", exact: true }).click()
  await form.getByRole("textbox", { name: "Name", exact: true }).first().fill("Personal Model B")
  await form.getByRole("textbox", { name: "Context window override", exact: true }).fill("128000")
  await authentication.click()
  await page.getByRole("listbox").getByRole("option", { name: "Use an existing account", exact: true }).click()
  await expect(authentication).toHaveText("Use an existing account")
  await account.click()
  await page.getByRole("listbox").getByRole("option", { name: "Saved account", exact: true }).click()
  await expect(account).toHaveText("Saved account")
  await authentication.click()
  await page.getByRole("listbox").getByRole("option", { name: "Keep current authentication", exact: true }).click()
  await expect(authentication).toHaveText("Keep current authentication")
  await expect(account).toHaveCount(0)
  await authentication.click()
  await page.getByRole("listbox").getByRole("option", { name: "Use an existing account", exact: true }).click()
  await expect(authentication).toHaveText("Use an existing account")
  await expect(account).toHaveText("Saved account")
  await authentication.click()
  await page.getByRole("listbox").getByRole("option", { name: "Add an API key", exact: true }).click()
  await expect(authentication).toHaveText("Add an API key")
  await expect(account).toHaveCount(0)
  await form.getByLabel("API key", { exact: true }).fill("discarded-switch-key")
  await authentication.click()
  await page.getByRole("listbox").getByRole("option", { name: "Use an existing account", exact: true }).click()
  await expect(authentication).toHaveText("Use an existing account")
  await expect(account).toHaveText("Saved account")
  await expect(form.getByLabel("API key", { exact: true })).toHaveCount(0)
  await form.getByRole("button", { name: "Fetch models", exact: true }).click()
  await expect(form.getByText("Model list ready", { exact: true })).toBeVisible()
  expect(state.previews.at(-1)?.credential).toEqual({
    type: "connection",
    connection: { type: "credential", id: "credential-provider-test" },
  })
  await authentication.click()
  await page.getByRole("listbox").getByRole("option", { name: "Add an API key", exact: true }).click()
  await expect(form.getByLabel("API key", { exact: true })).toHaveValue("")
  await form.getByLabel("API key", { exact: true }).fill(" fresh-preview-key ")
  await form.getByRole("button", { name: "Fetch models", exact: true }).click()
  await expect(form.getByText("Model list ready", { exact: true })).toBeVisible()
  expect(state.previews.at(-1)?.credential).toEqual({ type: "key", key: "fresh-preview-key" })
  expect(state.previews.at(-1)?.definition).toMatchObject({
    type: "stored",
    target: { scope: "global", path: target.path },
    expectedDigest: target.digest,
  })
  await form.getByRole("group", { name: "Authentication", exact: true }).getByRole("button").click()
  await page.getByRole("listbox").getByRole("option", { name: "Keep current authentication", exact: true }).click()
  await form.getByRole("button", { name: "Save", exact: true }).click()
  await expect(form).toBeHidden()
  await expect(settings.getByRole("button", { name: "Edit Personal Model B", exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Edit Personal Model B", exact: true }).click()
  await form.getByRole("button", { name: "Restore Auto", exact: true }).click()
  await form.getByRole("button", { name: "Save", exact: true }).click()
  await expect(form).toBeHidden()
  expect(state.saves.at(-1)?.patch.unset).toContainEqual(["models", "model-b", "name"])
  expect(state.saves.at(-1)?.patch.unset).toContainEqual(["models", "model-b", "limit", "context"])
  expect(state.saves.at(-1)?.patch.set?.models?.["model-b"]?.seed).toEqual(savedSeed)
  await expect(settings.getByRole("switch", { name: "Listed Model B", exact: true })).toBeChecked()
  await expect(visibility).toBeChecked({ checked: false })
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  await settings.getByRole("button", { name: "Disable execution", exact: true }).click()
  await expect(settings.getByText("Execution disabled", { exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Allow execution", exact: true }).click()
  await expect(settings.getByText("Execution allowed", { exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Delete this layer", exact: true }).click()
  await expect(settings.getByText("Add a provider to save its connection and models.", { exact: true })).toBeVisible()
  expect(state.removed).toBe(true)
  await settings.getByRole("button", { name: "Add provider", exact: true }).click()
  await expect(form.getByRole("textbox", { name: "Provider ID", exact: true })).toBeEditable()
  await form.getByRole("button", { name: "List options", exact: true }).click()
  await expect(form.getByRole("group", { name: "Model list protocol", exact: true }).getByRole("button")).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath("provider-form-en.png") })
  await form.getByRole("button", { name: "Done", exact: true }).click()
  await seed(page, { locale: "zh" })
  await page.setViewportSize({ width: 760, height: 900 })
  await page.reload()
  const localizedSettings = page.getByTestId("settings-screen")
  await expect(localizedSettings.getByRole("heading", { name: "提供商", exact: true })).toBeVisible()
  await localizedSettings.getByRole("button", { name: "添加提供商", exact: true }).click()
  const localizedForm = page.getByRole("dialog", { name: "自定义提供商", exact: true })
  await expect(localizedForm.getByRole("textbox", { name: "提供商 ID", exact: true })).toBeEditable()
  await localizedForm.getByRole("button", { name: "列表选项", exact: true }).click()
  await expect(
    localizedForm.getByRole("group", { name: "模型列表协议", exact: true }).getByRole("button"),
  ).toBeEnabled()
  await expect(localizedForm.getByRole("textbox", { name: "自定义模型列表 URL（可选）", exact: true })).toBeEditable()
  await page.screenshot({ path: testInfo.outputPath("provider-form-zh-narrow.png") })
})

test("settings has its own route and returns through app history", async ({ page }) => {
  const { settings } = await open(page)
  const home = page.getByRole("button", { name: "Home", exact: true })
  await expect(page).toHaveURL("/settings")
  await expect(home).toHaveAttribute("aria-pressed", "false")
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(page).toHaveURL("/")
  await expect(home).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Control+]")
  await expect(page).toHaveURL("/settings")
  await expect(home).toHaveAttribute("aria-pressed", "false")
  await home.click()
  await expect(page).toHaveURL("/")
  await expect(settings).toBeHidden()
})

test("Ctrl+, opens settings as soon as the app loads", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Settings demo",
    directory,
    provider: NO_PROVIDER,
    sessions: [],
    seed: { tabs: [] },
  })
  await page.goto("/")
  await page.keyboard.press("Control+,")
  await expect(page.getByTestId("settings-screen")).toBeVisible()
  await expect(page).toHaveURL("/settings")
})

test("a settings page survives refresh", async ({ page }) => {
  const { settings } = await open(page)
  const appearance = settings.getByRole("tab", { name: "Appearance", exact: true })
  await appearance.click()
  await expect(page).toHaveURL("/settings?tab=appearance")
  await page.reload()
  await expect(appearance).toHaveAttribute("aria-selected", "true")
  await expect(page).toHaveURL("/settings?tab=appearance")
})

test("another server's settings page survives refresh", async ({ page }) => {
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })
  const { settings } = await open(page)

  const url = (value: URL) =>
    value.pathname === "/settings" &&
    value.searchParams.get("server") === REMOTE_SERVER &&
    value.searchParams.get("tab") === "providers"

  await page.goto(`/settings?server=${encodeURIComponent(REMOTE_SERVER)}&tab=providers`)
  await expect(settings.getByRole("heading", { name: "Providers", exact: true })).toBeVisible()
  await expect(page).toHaveURL(url)
  await page.reload()
  await expect(settings.getByRole("heading", { name: "Providers", exact: true })).toBeVisible()
  await expect(page).toHaveURL(url)
})

test("single-server settings expose scoped pages without a server picker", async ({ page }) => {
  const { settings } = await open(page)
  await expect(settings.getByRole("tab", { name: "Server", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Servers", exact: true })).toHaveCount(0)

  for (const name of ["Projects", "Worktrees", "Providers", "Models", "Extensions"]) {
    await settings.getByRole("tab", { name, exact: true }).click()
    await expect(settings.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(settings.locator('[data-action="settings-server-select"]')).toHaveCount(0)
  }

  await settings.getByRole("tab", { name: "Server", exact: true }).click()
  await expect(settings.getByText("Terminal shell", { exact: true })).toBeVisible()
  await settings.getByText("zsh", { exact: true }).click()

  const updated = page.waitForRequest(
    (request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/experimental/config",
  )

  await page.getByRole("option", { name: "bash", exact: true }).click()
  expect((await updated).postDataJSON()).toEqual({ shell: "bash" })
})

test("project list menus rename, close, edit, add, and stay inside the scrollport", async ({ page }) => {
  const projects = ["rebase", "dinocms", "omnixa", "Playground"].map((name, index) =>
    project({ id: `project-${index}`, directory: `/projects/${name}`, name }),
  )

  const { settings } = await open(page, {
    name: "rebase",
    directory: "/projects/rebase",
    project: { id: "project-0" },
    projects,
    sessions: [],
    fileList: () => [],
    seed: { projects: { local: projects.map((item) => ({ worktree: item.worktree, expanded: true })) } },
  })

  await settings.getByRole("tab", { name: "Projects", exact: true }).click()
  const panel = settings.getByRole("tabpanel")
  const list = panel.getByRole("list")
  await expect(list.getByRole("listitem")).toHaveCount(4)
  const card = list.getByRole("listitem").filter({ hasText: "rebase" })
  const more = card.getByRole("button", { name: "More options", exact: true })
  await more.click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitem")).toHaveText(["Edit", "Rename", "Clear notifications", "Close"])
  await menu.getByRole("menuitem", { name: "Edit", exact: true }).click()
  await expect(panel.getByRole("heading", { name: "rebase", exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Back to projects", exact: true }).click()

  await page.setViewportSize({ width: 600, height: 720 })
  // Each project card stays fully inside every horizontal clip ancestor.
  await expect
    .poll(() =>
      card.evaluate((row) => {
        const bounds = row.getBoundingClientRect()
        const clips = []

        for (let parent = row.parentElement; parent; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowX === "visible") continue
          const clip = parent.getBoundingClientRect()
          clips.push(bounds.left - clip.left, clip.right - bounds.right)
        }

        return Math.min(...clips)
      }),
    )
    .toBeGreaterThanOrEqual(4)
  await expect(panel).toHaveJSProperty("scrollWidth", await panel.evaluate((element) => element.clientWidth))
  await page.setViewportSize({ width: 1280, height: 720 })

  await list
    .getByRole("listitem")
    .filter({ hasText: "dinocms" })
    .getByRole("button", { name: "More options", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "Close", exact: true }).click()
  await expect(panel.getByRole("button", { name: "dinocms", exact: true })).toHaveCount(0)

  await more.click()
  await menu.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const rename = panel.getByRole("textbox", { name: "Rename", exact: true })
  await expect(rename).toBeFocused()
  await rename.fill("Renamed project")

  const renamed = page.waitForRequest(
    (request) => request.method() === "PATCH" && new URL(request.url()).pathname === "/api/project/project-0",
  )

  await rename.press("Enter")
  expect((await renamed).postDataJSON()).toEqual({ name: "Renamed project" })
  await expect(panel.getByRole("button", { name: "Renamed project", exact: true })).toBeVisible()

  await panel.getByRole("button", { name: "Add project", exact: true }).click()
  const picker = page.getByRole("dialog", { name: "Open project", exact: true })
  await picker.getByRole("combobox").fill("/projects/added")
  await picker.getByRole("combobox").press("Enter")
  const select = picker.getByRole("button", { name: "Select folder", exact: true })
  await expect(select).toBeEnabled()
  await select.click()
  await expect(picker).toBeHidden()
  await expect(panel.getByRole("heading", { name: "added", exact: true })).toBeVisible()
})

test("project settings open as a nested view that keeps its route", async ({ page }) => {
  const { settings } = await open(page)
  await openProject(page)
  await expect(settings.getByRole("tab", { name: "General", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Extensions", exact: true })).toBeVisible()
  await expect(settings.getByRole("tab", { name: "Scripts", exact: true })).toHaveCount(0)
  const menu = page.getByRole("menu")
  await settings.locator(".settings-tab-header").getByRole("button", { name: "More options", exact: true }).click()
  await expect(menu.getByRole("menuitem")).toHaveText(["Clear notifications", "Close"])
  // Escape must reach the menu, not the settings screen behind it.
  await expect.poll(() => menu.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await expect(settings.getByRole("button", { name: "Back to projects", exact: true })).toBeVisible()

  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Worktrees", exact: true })).toBeVisible()

  const route = (url: URL) =>
    url.pathname === "/settings" &&
    url.searchParams.get("server") === SERVER &&
    url.searchParams.get("project") === directory &&
    url.searchParams.get("tab") === "workspaces"

  await expect(page).toHaveURL(route)
  await page.reload()
  await expect(settings.getByRole("heading", { name: "Worktrees", exact: true })).toBeVisible()
  await expect(page).toHaveURL(route)
  await page.keyboard.press("Escape")
  await expect(settings.getByRole("heading", { name: "Projects", exact: true })).toBeVisible()
})

for (const field of [
  {
    name: "color",
    label: "",
    initial: "orange",
    next: "blue",
    patches: [{ icon: { color: "blue", override: "" } }, { icon: { color: "orange", override: "" } }],
  },
  {
    name: "name",
    label: "Project name",
    initial: "Settings demo",
    next: "Renamed project",
    patches: [{ name: "Renamed project" }, { name: "Settings demo" }],
  },
  {
    name: "startup script",
    label: "Worktree startup script",
    initial: "echo setup",
    next: "bun install",
    patches: [{ commands: { start: "bun install" } }, { commands: { start: "echo setup" } }],
  },
]) {
  test(`project autosave keeps the final ${field.name} when reverting during a save`, async ({ page }) => {
    const { settings } = await open(page, {
      project: { icon: { color: "orange" }, commands: { start: "echo setup" }, sandboxes },
    })

    await openProject(page)
    const hold = await holdRoute(page, (url) => url.pathname === `/api/project/${projectID}`, { method: "PATCH" })

    const edit = async (value: string) => {
      if (field.name === "color") {
        await settings.getByRole("button", { name: `Select ${value} color`, exact: true }).click()

        return
      }

      const input = settings.getByRole("textbox", { name: field.label, exact: true })
      await input.fill(value)
      await input.blur()
    }

    await edit(field.next)
    await hold.arrived
    await edit(field.initial)
    expect(hold.requests.map((request) => request.postDataJSON())).toEqual([field.patches[0]])
    hold.release()
    await expect.poll(() => hold.requests.map((request) => request.postDataJSON())).toEqual(field.patches)
    await expect(settings.locator('[aria-busy="true"]')).toHaveCount(0)

    await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
    await settings.getByRole("tab", { name: "General", exact: true }).click()

    if (field.name === "color") {
      await expect(settings.getByRole("button", { name: "Select orange color", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      )

      return
    }

    await expect(settings.getByRole("textbox", { name: field.label, exact: true })).toHaveValue(field.initial)
  })
}

test("clearing project fields sends explicit removal values", async ({ page }) => {
  const { settings } = await open(page)
  await openProject(page)
  const startup = settings.getByRole("textbox", { name: "Worktree startup script", exact: true })
  await expect(startup).toHaveValue("echo setup")
  const icon = settings.getByRole("button", { name: "Project icon", exact: true })
  await expect(icon.locator("img")).toHaveCount(1)
  const color = settings.getByRole("button", { name: "Select orange color", exact: true })

  for (const step of [
    {
      act: async () => {
        await startup.clear()
        await startup.blur()
      },
      patch: { commands: { start: "" } },
    },
    { act: () => icon.click(), patch: { icon: { color: "orange", override: "" } } },
    {
      act: async () => {
        await expect(color).toHaveAttribute("aria-pressed", "true")
        await color.click()
      },
      patch: { icon: { color: "", override: "" } },
    },
  ]) {
    const saved = patched(page)
    await step.act()
    expect((await saved).postDataJSON()).toEqual(step.patch)
    await expect(settings.locator('[aria-busy="true"]')).toHaveCount(0)
  }
})

test("the new session shortcut waits for a shortcut recording, then leaves settings", async ({ page }) => {
  const { settings } = await open(page, {
    seed: { storage: { "omnixa.global.dat:layout": { home: { sessionMode: "coding" } } } },
  })
  await settings.getByRole("tab", { name: "Shortcuts", exact: true }).click()
  const binding = settings.locator('[data-keybind-id="tab.new"]')
  await binding.click()
  await expect(binding).toHaveText("Press keys")
  await page.keyboard.press("Control+t")
  await expect(binding).toHaveText("Ctrl+T")
  await expect(page).toHaveURL("/settings?tab=shortcuts")
  await expect(page.locator("[data-titlebar-tab]")).toHaveCount(0)

  await page.keyboard.press("Control+t")
  await expect(page).toHaveURL(/\/new-session\?draftId=.+$/)
  await expect(settings).toBeHidden()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(page.locator('[data-titlebar-tab][data-active="true"]')).toHaveCount(1)
})

test.describe("pages open before slow data", () => {
  test("worktrees", async ({ page }) => {
    const { settings } = await open(page)
    const inventory = await holdRoute(page, (url) => url.pathname === "/api/worktree", { method: "GET" })

    const sessions = await holdRoute(
      page,
      (url) => url.pathname === "/api/session" && url.searchParams.has("directory"),
    )

    await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
    await inventory.arrived
    await expect(settings.getByRole("heading", { name: "Worktrees", exact: true })).toBeVisible()
    await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
    await expect(settings.getByText("No worktrees", { exact: true })).toHaveCount(0)

    inventory.release()
    await expect(settings.getByText(sandboxes[0]!, { exact: true })).toBeVisible()
    await expect(settings.getByText("12 worktrees", { exact: true })).toBeVisible()
    // Home already listed this session; it renders while the directory reads are still held.
    await sessions.arrived
    await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()
    sessions.release()

    const refresh = await holdRoute(page, (url) => url.pathname === "/api/worktree", { method: "GET" })
    await settings.getByRole("tab", { name: "Preferences", exact: true }).click()
    await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
    await expect(settings.getByText("Workspace 1 session", { exact: true })).toBeVisible()
    refresh.release()
  })

  test("extensions", async ({ page }) => {
    const { settings } = await open(page, { mcp: [{ name: "demo-mcp", status: { status: "connected" } }] })
    const mcp = await holdRoute(page, (url) => url.pathname === "/api/mcp")
    await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
    await mcp.arrived
    await expect(settings.getByRole("heading", { name: "Extensions", exact: true })).toBeVisible()
    await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
    mcp.release()
    await settings.getByRole("tab", { name: "MCPs", exact: true }).click()
    await expect(settings.getByRole("switch", { name: "demo-mcp" })).toBeChecked()
  })

  test("about identifies Omnixa, its repository, maintainers and upstream", async ({ page }) => {
    const { settings } = await open(page)
    await settings.getByRole("tab", { name: "About", exact: true }).click()
    await expect(settings.getByText("Released under the MIT License", { exact: true })).toBeVisible()
    await expect(settings.getByRole("link", { name: "keerzzz/AigcForge", exact: true })).toHaveAttribute(
      "href",
      "https://github.com/keerzzz/AigcForge",
    )
    await expect(settings.getByRole("link", { name: "keerzzz", exact: true })).toHaveAttribute(
      "href",
      "https://github.com/keerzzz",
    )
    await expect(settings.getByRole("link", { name: "View project contributors", exact: true })).toHaveAttribute(
      "href",
      "https://github.com/keerzzz/AigcForge/graphs/contributors",
    )
    await expect(settings.getByRole("link", { name: "OpenCode", exact: true })).toHaveAttribute(
      "href",
      "https://github.com/anomalyco/opencode",
    )
    await expect(settings.getByRole("button", { name: "Third-party notices", exact: true })).toBeVisible()
    await expect(settings.getByRole("button", { name: "Back to app" })).toBeVisible()
  })
})

test("worktrees follow inventory events, wait for session counts, and delete by project", async ({ page }) => {
  const empty = `${directory}/empty-workspace`
  const discovered = `${directory}/discovered-workspace`

  const inventory: WorktreeDirectory[] = [
    { directory },
    ...[...sandboxes, empty].map((item) => ({ directory: item, strategy: "git" })),
  ]

  const view = await open(page, {
    project: { sandboxes: [...sandboxes, empty] },
    worktrees: () => inventory,
    onWorktreeRemove: (body) => {
      inventory.splice(
        inventory.findIndex((item) => item.directory === body.directory),
        1,
      )
    },
  })

  const settings = view.settings

  // Holding every directory would fill the request budget; hold only the worktree without sessions.
  const sessions = await holdRoute(
    page,
    (url) => url.pathname === "/api/session" && url.searchParams.get("directory") === empty,
  )

  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  const row = settings.locator(".settings-workspaces-row").filter({ has: page.getByLabel(empty, { exact: true }) })
  await expect(row).toContainText("Loading messages")
  await settings.getByRole("button", { name: "More options", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "Delete worktrees without sessions", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  sessions.release()
  await expect(row).toContainText("0 sessions")

  const listed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/worktree" && response.request().method() === "GET",
  )

  const read = page.waitForResponse((response) => {
    const url = new URL(response.url())

    return url.pathname === "/api/session" && url.searchParams.get("directory") === discovered
  })

  // Home never listed this session, so only the new worktree's directory read can show it.
  view.sessions.push(session({ id: "ses_discovered", directory: discovered, title: "Discovered session", projectID }))
  inventory.push({ directory: discovered, strategy: "git" })
  // SAFETY: a worktree.updated event carries only the project ID, which is all the app reads from it.
  await view.push([
    { id: "evt_settings_worktree_updated", created: Date.now(), type: "worktree.updated", data: { projectID } },
  ] as OmnixaEvent[])
  expect((await listed).ok()).toBe(true)
  await expect(settings.getByText(discovered, { exact: true })).toBeVisible()
  expect((await read).ok()).toBe(true)
  await expect(settings.getByText("Discovered session", { exact: true })).toBeVisible()

  await openProject(page)
  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await settings.getByRole("button", { name: "Delete “workspace-1”?", exact: true }).click()

  const deleting = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/worktree" && request.method() === "DELETE",
  )

  await page
    .getByRole("dialog", { name: "Delete “workspace-1”?", exact: true })
    .getByRole("button", { name: "Delete worktree", exact: true })
    .click()
  const request = await deleting
  expect(new URL(request.url()).searchParams.has("location[directory]")).toBe(false)
  expect(request.postDataJSON()).toEqual({ projectID, directory: sandboxes[0], force: true })
  await expect(settings.getByText("13 worktrees", { exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Back to projects", exact: true }).click()
  await settings.getByRole("tab", { name: "Worktrees", exact: true }).click()
  await expect(settings.getByText("13 worktrees", { exact: true })).toBeVisible()
  await expect(settings.getByLabel(sandboxes[0]!, { exact: true })).toHaveCount(0)
})

test.describe("worktrees prefetch", () => {
  const other = project({ id: "proj_other", directory: "/repo/other", name: "Other project" })

  for (const interaction of ["hover", "focus"] as const) {
    test(`project Worktrees ${interaction} prefetches only its inventory and reuses the request`, async ({ page }) => {
      const { settings } = await open(page)
      await page.route(
        (url) => url.pathname === "/api/project",
        (route) => route.fulfill({ json: [project({ id: projectID, directory, sandboxes }), other] }),
      )
      const refreshes: string[] = []
      const sessions: string[] = []
      page.on("request", (request) => {
        const url = new URL(request.url())

        if (url.pathname === "/api/worktree/refresh") refreshes.push(request.postDataJSON().projectID)

        if (url.pathname === "/api/session" && url.searchParams.has("directory"))
          sessions.push(url.searchParams.get("directory")!)
      })
      await openProject(page)
      const inventory = await holdRoute(page, (url) => url.pathname === "/api/worktree", { method: "GET" })
      const calls = () => inventory.requests.map((request) => new URL(request.url()).searchParams.get("projectID"))
      const worktrees = settings.getByRole("tab", { name: "Worktrees", exact: true })
      await expect(worktrees).toBeEnabled()
      await worktrees[interaction]()
      await inventory.arrived
      await expect(worktrees).toHaveAttribute("aria-selected", "false")
      expect(calls()).toEqual([projectID])
      expect(sessions).toEqual([])

      if (interaction === "hover") {
        const finished = page.waitForEvent(
          "requestfinished",
          (request) => new URL(request.url()).pathname === "/api/worktree",
        )

        inventory.release()
        await finished
      }

      await worktrees.click()
      await expect(worktrees).toHaveAttribute("aria-selected", "true")
      inventory.release()
      await expect(settings.getByText("12 worktrees", { exact: true })).toBeVisible()
      expect(calls()).toEqual([projectID])
      expect(refreshes).toEqual([projectID])
      await expect.poll(() => sessions.toSorted()).toEqual(sandboxes.toSorted())
    })
  }

  test("server Worktrees hover only prefetches metadata", async ({ page }) => {
    const { settings } = await open(page)

    const calls = { projects: 0, worktrees: new Array<string>(), refreshes: new Array<string>() }

    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/worktree/refresh")
        calls.refreshes.push(request.postDataJSON().projectID)
    })
    await page.route(
      (url) => url.pathname === "/api/project",
      async (route) => {
        calls.projects += 1
        await route.fulfill({ json: [project({ id: projectID, directory, sandboxes }), other] })
      },
    )
    await page.route(
      (url) => url.pathname === "/api/worktree",
      async (route) => {
        const requested = new URL(route.request().url()).searchParams.get("projectID") ?? ""
        calls.worktrees.push(requested)

        if (requested === other.id) return route.fulfill({ json: [{ directory: other.worktree }] })
        await route.fallback()
      },
    )
    const worktrees = settings.getByRole("tab", { name: "Worktrees", exact: true })

    const fetched = page.waitForEvent(
      "requestfinished",
      (request) => new URL(request.url()).pathname === "/api/project",
    )

    await worktrees.hover()
    await fetched
    await worktrees.focus()
    await expect(worktrees).toHaveAttribute("aria-selected", "false")
    expect(calls).toEqual({ projects: 1, worktrees: [], refreshes: [] })

    await worktrees.click()
    await expect(settings.getByText("12 worktrees", { exact: true })).toBeVisible()
    expect(calls.projects).toBe(1)
    expect(calls.worktrees.toSorted()).toEqual([projectID, other.id].toSorted())
    expect(calls.refreshes).toEqual([])
  })
})

const lsp: ConfigEntry[] = [
  {
    type: "document",
    path: "/config/omnixa.json",
    info: { lsp: { typescript: { command: ["typescript-language-server", "--stdio"], extensions: [".ts", ".tsx"] } } },
  },
  {
    type: "document",
    path: `${directory}/omnixa.jsonc`,
    info: { lsp: { typescript: { disabled: true }, rust: { command: ["rust-analyzer"], extensions: [".rs"] } } },
  },
]

for (const row of ["configured", "disabled", "failure"] as const) {
  test(`project LSPs: ${row}`, async ({ page }) => {
    const { settings } = await open(page)
    await openProject(page)
    await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
    const state = { fail: row === "failure" }
    const gate = Promise.withResolvers<void>()
    await page.route(
      (url) => url.pathname === "/api/config",
      async (route) => {
        await gate.promise

        if (state.fail) return route.fulfill({ status: 404, json: {} })
        await route.fulfill({ json: row === "disabled" ? [{ type: "document", info: { lsp: false } }] : lsp })
      },
    )
    const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/config")
    await settings.getByRole("tab", { name: "LSPs", exact: true }).click()
    expect(new URL((await requested).url()).searchParams.get("location[directory]")).toBe(directory)
    const panel = settings.getByRole("tabpanel", { name: "LSPs", exact: true })
    await expect(panel.getByText("Loading", { exact: true })).toBeVisible()
    gate.resolve()

    if (row === "disabled") {
      await expect(panel.getByText("Language servers disabled", { exact: true })).toBeVisible()
      await expect(panel.locator(".project-settings-extension-row")).toHaveCount(0)

      return
    }

    if (row === "failure") {
      await expect(panel.getByText("Could not load language server configuration", { exact: true })).toBeVisible()
      state.fail = false
      await panel.getByRole("button", { name: "Retry", exact: true }).click()
    }

    const rows = panel.locator(".project-settings-extension-row")
    await expect(rows.filter({ hasText: "typescript" })).toContainText("Disabled in config")
    await expect(rows.filter({ hasText: "typescript" })).toContainText(".ts, .tsx")
    await expect(rows.filter({ hasText: "rust" })).toContainText("Enabled in config")
    await expect(panel.getByRole("switch")).toHaveCount(0)
  })
}

for (const row of [
  {
    name: "custom IDs with zero-priced models remain connected",
    cost: { input: 0, output: 0 },
    metadata: { quote: { status: "free" } },
    connections: [],
    tag: "Config",
  },
  {
    name: "custom IDs with unknown prices keep their API key connections",
    cost: undefined,
    metadata: { quote: { status: "unknown" } },
    connections: [{ type: "credential", id: "cred_v1", label: "API key", method: "key" }],
    tag: "API key",
  },
  {
    name: "custom IDs with paid models keep their OAuth accounts",
    cost: { input: 3, output: 1 },
    metadata: undefined,
    connections: [{ type: "credential", id: "cred_account", label: "Gateway account", method: "oauth" }],
    tag: "Account",
  },
]) {
  test(`providers: ${row.name}`, async ({ page }) => {
    const { settings } = await open(page, {
      provider: {
        all: ["omnixa", "omnixa-go"].map((id) => ({
          id,
          integrationID: "gateway-auth",
          name: `Local ${id} gateway`,
          models: {
            "custom-model": {
              id: "custom-model",
              name: "Custom model",
              cost: row.cost,
              metadata: row.metadata,
            },
          },
        })),
        connected: ["omnixa", "omnixa-go"],
        default: {},
      },
      integrations: [
        {
          id: "gateway-auth",
          name: "Gateway authentication",
          methods: [
            { id: "gateway-oauth", type: "oauth", label: "Gateway account" },
            { type: "key", label: "API key" },
          ],
          connections: row.connections,
        },
        { id: "anthropic", name: "Anthropic", methods: [{ type: "key" }], connections: [] },
      ],
    })

    await settings.getByRole("tab", { name: "Providers", exact: true }).click()
    await expect(settings.getByRole("heading", { name: "Popular providers" })).toBeVisible()
    const connected = settings.locator('[data-component="connected-providers-section"]')

    await expect(connected.locator(".settings-provider-name")).toHaveText([
      "Local omnixa gateway",
      "Local omnixa-go gateway",
    ])
    await expect(connected.locator(".settings-provider-main").getByText(row.tag, { exact: true })).toHaveCount(2)
    await expect(settings.getByText("Anthropic", { exact: true })).toBeVisible()
  })
}

for (const method of ["key", "oauth"] as const) {
  test(`providers: ${method} authentication retries catalog refresh without reconnecting or first-run onboarding`, async ({
    page,
  }) => {
    const state = {
      connected: false,
      fail: true,
      connects: new Array<{ integrationID: string; body: unknown }>(),
      reads: new Array<string>(),
    }
    const { settings } = await open(page, {
      provider: () => ({
        all: [
          {
            id: "omnixa",
            name: "Local gateway",
            models: { local: { id: "local", name: "Local model", cost: { input: 0, output: 0 } } },
          },
          ...(state.connected
            ? [
                {
                  id: "cloud-models",
                  integrationID: "anthropic",
                  name: "Cloud models",
                  models: { cloud: { id: "cloud", name: "Cloud model" } },
                },
              ]
            : []),
        ],
        connected: state.connected ? ["omnixa", "cloud-models"] : ["omnixa"],
        default: {},
      }),
      integrations: [
        {
          id: "anthropic",
          name: "Anthropic",
          methods:
            method === "oauth"
              ? [{ id: "provider-oauth", type: "oauth", label: "Provider account" }]
              : [{ type: "key" }],
          connections: [],
        },
      ],
      onConnectKey: (input) => {
        state.connects.push(input)
        state.connected = true
      },
      onIntegrationOAuth: (input) => {
        state.connects.push(input)

        return { url: "https://auth.example.test/authorize" }
      },
    })
    await settings.getByRole("tab", { name: "Providers", exact: true }).click()
    await expect(settings.getByText("Local gateway", { exact: true })).toBeVisible()
    await page.route(
      (url) => ["/api/integration", "/api/provider", "/api/model"].includes(url.pathname),
      async (route) => {
        state.reads.push(new URL(route.request().url()).pathname)

        if (state.fail && new URL(route.request().url()).pathname === "/api/model")
          return route.fulfill({
            status: 400,
            json: { _tag: "InvalidRequestError", message: "Model catalog unavailable" },
          })
        await route.fallback()
      },
    )
    await page.route(
      (url) => url.pathname === "/api/integration/anthropic/connect/oauth/con_mock_1",
      async (route) => {
        state.connected = true
        await route.fulfill({
          json: {
            location: { directory },
            data: { status: "complete", time: { created: 1, expires: 2 } },
          },
        })
      },
    )
    await settings.locator(".settings-provider-row").filter({ hasText: "Anthropic" }).getByRole("button").click()
    const connection = page.getByRole("dialog", { name: "Connect Anthropic", exact: true })

    if (method === "key") {
      await connection.locator('[data-input="provider-api-key"]').fill("keeper-key")
      await connection.getByRole("button", { name: "Continue", exact: true }).click()
    }

    await expect(connection.getByRole("alert")).toContainText("Connected, but could not refresh providers and models:")
    expect(state.connects).toHaveLength(1)
    expect(state.connects[0]?.integrationID).toBe("anthropic")
    expect(state.connects[0]?.body).toMatchObject(
      method === "oauth" ? { methodID: "provider-oauth" } : { key: "keeper-key" },
    )
    state.fail = false
    await connection.getByRole("button", { name: "Try again", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(state.connects).toHaveLength(1)
    expect(state.reads.filter((path) => path === "/api/model")).toHaveLength(2)
    await expect(settings.getByText("Cloud models", { exact: true })).toBeVisible()
    await settings.getByRole("tab", { name: "Models", exact: true }).click()
    const model = settings
      .locator('[data-component="settings-row"]')
      .filter({ has: page.getByRole("switch", { name: "Cloud model", exact: true }) })
    await expect(model.locator('[data-slot="settings-row-title"]')).toBeVisible()
    await expect(model.getByRole("switch")).toBeEnabled()
    await expect(model.getByRole("switch")).toBeChecked()
  })
}

for (const method of ["key", "code"] as const) {
  test(`providers: ${method} authentication owns one pending submission across method changes`, async ({ page }) => {
    const pending = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const state = {
      connected: false,
      keys: new Array<{ integrationID: string; body: unknown }>(),
      starts: new Array<{ integrationID: string; directory: string; body: unknown }>(),
      completes: new Array<{ integrationID: string; attemptID: string; directory: string; body: unknown }>(),
      canceled: new Array<string>(),
    }
    page.on("request", (request) => {
      if (request.method() === "DELETE" && /\/connect\/oauth\//.test(new URL(request.url()).pathname))
        state.canceled.push(new URL(request.url()).pathname.split("/").at(-1)!)
    })
    const { settings } = await open(page, {
      provider: () => ({
        all: [
          { id: "omnixa", name: "Local gateway", models: { local: { id: "local", name: "Local model" } } },
          ...(state.connected
            ? [{ id: "anthropic", name: "Anthropic", models: { cloud: { id: "cloud", name: "Cloud model" } } }]
            : []),
        ],
        connected: state.connected ? ["omnixa", "anthropic"] : ["omnixa"],
        default: {},
      }),
      integrations: [
        {
          id: "anthropic",
          name: "Anthropic",
          methods: [
            { type: "key", label: "API key" },
            { id: "manual-code", type: "oauth", label: "Manual account" },
            { id: "another-account", type: "oauth", label: "Another account" },
          ],
          connections: [],
        },
      ],
      onConnectKey: async (input) => {
        state.keys.push(input)
        state.connected = true
        started.resolve()
        await pending.promise
      },
      onIntegrationOAuth: (input) => {
        state.starts.push(input)

        return { url: "https://auth.example.test/authorize", mode: "code" }
      },
      onIntegrationOAuthComplete: async (input) => {
        state.completes.push(input)
        state.connected = true

        if (method === "code" && state.completes.length === 1) {
          started.resolve()
          await pending.promise
        }
      },
    })
    await settings.getByRole("tab", { name: "Providers", exact: true }).click()
    await settings.locator(".settings-provider-row").filter({ hasText: "Anthropic" }).getByRole("button").click()
    const connection = page.getByRole("dialog", { name: "Connect Anthropic", exact: true })
    await connection
      .getByRole("button", { name: method === "key" ? "API key Browser" : "Manual account", exact: true })
      .click()
    const input = connection.getByLabel(method === "key" ? "Anthropic API key" : "Manual account authorization code", {
      exact: true,
    })
    await input.fill("first-secret")
    const firstPath =
      method === "key"
        ? "/api/integration/anthropic/connect/key"
        : "/api/integration/anthropic/connect/oauth/con_mock_1/complete"
    const replied = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === firstPath,
    )
    await connection.getByRole("button", { name: "Continue", exact: true }).dblclick()
    await started.promise
    await expect(input).toBeDisabled()
    await expect(connection.getByRole("button", { name: "Continue", exact: true })).toBeDisabled()
    expect(method === "key" ? state.keys : state.completes).toHaveLength(1)

    await connection.getByRole("button", { name: "Navigate back", exact: true }).click()
    await connection.getByRole("button", { name: "Another account", exact: true }).click()
    const current = connection.getByLabel("Another account authorization code", { exact: true })
    await expect(current).toBeEnabled()
    await current.fill("current-secret")
    pending.resolve()
    await replied
    await expect(current).toHaveValue("current-secret")
    await expect(current).toBeEnabled()

    // Completing the selected attempt proves the late response did not finish the replacement flow.
    const currentAttempt = method === "key" ? "con_mock_1" : "con_mock_2"
    const completed = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === `/api/integration/anthropic/connect/oauth/${currentAttempt}/complete`,
    )
    await connection.getByRole("button", { name: "Continue", exact: true }).click()
    expect((await completed).postDataJSON()).toEqual({ code: "current-secret" })
    await expect(page.getByRole("dialog")).toHaveCount(0)
    expect(state.keys).toEqual(method === "key" ? [{ integrationID: "anthropic", body: { key: "first-secret" } }] : [])
    expect(state.starts.map((entry) => entry.body)).toEqual(
      method === "key"
        ? [{ methodID: "another-account" }]
        : [{ methodID: "manual-code" }, { methodID: "another-account" }],
    )
    expect(state.starts.every((entry) => entry.directory === directory)).toBe(true)
    expect(state.completes.map((entry) => ({ attemptID: entry.attemptID, body: entry.body }))).toEqual(
      method === "key"
        ? [{ attemptID: "con_mock_1", body: { code: "current-secret" } }]
        : [
            { attemptID: "con_mock_1", body: { code: "first-secret" } },
            { attemptID: "con_mock_2", body: { code: "current-secret" } },
          ],
    )
    expect(state.completes.every((entry) => entry.integrationID === "anthropic" && entry.directory === directory)).toBe(
      true,
    )
    expect(state.canceled).toEqual(method === "code" ? ["con_mock_1"] : [])
    await expect(settings.getByText("Anthropic", { exact: true })).toBeVisible()
  })
}

test("providers: transient manual-code completion errors retry the same OAuth attempt without reconnecting", async ({
  page,
}) => {
  const state = {
    connected: false,
    starts: new Array<{ integrationID: string; directory: string; body: unknown }>(),
    completes: new Array<{ integrationID: string; attemptID: string; directory: string; body: unknown }>(),
  }
  const { settings } = await open(page, {
    provider: () => ({
      all: [
        { id: "omnixa", name: "Local gateway", models: { local: { id: "local", name: "Local model" } } },
        ...(state.connected
          ? [{ id: "anthropic", name: "Anthropic", models: { cloud: { id: "cloud", name: "Cloud model" } } }]
          : []),
      ],
      connected: state.connected ? ["omnixa", "anthropic"] : ["omnixa"],
      default: {},
    }),
    integrations: [
      {
        id: "anthropic",
        name: "Anthropic",
        methods: [{ id: "manual-code", type: "oauth", label: "Manual account" }],
        connections: [],
      },
    ],
    onIntegrationOAuth: (input) => {
      state.starts.push(input)

      return { url: "https://auth.example.test/authorize", mode: "code" }
    },
    onIntegrationOAuthComplete: (input) => {
      state.completes.push(input)

      if (state.completes.length === 1)
        return { status: 503, body: { message: "Code completion temporarily unavailable" } }
      state.connected = true
      return undefined
    },
  })
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  await settings.locator(".settings-provider-row").filter({ hasText: "Anthropic" }).getByRole("button").click()
  const connection = page.getByRole("dialog", { name: "Connect Anthropic", exact: true })
  const input = connection.getByLabel("Manual account authorization code", { exact: true })
  await input.fill("first-code")
  await connection.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(connection.getByRole("alert")).toHaveText("UnexpectedStatus: 503")
  await expect(input).toHaveValue("first-code")
  await expect(input).toBeEnabled()
  await input.fill("accepted-code")
  await connection.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(state.starts).toEqual([{ integrationID: "anthropic", directory, body: { methodID: "manual-code" } }])
  expect(state.completes).toEqual([
    { integrationID: "anthropic", attemptID: "con_mock_1", directory, body: { code: "first-code" } },
    { integrationID: "anthropic", attemptID: "con_mock_1", directory, body: { code: "accepted-code" } },
  ])
  await expect(settings.getByText("Anthropic", { exact: true })).toBeVisible()
})

test("providers: terminal manual-code failure cannot connect through a repeated completion acknowledgement", async ({
  page,
}) => {
  const state = {
    starts: new Array<{ integrationID: string; directory: string; body: unknown }>(),
    callbacks: new Array<{ integrationID: string; attemptID: string; directory: string; body: unknown }>(),
    completes: new Array<{ attemptID: string; body: unknown }>(),
    statuses: new Array<string>(),
    credentials: new Array<{ integrationID: string; attemptID: string }>(),
  }
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname.match(
      /^\/api\/integration\/anthropic\/connect\/oauth\/([^/]+)(\/complete)?$/,
    )

    if (!path) return
    if (request.method() === "GET" && !path[2]) state.statuses.push(path[1])
    if (request.method() === "POST" && path[2])
      state.completes.push({ attemptID: path[1], body: request.postDataJSON() })
  })
  const { settings } = await open(page, {
    provider: () => ({
      all: [
        { id: "omnixa", name: "Local gateway", models: { local: { id: "local", name: "Local model" } } },
        ...(state.credentials.length
          ? [{ id: "anthropic", name: "Anthropic", models: { cloud: { id: "cloud", name: "Cloud model" } } }]
          : []),
      ],
      connected: state.credentials.length ? ["omnixa", "anthropic"] : ["omnixa"],
      default: {},
    }),
    integrations: [
      {
        id: "anthropic",
        name: "Anthropic",
        methods: [{ id: "manual-code", type: "oauth", label: "Manual account" }],
        connections: [],
      },
    ],
    onIntegrationOAuth: (input) => {
      state.starts.push(input)

      return { url: "https://auth.example.test/authorize", mode: "code" }
    },
    onIntegrationOAuthComplete: (input) => {
      state.callbacks.push(input)

      if (input.attemptID === "con_mock_1")
        return {
          status: 400,
          body: { _tag: "InvalidRequestError", message: "Authentication failed", kind: "integration_authorization" },
          failed: "Provider rejected authorization code",
        }
      state.credentials.push({ integrationID: input.integrationID, attemptID: input.attemptID })
      return undefined
    },
  })
  await settings.getByRole("tab", { name: "Providers", exact: true }).click()
  await expect(settings.getByText("Local gateway", { exact: true })).toBeVisible()
  await settings.locator(".settings-provider-row").filter({ hasText: "Anthropic" }).getByRole("button").click()
  const connection = page.getByRole("dialog", { name: "Connect Anthropic", exact: true })
  const input = connection.getByLabel("Manual account authorization code", { exact: true })
  await input.fill("rejected-code")
  const failed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/integration/anthropic/connect/oauth/con_mock_1/complete",
  )
  await connection.getByRole("button", { name: "Continue", exact: true }).click()
  expect((await failed).status()).toBe(400)
  await expect(connection.getByRole("alert")).toHaveText("Authentication failed")
  await expect(input).toBeEnabled()
  expect(state.credentials).toEqual([])
  await input.fill("ignored-code")
  const acknowledged = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/integration/anthropic/connect/oauth/con_mock_1/complete",
  )
  await connection.getByRole("button", { name: "Continue", exact: true }).click()
  expect((await acknowledged).status()).toBe(204)
  expect(state.callbacks).toEqual([
    { integrationID: "anthropic", attemptID: "con_mock_1", directory, body: { code: "rejected-code" } },
  ])
  expect(state.credentials).toEqual([])
  await expect.poll(() => state.statuses).toEqual(["con_mock_1"])
  await expect(connection.getByRole("alert")).toHaveText("Authorization failed: Provider rejected authorization code")
  await expect(
    settings.locator('[data-component="connected-providers-section"]').getByText("Anthropic", { exact: true }),
  ).toHaveCount(0)
  await connection.getByRole("button", { name: "Try again", exact: true }).click()
  await expect(input).toHaveValue("")
  await input.fill("accepted-code")
  await connection.getByRole("button", { name: "Continue", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  expect(state.starts).toEqual([
    { integrationID: "anthropic", directory, body: { methodID: "manual-code" } },
    { integrationID: "anthropic", directory, body: { methodID: "manual-code" } },
  ])
  expect(state.completes).toEqual([
    { attemptID: "con_mock_1", body: { code: "rejected-code" } },
    { attemptID: "con_mock_1", body: { code: "ignored-code" } },
    { attemptID: "con_mock_2", body: { code: "accepted-code" } },
  ])
  expect(state.callbacks).toEqual([
    { integrationID: "anthropic", attemptID: "con_mock_1", directory, body: { code: "rejected-code" } },
    { integrationID: "anthropic", attemptID: "con_mock_2", directory, body: { code: "accepted-code" } },
  ])
  expect(state.credentials).toEqual([{ integrationID: "anthropic", attemptID: "con_mock_2" }])
  expect(state.statuses).toEqual(["con_mock_1", "con_mock_2"])
  await expect(
    settings.locator('[data-component="connected-providers-section"]').getByText("Anthropic", { exact: true }),
  ).toBeVisible()
})

test("the add server dialog keeps focus above fullscreen settings", async ({ page }) => {
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })
  const { settings } = await open(page)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await settings.locator('[data-component="settings-nav-group-header"]').filter({ hasText: "Servers" }).hover()
  await settings.getByRole("button", { name: "Add server" }).click()

  const editor = page.getByRole("dialog", { name: "Add server" })
  await expect(editor.getByLabel("Pairing link", { exact: true })).toBeFocused()
  await expect(editor.getByPlaceholder("password")).toHaveCount(0)
  await editor.getByRole("button", { name: "Use password", exact: true }).click()
  await expect(editor.getByPlaceholder("username")).toHaveCount(0)
  const name = editor.getByPlaceholder("Localhost", { exact: true })
  await name.click()
  await name.fill("Remote")
  await page.keyboard.press("Tab")
  await expect(editor.getByPlaceholder("password")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(editor).toBeHidden()
  await expect(settings).toBeVisible()
})

test("the add server dialog pairs from a one-time link and explains a spent one", async ({ page }) => {
  const paired = "http://127.0.0.1:4098"
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })
  await mockOmnixaServer(page, {
    server: paired,
    directory: "/remote/paired",
    project: project({ id: "proj_paired", directory: "/remote/paired" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    password: "session-token",
    pairing: { code: "one-time-code", token: "session-token" },
  })
  const { settings } = await open(page)
  const link = `${paired}/auth/connect/one-time-code`

  const addServer = async () => {
    await settings.locator('[data-component="settings-nav-group-header"]').filter({ hasText: "Servers" }).hover()
    await settings.getByRole("button", { name: "Add server" }).click()
    const editor = page.getByRole("dialog", { name: "Add server" })
    await editor.getByLabel("Pairing link", { exact: true }).fill(link)
    await editor.getByRole("button", { name: "Add server", exact: true }).click()

    return editor
  }

  const added = await addServer()
  await expect(added).toBeHidden()
  await expect(settings.getByText(paired, { exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "Back to settings" }).click()

  const spent = await addServer()
  await expect(spent.getByRole("alert")).toHaveText(
    "This pairing link expired or was already used. Run omnixa pair to get a new one.",
  )
})

test("a pairing code with several addresses keeps the first one that works with its token", async ({ page }) => {
  // Both addresses reach one server. The second spends the code first, so the first answers 401, and the token works on
  // it as on every address of that server.
  const first = "http://127.0.0.1:4098"
  const second = "http://127.0.0.1:4099"
  await mockRemoteServer(page, { directory: "/remote/settings-demo" })

  for (const [server, pairing] of [
    [first, { code: "spent-by-the-other-address", token: "session-token" }],
    [second, { code: "one-time-code", token: "session-token" }],
  ] as const) {
    await mockOmnixaServer(page, {
      server,
      directory: "/remote/paired",
      project: project({ id: "proj_paired", directory: "/remote/paired" }),
      provider: NO_PROVIDER,
      sessions: [],
      pageMessages: () => ({ items: [] }),
      password: "session-token",
      pairing,
    })
  }

  const { settings } = await open(page)
  await settings.locator('[data-component="settings-nav-group-header"]').filter({ hasText: "Servers" }).hover()
  await settings.getByRole("button", { name: "Add server" }).click()
  const editor = page.getByRole("dialog", { name: "Add server" })
  await editor
    .getByLabel("Pairing link", { exact: true })
    .fill(JSON.stringify({ code: "one-time-code", urls: [first, second] }))
  await editor.getByRole("button", { name: "Add server", exact: true }).click()

  await expect(editor).toBeHidden()
  await expect(settings.getByText(first, { exact: true })).toBeVisible()
  await expect(settings.getByText(second, { exact: true })).toHaveCount(0)
})

test("legacy vertical-tab settings keep one navigation and the existing Home layout", async ({ page }) => {
  const { settings } = await open(page, { seed: { settings: { appearance: { tabLayout: "vertical" } } } })

  await expect(settings.locator('[data-action="settings-tab-layout"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="titlebar-v2"]')).toBeVisible()
  await page.reload()
  await expect(settings).toBeVisible()
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="titlebar-v2"]')).toBeVisible()
})

for (const viewport of [
  { name: "desktop", width: 1280, height: 720, bottom: false },
  { name: "mobile", width: 390, height: 844, bottom: true },
]) {
  test(`settings layout (${viewport.name}): every page scrolls inside its panel with room below`, async ({ page }) => {
    const { settings } = await open(page)
    await page.setViewportSize(viewport)
    const panel = settings.locator(".settings-content > .settings-panel:visible")
    const main = page.getByRole("main")

    if (viewport.bottom) {
      const toggle = settings.locator('[data-action="settings-mobile-titlebar-bottom"]')
      await toggle.locator('[data-slot="switch-control"]').click()
      await expect(toggle.getByRole("switch")).toBeChecked()
    }

    // Wheel over the outer gutter must not move the entire settings screen.
    await main.hover({ position: { x: 1, y: 200 } })
    await page.mouse.wheel(0, 10000)
    await expect(main).toHaveJSProperty("scrollTop", 0)

    const pages = [
      "Preferences",
      "Appearance",
      "Notifications",
      "Shortcuts",
      "Projects",
      "Worktrees",
      "Providers",
      "Models",
      "Extensions",
      "Server",
      "About",
    ]

    for (const [index, name] of pages.entries()) {
      if (viewport.width >= 816) await settings.getByRole("tab", { name, exact: true }).click()

      if (viewport.width < 816) {
        await settings.getByRole("button", { name: pages[Math.max(0, index - 1)], exact: true }).click()
        await page.getByRole("menuitemradio", { name, exact: true }).click()
      }

      if (name === "About") await expect(panel.getByText("Released under the MIT License")).toBeVisible()

      if (name !== "About")
        await expect(
          panel.getByRole("heading", { name: name === "Shortcuts" ? "Keyboard shortcuts" : name, exact: true }),
        ).toBeVisible()

      if (name === "Worktrees") {
        const last = settings.getByText("Workspace 12 session", { exact: true })
        await last.scrollIntoViewIfNeeded()
        await expect(last).toBeInViewport()

        if (!viewport.bottom) await expect(settings.getByRole("button", { name: "Back to app" })).toBeInViewport()
      }

      await panel.hover()
      await page.mouse.wheel(0, 10000)
      await expect
        .poll(() => panel.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
        .toBeLessThanOrEqual(1)
      await expect
        .poll(
          () =>
            panel.evaluate((element) => {
              const body = element.querySelector(".settings-tab-body, .settings-about-content")!

              return element.getBoundingClientRect().bottom - body.lastElementChild!.getBoundingClientRect().bottom
            }),
          { message: `${name} bottom clearance` },
        )
        .toBeGreaterThanOrEqual(viewport.bottom ? 119.5 : 79.5)
      await expect(main).toHaveJSProperty("scrollTop", 0)
      await expect
        .poll(() => main.evaluate((element) => element.scrollWidth - element.clientWidth))
        .toBeLessThanOrEqual(1)
    }
  })
}
