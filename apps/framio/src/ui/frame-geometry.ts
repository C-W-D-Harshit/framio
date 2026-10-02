import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import type { SnapshotFrame } from "../contracts/snapshot";
import { viewports, viewportId } from "../domain/viewports";

const Geometry = Schema.Record(
  Schema.String,
  Schema.Struct({
    fingerprint: Schema.String,
    height: Schema.Number.check(
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(100000),
    ),
  }),
);
export const geometryFingerprint = (
  frame: SnapshotFrame,
  width: number,
  css: number,
) =>
  JSON.stringify([
    frame.geometryVersion ?? [frame.version, css],
    width,
    frame.meta.height,
    frame.meta.heights,
  ]);
const key = (project: string, page: string) =>
  `framio:geometry:${project}/${page}`;

export function readGeometry(
  project: string,
  page: string,
  frames: readonly SnapshotFrame[],
  css: number,
) {
  try {
    const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(Geometry))(
      localStorage.getItem(key(project, page)) ?? "{}",
    );
    if (Result.isFailure(decoded)) return {};
    return Object.fromEntries(
      frames.flatMap((frame) =>
        viewports(frame.meta).flatMap((v) => {
          const id = viewportId(frame.id, frame.meta, v.width);
          const entry = decoded.success[id];
          return entry?.fingerprint === geometryFingerprint(frame, v.width, css)
            ? [[id, entry.height]]
            : [];
        }),
      ),
    );
  } catch {
    return {};
  }
}

export function writeGeometry(
  project: string,
  page: string,
  frames: readonly SnapshotFrame[],
  css: number,
  heights: Record<string, number>,
) {
  try {
    const entries = frames.flatMap((frame) =>
      viewports(frame.meta).flatMap((v) => {
        const id = viewportId(frame.id, frame.meta, v.width),
          height = heights[id];
        return height && height > 0 && height <= 100000
          ? [
              [
                id,
                {
                  height,
                  fingerprint: geometryFingerprint(frame, v.width, css),
                },
              ],
            ]
          : [];
      }),
    );
    localStorage.setItem(
      key(project, page),
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    /* Storage quota or private browsing must not interrupt rendering. */
  }
}
