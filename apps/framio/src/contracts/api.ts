import {
  InspectRequest,
  InspectResponse,
  RenameRequest,
  RenameResponse,
} from "./layers";
import { CommentOperation, CommentResponse } from "./comments";
import {
  EditOperation,
  EditResponse,
  SourcePatch,
  PatchResponse,
} from "./edits";
import * as Schema from "effect/Schema";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
} from "effect/http-api";
import { UpdateAction, UpdateResponse, UpdateStatus } from "./update";
import { Snapshot } from "./snapshot";
import {
  CanvasRequest,
  ScreenshotRequest,
  ScreenshotResponse,
  SelectionRequest,
} from "./requests";
import { FrameStatus } from "./frame-status";
import {
  EvidenceResponse,
  EvidenceUpdate,
  EvidenceWriteResponse,
} from "./evidence";
export const Ok = Schema.Struct({ ok: Schema.Literal(true) });
export const Health = Schema.Struct({
  ok: Schema.Literal(true),
  root: Schema.String,
  pid: Schema.Int,
  protocol: Schema.Literal("framio-v4-1"),
  version: Schema.String,
});
export class ProjectApi extends HttpApiGroup.make("project").add(
  HttpApiEndpoint.get("updateStatus", "/api/update", { success: UpdateStatus }),
  HttpApiEndpoint.post("updateAction", "/api/update", {
    payload: UpdateAction,
    success: UpdateResponse,
  }),
  HttpApiEndpoint.post("inspect", "/api/inspect", {
    payload: InspectRequest,
    success: InspectResponse,
  }),
  HttpApiEndpoint.post("renameLayer", "/api/layers/rename", {
    payload: RenameRequest,
    success: RenameResponse,
  }),
  HttpApiEndpoint.post("edit", "/api/edits", {
    payload: EditOperation,
    success: EditResponse,
  }),
  HttpApiEndpoint.post("patch", "/api/edits/patch", {
    payload: SourcePatch,
    success: PatchResponse,
  }),
  HttpApiEndpoint.get("health", "/api/health", { success: Health }),
  HttpApiEndpoint.get("snapshot", "/api/project", { success: Snapshot }),
  HttpApiEndpoint.get("evidence", "/api/evidence", {
    success: EvidenceResponse,
  }),
  HttpApiEndpoint.post("writeEvidence", "/api/evidence", {
    payload: EvidenceUpdate,
    success: EvidenceWriteResponse,
  }),
  HttpApiEndpoint.post("comments", "/api/comments", {
    payload: CommentOperation,
    success: CommentResponse,
  }),
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
