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
  const evidence = same(previous.evidence, next.evidence)
    ? previous.evidence
    : next.evidence;
  const captures = same(previous.captures, next.captures)
    ? previous.captures
    : next.captures;
  const metadata = (snapshot: Snapshot) => ({
    ...snapshot,
    pages: undefined,
    comments: undefined,
    evidence: undefined,
    captures: undefined,
  });
  return pages === previous.pages &&
    comments === previous.comments &&
    evidence === previous.evidence &&
    captures === previous.captures &&
    same(metadata(previous), metadata(next))
    ? previous
    : { ...next, pages, comments, evidence, captures };
}
