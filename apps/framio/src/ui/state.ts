import { projectSession } from "./project-session";
import { hiddenPreview, type PreviewMode } from "./preview-policy";
import type { LayerReport, RenameRequest } from "../contracts/layers";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { SelectionRequest as SelectionSchema } from "../contracts/requests";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import { studioInputLayer } from "./services/studio-input";
import { Atom } from "effect/reactivity";
import type { CanvasRequest, SelectionRequest } from "../contracts/requests";
import type { Tool } from "./toolbar";
import { ProjectClient, type LiveState } from "./services/project-client";
import { EditController } from "./services/edit-controller";
import type { SourceSelection } from "../contracts/edits";

export const runtime = Atom.runtime(
  Layer.merge(
    EditController.layer.pipe(Layer.provideMerge(ProjectClient.layer)),
    studioInputLayer,
  ),
);
export const liveAtom = runtime.atom(
  Stream.unwrap(Effect.map(ProjectClient, (client) => client.changes)),
  {
    initialValue: {
      snapshot: null,
      connected: false,
      saveError: null,
    } satisfies LiveState,
  },
);
export const saveSelectionAtom = runtime.fn(
  (payload: typeof SelectionRequest.Type) =>
    Effect.flatMap(ProjectClient, (client) => client.selection(payload)),
);
export const saveCanvasAtom = runtime.fn((payload: typeof CanvasRequest.Type) =>
  Effect.flatMap(ProjectClient, (client) => client.canvas(payload)),
);
const storedSelection = Schema.decodeUnknownResult(
  Schema.fromJsonString(SelectionSchema),
)(projectSession.getItem("selection") ?? "{}");
export const selectionAtom = Atom.make<
  typeof SelectionRequest.Type & {
    readonly sourceSelection?: SourceSelection;
    readonly sourceFrameId?: string;
  }
>(
  storedSelection._tag === "Success"
    ? storedSelection.success
    : { frames: [], element: null },
);
export const editHistoryAtom = runtime.fn((direction: "undo" | "redo") =>
  Effect.flatMap(EditController, (controller) => controller.history(direction)),
);
export const editNoticeAtom = runtime.fn((message: string) =>
  Effect.flatMap(EditController, (controller) => controller.notice(message)),
);
export const editNoticesAtom = runtime.atom(
  Stream.unwrap(Effect.map(EditController, (controller) => controller.changes)),
  { initialValue: null },
);
export const heightsAtom = Atom.family((page: string) =>
  Atom.make<Record<string, number>>({}),
);
export const movedAtom = Atom.family((page: string) =>
  Atom.make<Record<string, { x: number; y: number }>>({}),
);
const storedTool = localStorage.getItem("framio:tool");
export const toolAtom = Atom.make<Tool>(
  storedTool === "hand" || storedTool === "comment" ? storedTool : "select",
);

const readHash = () => {
  try {
    return decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  } catch {
    return "";
  }
};
export const pageAtom = Atom.make(
  Stream.concat(
    Stream.fromEffect(Effect.sync(readHash)),
    Stream.fromEventListener<HashChangeEvent>(window, "hashchange").pipe(
      Stream.map(readHash),
    ),
  ),
);

export const layersAtom = Atom.family((frame: string) =>
  Atom.make<LayerReport | null>(null),
);
export const renameLayerAtom = Atom.family((_frame: string) =>
  runtime.fn((payload: typeof RenameRequest.Type) =>
    Effect.flatMap(ProjectClient, (client) => client.renameLayer(payload)),
  ),
);
export const saveCommentAtom = runtime.fn(
  (payload: import("../contracts/comments").CommentOperation) =>
    Effect.flatMap(ProjectClient, (client) => client.comment(payload)),
);

type StudioActivity = {
  readonly snapshot: import("../contracts/snapshot").Snapshot | null;
  readonly entries: readonly {
    id: string;
    name: string;
    verb: string;
    tone: "signal" | "danger" | "faint";
    version: string;
  }[];
};

/** Keep a bounded session history from the shared live connection, never a second subscription. */
export const activityAtom = Atom.make<StudioActivity>((get) => {
  const live = get(liveAtom);
  const prior = get.self<StudioActivity>();
  const previous: StudioActivity =
    prior._tag === "Some" ? prior.value : { snapshot: null, entries: [] };
  if (
    live._tag !== "Success" ||
    !live.value.snapshot ||
    live.value.snapshot === previous.snapshot
  )
    return previous;
  const snapshot = live.value.snapshot;
  if (!previous.snapshot) return { snapshot, entries: [] };
  const before = new Map(
    previous.snapshot.pages.flatMap((page) =>
      page.frames.map((frame) => [frame.id, frame] as const),
    ),
  );
  const changes: StudioActivity["entries"][number][] = [];
  for (const page of snapshot.pages)
    for (const frame of page.frames) {
      const old = before.get(frame.id);
      if (!old || old.version !== frame.version || old.error !== frame.error)
        changes.push({
          id: `${frame.id}/${frame.version}/${frame.error ?? ""}`,
          name: frame.meta.name,
          verb: frame.error ? "Build failed" : old ? "Updated" : "Added",
          tone: frame.error ? "danger" : old ? "signal" : "faint",
          version: `v${frame.version}`,
        });
    }
  if (snapshot.cssVersion !== previous.snapshot.cssVersion)
    changes.push({
      id: `theme/${snapshot.cssVersion}`,
      name: "Project theme",
      verb: "Updated",
      tone: "faint",
      version: `v${snapshot.cssVersion}`,
    });
  return {
    snapshot,
    entries: [
      ...changes.reverse(),
      ...previous.entries.filter(
        (entry) => !changes.some((change) => change.id === entry.id),
      ),
    ].slice(0, 4),
  };
});

export const previewAtom = Atom.family((_frame: string) =>
  Atom.make<PreviewMode>(hiddenPreview),
);

export const readyVersionAtom = Atom.family((_frame: string) =>
  Atom.make<number | null>(null),
);

export const updateAtom = runtime.atom(
  Stream.unwrap(Effect.map(ProjectClient, (client) => client.updateChanges)),
  { initialValue: null },
);
export const updateActionAtom = runtime.fn(
  (
    action: (typeof import("../contracts/update").UpdateAction.Type)["action"],
  ) => Effect.flatMap(ProjectClient, (client) => client.update(action)),
);
