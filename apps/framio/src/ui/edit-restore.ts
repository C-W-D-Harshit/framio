export type SelectionRestore = {
  readonly frameId: string;
  readonly ref: string;
  readonly index: number;
  readonly afterVersion: number;
};
export type RestoreDocument = {
  readonly frameId: string;
  readonly version: number;
  readonly currentVersion: number;
  readonly shown: boolean;
  readonly ready: boolean;
  readonly containsRef: boolean;
};

/** A hidden replacement and a stale displayed document must never consume a restore. */
export const matchesRestore = (
  pending: SelectionRestore,
  document: RestoreDocument,
): boolean =>
  pending.frameId === document.frameId &&
  document.version > pending.afterVersion &&
  document.version === document.currentVersion &&
  document.shown &&
  document.ready &&
  document.containsRef;
