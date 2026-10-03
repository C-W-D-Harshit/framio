import type { CaptureEvidence, DesignReview } from "../contracts/evidence";
import type { SnapshotFrame } from "../contracts/snapshot";

export function reviewStatus(
  review: DesignReview,
  captures: readonly CaptureEvidence[],
  frames: readonly SnapshotFrame[],
  contextRevision: string,
): { status: "current" | "outdated" | "unavailable"; reason: string } {
  const capture = captures.find((value) => value.id === review.captureId);
  const frame = frames.find((value) => value.id === review.frame);
  if (!capture || !frame || !capture.revision || !frame.revision)
    return {
      status: "unavailable",
      reason: "The reviewed screenshot or frame is unavailable.",
    };
  if (capture.frame !== review.frame)
    return {
      status: "unavailable",
      reason: "The screenshot belongs to another frame.",
    };
  if (capture.revision !== frame.revision)
    return {
      status: "outdated",
      reason: "The frame, theme, or assets changed after this screenshot.",
    };
  if (capture.contextRevision !== contextRevision)
    return {
      status: "outdated",
      reason: "The brief or direction changed after this screenshot.",
    };
  return {
    status: "current",
    reason: `Reviewed at ${capture.viewportWidth}px${capture.layer ? `, ${capture.layer}` : ""}.`,
  };
}
