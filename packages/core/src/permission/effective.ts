export * as PermissionEffective from "./effective"

import { Permission } from "@aigcfroge/schema/permission"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Wildcard } from "../util/wildcard"
import { PermissionV1 } from "../v1/permission"
import type { SessionSchema } from "../session/schema"

// 档位化判定所需输入，由调用方从 Session / Agent / override service / saved
// approvals 组装；本模块是纯函数 owner，不访问数据库、不读取 Config、不持有 Map。
export type Input = {
  mode: ProductMode.ID
  agent: string
  tier: PermissionTier.ID
  parentID?: SessionSchema.ID
  attended?: boolean
  masterPermissionEnabled: boolean
  savedApprovals: ReadonlyArray<{ action: string; resource: string }>
}

// Chat full 必须逐次确认的危险 action（红线 4）。未知 action 由 wildcard ask 兜底。
const DANGEROUS_ACTIONS = ["bash", "edit", "write", "apply_patch"] as const

/** 单一真源出口：资产导入期的危险动作披露复用同一清单，禁止另抄一份。 */
export function isDangerousAction(action: string) {
  return (DANGEROUS_ACTIONS as ReadonlyArray<string>).includes(action)
}

// custom unattended 天花板白名单（ADR-20 §2.6，R6-2 整改）：只读类 action 才可
// 为无人值守扇出预授权；成员逐一取自 builtins.ts 注册清单，新工具默认不在
// 名单内即 deny。task_spawn/webfetch 等扇出与外发原语被刻意排除。
const READONLY_CEILING_ACTIONS = ["glob", "grep", "list_assets", "read"] as const
const readonlyCeilingAction = new Set<string>(READONLY_CEILING_ACTIONS)

export function evaluate(rules: Permission.Ruleset, action: string, resource: string): Permission.Effect {
  return (
    rules.findLast((rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource))?.effect ??
    "ask"
  )
}

export function evaluateV1(rules: PermissionV1.Ruleset, permission: string, pattern: string): PermissionV1.Action {
  return (
    rules.findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern))
      ?.action ?? "ask"
  )
}

