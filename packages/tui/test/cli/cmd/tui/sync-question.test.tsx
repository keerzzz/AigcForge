/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { Event, QuestionV2Request } from "@aigcfroge/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { directory, mount, wait } from "./sync-fixture"

for (const type of ["question.v2.replied", "question.v2.rejected"] as const) {
  test(`sync consumes ${type} without changing another question owner`, async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const harness = await mount(undefined, tmp.path)
    const request: QuestionV2Request = {
      id: "question-2",
      sessionID: "child-session",
      questions: [{ header: "Mode", question: "Mode?", options: [{ label: "Fast", description: "Quick pass" }] }],
    }
    const emit = (payload: Event) => harness.emit({ directory, project: "proj_test", payload })

    try {
      emit({ id: "child-asked", type: "question.v2.asked", properties: request })
      emit({ id: "parent-asked", type: "question.v2.asked", properties: { ...request, sessionID: "parent-session" } })
      emit({ id: "child-first", type: "question.v2.asked", properties: { ...request, id: "question-1" } })
      await wait(() => harness.sync.data.question[request.sessionID]?.length === 2)
      expect(harness.sync.data.question[request.sessionID].map((item) => item.id)).toEqual(["question-1", "question-2"])

      emit({ id: "child-updated", type: "question.v2.asked", properties: { ...request, questions: [] } })
      await wait(() => harness.sync.data.question[request.sessionID]?.[1]?.questions.length === 0)
      expect(harness.sync.data.question[request.sessionID]).toHaveLength(2)
      const properties = { sessionID: request.sessionID, requestID: request.id }
      emit(
        type === "question.v2.replied"
          ? { id: "child-settled", type, properties: { ...properties, answers: [] } }
          : { id: "child-settled", type, properties },
      )
      await wait(() => harness.sync.data.question[request.sessionID]?.length === 1)
      expect(harness.sync.data.question["parent-session"]).toEqual([{ ...request, sessionID: "parent-session" }])
      expect(harness.sync.data.question[request.sessionID][0].id).toBe("question-1")
    } finally {
      harness.app.renderer.destroy()
    }
  })
}
