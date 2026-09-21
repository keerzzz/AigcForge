/** The same pure gates run here on every E4 invocation and in e2e/unit. */
import { test } from "@playwright/test"
import { Coverage } from "./coverage"

test("every manifest entry carries the full route × mode × layer × failure × platform contract", () =>
  Coverage.entries())
test("every quarantined test.fixme case has a manifest entry — no silent quarantine", () => Coverage.quarantine())
test("all five modes declare their current coverage layer", () => Coverage.modes())
test("no deferred scope may float without an owner and an unlock condition", () => Coverage.deferred())
