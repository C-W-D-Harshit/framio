import type { FrameMeta } from "./project";

export function viewports(meta: FrameMeta, width?: number) {
  const heightAt = (w: number) => {
    const index = meta.widths?.indexOf(w) ?? -1;
    return (
      (index >= 0 ? meta.heights?.[index] : undefined) ??
      (!meta.widths
        ? meta.height
        : w >= 1024
          ? meta.height
          : w >= 600
            ? 1024
            : 844)
    );
  };
  return (width === undefined ? (meta.widths ?? [meta.width]) : [width]).map(
    (w) => ({ width: w, height: heightAt(w) }),
  );
}
export function viewportId(id: string, meta: FrameMeta, width: number) {
  return meta.widths ? `__viewport__/${id}/${width}` : id;
}
export function groupWidth(meta: FrameMeta) {
  return viewports(meta).reduce((sum, v, i) => sum + v.width + (i ? 80 : 0), 0);
}
