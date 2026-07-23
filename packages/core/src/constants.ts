/**
 * Zero-dependency constants shared between server-side and browser code.
 * Files imported by browser bundles MUST NOT import Node-only modules (path,
 * fs, @effect/platform, etc.). Add container-agnostic constants here so
 * both server and renderer code can reference them safely.
 */
export const PROMPTS_DIR = ".aigcfroge/prompts"
