import path from "node:path"
import { mkdir } from "node:fs/promises"
import { expect } from "bun:test"
import { TestLLM } from "@omnixa/ai/testing"
import { Agent } from "@omnixa/core/agent"
import { Model } from "@omnixa/core/model"
import { Provider } from "@omnixa/core/provider"
import { Session } from "@omnixa/core/session"
import { SessionInputResult } from "@omnixa/core/session/input-result"
import { SessionMessage } from "@omnixa/core/session/message"
import { Service } from "@omnixa/core/prompt-asset"
import { PromptAssetService } from "@omnixa/core/prompt-asset-service"
import { ProposePromptAssetTool } from "@omnixa/core/tool/propose-prompt-asset"
import { ApiNotFoundError, InvalidRequestError } from "@omnixa/protocol/errors"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { AbsolutePath } from "@omnixa/schema/schema"
import { Workspace } from "@omnixa/schema/workspace"
import {
  BaseRevision,
  Candidate,
  Info,
  InvalidEntry,
  PromptAsset,
  Revision,
  Summary,
  Template,
} from "@omnixa/schema/prompt-asset"
import { Hash } from "@omnixa/util/hash"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { initRepo } from "../../core/test/fixture/git"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../../core/test/lib/effect"
import { locationRefForRoute } from "../src/middleware/workspace-routing"
import { AssetHttpFixture } from "./fixture/asset-http"

const it = testEffect(Layer.empty)
const model = Model.Ref.make({ id: Model.ID.make("prompt-asset"), providerID: Provider.ID.make("test") })
const facts = Schema.Struct({
  relativePath: Schema.String,
  exists: Schema.Boolean,
  revision: BaseRevision,
  nameConflict: Schema.Boolean,
  pathConflict: Schema.Boolean,
})
const contextResponse = Schema.Struct({ data: Schema.Array(SessionMessage.Info) })
const promptResponse = Schema.Struct({ data: Schema.Struct({ id: SessionMessage.ID }) })
const listResponse = Schema.Struct({ assets: Schema.Array(Summary), invalid: Schema.Array(InvalidEntry) })
const selectedListResponse = Schema.Struct({
  assets: Schema.Array(Summary),
  invalid: Schema.Array(InvalidEntry),
  target: AssetPlacement.Target,
})
const decodeInput = Schema.decodeUnknownSync(ProposePromptAssetTool.Input)
const input = decodeInput({
  name: "review-prompt",
  description: "Review the saved template without automatic execution.",
  template: "Review {{CODE}} literally.\n",
})
const literalTemplate = "\uFEFF \tReview {{CODE}}, $ARGUMENTS, $HOME and 中文.\r\n\r\nKeep trailing space. \t\r\n"

const setup = (
  files: readonly { relativePath: string; content: string }[] = [],
  prepare?: (directory: string) => Promise<void>,
) =>
  AssetHttpFixture.setup({
    prefix: "omnixa-prompt-http-",
    assetDirectory: ".omnixa/prompts",
    model,
    files,
    prepare,
  }).pipe(
    Effect.map((fixture) => ({
      ...fixture,
      assets: Context.getOption(fixture.local, Service),
      assetService: Context.getOption(fixture.local, PromptAssetService.Service),
    })),
  )

