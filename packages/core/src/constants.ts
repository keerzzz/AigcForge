/**
 * Zero-dependency constants shared between server-side and browser code.
 * Files imported by browser bundles MUST NOT import Node-only modules (path,
 * fs, @effect/platform, etc.). Add container-agnostic constants here so
 * both server and renderer code can reference them safely.
 */
export const PROMPTS_DIR = ".omnixa/prompts"
export const SKILLS_DIR = ".omnixa/skills"
export const MCPS_DIR = ".omnixa/mcps"
export const COMMANDS_DIR = ".omnixa/commands"
export const AGENTS_DIR = ".omnixa/agents"
export const WORKFLOWS_DIR = ".omnixa/workflows"
export const PLUGINS_DIR = ".omnixa/plugins"
export const CUSTOM_PROFILES_DIR = ".omnixa/custom-profiles"
