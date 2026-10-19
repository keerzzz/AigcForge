import { EffectLifecycle } from "../../core/test/lib/effect-lifecycle"

EffectLifecycle.check(import.meta.resolve("./lib/effect.ts"), "testEffect")
EffectLifecycle.check(import.meta.resolve("./lib/effect.ts"), "testEffectShared")
