export * as SessionSkill from "./skill.js"

import type { Session } from "@omnixa/schema/session"
import { Effect } from "effect"
import { CompositionConsumerView } from "../composition/consumer-view.js"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"
import { CompositionCatalog } from "../skill/composition-catalog.js"
import { Skill } from "../skill.js"
import { SessionComposition } from "./composition.js"
import { SkillNotFoundError } from "./error.js"

/** Select inside the activated Location so attachments and standalone activation share one catalog. */
export const select = Effect.fn("SessionSkill.select")(function* (input: { session?: Session.Info; skill: Skill.ID }) {
  const skill = yield* Effect.gen(function* () {
    if (input.session?.mode !== "custom") {
      const skills = yield* Skill.Service
      return yield* skills.get(input.skill)
    }
    const compositions = yield* SessionComposition.Service
    const selected = yield* SessionComposition.selectSessionAgent(compositions, input.session)
    const skills = yield* Effect.fromResult(
      CompositionCatalog.frozenSkills(
        input.session.location.directory,
        CompositionConsumerView.getSkills(selected.snapshot, selected.scope),
      ),
    )
    return skills.find((skill) => skill.id === input.skill)
  })
  if (!skill) return yield* new SkillNotFoundError({ skill: input.skill })
  return skill
})

export const get = Effect.fn("SessionSkill.get")(function* (input: { session: Session.Info; skill: Skill.ID }) {
  const instances = yield* Instance.Service
  return yield* Plugin.awaitActivation.pipe(Effect.andThen(select(input)), instances.provide(input.session))
})
