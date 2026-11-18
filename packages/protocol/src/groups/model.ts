import { Model } from "@aigcfroge/schema/model"
// The existing protocol group export already owns the name ModelGroup.
import { ModelGroup as ModelGroupSchema } from "@aigcfroge/schema/model-group"
import { Location } from "@aigcfroge/schema/location"
import { optional } from "@aigcfroge/schema/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const ModelGroup = HttpApiGroup.make("server.model")
  .add(
    HttpApiEndpoint.get("model.group.definition.get", "/api/model/group", {
      query: LocationQuery.mapFields((fields) => ({ ...fields, groupID: Model.GroupID.pipe(optional) })),
      success: Location.response(ModelGroupSchema.Read),
      error: ServiceUnavailableError,
    }).annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.post("model.group.definition.save", "/api/model/group", {
      query: LocationQuery,
      payload: ModelGroupSchema.SaveInput,
      success: Location.response(ModelGroupSchema.SaveResult),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error", errors: "all" })
      .annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.delete("model.group.definition.remove", "/api/model/group", {
      query: LocationQuery,
      payload: ModelGroupSchema.RemoveInput,
      success: Location.response(ModelGroupSchema.RemoveResult),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error", errors: "all" })
      .annotateMerge(locationQueryOpenApi),
  )
  .add(
    HttpApiEndpoint.get("model.list", "/api/model", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Model.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "model.list",
          summary: "List models",
          description:
            "Retrieve the current snapshot of available models ordered by release date. The snapshot may precede initial plugin settlement.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("model.default", "/api/model/default", {
      query: LocationQuery,
      success: Location.response(Schema.UndefinedOr(Model.Info)),
      error: ServiceUnavailableError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "model.default",
          summary: "Get default model",
          description: "Retrieve the model used when a session has no explicit model selection.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "model",
      description: "Experimental model routes.",
    }),
  )
