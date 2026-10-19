import { EffectLifecycle } from "./lib/effect-lifecycle"

EffectLifecycle.check(import.meta.resolve("./lib/effect.ts"), "testEffect")
