import { expect, test } from "bun:test"
import { stableMacDownload } from "./migration"

test("selects the signed stable installer for the current Mac architecture", () => {
  const artifact = {
    version: "2.0.2",
    metadata: {
      files: {
        "aigcfroge-desktop-mac-arm64.dmg": { url: "https://files.test/AigcForge-arm64.dmg" },
        "aigcfroge-desktop-mac-x64.dmg": { url: "https://files.test/AigcForge-x64.dmg" },
      },
    },
  }

  expect(stableMacDownload(artifact, "arm64")).toEqual({
    version: "2.0.2",
    url: "https://files.test/AigcForge-arm64.dmg",
  })
  expect(stableMacDownload(artifact, "x64")).toEqual({
    version: "2.0.2",
    url: "https://files.test/AigcForge-x64.dmg",
  })
  expect(stableMacDownload(artifact, "ia32")).toBeUndefined()
  expect(stableMacDownload({ version: "2.0.2", metadata: { files: {} } }, "arm64")).toBeUndefined()
})
