import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.AIGCFROGE_MODELS_URL || "https://models.dev"
const snapshotPath = path.join(__dirname, "models-dev.snapshot.json")

export const modelsData = await loadModelsData()
console.log("Loaded models.dev snapshot")

async function loadModelsData() {
  if (process.env.MODELS_DEV_API_JSON) {
    return await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  }
  const fetched = await fetchModelsDev()
  if (fetched) return fetched
  console.warn(`models.dev unreachable, falling back to local snapshot`)
  return await Bun.file(snapshotPath).text()
}

async function fetchModelsDev(): Promise<string | undefined> {
  try {
    const response = await fetch(`${modelsUrl}/api.json`, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`)
    return await response.text()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    console.warn(`models.dev fetch failed: ${message}`)
    return undefined
  }
}
