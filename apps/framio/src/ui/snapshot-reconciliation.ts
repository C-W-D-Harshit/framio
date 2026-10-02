import type { Snapshot } from "../contracts/snapshot";

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const reuse = <A>(previous: readonly A[] | undefined, next: readonly A[]) =>
  previous?.length === next.length &&
  next.every((value, i) => value === previous[i])
    ? previous
    : next;

/** RPC decoding creates objects; unchanged frame identities should survive it. */
export function reconcileSnapshot(
  previous: Snapshot | null,
  next: Snapshot,
): Snapshot {
  if (!previous) return next;
  const before = new Map(previous.pages.map((page) => [page.id, page]));
  const pages = reuse(
    previous.pages,
    next.pages.map((page) => {
      const old = before.get(page.id);
      if (!old) return page;
      const frames = new Map(old.frames.map((frame) => [frame.id, frame]));
      const stableFrames = reuse(
        old.frames,
        page.frames.map((frame) => {
          const oldFrame = frames.get(frame.id);
          return oldFrame && same(oldFrame, frame) ? oldFrame : frame;
        }),
      );
      const positions = same(old.positions, page.positions)
        ? old.positions
        : page.positions;
      return stableFrames === old.frames &&
        positions === old.positions &&
        page.name === old.name
        ? old
        : { ...page, frames: stableFrames, positions };
    }),
  );
  const comments = same(previous.comments, next.comments)
    ? previous.comments
    : next.comments;
  return pages === previous.pages &&
    comments === previous.comments &&
    previous.cssVersion === next.cssVersion &&
    previous.cssError === next.cssError &&
    previous.commentsError === next.commentsError &&
    previous.projectName === next.projectName
    ? previous
    : { ...next, pages, comments };
}
