import { mergeConfig } from "vite"
import config from "../../vite.config"

// Bun's --no-env-file does not disable Vite's own dotenv loader. Keep the production
// config/plugins, but never read workspace .env files in this isolated E4 build/preview.
export default mergeConfig(config, { envDir: false })
