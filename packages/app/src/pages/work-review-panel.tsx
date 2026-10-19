import type { WorkReview } from "@aigcfroge/schema/work-review"
import { ButtonV2 } from "@aigcfroge/ui/v2/button-v2"
import { Icon } from "@aigcfroge/ui/v2/icon"
import { For, Show, createUniqueId } from "solid-js"
import { useLanguage } from "@/context/language"
import "./work-review-panel.css"

export type Notice = {
  kind: "read" | "network" | "forbidden" | "conflict" | "invalid" | "committed"
  action?: WorkReview.Command["action"]
  committedRevision?: number
}

export type Props = {
  read?: WorkReview.ReadResult
  loading: boolean
  pending?: WorkReview.Command["action"]
  notice?: Notice
  actions: ReadonlyArray<WorkReview.Command["action"]>
  selectedAction?: WorkReview.Command["action"]
  disabled?: boolean
  onAction: (action: WorkReview.Command["action"]) => void
  onRefresh: () => void
  onClose: () => void
}

export function Panel(props: Props) {
  const language = useLanguage()
  const titleID = createUniqueId()
  const selectionID = createUniqueId()
  const busy = () => props.loading || props.pending !== undefined
  const disabled = () => !!props.disabled || busy()
  const selectedAction = () => props.selectedAction ?? props.notice?.action
  const ready = () => {
    const read = props.read
    return read?.status === "ready" ? read : undefined
  }
  const unavailable = () => {
    const read = props.read
    return read?.status === "unavailable" ? read : undefined
  }
  const artifact = () => {
    const read = props.read
    if (!read || read.status === "unavailable") return undefined
    return read.artifact
  }

  return (
    <section
      role="region"
      aria-labelledby={titleID}
      aria-busy={busy()}
      data-component="work-review-panel"
      data-review-status={props.read?.status}
    >
      <header data-slot="header">
        <div data-slot="heading">
          <Icon name="status" size="small" aria-hidden="true" />
          <h2 id={titleID}>{language.t("work.review.title")}</h2>
        </div>
        <div data-slot="toolbar">
          <ButtonV2
            type="button"
            variant="ghost"
            size="small"
            data-action="work-review-refresh"
            disabled={disabled()}
            onClick={() => props.onRefresh()}
          >
            {language.t("work.review.refresh")}
          </ButtonV2>
          <ButtonV2
            type="button"
            variant="ghost"
            size="small"
            icon="close"
            data-action="work-review-close"
            onClick={() => props.onClose()}
          >
            {language.t("work.review.close")}
          </ButtonV2>
        </div>
      </header>

      <div data-slot="status" role="status" aria-live="polite" aria-atomic="true">
        <Show
          when={props.pending}
          fallback={
            <Show when={props.loading}>
              <p data-slot="progress">{language.t("work.review.loading")}</p>
            </Show>
          }
        >
          {(action) => (
            <p data-slot="progress">
              {language.t("work.review.pending", { action: language.t(`work.review.action.${action()}`) })}
            </p>
          )}
        </Show>
        <Show when={props.read?.status === "none" && !busy()}>
          <p data-slot="empty">{language.t(artifact() ? "work.review.none.applied" : "work.review.none.empty")}</p>
        </Show>
        <Show when={ready()}>
          {(read) => (
            <>
              <p data-slot="review-state" data-state={read().review.state}>
                {language.t(`work.review.state.${read().review.state}`)}
              </p>
              <Show when={!read().current}>
                <p data-slot="stale">{language.t("work.review.stale")}</p>
              </Show>
              <Show when={read().current && read().review.state === "resolved" && !busy() && !props.notice}>
                <p data-slot="approved">{language.t("work.review.approved")}</p>
              </Show>
            </>
          )}
        </Show>
        <Show when={selectedAction()}>
          {(action) => (
            <p id={selectionID} data-slot="selected-action">
              {language.t("work.review.selectedAction", { action: language.t(`work.review.action.${action()}`) })}
            </p>
          )}
        </Show>
      </div>

      <Show when={artifact()}>
        {(binding) => (
          <dl data-slot="bindings">
            <Field
              name="current-artifact-id"
              label={language.t("work.review.field.currentArtifactID")}
              value={binding().artifactID}
            />
            <Field
              name="current-artifact-revision"
              label={language.t("work.review.field.currentArtifactRevision")}
              value={binding().artifactRevision}
            />
            <Show when={ready()}>
              {(read) => (
                <>
                  <Field
                    name="reviewed-artifact-id"
                    label={language.t("work.review.field.reviewedArtifactID")}
                    value={read().review.artifactID}
                  />
                  <Field
                    name="reviewed-artifact-revision"
                    label={language.t("work.review.field.reviewedArtifactRevision")}
                    value={read().review.artifactRevision}
                  />
                  <Field
                    name="review-revision"
                    label={language.t("work.review.field.reviewRevision")}
                    value={read().review.revision}
                  />
                </>
              )}
            </Show>
          </dl>
        )}
      </Show>

      <Show when={unavailable()}>
        {(read) => (
          <p data-slot="unavailable" role="alert">
            {language.t(`work.review.unavailable.${read().reason}`)}
          </p>
        )}
      </Show>
      <Show when={props.notice}>
        {(notice) => (
          <div data-slot="notice" data-kind={notice().kind} role="alert">
            <p>{language.t(`work.review.notice.${notice().kind}`)}</p>
            <Show when={notice().kind === "committed" ? notice().committedRevision : undefined}>
              {(revision) => <p>{language.t("work.review.notice.committedRevision", { revision: revision() })}</p>}
            </Show>
          </div>
        )}
      </Show>

      <Show when={props.read && props.read.status !== "unavailable" && props.actions.length > 0}>
        <div data-slot="actions">
          <For each={props.actions}>
            {(action) => (
              <ButtonV2
                type="button"
                variant={selectedAction() === action ? "neutral" : "ghost"}
                size="small"
                data-action={`work-review-${action}`}
                data-selected={selectedAction() === action || undefined}
                aria-describedby={selectedAction() === action ? selectionID : undefined}
                aria-busy={props.pending === action}
                disabled={disabled()}
                onClick={() => props.onAction(action)}
              >
                {language.t(`work.review.action.${action}`)}
              </ButtonV2>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

function Field(props: { name: string; label: string; value: string | number }) {
  const labelID = createUniqueId()
  return (
    <div data-slot="field">
      <dt id={labelID}>{props.label}</dt>
      <dd data-field={props.name} aria-labelledby={labelID}>
        <code>{props.value}</code>
      </dd>
    </div>
  )
}

export * as WorkReviewPanel from "./work-review-panel"
