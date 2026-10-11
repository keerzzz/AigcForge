import { afterEach, describe, expect, test } from "bun:test"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { Schema } from "effect"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider, loadLocaleDict, type Locale } from "@/context/language"
import { PlatformProvider } from "@/context/platform"
import { WorkReviewPanel } from "./work-review-panel"

const cleanups: Array<() => void> = []
const artifact = Schema.decodeUnknownSync(WorkReview.Binding)({
  artifactID: "work-artifact",
  artifactRevision: "a".repeat(64),
})
const nextArtifact = Schema.decodeUnknownSync(WorkReview.Binding)({
  artifactID: "next-work-artifact",
  artifactRevision: "b".repeat(64),
})
const actions = [
  ["submit", "Submit for review", "提交审阅"],
  ["request_changes", "Request changes", "请求修改"],
  ["respond", "Respond", "回应审阅"],
  ["re_review", "Re-review", "重新审阅"],
  ["approve", "Approve", "批准"],
  ["reopen", "Reopen", "重新打开"],
] as const
const states = [
  ["open", "Open", "待审阅"],
  ["fix_requested", "Changes requested", "已请求修改"],
  ["responded", "Responded", "已回应"],
  ["resolved", "Resolved", "已解决"],
] as const

function ready(state: WorkReview.State = "open") {
  return new WorkReview.Ready({
    status: "ready",
    review: new WorkReview.Review({
      contractVersion: 1,
      state,
      artifactID: artifact.artifactID,
      artifactRevision: artifact.artifactRevision,
      revision: 7,
      updatedAt: 1_700_000_000_000,
    }),
    artifact,
    current: true,
  })
}

function mount(input: Partial<WorkReviewPanel.Props> = {}, locale: Locale = "en") {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const calls = { actions: [] as WorkReview.Command["action"][], refreshes: 0, closes: 0 }
  const [props, setProps] = createStore<WorkReviewPanel.Props>({
    read: new WorkReview.None({ status: "none" }),
    loading: false,
    actions: [],
    onAction: (action) => calls.actions.push(action),
    onRefresh: () => {
      calls.refreshes += 1
    },
    onClose: () => {
      calls.closes += 1
    },
    ...input,
  })
  // Exercise the real language provider without sharing persisted locale state.
  const storage = new Map<string, string>()
  const dispose = render(
    () => (
      <PlatformProvider
        value={{
          platform: "desktop",
          openDirectoryPickerDialog: async () => null,
          openLink() {},
          restart: async () => {},
          back() {},
          forward() {},
          notify: async () => {},
          storage: () => ({
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => {
              storage.set(key, value)
            },
            removeItem: (key) => {
              storage.delete(key)
            },
          }),
        }}
      >
        <LanguageProvider locale={locale}>
          <WorkReviewPanel.Panel {...props} />
        </LanguageProvider>
      </PlatformProvider>
    ),
    container,
  )
  cleanups.push(() => {
    dispose()
    container.remove()
  })
  return { container, calls, props, setProps }
}

function element<T extends HTMLElement = HTMLElement>(container: HTMLElement, selector: string): T {
  const found = container.querySelector<T>(selector)
  if (!found) throw new Error(`Expected rendered element: ${selector}`)
  return found
}

function button(container: HTMLElement, action: WorkReview.Command["action"] | "refresh" | "close") {
  return element<HTMLButtonElement>(container, `button[data-action="work-review-${action}"]`)
}

function field(container: HTMLElement, name: string) {
  return element(container, `[data-field="${name}"]`)
}

afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
})

