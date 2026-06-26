import path from "path"

process.env.AIGCFROGE_DB = ":memory:"
process.env.AIGCFROGE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.AIGCFROGE_DISABLE_MODELS_FETCH = "true"
