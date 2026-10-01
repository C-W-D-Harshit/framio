import * as Effect from "effect/Effect";
import type {
  InspectRequest,
  RenameRequest,
  LayerReport,
} from "../../contracts/layers";
import type { ProjectState } from "../../services/project-state";
import type { Screenshots } from "../../services/screenshots";
import { findFrame } from "../project";
import { resolveLayer } from "../../domain/layers";
import { makeLayerRenamer } from "./source";
export type LayerObservation = {
  id: string;
  version: number;
  report: LayerReport;
};
export const makeLayersApi = Effect.fn("Layers.api")(function* (
  framio: string,
  project: ProjectState["Service"],
  shots: Screenshots["Service"],
) {
  const rename = yield* makeLayerRenamer;
  const warnings = (reports: readonly LayerObservation[]) =>
    project.update((state) => {
      const layerWarnings = new Map(state.layerWarnings);
      for (const report of reports)
        if (state.artifacts.frames.get(report.id)?.version === report.version)
          layerWarnings.set(report.id, report.report.warnings);
      return reports.length ? { ...state, layerWarnings } : state;
    });
  const inspect = Effect.fn("Layers.inspect")(function* (
    payload: typeof InspectRequest.Type,
  ) {
    const reports: LayerObservation[] = [];
    const result = yield* project.withStableState((state) =>
      Effect.gen(function* () {
        const frame = findFrame(state.pages, payload.frame);
        if ("error" in frame) return { error: frame.error };
        if (frame.kind !== "tsx")
          return { error: "Image frames have no DOM layers." };
        const shot = yield* shots.capture(
          frame,
          "",
          1,
          [],
          payload.width,
          true,
        );
        if (shot.report)
          reports.push({
            id: frame.id,
            version: state.artifacts.frames.get(frame.id)?.version ?? 0,
            report: shot.report,
          });
        if (shot.error) return { error: shot.error };
        const report = shot.report!;
        if (!payload.layer) return { report };
        const node = resolveLayer(report.tree, payload.layer);
        if (!node) return { error: `No layer "${payload.layer}".` };
        return {
          report: {
            ...report,
            tree: [node],
            checks: report.checks.filter(
              (c) => c.path === node.path || c.path.startsWith(node.path + "/"),
            ),
          },
        };
      }).pipe(
        Effect.catch((error) => Effect.succeed({ error: error.message })),
      ),
    );
    yield* warnings(reports);
    return result;
  });
  const renameLayer = (payload: typeof RenameRequest.Type) =>
    rename(framio, payload.source, payload.name).pipe(
      Effect.as({ ok: true }),
      Effect.catch((error) =>
        Effect.succeed({ ok: false, error: error.message }),
      ),
    );
  return { inspect, renameLayer, warnings };
});
