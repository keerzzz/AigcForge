import { $ } from "bun"

// Check the committed tree, not ignored local files or the availability of remote badge servers.
const tree = new Map(
  (await $`git ls-tree -rtz HEAD`.text())
    .split("\0")
    .filter(Boolean)
    .map((entry) => [entry.slice(entry.indexOf("\t") + 1), entry.slice(0, 6)] as const),
)
const pages = new Map<string, { links: { value: string; image: boolean }[]; anchors: Set<string> }>()

async function page(file: string) {
  const cached = pages.get(file)
  if (cached) return cached
  if (!tree.get(file)?.startsWith("100")) throw new Error(`Missing regular Markdown file: ${file}`)
  const links: { value: string; image: boolean }[] = []
  const anchors = new Set<string>()
  const headings = new Set<string>()
  const text: string[] = []
  new HTMLRewriter()
    .on("h1, h2, h3, h4, h5, h6", {
      element(el) {
        text.length = 0
        el.onEndTag(() => {
          // Bun's native heading IDs discard Chinese characters; GitHub keeps them.
          const slug = text
            .join("")
            .replace(/&(?:[a-z][a-z\d]*|#\d+|#x[a-f\d]+);/gi, (entity) => Bun.markdown.render(entity, {}))
            .toLowerCase()
            .replace(/[^\p{Alphabetic}\p{M}\p{Nd}\p{Nl}\p{Pc} -]/gu, "")
            .replaceAll(" ", "-")
          let id = slug
          for (let suffix = 1; headings.has(id); suffix++) id = `${slug}-${suffix}`
          headings.add(id)
          anchors.add(id)
        })
      },
      text(chunk) {
        text.push(chunk.text)
      },
    })
    .on("a[href]", {
      element: (el) => {
        links.push({ value: el.getAttribute("href") ?? "", image: false })
      },
    })
    .on("img[src]", {
      element: (el) => {
        links.push({ value: el.getAttribute("src") ?? "", image: true })
      },
    })
    .on("[id]", {
      element: (el) => {
        anchors.add(el.getAttribute("id") ?? "")
      },
    })
    .on("a[name]", {
      element: (el) => {
        anchors.add(el.getAttribute("name") ?? "")
      },
    })
    .transform(Bun.markdown.html(await $`git show ${`HEAD:${file}`}`.text()))
  const result = { links, anchors }
  pages.set(file, result)
  return result
}

for (const file of ["README.md", "README.zh.md"]) {
  const source = new URL(`https://readme.invalid/repository/${file}`)
  for (const link of (await page(file)).links) {
    const address = link.value.trim()
    if (!address) throw new Error(`${file}: empty link or image target`)
    const url = new URL(
      address.startsWith("/") && !address.startsWith("//") ? `/repository${address}` : address,
      source,
    )
    if (url.protocol === "file:") throw new Error(`${file}: local machine link ${address}`)
    if (url.origin !== source.origin) continue
    if (!url.pathname.startsWith("/repository/")) throw new Error(`${file}: target outside the repository: ${address}`)
    const target = decodeURIComponent(url.pathname.slice("/repository/".length)).replace(/\/$/, "")
    const mode = target ? tree.get(target) : "040000"
    if (!mode || (link.image && !mode.startsWith("100")))
      throw new Error(`${file}: missing link or image target: ${address}`)
    if (url.hash && /\.md$/i.test(target) && !(await page(target)).anchors.has(decodeURIComponent(url.hash.slice(1))))
      throw new Error(`${file}: missing Markdown anchor: ${address}`)
  }
  console.log(`Checked ${file}`)
}
