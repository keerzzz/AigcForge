/// <reference types="vite/client" />

import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import MarkdownShikiWorkerUrl from "../../../session-ui/src/components/markdown-shiki.worker.ts?worker&url"
import ShikiWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url"
import FileIconsUrl from "../../../ui/src/components/file-icons/sprite.svg"
import FinderIconUrl from "../../../ui/src/assets/icons/app/finder.png"

// Resolve Vite's URL-only imports without evaluating a browser worker in the DOM runner.
test.each([MarkdownShikiWorkerUrl, ShikiWorkerUrl, FileIconsUrl, FinderIconUrl])(
  "Vite URL import resolves to its real source: %s",
  async (url) => {
    expect(new URL(url).protocol).toBe("file:")
    expect(await Bun.file(fileURLToPath(url)).exists()).toBe(true)
  },
)