describe("WorkReviewPanel presentation", () => {
  test("an absent review without an artifact explains applying first", () => {
    const fixture = mount()
    const region = element(fixture.container, '[data-component="work-review-panel"]')
    expect(region.getAttribute("role")).toBe("region")
    expect(region.getAttribute("data-review-status")).toBe("none")
    expect(region.getAttribute("aria-busy")).toBe("false")
    expect(document.getElementById(region.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Work review")
    expect(element(fixture.container, '[data-slot="empty"]').textContent).toBe(
      "Apply an artifact to the project before submitting it for review.",
    )
    expect(fixture.container.querySelector('[data-field], [data-slot="actions"]')).toBeNull()
    expect(fixture.container.querySelector("form, textarea, input, [contenteditable], [autofocus]")).toBeNull()
    expect(fixture.calls).toEqual({ actions: [], refreshes: 0, closes: 0 })
  })

  test("an applied artifact can be submitted before the first review without inventing a revision", () => {
    const fixture = mount({ read: new WorkReview.None({ status: "none", artifact }), actions: ["submit"] })
    expect(field(fixture.container, "current-artifact-id").textContent).toBe(artifact.artifactID)
    expect(field(fixture.container, "current-artifact-revision").textContent).toBe(artifact.artifactRevision)
    expect(fixture.container.querySelector('[data-field="review-revision"]')).toBeNull()
    expect(fixture.container.querySelector('[data-field="reviewed-artifact-id"]')).toBeNull()
    expect(element(fixture.container, '[data-slot="empty"]').textContent).toBe(
      "No review yet. Submit the current artifact for review.",
    )
    expect(button(fixture.container, "submit").disabled).toBe(false)
    button(fixture.container, "submit").click()
    expect(fixture.calls.actions).toEqual(["submit"])
    expect(fixture.props.read?.status).toBe("none")
    expect(fixture.container.querySelector('[data-slot="selected-action"]')).toBeNull()
  })

  test("initial loading does not claim that a review is absent", () => {
    const fixture = mount({ read: undefined, loading: true, actions: ["submit"] })
    const region = element(fixture.container, '[data-component="work-review-panel"]')
    expect(region.hasAttribute("data-review-status")).toBe(false)
    expect(region.getAttribute("aria-busy")).toBe("true")
    expect(element(fixture.container, '[role="status"]').getAttribute("aria-live")).toBe("polite")
    expect(element(fixture.container, '[data-slot="progress"]').textContent).toBe("Loading review…")
    expect(fixture.container.querySelector('[data-slot="empty"], [data-field], [data-slot="actions"]')).toBeNull()
    expect(button(fixture.container, "refresh").disabled).toBe(true)
    expect(button(fixture.container, "close").disabled).toBe(false)
  })

  test.each(states)("renders the canonical %s state and both artifact bindings", (state, label) => {
    const fixture = mount({ read: ready(state) })
    expect(element(fixture.container, '[data-component="work-review-panel"]').getAttribute("data-review-status")).toBe(
      "ready",
    )
    expect(element(fixture.container, '[data-slot="review-state"]').textContent).toBe(label)
    expect(element(fixture.container, '[data-slot="review-state"]').getAttribute("data-state")).toBe(state)
    expect(field(fixture.container, "current-artifact-id").textContent).toBe(artifact.artifactID)
    expect(field(fixture.container, "current-artifact-revision").textContent).toBe(artifact.artifactRevision)
    expect(field(fixture.container, "reviewed-artifact-id").textContent).toBe(artifact.artifactID)
    expect(field(fixture.container, "reviewed-artifact-revision").textContent).toBe(artifact.artifactRevision)
    expect(field(fixture.container, "review-revision").textContent).toBe("7")
    expect(fixture.container.querySelector('[data-slot="stale"]')).toBeNull()
    expect(fixture.container.querySelector('[data-slot="approved"]') !== null).toBe(state === "resolved")
    expect(fixture.container.querySelector('[data-slot="actions"]')).toBeNull()
  })

  test.each(states)("a stale %s review preserves history without approving the current artifact", (state, label) => {
    const fixture = mount({
      read: new WorkReview.Ready({ ...ready(state), artifact: nextArtifact, current: false }),
    })
    expect(element(fixture.container, '[data-slot="review-state"]').textContent).toBe(label)
    expect(field(fixture.container, "current-artifact-id").textContent).toBe(nextArtifact.artifactID)
    expect(field(fixture.container, "current-artifact-revision").textContent).toBe(nextArtifact.artifactRevision)
    expect(field(fixture.container, "reviewed-artifact-id").textContent).toBe(artifact.artifactID)
    expect(field(fixture.container, "reviewed-artifact-revision").textContent).toBe(artifact.artifactRevision)
    expect(field(fixture.container, "review-revision").textContent).toBe("7")
    expect(element(fixture.container, '[data-slot="stale"]').textContent).toBe(
      "This review refers to an earlier artifact and does not approve the current artifact.",
    )
    expect(fixture.container.querySelector('[data-slot="approved"]')).toBeNull()
  })

  test("read replacements update fields and remove review-only details when the controller returns none", () => {
    const fixture = mount({ read: ready("resolved"), actions: ["reopen"] })
    fixture.setProps("read", new WorkReview.Ready({ ...ready("resolved"), artifact: nextArtifact, current: false }))
    expect(field(fixture.container, "current-artifact-revision").textContent).toBe(nextArtifact.artifactRevision)
    expect(fixture.container.querySelector('[data-slot="approved"]')).toBeNull()
    fixture.setProps("read", new WorkReview.None({ status: "none", artifact: nextArtifact }))
    fixture.setProps("actions", ["submit"])
    expect(field(fixture.container, "current-artifact-id").textContent).toBe(nextArtifact.artifactID)
    expect(fixture.container.querySelector('[data-field="review-revision"], [data-slot="review-state"]')).toBeNull()
    expect(fixture.container.querySelector('[data-slot="stale"], [data-action="work-review-reopen"]')).toBeNull()
    expect(button(fixture.container, "submit").disabled).toBe(false)
    expect(fixture.calls).toEqual({ actions: [], refreshes: 0, closes: 0 })
  })

  test.each([
    ["corrupt_review", "The saved review data is invalid. Refresh after the review data has been repaired."],
    ["artifact_missing", "The current artifact is missing. Apply an artifact, then refresh the review."],
    ["artifact_unavailable", "The current artifact cannot be read. Check its availability, then refresh the review."],
  ] as const)("explains %s and exposes no write actions", (reason, message) => {
    const fixture = mount({
      read: new WorkReview.Unavailable({ status: "unavailable", reason, review: ready().review }),
      actions: actions.map((entry) => entry[0]),
      selectedAction: "approve",
    })
    expect(element(fixture.container, '[data-component="work-review-panel"]').getAttribute("data-review-status")).toBe(
      "unavailable",
    )
    expect(element(fixture.container, '[data-slot="unavailable"]').getAttribute("role")).toBe("alert")
    expect(element(fixture.container, '[data-slot="unavailable"]').textContent).toBe(message)
    expect(fixture.container.querySelector('[data-slot="actions"], [data-slot="approved"]')).toBeNull()
    expect(fixture.container.querySelectorAll("button").length).toBe(2)
    expect(element(fixture.container, '[data-slot="selected-action"]').textContent).toBe("Selected action: Approve")
    expect(button(fixture.container, "refresh").disabled).toBe(false)
    button(fixture.container, "refresh").click()
    expect(fixture.calls).toEqual({ actions: [], refreshes: 1, closes: 0 })
  })
})

describe("WorkReviewPanel controlled actions", () => {
  test.each(actions)("renders and emits the supplied %s command without changing the review", (action, label) => {
    const read = ready()
    const fixture = mount({ read, actions: [action] })
    const control = button(fixture.container, action)
    expect(control.textContent?.trim()).toBe(label)
    expect(control.getAttribute("data-component")).toBe("button-v2")
    expect(control.type).toBe("button")
    expect(control.disabled).toBe(false)
    expect(control.tabIndex).toBe(0)
    control.focus()
    expect(document.activeElement).toBe(control)
    control.click()
    expect(fixture.calls.actions).toEqual([action])
    expect(fixture.props.read).toBe(read)
    expect(field(fixture.container, "review-revision").textContent).toBe("7")
  })

  test("uses only the supplied action subset and order rather than deriving a lifecycle", () => {
    const fixture = mount({ read: ready(), actions: ["respond", "re_review"] })
    expect(
      Array.from(fixture.container.querySelectorAll('[data-slot="actions"] button')).map((control) =>
        control.getAttribute("data-action"),
      ),
    ).toEqual(["work-review-respond", "work-review-re_review"])
    expect(fixture.container.querySelector('[data-action="work-review-approve"]')).toBeNull()
    fixture.setProps("actions", [])
    expect(fixture.container.querySelector('[data-slot="actions"]')).toBeNull()
  })

  test.each(["loading", "pending", "disabled"] as const)("%s disables writes and refresh, but not close", (mode) => {
    const fixture = mount({
      read: ready(),
      actions: ["approve", "request_changes"],
      loading: mode === "loading",
      pending: mode === "pending" ? "approve" : undefined,
      disabled: mode === "disabled",
    })
    for (const action of ["approve", "request_changes", "refresh"] as const) {
      expect(button(fixture.container, action).disabled).toBe(true)
      button(fixture.container, action).click()
    }
    expect(element(fixture.container, '[data-component="work-review-panel"]').getAttribute("aria-busy")).toBe(
      String(mode !== "disabled"),
    )
    expect(button(fixture.container, "close").disabled).toBe(false)
    button(fixture.container, "close").click()
    expect(fixture.calls).toEqual({ actions: [], refreshes: 0, closes: 1 })
    expect(field(fixture.container, "review-revision").textContent).toBe("7")
  })

  test("pending progress is localized and does not replace the last confirmed revision", () => {
    const fixture = mount({ read: ready(), actions: ["approve"], pending: "approve", selectedAction: "approve" })
    expect(element(fixture.container, '[data-slot="progress"]').textContent).toBe("Saving: Approve…")
    expect(button(fixture.container, "approve").getAttribute("aria-busy")).toBe("true")
    expect(element(fixture.container, '[role="status"]').getAttribute("aria-live")).toBe("polite")
    expect(element(fixture.container, '[data-slot="review-state"]').textContent).toBe("Open")
    expect(field(fixture.container, "review-revision").textContent).toBe("7")
    fixture.setProps("pending", undefined)
    expect(button(fixture.container, "approve").disabled).toBe(false)
    expect(fixture.container.querySelector('[data-slot="progress"]')).toBeNull()
  })

  test("selection remains controlled and survives a failed action even when it is no longer offered", () => {
    const fixture = mount({ read: ready(), actions: ["approve", "request_changes"] })
    button(fixture.container, "request_changes").click()
    expect(fixture.container.querySelector('[data-slot="selected-action"]')).toBeNull()
    fixture.setProps("selectedAction", "request_changes")
    const selected = button(fixture.container, "request_changes")
    expect(selected.getAttribute("data-selected")).toBe("true")
    expect(document.getElementById(selected.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Selected action: Request changes",
    )
    fixture.setProps("notice", { kind: "network", action: "request_changes" })
    fixture.setProps("actions", ["approve"])
    expect(fixture.container.querySelector('[data-action="work-review-request_changes"]')).toBeNull()
    expect(element(fixture.container, '[data-slot="selected-action"]').textContent).toBe(
      "Selected action: Request changes",
    )
    expect(fixture.calls.actions).toEqual(["request_changes"])
  })

  test("refresh and close dispatch only their own callbacks", () => {
    const fixture = mount({ read: ready(), actions: ["approve"] })
    button(fixture.container, "refresh").click()
    expect(fixture.calls).toEqual({ actions: [], refreshes: 1, closes: 0 })
    button(fixture.container, "close").click()
    expect(fixture.calls).toEqual({ actions: [], refreshes: 1, closes: 1 })
  })
})

describe("WorkReviewPanel safe notices", () => {
  test.each([
    ["read", "Could not load the review. Refresh to try again."],
    ["network", "The connection was interrupted. Refresh the review to check the result before trying again."],
    ["forbidden", "You do not have permission to access or update this review. Check access, then refresh."],
    ["conflict", "The review or artifact has changed. Refresh before trying again."],
    ["invalid", "This review action is invalid. Refresh and choose an available action."],
    [
      "committed",
      "The action was saved, but the latest review could not be confirmed. Refresh before taking another action.",
    ],
  ] as const)("%s renders safe localized text, not raw diagnostics", (kind, message) => {
    const notice = {
      kind,
      action: "approve" as const,
      message: "/private/workspace/secret-review.json",
      stack: "Error: private-secret\n    at backend (/private/server.ts:42:1)",
      error: { payload: "<script>private-secret()</script>", token: "private-token" },
    }
    const fixture = mount({ read: ready("resolved"), notice, selectedAction: "request_changes" })
    const alert = element(fixture.container, '[data-slot="notice"]')
    expect(alert.getAttribute("role")).toBe("alert")
    expect(alert.textContent).toBe(message)
    expect(element(fixture.container, '[data-slot="selected-action"]').textContent).toBe(
      "Selected action: Request changes",
    )
    expect(fixture.container.textContent).not.toMatch(/private|server\.ts|work\.review\./)
    expect(fixture.container.querySelector('script, [data-slot="approved"]')).toBeNull()
    expect(fixture.calls).toEqual({ actions: [], refreshes: 0, closes: 0 })
  })

  test("a committed notice reports the saved revision without pretending a failed read confirmed it", () => {
    const fixture = mount({
      read: ready(),
      notice: { kind: "committed", action: "approve", committedRevision: 8 },
    })
    expect(element(fixture.container, '[data-slot="notice"]').textContent).toContain("Saved review revision: 8.")
    expect(field(fixture.container, "review-revision").textContent).toBe("7")
    expect(element(fixture.container, '[data-slot="review-state"]').textContent).toBe("Open")
    expect(element(fixture.container, '[data-slot="selected-action"]').textContent).toBe("Selected action: Approve")
    expect(fixture.container.querySelector('[data-slot="approved"]')).toBeNull()
    button(fixture.container, "refresh").click()
    expect(fixture.calls).toEqual({ actions: [], refreshes: 1, closes: 0 })
  })

  test("a failed initial read stays unavailable to writes without masquerading as no review", () => {
    const fixture = mount({ read: undefined, notice: { kind: "read" }, actions: ["submit"] })
    expect(element(fixture.container, '[data-component="work-review-panel"]').hasAttribute("data-review-status")).toBe(
      false,
    )
    expect(element(fixture.container, '[role="alert"]').textContent).toBe(
      "Could not load the review. Refresh to try again.",
    )
    expect(fixture.container.querySelector('[data-slot="empty"], [data-slot="actions"], [data-field]')).toBeNull()
    expect(button(fixture.container, "refresh").disabled).toBe(false)
  })
})

describe("WorkReviewPanel accessibility and localization", () => {
  test("mounting and refreshing display data never take focus from the composer", () => {
    const composer = document.createElement("textarea")
    composer.setAttribute("aria-label", "Composer")
    document.body.appendChild(composer)
    cleanups.push(() => composer.remove())
    composer.focus()
    const fixture = mount({ read: ready(), actions: ["approve"] })
    expect(document.activeElement).toBe(composer)
    fixture.setProps("loading", true)
    fixture.setProps("read", new WorkReview.Ready({ ...ready("resolved"), artifact: nextArtifact, current: false }))
    fixture.setProps("loading", false)
    fixture.setProps("notice", { kind: "conflict", action: "approve" })
    expect(document.activeElement).toBe(composer)
    expect(fixture.container.querySelector("[autofocus]")).toBeNull()
    expect(
      Array.from(fixture.container.querySelectorAll("svg")).every(
        (icon) => icon.getAttribute("aria-hidden") === "true",
      ),
    ).toBe(true)
  })

  test("long identifiers and full hashes stay visible as labelled text, not markup or title-only content", () => {
    const long = Schema.decodeUnknownSync(WorkReview.Binding)({
      artifactID: `${"long-artifact-".repeat(32)}<script>not-code()</script>`,
      artifactRevision: "0123456789abcdef".repeat(4),
    })
    const read = ready()
    const fixture = mount({
      read: new WorkReview.Ready({
        ...read,
        artifact: long,
        review: new WorkReview.Review({
          ...read.review,
          artifactID: long.artifactID,
          artifactRevision: long.artifactRevision,
        }),
      }),
    })
    for (const prefix of ["current", "reviewed"] as const) {
      expect(field(fixture.container, `${prefix}-artifact-id`).textContent).toBe(long.artifactID)
      expect(field(fixture.container, `${prefix}-artifact-revision`).textContent).toBe(long.artifactRevision)
    }
    for (const value of fixture.container.querySelectorAll<HTMLElement>("[data-field]")) {
      const label = document.getElementById(value.getAttribute("aria-labelledby") ?? "")
      expect(label?.tagName).toBe("DT")
      expect(label?.textContent?.length).toBeGreaterThan(0)
      expect(value.tagName).toBe("DD")
      expect(value.closest("dl")).not.toBeNull()
      expect(value.querySelector("code")?.textContent).toBe(value.textContent)
    }
    expect(fixture.container.querySelector("script")).toBeNull()
  })

  test.each(["en", "zh"] as const)("uses the actual %s language provider for controls and states", async (locale) => {
    await loadLocaleDict(locale)
    const fixture = mount({ read: ready(), actions: actions.map((entry) => entry[0]) }, locale)
    expect(element(fixture.container, "h2").textContent).toBe(locale === "en" ? "Work review" : "工作审阅")
    expect(button(fixture.container, "refresh").textContent?.trim()).toBe(
      locale === "en" ? "Refresh review" : "刷新审阅",
    )
    expect(button(fixture.container, "close").textContent?.trim()).toBe(locale === "en" ? "Close review" : "关闭审阅")
    for (const action of actions) {
      expect(button(fixture.container, action[0]).textContent?.trim()).toBe(action[locale === "en" ? 1 : 2])
    }
    for (const state of states) {
      fixture.setProps("read", ready(state[0]))
      expect(element(fixture.container, '[data-slot="review-state"]').textContent).toBe(state[locale === "en" ? 1 : 2])
    }
    expect(fixture.container.textContent).not.toContain("work.review.")
  })

  test("Chinese recovery notices, progress, selection, and artifact labels are not English fallbacks", async () => {
    await loadLocaleDict("zh")
    const fixture = mount(
      {
        read: new WorkReview.None({ status: "none", artifact }),
        actions: ["submit"],
        selectedAction: "submit",
      },
      "zh",
    )
    expect(element(fixture.container, '[data-slot="empty"]').textContent).toBe("尚无审阅。可提交当前产物进行审阅。")
    expect(element(fixture.container, '[data-slot="selected-action"]').textContent).toBe("已选操作：提交审阅")
    expect(fixture.container.textContent).toContain("当前产物哈希")
    fixture.setProps("pending", "submit")
    expect(element(fixture.container, '[data-slot="progress"]').textContent).toBe("正在保存：提交审阅…")
    fixture.setProps("pending", undefined)
    fixture.setProps("notice", { kind: "committed", action: "submit", committedRevision: 1 })
    expect(element(fixture.container, '[data-slot="notice"]').textContent).toContain(
      "操作已保存，但未能确认最新审阅。请先刷新，再执行其他操作。",
    )
    expect(element(fixture.container, '[data-slot="notice"]').textContent).toContain("已保存的审阅版本：1。")
    expect(fixture.container.textContent).not.toContain("work.review.")
  })
})
