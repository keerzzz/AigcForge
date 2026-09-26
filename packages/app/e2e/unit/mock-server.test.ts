import { expect, test } from "bun:test"
import { shouldMockApiFallback } from "../utils/mock-server"

const cases = [
  {
    name: "same-origin directory SDK query",
    path: "/session/s/composition?directory=%2Ftmp",
    resourceType: "fetch",
    expected: true,
  },
  { name: "same-origin global V2 API", path: "/api/permission/request", resourceType: "fetch", expected: true },
  { name: "same-origin API XHR", path: "/api/permission/grant", resourceType: "xhr", expected: true },
  {
    name: "document navigation with a directory",
    path: "/new-session?directory=%2Ftmp",
    resourceType: "document",
    expected: false,
  },
  { name: "compiled JavaScript", path: "/assets/index.js", resourceType: "script", expected: false },
  { name: "WebAssembly fetched as an asset", path: "/assets/engine.wasm", resourceType: "fetch", expected: false },
  { name: "API-looking image URL", path: "/api/image", resourceType: "image", expected: false },
]

cases.forEach((item) => {
  test(`mock fallback distinguishes ${item.name}`, () => {
    expect(
      shouldMockApiFallback({
        url: new URL(item.path, "http://127.0.0.1:3101"),
        targetPort: "3101",
        appPort: "3101",
        resourceType: item.resourceType,
      }),
    ).toBe(item.expected)
  })
})

test("separate backend preserves the existing unmatched-API fallback", () => {
  expect(
    shouldMockApiFallback({
      url: new URL("http://127.0.0.1:4096/unmatched"),
      targetPort: "4096",
      appPort: "3101",
      resourceType: "fetch",
    }),
  ).toBe(true)
})

test("another server is never consumed by this mock", () => {
  expect(
    shouldMockApiFallback({
      url: new URL("http://127.0.0.1:5000/api/permission/request"),
      targetPort: "4096",
      appPort: "3101",
      resourceType: "fetch",
    }),
  ).toBe(false)
})
