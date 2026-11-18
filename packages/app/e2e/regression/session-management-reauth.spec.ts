import type { WorkflowAssetInfo } from "@aigcfroge/client/promise"
import { expect, test } from "@playwright/test"
import { project, provider, REMOTE_SERVER, SERVER, session, sessionHref } from "../utils/app"
import { mockServers } from "../utils/mock-server"
import { openSidePanel } from "../utils/side-panel"
import { expectSessionTitle } from "../utils/waits"

test("Workflow reloads its selected definition after SSH sign-in replaces the client with the same Session scope", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const directory = "/home/box/workflow-owner"
  const sessionID = "ses_workflow_ssh_owner"
  const title = "Workflow SSH owner"

  const first: WorkflowAssetInfo = {
    kind: "workflow",
    name: "Original SSH workflow",
    description: "Definition read by the original SSH client",
    relativePath: "releases/ssh-owner.yaml",
    revision: "a".repeat(64),
    content: "Original SSH workflow content",
    version: "1",
    triggers: [],
    steps: [],
  }

  const next = {
    ...first,
    name: "Current SSH workflow",
    description: "Definition read by the replacement SSH client",
    revision: "b".repeat(64),
    content: "Current SSH workflow content",
  }

  const published = { assets: [first] }

  const config = {
    directory,
    project: project({ id: "proj_workflow_ssh_owner", directory }),
    provider: provider(),
    sessions: [
      session({
        id: sessionID,
        title,
        directory,
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_workflow_ssh_owner", rootSessionID: sessionID },
      }),
    ],
    pageMessages: () => ({ items: [] }),
    workflowAssets: () => published.assets,
  }

  await mockServers(page, {
    [SERVER]: { ...config, sessions: [] },
    [REMOTE_SERVER]: config,
  })
  await page.goto(
    "/e2e/utils/settings-wsl.html?" +
      new URLSearchParams({
        server: SERVER,
        mode: "ready",
        ssh: REMOTE_SERVER,
        path: sessionHref(sessionID, "ssh:box"),
      }),
  )
  await expectSessionTitle(page, title)

  const listed = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).origin === REMOTE_SERVER &&
      new URL(response.url()).pathname === "/workflow-asset",
  )

  await openSidePanel(page, "Workflow run")
  const firstList = await listed
  expect(firstList.status()).toBe(200)
  expect(await firstList.request().headerValue("authorization")).toBe("Basic " + btoa("aigcfroge:ssh-1"))
  const panel = page.getByRole("region", { name: "Workflow run", exact: true })
  const selection = panel.getByRole("group", { name: "Workflow definition", exact: true }).getByRole("button")
  const definition = panel.locator(".workflow-definition")
  await expect(selection).toBeEnabled()

  const selected = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).origin === REMOTE_SERVER &&
      new URL(response.url()).pathname === "/workflow-asset/content" &&
      new URL(response.url()).searchParams.get("path") === first.relativePath,
  )

  await selection.click()
  await page.getByRole("option", { name: first.name, exact: true }).click()
  expect((await selected).status()).toBe(200)
  await expect(selection).toContainText(first.name)
  await expect(definition).toContainText(first.revision)

  const reloaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).origin === REMOTE_SERVER &&
      new URL(response.url()).pathname === "/workflow-asset" &&
      new URL(response.url()).searchParams.get("directory") === directory &&
      response.request().headers()["authorization"] === "Basic " + btoa("aigcfroge:ssh-2"),
  )

  const reread = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).origin === REMOTE_SERVER &&
      new URL(response.url()).pathname === "/workflow-asset/content" &&
      new URL(response.url()).searchParams.get("path") === next.relativePath &&
      new URL(response.url()).searchParams.get("directory") === directory &&
      response.request().headers()["authorization"] === "Basic " + btoa("aigcfroge:ssh-2"),
  )

  // SSH sign-in rebuilds this client's connection while retaining the Session, directory, and selected definition path.
  published.assets = [next]
  await page.getByRole("button", { name: "Require SSH sign-in", exact: true }).click()
  await expect(page.getByLabel("SSH connects")).toHaveText("1")
  await expectSessionTitle(page, title)
  const refreshed = await Promise.all([reloaded, reread])
  expect(refreshed.map((response) => response.status())).toEqual([200, 200])
  expect(await refreshed[1].json()).toMatchObject({
    name: next.name,
    revision: next.revision,
    relativePath: first.relativePath,
  })
  await expect(panel).toBeVisible()
  await expect(selection).toContainText(next.name)
  await expect(definition).toContainText(next.revision)
  await expect(definition).not.toContainText(first.revision)
  await expect(panel.getByRole("alert")).toHaveCount(0)
})
