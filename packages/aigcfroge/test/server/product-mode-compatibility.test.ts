import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import { Session } from "@/session/session"
import { Database } from "@aigcfroge/core/database/database"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { eq } from "drizzle-orm"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { TestInstance } from "../fixture/fixture"

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Database.defaultLayer, httpApiLayer))

function request(path: string, directory: string, init: RequestInit = {}) {
  return requestInDirectory(path, directory, init)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function responseJson(response: HttpClientResponse.HttpClientResponse) {
  return response.json
}

describe("ProductMode Capability & Compatibility", () => {
  it.instance("/experimental/capabilities exposes custom capability metadata with customMode disabled in M0", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const response = yield* request("/experimental/capabilities", test.directory)
      expect(response.status).toBe(200)
      const body = yield* responseJson(response)
      if (!isRecord(body)) throw new Error("Expected object response")
      expect(body.customMode).toBe(false)
      expect(body.customCompositionVersion).toBe(1)
      expect(Array.isArray(body.productModes)).toBe(true)
      const modes = Array.isArray(body.productModes) ? body.productModes : []
      expect(modes).toContain("custom")
      expect(modes).toContain("coding")
    }),
  )

  it.instance("Old client without capability header excludes custom sessions from list and fails by ID", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { db } = yield* Database.Service
      const codingSession = yield* Session.use.create({ title: "Coding Session" })
      const customSession = yield* Session.use.create({ title: "Custom Session" })

      // Manually set mode to custom on one session
      yield* db.update(SessionTable).set({ mode: "custom" }).where(eq(SessionTable.id, customSession.id))

      // 1. List without capability header -> should only return codingSession
      const listRes = yield* request("/session", test.directory)
      expect(listRes.status).toBe(200)
      const list = yield* responseJson(listRes)
      if (!Array.isArray(list)) throw new Error("Expected array list")
      const ids = list.filter(isRecord).map((s) => s.id)
      expect(ids).toContain(codingSession.id)
      expect(ids).not.toContain(customSession.id)

      // 2. Direct GET by ID without capability header -> should return 400 UnsupportedProductModeError
      const getRes = yield* request(`/session/${customSession.id}`, test.directory)
      expect(getRes.status).toBe(400)
      const getBody = yield* responseJson(getRes)
      if (!isRecord(getBody)) throw new Error("Expected object response")
      expect(getBody._tag).toBe("UnsupportedProductModeError")
      expect(getBody.mode).toBe("custom")

      // 3. Direct GET coding session without capability header -> should succeed (200)
      const getCodingRes = yield* request(`/session/${codingSession.id}`, test.directory)
      expect(getCodingRes.status).toBe(200)

      // 4. List with capable header -> should return both
      const capableListRes = yield* request("/session", test.directory, {
        headers: { [ProductModePolicy.CAPABILITIES_HEADER]: ProductModePolicy.CAPABILITY_CUSTOM_V1 },
      })
      expect(capableListRes.status).toBe(200)
      const capableList = yield* responseJson(capableListRes)
      if (!Array.isArray(capableList)) throw new Error("Expected array list")
      const capableIds = capableList.filter(isRecord).map((s) => s.id)
      expect(capableIds).toContain(codingSession.id)
      expect(capableIds).toContain(customSession.id)

      // 5. Direct GET custom session with capable header -> should succeed (200)
      const capableGetRes = yield* request(`/session/${customSession.id}`, test.directory, {
        headers: { [ProductModePolicy.CAPABILITIES_HEADER]: ProductModePolicy.CAPABILITY_CUSTOM_V1 },
      })
      expect(capableGetRes.status).toBe(200)
      const customBody = yield* responseJson(capableGetRes)
      if (!isRecord(customBody)) throw new Error("Expected object response")
      expect(customBody.mode).toBe("custom")
    }),
  )
})