// 唯一决策实现：mode × agent × tier × attended × master × saved 的全部条件分支
// 只存在于这里；effectiveV1/effectiveV2 只是同一决策结果的双端格式转换。
function compute(input: Input, baseInput: Permission.Ruleset): Permission.Ruleset {
  const attended = input.attended !== false
  // ADR-20 §2.6 (Phase D)：custom 模式下资产来源的执行类 allow 一律改判 ask
  // ——审批框只在 ask 时出现，「用户在场 ≠ 用户同意」。白名单只读类保持
  // allow；saved 追加来源在下游单独追加，不受此重写影响。
  const rewrittenAsks: Permission.Ruleset = []
  const rest: Permission.Ruleset = []
  for (const rule of baseInput) {
    const rewritten =
      input.mode === "custom" && rule.effect === "allow" && !readonlyCeilingAction.has(rule.action)
        ? { ...rule, effect: "ask" as const }
        : rule
    // 位序即语义（evaluate 是 findLast）：由 allow 改判的 ask 前置到白名单
    // allow 与显式 deny 之前，避免尾部通配改判遮蔽它们；其余规则保持原序。
    ;(rewritten.effect === "ask" && rule.effect === "allow" ? rewrittenAsks : rest).push(rewritten)
  }
  const base = input.mode === "custom" ? [...rewrittenAsks, ...rest] : baseInput
  // 档位只对 chat/work/assistant × meta × full 抬权；未知 mode fail-safe 不抬权。
  const elevatedMode = input.mode === "chat" || input.mode === "work" || input.mode === "assistant"
  const elevated = elevatedMode && input.agent === "meta" && input.tier === "full"
  const chatDangerous = input.mode === "chat" && elevated

  const rules: Permission.Ruleset = elevated
    ? [
        ...base,
        // 未知能力可见但必须确认（红线 3：不产生新 allow）。
        { action: "*", resource: "*", effect: "ask" },
        // 重放基线非 deny 规则，保留 read/propose/question 等既有 allow。
        ...base.filter((rule) => rule.effect !== "deny"),
      ]
    : [...base]

  // master/override：仅有人值守根会话；Chat full 的危险/未知 action 在下方最后覆盖。
  if (input.masterPermissionEnabled && attended) {
    rules.push({ action: "*", resource: "*", effect: "allow" })
  }
  if (attended) {
    rules.push(
      ...input.savedApprovals.map(
        (item): Permission.Rule => ({ action: item.action, resource: item.resource, effect: "allow" }),
      ),
    )
  }
  if (chatDangerous) {
    // Chat full 逐次确认：无 master 时未知 action 已由 full 的 wildcard ask 覆盖；
    // 有 master 时需再次压过 master 的全 allow，并重放 base 的 allow 规则以
    // 恢复 read/propose 等既有 allow（否则 wildcard ask 会盖掉它们，H2）。
    // 只重放 allow 不重放 ask：override 语义是「放开一般动作，仅 Chat 危险
    // action 逐次确认」（确认框文案明示可读敏感文件）；重放基线 ask 会让
    // chat full 的 .env 读取在 override 下仍逐次确认，与文案及 work/
    // assistant 模式的 override 行为不一致（实测发现 B）。
    if (input.masterPermissionEnabled && attended) {
      rules.push({ action: "*", resource: "*", effect: "ask" })
      rules.push(...base.filter((rule) => rule.effect === "allow"))
    }
    rules.push(...DANGEROUS_ACTIONS.map((action): Permission.Rule => ({ action, resource: "*", effect: "ask" })))
  }
  // 显式 deny（非 fallback wildcard）优先于 saved approval（§1.3 规则 1）。
  rules.push(...base.filter((rule) => rule.effect === "deny" && !(rule.action === "*" && rule.resource === "*")))

  if (!attended) {
    // Deny-first custom ceiling（M2 遗留 §4.5-1；R6-1/R6-2 整改）：白名单制。
    // 只有显式只读类 allow（READONLY_CEILING_ACTIONS）可为无人值守扇出预授权，
    // 未收录 action（含未来新工具）一律默认 deny。base 的显式非通配 deny
    // 必须保留且排在白名单 allow 之后——evaluate 是 findLast，否则通配 allow
    // 会压过 {read,.env,deny} 这类资源级 deny，使 custom 弱于其它模式。
    // 非 custom 维持 2026-08-02 scheduled-job 裁决：显式 allow 不被 clamp 改写。
    if (input.mode === "custom") {
      const clampedAsks = rules.flatMap((rule) =>
        rule.effect === "ask" ? [{ action: rule.action, resource: rule.resource, effect: "deny" as const }] : [],
      )
      const ceilingAllows = rules.filter((rule) => rule.effect === "allow" && readonlyCeilingAction.has(rule.action))
      const explicitDenies = rules.filter(
        (rule) => rule.effect === "deny" && !(rule.action === "*" && rule.resource === "*"),
      )
      return [{ action: "*", resource: "*", effect: "deny" }, ...clampedAsks, ...ceilingAllows, ...explicitDenies]
    }
    // unattended 最高拒绝（红线 5）：saved/master 不放开（上方未追加），
    // 全部 ask → deny，头部 fallback deny 兜底未匹配 action。
    return [
      { action: "*", resource: "*", effect: "deny" },
      ...rules.map((rule) => (rule.effect === "ask" ? { ...rule, effect: "deny" as const } : rule)),
    ]
  }
  return rules
}

export function effectiveV2(input: Input, base: Permission.Ruleset): Permission.Ruleset {
  return compute(input, base)
}

export function effectiveV1(input: Input, base: PermissionV1.Ruleset): PermissionV1.Ruleset {
  const v2Base = base.map(
    (rule): Permission.Rule => ({ action: rule.permission, resource: rule.pattern, effect: rule.action }),
  )
  return compute(input, v2Base).map(
    (rule): PermissionV1.Rule => ({ permission: rule.action, pattern: rule.resource, action: rule.effect }),
  )
}

// V1 `Permission.ask` 会把会话内 always 预授权（approved）追加在 ruleset 之后
// （findLast 赢）。Chat full 的危险 action 必须逐次确认（红线 4：不接受
// always 预授权），故调用方把返回值作为 ask 的 finalRules 追加在 approved 之后。
export function v1FinalRules(input: Input): PermissionV1.Ruleset {
  if (input.mode !== "chat" || input.agent !== "meta" || input.tier !== "full") return []
  return DANGEROUS_ACTIONS.map((action): PermissionV1.Rule => ({ permission: action, pattern: "*", action: "ask" }))
}