it.live(
  "persists canonical Project Prompt inspection metadata from a real child Session without saving or sending the template",
  () =>
    withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const body = decodeInput({
          name: " Ｒｅｖｉｅｗ ",
          description: "Keep the literal Prompt in the current Project.",
          template: literalTemplate,
        })
        const candidate = Candidate.make({ ...body, relativePath: "Review.md" })
        const expected = Schema.encodeSync(PromptAsset.Inspection)(
          Schema.decodeUnknownSync(PromptAsset.Inspection)({
            relativePath: candidate.relativePath,
            exists: false,
            revision: null,
            nameConflict: false,
            pathConflict: false,
            target: { scope: "project", root: path.join(fixture.directory, ".omnixa/prompts") },
          }),
        )
        const session = yield* fixture.sessions.create({
          title: "Project Prompt proposal",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        })
        yield* fixture.llm.push(
          TestLLM.tool("propose-project", "propose_prompt_asset", body),
          TestLLM.text("Review the Project target before saving.", "project-review"),
        )
        const admitted = Schema.decodeUnknownSync(promptResponse)(
          yield* readBody(
            yield* fixture.request(`/api/session/${session.id}/prompt`, {
              directory,
              body: { text: "Propose a literal Prompt from this child Location." },
            }),
          ),
        )
        yield* awaitWithTimeout(fixture.llm.wait(2), "Project Prompt proposer did not finish", "10 seconds")
        yield* awaitInputCompletion(fixture, session.id, admitted.data.id, "Project proposal input did not complete")
        const history = Schema.decodeUnknownSync(contextResponse)(
          yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`, { directory })),
        ).data
        const proposed = proposal(history, "propose-project")
        expect(proposed.input).toEqual(Schema.encodeSync(ProposePromptAssetTool.Input)(body))
        expect(proposed.metadata).toEqual({ ...expected, truncated: false })
        Object.keys(PromptAsset.Inspection.fields).forEach((key) =>
          expect(Object.hasOwn(proposed.metadata ?? {}, key)).toBe(true),
        )
        const inspection = Schema.decodeUnknownSync(PromptAsset.Inspection)(proposed.metadata)
        expect(inspection).toBeInstanceOf(PromptAsset.Inspection)
        expect(inspection.target).toBeInstanceOf(AssetPlacement.Target)
        expect(Schema.encodeSync(PromptAsset.Inspection)(inspection)).toEqual(expected)
        expect(proposed.metadata).not.toHaveProperty("candidate")
        expect(proposed.metadata).not.toHaveProperty("input")
        expect(proposed.metadata).not.toHaveProperty("template")
        expect(
          yield* readInspection(
            yield* fixture.request(`/session/${session.id}/prompt-asset/inspect`, {
              directory,
              body: { candidate, scope: "project" },
            }),
          ),
        ).toEqual(inspection)
        expect((yield* fixture.sessions.get(session.id)).location).toEqual(session.location)
        expect(history.filter((message) => message.type === "user").map((message) => message.id)).toEqual([
          admitted.data.id,
        ])
        yield* Effect.forEach(
          [expected.target.root, path.join(directory, ".omnixa/prompts"), path.join(fixture.global.config, "prompts")],
          (root) =>
            Effect.gen(function* () {
              expect(yield* Effect.promise(() => Bun.file(path.join(root, candidate.relativePath)).exists())).toBe(
                false,
              )
            }),
        )
        expect(yield* fixture.llm.requests()).toHaveLength(2)
      }),
    ),
  30_000,
)

it.live(
  "persists Prompt facts through the real runner and round trips HTTP content before explicit Session consumption",
  () =>
    withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup()
        expect(Option.isSome(fixture.assets)).toBe(true)
        expect(Option.isSome(fixture.assetService)).toBe(true)
        const target = path.join(fixture.directory, ".omnixa/prompts/review-prompt.md")
        const session = yield* fixture.sessions.create({
          title: "Prompt review",
          mode: "chat",
          location: locationRefForRoute({ directory: fixture.directory }),
          agent: Agent.defaultID,
          model,
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
        })
        const other = yield* fixture.sessions.create({
          title: "Other Prompt Location",
          mode: "chat",
          location: locationRefForRoute({ directory: fixture.other }),
          agent: Agent.defaultID,
          model,
        })
        expect(
          Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/prompt-asset"))),
        ).toEqual({
          assets: [],
          invalid: [],
        })
        yield* fixture.llm.push(
          TestLLM.tool("propose-new", "propose_prompt_asset", input),
          TestLLM.text("Ready for review", "review"),
        )
        const first = Schema.decodeUnknownSync(promptResponse)(
          yield* readBody(
            yield* fixture.request(`/api/session/${session.id}/prompt`, {
              body: { text: "Propose the literal review Prompt" },
            }),
          ),
        )
        yield* awaitWithTimeout(fixture.llm.wait(2), "Prompt proposer did not finish", "10 seconds")
        yield* awaitInputCompletion(fixture, session.id, first.data.id, "Prompt proposal input did not complete")
        const proposed = proposal(
          Schema.decodeUnknownSync(contextResponse)(
            yield* readBody(yield* fixture.request(`/api/session/${session.id}/context`)),
          ).data,
          "propose-new",
        )
        expect(proposed.input).toEqual(input)
        expect(proposed.facts).toEqual({
          relativePath: "review-prompt.md",
          exists: false,
          revision: null,
          nameConflict: false,
          pathConflict: false,
        })
        expect(proposed.metadata).not.toHaveProperty("candidate")
        expect(proposed.metadata).not.toHaveProperty("input")
        expect(proposed.metadata).not.toHaveProperty("template")
        expect(proposed.metadata).toMatchObject({ target: { scope: "project", root: path.dirname(target) } })
        expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
        const candidate = Candidate.make({ ...input, relativePath: proposed.facts.relativePath })
        if (Option.isNone(fixture.assetService)) return yield* Effect.die(new Error("Prompt asset service is missing"))
        const legacy = yield* fixture.assetService.value.propose(candidate)
        expect(legacy).toEqual(proposed.facts)
        expect(legacy).not.toHaveProperty("target")
        expect(
          (yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
            body: { candidate, overwrite: false },
            authenticated: false,
          })).status,
        ).toBe(401)
        expect(
          (yield* fixture.request(`/session/${other.id}/prompt-asset/apply`, {
            body: { candidate, overwrite: false },
          })).status,
        ).toBe(409)
        expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
        const applied = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
              body: { candidate, overwrite: false },
            }),
          ),
        )
        expect(applied.template).toBe(Template.make("Review {{CODE}} literally.\n"))
        expect(applied.name).toBe(input.name)
        expect(applied.relativePath).toBe("review-prompt.md")
        expect(applied.revision).toBe(
          Revision.make(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))),
        )
        expect(
          Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/prompt-asset"))).assets,
        ).toContainEqual(Schema.decodeUnknownSync(Summary)(applied))
        const readback = Schema.decodeUnknownSync(Info)(
          yield* readBody(yield* fixture.request("/prompt-asset/content?path=review-prompt.md")),
        )
        expect(readback).toEqual(applied)
        expect(yield* fixture.llm.requests()).toHaveLength(2)
        expect(
          (yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
            body: { candidate, overwrite: true },
          })).status,
        ).toBe(409)
        expect(
          (yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
            body: { candidate, baseRevision: applied.revision, overwrite: false },
          })).status,
        ).toBe(409)
        expect(
          (yield* fixture.request(`/session/${session.id}/prompt-asset/delete`, {
            body: { relativePath: applied.relativePath, baseRevision: "0".repeat(64) },
          })).status,
        ).toBe(409)
        expect(
          (yield* fixture.request(`/session/${other.id}/prompt-asset/delete`, {
            body: { relativePath: applied.relativePath, baseRevision: applied.revision },
          })).status,
        ).toBe(409)
        expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(target).arrayBuffer())))).toBe(
          applied.revision,
        )
        yield* fixture.llm.push(TestLLM.text("Prompt used", "prompt-consumed"))
        const consumed = Schema.decodeUnknownSync(promptResponse)(
          yield* readBody(
            yield* fixture.request(`/api/session/${session.id}/prompt`, { body: { text: readback.template } }),
          ),
        )
        expect(consumed.data.id).not.toBe(first.data.id)
        yield* awaitWithTimeout(fixture.llm.wait(3), "Template did not reach the real runner", "10 seconds")
        yield* awaitInputCompletion(fixture, session.id, consumed.data.id, "Template input did not complete")
        expect(
          yield* SessionInputResult.read(fixture.database.db, { sessionID: session.id, inputID: consumed.data.id }),
        ).toMatchObject({ status: "completed", assistant: { content: [{ type: "text", text: "Prompt used" }] } })
        const used = (yield* fixture.llm.requests())[2]
        if (!used) return yield* Effect.die(new Error("Template request missing"))
        const userText = used.messages
          .filter((message) => message.role === "user")
          .at(-1)
          ?.content.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        expect(userText).toBe("Review {{CODE}} literally.\n")
        expect(
          (yield* fixture.request(`/session/${session.id}/prompt-asset/delete`, {
            body: { relativePath: applied.relativePath, baseRevision: applied.revision },
          })).status,
        ).toBe(200)
        expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
        expect((yield* fixture.request("/prompt-asset/content?path=review-prompt.md")).status).toBe(404)
        expect(
          Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/prompt-asset"))),
        ).toEqual({
          assets: [],
          invalid: [],
        })
      }),
    ),
)

it.live("keeps Prompt HTTP creation disabled under the existing asset flag", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const session = yield* fixture.sessions.create({
        title: "Disabled Prompt",
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const response = yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
        body: { candidate: Candidate.make({ ...input, relativePath: "review-prompt.md" }), overwrite: false },
      })
      expect(response.status).toBe(400)
      expect(
        Schema.decodeUnknownSync(InvalidRequestError)(yield* Effect.promise<unknown>(() => response.json())),
      ).toMatchObject({ kind: "disabled", message: "Prompt asset creation is not enabled" })
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".omnixa/prompts/review-prompt.md")).exists(),
        ),
      ).toBe(false)
    }),
  ),
)

it.live("reports Prompt name conflicts and rolls the attempted HTTP write back", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const content = "---\nkind: prompt\nname: review-prompt\ndescription: Existing prompt\n---\nExisting template."
      const fixture = yield* setup([{ relativePath: "other.md", content }])
      const session = yield* fixture.sessions.create({
        title: "Prompt conflict",
        location: locationRefForRoute({ directory: fixture.directory }),
      })
      const candidate = Candidate.make({ ...input, relativePath: "review-prompt.md" })
      const service = Option.getOrThrow(fixture.assetService)
      expect(yield* service.propose(candidate)).toMatchObject({ exists: false, revision: null, nameConflict: true })
      expect(
        (yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, { body: { candidate, overwrite: false } }))
          .status,
      ).toBe(409)
      expect(
        yield* Effect.promise(() =>
          Bun.file(path.join(fixture.directory, ".omnixa/prompts/review-prompt.md")).exists(),
        ),
      ).toBe(false)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(fixture.directory, ".omnixa/prompts/other.md")).text()),
      ).toBe(content)
      const inspected = yield* readInspection(
        yield* fixture.request(`/session/${session.id}/prompt-asset/inspect`, {
          body: { candidate, scope: "project" },
        }),
      )
      expect(inspected).toMatchObject({
        relativePath: candidate.relativePath,
        exists: false,
        revision: null,
        nameConflict: true,
        pathConflict: false,
        target: { scope: "project", root: path.join(fixture.directory, ".omnixa/prompts") },
      })
      expect(
        (yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
          body: { candidate, target: inspected.target, overwrite: false },
        })).status,
      ).toBe(409)
      expect(
        yield* Effect.promise(() => Bun.file(path.join(inspected.target.root, candidate.relativePath)).exists()),
      ).toBe(false)
      expect(yield* Effect.promise(() => Bun.file(path.join(inspected.target.root, "other.md")).text())).toBe(content)
      expect(yield* fixture.llm.requests()).toHaveLength(0)
    }),
  ),
)

it.live(
  "excludes empty and oversized external Prompt bodies from the valid catalog and returns typed content 404",
  () =>
    withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([
          {
            relativePath: "blank.md",
            content: "---\nkind: prompt\nname: blank\ndescription: Empty body\n---\n",
          },
          {
            relativePath: "oversized.md",
            content: "---\nkind: prompt\nname: oversized\ndescription: Oversized body\n---\n" + "x".repeat(100_001),
          },
          {
            relativePath: "valid.md",
            content: "---\nkind: prompt\nname: valid\ndescription: Valid body\n---\nUse actual source.\n",
          },
        ])
        const catalog = Schema.decodeUnknownSync(listResponse)(yield* readBody(yield* fixture.request("/prompt-asset")))
        expect(catalog.assets.map((asset) => asset.relativePath)).toEqual(["valid.md"])
        expect(catalog.invalid.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath))).toEqual([
          { relativePath: "blank.md", errorTag: "bad_template" },
          { relativePath: "oversized.md", errorTag: "bad_template" },
        ])
        for (const path of ["blank.md", "oversized.md"]) {
          const response = yield* fixture.request(`/prompt-asset/content?path=${path}`)
          expect(response.status).toBe(404)
          expect(
            Schema.decodeUnknownSync(ApiNotFoundError)(yield* Effect.promise<unknown>(() => response.json())),
          ).toMatchObject({ name: "NotFoundError", data: { message: `Prompt asset not found: ${path}` } })
        }
        expect(
          Schema.decodeUnknownSync(Info)(yield* readBody(yield* fixture.request("/prompt-asset/content?path=valid.md")))
            .template,
        ).toBe(Template.make("Use actual source.\n"))
        const selected = Schema.decodeUnknownSync(selectedListResponse)(
          yield* readBody(yield* fixture.request("/prompt-asset?scope=project")),
        )
        expect(selected.target).toEqual({
          scope: "project",
          root: AbsolutePath.make(path.join(fixture.directory, ".omnixa/prompts")),
        })
        expect(selected.assets).toEqual(catalog.assets)
        expect(selected.invalid).toEqual(catalog.invalid)
        yield* Effect.forEach(["blank.md", "oversized.md"], (relativePath) =>
          Effect.gen(function* () {
            yield* expectMissing(
              yield* fixture.request(`/prompt-asset/content?scope=project&path=${relativePath}`),
              relativePath,
            )
          }),
        )
        expect(
          Schema.decodeUnknownSync(Info)(
            yield* readBody(yield* fixture.request("/prompt-asset/content?scope=project&path=valid.md")),
          ),
        ).toMatchObject({ target: selected.target, template: Template.make("Use actual source.\n") })
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
)

it.live("keeps legacy Prompt name derivation, JSON omissions and unconditional delete", () =>
  withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const session = yield* fixture.sessions.create({
        title: "Legacy Prompt omissions",
        mode: "chat",
        location: locationRefForRoute({ directory: fixture.directory }),
        agent: Agent.defaultID,
        model,
      })
      const candidate = Candidate.make({
        name: input.name,
        description: input.description,
        template: input.template,
        relativePath: "legacy-path-is-derived-from-name.md",
      })
      expect(yield* Option.getOrThrow(fixture.assetService).propose(candidate)).toEqual({
        relativePath: "review-prompt.md",
        exists: false,
        revision: null,
        nameConflict: false,
        pathConflict: false,
      })
      const body = yield* readBody(
        yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
          body: { candidate, overwrite: false },
        }),
      )
      expect(body).not.toHaveProperty("target")
      const applied = Schema.decodeUnknownSync(Info)(body)
      expect(applied.relativePath).toBe("review-prompt.md")
      expect(applied.template).toBe(candidate.template)
      const file = path.join(fixture.directory, ".omnixa/prompts", applied.relativePath)
      const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
      expect(Hash.sha256(Buffer.from(bytes))).toBe(applied.revision)

      const listed = yield* readBody(yield* fixture.request("/prompt-asset"))
      expect(listed).not.toHaveProperty("target")
      expect(Schema.decodeUnknownSync(listResponse)(listed).assets).toEqual([
        Schema.decodeUnknownSync(Summary)(applied),
      ])
      const content = yield* readBody(yield* fixture.request("/prompt-asset/content?path=review-prompt.md"))
      expect(content).not.toHaveProperty("target")
      expect(content).toEqual(body)

      expect(
        (yield* fixture.request(`/session/${session.id}/prompt-asset/delete`, {
          body: { relativePath: applied.relativePath, baseRevision: "0".repeat(64) },
        })).status,
      ).toBe(409)
      expect(yield* Effect.promise(() => Bun.file(file).arrayBuffer())).toEqual(bytes)
      expect(
        (yield* fixture.request(`/session/${session.id}/prompt-asset/delete`, {
          body: { relativePath: applied.relativePath },
        })).status,
      ).toBe(200)
      expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
      expect(
        (yield* fixture.request(`/session/${session.id}/prompt-asset/delete`, {
          body: { relativePath: applied.relativePath, baseRevision: applied.revision },
        })).status,
      ).toBe(200)
      const recreated = Schema.decodeUnknownSync(Info)(
        yield* readBody(
          yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
            body: { candidate, overwrite: false, baseRevision: null },
          }),
        ),
      )
      expect(recreated.relativePath).toBe(applied.relativePath)
      expect(recreated).not.toHaveProperty("target")
      expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(file).arrayBuffer())))).toBe(
        recreated.revision,
      )
      expect(
        (yield* fixture.request(`/session/${session.id}/prompt-asset/delete`, {
          body: { relativePath: applied.relativePath, baseRevision: null },
        })).status,
      ).toBe(200)
      expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
      expect(
        (yield* fixture.request(`/session/${session.id}/prompt-asset/delete`, {
          body: { relativePath: applied.relativePath, baseRevision: null },
        })).status,
      ).toBe(200)
      expect(yield* fixture.sessions.context(session.id)).toEqual([])
      expect(yield* fixture.llm.requests()).toHaveLength(0)
    }),
  ),
)

it.live(
  "round trips exact selected Prompt templates and consumes only the explicitly submitted owner in the original Session",
  () =>
    withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const session = yield* fixture.sessions.create({
          title: "Selected Prompt owners",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
        })
        const owners = [
          { scope: "project", root: path.join(fixture.directory, ".omnixa/prompts") },
          { scope: "global", root: path.join(fixture.global.config, "prompts") },
          { scope: "location", root: path.join(directory, ".omnixa/prompts") },
        ] as const
        const saved = yield* Effect.forEach(owners, (owner) =>
          Effect.gen(function* () {
            const candidate = Schema.decodeUnknownSync(Candidate)({
              ...input,
              template: literalTemplate + "Selected " + owner.scope + ".\r\n",
              relativePath: "review-prompt.md",
            })
            const file = path.join(owner.root, candidate.relativePath)
            expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
            const inspected = yield* readInspection(
              yield* fixture.request(`/session/${session.id}/prompt-asset/inspect`, {
                directory,
                body: { candidate, scope: owner.scope },
              }),
            )
            expect(inspected).toEqual({
              relativePath: candidate.relativePath,
              exists: false,
              revision: null,
              nameConflict: false,
              pathConflict: false,
              target: Schema.decodeUnknownSync(AssetPlacement.Target)(owner),
            })
            expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
            const appliedBody = yield* readBody(
              yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
                directory,
                body: { candidate, target: inspected.target, overwrite: false },
              }),
            )
            expect(appliedBody).toMatchObject({ ...candidate, kind: "prompt", target: owner })
            const applied = Schema.decodeUnknownSync(Info)(appliedBody)
            expect(appliedBody).toEqual({ ...candidate, kind: "prompt", target: owner, revision: applied.revision })
            const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
            expect(Hash.sha256(Buffer.from(bytes))).toBe(applied.revision)
            const listedBody = yield* readBody(
              yield* fixture.request(`/prompt-asset?scope=${owner.scope}&search=REVIEW`, { directory }),
            )
            expect(listedBody).toHaveProperty("target", owner)
            const listed = Schema.decodeUnknownSync(selectedListResponse)(listedBody)
            expect(listed.assets).toEqual([
              Summary.make({
                kind: "prompt",
                name: candidate.name,
                description: candidate.description,
                relativePath: candidate.relativePath,
                revision: applied.revision,
              }),
            ])
            expect(listed.invalid).toEqual([])
            expect(listed.assets[0]).not.toHaveProperty("target")
            expect(listedBody).toEqual({ assets: listed.assets, invalid: [], target: owner })
            const contentBody = yield* readBody(
              yield* fixture.request(
                `/prompt-asset/content?scope=${owner.scope}&path=${encodeURIComponent(candidate.relativePath)}`,
                { directory },
              ),
            )
            expect(contentBody).toHaveProperty("target", owner)
            expect(Schema.decodeUnknownSync(Info)(contentBody)).toEqual(applied)
            expect(
              yield* readInspection(
                yield* fixture.request(`/session/${session.id}/prompt-asset/inspect`, {
                  directory,
                  body: { candidate, scope: owner.scope },
                }),
              ),
            ).toEqual({ ...inspected, exists: true, revision: applied.revision })
            expect(yield* Effect.promise(() => Bun.file(file).arrayBuffer())).toEqual(bytes)
            expect(
              yield* readBody(
                yield* fixture.request(`/prompt-asset?scope=${owner.scope}&search=unrelated`, { directory }),
              ),
            ).toEqual({ assets: [], invalid: [], target: owner })
            return applied
          }),
        )
        const legacyList = yield* readBody(yield* fixture.request("/prompt-asset", { directory }))
        expect(legacyList).not.toHaveProperty("target")
        expect(Schema.decodeUnknownSync(listResponse)(legacyList).assets).toHaveLength(1)
        const legacyContent = yield* readBody(
          yield* fixture.request("/prompt-asset/content?path=review-prompt.md", { directory }),
        )
        expect(legacyContent).not.toHaveProperty("target")
        expect(legacyContent).toMatchObject({ template: literalTemplate + "Selected location.\r\n" })
        expect((yield* fixture.sessions.get(session.id)).location).toEqual(session.location)
        expect(yield* fixture.sessions.context(session.id)).toEqual([])
        expect(yield* fixture.llm.requests()).toHaveLength(0)

        const reviewed = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request("/prompt-asset/content?scope=global&path=review-prompt.md", { directory }),
          ),
        )
        expect(reviewed.target).toEqual({
          scope: "global",
          root: AbsolutePath.make(path.join(fixture.global.config, "prompts")),
        })
        expect(reviewed.template).toBe(Template.make(literalTemplate + "Selected global.\r\n"))

        yield* fixture.llm.push(TestLLM.text("Selected Prompt used", "selected-prompt-consumed"))
        const consumed = Schema.decodeUnknownSync(promptResponse)(
          yield* readBody(
            yield* fixture.request(`/api/session/${session.id}/prompt`, {
              directory,
              body: { text: reviewed.template },
            }),
          ),
        )
        yield* awaitWithTimeout(fixture.llm.wait(1), "Selected template did not reach the real runner", "10 seconds")
        yield* awaitInputCompletion(fixture, session.id, consumed.data.id, "Selected template input did not complete")
        expect(
          yield* SessionInputResult.read(fixture.database.db, { sessionID: session.id, inputID: consumed.data.id }),
        ).toMatchObject({
          status: "completed",
          assistant: { content: [{ type: "text", text: "Selected Prompt used" }] },
        })
        const request = (yield* fixture.llm.requests())[0]
        if (!request) return yield* Effect.die(new Error("Selected Prompt provider request missing"))

        expect(
          request.messages
            .filter((message) => message.role === "user")
            .at(-1)
            ?.content.filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
        ).toBe(literalTemplate + "Selected global.\r\n")

        yield* Effect.forEach(saved, (applied) =>
          Effect.gen(function* () {
            const target = applied.target
            if (!target) return yield* Effect.die(new Error("Selected Prompt response lost its target"))
            expect(
              (yield* fixture.request(`/session/${session.id}/prompt-asset/delete`, {
                directory,
                body: { relativePath: applied.relativePath, target, baseRevision: applied.revision },
              })).status,
            ).toBe(200)
            expect(yield* Effect.promise(() => Bun.file(path.join(target.root, applied.relativePath)).exists())).toBe(
              false,
            )
            yield* expectMissing(
              yield* fixture.request(`/prompt-asset/content?scope=${target.scope}&path=review-prompt.md`, {
                directory,
              }),
              applied.relativePath,
            )
          }),
        )
        expect((yield* fixture.sessions.get(session.id)).location).toEqual(session.location)
        expect(yield* fixture.llm.requests()).toHaveLength(1)
      }),
    ),
  30_000,
)

it.live(
  "keeps Prompt inspection and mutations bound to the original authenticated Session Location",
  () =>
    withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const other = path.join(fixture.directory, "packages/second")
        const session = yield* fixture.sessions.create({
          title: "Prompt route owner",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
        })
        const workspaceSession = yield* fixture.sessions.create({
          title: "Prompt workspace owner",
          mode: "chat",
          location: locationRefForRoute({ directory, workspaceID: Workspace.ID.create() }),
          agent: Agent.defaultID,
          model,
        })
        const candidate = Candidate.make({ ...input, relativePath: "review-prompt.md" })
        const target = { scope: "project", root: path.join(fixture.directory, ".omnixa/prompts") }
        yield* Effect.forEach(
          [
            { endpoint: "inspect", body: { candidate, scope: "project" } },
            { endpoint: "apply", body: { candidate, target, overwrite: false } },
            { endpoint: "delete", body: { relativePath: candidate.relativePath, target } },
          ],
          (operation) =>
            Effect.gen(function* () {
              expect(
                (yield* fixture.request(`/session/${session.id}/prompt-asset/${operation.endpoint}`, {
                  directory,
                  authenticated: false,
                  body: operation.body,
                })).status,
              ).toBe(401)
              const misplaced = yield* fixture.request(`/session/${session.id}/prompt-asset/${operation.endpoint}`, {
                directory: other,
                body: operation.body,
              })
              expect(misplaced.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => misplaced.json())).toMatchObject({
                _tag: "ConflictError",
                resource: session.id,
              })
              const missingWorkspace = yield* fixture.request(
                `/session/${workspaceSession.id}/prompt-asset/${operation.endpoint}`,
                {
                  directory,
                  body: operation.body,
                },
              )
              expect(missingWorkspace.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => missingWorkspace.json())).toMatchObject({
                _tag: "ConflictError",
                resource: workspaceSession.id,
              })
              const unknownWorkspaceID = Workspace.ID.create()
              const unknownWorkspace = yield* fixture.request(
                `/session/${workspaceSession.id}/prompt-asset/${operation.endpoint}?workspace=${unknownWorkspaceID}`,
                {
                  directory,
                  body: operation.body,
                },
              )
              expect(unknownWorkspace.status).toBe(404)
              expect(
                Schema.decodeUnknownSync(ApiNotFoundError)(
                  yield* Effect.promise<unknown>(() => unknownWorkspace.json()),
                ),
              ).toMatchObject({
                name: "NotFoundError",
                data: { message: `Workspace not found: ${unknownWorkspaceID}` },
              })
              const directoryAsSession = yield* fixture.request(
                // Reach Session ID validation without exceeding the router's parameter limit.
                `/session/${encodeURIComponent(path.parse(directory).root)}/prompt-asset/${operation.endpoint}`,
                {
                  directory,
                  body: operation.body,
                },
              )
              expect(directoryAsSession.status).toBe(400)
            }),
        )
        yield* Effect.forEach(
          [
            { candidate, scope: "workspace" },
            { candidate },
            { scope: "project" },
            { candidate: { name: candidate.name }, scope: "project" },
            { candidate: { ...candidate, template: "" }, scope: "project" },
            { candidate: { ...candidate, template: "x".repeat(100_001) }, scope: "project" },
            { candidate: { ...candidate, relativePath: "../escape.md" }, scope: "project" },
            { candidate: { ...candidate, relativePath: "different.md" }, scope: "project" },
          ],
          (body) =>
            Effect.gen(function* () {
              expect(
                (yield* fixture.request(`/session/${session.id}/prompt-asset/inspect`, { directory, body })).status,
              ).toBe(400)
            }),
        )
        yield* Effect.forEach(
          [null, {}, { scope: "project" }, { scope: "workspace", root: target.root }],
          (invalidTarget) =>
            Effect.forEach(
              [
                { endpoint: "apply", body: { candidate, target: invalidTarget, overwrite: false } },
                { endpoint: "delete", body: { relativePath: candidate.relativePath, target: invalidTarget } },
              ],
              (operation) =>
                Effect.gen(function* () {
                  expect(
                    (yield* fixture.request(`/session/${session.id}/prompt-asset/${operation.endpoint}`, {
                      directory,
                      body: operation.body,
                    })).status,
                  ).toBe(400)
                }),
            ),
        )
        yield* Effect.forEach(["different.md", "../escape.md"], (relativePath) =>
          Effect.gen(function* () {
            const invalid = yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
              directory,
              body: { candidate: { ...candidate, relativePath }, target, overwrite: false },
            })
            expect(invalid.status).toBe(400)
            expect(yield* Effect.promise<unknown>(() => invalid.json())).toMatchObject({
              _tag: "InvalidRequestError",
              kind: "invalid_candidate",
            })
          }),
        )
        yield* Effect.forEach(
          ["/prompt-asset?scope=workspace", "/prompt-asset/content?scope=workspace&path=review-prompt.md"],
          (route) =>
            Effect.gen(function* () {
              expect((yield* fixture.request(route, { directory })).status).toBe(400)
            }),
        )
        expect(
          (yield* fixture.request("/prompt-asset?scope=project", { directory, authenticated: false })).status,
        ).toBe(401)
        expect(
          (yield* fixture.request("/prompt-asset/content?scope=project&path=review-prompt.md", {
            directory,
            authenticated: false,
          })).status,
        ).toBe(401)
        yield* Effect.forEach(
          [target.root, path.join(directory, ".omnixa/prompts"), path.join(fixture.global.config, "prompts")],
          (root) =>
            Effect.gen(function* () {
              expect(yield* Effect.promise(() => Bun.file(path.join(root, candidate.relativePath)).exists())).toBe(
                false,
              )
            }),
        )
        expect((yield* fixture.sessions.get(session.id)).location).toEqual(session.location)
        expect((yield* fixture.sessions.get(workspaceSession.id)).location).toEqual(workspaceSession.location)
        expect(yield* fixture.sessions.context(session.id)).toEqual([])
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)

it.live(
  "rejects mismatched Prompt target scope and root before revision comparison",
  () =>
    withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const session = yield* fixture.sessions.create({
          title: "Prompt target mismatch",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
        })
        const candidate = Candidate.make({ ...input, relativePath: "review-prompt.md" })
        const root = path.join(fixture.directory, ".omnixa/prompts")
        yield* Effect.forEach(
          [
            { scope: "global", root },
            { scope: "location", root },
            { scope: "project", root: path.join(directory, ".omnixa/prompts") },
            { scope: "project", root: path.join(fixture.other, ".omnixa/prompts") },
            { scope: "project", root: path.join(fixture.directory, ".omnixa/skills") },
          ],
          (target) =>
            Effect.forEach(
              [
                { endpoint: "apply", body: { candidate, target, baseRevision: "0".repeat(64), overwrite: true } },
                {
                  endpoint: "delete",
                  body: { relativePath: candidate.relativePath, target, baseRevision: "0".repeat(64) },
                },
              ],
              (operation) =>
                Effect.gen(function* () {
                  const response = yield* fixture.request(`/session/${session.id}/prompt-asset/${operation.endpoint}`, {
                    directory,
                    body: operation.body,
                  })
                  expect(response.status).toBe(400)
                  expect(yield* Effect.promise<unknown>(() => response.json())).toMatchObject({
                    _tag: "InvalidRequestError",
                    field: "target",
                    kind: "target_mismatch",
                  })
                }),
            ),
        )
        yield* Effect.forEach(
          [root, path.join(directory, ".omnixa/prompts"), path.join(fixture.global.config, "prompts")],
          (owner) =>
            Effect.gen(function* () {
              expect(yield* Effect.promise(() => Bun.file(path.join(owner, candidate.relativePath)).exists())).toBe(
                false,
              )
            }),
        )
        expect(yield* fixture.sessions.context(session.id)).toEqual([])
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)

it.live(
  "uses strict selected Prompt revisions across Session Locations without changing legacy delete",
  () =>
    withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "true" }, () =>
      Effect.gen(function* () {
        const fixture = yield* setup([], prepareProject)
        const sessions = yield* Effect.forEach(["first", "second"], (name) =>
          fixture.sessions.create({
            title: `Prompt CAS ${name}`,
            mode: "chat",
            location: locationRefForRoute({ directory: path.join(fixture.directory, "packages", name) }),
            agent: Agent.defaultID,
            model,
          }),
        )
        const first = sessions[0]
        const second = sessions[1]
        if (!first || !second) return yield* Effect.die(new Error("Both Prompt Session owners are required"))
        const target = { scope: "project", root: path.join(fixture.directory, ".omnixa/prompts") }
        const candidate = Schema.decodeUnknownSync(Candidate)({
          ...input,
          name: " Ｒｅｖｉｅｗ ",
          relativePath: "Review.md",
        })
        yield* expectMissing(
          yield* fixture.request(`/prompt-asset/content?scope=project&path=${candidate.relativePath}`, {
            directory: first.location.directory,
          }),
          candidate.relativePath,
        )
        const body = yield* readBody(
          yield* fixture.request(`/session/${first.id}/prompt-asset/apply`, {
            directory: first.location.directory,
            body: { candidate, target, overwrite: false },
          }),
        )
        expect(body).toHaveProperty("target", target)
        const applied = Schema.decodeUnknownSync(Info)(body)
        expect(applied.name).toBe(candidate.name)
        expect(applied.relativePath).toBe("Review.md")
        const file = path.join(target.root, candidate.relativePath)
        const bytes = yield* Effect.promise(() => Bun.file(file).arrayBuffer())
        expect(Hash.sha256(Buffer.from(bytes))).toBe(applied.revision)
        yield* Effect.forEach(
          [
            { endpoint: "apply", body: { candidate, target, overwrite: true } },
            { endpoint: "apply", body: { candidate, target, baseRevision: null, overwrite: true } },
            { endpoint: "apply", body: { candidate, target, baseRevision: applied.revision, overwrite: false } },
            { endpoint: "delete", body: { relativePath: candidate.relativePath, target } },
            { endpoint: "delete", body: { relativePath: candidate.relativePath, target, baseRevision: null } },
          ],
          (operation) =>
            Effect.gen(function* () {
              const response = yield* fixture.request(`/session/${second.id}/prompt-asset/${operation.endpoint}`, {
                directory: second.location.directory,
                body: operation.body,
              })
              expect(response.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => response.json())).toMatchObject({
                _tag: "ConflictError",
                resource: candidate.relativePath,
              })
            }),
        )
        expect(yield* Effect.promise(() => Bun.file(file).arrayBuffer())).toEqual(bytes)
        const replacement = { ...candidate, template: "Replaced $ARGUMENTS." }
        const updated = Schema.decodeUnknownSync(Info)(
          yield* readBody(
            yield* fixture.request(`/session/${second.id}/prompt-asset/apply`, {
              directory: second.location.directory,
              body: { candidate: replacement, target, baseRevision: applied.revision, overwrite: true },
            }),
          ),
        )
        expect(updated).toMatchObject({ target, template: replacement.template })
        expect(updated.revision).not.toBe(applied.revision)
        yield* Effect.forEach(
          [
            { endpoint: "apply", body: { candidate, target, baseRevision: applied.revision, overwrite: true } },
            {
              endpoint: "delete",
              body: { relativePath: candidate.relativePath, target, baseRevision: applied.revision },
            },
          ],
          (operation) =>
            Effect.gen(function* () {
              const response = yield* fixture.request(`/session/${first.id}/prompt-asset/${operation.endpoint}`, {
                directory: first.location.directory,
                body: operation.body,
              })
              expect(response.status).toBe(409)
              expect(yield* Effect.promise<unknown>(() => response.json())).toMatchObject({
                _tag: "ConflictError",
                resource: candidate.relativePath,
              })
            }),
        )
        expect(Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(file).arrayBuffer())))).toBe(
          updated.revision,
        )
        expect(
          (yield* fixture.request(`/session/${first.id}/prompt-asset/delete`, {
            directory: first.location.directory,
            body: { relativePath: candidate.relativePath, target, baseRevision: updated.revision },
          })).status,
        ).toBe(200)
        expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
        expect(
          (yield* fixture.request(`/session/${second.id}/prompt-asset/delete`, {
            directory: second.location.directory,
            body: { relativePath: candidate.relativePath, target, baseRevision: updated.revision },
          })).status,
        ).toBe(409)
        expect(
          (yield* fixture.request(`/session/${second.id}/prompt-asset/delete`, {
            directory: second.location.directory,
            body: { relativePath: candidate.relativePath, target },
          })).status,
        ).toBe(200)
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)

it.live(
  "keeps selected Prompt reads and deletion available when creation is disabled",
  () =>
    withEnv({ OMNIXA_EXPERIMENTAL_CHAT_ASSET: "false" }, () =>
      Effect.gen(function* () {
        const content =
          "---\nkind: prompt\nname: review-prompt\ndescription: Reviewed before disabling creation\n---\nReview $ARGUMENTS."
        const fixture = yield* setup([{ relativePath: "review-prompt.md", content }], prepareProject)
        const directory = path.join(fixture.directory, "packages/first")
        const session = yield* fixture.sessions.create({
          title: "Read existing selected Prompt",
          mode: "chat",
          location: locationRefForRoute({ directory }),
          agent: Agent.defaultID,
          model,
        })
        const candidate = Candidate.make({ ...input, relativePath: "review-prompt.md" })
        const inspected = yield* readInspection(
          yield* fixture.request(`/session/${session.id}/prompt-asset/inspect`, {
            directory,
            body: { candidate, scope: "project" },
          }),
        )
        expect(inspected).toMatchObject({
          exists: true,
          target: { scope: "project", root: path.join(fixture.directory, ".omnixa/prompts") },
        })
        const file = path.join(inspected.target.root, candidate.relativePath)
        expect(Schema.encodeSync(BaseRevision)(inspected.revision)).toBe(
          Hash.sha256(Buffer.from(yield* Effect.promise(() => Bun.file(file).arrayBuffer()))),
        )
        expect(yield* readBody(yield* fixture.request("/prompt-asset?scope=project", { directory }))).toMatchObject({
          target: Schema.encodeSync(AssetPlacement.Target)(inspected.target),
          assets: [{ name: candidate.name }],
        })
        expect(
          yield* readBody(
            yield* fixture.request("/prompt-asset/content?scope=project&path=review-prompt.md", { directory }),
          ),
        ).toMatchObject({
          target: Schema.encodeSync(AssetPlacement.Target)(inspected.target),
          template: "Review $ARGUMENTS.",
        })
        const disabled = yield* fixture.request(`/session/${session.id}/prompt-asset/apply`, {
          directory,
          body: { candidate, target: inspected.target, baseRevision: inspected.revision, overwrite: true },
        })
        expect(disabled.status).toBe(400)
        expect(yield* Effect.promise<unknown>(() => disabled.json())).toMatchObject({
          _tag: "InvalidRequestError",
          kind: "disabled",
        })
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(content)
        expect(
          (yield* fixture.request(`/session/${session.id}/prompt-asset/delete`, {
            directory,
            body: { relativePath: candidate.relativePath, target: inspected.target, baseRevision: inspected.revision },
          })).status,
        ).toBe(200)
        expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
        yield* expectMissing(
          yield* fixture.request("/prompt-asset/content?scope=project&path=review-prompt.md", { directory }),
          candidate.relativePath,
        )
        expect(yield* fixture.llm.requests()).toHaveLength(0)
      }),
    ),
  30_000,
)
async function prepareProject(directory: string) {
  await initRepo(directory)
  await Promise.all(
    ["first", "second"].map((name) => mkdir(path.join(directory, "packages", name), { recursive: true })),
  )
}

function proposal(messages: readonly SessionMessage.Info[], id: string) {
  const tool = messages
    .flatMap((message) => (message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : []))
    .find((part) => part.id === id && part.name === "propose_prompt_asset")
  if (!tool || tool.state.status !== "completed") throw new Error("Completed proposer Tool result missing")
  return {
    input: tool.state.input,
    metadata: tool.state.metadata,
    facts: Schema.decodeUnknownSync(facts)(tool.state.metadata),
  }
}

const readBody = (response: Response) =>
  Effect.gen(function* () {
    expect(response.status).toBe(200)
    return yield* Effect.promise<unknown>(() => response.json())
  })

const readInspection = (response: Response) =>
  Effect.gen(function* () {
    const body = yield* readBody(response)
    return Schema.decodeUnknownSync(PromptAsset.Inspection)(body)
  })

const expectMissing = (response: Response, relativePath: string) =>
  Effect.gen(function* () {
    expect(response.status).toBe(404)
    expect(
      Schema.decodeUnknownSync(ApiNotFoundError)(yield* Effect.promise<unknown>(() => response.json())),
    ).toMatchObject({ name: "NotFoundError", data: { message: "Prompt asset not found: " + relativePath } })
  })

const awaitInputCompletion = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  sessionID: Session.ID,
  inputID: SessionMessage.ID,
  message: string,
) =>
  pollWithTimeout(
    SessionInputResult.read(fixture.database.db, { sessionID, inputID }).pipe(
      Effect.flatMap((result) => {
        if (result.status === "failed" || result.status === "interrupted")
          return Effect.fail(new Error(message + ": " + result.status))
        return Effect.succeed(result.status === "completed" ? result : undefined)
      }),
    ),
    message,
    "10 seconds",
  )
