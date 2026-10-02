export type PreviewMode = {
  visible: boolean;
  live: boolean;
  scale: number;
  reload: boolean;
};
export const hiddenPreview: PreviewMode = {
  visible: false,
  live: false,
  scale: 0.5,
  reload: false,
};
export type PreviewFrame = {
  id: string;
  kind: "tsx" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  selected?: boolean;
  version: number;
};
export const LIVE_LIMIT = 6;
export const BOOT_LIMIT = 2;
export const LIVE_PIXEL_BUDGET = 12_000_000;
const scales = [0.0625, 0.125, 0.25, 0.5, 1];

export function planPreviews(
  frames: readonly PreviewFrame[],
  viewport: {
    x: number;
    y: number;
    zoom: number;
    width: number;
    height: number;
    dpr: number;
  },
  previous: ReadonlyMap<string, PreviewMode>,
  ready: ReadonlyMap<string, number>,
  shown: ReadonlyMap<string, number>,
  navigating: boolean,
  loading: ReadonlyMap<string, number> = new Map(),
) {
  const { x, y, zoom: z, width: w, height: h } = viewport;
  const selected = frames.filter((frame) => frame.selected);
  const visible = frames.map((frame) => {
    const left = frame.x * z + x,
      top = frame.y * z + y;
    const margin = 96;
    return {
      frame,
      visible:
        left < w + margin &&
        left + frame.width * z > -margin &&
        top < h + margin &&
        top + frame.height * z > -margin,
      distance: Math.hypot(
        left + (frame.width * z) / 2 - w / 2,
        top + (frame.height * z) / 2 - h / 2,
      ),
    };
  });
  const candidates = visible
    .filter(
      ({ frame, visible }) =>
        visible &&
        frame.kind === "tsx" &&
        ((selected.length === 1 && frame.selected) ||
          frames.length <= 8 ||
          z >= (previous.get(frame.id)?.live ? 0.22 : 0.28)),
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.frame.selected && selected.length === 1)) -
          Number(Boolean(a.frame.selected && selected.length === 1)) ||
        Number(Boolean(previous.get(b.frame.id)?.live)) -
          Number(Boolean(previous.get(a.frame.id)?.live)) ||
        a.distance - b.distance,
    );
  const live = new Set<string>();
  let pixels = 0;
  let booting = candidates.filter(
    ({ frame }) =>
      previous.get(frame.id)?.live &&
      ready.get(frame.id) !==
        (loading.get(frame.id) ?? shown.get(frame.id) ?? frame.version),
  ).length;
  for (const { frame } of candidates) {
    if (live.size >= LIVE_LIMIT) break;
    const area = frame.width * frame.height * Math.max(1, viewport.dpr) ** 2;
    if (live.size > 0 && pixels + area > LIVE_PIXEL_BUDGET) continue;
    if (!previous.get(frame.id)?.live) {
      if (navigating || booting >= BOOT_LIMIT) continue;
      booting++;
    }
    live.add(frame.id);
    pixels += area;
  }
  let replacing = 0;
  return new Map(
    visible.map(({ frame, visible }) => {
      const old = previous.get(frame.id);
      const projected = z * viewport.dpr;
      let scale = scales.find((scale) => scale >= projected) ?? 1;
      if (old && projected >= old.scale * 0.4 && projected <= old.scale)
        scale = old.scale;
      const replace =
        live.has(frame.id) &&
        shown.has(frame.id) &&
        shown.get(frame.id) !== frame.version;
      const inFlight =
        loading.get(frame.id) === frame.version &&
        ready.get(frame.id) !== frame.version;
      const reload =
        replace &&
        (inFlight || (!navigating && booting + replacing < BOOT_LIMIT));
      if (reload && !inFlight) replacing++;
      const mode = { visible, live: live.has(frame.id), scale, reload };
      return [
        frame.id,
        old &&
        old.visible === mode.visible &&
        old.live === mode.live &&
        old.scale === scale &&
        old.reload === reload
          ? old
          : mode,
      ];
    }),
  );
}
