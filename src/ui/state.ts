import type { LayerReport, RenameRequest } from "../contracts/layers";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";
import type { CanvasRequest, SelectionRequest } from "../contracts/requests";
import type { Tool } from "./toolbar";
import { ProjectClient, type LiveState } from "./services/project-client";

export const runtime = Atom.runtime(ProjectClient.layer);
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
export const selectionAtom = Atom.make<typeof SelectionRequest.Type>({
  frames: [],
  element: null,
});
export const heightsAtom = Atom.family((page: string) =>
  Atom.make<Record<string, number>>({}),
);
export const movedAtom = Atom.family((page: string) =>
  Atom.make<Record<string, { x: number; y: number }>>({}),
);
export const toolAtom = Atom.make<Tool>(
  localStorage.getItem("framio:tool") === "hand" ? "hand" : "select",
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
