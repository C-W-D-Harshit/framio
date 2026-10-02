import { describe, it, expect } from "vitest";
import {
  planPreviews,
  LIVE_LIMIT,
  BOOT_LIMIT,
  type PreviewFrame,
  type PreviewMode,
} from "../../src/ui/preview-policy";
const frames: PreviewFrame[] = Array.from({ length: 100 }, (_, i) => ({
  id: String(i),
  kind: "tsx",
  x: (i % 10) * 110,
  y: Math.floor(i / 10) * 110,
  width: 100,
  height: 100,
  version: 1,
}));
const viewport = { x: 0, y: 0, zoom: 1, width: 1280, height: 800, dpr: 2 };
const live = (modes: Map<string, PreviewMode>) =>
  [...modes].filter(([, mode]) => mode.live).map(([id]) => id);
describe("preview admission", () => {
  it("releases expired boot slots without marking frames ready", () => {
    const previous = planPreviews(
      frames,
      viewport,
      new Map(),
      new Map(),
      new Map(),
      false,
    );
    const stalled = live(previous);
    expect(stalled).toHaveLength(BOOT_LIMIT);
    const expired = new Map(stalled.map((id) => [id, 1]));
    const next = planPreviews(
      frames,
      viewport,
      previous,
      new Map(),
      new Map(),
      false,
      new Map(),
      expired,
    );
    expect(live(next)).toHaveLength(BOOT_LIMIT * 2);
    expect(stalled.every((id) => next.get(id)?.live)).toBe(true);
    // An old timeout cannot release a newer version's slot.
    const loading = new Map(stalled.map((id) => [id, 2]));
    expect(
      live(
        planPreviews(
          frames,
          viewport,
          previous,
          new Map(),
          new Map(),
          false,
          loading,
          expired,
        ),
      ),
    ).toEqual(stalled);
    const changed = frames.map((frame) => ({ ...frame, version: 2 }));
    const shown = new Map(stalled.map((id) => [id, 1]));
    const replacements = planPreviews(
      changed.filter((frame) => stalled.includes(frame.id)),
      viewport,
      previous,
      new Map(),
      shown,
      false,
      shown,
      expired,
    );
    expect(
      [...replacements.values()].filter((mode) => mode.reload),
    ).toHaveLength(BOOT_LIMIT);
  });
  it("bounds cold boots, settled live frames, and mass selection", () => {
    let modes = new Map<string, PreviewMode>();
    const ready = new Map<string, number>();
    const selected = frames.map((frame) => ({ ...frame, selected: true }));
    for (let i = 0; i < 10; i++) {
      const next = planPreviews(selected, viewport, modes, ready, ready, false);
      expect(
        live(next).filter((id) => !modes.get(id)?.live).length,
      ).toBeLessThanOrEqual(BOOT_LIMIT);
      expect(live(next).length).toBeLessThanOrEqual(LIVE_LIMIT);
      modes = next;
      for (const id of live(modes)) ready.set(id, 1);
    }
    expect(live(modes)).toHaveLength(LIVE_LIMIT);
  });
  it("pauses new admissions during gestures and retains zoom hysteresis", () => {
    const previous = planPreviews(
      frames,
      viewport,
      new Map(),
      new Map(),
      new Map(),
      false,
    );
    expect(
      live(
        planPreviews(frames, viewport, previous, new Map(), new Map(), true),
      ),
    ).toEqual(live(previous));
    expect(
      live(
        planPreviews(
          frames,
          { ...viewport, zoom: 0.24 },
          previous,
          new Map(),
          new Map(),
          false,
        ),
      ),
    ).toHaveLength(2);
    expect(
      live(
        planPreviews(
          frames,
          { ...viewport, zoom: 0.21 },
          previous,
          new Map(),
          new Map(),
          false,
        ),
      ),
    ).toHaveLength(0);
    expect(
      live(
        planPreviews(
          frames,
          { ...viewport, zoom: 0.24 },
          new Map(),
          new Map(),
          new Map(),
          false,
        ),
      ),
    ).toHaveLength(0);
  });
  it("keeps admitted replacements alive and caps replacement concurrency", () => {
    const previous = new Map(
      frames
        .slice(0, 6)
        .map((frame) => [
          frame.id,
          { visible: true, live: true, scale: 1, reload: false },
        ]),
    );
    const shown = new Map(frames.slice(0, 6).map((frame) => [frame.id, 1]));
    const changed = frames.map((frame) => ({ ...frame, version: 2 }));
    const next = planPreviews(changed, viewport, previous, shown, shown, false);
    const replacements = [...next]
      .filter(([, mode]) => mode.reload)
      .map(([id]) => id);
    expect(replacements).toHaveLength(2);
    const loading = new Map(replacements.map((id) => [id, 2]));
    const inFlight = planPreviews(
      changed,
      viewport,
      next,
      shown,
      shown,
      true,
      loading,
    );
    expect(
      [...inFlight].filter(([, mode]) => mode.reload).map(([id]) => id),
    ).toEqual(replacements);
  });
  it("uses quantized image resolution and preserves unchanged mode identities", () => {
    const images = frames.map((frame) => ({
      ...frame,
      kind: "image" as const,
    }));
    const first = planPreviews(
      images,
      { ...viewport, zoom: 0.03 },
      new Map(),
      new Map(),
      new Map(),
      false,
    );
    expect(first.get("0")?.scale).toBe(0.0625);
    expect(live(first)).toHaveLength(0);
    const next = planPreviews(
      images,
      { ...viewport, zoom: 0.031 },
      first,
      new Map(),
      new Map(),
      false,
    );
    expect(next.get("0")).toBe(first.get("0"));
  });
});

it("reduces live admission for large high-DPR surfaces and keeps a selected oversized frame usable", () => {
  const large = frames.map((frame) => ({ ...frame, width: 1440, height: 900 }));
  const ready = new Map(large.map((frame) => [frame.id, 1]));
  let modes = new Map<string, PreviewMode>();
  for (let i = 0; i < 4; i++)
    modes = planPreviews(large, viewport, modes, ready, ready, false);
  expect(live(modes)).toHaveLength(2);
  const huge = large.map((frame, i) => ({
    ...frame,
    width: 4000,
    height: 8000,
    selected: i === 0,
  }));
  expect(
    live(planPreviews(huge, viewport, new Map(), new Map(), new Map(), false)),
  ).toEqual(["0"]);
});
