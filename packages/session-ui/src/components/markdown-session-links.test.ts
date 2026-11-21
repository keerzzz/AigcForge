import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { markSessionLinks, setupSessionLinks, updateSessionLinkTitles } from "./markdown-session-links"

const first = "ses_0123456789abcdefghijklmnop"

const second = "ses_abcdefghijklmnopqrstuvwxyz"

beforeAll(() => GlobalRegistrator.register())

afterAll(() => GlobalRegistrator.unregister())

test("links complete IDs in prose and inline code without changing fenced code or existing links", () => {
  const root = document.createElement("div")
  root.innerHTML = `<p>Open ${first}, then <code>${second}</code>. See <a href="/docs">${first}</a>.</p><pre><code>${first}</code></pre>`
  markSessionLinks(root)

  const links = root.querySelectorAll<HTMLButtonElement>("button[data-session-id]")
  expect([...links].map((button) => button.dataset.sessionId)).toEqual([first, second])
  expect(links[0]?.textContent).toBe(first)
  expect(links[1]?.innerHTML).toBe(`<code>${second}</code>`)
  expect(root.querySelector("pre button")).toBeNull()
  expect(root.querySelector("a button")).toBeNull()
  expect(root.textContent).toBe(`Open ${first}, then ${second}. See ${first}.${first}`)
})

test("ignores incomplete IDs, identifiers, code snippets and IDs in URLs", () => {
  const root = document.createElement("div")
  root.innerHTML = `<p>ses_123 and x${first} and ${first}more and <code>${first}extra</code> and <a href="https://example.com/${first}">${first}</a></p>`
  markSessionLinks(root)
  expect(root.querySelector("button")).toBeNull()
})

test("does not link an unparsed fenced block while the markdown worker is pending", () => {
  const root = document.createElement("div")
  root.innerHTML = `\`\`\`text<br>${first}<br>\`\`\``
  markSessionLinks(root)
  expect(root.querySelector("button")).toBeNull()
})

test("delegates keyboard-activated clicks to the latest rendered ID", () => {
  const root = document.createElement("div")
  const opened: string[] = []
  const dispose = setupSessionLinks(root, () => (id) => opened.push(id))
  root.innerHTML = `<p>${first}</p>`
  markSessionLinks(root)
  root.querySelector("button")?.click()
  root.innerHTML = `<p><code>${second}</code></p>`
  markSessionLinks(root)
  root.querySelector("button")?.click()
  expect(opened).toEqual([first, second])
  expect(root.querySelector("button")?.getAttribute("type")).toBe("button")
  dispose()
  root.querySelector("button")?.click()
  expect(opened).toEqual([first, second])
})

test("refreshes known titles and retains IDs, inline code, and unrelated selected content", () => {
  const root = document.createElement("div")
  root.innerHTML = `<p>Keep this text. ${first} and <code>${second}</code>.</p>`
  markSessionLinks(root)
  const links = [...root.querySelectorAll<HTMLButtonElement>("button[data-session-id]")]
  const prose = root.querySelector("p")!.firstChild
  const code = links[1].querySelector("code")
  const opened: string[] = []
  const dispose = setupSessionLinks(root, () => (id) => opened.push(id))

  updateSessionLinkTitles(root, (id) => (id === first ? "委派测试" : undefined))
  expect(links.map((link) => link.textContent)).toEqual(["委派测试", second])
  expect(links[0].title).toContain(first)
  links[0].click()
  expect(opened).toEqual([first])

  updateSessionLinkTitles(root, () => "重命名后的会话")
  expect(links.map((link) => link.textContent)).toEqual(["重命名后的会话", "重命名后的会话"])
  expect(links[1].querySelector("code")).toBe(code)
  expect(root.querySelector("p")!.firstChild).toBe(prose)
  expect([...root.querySelectorAll("button")]).toEqual(links)

  updateSessionLinkTitles(root, () => " ")
  expect(links.map((link) => link.textContent)).toEqual([first, second])
  dispose()
})
