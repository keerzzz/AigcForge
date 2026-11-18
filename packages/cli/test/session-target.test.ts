import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { AigcForge, type LocationGetOutput, type ModelSelection, type SessionInfo } from "@aigcfroge/client/promise"
import { parseSessionTargetModel, resolveSessionTarget, SessionTargetMutationError } from "../src/session-target"

function location(directory: string): LocationGetOutput {
  return { directory, project: { id: "project", directory, canonical: directory } }
}

function session(id: string, directory: string, model?: ModelSelection): SessionInfo {
  return {
    id,
    projectID: "project",
    title: id,
    location: { directory },
    model,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
}

const prepare = async (input: { model: ModelSelection | undefined; agent: string | undefined }) => ({
  model: input.model,
  agent: input.agent,
})

afterEach(() => mock.restore())

describe("session target resolver", () => {
  test("parses Group selections with slash-prefixed physical refs preserved", () => {
    expect(parseSessionTargetModel("group:fallback")).toEqual({ type: "group", groupID: "fallback" })
    expect(parseSessionTargetModel("group:vendor/chat#high")).toEqual({ providerID: "group:vendor", id: "chat", variant: "high" })
    expect(() => parseSessionTargetModel("group:fallback#high")).toThrow()
  })

  test("adopts a Group without a redundant switch and switches a changed Group by identity", async () => {
    const client = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const first: ModelSelection = { type: "group", groupID: "first" }
    const next: ModelSelection = { type: "group", groupID: "next" }
    const selected = session("ses_group", "/group", first)
    spyOn(client.session, "get").mockResolvedValue(selected)
    spyOn(client.location, "get").mockResolvedValue(location("/group"))
    const switched = spyOn(client.session, "switchModel").mockResolvedValue()
    expect((await resolveSessionTarget({ client, session: selected.id, prepare })).model).toEqual(first)
    expect(switched).not.toHaveBeenCalled()
    spyOn(client.session, "get").mockResolvedValueOnce(selected).mockResolvedValue({ ...selected, model: next })
    expect((await resolveSessionTarget({ client, session: selected.id, model: next, prepare })).model).toEqual(next)
    expect(switched).toHaveBeenCalledWith({ sessionID: selected.id, model: next })
  })

  test("adopts an explicit Session location and model", async () => {
    const client = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const selected = session("ses_resume", "/session", { providerID: "openai", id: "gpt-5" })
    spyOn(client.session, "get").mockResolvedValue(selected)
    spyOn(client.location, "get").mockResolvedValue(location("/session"))

    const target = await resolveSessionTarget({ client, session: selected.id, prepare })
    expect(target).toMatchObject({
      session: { id: "ses_resume" },
      location: { directory: "/session" },
      model: { providerID: "openai", id: "gpt-5" },
      resume: true,
    })
  })

  test("creates a missing explicit Session with its ID", async () => {
    const client = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    spyOn(client.session, "get").mockRejectedValue({ _tag: "SessionNotFoundError" })
    spyOn(client.location, "get").mockResolvedValue(location("/project"))
    const create = spyOn(client.session, "create").mockResolvedValue(session("ses_chosen", "/project"))

    const target = await resolveSessionTarget({ client, session: "ses_chosen", prepare })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: "ses_chosen" }))
    expect(target).toMatchObject({ session: { id: "ses_chosen" }, resume: false })
  })

  test("does not create a missing explicit Session to fork", async () => {
    const client = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    spyOn(client.session, "get").mockRejectedValue({ _tag: "SessionNotFoundError" })
    const create = spyOn(client.session, "create")

    await expect(resolveSessionTarget({ client, session: "ses_chosen", fork: true, prepare })).rejects.toThrow(
      "Session not found",
    )
    expect(create).not.toHaveBeenCalled()
  })

  test("paginates to continue the exact directory", async () => {
    const client = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    spyOn(client.location, "get").mockResolvedValue(location("/project"))
    const explicit = Array.from({ length: 50 }, (_, index) => session(`ses_${index}`, `/other/${index}`))
    const list = spyOn(client.session, "list")
      .mockResolvedValueOnce({ data: explicit, cursor: { next: "page_2" } })
      .mockResolvedValueOnce({ data: [session("ses_implicit", "/project")], cursor: {} })

    const target = await resolveSessionTarget({ client, location: { directory: "/project" }, continue: true, prepare })
    expect(list).toHaveBeenCalledTimes(2)
    expect(target.session.id).toBe("ses_implicit")
  })

  test("attaches the terminal environment to the resolved local Session", async () => {
    const client = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const selected = session("ses_resume", "/session")
    spyOn(client.session, "get").mockResolvedValue(selected)
    spyOn(client.location, "get").mockResolvedValue(location("/session"))
    const environment = spyOn(client.session, "environment").mockResolvedValue()

    await resolveSessionTarget({
      client,
      session: selected.id,
      environment: { PATH: "/terminal/bin" },
      prepare,
    })

    expect(environment).toHaveBeenCalledWith({
      sessionID: selected.id,
      variables: { PATH: "/terminal/bin" },
    })
  })

  test.each(["build", "plan", "meta"])("creates the prepared %s Agent at the server Location", async (agent) => {
    const client = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const order: string[] = []
    const model = { providerID: "provider", id: "prepared", variant: "default" }
    spyOn(client.location, "get").mockResolvedValue(location("/server"))
    const create = spyOn(client.session, "create").mockImplementation(async (input) => {
      order.push("create")
      expect(input).toMatchObject({ agent, model, location: { directory: "/server" } })
      expect(input?.executorPreference).toBeUndefined()
      return {
        ...session("ses_fresh", "/server", model),
        agent,
      }
    })

    const target = await resolveSessionTarget({
      client,
      agent: "requested",
      prepare: async (input) => {
        order.push("prepare")
        expect(input.location.directory).toBe("/server")
        return { model, agent }
      },
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(order).toEqual(["prepare", "create"])
    expect(target.agent).toBe(agent)
    expect(target.model).toEqual(model)
    expect(target.executorPreference).toBeUndefined()
  })

  test.each(["build", "plan"])("switches a historical Meta root to the captured %s Agent and model", async (agent) => {
    const client = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    const model = { providerID: "provider", id: "prepared", variant: "default" }
    const previous = {
      ...session("ses_resume", "/session", { providerID: "provider", id: "previous" }),
      agent: "meta",
      controller: { kind: "root", metaAgentID: "mag_root", rootSessionID: "ses_resume" } as const,
      executorPreference: { agent: "worker" },
    }
    spyOn(client.session, "get")
      .mockResolvedValueOnce(previous)
      .mockResolvedValue({ ...previous, agent, model })
    spyOn(client.location, "get").mockResolvedValue(location("/session"))
    const selectExecutor = spyOn(client.session, "selectExecutor")
    const switchAgent = spyOn(client.session, "switchAgent").mockResolvedValue()
    const switchModel = spyOn(client.session, "switchModel").mockResolvedValue()

    const target = await resolveSessionTarget({
      client,
      session: previous.id,
      agent,
      model,
      prepare: async (input) => {
        expect(input.agent).toBe(agent)
        return { agent: input.agent, model: input.model }
      },
    })

    expect(switchAgent).toHaveBeenCalledWith({ sessionID: previous.id, agent, model })
    expect(switchModel).not.toHaveBeenCalled()
    expect(selectExecutor).not.toHaveBeenCalled()
    expect(target.agent).toBe(agent)
    expect(target.model).toEqual(model)
    expect(target.executorPreference).toEqual(previous.executorPreference)
  })

  test("uses the agent resolved by the server for a fresh Session", async () => {
    const client = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    spyOn(client.location, "get").mockResolvedValue(location("/project"))
    const create = spyOn(client.session, "create").mockResolvedValue({
      ...session("ses_fresh", "/project"),
      agent: "plan",
    })

    const target = await resolveSessionTarget({ client, prepare })
    expect(target.agent).toBe("plan")
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ agent: undefined, executorPreference: undefined }))
  })

  test("does not retry an ambiguous Session creation", async () => {
    const client = AigcForge.make({ baseUrl: "https://aigcfroge.test" })
    spyOn(client.location, "get").mockResolvedValue(location("/project"))
    spyOn(client.session, "create").mockRejectedValue(new Error("connection closed after create"))
    await expect(resolveSessionTarget({ client, prepare })).rejects.toBeInstanceOf(SessionTargetMutationError)
  })
})
