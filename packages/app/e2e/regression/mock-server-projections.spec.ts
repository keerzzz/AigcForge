import { expect, test, type Page } from "@playwright/test"
import type { ProjectUpdateData } from "@aigcfroge/sdk/v2/client"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { mockAigcfrogeServer } from "../utils/mock-server"
;(["same-origin", "separate-origin"] as const).forEach((topology) => {
  test(`benchmark bootstrap projections follow the API contracts on ${topology}`, async ({ page }, testInfo) => {
    const server = new URL(testInfo.project.use.baseURL ?? "http://127.0.0.1:3000")
    if (topology === "separate-origin") server.port = server.port === "4096" ? "4097" : "4096"
    const nestedProject = { ...fixture.project, id: "proj_nested_projection", worktree: `${fixture.directory}/second` }
    await mockAigcfrogeServer(page, {
      port: server.port,
      directory: fixture.directory,
      project: fixture.project,
      projects: [fixture.project, nestedProject],
      provider: fixture.provider,
      sessions: fixture.sessions,
      pageMessages: () => ({ items: [] }),
    })
    const document = await page.goto("/")
    expect(document?.headers()["content-type"]).toContain("text/html")

    for (const path of ["/api/permission/request", "/api/permission/grant", "/api/question/request"]) {
      expect.soft(await read(page, server, path)).toMatchObject({
        status: 200,
        body: {
          location: {
            directory: fixture.directory,
            project: { id: fixture.project.id, directory: fixture.project.worktree },
          },
          data: [],
        },
      })
      const scoped = new URL(path, server)
      scoped.searchParams.set("location[directory]", `${fixture.directory}/nested`)
      scoped.searchParams.set("location[workspace]", "wrk_fixture_projection")
      expect.soft(await read(page, server, scoped.href)).toMatchObject({
        status: 200,
        body: {
          location: {
            directory: `${fixture.directory}/nested`,
            workspaceID: "wrk_fixture_projection",
            project: { id: fixture.project.id, directory: fixture.project.worktree },
          },
          data: [],
        },
      })
      scoped.searchParams.set("location[directory]", `${nestedProject.worktree}/nested`)
      expect.soft(await read(page, server, scoped.href)).toMatchObject({
        status: 200,
        body: {
          location: {
            directory: `${nestedProject.worktree}/nested`,
            workspaceID: "wrk_fixture_projection",
            project: { id: nestedProject.id, directory: nestedProject.worktree },
          },
          data: [],
        },
      })
      const windowsDirectory = nestedProject.worktree.replaceAll("/", "\\")
      scoped.searchParams.set("location[directory]", windowsDirectory)
      expect.soft(await read(page, server, scoped.href)).toMatchObject({
        status: 200,
        body: {
          location: {
            directory: windowsDirectory,
            project: { id: nestedProject.id, directory: nestedProject.worktree },
          },
        },
      })
    }
    expect.soft(await read(page, server, `/session/${fixture.sourceID}/composition`)).toMatchObject({
      status: 404,
      body: { name: "NotFoundError", data: { message: `Snapshot not found for session ${fixture.sourceID}` } },
    })
    expect.soft(await read(page, server, `/session/${fixture.sourceID}/permission-override`)).toMatchObject({
      status: 200,
      body: { enabled: false },
    })
    for (const path of ["composition", "permission-override"]) {
      expect.soft(await read(page, server, `/session/ses_missing_projection/${path}`)).toMatchObject({
        status: 404,
        body: { name: "NotFoundError", data: { message: "Session not found: ses_missing_projection" } },
      })
    }
    expect.soft(await read(page, server, "/global/health")).toMatchObject({
      status: 200,
      body: { healthy: true, version: expect.stringMatching(/\S/) },
    })
    expect.soft(await read(page, server, "/agent")).toMatchObject({
      status: 200,
      body: expect.arrayContaining([
        { name: "build", mode: "primary", permission: [], options: {}, primaryModes: ["coding"] },
        {
          name: "meta",
          mode: "primary",
          permission: [],
          options: {},
          primaryModes: ["chat", "coding", "work", "assistant", "custom"],
        },
      ]),
    })
    expect.soft(await read(page, server, "/provider")).toMatchObject({
      status: 200,
      body: {
        all: [
          {
            id: "aigcfroge",
            source: "config",
            env: [],
            options: {},
            models: {
              "claude-opus-4-6": {
                id: "claude-opus-4-6",
                providerID: "aigcfroge",
                api: { id: "claude-opus-4-6", url: expect.any(String), npm: expect.any(String) },
                capabilities: {
                  temperature: expect.any(Boolean),
                  reasoning: expect.any(Boolean),
                  attachment: expect.any(Boolean),
                  toolcall: expect.any(Boolean),
                  input: expect.objectContaining({ text: true, audio: false, image: true, video: false, pdf: true }),
                  output: expect.objectContaining({ text: true, audio: false, image: false, video: false, pdf: false }),
                  interleaved: false,
                },
                cost: { input: expect.any(Number), output: expect.any(Number), cache: { read: 0, write: 0 } },
                limit: { context: 200_000, output: expect.any(Number) },
                status: "active",
                options: {},
                headers: {},
                release_date: expect.stringMatching(/\S/),
              },
            },
          },
        ],
        connected: ["aigcfroge"],
        default: { aigcfroge: "claude-opus-4-6" },
      },
    })
  })

  test(`default project writes preserve identity and read back updates on ${topology}`, async ({ page }, testInfo) => {
    const server = new URL(testInfo.project.use.baseURL ?? "http://127.0.0.1:3000")
    if (topology === "separate-origin") server.port = server.port === "4096" ? "4097" : "4096"
    const project = {
      ...fixture.project,
      icon: { url: "https://fixture.invalid/icon.svg", override: "kept-icon", color: "blue" },
      commands: { start: "old-command" },
    }
    const secondProject = { ...fixture.project, id: "proj_second_write", worktree: `${fixture.directory}/second` }
    await mockAigcfrogeServer(page, {
      port: server.port,
      directory: fixture.directory,
      project,
      projects: [project, secondProject],
      provider: fixture.provider,
      sessions: fixture.sessions,
      pageMessages: () => ({ items: [] }),
    })
    await page.goto("/")

    const first = await read(page, server, `/project/${project.id}`, {
      name: "Updated project",
      icon: { color: "green" },
      commands: { start: "new-command" },
    })
    const expected = {
      ...project,
      name: "Updated project",
      icon: { ...project.icon, color: "green" },
      commands: { start: "new-command" },
      time: { ...project.time, updated: expect.any(Number) },
    }
    expect.soft(first).toMatchObject({ status: 200, body: expected })
    expect.soft(first.body).not.toHaveProperty("time.updated", project.time.updated)
    expect.soft(await read(page, server, "/project/current")).toMatchObject({ status: 200, body: expected })
    expect.soft(await read(page, server, "/project")).toMatchObject({ status: 200, body: [expected, secondProject] })
    const second = await read(page, server, `/project/${secondProject.id}`, { name: "Updated second" })
    expect.soft(second.body).toEqual({
      ...secondProject,
      name: "Updated second",
      time: { ...secondProject.time, updated: expect.any(Number) },
    })
    expect.soft(await read(page, server, "/project/current")).toMatchObject({ status: 200, body: expected })
    expect.soft(await read(page, server, "/project")).toMatchObject({ status: 200, body: [expected, second.body] })
    // Commands is a whole JSON column; an empty object replaces the old command.
    const cleared = await read(page, server, `/project/${project.id}`, { commands: {} })
    expect.soft(cleared.status).toBe(200)
    expect.soft(cleared.body).toEqual({ ...expected, commands: {} })
    const renamed = await read(page, server, `/project/${project.id}`, { name: "", icon: {} })
    expect.soft(renamed.body).toEqual({ ...expected, name: "", commands: {} })
    const unstyled = await read(page, server, `/project/${project.id}`, {
      icon: { url: "", override: "", color: "" },
      commands: { start: "" },
    })
    expect.soft(unstyled.status).toBe(200)
    expect.soft(unstyled.body).not.toHaveProperty("icon")
    expect
      .soft(unstyled.body)
      .toMatchObject({ name: "", commands: { start: "" }, time: { created: project.time.created } })
    const restyled = await read(page, server, `/project/${project.id}`, { icon: { color: "green" } })
    expect.soft(restyled.body).toMatchObject({ icon: { url: "", override: "", color: "green" } })
    expect.soft(await read(page, server, "/project/proj_missing_projection", { name: "Missing" })).toMatchObject({
      status: 404,
      body: {
        _tag: "ProjectNotFoundError",
        projectID: "proj_missing_projection",
        message: "Project not found: proj_missing_projection",
      },
    })
    // Route-local state must not mutate a shared seed used by another benchmark trial.
    expect(project.name).toBe(fixture.project.name)
    expect(project.icon.color).toBe("blue")
    expect(project.commands.start).toBe("old-command")
  })
})

async function read(page: Page, server: URL, path: string, body?: ProjectUpdateData["body"]) {
  const url = new URL(path, server)
  url.searchParams.set("directory", fixture.directory)
  const result = await page.evaluate(
    async ({ url, body }) => {
      const response = await fetch(
        url,
        body === undefined
          ? undefined
          : { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      )
      const payload: unknown = await response.json()
      return { status: response.status, contentType: response.headers.get("content-type"), body: payload }
    },
    { url: url.href, body },
  )
  expect.soft(result.contentType).toContain("application/json")
  return result
}
