import {
  InspectRequest,
  InspectResponse,
  RenameRequest,
  RenameResponse,
} from "./layers";
import * as Schema from "effect/Schema";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
} from "effect/http-api";
import { Snapshot } from "./snapshot";
import {
  CanvasRequest,
  ScreenshotRequest,
  ScreenshotResponse,
  SelectionRequest,
} from "./requests";
import { FrameStatus } from "./frame-status";
export const Ok = Schema.Struct({ ok: Schema.Literal(true) });
export const Health = Schema.Struct({
  ok: Schema.Literal(true),
  root: Schema.String,
  pid: Schema.Int,
  protocol: Schema.Literal("framio-v4-1"),
});
export class ProjectApi extends HttpApiGroup.make("project").add(
  HttpApiEndpoint.post("inspect", "/api/inspect", {
    payload: InspectRequest,
    success: InspectResponse,
  }),
  HttpApiEndpoint.post("renameLayer", "/api/layers/rename", {
    payload: RenameRequest,
    success: RenameResponse,
  }),
  HttpApiEndpoint.get("health", "/api/health", { success: Health }),
  HttpApiEndpoint.get("snapshot", "/api/project", { success: Snapshot }),
  HttpApiEndpoint.post("selection", "/api/selection", {
    payload: SelectionRequest,
    success: Ok,
  }),
  HttpApiEndpoint.post("canvas", "/api/canvas", {
    payload: CanvasRequest,
    success: Ok,
    error: HttpApiError.NotFound,
  }),
  HttpApiEndpoint.post("frameStatus", "/api/frame-status", {
    payload: FrameStatus,
    success: Ok,
  }),
  HttpApiEndpoint.post("screenshot", "/api/screenshot", {
    payload: ScreenshotRequest,
    success: ScreenshotResponse,
  }),
) {}
export class Api extends HttpApi.make("framio").add(ProjectApi) {}
