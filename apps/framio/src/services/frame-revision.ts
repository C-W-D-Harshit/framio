import { createHash } from "node:crypto";
import type { Frame } from "../domain/project";
import type { ProjectGeneration } from "./project-state";

export function frameRevision(state: ProjectGeneration, frame: Frame): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        artifact:
          frame.kind === "image"
            ? state.imageVersions.get(frame.id)
            : state.artifacts.frames.get(frame.id)?.hash,
        css: Bun.hash(state.css.text).toString(16),
        meta: frame.meta,
        source: frame.source,
        note: frame.note,
        assets: state.assetRevision ?? "",
      }),
    )
    .digest("hex")
    .slice(0, 24);
}
