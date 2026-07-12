const modelsUrl = process.env.AIGCFROGE_MODELS_URL || "https://models.dev"

export const modelsData = await loadModelsData()

console.log("Loaded models.dev snapshot")

async function loadModelsData() {
  try {
    if (process.env.MODELS_DEV_API_JSON) return await Bun.file(process.env.MODELS_DEV_API_JSON).text()
    const response = await fetch(`${modelsUrl}/api.json`, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`)
    return await response.text()
  } catch (cause) {
    throw new Error("Failed to load the models.dev snapshot", { cause })
  }
}
