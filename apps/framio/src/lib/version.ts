declare const FRAMIO_VERSION: string | undefined;
export const runningVersion =
  typeof FRAMIO_VERSION === "string" ? FRAMIO_VERSION : "dev";
export const compiled = () =>
  typeof Bun !== "undefined" &&
  (Bun.main.startsWith("/$bunfs") ||
    Bun.main.replaceAll("\\", "/").startsWith("B:/~BUN"));
