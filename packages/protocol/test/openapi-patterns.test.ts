import { expect, test } from "bun:test"
import { Context } from "effect"
import { OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"

test("PTY wire surfaces have unique OpenAPI names while preserving client identifiers", () => {
  const document = OpenApi.fromApi(ClientApi)
  const operations = Object.values(document.paths).flatMap((path) =>
    Object.values(path).flatMap((operation) =>
      typeof operation === "object" && operation !== null && "operationId" in operation ? [operation.operationId] : [],
    ),
  )
  expect(new Set(operations).size).toBe(operations.length)

  const cases = [
    ["get", "", "list"],
    ["post", "", "create"],
    ["get", "/{ptyID}", "get"],
    ["put", "/{ptyID}", "update"],
    ["delete", "/{ptyID}", "remove"],
    ["get", "/{ptyID}/connect", "connect"],
  ] as const
  cases.forEach(([method, suffix, name]) => {
    const group = name === "connect" ? "pty-connect-instance" : "pty-instance"
    expect(document.paths[`/api/pty${suffix}`]?.[method]?.operationId).toBe(`pty.${name}`)
    expect(document.paths[`/pty${suffix}`]?.[method]?.operationId).toBe(`${group}.pty.${name}`)
    const endpoint = Object.values(ClientApi.groups[group].endpoints).find(
      (endpoint) => endpoint.identifier === `pty.${name}`,
    )
    expect(endpoint).toBeDefined()
    expect(endpoint && Context.get(endpoint.annotations, OpenApi.Identifier)).toBe(`pty.${name}`)
  })
  expect(document.paths["/pty/{ptyID}/connect"]?.get?.parameters).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ in: "query", name: "directory" }),
      expect.objectContaining({ in: "query", name: "ticket" }),
    ]),
  )
})

test("the OpenAPI document keeps string pattern constraints from protocol schemas", () => {
  const patterns = new Set<string>()
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(collect)
    if (typeof value !== "object" || value === null) return
    Object.entries(value).forEach(([key, item]) => {
      if (key === "pattern" && typeof item === "string") patterns.add(item)
      collect(item)
    })
  }
  collect(OpenApi.fromApi(ClientApi))

  expect([...patterns]).toEqual(
    expect.arrayContaining([
      "^[^/#]+\\/[^#]+(?:#[^#]+)?$",
      "^[^/#]+$",
      "^[^#]+$",
      "^#[0-9a-fA-F]{6}$",
      "^[a-z0-9][a-z0-9._-]*$",
      "^[a-z][a-z0-9._-]*$",
      "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
    ]),
  )
})
