/**
 * Zero-dependency constants shared between server-side and browser code.
 * Files imported by browser bundles MUST NOT import Node-only modules (path,
 * fs, @effect/platform, etc.). Add container-agnostic constants here so
 * both server and renderer code can reference them safely.
 */
export const PROMPTS_DIR = ".aigcfroge/prompts"
export const SKILLS_DIR = ".aigcfroge/skills"
export const MCPS_DIR = ".aigcfroge/mcps"
export const COMMANDS_DIR = ".aigcfroge/commands"
export const AGENTS_DIR = ".aigcfroge/agents"
export const WORKFLOWS_DIR = ".aigcfroge/workflows"
export const PLUGINS_DIR = ".aigcfroge/plugins"
export const CUSTOM_PROFILES_DIR = ".aigcfroge/custom-profiles"
