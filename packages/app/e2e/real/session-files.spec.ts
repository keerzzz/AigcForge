/**
 * S5 Files chain (plan §8.2): real filesystem under the run's own workspace.
 *
 * Everything here goes through the real backend against a temp git workspace —
 * no page.route. The teardown gate checks the workspace for residue, so this
 * spec writes only inside `e4/files/` and asserts the search/read contracts the
 * app actually consumes.
 */
import { expect, test, type APIRequestContext } from "@playwright/test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { e4 } from "./fixture"
import { isRecord } from "./manifest"

const headers = () => ({ "x-aigcfroge-directory": e4().workspaceDir })

function seedFiles() {
  const e4m = e4()
  const root = path.join(e4m.workspaceDir, "files")
  mkdirSync(path.join(root, "nested"), { recursive: true })
  writeFileSync(path.join(root, "alpha.md"), "# Alpha\nfindme alpha line\n")
  writeFileSync(path.join(root, "nested", "beta.md"), "beta content with findme token\n")
  writeFileSync(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3, 255, 254]))
  return root
}

const query = () => `directory=${encodeURIComponent(e4().workspaceDir)}`

async function findFile(request: APIRequestContext, name: string) {
  const response = await request.get(`${e4().backendUrl}/find/file?${query()}&query=${encodeURIComponent(name)}`, {
    headers: headers(),
  })
  expect(response.ok(), `find/file ${name}: ${await response.text()}`).toBeTruthy()
  return (await response.json()) as unknown
}

// The teardown gate treats anything outside .git/.aigcfroge as workspace
// residue, so the chain removes its own fixtures — that IS the "workspace holds
// only expected changes" contract from plan §8.2.
test.afterAll(() => {
  rmSync(path.join(e4().workspaceDir, "files"), { recursive: true, force: true })
})

test.skip(() => e4().v2Runtime, "files chain runs against the default backend")

test("searches, reads, and isolates files in a real workspace", async ({ request }) => {
  const e4m = e4()
  const root = seedFiles()
  const relative = path.relative(e4m.workspaceDir, path.join(root, "alpha.md"))

  // 1. Search finds the seeded files by name.
  const found = await findFile(request, "alpha.md")
  expect(Array.isArray(found), "find/file returns a list").toBe(true)
  expect(JSON.stringify(found)).toContain("alpha.md")

  // 2. Read returns the real bytes, decoding to the file's text.
  const read = await request.get(`${e4m.backendUrl}/file/content?${query()}&path=${encodeURIComponent(relative)}`, {
    headers: headers(),
  })
  expect(read.ok(), `file/content: ${await read.text()}`).toBeTruthy()
  const content: unknown = await read.json()
  expect(JSON.stringify(content)).toContain("findme alpha line")

  // 3. A binary file must not be served as a mangled text blob.
  const binaryRelative = path.relative(e4m.workspaceDir, path.join(root, "binary.bin"))
  const binary = await request.get(
    `${e4m.backendUrl}/file/content?${query()}&path=${encodeURIComponent(binaryRelative)}`,
    { headers: headers() },
  )
  expect(binary.ok(), `binary read: ${await binary.text()}`).toBeTruthy()
  const binaryBody: unknown = await binary.json()
  expect(binaryBody).toMatchObject({ type: "binary", encoding: "base64" })
  expect(JSON.stringify(binaryBody)).not.toContain("\u0000")

  // 4. Path traversal outside the workspace fails closed, not silently served.
  const escaped = await request.get(
    `${e4m.backendUrl}/file/content?${query()}&path=${encodeURIComponent("../../../etc/passwd")}`,
    { headers: headers() },
  )
  expect(escaped.ok(), "traversal outside the workspace must not succeed").toBe(false)

  // 5. Missing file is a typed 404 with the real NotFoundError shape — empty
  //    text would make "gone" indistinguishable from "empty" (S6 closure).
  const missing = await request.get(
    `${e4m.backendUrl}/file/content?${query()}&path=${encodeURIComponent("files/does-not-exist.md")}`,
    { headers: headers() },
  )
  expect(missing.status(), "missing file 404s").toBe(404)
  const missingBody: unknown = await missing.json()
  if (!isRecord(missingBody)) throw new Error("missing-file body is not an object")
  expect(missingBody.name).toBe("NotFoundError")
  expect(JSON.stringify(missingBody)).toContain("does-not-exist.md")
})

test("two sessions read different files without cross-contamination", async ({ request }) => {
  const e4m = e4()
  const root = seedFiles()
  const first = path.relative(e4m.workspaceDir, path.join(root, "alpha.md"))
  const second = path.relative(e4m.workspaceDir, path.join(root, "nested", "beta.md"))

  const [a, b] = await Promise.all([
    request.get(`${e4m.backendUrl}/file/content?${query()}&path=${encodeURIComponent(first)}`, { headers: headers() }),
    request.get(`${e4m.backendUrl}/file/content?${query()}&path=${encodeURIComponent(second)}`, { headers: headers() }),
  ])
  expect(a.ok()).toBeTruthy()
  expect(b.ok()).toBeTruthy()
  const aBody = JSON.stringify(await a.json())
  const bBody = JSON.stringify(await b.json())
  expect(aBody).toContain("Alpha")
  expect(bBody).toContain("beta content")
  expect(aBody).not.toContain("beta content")
  expect(bBody).not.toContain("findme alpha line")
})

test("a large file stays bounded and typed", async ({ request }) => {
  const e4m = e4()
  const root = seedFiles()
  const bigName = "large.txt"
  writeFileSync(path.join(root, bigName), "x".repeat(2 * 1024 * 1024))
  const relative = path.relative(e4m.workspaceDir, path.join(root, bigName))

  const response = await request.get(`${e4m.backendUrl}/file/content?${query()}&path=${encodeURIComponent(relative)}`, {
    headers: headers(),
  })
  // Either the server serves it, or it refuses with a typed status — never a
  // silent empty body pretending the file was empty.
  if (response.ok()) {
    const body: unknown = await response.json()
    if (isRecord(body) && typeof body.content === "string") {
      expect(body.content.length, "large file content is not silently dropped").toBeGreaterThan(0)
    }
  } else {
    expect(response.status(), "large-file refusal is a client/typed status").toBeLessThan(500)
  }
})
